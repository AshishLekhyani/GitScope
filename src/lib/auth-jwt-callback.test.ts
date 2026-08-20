import { beforeAll, describe, expect, it, vi } from "vitest";
import type { JWT } from "next-auth/jwt";

// auth.ts throws at import time without these, and pulls in Prisma + email.
process.env.GITHUB_ID = "test-github-id";
process.env.GITHUB_SECRET = "test-github-secret";
process.env.NEXTAUTH_SECRET = "test-nextauth-secret";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), buildVerificationEmail: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ logSecurityEvent: vi.fn() }));

type JwtCallback = NonNullable<
  NonNullable<typeof import("./auth").authOptions["callbacks"]>["jwt"]
>;
let jwt: JwtCallback;

beforeAll(async () => {
  const { authOptions } = await import("./auth");
  jwt = authOptions.callbacks!.jwt!;
});

/** A token as it would look for a signed-in user. */
function tokenFor(id: string, email: string): JWT {
  return { id, email, name: "Real User", picture: "https://example.test/real.png" } as JWT;
}

// The callback's `session` argument is whatever the caller passed to
// useSession().update() — entirely attacker-controlled.
type JwtArgs = Parameters<JwtCallback>[0];

function update(token: JWT, session: unknown): Promise<JWT> {
  return jwt({ token, trigger: "update", session } as unknown as JwtArgs) as Promise<JWT>;
}

describe("jwt callback — update trigger cannot rewrite identity", () => {
  it("ignores an attempt to overwrite the user id", async () => {
    // Regression: `token = { ...token, ...session }` let any signed-in user set
    // token.id to another account's id, which is what every authz check reads.
    const token = tokenFor("user-attacker", "attacker@example.test");
    const result = await update(token, { id: "user-victim" });

    expect(result.id).toBe("user-attacker");
  });

  it("ignores an attempt to overwrite the email", async () => {
    const token = tokenFor("user-attacker", "attacker@example.test");
    const result = await update(token, { email: "admin@gitscope.test" });

    expect(result.email).toBe("attacker@example.test");
  });

  it("ignores an attempt to inject an access token or provider", async () => {
    const token = tokenFor("user-attacker", "attacker@example.test");
    const result = await update(token, {
      accessToken: "gho_stolen",
      provider: "github",
    });

    expect(result.accessToken).toBeUndefined();
    expect(result.provider).toBeUndefined();
  });

  it("ignores identity fields even when mixed in with legitimate ones", async () => {
    const token = tokenFor("user-attacker", "attacker@example.test");
    const result = await update(token, { name: "New Name", id: "user-victim" });

    expect(result.name).toBe("New Name");
    expect(result.id).toBe("user-attacker");
  });

  it("drops unknown keys entirely", async () => {
    const token = tokenFor("user-attacker", "attacker@example.test");
    const result = await update(token, { isAdmin: true, aiTier: "developer" });

    expect((result as Record<string, unknown>).isAdmin).toBeUndefined();
    expect((result as Record<string, unknown>).aiTier).toBeUndefined();
  });
});

describe("jwt callback — update trigger still applies display fields", () => {
  it("updates the display name", async () => {
    const token = tokenFor("user-1", "user@example.test");
    const result = await update(token, { name: "Renamed" });

    expect(result.name).toBe("Renamed");
  });

  it("updates the avatar from either picture or image", async () => {
    const viaPicture = await update(tokenFor("user-1", "u@e.test"), {
      picture: "https://example.test/a.png",
    });
    expect(viaPicture.picture).toBe("https://example.test/a.png");

    const viaImage = await update(tokenFor("user-1", "u@e.test"), {
      image: "https://example.test/b.png",
    });
    expect(viaImage.picture).toBe("https://example.test/b.png");
  });

  it("ignores non-string display values", async () => {
    const token = tokenFor("user-1", "u@e.test");
    const result = await update(token, { name: { toString: () => "evil" }, picture: 42 });

    expect(result.name).toBe("Real User");
    expect(result.picture).toBe("https://example.test/real.png");
  });

  it("tolerates a null or non-object update payload", async () => {
    const token = tokenFor("user-1", "u@e.test");
    await expect(update(token, null)).resolves.toMatchObject({ id: "user-1" });
    await expect(update(token, "nonsense")).resolves.toMatchObject({ id: "user-1" });
  });
});

describe("jwt callback — sign-in still populates the token", () => {
  it("seeds identity from the user object on initial sign-in", async () => {
    const result = (await jwt({
      token: {} as JWT,
      user: { id: "user-9", email: "new@example.test", name: "New", image: "https://e.test/i.png" },
    } as unknown as JwtArgs)) as JWT;

    expect(result.id).toBe("user-9");
    expect(result.email).toBe("new@example.test");
  });

  it("captures the access token from the account on sign-in", async () => {
    const result = (await jwt({
      token: {} as JWT,
      user: { id: "user-9", email: "new@example.test" },
      account: { provider: "github", access_token: "gho_real", type: "oauth", providerAccountId: "1" },
    } as unknown as JwtArgs)) as JWT;

    expect(result.accessToken).toBe("gho_real");
    expect(result.provider).toBe("github");
  });
});
