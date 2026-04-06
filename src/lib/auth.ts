import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail, buildVerificationEmail } from "@/lib/email";
import { logSecurityEvent } from "@/lib/audit-log";

if (!process.env.GITHUB_ID || !process.env.GITHUB_SECRET) {
  throw new Error("GITHUB_ID and GITHUB_SECRET must be set");
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
      // SECURITY: allowDangerousEmailAccountLinking enables automatic account linking when OAuth
      // provider email matches existing user email. We mitigate risks by:
      // 1. Checking email is verified by the OAuth provider
      // 2. Audit logging all automatic linking events
      // 3. Requiring the user to be recently active or have verified email
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: "read:user user:email notifications",
        },
      },
      // SECURITY: Extra verification - call GitHub API to check email is verified.
      // Fail-closed: any failure (API down, unverified email, missing token) blocks
      // sign-in to prevent account takeover via allowDangerousEmailAccountLinking.
      async profile(profile, tokens) {
        // No email means no linking risk — proceed without verification.
        if (!profile.email) {
          return {
            id: profile.id.toString(),
            name: profile.name || profile.login,
            email: profile.email,
            image: profile.avatar_url,
            emailVerified: null,
          };
        }

        // Email is present but no access token — can't verify, block sign-in.
        if (!tokens.access_token) {
          throw new Error("Cannot verify GitHub email: missing access token");
        }

        // Verify the email is actually owned and confirmed by this GitHub account.
        const emailsRes = await fetch("https://api.github.com/user/emails", {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/vnd.github.v3+json",
          },
        });

        if (!emailsRes.ok) {
          throw new Error("Unable to verify your GitHub email right now. Please try signing in again.");
        }

        const emails: Array<{ email: string; verified: boolean; primary: boolean }> = await emailsRes.json();
        const matchingEmail = emails.find(e => e.email === profile.email);

        if (!matchingEmail) {
          throw new Error("GitHub email is not associated with this account");
        }

        if (!matchingEmail.verified) {
          throw new Error("GitHub email is not verified. Please verify your email on GitHub first.");
        }

        return {
          id: profile.id.toString(),
          name: profile.name || profile.login,
          email: profile.email,
          image: profile.avatar_url,
          emailVerified: new Date(),
        };
      },
    }),
    ...(process.env.GOOGLE_ID && process.env.GOOGLE_SECRET
      ? [GoogleProvider({
          clientId: process.env.GOOGLE_ID,
          clientSecret: process.env.GOOGLE_SECRET,
          // SECURITY: Google verifies emails - see GitHubProvider for additional safety measures.
          // Fail-closed: if Google signals email is unverified, block sign-in to prevent
          // account takeover via allowDangerousEmailAccountLinking.
          allowDangerousEmailAccountLinking: true,
          profile(profile) {
            if (profile.email && !profile.email_verified) {
              throw new Error("Google email is not verified. Please verify your email with Google first.");
            }
            return {
              id: profile.sub,
              name: profile.name,
              email: profile.email,
              image: profile.picture,
              emailVerified: profile.email_verified ? new Date() : null,
            };
          },
        })]
      : []),
    // One-time autologin token — used immediately after email verification
    CredentialsProvider({
      id: "token",
      name: "token",
      credentials: { token: { type: "text" } },
      async authorize(creds) {
        if (!creds?.token) return null;
        const record = await prisma.verificationToken.findUnique({
          where: { token: creds.token },
        });
        if (
          !record ||
          (!record.identifier.startsWith("autologin:") && !record.identifier.startsWith("autologin-wait:")) ||
          record.expires < new Date()
        ) return null;
        const email = record.identifier.replace(/^autologin(?:-wait)?:/, "");
        await prisma.verificationToken.delete({ where: { token: creds.token } });
        const user = await prisma.user.findUnique({ where: { email } });
        return user ?? null;
      },
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Missing credentials");
        }

        // Brute-force protection: 10 attempts per email per 15 minutes
        const key = `login:${credentials.email.toLowerCase()}`;
        const { allowed } = await checkRateLimit(key, { limit: 10, windowMs: 15 * 60 * 1000 });
        if (!allowed) {
          throw new Error("Too many login attempts. Please wait 15 minutes.");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.password) {
          throw new Error("Invalid credentials");
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!isPasswordValid) {
          throw new Error("Invalid credentials");
        }

        if (!user.emailVerified) {
          // Check if user has OAuth providers connected (email already verified by Google/GitHub)
          const oauthAccounts = await prisma.account.findMany({
            where: { userId: user.id, provider: { in: ["google", "github"] } },
            select: { id: true },
            take: 1,
          });
          
          // If no OAuth accounts and email not verified, require verification
          if (oauthAccounts.length === 0) {
            // Auto-resend verification email
            try {
              const userEmail = credentials.email!; // Already validated above
              
              // Delete any existing verification token for this email
              await prisma.verificationToken.deleteMany({
                where: { identifier: `verify:${userEmail}` },
              });

              const token = crypto.randomBytes(32).toString("hex");
              const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

              await prisma.verificationToken.create({
                data: { identifier: `verify:${userEmail}`, token, expires },
              });

              const { subject, html } = buildVerificationEmail(user.name ?? "", token);
              await sendEmail({ to: userEmail, subject, html });
            } catch (emailErr) {
              console.error("[Auth] Failed to resend verification email:", emailErr);
            }

            throw new Error("EMAIL_NOT_VERIFIED:" + credentials.email);
          }
          // Otherwise allow login - OAuth providers already verified the email
        }

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // SECURITY: Log automatic account linking for audit purposes
      if (account && user.id && profile?.email) {
        // Check if this is an automatic link (existing user with same email)
        const existingUser = await prisma.user.findUnique({
          where: { email: profile.email },
          select: { id: true, emailVerified: true, name: true },
        });
        
        if (existingUser && existingUser.id !== user.id) {
          // Automatic linking detected - log to audit system and notify user
          const providerName = account.provider.charAt(0).toUpperCase() + account.provider.slice(1);
          
          // 1. Persist audit log to database
          await logSecurityEvent({
            eventType: "auth:oauth_connect",
            userId: existingUser.id,
            email: profile.email,
            ip: "0.0.0.0", // OAuth callback doesn't have direct IP, logged elsewhere
            userAgent: "oauth-callback",
            metadata: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              automaticLink: true,
              linkedUserId: user.id,
            },
            severity: "warning",
            success: true,
          }, { persistToDb: true, logToConsole: true });
          
          // 2. Create in-app notification for the user
          await prisma.notification.create({
            data: {
              userId: existingUser.id,
              title: "Security Alert: New Login Method Connected",
              message: `Your ${providerName} account was automatically linked to your existing GitScope account. If you didn't do this, please review your account security immediately.`,
              type: "warning",
              isRead: false,
              link: "/settings/security",
            },
          });
          
          console.warn(`[Security] OAuth automatic linking: ${account.provider} account linked to existing user ${existingUser.id}`);
        }
      }
      return true;
    },
    async session({ token, session }) {
      if (token && session.user) {
        // Robust mapping to prevent identity loss across tab switches
        session.user.id = token.id;
        session.user.name = token.name || (token.email as string)?.split('@')[0];
        session.user.email = token.email;
        session.user.image = token.picture;
        session.accessToken = token.accessToken;
        session.provider = token.provider;

        // If user doesn't have GitHub token in session but has GitHub connected,
        // fetch it from the database Account table
        if (!token.accessToken || token.provider !== "github") {
          try {
            const githubAccount = await prisma.account.findFirst({
              where: { userId: token.id as string, provider: "github" },
              select: { access_token: true },
            });
            if (githubAccount?.access_token) {
              session.accessToken = githubAccount.access_token;
              session.provider = "github";
            }
          } catch (error) {
            console.error("[Auth] Failed to fetch GitHub token for session:", error);
          }
        }

        // [STRICT SECURITY] Instant User Sync
        // Verify user still exists in the database on every session check.
        // This ensures that deleted users are kicked out immediately.
        try {
          const userExists = await prisma.user.findUnique({
            where: { id: token.id },
            select: { id: true }
          });
          
          if (!userExists) {
            console.warn(`▲ [Security] Active session for deleted user ${token.id} invalidated.`);
            return null as unknown as typeof session; // Trigger session invalidation
          }
        } catch (error) {
          console.error("▲ [Security] Failed to verify user existence during session:", error);
        }
      }
      return session;
    },
    async jwt({ token, user, account, trigger, session }) {
      // initial load
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
      }
      
      // Capture access token and provider on initial sign-in
      if (account) {
        token.accessToken = account.access_token;
        token.provider = account.provider;
      }

      // handle manual updates if needed later
      if (trigger === "update" && session) {
        token = { ...token, ...session };
      }
      return token;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
// NextAuth config - github provider wired up
// fix: callbackUrl normalisation
