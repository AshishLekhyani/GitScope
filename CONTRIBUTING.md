# Contributing to GitScope

GitScope is proprietary software. Please read the [LICENSE](LICENSE) before contributing — by submitting a pull request you agree to the terms below.

## License Agreement

By submitting a contribution (pull request, patch, issue fix, or documentation change), you agree that:

1. Your contribution becomes the **exclusive property of Ashish Lekhyani** under the same proprietary terms as the rest of the codebase.
2. You retain no rights to use, redistribute, or sublicense your contribution independently.
3. You have the right to make the contribution (i.e. it is your own original work and does not violate any third-party IP).

Contributions that add open-source dependencies must use licenses compatible with proprietary distribution (MIT, Apache-2.0, ISC). GPL/LGPL/AGPL dependencies are not accepted.

---

## How to Contribute

### Reporting Bugs

Before filing a bug report:
- Check if it already exists in [Issues](https://github.com/AshishLekhyani/GitScope/issues)
- Try to reproduce on the latest `master`

A good bug report includes:
- **Clear title** — one sentence describing the problem
- **Steps to reproduce** — numbered, minimal steps
- **Expected vs. actual behavior**
- **Environment** — OS, browser, Node.js version
- **Screenshots or error logs** if applicable

### Suggesting Features

Open an issue tagged `enhancement`. Explain:
- What problem it solves
- Who benefits from it
- Rough implementation idea (optional)

Features that align with GitScope's roadmap (AI scanning, integrations, analytics depth) are most likely to be accepted.

### Submitting a Pull Request

1. **Open an issue first** for non-trivial changes so we can discuss before you invest time
2. Branch from `master`:
   ```bash
   git checkout -b feat/short-description
   # or
   git checkout -b fix/bug-description
   ```
3. Follow the coding standards below
4. Commit with [Conventional Commits](https://www.conventionalcommits.org):
   ```
   feat(intelligence): add OSV scan progress indicator
   fix(auth): resolve session cookie expiry on Safari
   docs(api): update badge endpoint path
   ```
5. Push and open a PR against `master` — fill in the PR template

---

## Development Setup

```bash
# 1. Clone (do NOT fork publicly — see LICENSE)
git clone https://github.com/AshishLekhyani/GitScope.git
cd GitScope/gitscope

# 2. Install dependencies
npm install

# 3. Copy and fill in environment variables
cp .env.example .env.local

# 4. Push Prisma schema
npx prisma db push

# 5. Start dev server
npm run dev
```

---

## Coding Standards

### TypeScript
- Strict mode throughout — no `any`, use `unknown` with type guards
- Export shared types from dedicated files

### Style
- Tailwind CSS for all styling — no inline styles except dynamic values
- shadcn/ui components first, custom only when necessary
- `cn()` from `@/lib/utils` for conditional class merging

### Naming
- Components: `PascalCase.tsx`
- Hooks/utilities: `camelCase.ts`
- Constants: `UPPER_SNAKE_CASE`
- API routes: follow existing `src/app/api/` structure

### Commit Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code restructure, no behavior change |
| `docs` | Documentation only |
| `style` | Formatting, no logic change |
| `test` | Tests added or corrected |
| `chore` | Build tools, dependencies |
| `security` | Security-related change |

### Database Changes
- Modify `prisma/schema.prisma`
- Run `npx prisma migrate dev --name descriptive_name`
- Update `.env.example` if new env vars are required

---

## Security

**Never open a public issue for security vulnerabilities.**  
Email **acnotros2@gmail.com** instead. See [SECURITY.md](SECURITY.md).

---

## Questions

Open a [GitHub Discussion](https://github.com/AshishLekhyani/GitScope/discussions) for general questions.

---

*All rights reserved. See [LICENSE](LICENSE) for full terms.*
