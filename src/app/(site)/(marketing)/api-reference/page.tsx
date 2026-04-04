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
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-400">
          <Code2 className="size-3" />
          Developer API
        </div>
        <h1 className="font-heading text-4xl font-bold tracking-tight text-foreground sm:text-5xl">API Reference</h1>
        <p className="mt-4 text-xl text-muted-foreground">Integrate GitHub analytics into your workflows with the GitScope REST API.</p>
      </div>

      <div className="grid gap-12 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-12">
          <section>
            <h2 className="mb-4 text-2xl font-bold text-foreground">Authentication</h2>
            <p className="mb-6 text-sm text-muted-foreground leading-relaxed">
              All API requests must include a valid session cookie from NextAuth.js. 
              The API uses the same authentication as the web interface — there are no separate API tokens.
              All requests must be made over HTTPS.
            </p>
            <div className="rounded-xl border border-white/5 bg-[#0b1326] p-4 font-mono text-xs text-indigo-300">
              <div className="flex items-center gap-2 text-slate-400 mb-2">
                <Shield className="size-3" />
                <span>Session-based authentication (automatic with browser cookies)</span>
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
              <EndpointCard
                method="POST"
                path="/api/ai/analyze"
                description="AI-powered repository analysis via Claude"
                requiresCsrf
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
    POST: "bg-indigo-500/20 text-indigo-400",
    PUT: "bg-amber-500/20 text-amber-400",
    PATCH: "bg-amber-500/20 text-amber-400",
    DELETE: "bg-rose-500/20 text-rose-400",
  };

  return (
    <div className="rounded-xl border border-white/5 bg-surface-container p-6">
      <div className="mb-2 flex items-center gap-3">
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${methodColors[method] || "bg-slate-500/20 text-slate-400"}`}>
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
        <div className="mt-3 rounded-lg bg-[#0b1326] p-2 font-mono text-[10px] text-slate-400">
          {example}
        </div>
      )}
    </div>
  );
}

function RateLimitCard() {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#171f33]/80 p-6 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="size-4 text-indigo-400" />
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
      <p className="mt-4 text-[10px] text-slate-500">
        Rate limits are per IP for guests, per token for authenticated users.
      </p>
    </div>
  );
}

function SecurityCard() {
  return (
    <div className="rounded-2xl border border-indigo-500/10 bg-indigo-500/5 p-6 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <AlertCircle className="size-4 text-indigo-400" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-400">Security</h3>
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
    <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-6 backdrop-blur-xl">
      <h3 className="text-sm font-bold text-indigo-300 mb-4">Coming Soon</h3>
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
      <p className="mt-4 text-[10px] text-slate-500">
        Official SDKs are planned for future release. For now, use the REST API directly.
      </p>
    </div>
  );
}
