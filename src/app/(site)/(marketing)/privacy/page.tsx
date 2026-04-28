import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy — GitScope",
  description:
    "GitScope's privacy policy: what data we collect, how we use it, how long we keep it, and your rights as a user.",
};

interface Section {
  id: string;
  heading: string;
  content: React.ReactNode;
}

export default function PrivacyPage() {
  const sections: Section[] = [
    {
      id: "what-we-collect",
      heading: "1. What We Collect",
      content: (
        <>
          <p>
            When you sign in with GitHub OAuth or email/password, we receive and store your{" "}
            <strong className="text-white">email address</strong>, display name, and OAuth access
            token. The access token is used exclusively during your active session to query the
            GitHub API on your behalf; we do not persist it to our database after the session ends.
          </p>
          <p className="mt-3">
            As you use GitScope we also collect:
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "Repository search queries and the GitHub repository IDs you view or track.",
              "Usage data such as page visits, feature interactions, and dashboard configurations — collected in aggregate to improve the product.",
              "Session identifiers stored in a secure, HTTP-only cookie for authentication purposes.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-stone-400">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3">
            We do <strong className="text-white">not</strong> store your source code, file contents,
            or any private repository data beyond the metadata (commit counts, contributor lists,
            language breakdowns) returned by GitHub&apos;s REST and GraphQL APIs.
          </p>
        </>
      ),
    },
    {
      id: "how-we-use-it",
      heading: "2. How We Use It",
      content: (
        <>
          <p>
            The data we collect is used for the following purposes, and no others:
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "Authenticating your account and maintaining a secure session.",
              "Fetching and displaying GitHub repository analytics on your dashboard.",
              "Generating AI-powered summaries and risk predictions using the Anthropic Claude API — only repository metadata, never source code, is sent to Anthropic.",
              "Sending transactional emails (account confirmation, billing receipts, password reset) — we do not send marketing email without explicit opt-in.",
              "Detecting abuse and enforcing our Terms of Service.",
              "Improving GitScope through aggregated, anonymised product analytics.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-stone-400">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                {item}
              </li>
            ))}
          </ul>
        </>
      ),
    },
    {
      id: "data-storage",
      heading: "3. Data Storage",
      content: (
        <p>
          Your account data and repository metadata are stored in a{" "}
          <strong className="text-white">Neon PostgreSQL</strong> database hosted in the United
          States (AWS us-east-1). Neon encrypts data at rest using AES-256 and in transit using
          TLS 1.3. Database credentials are rotated regularly and never exposed in client-side
          code. Backups are taken daily and retained for 30 days, encrypted with the same
          standards as primary storage.
        </p>
      ),
    },
    {
      id: "third-parties",
      heading: "4. Third Parties",
      content: (
        <>
          <p>
            We share data with the following third-party services, and only to the extent necessary
            to operate GitScope:
          </p>
          <div className="mt-4 space-y-4">
            {[
              {
                name: "GitHub API",
                detail:
                  "Your OAuth token is used to query GitHub on your behalf. GitHub's own privacy policy governs data held on their platform.",
              },
              {
                name: "AI Providers (Anthropic, OpenAI, Gemini, Groq, etc.)",
                detail:
                  "Repository metadata (names, commit summaries, language stats) may be sent to AI providers to power AI-generated insights. No source code is included. Providers do not train on API inputs by default. When you supply your own BYOK key, your data goes directly to your chosen provider under your own account.",
              },
              {
                name: "Vercel",
                detail:
                  "GitScope is hosted on Vercel. Edge logs may temporarily contain IP addresses for abuse detection, subject to Vercel's data processing agreement.",
              },
            ].map((tp) => (
              <div key={tp.name} className="rounded-none border border-white/5 bg-stone-900/40 p-4">
                <p className="mb-1 text-sm font-semibold text-white">{tp.name}</p>
                <p className="text-sm text-stone-400">{tp.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-stone-400">
            We do not sell your data to third parties, and we do not use your data for advertising.
          </p>
        </>
      ),
    },
    {
      id: "data-retention",
      heading: "5. Data Retention",
      content: (
        <>
          <p>
            We retain your account data and associated repository search history for as long as your
            account is active. If you delete your account, all personally identifiable data —
            including your email, OAuth tokens, tracked repository list, and search history — is
            permanently deleted within <strong className="text-white">30 days</strong>. Anonymised,
            aggregated analytics (e.g., total daily active users) are retained indefinitely as
            they cannot be linked back to you.
          </p>
        </>
      ),
    },
    {
      id: "user-rights",
      heading: "6. Your Rights",
      content: (
        <>
          <p>
            Depending on your jurisdiction, you may have the right to access, correct, delete, or
            export personal data we hold about you. Specifically:
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "Access: request a copy of the personal data associated with your account.",
              "Correction: update your display name or email address in Account Settings.",
              "Deletion: delete your account from Account Settings → Danger Zone. This initiates permanent data removal within 30 days.",
              "Export: request a JSON export of your account data and search history by emailing acnotros2@gmail.com.",
              "Objection: opt out of aggregated product analytics by emailing acnotros2@gmail.com.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-stone-400">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-stone-400">
            We will respond to verified requests within 30 days. If you are in the EU or UK you
            also have the right to lodge a complaint with your local supervisory authority.
          </p>
        </>
      ),
    },
    {
      id: "cookies",
      heading: "7. Cookies",
      content: (
        <>
          <p>
            GitScope uses a single secure, HTTP-only session cookie to keep you logged in. This
            cookie contains only a session identifier — no personal data. It expires when you sign
            out, or after 30 days of inactivity.
          </p>
          <p className="mt-3">
            We do <strong className="text-white">not</strong> use advertising cookies, tracking
            pixels, or third-party analytics cookies. We do not participate in cross-site tracking.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      heading: "8. Contact",
      content: (
        <p>
          For privacy questions, data requests, or concerns, email us at{" "}
          <Link
            href="mailto:acnotros2@gmail.com"
            className="font-semibold text-amber-400 hover:text-amber-300 hover:underline"
          >
            acnotros2@gmail.com
          </Link>
          . We aim to respond within 5 business days.
        </p>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-amber-400">
          <ShieldCheck className="size-3" />
          Legal
        </div>
        <h1 className="font-heading text-4xl font-black tracking-tight text-white sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-stone-500">Last updated: April 28, 2026</p>
        <p className="mt-4 max-w-2xl text-base text-stone-400">
          GitScope is built on the principle that your data exists to serve you — not our
          ad network, not third-party data brokers. This policy explains plainly what we
          collect, why, and what you can do about it.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* Sticky sidebar nav */}
        <nav className="hidden lg:block">
          <div className="sticky top-24 space-y-1 rounded-none border border-white/5 bg-[#171512]/90 p-4 backdrop-blur-xl">
            <p className="mb-3 px-2 text-[10px] font-bold uppercase tracking-widest text-stone-500">
              Sections
            </p>
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block rounded-none px-3 py-2 text-xs text-stone-400 transition hover:bg-white/5 hover:text-white"
              >
                {s.heading}
              </a>
            ))}
          </div>
        </nav>

        {/* Content */}
        <div className="space-y-10">
          {sections.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className="scroll-mt-24 rounded-none border border-white/5 bg-[#171512]/90 p-7 backdrop-blur-xl"
            >
              <h2 className="mb-4 font-heading text-lg font-black text-white">{s.heading}</h2>
              <div className="text-sm leading-relaxed text-stone-400">{s.content}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
