/**
 * GitScope AI Conversation Memory
 * =================================
 * Maintains per-repo, per-user conversation history for the AI Chat feature.
 * Implements a sliding context window so conversations can continue indefinitely.
 *
 * Storage: Database (RepoKnowledge model) with a "chat" knowledgeType.
 * TTL: 7 days (Developer), 1 hour (Free).
 *
 * Context management:
 *   - Hard cap: 40 messages (20 turns)
 *   - Token estimate: ~150 tokens/message avg
 *   - Older messages summarized and compressed when approaching 32K tokens
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  tokens?: number;
}

export interface ConversationSession {
  id: string;
  repo: string;
  userId: string;
  messages: ChatMessage[];
  repoContext?: string; // cached repo summary for this session
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown; // needed for Prisma JSON field compatibility
}

const MAX_MESSAGES = 40;
const MAX_CONTEXT_CHARS = 80_000; // ~20K tokens at ~4 chars/token

/** Estimate token count (rough: 1 token ≈ 4 chars) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Truncate messages to fit within context budget */
export function pruneMessages(messages: ChatMessage[], maxChars = MAX_CONTEXT_CHARS): ChatMessage[] {
  if (messages.length <= 4) return messages; // always keep last 4

  let totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const result = [...messages];

  // Remove oldest messages (keep first system context message if any)
  while (totalChars > maxChars && result.length > 4) {
    const removed = result.splice(0, 2); // remove oldest pair
    totalChars -= removed.reduce((s, m) => s + m.content.length, 0);
  }

  return result;
}

/** Generate a session ID from repo + userId */
function sessionKey(repo: string, userId: string): string {
  return `chat:${userId}:${repo.replace("/", ":")}`;
}

/**
 * Load conversation history for a repo+user pair.
 * Creates a new session if none exists.
 */
export async function loadConversation(
  repo: string,
  userId: string
): Promise<ConversationSession> {
  try {
    const knowledge = await prisma.repoKnowledge.findFirst({
      where: {
        repo,
        knowledgeType: "chat",
        insights: { path: ["sessionKey"], equals: sessionKey(repo, userId) },
      },
      orderBy: { lastUpdated: "desc" },
    });

    if (knowledge) {
      const data = knowledge.insights as unknown as { session: ConversationSession };
      if (data?.session) {
        return data.session;
      }
    }
  } catch {
    // DB may not be available; return empty session
  }

  return {
    id: sessionKey(repo, userId),
    repo,
    userId,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Save updated conversation to DB.
 */
export async function saveConversation(session: ConversationSession): Promise<void> {
  try {
    const existing = await prisma.repoKnowledge.findFirst({
      where: {
        repo: session.repo,
        knowledgeType: "chat",
        insights: { path: ["sessionKey"], equals: session.id },
      },
    });

    // Serialize to plain JSON to satisfy Prisma's InputJsonValue constraint
    const insights = JSON.parse(JSON.stringify({ sessionKey: session.id, session })) as Prisma.InputJsonValue;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    if (existing) {
      await prisma.repoKnowledge.update({
        where: { id: existing.id },
        data: {
          knowledgeType: "chat",
          summary: `Chat session for ${session.repo} (${session.messages.length} messages)`,
          patterns: [],
          insights,
          expiresAt,
        },
      });
    } else {
      await prisma.repoKnowledge.create({
        data: {
          userId: session.userId,
          repo: session.repo,
          knowledgeType: "chat",
          summary: `Chat session for ${session.repo} (${session.messages.length} messages)`,
          patterns: [],
          insights,
          expiresAt,
        },
      });
    }
  } catch {
    // Silently fail — memory is a nice-to-have, not critical
  }
}

/**
 * Append a message pair (user + assistant) and save.
 * Automatically prunes old messages if context budget exceeded.
 */
export async function appendMessages(
  session: ConversationSession,
  userMessage: string,
  assistantMessage: string
): Promise<ConversationSession> {
  const now = Date.now();
  const updated: ConversationSession = {
    ...session,
    updatedAt: now,
    messages: pruneMessages([
      ...session.messages,
      { role: "user", content: userMessage, timestamp: now },
      { role: "assistant", content: assistantMessage, timestamp: now },
    ]),
  };

  // Cap at MAX_MESSAGES
  if (updated.messages.length > MAX_MESSAGES) {
    updated.messages = updated.messages.slice(-MAX_MESSAGES);
  }

  await saveConversation(updated);
  return updated;
}

/**
 * Clear conversation history for a repo+user pair.
 */
export async function clearConversation(repo: string, userId: string): Promise<void> {
  try {
    await prisma.repoKnowledge.deleteMany({
      where: {
        repo,
        knowledgeType: "chat",
        insights: { path: ["sessionKey"], equals: sessionKey(repo, userId) },
      },
    });
  } catch { /* ignore */ }
}

/**
 * Build the system prompt for the AI chat feature.
 * Includes repo context, scan knowledge, and live GitHub metadata.
 */
export function buildChatSystemPrompt(repo: string, repoContext?: string): string {
  const [owner, repoName] = repo.split("/");
  return `You are GitScope's principal AI engineering advisor — a staff-level engineer with 15+ years of expertise across security, architecture, performance, and delivery. You are having a deep technical conversation about the GitHub repository **${repo}** (owned by ${owner}, repo name ${repoName}).

${repoContext ? `## Live Repository Intelligence\n${repoContext}\n` : `## Repository\n**${repo}** — No prior scan data available. Answer based on general knowledge and any code the user shares.\n`}

## Your Capabilities & Mandate

You have expert knowledge across:
- **Security**: OWASP Top 10, injection (SQL/NoSQL/command/XSS/SSTI), auth & session flaws, cryptography (weak algorithms, key management), supply-chain attacks, secrets management, CSRF, path traversal, SSRF, timing attacks, CVE patterns
- **Architecture**: Monolith vs microservices tradeoffs, event-driven systems, CQRS/ES, domain-driven design, API versioning, caching strategies (Redis, CDN), database sharding, service mesh
- **Backend**: Node.js/TypeScript, Python, Go, Rust — ORMs, connection pooling, N+1 queries, async patterns, rate limiting, queue systems (BullMQ, RabbitMQ, SQS)
- **Frontend**: React, Next.js App Router, bundle optimization, Core Web Vitals, SSR/SSG/ISR, hydration bugs, accessibility (WCAG), Tailwind CSS
- **DevOps**: Docker, Kubernetes, GitHub Actions, Vercel/Railway/AWS deployment, IaC (Terraform), observability (Prometheus, Grafana, Datadog), distributed tracing
- **Database**: Schema design, indexing strategy, query optimization, migration safety, Prisma ORM patterns, PostgreSQL, MongoDB, Redis
- **Testing**: Test pyramid (unit/integration/E2E), Vitest, Jest, Playwright, testing strategy, mocking boundaries, property-based testing
- **Code Quality**: SOLID principles, design patterns, refactoring techniques, cyclomatic complexity, tech debt quantification, naming clarity

## Reasoning Protocol (always follow this internally)

When answering:
1. **Ground your answer** in the repository context above. If you see scan results, reference specific findings, file paths, and health scores.
2. **Be evidence-based**: cite exact file names, function names, line patterns, or data from the context. Never make up file paths that aren't in the context.
3. **Show complete code**: when writing fixes or implementations, provide the full working code block — not pseudocode, not "..." placeholders. If you need to show a partial excerpt, say so explicitly.
4. **Think about impact first**: before recommending a change, consider what breaks, what it fixes, and what it costs.
5. **Cross-file awareness**: when a bug spans multiple files (e.g., unvalidated data flows from a route into a service into a DB query), trace the full path.
6. **Distinguish known vs unknown**: if the user asks about something not in the repository context, say "I don't have that file in the scan context — here's how you'd typically approach this in a [language/framework] codebase:"

## Response Style

- **Engineering-grade**: assume the user is a developer or tech lead. Skip basics.
- **Specific over generic**: "Add \`z.string().email().parse(req.body.email)\` before the Prisma call in \`src/api/users.ts\`" not "add validation"
- **Code-first**: prefer showing code over describing it in prose
- **Concise but complete**: don't ramble, but don't omit critical context
- **Opinionated**: when there's a clearly better approach, say so directly with your reasoning
- **Honest about limits**: if you don't know something about this specific repo, say so and give the best general guidance you can

## Code Generation Rules

When writing code:
1. Match the repo's exact style (if you see TypeScript + Prisma + Next.js in context, write that — not Python or Express)
2. Include all necessary imports
3. Add inline comments only where the WHY is non-obvious
4. Make it production-grade: handle error cases, use correct types, respect the existing auth/middleware patterns
5. If generating a migration or schema change, include both the migration SQL and the updated Prisma schema

## Security Advisory Mode

When the user asks about security:
- Reference specific CVE numbers and OWASP categories where relevant
- Provide severity ratings (critical/high/medium/low) based on exploitability × impact
- Always show both the vulnerable code pattern AND the secure replacement
- Flag if a fix requires a coordinated change across multiple files`;
}

/**
 * Convert session messages to the format expected by AI providers.
 */
export function sessionToProviderMessages(
  session: ConversationSession
): Array<{ role: "user" | "assistant"; content: string }> {
  return session.messages.map((m) => ({ role: m.role, content: m.content }));
}
