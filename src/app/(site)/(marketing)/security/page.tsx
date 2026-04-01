import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck,
  Lock,
  Eye,
  Key,
  AlertTriangle,
  Mail,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Security — GitScope",
  description:
    "GitScope's security practices, responsible disclosure program, and how to report vulnerabilities.",
};

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="mb-14 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-400">
          <ShieldCheck className="size-3" />
          Security
        </div>
        <h1 className="font-heading text-4xl font-black tracking-tight text-white sm:text-5xl">
          Security at GitScope
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-400">
          We take the security of your data and your GitHub access seriously. Here is how we
          protect the platform and what to do if you find a problem.
        </p>
      </div>

      {/* Practices grid */}
      <section className="mb-14">
        <h2 className="mb-6 font-heading text-xl font-black text-white">Our Security Practices</h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: <Lock className="size-5 text-indigo-400" />,
              title: "HTTPS Only",
              body: "All traffic is served exclusively over HTTPS with HSTS enforced. HTTP requests are redirected automatically. We use TLS 1.3 with perfect forward secrecy on all endpoints.",
            },
            {
              icon: <Key className="size-5 text-emerald-400" />,
              title: "OAuth 2.0 Authentication",
              body: "We authenticate users via GitHub and Google OAuth 2.0. GitScope never handles or stores passwords for OAuth accounts. Sessions are managed with secure, HTTP-only, SameSite=Strict cookies.",
            },
            {
              icon: <Eye className="size-5 text-amber-400" />,
              title: "No GitHub Tokens Server-Side",
              body: "GitHub OAuth access tokens are used only during the active request to query the GitHub API. They are not written to our database. Once your session ends the token is no longer accessible to us.",
            },
            {
              icon: <ShieldCheck className="size-5 text-blue-400" />,
              title: "Encrypted Database",
              body: "User data is stored in Neon PostgreSQL with AES-256 encryption at rest. Database credentials are rotated regularly, stored in environment secrets, and never shipped in client-side code.",
            },
            {
              icon: <AlertTriangle className="size-5 text-rose-400" />,
              title: "Rate Limiting & Abuse Detection",
              body: "All API routes are rate-limited at the edge. Repeated failed authentication attempts trigger temporary lockouts. Suspicious patterns are flagged for manual review.",
            },
            {
              icon: <CheckCircle2 className="size-5 text-purple-400" />,
              title: "Dependency Scanning",
              body: "We run automated dependency audits on every pull request using GitHub's Dependabot and npm audit. Critical vulnerabilities block merges until resolved.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-white/5 bg-[#171f33]/80 p-6 backdrop-blur-xl"
            >
              <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-slate-800/80">
                {item.icon}
              </div>
              <h3 className="mb-2 text-sm font-bold text-white">{item.title}</h3>
              <p className="text-xs leading-relaxed text-slate-400">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* What we do / don't store */}
      <section className="mb-14">
        <h2 className="mb-6 font-heading text-xl font-black text-white">What We Store vs. What We Don&apos;t</h2>
        <div className="rounded-2xl border border-white/5 bg-[#171f33]/80 p-7 backdrop-blur-xl">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="mb-4 flex items-center gap-2 text-sm font-bold text-emerald-400">
                <CheckCircle2 className="size-4" />
                We store
              </div>
              <ul className="space-y-2">
                {[
                  "Your email address and display name",
                  "Your GitHub / Google OAuth provider ID",
                  "Repository metadata: names, star counts, language stats, commit frequency",
                  "Your tracked repository list and dashboard preferences",
                  "Session identifiers (in a secure cookie, not our DB)",
                  "Stripe customer ID and subscription status",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500/60" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-4 flex items-center gap-2 text-sm font-bold text-rose-400">
                <XCircle className="size-4" />
                We never store
              </div>
              <ul className="space-y-2">
                {[
                  "Your source code or file contents",
                  "GitHub OAuth access tokens after the request completes",
                  "Your GitHub or Google password (we never see it)",
                  "Raw payment card numbers (Stripe handles all card data)",
                  "Private repository contents beyond metadata",
                  "Your commit diffs or pull request bodies",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-rose-500/60" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Responsible disclosure */}
      <section className="mb-14">
        <h2 className="mb-6 font-heading text-xl font-black text-white">
          Responsible Disclosure
        </h2>
        <div className="rounded-2xl border border-indigo-500/20 bg-indigo-600/5 p-7 backdrop-blur-xl">
          <p className="mb-5 text-sm leading-relaxed text-slate-300">
            We welcome security researchers who act in good faith to help us keep GitScope safe. If
            you discover a vulnerability, please disclose it responsibly using the process below
            rather than exploiting it or publishing it publicly before we have had a chance to
            address it.
          </p>

          <h3 className="mb-3 text-sm font-bold text-white">How to Report</h3>
          <ol className="mb-6 space-y-3">
            {[
              "Email a description of the vulnerability to security@gitscope.dev. Include the affected URL or endpoint, steps to reproduce, and the potential impact.",
              "Encrypt your report if it contains sensitive details — our PGP public key is available on request.",
              "We will acknowledge receipt within 2 business days and aim to provide an initial assessment within 7 days.",
              "We will keep you informed of our progress and notify you when the issue is resolved.",
              "Please do not access or modify data belonging to other users, and do not perform denial-of-service testing.",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-slate-400">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-[10px] font-bold text-indigo-400">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>

          <Link
            href="mailto:security@gitscope.dev"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500"
          >
            <Mail className="size-4" />
            security@gitscope.dev
          </Link>
        </div>
      </section>

      {/* Bug bounty */}
      <section className="mb-14">
        <h2 className="mb-6 font-heading text-xl font-black text-white">Bug Bounty</h2>
        <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-7 backdrop-blur-xl">
          <p className="text-sm leading-relaxed text-slate-400">
            GitScope does not currently run a formal paid bug bounty programme. However, we
            genuinely appreciate the time and effort researchers invest in responsible disclosure.
            Valid vulnerability reports that lead to a security fix will receive public
            acknowledgement in our{" "}
            <Link href="/changelog" className="text-indigo-400 hover:underline">
              Changelog
            </Link>{" "}
            (if desired) and a personal thank-you from the team. We intend to launch a formal
            bounty programme as the platform matures — we will announce this here and in the
            changelog when it is live.
          </p>
        </div>
      </section>

      {/* Scope */}
      <section>
        <h2 className="mb-6 font-heading text-xl font-black text-white">In Scope / Out of Scope</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/5 bg-[#171f33]/80 p-6 backdrop-blur-xl">
            <p className="mb-4 text-sm font-bold text-emerald-400">In scope</p>
            <ul className="space-y-2">
              {[
                "gitscope.dev and all subdomains",
                "Authentication and session management flaws",
                "Authorisation bypass (accessing another user's data)",
                "Cross-site scripting (XSS) with demonstrated impact",
                "SQL injection or database exposure",
                "Sensitive data exposure via API endpoints",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-emerald-500/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/5 bg-[#171f33]/80 p-6 backdrop-blur-xl">
            <p className="mb-4 text-sm font-bold text-rose-400">Out of scope</p>
            <ul className="space-y-2">
              {[
                "Denial-of-service attacks",
                "Social engineering of GitScope staff",
                "Vulnerabilities in third-party services (GitHub, Stripe, Vercel) — report those directly to them",
                "Missing security headers without demonstrated exploit",
                "Self-XSS or issues requiring physical device access",
                "Rate-limit bypass without demonstrated harm",
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-rose-500/60" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
