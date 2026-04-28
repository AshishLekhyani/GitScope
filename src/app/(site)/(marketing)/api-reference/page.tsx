import { Code2, Server, Globe, Shield, Lock, Clock, AlertCircle } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/constants/routes";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API Reference — GitScope",
  description: "GitScope REST API documentation, authentication, rate limits, and endpoints for repository analytics.",
};

export default function APIPage() {
  return (
    <div className="mx-auto max-w-5xl px-6">
      <div className="mb-16">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-400">
          <Code2 className="size-3" />
          Developer API
        </div>
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">API Reference</h1>
        <p className="mt-4 text-xl text-muted-foreground">Integrate GitHub analytics into your workflows with the GitScope REST API.</p>
      </div>

      <div className="grid gap-12 md:grid-cols-3">
        <div className="lg:col-span-2 space-y-12">
          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Authentication</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              GitScope supports two authentication methods:
            </p>
            <div className="space-y-3">
              <div className="rounded-none border border-white/5 bg-[#100f0d] p-4 font-mono text-xs">
                <div className="flex items-center gap-2 text-stone-400 mb-2">
                  <Shield className="size-3" />
                  <span className="text-amber-300">Session cookies</span>
                  <span>— all dashboard endpoints (automatic with browser)</span>
                </div>
              </div>
              <div className="rounded-none border border-amber-500/20 bg-[#100f0d] p-4 font-mono text-xs">
                <div className="flex items-center gap-2 text-stone-400 mb-2">
                  <Lock className="size-3" />
                  <span className="text-amber-300">API key</span>
                  <span>— <code>/api/v1/</code> endpoints (Developer plan+)</span>
                </div>
                <div className="text-stone-400 space-y-1 mt-2">
                  <div><span className="text-emerald-400">Authorization:</span> Bearer sk_gs_your_key_here</div>
                  <div className="text-stone-600">— or —</div>
                  <div><span className="text-emerald-400">X-API-Key:</span> sk_gs_your_key_here</div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Public Endpoints</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              These endpoints are available to all users, including guests (limited by rate limits):
            </p>
            <div className="space-y-6">
              <EndpointCard
                method="GET"
                path="/api/github/proxy?path={github_api_path}"
                description="Proxy requests to GitHub API with optional user token. Rate limited."
                example="GET /api/github/proxy?path=repos/facebook/react"
              />
              <EndpointCard
                method="GET"
                path="/api/github/rate-limit"
                description="Check current GitHub API rate limit status"
              />
              <EndpointCard
                method="GET"
                path="/api/github/trending"
                description="Get trending repositories by language and time window"
              />
              <EndpointCard
                method="GET"
                path="/api/github/search"
                description="Search GitHub repositories and users"
              />
              <EndpointCard
                method="GET"
                path="/api/csrf"
                description="Get a fresh CSRF token for state-changing requests"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Authenticated Endpoints</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              These endpoints require a valid session (GitHub OAuth or email/password):
            </p>
            <div className="space-y-6">
              <EndpointCard
                method="GET"
                path="/api/user/settings"
                description="Get user profile, connected providers, AI tier, and recent jobs"
              />
              <EndpointCard
                method="GET"
                path="/api/user/history"
                description="Get user's repository search history"
              />
              <EndpointCard
                method="POST"
                path="/api/user/history"
                description="Add a repository to search history"
              />
              <EndpointCard
                method="GET"
                path="/api/user/notifications"
                description="Get user's in-app notifications"
              />
              <EndpointCard
                method="PATCH"
                path="/api/user/account"
                description="Update password or GitHub PAT"
                requiresCsrf
              />
              <EndpointCard
                method="GET"
                path="/api/user/ai-capabilities"
                description="Get AI features available for user's tier"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">AI Endpoints</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              These endpoints require authentication. AI endpoints are gated by plan tier.
            </p>
            <div className="space-y-6">
              <EndpointCard
                method="POST"
                path="/api/ai/repo-scan"
                description="Full AI-powered repo health scan — returns 0–100 health score, findings, and recommendations"
                requiresCsrf
              />
              <EndpointCard
                method="POST"
                path="/api/ai/osv-scan"
                description="Scan a repository against the Google OSV CVE database — returns vulnerabilities with severity and CVSS scores"
                requiresCsrf
              />
              <EndpointCard
                method="POST"
                path="/api/ai/generate-pr-description"
                description="Generate an AI pull request description from diff context with configurable tone"
                requiresCsrf
              />
              <EndpointCard
                method="POST"
                path="/api/ai/generate-readme"
                description="AI-generated README from repository structure and source files"
                requiresCsrf
              />
              <EndpointCard
                method="POST"
                path="/api/ai/generate-changelog"
                description="Generate a changelog from recent commits (keepachangelog | conventional | narrative format)"
                requiresCsrf
              />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">GitHub Data Endpoints</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              Server-side GitHub proxies. All requests use your stored OAuth token automatically — works for private repos.
            </p>
            <div className="space-y-6">
              <EndpointCard
                method="GET"
                path="/api/github/contributors?repo={owner/repo}"
                description="Contributor stats for a repository — commit count, additions, deletions per contributor. Returns 202 if GitHub is still computing stats (retry after 3–5 s)."
              />
              <EndpointCard
                method="GET"
                path="/api/github/ci-runs?repo={owner/repo}"
                description="Most recent 50 GitHub Actions workflow runs for a repository, grouped by workflow name."
              />
              <EndpointCard
                method="GET"
                path="/api/github/coverage?repo={owner/repo}"
                description="Test coverage percentage from Codecov API, detected test frameworks, and config files found in the repository."
              />
              <EndpointCard
                method="GET"
                path="/api/github/coverage/pr?repo={owner/repo}&pr={number}"
                description="PR-level coverage diff — base vs head coverage, delta, status (improved/degraded/unchanged), and per-file breakdown with test file detection. Pulls from Codecov PR comparison API."
              />
              <EndpointCard
                method="GET"
                path="/api/github/open-prs?repo={owner/repo}"
                description="Open pull requests for a repository — title, author, head/base branch, additions, deletions, labels, and PR URL."
              />
              <EndpointCard
                method="GET"
                path="/api/ai/team-scans?org={org-name}"
                description="Aggregated scan history for all repositories in an organization, across all GitScope users. Returns per-repo latest health score, critical count, and scanner identity."
              />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Public REST API (v1)</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              Machine-readable endpoints for CI pipelines and third-party integrations. Authenticate with an API key — generate one in{" "}
              <Link href="/settings?tab=api-keys" className="text-amber-400 hover:underline">Settings → API Keys</Link>.
              Pass the key as <code className="text-xs bg-white/5 px-1 rounded">Authorization: Bearer sk_gs_...</code> or{" "}
              <code className="text-xs bg-white/5 px-1 rounded">X-API-Key</code>.
              Rate limit: 120 req/min per key. Available on Developer plan and above.
            </p>
            <div className="space-y-6">
              <EndpointCard
                method="GET"
                path="/api/v1"
                description="API discovery — returns available endpoints, scopes, and authentication instructions."
              />
              <EndpointCard
                method="GET"
                path="/api/v1/repos/{owner}/{repo}/scan"
                description="Latest scan result for a repository — healthScore, securityScore, qualityScore, criticalCount, summary, and timestamp. Scope: scans:read."
                example='curl -H "Authorization: Bearer sk_gs_..." https://gitscope.dev/api/v1/repos/vercel/next.js/scan'
              />
              <EndpointCard
                method="GET"
                path="/api/v1/repos/{owner}/{repo}/dora"
                description="DORA metrics for a repository — leadTime, deployFreq, cfr, mttr, deploySource (github-deployments | actions-workflows | pr-merges). Scope: dora:read."
                example='curl -H "X-API-Key: sk_gs_..." https://gitscope.dev/api/v1/repos/vercel/next.js/dora'
              />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Public Badge API</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              Embeddable SVG badge — no authentication required:
            </p>
            <div className="space-y-6">
              <EndpointCard
                method="GET"
                path="/api/badge?repo={owner/repo}"
                description="Returns a live SVG health-score badge for any repo. Embed in any README."
                example="![health](https://git-scope-pi.vercel.app/api/badge?repo=vercel/next.js)"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">GitHub OAuth Required</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              These endpoints require GitHub OAuth sign-in specifically:
            </p>
            <div className="space-y-6">
              <EndpointCard
                method="GET"
                path="/api/user/code-impact?repo={owner/repo}"
                description="Get code impact analysis for a repository"
              />
              <EndpointCard
                method="GET"
                path="/api/user/pr-risk?repo={owner/repo}"
                description="Get PR risk analysis and scoring"
              />
              <EndpointCard
                method="GET"
                path="/api/user/dora-metrics?repo={owner/repo}"
                description="Get DORA metrics (deployment frequency, lead time, etc.)"
              />
              <EndpointCard
                method="GET"
                path="/api/user/dependency-map?repo={owner/repo}"
                description="Get dependency analysis and security advisories"
              />
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <RateLimitCard />
          <SecurityCard />
          <SDKCard />
        </div>
      </div>
    </div>
  );
}

function EndpointCard({ 
  method, 
  path, 
  description, 
  example,
  requiresCsrf 
}: { 
  method: string; 
  path: string; 
  description: string;
  example?: string;
  requiresCsrf?: boolean;
}) {
  const methodColors: Record<string, string> = {
    GET: "bg-emerald-500/20 text-emerald-400",
    POST: "bg-amber-500/20 text-amber-400",
    PUT: "bg-amber-500/20 text-amber-400",
    PATCH: "bg-amber-500/20 text-amber-400",
    DELETE: "bg-rose-500/20 text-rose-400",
  };

  return (
    <div className="rounded-none border border-white/5 bg-surface-container p-6">
      <div className="mb-2 flex items-center gap-3">
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${methodColors[method] || "bg-stone-500/20 text-stone-400"}`}>
          {method}
        </span>
        <code className="text-sm font-bold">{path}</code>
        {requiresCsrf && (
          <span className="text-[10px] text-amber-400" title="Requires X-CSRF-Token header">
            <Lock className="size-3 inline" />
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {example && (
        <div className="mt-3 rounded-none bg-[#100f0d] p-2 font-mono text-[10px] text-stone-400">
          {example}
        </div>
      )}
    </div>
  );
}

function RateLimitCard() {
  return (
    <div className="rounded-none border border-white/5 bg-[#171512]/90 p-6 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="size-4 text-amber-400" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Rate Limits</h3>
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Guest (no auth)</span>
          <span className="font-bold text-foreground">60 req/hr</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Authenticated</span>
          <span className="font-bold text-foreground">5,000 req/hr</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">AI Analysis</span>
          <span className="font-bold text-foreground">10 req/min</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Auth Endpoints</span>
          <span className="font-bold text-foreground">5 req/min</span>
        </div>
      </div>
      <p className="mt-4 text-[10px] text-stone-500">
        Rate limits are per IP for guests, per token for authenticated users.
      </p>
    </div>
  );
}

function SecurityCard() {
  return (
    <div className="rounded-none border border-amber-500/10 bg-amber-500/5 p-6 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="size-4 text-amber-400" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400">Security</h3>
      </div>
      <ul className="space-y-2 text-xs text-muted-foreground">
        <li className="flex items-start gap-2">
          <span className="text-emerald-400">✓</span>
          HTTPS required for all requests
        </li>
        <li className="flex items-start gap-2">
          <span className="text-emerald-400">✓</span>
          CSRF tokens for state-changing operations
        </li>
        <li className="flex items-start gap-2">
          <span className="text-emerald-400">✓</span>
          Secure, httpOnly, SameSite=Strict cookies
        </li>
        <li className="flex items-start gap-2">
          <span className="text-emerald-400">✓</span>
          IP-based rate limiting with abuse detection
        </li>
      </ul>
      <div className="mt-4">
        <Link href="/security" className="text-[10px] font-black uppercase tracking-widest text-primary hover:underline">
          View Security Policy
        </Link>
      </div>
    </div>
  );
}

function SDKCard() {
  return (
    <div className="rounded-none border border-white/5 bg-stone-900/40 p-6 backdrop-blur-xl">
      <h3 className="text-sm font-bold text-amber-300 mb-4">Coming Soon</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground opacity-60">
          <Code2 className="size-4" />
          <span>gitscope-js (npm)</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground opacity-60">
          <Server className="size-4" />
          <span>gitscope-go (module)</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground opacity-60">
          <Globe className="size-4" />
          <span>gitscope-python (pip)</span>
        </div>
      </div>
      <p className="mt-4 text-[10px] text-stone-500">
        Official SDKs are planned for future release. For now, use the REST API directly.
      </p>
    </div>
  );
}
