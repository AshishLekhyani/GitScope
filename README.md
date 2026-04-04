<div align="center">

<img src="public/logo.png" alt="GitScope Logo" width="80" height="80" />

# GitScope

**Enterprise-grade GitHub analytics — explore any repository, understand your codebase, and track engineering velocity in real time.**

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

[Live Demo](https://git-scope-pi.vercel.app) · [Report a Bug](https://github.com/AshishLekhyani/GitScope/issues) · [Request a Feature](https://github.com/AshishLekhyani/GitScope/issues)

</div>

---

## What is GitScope?

GitScope is a full-stack GitHub analytics platform that turns raw GitHub data into actionable engineering intelligence. Search any public repository and instantly surface **contributor insights**, **commit activity**, **language breakdowns**, **code health metrics**, and **trending projects** — all through a polished, dark-mode-first dashboard that feels like a premium engineering tool.

> Built for engineers who want to understand a codebase before contributing, for engineering managers tracking team velocity, and for developers who simply like their dashboards to look good.

---

## Table of Contents

- [GitScope](#gitscope)
  - [What is GitScope?](#what-is-gitscope)
  - [Table of Contents](#table-of-contents)
  - [✨ Features](#-features)
  - [🛠 Tech Stack](#-tech-stack)
  - [🏗 Architecture](#-architecture)
  - [🚀 Getting Started](#-getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
    - [Environment Variables](#environment-variables)
    - [Database Setup](#database-setup)
  - [💡 Usage](#-usage)
    - [Searching a Repository](#searching-a-repository)
    - [Keyboard Shortcuts](#keyboard-shortcuts)
    - [Comparing Repositories](#comparing-repositories)
  - [☁️ Deployment](#️-deployment)
    - [Deploy to Vercel (Recommended)](#deploy-to-vercel-recommended)
  - [🗺 Roadmap](#-roadmap)
  - [🤝 Contributing](#-contributing)
  - [🙏 Acknowledgements](#-acknowledgements)

---

## ✨ Features

- 🔍 **Global Live Search** — Debounced search across all public GitHub repos and users with instant results
- 📊 **Repository Analytics** — Stars, forks, open issues, watchers, commit frequency, and language breakdowns
- 👥 **Contributor Insights** — Activity heatmaps, commit counts, and contributor leaderboards
- 📈 **Commit History** — Visual timeline of commits with author filtering and date ranges
- 🧠 **Code Intelligence** — Language distribution, file tree exploration, and source browser
- 🏆 **Trending Projects** — Real-time trending repos by language, time window, and region
- ⚖️ **Repo Comparison** — Side-by-side analysis of multiple repositories
- 🏢 **Organization Pulse** — Team-level analytics for GitHub organizations
- 🤖 **AI-Powered Analysis** — Repository summaries, health scores, and risk predictions via Claude API
- ⌨️ **Keyboard-Native** — Full keyboard shortcut palette (⌘K / Ctrl+K)
- 🔔 **Notification Feed** — GitHub notification integration with unread badge
- 📡 **API Rate Limit Monitor** — Live GitHub API usage tracker in the sidebar
- 🌙 **Dark Mode First** — System-aware theming with smooth toggle
- 🔐 **Multi-Provider Auth** — GitHub OAuth, Google OAuth, or email/password with email verification
- 🛡️ **Enterprise Security** — CSRF protection, rate limiting, audit logging, AES-256 encryption for tokens

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org) — App Router, React Server Components |
| **Language** | [TypeScript 5](https://www.typescriptlang.org) — strict mode throughout |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) |
| **Animations** | [Framer Motion](https://www.framer.com/motion/) |
| **State Management** | [Redux Toolkit](https://redux-toolkit.js.org) |
| **Data Fetching** | [TanStack Query (React Query)](https://tanstack.com/query) |
| **Authentication** | [NextAuth.js](https://next-auth.js.org) — GitHub OAuth provider |
| **Database** | [PostgreSQL](https://www.postgresql.org) via [Prisma ORM](https://www.prisma.io) |
| **API** | [GitHub REST API v3](https://docs.github.com/en/rest) + Octokit |
| **Testing** | [Vitest](https://vitest.dev) + Testing Library |
| **Icons** | [Material Symbols](https://fonts.google.com/icons) + [Lucide React](https://lucide.dev) |
| **Fonts** | Space Grotesk, Inter, JetBrains Mono |

---

## 🏗 Architecture

```mermaid
graph TD
    classDef client fill:#0ea5e9,color:#fff,stroke:#0284c7
    classDef server fill:#10b981,color:#fff,stroke:#059669
    classDef external fill:#f59e0b,color:#fff,stroke:#d97706
    classDef data fill:#8b5cf6,color:#fff,stroke:#7c3aed

    CLIENT["Browser / Client UI"]:::client
    RTK["Redux Toolkit"]:::client
    RQ["React Query"]:::client
    
    APP["Next.js App Router"]:::server
    API["Proxy & AI Routes"]:::server
    AUTH["NextAuth.js"]:::server
    
    GH["GitHub REST API"]:::external
    AI["Anthropic API"]:::external
    
    DB[(PostgreSQL Database)]:::data

    CLIENT <-->|Global State| RTK
    CLIENT <-->|Server Cache| RQ
    
    CLIENT -->|App Routing| APP
    CLIENT -->|API Calls| API
    CLIENT -->|OAuth Flow| AUTH
    
    AUTH -->|User Sessions| DB
    
    APP -->|RSC Data Fetching| GH
    APP -->|Prisma ORM| DB
    
    API -->|Metadata Proxy| GH
    API -->|AI Repository Analysis| AI
    
    APP -->|Hydration| CLIENT
```

The application follows a **hybrid rendering** strategy:
- **Server Components** for initial data fetching and SEO-critical pages
- **Client Components** for interactive elements (search, charts, dropdowns)
- **API Routes** handle GitHub proxying, session data, and notification polling
- **Middleware** enforces route-level authentication guards

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0 (or pnpm / yarn)
- **PostgreSQL** database (local or hosted — see [Database Setup](#database-setup))
- A **GitHub OAuth App** (see [Environment Variables](#environment-variables))

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/AshishLekhyani/GitScope.git
cd GitScope/gitscope

# 2. Install dependencies
npm install

# 3. Set up your environment (see next section)
cp .env.example .env.local

# 4. Push Prisma schema to your database
npx prisma db push

# 5. Start the development server
npm run dev
```

The app will be live at **[http://localhost:3000](http://localhost:3000)**.

---

### Environment Variables

Create a `.env.local` file in the `gitscope/` directory with the following:

```env
# --- Authentication ---
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_super_secret_key_here   # openssl rand -base64 32

# --- GitHub OAuth App ---
# Create at: https://github.com/settings/developers → OAuth Apps
GITHUB_ID=your_github_oauth_client_id
GITHUB_SECRET=your_github_oauth_client_secret

# --- Google OAuth (optional) ---
GOOGLE_ID=your_google_oauth_client_id
GOOGLE_SECRET=your_google_oauth_client_secret

# --- Database ---
DATABASE_URL=postgresql://user:password@localhost:5432/gitscope

# --- GitHub API (optional, raises rate limit from 60 → 5000 req/hr) ---
GITHUB_TOKEN=ghp_your_personal_access_token
# Optional: true enables shared fallback to GITHUB_TOKEN when user token is missing.
GITHUB_SHARED_FALLBACK=false

# --- Encrypt stored user GitHub PATs (required in production) ---
# openssl rand -base64 32
GITHUB_PAT_ENCRYPTION_KEY=your_32_byte_base64_key

# --- CSRF Protection (uses NEXTAUTH_SECRET as fallback if not set) ---
CSRF_SECRET=your_csrf_secret_here   # openssl rand -base64 32

# --- Request Signing for Webhooks (uses NEXTAUTH_SECRET as fallback) ---
REQUEST_SIGNING_SECRET=your_signing_secret_here   # openssl rand -base64 32

# --- Email (SMTP) ---
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_gmail_app_password   # 16-char app password, NOT your actual password
EMAIL_FROM=GitScope <your_email@gmail.com>

# --- AI: Anthropic Claude ---
ANTHROPIC_API_KEY=sk-ant-your_api_key_here

# --- AI tiering and provider ---
AI_PROVIDER=anthropic
# Format: email:plan,email2:plan where plan is free|professional|team|enterprise
AI_TIER_OVERRIDES=
AI_TEAM_DOMAINS=
AI_ENTERPRISE_DOMAINS=
# Optional production admins allowed to patch tiers via /api/user/tier
AI_TIER_ADMIN_EMAILS=

# --- AI async jobs (Vercel cron worker) ---
# Optional secret for /api/internal/ai-jobs/cron (Authorization: Bearer <secret>)
AI_JOBS_CRON_SECRET=
# Optional Vercel cron secret alias (usually same value)
CRON_SECRET=
# Jobs processed per cron run
AI_JOBS_CRON_BATCH=2

# --- Trusted Proxies (for IP rate limiting behind load balancers) ---
TRUSTED_PROXIES=  # Comma-separated list of trusted proxy IPs
```

**Setting up GitHub OAuth:**

1. Go to **GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App**
2. Set **Homepage URL** to `http://localhost:3000`
3. Set **Authorization callback URL** to `http://localhost:3000/api/auth/callback/github`
4. Copy the **Client ID** and **Client Secret** into your `.env.local`

---

### Database Setup

**Option A — Local PostgreSQL:**
```bash
# macOS
brew install postgresql && brew services start postgresql
createdb gitscope

# Then set DATABASE_URL=postgresql://localhost/gitscope
```

**Option B — Free hosted (recommended for getting started fast):**

| Provider | Free Tier | Link |
|---|---|---|
| [Neon](https://neon.tech) | 0.5 GB, serverless | neon.tech |
| [Supabase](https://supabase.com) | 500 MB, full PG | supabase.com |
| [Railway](https://railway.app) | $5 credit/mo | railway.app |

After setting `DATABASE_URL`, run:
```bash
npx prisma db push       # apply schema
npx prisma studio        # optional: visual DB browser
```

---

## �️ Security

GitScope implements enterprise-grade security measures to protect user data and platform integrity:

| Feature | Implementation |
|---|---|
| **Authentication** | NextAuth.js with JWT sessions, bcrypt password hashing (12 rounds) |
| **OAuth Providers** | GitHub OAuth with email verification, Google OAuth with verified email check |
| **CSRF Protection** | Double Submit Cookie pattern with HMAC-SHA256 tokens, `__Host-` prefix cookies |
| **Rate Limiting** | IP-based with reputation tracking, exponential backoff for violators |
| **Token Encryption** | AES-256-GCM for GitHub PATs with random IV and auth tag |
| **Audit Logging** | 34 security event types, batched writes, database persistence |
| **Request Signing** | HMAC-SHA256 for webhooks with 5-minute expiration |
| **Input Validation** | Strict validation on all API endpoints with length limits |
| **SSRF Protection** | Path validation on GitHub proxy, blocks `http` and `..` patterns |
| **Headers** | HSTS, secure cookie settings, cache-control for protected routes |

### Security Best Practices

1. **Always set `GITHUB_PAT_ENCRYPTION_KEY`** in production (32-byte base64)
2. **Use strong `NEXTAUTH_SECRET`** (generated with `openssl rand -base64 32`)
3. **Enable CSRF protection** by setting `CSRF_SECRET` or using `NEXTAUTH_SECRET`
4. **Configure `TRUSTED_PROXIES`** if running behind a load balancer
5. **Set up `SMTP_USER` and `SMTP_PASS`** for email verification and password reset
6. **Enable request signing** with `REQUEST_SIGNING_SECRET` for webhook endpoints

### Responsible Disclosure

If you discover a security vulnerability, please email **security@gitscope.dev** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment

We will acknowledge within 2 business days and provide updates as we work on a fix.

---

## � Usage

### Searching a Repository

1. Type `owner/repo` (e.g. `vercel/next.js`) in the global search bar
2. Hit **Enter** or select from the live suggestion dropdown
3. You'll land on the repository overview with all analytics populated

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘/` / `Ctrl+/` | Focus global search |
| `G` then `O` | Go to Overview |
| `G` then `S` | Go to Search |
| `?` | Show all shortcuts |

### Comparing Repositories

Navigate to **Repo Comparison** in the sidebar and enter up to 3 `owner/repo` slugs to compare stars, forks, commit activity, and language distribution side by side.

---

## ☁️ Deployment

### Deploy to Vercel (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/AshishLekhyani/GitScope)

1. Click the button above or import the repo manually at [vercel.com](https://vercel.com)
2. Add all environment variables from [the list above](#environment-variables)
3. Update your GitHub OAuth App's callback URL to `https://your-app.vercel.app/api/auth/callback/github`
4. Deploy — done ✅

Every subsequent `git push` to `master` triggers an automatic redeploy.

---

## 🗺 Roadmap

- [ ] **AI Repository Summaries** — LLM-powered natural language summaries of any repo
- [ ] **PR Analytics** — Pull request merge rates, review times, cycle time metrics
- [ ] **Custom Dashboards** — Save and pin repos to a personal workspace
- [ ] **Webhook Integration** — Real-time updates via GitHub webhooks
- [ ] **CLI Tool** — `gitscope analyze owner/repo` from the terminal
- [ ] **Export Reports** — PDF/CSV export of analytics snapshots
- [ ] **Team Workspaces** — Shared dashboards for engineering teams

---

## 🤝 Contributing

Contributions are welcome and appreciated! Here's how to get started:

1. **Fork** the repository
2. **Create a branch** for your feature: `git checkout -b feat/my-new-feature`
3. **Commit** your changes following [Conventional Commits](https://www.conventionalcommits.org): `git commit -m "feat(scope): add amazing feature"`
4. **Push** to your branch: `git push origin feat/my-new-feature`
5. **Open a Pull Request** against `master`

---


## 📄 License

GitScope is open-source software licensed under the [MIT License](LICENSE).

### What the MIT License Means for You

| Permission | Description |
|------------|-------------|
| **Commercial Use** | You can use GitScope for commercial projects |
| **Modification** | You can modify the code to suit your needs |
| **Distribution** | You can distribute copies of the software |
| **Private Use** | You can use and modify GitScope privately |
| **Sublicensing** | You can incorporate GitScope into proprietary software |

### Requirements

- **Include Copyright Notice** — You must include the original copyright notice in any copy or substantial portion of the software
- **Include License Text** — You must include a copy of the MIT License in any distribution

### Limitations

- **No Warranty** — The software is provided "as is", without warranty of any kind
- **No Liability** — The authors are not liable for any claims, damages, or other liability

### Third-Party Licenses

GitScope uses several open-source packages, each with their own licenses:

| Package | License |
|---------|---------|
| Next.js | MIT |
| React | MIT |
| Prisma | Apache-2.0 |
| NextAuth.js | ISC |
| Tailwind CSS | MIT |
| shadcn/ui | MIT |

For a complete list of dependencies and their licenses, see the `package.json` file or run `npm list`.

---

## 🙏 Acknowledgements

- [**Vercel**](https://vercel.com) — For Next.js and the deployment platform
- [**shadcn/ui**](https://ui.shadcn.com) — Beautiful, accessible component primitives
- [**GitHub REST API**](https://docs.github.com/en/rest) — The data backbone of this project
- [**Prisma**](https://www.prisma.io) — Elegant database access with TypeScript types
- [**Framer Motion**](https://www.framer.com/motion/) — Smooth, production-grade animations
- [**shields.io**](https://shields.io) — Dynamic badge generation
- [**Lucide**](https://lucide.dev) — Clean, consistent icon set

---

<div align="center">

Built with ❤️ by [AshishLekhyani](https://github.com/AshishLekhyani)

⭐ Star this repo if you find it useful!

</div>
