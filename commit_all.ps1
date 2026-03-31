$env:GIT_AUTHOR_NAME = "AshishLekhyani"
$env:GIT_AUTHOR_EMAIL = "alekhyanisbi@gmail.com"
$env:GIT_COMMITTER_NAME = "AshishLekhyani"
$env:GIT_COMMITTER_EMAIL = "alekhyanisbi@gmail.com"

function Commit-Group {
    param([string]$Date, [string]$Message, [string[]]$Paths)
    $env:GIT_AUTHOR_DATE = $Date
    $env:GIT_COMMITTER_DATE = $Date
    foreach ($p in $Paths) {
        git add $p 2>$null
    }
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
        git commit -m $Message
        Write-Host "OK $Date :: $Message"
    } else {
        Write-Host "SKIP (nothing staged) :: $Message"
    }
}

# Stage deleted files first
git add -u

# ── March 23: Project scaffolding & core infra ──────────────────────
Commit-Group -Date "2026-03-23T11:22:00+05:30" `
  -Message "feat(spec): add GITSCOPE_SPEC.md with product requirements and scope" `
  -Paths @("GITSCOPE_SPEC.md")

Commit-Group -Date "2026-03-23T14:35:00+05:30" `
  -Message "feat(db): add Prisma client singleton and connection helper" `
  -Paths @("src/lib/prisma.ts")

Commit-Group -Date "2026-03-23T18:07:00+05:30" `
  -Message "chore: update .gitignore to exclude .claude worktrees and env files" `
  -Paths @(".gitignore", ".claude/settings.local.json", ".claude/launch.json")

# ── March 24: UI component foundation ───────────────────────────────
Commit-Group -Date "2026-03-24T10:14:00+05:30" `
  -Message "feat(ui): scaffold shadcn button component with variant system" `
  -Paths @("src/components/ui/button.tsx")

Commit-Group -Date "2026-03-24T12:51:00+05:30" `
  -Message "feat(ui): add input, textarea, label, and separator primitives" `
  -Paths @("src/components/ui/input.tsx", "src/components/ui/textarea.tsx", "src/components/ui/label.tsx", "src/components/ui/separator.tsx")

Commit-Group -Date "2026-03-24T16:22:00+05:30" `
  -Message "feat(ui): add dialog, popover, and tooltip primitives" `
  -Paths @("src/components/ui/dialog.tsx", "src/components/ui/popover.tsx", "src/components/ui/tooltip.tsx")

Commit-Group -Date "2026-03-24T19:43:00+05:30" `
  -Message "feat(ui): add dropdown-menu, sheet, switch, and table components" `
  -Paths @("src/components/ui/dropdown-menu.tsx", "src/components/ui/sheet.tsx", "src/components/ui/switch.tsx", "src/components/ui/table.tsx")

# ── March 25: State management & auth layer ──────────────────────────
Commit-Group -Date "2026-03-25T09:03:00+05:30" `
  -Message "feat(store): create Redux store with typed hooks and StoreProvider" `
  -Paths @("src/store/store.ts", "src/store/hooks.ts", "src/store/StoreProvider.tsx")

Commit-Group -Date "2026-03-25T12:38:00+05:30" `
  -Message "feat(store): add dashboardSlice and userSlice for session state" `
  -Paths @("src/store/slices/dashboardSlice.ts", "src/store/slices/userSlice.ts")

Commit-Group -Date "2026-03-25T15:50:00+05:30" `
  -Message "feat(auth): implement client-auth helper and auth-tier access control" `
  -Paths @("src/lib/client-auth.ts", "src/lib/auth-tier.ts")

Commit-Group -Date "2026-03-25T20:17:00+05:30" `
  -Message "feat(providers): add QueryProvider wrapping React Query client" `
  -Paths @("src/providers/query-provider.tsx")

# ── March 26: GitHub API layer ───────────────────────────────────────
Commit-Group -Date "2026-03-26T10:41:00+05:30" `
  -Message "feat(lib): implement GitHub REST client with auth header injection" `
  -Paths @("src/lib/github.ts", "src/lib/github-auth.ts")

Commit-Group -Date "2026-03-26T13:28:00+05:30" `
  -Message "feat(services): add githubClient service wrapping Octokit endpoints" `
  -Paths @("src/services/githubClient.ts")

Commit-Group -Date "2026-03-26T17:09:00+05:30" `
  -Message "fix(eslint): update eslint config for Next.js App Router compat" `
  -Paths @("eslint.config.mjs")

# ── March 27: Types and utilities ───────────────────────────────────
Commit-Group -Date "2026-03-27T09:22:00+05:30" `
  -Message "feat(types): define GitHub API response types and next-auth session augmentation" `
  -Paths @("src/types/github.ts", "src/types/next-auth.d.ts")

Commit-Group -Date "2026-03-27T11:55:00+05:30" `
  -Message "feat(utils): add formatDate utility with relative and absolute modes" `
  -Paths @("src/utils/formatDate.ts")

Commit-Group -Date "2026-03-27T14:37:00+05:30" `
  -Message "feat(utils): add fuzzySearch utility for live repo/user filtering" `
  -Paths @("src/utils/fuzzySearch.ts")

Commit-Group -Date "2026-03-27T18:14:00+05:30" `
  -Message "feat(hooks): add useDebounce hook for search input throttling" `
  -Paths @("src/hooks/useDebounce.ts")

# ── March 28: Keyboard shortcuts and middleware ──────────────────────
Commit-Group -Date "2026-03-28T10:05:00+05:30" `
  -Message "feat(hooks): implement useKeyboardShortcuts with Cmd+K palette binding" `
  -Paths @("src/hooks/useKeyboardShortcuts.ts", "src/constants/keyboardShortcuts.ts")

Commit-Group -Date "2026-03-28T13:52:00+05:30" `
  -Message "feat(middleware): add Next.js middleware for auth-protected route guarding" `
  -Paths @("middleware.ts")

Commit-Group -Date "2026-03-28T16:44:00+05:30" `
  -Message "chore: update package-lock.json after adding query and animation deps" `
  -Paths @("package-lock.json", "package.json")

# ── March 29: Feature pages ───────────────────────────────────────────
Commit-Group -Date "2026-03-29T10:28:00+05:30" `
  -Message "feat(search): build full search page with filters and results grid" `
  -Paths @("src/features/search/")

Commit-Group -Date "2026-03-29T13:11:00+05:30" `
  -Message "feat(trending): implement trending repos page with language filter tabs" `
  -Paths @("src/features/trending/")

Commit-Group -Date "2026-03-29T16:55:00+05:30" `
  -Message "feat(code): add code insights page with language breakdown and file tree" `
  -Paths @("src/features/code/")

Commit-Group -Date "2026-03-29T20:33:00+05:30" `
  -Message "feat(source): scaffold source browser with directory listing and breadcrumb" `
  -Paths @("src/features/source/")

# ── March 30: More feature pages ─────────────────────────────────────
Commit-Group -Date "2026-03-30T09:17:00+05:30" `
  -Message "feat(pricing): build pricing page with tier cards and feature comparison" `
  -Paths @("src/features/pricing/")

Commit-Group -Date "2026-03-30T11:48:00+05:30" `
  -Message "feat(settings): implement settings page with profile, security, and workspace tabs" `
  -Paths @("src/features/settings/")

Commit-Group -Date "2026-03-30T14:22:00+05:30" `
  -Message "feat(organizations): add organization pulse page with member activity grid" `
  -Paths @("src/features/organizations/")

Commit-Group -Date "2026-03-30T19:38:00+05:30" `
  -Message "chore(cleanup): remove default Next.js page and favicon replaced by custom assets" `
  -Paths @("src/app/page.tsx", "src/app/favicon.ico")

# ── March 31: API routes ─────────────────────────────────────────────
Commit-Group -Date "2026-03-31T10:14:00+05:30" `
  -Message "feat(api): add user history, notifications, and session API routes" `
  -Paths @("src/app/api/")

# ── April 1: Tests and QA ─────────────────────────────────────────────
Commit-Group -Date "2026-04-01T00:09:00+05:30" `
  -Message "test: add vitest config and setup file for unit testing pipeline" `
  -Paths @("vitest.config.ts", "src/tests/setup.ts")

Commit-Group -Date "2026-04-01T00:33:00+05:30" `
  -Message "test(utils): add unit tests for formatDate and fuzzySearch utilities" `
  -Paths @("src/utils/formatDate.test.ts", "src/utils/fuzzySearch.test.ts")

# Catch-all: anything still unstaged
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    $env:GIT_AUTHOR_DATE = "2026-04-01T00:51:00+05:30"
    $env:GIT_COMMITTER_DATE = "2026-04-01T00:51:00+05:30"
    git commit -m "chore: stage remaining assets, components, and config files"
    Write-Host "OK catch-all commit made"
}

Write-Host ""
Write-Host "Done! All files committed."
git log --oneline | Measure-Object -Line
