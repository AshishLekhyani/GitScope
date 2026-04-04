# Contributing to GitScope

First off, thank you for considering contributing to GitScope! It's people like you that make this tool better for everyone.

## Code of Conduct

This project and everyone participating in it is governed by a standard of respect and professionalism. Be kind, constructive, and helpful.

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report, please:
- Check if the issue already exists in the [Issues](https://github.com/AshishLekhyani/GitScope/issues)
- Try the latest version to see if it's already fixed
- Collect information about the bug (screenshots, error messages, steps to reproduce)

When submitting a bug report, include:
- **Clear title** — describe the problem briefly
- **Steps to reproduce** — numbered list of actions that trigger the bug
- **Expected behavior** — what you thought would happen
- **Actual behavior** — what actually happened
- **Environment** — OS, browser, Node.js version, etc.
- **Screenshots** — if applicable

### Suggesting Features

Feature requests are welcome! Please:
- Check if the feature was already suggested
- Explain why this feature would be useful to most GitScope users
- Provide a clear use case and expected behavior

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `master` for your feature or fix:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```
3. **Make your changes** — follow the coding standards below
4. **Test your changes** — run the test suite
5. **Commit** with a clear message following [Conventional Commits](https://www.conventionalcommits.org):
   ```bash
   git commit -m "feat: add new analytics widget"
   git commit -m "fix: resolve hydration mismatch on dashboard"
   git commit -m "docs: update API endpoint documentation"
   ```
6. **Push** to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
7. **Open a Pull Request** against `master`

## Development Setup

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/GitScope.git
cd GitScope/gitscope

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env.local
# Edit .env.local with your values

# 4. Set up database
npx prisma db push

# 5. Start development server
npm run dev
```

Visit `http://localhost:3000`

## Coding Standards

### TypeScript
- Use **strict TypeScript** throughout
- Avoid `any` — use proper types or `unknown` with type guards
- Export types and interfaces from their own files when shared

### Code Style
- Follow the existing code style — consistency matters
- Use **Prettier** for formatting (config included)
- Use **ESLint** for linting (run `npm run lint`)

### Naming Conventions
- Components: PascalCase (`UserProfile.tsx`)
- Utilities/hooks: camelCase (`useAuth.ts`, `formatDate.ts`)
- Constants: UPPER_SNAKE_CASE for true constants
- Files should match their default export name

### Commits
Follow [Conventional Commits](https://www.conventionalcommits.org):

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Code style (formatting, missing semicolons, etc.) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `chore` | Build process or auxiliary tool changes |
| `security` | Security-related changes |

Examples:
```
feat(auth): add Google OAuth provider
fix(api): resolve rate limit calculation error
docs(readme): update environment variable section
security(middleware): add CSRF token validation
```

### Testing
- Write tests for new features when possible
- Run tests before submitting PR: `npm test`
- Maintain or improve test coverage

### Database Changes
- Modify `prisma/schema.prisma` for schema changes
- Generate migrations: `npx prisma migrate dev --name descriptive_name`
- Update seed data if needed

## Project Structure

```
src/
├── app/              # Next.js App Router
│   ├── (dashboard)/  # Dashboard route group
│   ├── (site)/       # Marketing/site pages
│   └── api/          # API routes
├── components/       # Shared React components
├── features/         # Feature-specific modules
├── hooks/            # Custom React hooks
├── lib/              # Utility libraries
├── constants/        # App constants
└── types/            # Shared TypeScript types
```

## Security

If you discover a security vulnerability, **DO NOT** open an issue. Email **security@gitscope.dev** instead. See [SECURITY.md](SECURITY.md) for details.

## Questions?

- Open a [Discussion](https://github.com/AshishLekhyani/GitScope/discussions) for questions
- Join our community (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

Thank you for contributing! 🚀
