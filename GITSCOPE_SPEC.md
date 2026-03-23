# GitScope — Product Specification & Continuation Guide

> **For AI models:** Read this file to understand the full context of GitScope before continuing any development work. This is the single source of truth for architecture, features, business model, and current state.

---

## What is GitScope?

GitScope is a **GitHub repository analytics SaaS** — a premium developer intelligence platform that turns raw GitHub data into actionable engineering insights. Think of it as "Datadog for your GitHub repos."

Users connect their GitHub account via OAuth, and GitScope gives them:
- Real-time commit analytics, contributor insights, DORA metrics
- AI-powered code quality & PR risk analysis (via Claude/Anthropic)
- Organization-wide repository health dashboards
- Dependency mapping and tech stack visualization
- Trending open-source project discovery

**Target users:** Engineering teams, CTOs, tech leads, open-source maintainers, and individual developers who want deep insight into their codebases.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.2.1 (App Router, Server Components) |
| Auth | NextAuth.js 4 (GitHub OAuth, Google OAuth, Email/Password) |
| Database | PostgreSQL via Neon (serverless) |
| ORM | Prisma 5 |
| Styling | Tailwind CSS v4 + custom design tokens |
| State | Redux Toolkit (Zustand-like slices) |
| Data Fetching | TanStack React Query |
| AI | Anthropic Claude API (`claude-haiku-4-5-20251001`) |
| Charts | Recharts |
| Animations | Framer Motion |
| Icons | Material Symbols (via `@/components/material-icon`) + Lucide |
| UI Primitives | shadcn/ui (customized) |
| Deployment | Vercel (assumed) |

---

## Authentication Tiers

GitScope has three auth tiers that gate features:

### Tier 1: None (unauthenticated)
- Can access `/guest` page only (public repo explorer, no real analytics)
- Redirected to `/login` if they try to access any dashboard route

### Tier 2: Credentials / Google OAuth (`"credentials"` or `"google"`)
- Access to: Dashboard, Search, Trending, Compare, Settings, Activity (limited), Overview
- Blocked from: Intelligence, Organizations (redirected to `/unauthorized`)
- GitHub API calls use the server's `GITHUB_TOKEN` env var (limited rate)
- Can add a password to their account via Settings > Account

### Tier 3: GitHub OAuth (`"github"`)  ← **Full Access**
- Access to everything including:
  - **Recursive Intelligence** (DORA metrics, Dependency Radar, AI Risk Predictor)
  - **Organization Pulse** (real org data from `/user/orgs` + `/orgs/{login}`)
  - **Live Activity Feed** (real GitHub events via `/users/{login}/events`)
  - Full commit history, contributor analytics
- GitHub API calls use the user's own OAuth token (5000 req/hr per user)
- Higher AI analysis quota

**Implementation:** `src/lib/auth-tier.ts` — `getSessionTier()`, `requireTier()`, `isGitHubUser()`
**Middleware enforcement:** `middleware.ts` — checks `token.provider === "github"` for GitHub-only routes

---

## Feature Map by Tier

| Feature | Email/Pass | Google | GitHub OAuth |
|---------|-----------|--------|-------------|
| Repo Dashboard | ✅ | ✅ | ✅ |
| Commit Analytics | ✅ | ✅ | ✅ |
| Contributor Insights | ✅ | ✅ | ✅ |
| Trending Repos | ✅ | ✅ | ✅ |
| Compare Repos | ✅ | ✅ | ✅ |
| Search | ✅ | ✅ | ✅ |
| Settings (all tabs) | ✅ | ✅ | ✅ |
| Live Activity Feed | ❌ (msg shown) | ❌ (msg shown) | ✅ |
| Organization Pulse | ❌ (blocked) | ❌ (blocked) | ✅ |
| Recursive Intelligence | ❌ (blocked) | ❌ (blocked) | ✅ |
| DORA Metrics | ❌ | ❌ | ✅ |
| AI Risk Predictor | ❌ | ❌ | ✅ |
| Dependency Radar | ❌ | ❌ | ✅ |

---

## Business Model (Freemium SaaS)

### Who pays for the APIs?

**Currently (development):**
- `ANTHROPIC_API_KEY` in `.env` → **you (the developer)** pay for AI calls
- `GITHUB_TOKEN` in `.env` → fallback token for non-OAuth users (your own token)
- Each GitHub OAuth user's API calls → **use THEIR own token** (they don't pay; it's their GitHub rate limit)
- Database → **you pay** (Neon free tier initially)

**In production (monetized):**
- Anthropic API → **GitScope pays** (your biggest cost center — budget ~$0.01-0.05 per AI analysis)
- GitHub API → **each user's own OAuth token** — this is the key architectural advantage. You don't pay for GitHub API calls because OAuth users bring their own tokens. Rate limit is 5000 req/hr per user, not shared.
- Database → **GitScope pays** (Neon scales with usage)
- Hosting → **GitScope pays** (Vercel, ~$20-100/mo)

### Pricing Tiers (Proposed)

| Plan | Price | Target | Key Features |
|------|-------|--------|-------------|
| **Free** | $0/mo | Individual devs | 3 repos tracked, 5 AI analyses/month, basic charts |
| **Pro** | $12/mo | Power users | Unlimited repos, 100 AI analyses/month, DORA metrics, GitHub OAuth features |
| **Team** | $49/mo | Small teams | Everything in Pro + 5 seats, shared dashboards, team analytics |
| **Enterprise** | Custom | Large orgs | Unlimited seats, SSO, on-prem option, SLA, priority support |

### Why Would Anyone Pay?

1. **No alternative does all of this in one place** — GitHub's own analytics are basic; tools like LinearB cost $$$
2. **AI-powered PR risk scoring** catches problems before merge — real value for tech leads
3. **DORA metrics** are the gold standard for engineering team performance — required by many CTOs
4. **Org-wide visibility** across dozens of repos in one dashboard
5. **Time savings** — instead of writing scripts, everything is automated
6. **Trend discovery** — surface hot repos before they go viral

### Revenue Model
- **Primary:** Monthly/annual subscriptions via Stripe
- **Secondary:** Team plan upsells (per-seat pricing)
- **Future:** API access for CI/CD integrations, GitHub App listing

---

## Project Structure

```
gitscope/
├── prisma/schema.prisma          # Database schema (User, Account, Session, SearchHistory, Notification)
├── middleware.ts                 # Route protection + tier enforcement
├── src/
│   ├── app/
│   │   ├── (site)/               # Landing page, login, signup, pricing
│   │   ├── (dashboard)/          # All authenticated app pages
│   │   │   ├── layout.tsx        # DashboardShell wrapper
│   │   │   ├── overview/         # User's overview page
│   │   │   ├── dashboard/[owner]/[repo]/   # Repo analytics
│   │   │   │   ├── page.tsx      # Repo overview (RepoOverview component)
│   │   │   │   ├── analytics/    # CommitsPage with charts
│   │   │   │   ├── commits/      # CommitsPage with pagination
│   │   │   │   ├── contributors/ # ContributorsPageClient
│   │   │   │   ├── code/         # Code browser
│   │   │   │   └── source/       # File viewer
│   │   │   ├── intelligence/     # GitHub-only: DORA + AI (IntelligenceClient)
│   │   │   ├── organizations/    # GitHub-only: Org Pulse (server component)
│   │   │   ├── activity/         # Live feed (requires GitHub OAuth)
│   │   │   ├── search/           # Repo search
│   │   │   ├── trending/         # Trending repos (TrendingReposPanel)
│   │   │   ├── compare/          # Side-by-side repo comparison
│   │   │   └── settings/         # Settings (4 tabs: Profile/Account/Appearance/Workspace)
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/ # NextAuth handlers
│   │   │   ├── github/           # GitHub API proxy routes
│   │   │   │   ├── repos/[owner]/[repo]/  # Commits, contributors, languages, stats, pulls
│   │   │   │   └── search/       # Search API
│   │   │   ├── user/
│   │   │   │   ├── profile/      # GET/PATCH profile (name, bio, githubHandle)
│   │   │   │   ├── account/      # PATCH password management
│   │   │   │   ├── dora-metrics/ # DORA metrics from PR data
│   │   │   │   ├── dependency-map/ # package.json dependency analysis
│   │   │   │   └── pr-risk/      # PR risk scoring (heuristic + AI)
│   │   │   └── ai/analyze/       # POST: Claude AI repo analysis
│   │   ├── guest/page.tsx        # Public repo explorer (no auth)
│   │   └── unauthorized/page.tsx # Shown when credentials user hits GitHub-only route
│   ├── features/
│   │   ├── dashboard/            # RepoOverview, CommitsPage, ContributorsPage
│   │   ├── intelligence/         # IntelligenceClient, DependencyRadar, VelocityChart, RiskPredictor
│   │   ├── landing/              # LandingPage, hero section
│   │   ├── layout/               # TopNav, AppSidebar, DashboardShell
│   │   ├── organizations/        # OrgSearchBar
│   │   ├── settings/             # SettingsPanel (tabbed)
│   │   └── trending/             # TrendingReposPanel
│   ├── lib/
│   │   ├── auth.ts               # NextAuth config (GitHub + Google + Credentials)
│   │   ├── auth-tier.ts          # getSessionTier(), requireTier(), isGitHubUser()
│   │   ├── client-auth.ts        # performLogout() → redirects to /
│   │   ├── github.ts             # GitHub API helper functions
│   │   ├── github-auth.ts        # getGitHubToken() (OAuth token or env fallback)
│   │   └── prisma.ts             # Prisma client singleton
│   ├── store/                    # Redux store
│   │   └── slices/
│   │       ├── userSlice.ts      # displayName, gitHandle, bio, avatarUrl
│   │       └── uiSlice.ts        # commandPaletteOpen, shortcutsOpen
│   ├── types/
│   │   ├── github.ts             # GitHubContributor, CommitActivityWeek, etc.
│   │   └── next-auth.d.ts        # Extended Session + JWT types (includes provider, accessToken)
│   └── hooks/
│       ├── use-github-rate-limit.ts
│       ├── use-notifications.ts
│       └── use-recent-history.ts
```

---

## Database Schema (Prisma)

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  password      String?   // bcrypt hashed, null for pure OAuth users
  image         String?
  bio           String?
  githubHandle  String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  accounts      Account[]        // OAuth provider accounts
  sessions      Session[]
  searchHistories SearchHistory[]
  notifications Notification[]
}
```

Key points:
- `password` is null for GitHub/Google-only users — they can ADD a password via Settings > Account
- `githubHandle` stores the manually entered handle (separate from OAuth login)
- `bio` is a freeform engineering bio
- NextAuth stores OAuth tokens in `Account` (including GitHub `access_token`)

---

## Auth Flow

```
/login → NextAuth (GitHub OAuth / Google OAuth / Credentials)
  ↓
JWT callback: token.provider = account.provider, token.accessToken = account.access_token
  ↓
Session callback: session.provider = token.provider, session.accessToken = token.accessToken
  ↓
middleware.ts checks token.provider for GitHub-only routes
  ↓
Server components call requireTier("github") as second layer of defense
```

**Logout:** `performLogout()` in `client-auth.ts` → `signOut({ redirect: false })` → `window.location.replace("/")`

---

## Environment Variables Required

```env
# Database
DATABASE_URL="postgresql://..."          # Neon PostgreSQL connection string

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="..."                    # Random 32+ char secret

# GitHub OAuth App (create at github.com/settings/developers)
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."
GITHUB_TOKEN=""                          # Personal access token (fallback for non-OAuth users)

# Google OAuth (optional, for Google sign-in)
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# Anthropic AI (get at console.anthropic.com)
ANTHROPIC_API_KEY=""                     # Used for AI repo analysis at /api/ai/analyze

# Next.js
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

---

## Current State (as of 2026-03-31)

### What's Working
- ✅ GitHub OAuth login with full tier access
- ✅ Google OAuth and email/password login
- ✅ Repo dashboard with real GitHub data (overview, commits, contributors, code browser)
- ✅ Commit analytics with pagination (20 per page, date range filtering)
- ✅ Contributor insights with heatmap and load-more pagination
- ✅ Trending repos (public GitHub search)
- ✅ Recursive Intelligence (DORA metrics, Dependency Radar, AI Risk Predictor) — GitHub tier only
- ✅ Organization Pulse (real org data from GitHub API) — GitHub tier only
- ✅ Live Activity Feed (real GitHub events) — GitHub tier only
- ✅ Settings with 4 tabs: Profile, Account (password management), Appearance, Workspace
- ✅ Guest page (public repo explorer, no auth required)
- ✅ Error pages (404, 500, unauthorized)
- ✅ AI endpoint at `/api/ai/analyze` (POST with `{repo, question}`)
- ✅ Password add/change for social login users
- ✅ Velocity chart shows real calculated DORA stats (not hardcoded)
- ✅ Dependency radar nodes link to npmjs.com

### Known Limitations / TODO
- ⚠️ `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` must be filled in `.env` — currently empty placeholders
- ⚠️ AI analyze endpoint exists but no UI button wires to it yet on repo pages
- ⚠️ Trending time range filter (today/week/month) is UI-only — `getTrendingRepos()` doesn't accept time param
- ⚠️ Workspace notification toggles are in-memory only (not persisted to DB)
- ⚠️ Activity page "Load More" for older GitHub events (page 2+) not implemented
- ⚠️ No real billing/Stripe integration — pricing page is a placeholder
- ⚠️ Compare page may have static data

### Recent Changes (Session 3, 2026-03-31)
- Fixed hydration error in settings theme selector (added `mounted` state)
- Split settings into 4 distinct tabs (Profile / Account / Appearance / Workspace)
- Added password management for social login users (Settings > Account)
- Fixed logout to redirect to homepage (`/`) instead of login page
- Fixed velocity chart: 4 stat cards now calculated from real DORA data
- Made library dependency nodes clickable (link to npmjs.com)
- Updated top-nav dropdown: "Profile & Account" → `/settings?tab=profile`, "Security & Password" → `/settings?tab=account`, "Workspace Settings" → `/settings?tab=workspace`
- Added `/api/user/account` PATCH endpoint for password management
- Updated `/api/user/profile` GET to include `hasPassword` field

---

## How to Continue Development

1. **Run the app:** `npm run dev` at `e:\Coding\Self-Code\GitScope\gitscope`
2. **Fill in env vars:** `.env` needs `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` (and all OAuth credentials)
3. **Check the build:** `npm run build` — should be zero errors
4. **Priority next steps:**
   - Wire the AI analyze endpoint to a UI button on the repo overview page
   - Persist workspace notification/sync settings to the DB (need a `UserPreferences` model or JSON column)
   - Add Stripe for billing (pricing page is placeholder)
   - Implement trending time-range filter (need a scraper or GitHub Search with date params)
   - Add "Load More" for activity feed (GitHub events API supports pagination)

---

## Key Patterns to Follow

- **Server Components** call `await requireTier("github")` at the top for GitHub-only pages
- **Client Components** use `useSession()` and check `session.provider === "github"` for conditional UI
- **API routes** call `getServerSession(authOptions)` and check `session.user.id`
- **GitHub API calls** use `getGitHubToken()` which returns the user's OAuth token or the env fallback
- **Tailwind:** Use `bg-linear-to-r` not `bg-gradient-to-r` (Tailwind v4 canonical class)
- **Animations:** Wrap page content in `<motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>`
- **Loading states:** Use `<Skeleton>` from `@/components/ui/skeleton`
- **Icons:** Prefer `<MaterialIcon name="..." size={N} />` over Lucide when possible
- **Buttons:** Always add `type="button"` to avoid unintended form submissions
- **Next.js:** Dynamic params are Promises in this version — use `await params` in page components
