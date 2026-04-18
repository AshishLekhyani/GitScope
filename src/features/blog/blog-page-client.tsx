"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Clock, BookOpen } from "lucide-react";

interface Post {
  slug: string;
  title: string;
  excerpt: string;
  author: string;
  date: string;
  category: Category;
  readTime: number;
  featured?: boolean;
}

type Category = "All" | "Engineering" | "Open Source" | "Productivity" | "Updates";

const CATEGORIES: Category[] = ["All", "Engineering", "Open Source", "Productivity", "Updates"];

const POSTS: Post[] = [
  {
    slug: "ai-security-scanning-osv",
    title: "AI + OSV: How GitScope Catches CVEs Before They Hit Production",
    excerpt:
      "Static security scanners miss context. GitScope's two-layer approach combines Google's OSV database for known CVEs with an AI layer that understands your codebase's actual exposure — so you see risk, not just a raw vulnerability list. Here is the architecture behind it.",
    author: "GitScope Team",
    date: "April 18, 2026",
    category: "Engineering",
    readTime: 9,
    featured: true,
  },
  {
    slug: "slack-discord-devops-notifications",
    title: "Stop Opening Dashboards: Bring Your Repo Health Into Slack and Discord",
    excerpt:
      "The best alert is the one you actually see. GitScope's Slack and Discord integrations push scan alerts and weekly health digests to wherever your team already lives — without forcing another tool into the workflow. Setup takes 60 seconds.",
    author: "GitScope Team",
    date: "April 16, 2026",
    category: "Updates",
    readTime: 5,
  },
  {
    slug: "dora-metrics-practical-guide",
    title: "DORA Metrics in Practice: What They Actually Tell You About Your Team",
    excerpt:
      "Deployment frequency and change failure rate are easy to measure — but easy to game. We dig into how GitScope surfaces the signal beneath the noise, why raw DORA scores without context mislead, and the three secondary indicators that matter more than the headline numbers.",
    author: "Mara Ellison",
    date: "March 28, 2026",
    category: "Engineering",
    readTime: 11,
  },
  {
    slug: "open-source-health-scorecard",
    title: "Building an Open Source Health Scorecard for Your Dependencies",
    excerpt:
      "Not all popular packages are healthy. GitScope's Dependency Radar scores packages on maintenance cadence, bus factor, issue responsiveness, and breaking-change history. Here is how we built the scoring model and what the data revealed about the most-depended-on JavaScript packages.",
    author: "Jin Park",
    date: "March 14, 2026",
    category: "Open Source",
    readTime: 8,
  },
  {
    slug: "team-velocity-vs-individual-output",
    title: "Team Velocity Is Not the Sum of Individual Output",
    excerpt:
      "Tracking commit counts per engineer is a trap. Real velocity emerges from handoff latency, review throughput, and unblocking patterns. We explain the three GitScope metrics that predict whether a sprint will slip a week before it does.",
    author: "Camille Ng",
    date: "February 22, 2026",
    category: "Productivity",
    readTime: 9,
  },
  {
    slug: "dependency-radar-methodology",
    title: "How We Score 2 Million npm Packages for Production Readiness",
    excerpt:
      "Most dependency scanners only check CVEs. Dependency Radar goes further: download velocity, maintainer bus factor, issue response time, and semantic version compliance. We explain every signal in the scoring model.",
    author: "Jin Park",
    date: "February 3, 2026",
    category: "Engineering",
    readTime: 14,
  },
  {
    slug: "gitscope-launch",
    title: "GitScope Is Now in Public Beta",
    excerpt:
      "After six months of private testing with 40 engineering teams, GitScope is opening up. Here is what we built, what we learned, and what is coming next.",
    author: "GitScope Team",
    date: "December 5, 2025",
    category: "Updates",
    readTime: 5,
  },
];

const CATEGORY_COLORS: Record<Category, string> = {
  All: "bg-muted text-muted-foreground border-border",
  Engineering: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  "Open Source": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  Productivity: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  Updates: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
};

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${CATEGORY_COLORS[category]}`}
    >
      {category}
    </span>
  );
}

export function BlogPageClient() {
  const [active, setActive] = useState<Category>("All");

  const featured = POSTS.find((p) => p.featured)!;
  const rest = POSTS.filter((p) => !p.featured);
  const filtered =
    active === "All" ? rest : rest.filter((p) => p.category === active);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12">
      {/* Header */}
      <div className="mb-12">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-indigo-500">
          <BookOpen className="size-3" />
          Engineer&apos;s Log
        </div>
        <h1 className="font-heading text-4xl font-black tracking-tight text-foreground sm:text-5xl">
          Blog
        </h1>
        <p className="mt-3 max-w-xl text-base text-muted-foreground">
          Deep-dives on engineering analytics, developer productivity, open-source health, and
          how GitScope is built.
        </p>
      </div>

      {/* Featured post */}
      <Link
        href={`/blog/${featured.slug}`}
        className="group mb-10 block rounded-2xl border border-border bg-card p-7 transition hover:border-indigo-500/30 hover:shadow-md sm:p-10"
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-indigo-500">
            Featured
          </span>
          <CategoryBadge category={featured.category} />
        </div>
        <h2 className="mb-3 font-heading text-2xl font-black tracking-tight text-foreground transition group-hover:text-indigo-500 sm:text-3xl">
          {featured.title}
        </h2>
        <p className="mb-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {featured.excerpt}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt={featured.author}
              width={32}
              height={32}
              className="rounded-full bg-muted"
            />
            <div>
              <p className="text-xs font-semibold text-foreground">{featured.author}</p>
              <p className="text-[10px] text-muted-foreground/70">{featured.date}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3" />
              {featured.readTime} min read
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-500 transition group-hover:gap-2.5">
              Read article <ArrowRight className="size-3" />
            </span>
          </div>
        </div>
      </Link>

      {/* Category filter */}
      <div className="mb-8 flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setActive(cat)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-widest transition ${
              active === cat
                ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-500"
                : "border-border bg-transparent text-muted-foreground hover:border-primary/30 hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Post grid */}
      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No posts in this category yet.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition hover:border-indigo-500/30 hover:shadow-md"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <CategoryBadge category={post.category} />
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                  <Clock className="size-3" />
                  {post.readTime} min
                </span>
              </div>
              <h3 className="mb-3 font-heading text-base font-black leading-snug tracking-tight text-foreground transition group-hover:text-indigo-500">
                {post.title}
              </h3>
              <p className="mb-6 grow text-xs leading-relaxed text-muted-foreground">
                {post.excerpt.slice(0, 120)}…
              </p>
              <div className="flex items-center gap-2.5 border-t border-border pt-4">
                <Image
                  src="/logo.png"
                  alt={post.author}
                  width={24}
                  height={24}
                  className="rounded-full bg-muted"
                />
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold text-foreground">{post.author}</p>
                  <p className="text-[10px] text-muted-foreground/60">{post.date}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
