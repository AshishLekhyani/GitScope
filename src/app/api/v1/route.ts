export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

// GET /api/v1 — API discovery
export function GET() {
  return NextResponse.json({
    api: "GitScope Public REST API",
    version: "v1",
    authentication: "Bearer sk_gs_<key> or X-API-Key: sk_gs_<key>",
    scopes: ["repos:read", "scans:read", "scans:write", "coverage:read", "dora:read"],
    endpoints: [
      { method: "GET", path: "/api/v1/repos/{owner}/{repo}/scan", scope: "scans:read", description: "Latest scan result" },
      { method: "GET", path: "/api/v1/repos/{owner}/{repo}/dora", scope: "dora:read",   description: "DORA metrics" },
    ],
    docs: "https://gitscope.dev/api-reference",
    rateLimit: "120 req/min per key",
  });
}
