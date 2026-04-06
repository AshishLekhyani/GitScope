const GITHUB_API = "https://api.github.com";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function defaultAllowEnvFallback(): boolean {
  return process.env.GITHUB_SHARED_FALLBACK === "1" || process.env.GITHUB_SHARED_FALLBACK === "true";
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (5xx server errors or network issues)
 */
function isRetryableError(status: number): boolean {
  // Retry on 5xx server errors, 429 rate limit (with retry-after handled separately), and 502/503/504 gateway errors
  return status >= 500 && status < 600;
}

export function getGithubHeaders(
  userToken?: string | null,
  options?: { allowEnvFallback?: boolean }
): HeadersInit {
  const { allowEnvFallback = defaultAllowEnvFallback() } = options ?? {};
  const token =
    userToken ??
    (allowEnvFallback
      ? process.env.GITHUB_TOKEN
      : null);

  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function githubFetch<T>(
  path: string,
  init?: RequestInit & { userToken?: string | null; allowEnvFallback?: boolean; retries?: number }
): Promise<{ data: T; rateLimitRemaining?: string }> {
  const { userToken, allowEnvFallback, retries = MAX_RETRIES, ...fetchInit } = init ?? {};
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
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
        
        // Check if error is retryable and we have retries left
        if (isRetryableError(res.status) && attempt < retries) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt); // Exponential backoff
          if (process.env.NODE_ENV !== "production") {
            console.warn(`[GitHub API] Retrying ${path} after ${delay}ms (attempt ${attempt + 1}/${retries + 1}, status ${res.status})`);
          }
          await sleep(delay);
          continue;
        }
        
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
    } catch (error) {
      lastError = error as Error;
      
      // Network errors or timeouts - retry if we have attempts left
      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[GitHub API] Network error, retrying ${path} after ${delay}ms (attempt ${attempt + 1}/${retries + 1})`);
        }
        await sleep(delay);
        continue;
      }
    }
  }
  
  // All retries exhausted
  throw lastError ?? new Error(`Failed to fetch ${path} after ${retries + 1} attempts`);
}
