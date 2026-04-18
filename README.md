<div align="center">

<img src="public/logo.png" alt="GitScope Logo" width="80" height="80" />

# GitScope

**GitHub intelligence platform — repo health scoring, AI security scans, PR reviews, contributor analytics, Slack/Discord alerts, and weekly digest emails.**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io)
[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg?style=flat-square)](LICENSE)

[Live Demo](https://git-scope-pi.vercel.app) · [Report a Bug](https://github.com/AshishLekhyani/GitScope/issues) · [Request a Feature](https://github.com/AshishLekhyani/GitScope/issues)

</div>

---

## What is GitScope?

GitScope is a full-stack GitHub analytics and intelligence platform. Search any public repository and instantly get **health scores**, **AI-powered security scans**, **CVE vulnerability reports**, **contributor leaderboards**, **DORA metrics**, and **trending project discovery** — all through a polished, dark-mode-first dashboard.

Beyond browsing, GitScope monitors your repositories continuously: connect Slack or Discord for real-time scan alerts, enable the weekly digest for a Monday-morning health report, and track action items across your entire fleet.

> Built for developers who want to understand a codebase before contributing, engineering managers tracking team velocity, and security-conscious teams who need CVE visibility without leaving their workflow.

---

## Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Variables](#environment-variables)
  - [Database Setup](#database-setup)
- [Usage](#-usage)
  - [Searching a Repository](#searching-a-repository)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Intelligence Hub (AI Scans)](#intelligence-hub-ai-scans)
  - [Slack & Discord Alerts](#slack--discord-alerts)
- [Deployment](#-deployment)
- [Security](#-security)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### Core Analytics
- 🔍 **Global Live Search** — Debounced search across all public repos with instant results
- 📊 **Repository Analytics** — Stars, forks, issues, watchers, commit frequency, language breakdown
- 👥 **Contributor Insights** — Activity heatmaps, commit counts, contributor leaderboards
- 📈 **Commit History** — Visual timeline with author filtering and date ranges
- 🏢 **Organization Pulse** — Team-level analytics aggregating velocity, bus-factor risk, and stale branches
- 🔄 **DORA Metrics** — Deployment frequency, lead time, change failure rate, and MTTR
- ⚖️ **Repo Comparison** — Side-by-side analysis of up to 3 repositories
- 🏆 **Stack Trending** — Real-time trending repos filterable by language (persisted per user)

### Intelligence Hub (AI)
- 🤖 **Repo Health Scan** — AI-powered 0–100 health score covering security, code quality, and maintenance
- 🔒 **OSV CVE Scanner** — Scans against Google's Open Source Vulnerability database with CVSS scores
- 📝 **PR Description Generator** — AI-generated pull request descriptions from diff context
- 📖 **README Generator** — Auto-generated README from repository structure
- 📋 **Changelog Generator** — Conventional commits, Keep-a-Changelog, or narrative format
- 🔎 **Code Review Hub** — AI-powered code review with line-level findings
- ✅ **Action Items** — Save, track, and create GitHub Issues directly from scan findings
- 📅 **Scheduled Scans** — Daily, weekly, or monthly automated re-scans

### Notifications & Integrations
- 💬 **Slack Integration** — Webhook-based scan alerts and weekly digests
- 🎮 **Discord Integration** — Same alerts and digests via Discord embeds
- 📧 **Weekly Digest Email** — Monday-morning fleet health summary
- 🔔 **In-app Notifications** — Real-time GitHub notification feed with unread badge
- 🤝 **GitHub App** — Install for automatic PR reviews and webhook-triggered scans

### Developer Experience
- ⌨️ **Keyboard-Native** — Full shortcut palette (⌘K, G+O, G+E, F for fullscreen, T for theme)
- 🎯 **7-step Onboarding** — Guided first-run tour with per-feature tips
- 📡 **API Rate Limit Monitor** — Live GitHub quota tracker in sidebar
- 🏅 **Health Badge API** — Embed a live health-score badge: `![health](https://git-scope-pi.vercel.app/api/badge?repo=owner/repo)`
- 🌙 **Dark Mode First** — System-aware theming with localStorage persistence

### Security & Auth
- 🔐 **Multi-Provider Auth** — GitHub OAuth, Google OAuth, or email/password with verification
- 🛡️ **CSRF Protection** — Double Submit Cookie with HMAC-SHA256, `__Host-` prefix
- 🚦 **Rate Limiting** — IP-based with exponential backoff for abusive clients
- 🔑 **Token Encryption** — AES-256-GCM for stored GitHub PATs

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 15](https://nextjs.org) — App Router, React Server Components |
| **Language** | [TypeScript 5](https://www.typescriptlang.org) — strict mode throughout |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) |
| **Animations** | [GSAP](https://gsap.com) + [Framer Motion](https://www.framer.com/motion/) |
| **State Management** | [Redux Toolkit](https://redux-toolkit.js.org) |
| **Authentication** | [NextAuth.js](https://next-auth.js.org) — GitHub, Google, credentials providers |
| **Database** | [PostgreSQL](https://www.postgresql.org) via [Prisma ORM](https://www.prisma.io) |
| **API** | [GitHub REST API v3](https://docs.github.com/en/rest) + Octokit |
| **AI** | [Anthropic Claude](https://anthropic.com) via `@anthropic-ai/sdk` |
| **Email** | Nodemailer (SMTP/Gmail) |
| **Icons** | [Material Symbols](https://fonts.google.com/icons) + [Lucide React](https://lucide.dev) |
| **Fonts** | Space Grotesk, Inter, JetBrains Mono |

---

## 🏗 Architecture

```
src/
├── app/
│   ├── (site)/(marketing)/    # Public marketing pages
│   ├── (dashboard)/           # Authenticated dashboard routes
│   └── api/                   # API routes (GitHub proxy, AI, auth, user)
├── features/                  # Feature-scoped React components
│   ├── intelligence/          # AI scan hub, code review, PR generator
│   ├── layout/                # Shell, sidebar, nav, command palette
│   ├── settings/              # Settings panel with integrations
│   └── trending/              # Trending repos with language filter
├── lib/                       # Shared utilities
│   ├── ai-providers.ts        # callAI() wrapper for Anthropic + OpenAI
│   ├── discord.ts             # Discord webhook helpers
│   ├── slack.ts               # Slack webhook helpers
│   ├── email.ts               # Nodemailer email sender
│   └── security/              # CSRF, rate-limiting, audit logging
└── store/                     # Redux slices (UI, session state)
```

The application uses a **hybrid rendering** strategy:
- **Server Components** for initial data fetching and SEO pages
- **Client Components** for interactive UI (search, charts, AI forms)
- **API Routes** for GitHub proxying, AI jobs, webhooks, and cron
- **Middleware** enforces route-level authentication and rate limiting

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.17.0
- **npm** >= 9 (or pnpm / yarn)
- **PostgreSQL** database (local or hosted)
- A **GitHub OAuth App** ([create one here](https://github.com/settings/developers))

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/AshishLekhyani/GitScope.git
cd GitScope/gitscope

# 2. Install dependencies
npm install

# 3. Copy and fill in environment variables
cp .env.example .env.local

# 4. Push the Prisma schema to your database
npx prisma db push

# 5. Start the development server
npm run dev
```

The app will be live at **[http://localhost:3000](http://localhost:3000)**.

---

### Environment Variables

Create a `.env.local` file in the `gitscope/` directory:

```env
# --- Authentication ---
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=               # openssl rand -base64 32

# --- GitHub OAuth App ---
GITHUB_ID=                     # github.com/settings/developers
GITHUB_SECRET=

# --- Google OAuth (optional) ---
GOOGLE_ID=
GOOGLE_SECRET=

# --- Database ---
DATABASE_URL=postgresql://user:password@localhost:5432/gitscope

# --- GitHub API (optional, raises rate limit 60 → 5000 req/hr) ---
GITHUB_TOKEN=
GITHUB_SHARED_FALLBACK=false

# --- Token Encryption (required in production) ---
GITHUB_PAT_ENCRYPTION_KEY=     # openssl rand -base64 32

# --- CSRF / Signing ---
CSRF_SECRET=                   # openssl rand -base64 32
REQUEST_SIGNING_SECRET=        # openssl rand -base64 32

# --- Email (SMTP / Gmail) ---
SMTP_USER=your_email@gmail.com
SMTP_PASS=                     # 16-char Gmail App Password
EMAIL_FROM=GitScope <your_email@gmail.com>

# --- AI: Anthropic Claude ---
ANTHROPIC_API_KEY=             # console.anthropic.com

# --- AI tiering ---
AI_PROVIDER=anthropic
AI_TIER_OVERRIDES=             # email:plan,email2:plan
AI_TEAM_DOMAINS=
AI_ENTERPRISE_DOMAINS=

# --- AI async jobs cron ---
AI_JOBS_CRON_SECRET=           # optional; falls back to x-vercel-cron header
CRON_SECRET=
AI_JOBS_CRON_BATCH=2

# --- GitHub App (optional, for webhook + PR auto-review) ---
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=        # multiline PEM, wrap in quotes
GITHUB_WEBHOOK_SECRET=
GITHUB_APP_INSTALL_URL=
```

**Setting up GitHub OAuth:**
1. Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**
2. Set **Homepage URL** to `http://localhost:3000`
3. Set **Authorization callback URL** to `http://localhost:3000/api/auth/callback/github`
4. Copy the Client ID and Secret into `.env.local`

---

### Database Setup

**Option A — Local PostgreSQL:**
```bash
createdb gitscope
# Set DATABASE_URL=postgresql://localhost/gitscope
npx prisma db push
```

**Option B — Free hosted (recommended):**

| Provider | Free Tier | Link |
|---|---|---|
| [Neon](https://neon.tech) | 0.5 GB, serverless | neon.tech |
| [Supabase](https://supabase.com) | 500 MB, full PG | supabase.com |
| [Railway](https://railway.app) | $5 credit/mo | railway.app |

---

## 💡 Usage

### Searching a Repository

1. Type `owner/repo` (e.g. `vercel/next.js`) in the global search bar
2. Hit **Enter** or select from the dropdown
3. You'll land on the repository overview with all analytics populated

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open command palette |
| `/` | Focus global search |
| `T` | Toggle dark/light theme |
| `F` | Toggle fullscreen |
| `G` then `O` | Go to Overview |
| `G` then `E` | Go to Search |
| `Escape` | Close all modals |

### Intelligence Hub (AI Scans)

1. Navigate to **Intelligence Hub** in the sidebar
2. Enter a repository name (e.g. `facebook/react`)
3. Click **Scan** — the AI analyzes security, code quality, documentation, and maintenance
4. View the 0–100 health score, CVE findings, and actionable recommendations
5. Save findings as **Action Items** or create GitHub Issues directly

### Slack & Discord Alerts

1. Go to **Settings → Integrations**
2. Paste your **Slack Incoming Webhook URL** or **Discord Webhook URL**
3. Click **Save** — GitScope will POST an alert whenever a scan detects a health drop
4. Enable **Weekly Digest** to receive a Monday-morning fleet summary

---

## ☁️ Deployment

### Deploy to Vercel (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/AshishLekhyani/GitScope)

1. Click the button above or import the repo at [vercel.com](https://vercel.com)
2. Add all environment variables from the list above
3. Update your GitHub OAuth App's callback URL to `https://your-app.vercel.app/api/auth/callback/github`
4. Deploy — done ✅

**Cron configuration** (Vercel free tier — 1 cron max):
```json
// vercel.json
{
  "crons": [{ "path": "/api/internal/ai-jobs/cron", "schedule": "0 8 * * *" }]
}
```
This single daily cron handles AI job processing, scheduled repo scans, and Monday digest fan-out.

---

## 🛡️ Security

| Feature | Implementation |
|---|---|
| **Authentication** | NextAuth.js with bcrypt (12 rounds) for passwords |
| **CSRF Protection** | Double Submit Cookie, HMAC-SHA256, `__Host-` prefix |
| **Rate Limiting** | IP-based with exponential backoff |
| **Token Encryption** | AES-256-GCM for stored GitHub PATs |
| **Audit Logging** | 34 security event types, batched DB writes |
| **Request Signing** | HMAC-SHA256 for webhooks, 5-min expiry |
| **SSRF Protection** | Path validation on GitHub proxy |

See [SECURITY.md](SECURITY.md) for the full security policy and responsible disclosure process.

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

```bash
# Quick start
git checkout -b feat/my-feature
git commit -m "feat(scope): add amazing feature"
git push origin feat/my-feature
# Open a PR against master
```

---

## 📄 License

GitScope is **proprietary software**. See [LICENSE](LICENSE) for the full terms.

In short: you may view and study the code, but you may **not** distribute it, deploy a public instance, or use it commercially without explicit written permission from the author. Contact **ashishlekhyani@gmail.com** to request a license.

---

## 🙏 Acknowledgements

- [**Vercel**](https://vercel.com) — Next.js and deployment platform
- [**shadcn/ui**](https://ui.shadcn.com) — Accessible component primitives
- [**GitHub REST API**](https://docs.github.com/en/rest) — The data backbone
- [**Anthropic Claude**](https://anthropic.com) — AI analysis engine
- [**Prisma**](https://www.prisma.io) — Type-safe database access
- [**Google OSV**](https://osv.dev) — Open Source Vulnerability database

---

<div align="center">

Built with care by [AshishLekhyani](https://github.com/AshishLekhyani)

⭐ Star this repo if you find it useful!

</div>
