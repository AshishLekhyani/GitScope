const GITHUB_API = "https://api.github.com";

function defaultAllowEnvFallback(): boolean {
  return process.env.GITHUB_SHARED_FALLBACK === "1" || process.env.GITHUB_SHARED_FALLBACK === "true";
}

export function getGithubHeaders(
  userToken?: string | null,
  options?: { allowEnvFallback?: boolean }
): HeadersInit {
  const { allowEnvFallback = defaultAllowEnvFallback() } = options ?? {};
  const token =
    userToken ??
    (allowEnvFallback
      ? process.env.GITHUB_TOKEN ?? process.env.NEXT_PUBLIC_GITHUB_TOKEN
      : null);

  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function githubFetch<T>(
  path: string,
  init?: RequestInit & { userToken?: string | null; allowEnvFallback?: boolean }
): Promise<{ data: T; rateLimitRemaining?: string }> {
  const { userToken, allowEnvFallback, ...fetchInit } = init ?? {};
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...fetchInit,
    headers: {
      ...getGithubHeaders(userToken, { allowEnvFallback }),
      ...fetchInit?.headers,
    },
    next: { revalidate: 60 },
  });

  const rateLimitRemaining = res.headers.get("x-ratelimit-remaining") ?? undefined;

  if (res.status === 202) {
    return { data: [] as unknown as T, rateLimitRemaining };
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(
      res.status === 404
        ? "Resource not found"
        : res.status === 403
          ? "GitHub API rate limit or forbidden. Add GITHUB_TOKEN for higher limits."
          : `GitHub API error: ${res.status}`
    ) as Error & { status?: number; body?: string };
    err.status = res.status;
    err.body = text;
    throw err;
  }

  const data = (await res.json()) as T;
  return { data, rateLimitRemaining };
}
