import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Service — GitScope",
  description:
    "GitScope's Terms of Service: your rights and responsibilities when using the platform.",
};

interface Section {
  id: string;
  heading: string;
  content: React.ReactNode;
}

export default function TermsPage() {
  const sections: Section[] = [
    {
      id: "acceptance",
      heading: "1. Acceptance of Terms",
      content: (
        <p>
          By accessing or using GitScope (the &ldquo;Service&rdquo;), you agree to be bound by
          these Terms of Service (&ldquo;Terms&rdquo;) and our{" "}
          <Link href="/privacy" className="text-indigo-400 hover:underline">
            Privacy Policy
          </Link>
          . If you do not agree, do not use the Service. If you are using GitScope on behalf of a
          company or other legal entity, you represent that you have the authority to bind that
          entity to these Terms, and in such case &ldquo;you&rdquo; refers to that entity. These
          Terms form a binding legal agreement between you and GitScope (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;, or &ldquo;our&rdquo;).
        </p>
      ),
    },
    {
      id: "service",
      heading: "2. Description of Service",
      content: (
        <>
          <p>
            GitScope is a GitHub analytics platform that connects to the GitHub API via OAuth to
            provide repository metrics, contributor insights, dependency analysis, AI-generated
            summaries, and related engineering intelligence tools. The Service is provided on a
            subscription basis with Free, Pro, and Enterprise tiers, each carrying different
            feature limits described on our{" "}
            <Link href="/pricing" className="text-indigo-400 hover:underline">
              Pricing page
            </Link>
            .
          </p>
          <p className="mt-3">
            We reserve the right to modify, suspend, or discontinue any part of the Service at
            any time, with reasonable notice where possible. We are not liable to you or any
            third party for any modification, suspension, or discontinuation.
          </p>
        </>
      ),
    },
    {
      id: "accounts",
      heading: "3. User Accounts",
      content: (
        <>
          <p>
            You must create an account to access most features of GitScope. You are responsible
            for maintaining the confidentiality of your credentials and for all activity that
            occurs under your account. You agree to:
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "Provide accurate and complete information when creating your account.",
              "Promptly update your information if it changes.",
              "Notify us immediately at security@gitscope.dev if you suspect unauthorised access to your account.",
              "Not share your account credentials with any third party.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-400" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3">
            We may suspend or terminate accounts that show signs of compromise, abuse, or
            violation of these Terms.
          </p>
        </>
      ),
    },
    {
      id: "acceptable-use",
      heading: "4. Acceptable Use",
      content: (
        <>
          <p>
            You may use GitScope only for lawful purposes and in accordance with these Terms. You
            agree <strong className="text-white">not</strong> to:
          </p>
          <ul className="mt-3 space-y-2">
            {[
              "Abuse or circumvent GitHub API rate limits, or use GitScope in a manner that causes excessive load on GitHub's infrastructure.",
              "Use data retrieved through GitScope for commercial resale, bulk data harvesting, or the construction of competing datasets without our written consent.",
              "Attempt to probe, scan, or test the vulnerability of the GitScope platform or any related system, or breach security or authentication measures.",
              "Access, tamper with, or use non-public areas of GitScope or our infrastructure.",
              "Transmit any malware, ransomware, or other destructive code through or to the Service.",
              "Impersonate any person or entity, or misrepresent your affiliation with any person or entity.",
              "Use the Service in any way that violates applicable law, including data protection laws such as GDPR or CCPA.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-400" />
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-3">
            Violation of these rules may result in immediate account suspension and, where
            warranted, referral to law enforcement.
          </p>
        </>
      ),
    },
    {
      id: "ip",
      heading: "5. Intellectual Property",
      content: (
        <>
          <p>
            The GitScope platform, including its software, design, trademarks, and all content
            created by us, is owned by GitScope and protected by copyright, trademark, and other
            intellectual property laws. These Terms do not transfer any ownership to you.
          </p>
          <p className="mt-3">
            You retain full ownership of your source code and any data you bring to the Service.
            By connecting your GitHub account you grant GitScope a limited, revocable licence to
            access your GitHub data solely to provide the Service features you use. This licence
            ends when you disconnect your GitHub account or delete your GitScope account.
          </p>
        </>
      ),
    },
    {
      id: "warranties",
      heading: "6. Disclaimer of Warranties",
      content: (
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT
          WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF
          MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do not
          warrant that the Service will be uninterrupted, error-free, or free of viruses or other
          harmful components. Analytics and AI-generated content are provided for informational
          purposes only and should not be relied upon as professional advice.
        </p>
      ),
    },
    {
      id: "liability",
      heading: "7. Limitation of Liability",
      content: (
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, GITSCOPE AND ITS OFFICERS,
          DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
          SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES — INCLUDING LOSS OF PROFITS, DATA, GOODWILL,
          OR BUSINESS INTERRUPTION — ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE, EVEN
          IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL CUMULATIVE
          LIABILITY TO YOU FOR ANY CLAIMS ARISING FROM THESE TERMS OR THE SERVICE SHALL NOT
          EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM
          AROSE, OR (B) USD $100.
        </p>
      ),
    },
    {
      id: "termination",
      heading: "8. Termination",
      content: (
        <>
          <p>
            You may delete your account at any time from Account Settings. We may suspend or
            terminate your access to the Service immediately, without notice or liability, if we
            believe you have violated these Terms, applicable law, or if required by a legal
            authority. Upon termination, your right to use the Service ceases immediately. Sections
            5, 6, 7, 9, and 10 survive termination.
          </p>
        </>
      ),
    },
    {
      id: "governing-law",
      heading: "9. Governing Law",
      content: (
        <p>
          These Terms are governed by and construed in accordance with the laws of the State of
          Delaware, United States, without regard to its conflict-of-law provisions. Any disputes
          arising from these Terms or the Service shall be resolved exclusively in the state or
          federal courts located in Delaware, and you consent to personal jurisdiction in those
          courts.
        </p>
      ),
    },
    {
      id: "changes",
      heading: "10. Changes to Terms",
      content: (
        <p>
          We may update these Terms from time to time. When we do, we will revise the &ldquo;Last
          updated&rdquo; date at the top of this page and, for material changes, send an email
          notice to your registered address at least 14 days before the changes take effect. Your
          continued use of the Service after the effective date constitutes acceptance of the
          revised Terms. If you do not agree with a change, you must stop using the Service and
          may delete your account before the change takes effect.
        </p>
      ),
    },
    {
      id: "contact",
      heading: "11. Contact",
      content: (
        <p>
          Questions about these Terms should be directed to{" "}
          <Link
            href="mailto:legal@gitscope.dev"
            className="font-semibold text-indigo-400 hover:text-indigo-300 hover:underline"
          >
            legal@gitscope.dev
          </Link>
          .
        </p>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-400">
          <Scale className="size-3" />
          Legal
        </div>
        <h1 className="font-heading text-4xl font-black tracking-tight text-white sm:text-5xl">
          Terms of Service
        </h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: April 1, 2026</p>
        <p className="mt-4 max-w-2xl text-base text-slate-400">
          Please read these terms carefully before using GitScope. By creating an account or
          accessing the Service you agree to be bound by them.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* Sticky sidebar nav */}
        <nav className="hidden lg:block">
          <div className="sticky top-24 space-y-1 rounded-2xl border border-white/5 bg-[#171f33]/80 p-4 backdrop-blur-xl">
            <p className="mb-3 px-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Sections
            </p>
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block rounded-lg px-3 py-2 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white"
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
              className="scroll-mt-24 rounded-2xl border border-white/5 bg-[#171f33]/80 p-7 backdrop-blur-xl"
            >
              <h2 className="mb-4 font-heading text-lg font-black text-white">{s.heading}</h2>
              <div className="text-sm leading-relaxed text-slate-400">{s.content}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
