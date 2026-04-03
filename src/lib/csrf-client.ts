"use client";

import { useState, useEffect } from "react";

/**
 * Client-side CSRF Token Helper
 * Use this for all POST/PUT/PATCH/DELETE requests
 */

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

/**
 * Get a CSRF token from the server
 * Tokens are cached for 5 minutes
 * NOTE: Uses /api/csrf (not /api/auth/csrf to avoid NextAuth conflicts)
 */
export async function getCsrfToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  // Fetch new token from /api/csrf (not /api/auth/csrf)
  const res = await fetch("/api/csrf");

  if (!res.ok) {
    throw new Error("Failed to get CSRF token");
  }

  const data = await res.json();
  cachedToken = data.csrfToken;
  tokenExpiry = Date.now() + 5 * 60 * 1000; // Cache for 5 minutes

  if (!cachedToken) {
    throw new Error("Invalid CSRF token response");
  }

  return cachedToken;
}

/**
 * Clear the cached CSRF token
 * Call this after logout or if you get CSRF errors
 */
export function clearCsrfToken(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

/**
 * Fetch wrapper that automatically adds CSRF token
 * Use this instead of regular fetch for POST/PUT/PATCH/DELETE
 * NOTE: Fetches token from /api/csrf (not /api/auth/csrf to avoid NextAuth conflicts)
 */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Only add CSRF token for state-changing methods
  const method = options.method?.toUpperCase() || "GET";
  const needsCsrf = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  if (!needsCsrf) {
    return fetch(url, options);
  }

  try {
    const token = await getCsrfToken();

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        "X-CSRF-Token": token,
      },
    });
  } catch (error) {
    console.error("CSRF token error:", error);
    throw error;
  }
}

/**
 * React hook for CSRF token
 * Use in components that need the token
 */
export function useCsrfToken() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    getCsrfToken()
      .then(setToken)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { token, loading, error, refresh: () => clearCsrfToken() };
}
