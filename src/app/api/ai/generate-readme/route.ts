export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";
import { callAI, hasAnyAIProvider } from "@/lib/ai-providers";
import { resolveAiPlanFromSessionDb } from "@/lib/ai-plan";
import type { AIPlan } from "@/lib/ai-providers";

// ── GitHub helpers ─────────────────────────────────────────────────────────

async function fetchWithToken(url: string, token: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers, next: { revalidate: 60 } });
}

async function fetchRepoMeta(fullName: string, token: string) {
  const res = await fetchWithToken(`https://api.github.com/repos/${fullName}`, token);
  if (!res.ok) return null;
  return res.json();
}

async function fetchFileTree(fullName: string, token: string): Promise<string[]> {
  const res = await fetchWithToken(
    `https://api.github.com/repos/${fullName}/git/trees/HEAD?recursive=1`,
    token
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.tree ?? [])
    .filter((f: { type: string }) => f.type === "blob")
    .map((f: { path: string }) => f.path);
}

async function fetchFileContent(fullName: string, path: string, token: string): Promise<string> {
  const res = await fetchWithToken(
    `https://api.github.com/repos/${fullName}/contents/${path}`,
    token
  );
  if (!res.ok) return "";
  const data = await res.json();
  if (data.encoding === "base64" && data.content) {
    try {
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8").slice(0, 4000);
    } catch { return ""; }
  }
  return "";
}

async function fetchRecentContributors(fullName: string, token: string): Promise<string[]> {
  const res = await fetchWithToken(
    `https://api.github.com/repos/${fullName}/contributors?per_page=8`,
    token
  );
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data.map((c: { login: string }) => c.login) : [];
}

// ── Key files to read for context ──────────────────────────────────────────

const KEY_CONFIG_FILES = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile",
  ".env.example",
  "docker-compose.yml",
  "Makefile",
];

const KEY_ENTRY_PATTERNS = [
  /^(src\/|app\/)?main\.(ts|js|py|go|rs)$/,
  /^(src\/)?index\.(ts|js)$/,
  /^app\.(ts|js|py)$/,
  /^server\.(ts|js)$/,
  /^src\/app\/page\.(tsx|jsx)$/,
];

// ── Handler ─────────────────────────────────────────────────────────────────

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!hasAnyAIProvider()) {
    return NextResponse.json(
      { error: "AI not configured — no AI provider keys set" },
      { status: 503 }
    );
  }

  let body: { repo?: string; style?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { repo, style = "standard" } = body;
  if (!repo || typeof repo !== "string") {
    return NextResponse.json({ error: "repo field required (e.g. 'owner/repo')" }, { status: 400 });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return NextResponse.json({ error: "Invalid repo format" }, { status: 400 });
  }
  if (!["standard", "minimal", "detailed"].includes(style)) {
    return NextResponse.json({ error: "style must be standard | minimal | detailed" }, { status: 400 });
  }

  const plan = await resolveAiPlanFromSessionDb(session) as AIPlan;
  const token = await getGitHubToken() ?? "";

  const [meta, fileTree, contributors] = await Promise.all([
    fetchRepoMeta(repo, token),
    fetchFileTree(repo, token),
    fetchRecentContributors(repo, token),
  ]);

  if (!meta) {
    return NextResponse.json({ error: "Repository not found or inaccessible" }, { status: 404 });
  }

  // Collect key file contents
  const filesToFetch: string[] = [];
  for (const name of KEY_CONFIG_FILES) {
    if (fileTree.includes(name)) filesToFetch.push(name);
  }
  for (const pattern of KEY_ENTRY_PATTERNS) {
    const match = fileTree.find((f) => pattern.test(f));
    if (match && !filesToFetch.includes(match)) filesToFetch.push(match);
  }
  // Also grab existing README if present (to avoid repeating its style)
  const existingReadme = fileTree.find((f) => /^readme\.md$/i.test(f));
  if (existingReadme) filesToFetch.push(existingReadme);

  const fileContents: Record<string, string> = {};
  await Promise.all(
    filesToFetch.slice(0, 10).map(async (f) => {
      fileContents[f] = await fetchFileContent(repo, f, token);
    })
  );

  // Detect key characteristics
  const pkgJson = fileContents["package.json"] ? (() => {
    try { return JSON.parse(fileContents["package.json"]); } catch { return null; }
  })() : null;

  const deps = { ...(pkgJson?.dependencies ?? {}), ...(pkgJson?.devDependencies ?? {}) };
  const scripts = pkgJson?.scripts ?? {};
  const hasNextJs = "next" in deps;
  const hasReact = "react" in deps;
  const hasExpress = "express" in deps;
  const hasFastify = "fastify" in deps;
  const hasNestJs = "@nestjs/core" in deps;
  const hasPrisma = "@prisma/client" in deps;
  const hasMongoDB = "mongodb" in deps || "mongoose" in deps;
  const hasDocker = fileTree.some((f) => /^Dockerfile/i.test(f));
  const hasK8s = fileTree.some((f) => /\.yaml$/.test(f) && f.includes("k8s"));
  const hasTerraform = fileTree.some((f) => f.endsWith(".tf"));
  const hasTests = fileTree.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(f));
  const hasCI = fileTree.some((f) => f.startsWith(".github/workflows/"));
  const isPython = fileTree.some((f) => f === "pyproject.toml" || f === "setup.py" || f === "requirements.txt");
  const isGo = fileTree.some((f) => f === "go.mod");
  const isRust = fileTree.some((f) => f === "Cargo.toml");

  const techStack: string[] = [];
  if (hasNextJs) techStack.push("Next.js");
  else if (hasReact) techStack.push("React");
  if (hasExpress) techStack.push("Express");
  if (hasFastify) techStack.push("Fastify");
  if (hasNestJs) techStack.push("NestJS");
  if (hasPrisma) techStack.push("Prisma");
  if (hasMongoDB) techStack.push("MongoDB");
  if (hasDocker) techStack.push("Docker");
  if (hasK8s) techStack.push("Kubernetes");
  if (hasTerraform) techStack.push("Terraform");
  if (isPython) techStack.push("Python");
  if (isGo) techStack.push("Go");
  if (isRust) techStack.push("Rust");
  if ("typescript" in deps || fileTree.some((f) => f === "tsconfig.json")) techStack.push("TypeScript");

  const fileSnapshot = fileTree.slice(0, 80).join("\n");
  const pkgJsonSummary = pkgJson
    ? `Name: ${pkgJson.name ?? "unknown"}\nVersion: ${pkgJson.version ?? "unknown"}\nDescription: ${pkgJson.description ?? "none"}\nScripts: ${Object.keys(scripts).join(", ")}\nMain dependencies: ${Object.keys(deps).slice(0, 20).join(", ")}`
    : "";

  const existingReadmeContent = existingReadme ? fileContents[existingReadme] : "";
  const entryFileContent = KEY_ENTRY_PATTERNS
    .map((p) => fileTree.find((f) => p.test(f)))
    .filter(Boolean)
    .map((f) => fileContents[f!])
    .find(Boolean) ?? "";

  const styleInstructions =
    style === "minimal"
      ? "Keep the README concise — 300-500 words. Cover only: what it does, quick install, basic usage, license."
      : style === "detailed"
      ? "Write a comprehensive README — include all sections, detailed API docs if relevant, architecture diagram description, troubleshooting, FAQ, contributing guide, and code examples."
      : "Write a professional standard README — cover all main sections clearly and concisely. Aim for 600-900 words.";

  const systemPrompt =
    "You are a senior technical writer and developer advocate. You write clear, professional, developer-friendly README files in GitHub-Flavored Markdown. You never invent features — you only document what you can infer from the provided context.";

  const userPrompt = `Generate a professional README.md for the GitHub repository "${repo}".

${styleInstructions}

## Repository Context

**GitHub metadata:**
- Description: ${meta.description ?? "None provided"}
- Primary language: ${meta.language ?? "Unknown"}
- Stars: ${meta.stargazers_count?.toLocaleString() ?? 0}, Forks: ${meta.forks_count ?? 0}
- Topics: ${(meta.topics ?? []).join(", ") || "None"}
- License: ${meta.license?.name ?? "Not specified"}
- Created: ${meta.created_at ? new Date(meta.created_at).getFullYear() : "Unknown"}
- Contributors: ${contributors.join(", ") || "Unknown"}

**Tech stack detected:** ${techStack.length > 0 ? techStack.join(", ") : "Unknown — infer from files"}

${pkgJsonSummary ? `**package.json summary:**\n${pkgJsonSummary}\n` : ""}

**File tree (first 80 files):**
\`\`\`
${fileSnapshot}
\`\`\`

${entryFileContent ? `**Main entry file (excerpt):**\n\`\`\`\n${entryFileContent.slice(0, 1500)}\n\`\`\`\n` : ""}

${existingReadmeContent ? `**Existing README (for reference, improve upon it):**\n${existingReadmeContent.slice(0, 1000)}\n` : ""}

## Required README Sections (include all that are relevant):

1. **Project name + badges** — build status, license, version, stars (use shield.io badge markdown)
2. **One-line description** — clear, compelling
3. **Table of contents** (if detailed mode)
4. **Features** — bullet list of key capabilities
5. **Tech stack** — technologies used
6. **Prerequisites** — system requirements (Node version, etc.)
7. **Installation** — step-by-step with code blocks
8. **Environment setup** — .env variables needed (reference .env.example if detected)
9. **Usage / Quick start** — how to run the project, key commands from package.json scripts
10. **Project structure** — brief explanation of key directories
11. **Contributing** — how to contribute
12. **License** — from package.json or repo metadata

Output ONLY the raw markdown for the README.md file. No preamble, no explanation, no code fences around the entire document.`;

  try {
    const result = await callAI({
      plan,
      systemPrompt,
      userPrompt,
      maxTokens: style === "detailed" ? 2048 : 1024,
    });

    if (!result) {
      return NextResponse.json({ error: "AI generation failed — no provider available" }, { status: 500 });
    }

    return NextResponse.json({
      readme: result.text,
      repo,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      context: {
        techStack,
        fileCount: fileTree.length,
        hasExistingReadme: !!existingReadme,
        style,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.error("[AI generate-readme]", err);
    return NextResponse.json({ error: "README generation failed" }, { status: 500 });
  }
}

export const POST = withRouteSecurity(handler, SecurityPresets.ai);
