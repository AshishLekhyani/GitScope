/**
 * GitScope AI Tool Definitions & Executors
 * ==========================================
 * Implements Claude-compatible tool_use and OpenAI function-calling tools.
 * When BYOK Anthropic or OpenAI keys are present, the AI can call these tools
 * during multi-turn analysis to fetch live data, run checks, and compute metrics.
 *
 * Tools are real — each has an actual TypeScript executor that runs server-side.
 */

// ── Tool Schema Types (Anthropic-compatible) ────────────────────────────────

export interface ToolProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface AITool {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  /** The executor that runs server-side when this tool is called */
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
  repo?: string;
  fileContents?: Record<string, string>; // filename → content
  githubToken?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  output: string;
  isError: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeRegex(s: string): RegExp {
  try { return new RegExp(s, "gi"); }
  catch { return /(?!)/; }
}

function lineNumber(content: string, matchIndex: number): number {
  return content.slice(0, matchIndex).split("\n").length;
}

/** Cyclomatic complexity estimate: count decision points in a function body */
function estimateCyclomatic(code: string): number {
  const decisionKeywords = /\b(if|else if|for|while|do|switch|case|catch|\?\?|&&|\|\||ternary)\b/g;
  return 1 + (code.match(decisionKeywords) ?? []).length;
}

/** Cognitive complexity estimate (simplified Sonar model) */
function estimateCognitive(code: string): number {
  let score = 0;
  let nesting = 0;
  const lines = code.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(if|else if|for|while|do)\b/.test(trimmed)) { score += 1 + nesting; nesting++; }
    else if (/^else\b/.test(trimmed)) { score += 1; }
    else if (/^(switch|catch)\b/.test(trimmed)) { score += 1 + nesting; nesting++; }
    else if (/&&|\|\|/.test(trimmed)) { score += 1; }
    else if (/\}/.test(trimmed) && nesting > 0) { nesting--; }
  }
  return score;
}

// ── Tool Definitions ────────────────────────────────────────────────────────

export const SEARCH_CODE_TOOL: AITool = {
  name: "search_code",
  description: "Search for a specific pattern or identifier across the fetched file contents. Returns file names, line numbers, and surrounding context (3 lines). Use this to verify if a pattern exists before flagging it as a finding.",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern or literal string to search for",
      },
      file_filter: {
        type: "string",
        description: "Optional glob-like filter (e.g. '*.ts', 'auth*'). Leave empty to search all files.",
      },
      context_lines: {
        type: "number",
        description: "Number of lines of context to return around each match (1-10, default 3)",
      },
    },
    required: ["pattern"],
  },
  async execute(input, ctx) {
    const pattern = String(input.pattern ?? "");
    const fileFilter = String(input.file_filter ?? "");
    const ctxLines = Math.min(10, Math.max(1, Number(input.context_lines ?? 3)));
    const regex = escapeRegex(pattern);
    const results: string[] = [];

    for (const [file, content] of Object.entries(ctx.fileContents ?? {})) {
      if (fileFilter && !new RegExp(fileFilter.replace("*", ".*")).test(file)) continue;
      const lines = content.split("\n");
      let match: RegExpExecArray | null;
      regex.lastIndex = 0;
      while ((match = regex.exec(content)) !== null) {
        const lineNum = lineNumber(content, match.index);
        const start = Math.max(0, lineNum - 1 - ctxLines);
        const end = Math.min(lines.length - 1, lineNum - 1 + ctxLines);
        const snippet = lines
          .slice(start, end + 1)
          .map((l, i) => `${start + i + 1}${start + i + 1 === lineNum ? " →" : "  "} ${l}`)
          .join("\n");
        results.push(`## ${file}:${lineNum}\n\`\`\`\n${snippet}\n\`\`\``);
        if (results.length >= 20) break; // safety cap
      }
      if (results.length >= 20) break;
    }

    if (results.length === 0) {
      return `No matches found for pattern: \`${pattern}\`${fileFilter ? ` in files matching \`${fileFilter}\`` : ""}`;
    }
    return `Found ${results.length} match(es) for \`${pattern}\`:\n\n${results.join("\n\n")}`;
  },
};

export const ANALYZE_COMPLEXITY_TOOL: AITool = {
  name: "analyze_complexity",
  description: "Calculate cyclomatic and cognitive complexity metrics for a specific file or function. Returns complexity scores and identifies hotspots that exceed thresholds (cyclomatic > 10, cognitive > 15).",
  input_schema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Exact filename to analyze (must be in the fetched file list)",
      },
      function_name: {
        type: "string",
        description: "Optional: specific function name to analyze. If omitted, analyzes the whole file.",
      },
    },
    required: ["filename"],
  },
  async execute(input, ctx) {
    const filename = String(input.filename ?? "");
    const fnName = String(input.function_name ?? "");
    const content = ctx.fileContents?.[filename];
    if (!content) return `File \`${filename}\` not found in fetched content. Available files: ${Object.keys(ctx.fileContents ?? {}).join(", ")}`;

    const lines = content.split("\n");
    const totalLines = lines.length;
    const codeLines = lines.filter((l) => l.trim() && !l.trim().startsWith("//") && !l.trim().startsWith("*")).length;

    // Find function boundaries if fnName provided
    let targetCode = content;
    let fnStart = 1;
    if (fnName) {
      const fnRegex = new RegExp(`(?:function\\s+${fnName}|${fnName}\\s*[=:]\\s*(?:async\\s+)?(?:function|\\())`);
      const match = content.match(fnRegex);
      if (match) {
        fnStart = lineNumber(content, match.index ?? 0);
        // Extract function body (simple bracket matching)
        let depth = 0;
        let started = false;
        const fnLines: string[] = [];
        for (let i = fnStart - 1; i < lines.length; i++) {
          fnLines.push(lines[i]);
          for (const ch of lines[i]) {
            if (ch === "{") { depth++; started = true; }
            if (ch === "}") { depth--; }
          }
          if (started && depth === 0) break;
        }
        targetCode = fnLines.join("\n");
      } else {
        return `Function \`${fnName}\` not found in \`${filename}\`. Try search_code to locate it.`;
      }
    }

    const cyclomatic = estimateCyclomatic(targetCode);
    const cognitive = estimateCognitive(targetCode);

    const cyclomaticRisk = cyclomatic > 20 ? "🔴 CRITICAL" : cyclomatic > 10 ? "🟡 HIGH" : cyclomatic > 5 ? "🟢 MODERATE" : "✅ LOW";
    const cognitiveRisk = cognitive > 30 ? "🔴 CRITICAL" : cognitive > 15 ? "🟡 HIGH" : cognitive > 8 ? "🟢 MODERATE" : "✅ LOW";

    // Find all functions with high complexity
    const fnMatches = [...content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/g)];
    const hotspots = fnMatches
      .map((m) => {
        const name = m[1] ?? m[2];
        const idx = m.index ?? 0;
        const slice = content.slice(idx, idx + 1000); // first 1000 chars of fn
        return { name, cyclomatic: estimateCyclomatic(slice), cognitive: estimateCognitive(slice) };
      })
      .filter((f) => f.cyclomatic > 10 || f.cognitive > 15)
      .sort((a, b) => (b.cyclomatic + b.cognitive) - (a.cyclomatic + a.cognitive))
      .slice(0, 5);

    return `# Complexity Analysis: ${fnName ? `${filename}::${fnName}` : filename}

## Metrics
| Metric | Value | Risk |
|--------|-------|------|
| Cyclomatic Complexity | ${cyclomatic} | ${cyclomaticRisk} |
| Cognitive Complexity | ${cognitive} | ${cognitiveRisk} |
| Total Lines | ${totalLines} | — |
| Code Lines (non-comment/blank) | ${codeLines} | — |

## Interpretation
- **Cyclomatic > 10**: Hard to test (requires many test cases to achieve branch coverage)
- **Cognitive > 15**: Hard to understand at a glance (slows code review & onboarding)
- **Refactoring threshold**: Break up any function with cyclomatic > 10 OR cognitive > 15

${hotspots.length > 0 ? `## High-Complexity Hotspots in File
${hotspots.map((h) => `- \`${h.name}\`: cyclomatic=${h.cyclomatic}, cognitive=${h.cognitive}`).join("\n")}` : ""}`;
  },
};

export const CHECK_DEPENDENCY_TOOL: AITool = {
  name: "check_dependency",
  description: "Check a specific npm/pip/go package for known vulnerabilities, latest version, and risk assessment. Returns CVE count, severity, and upgrade advice.",
  input_schema: {
    type: "object",
    properties: {
      package_name: {
        type: "string",
        description: "Package name (e.g. 'lodash', 'express', 'next')",
      },
      package_version: {
        type: "string",
        description: "Current version being used (e.g. '4.17.15')",
      },
      ecosystem: {
        type: "string",
        description: "Package ecosystem",
        enum: ["npm", "PyPI", "Go", "Maven", "RubyGems", "Cargo", "NuGet"],
      },
    },
    required: ["package_name", "ecosystem"],
  },
  async execute(input) {
    const pkg = String(input.package_name ?? "");
    const version = String(input.package_version ?? "");
    const ecosystem = String(input.ecosystem ?? "npm");

    // Query Google OSV API (free, no auth required)
    const query = version
      ? { version: { name: pkg, ecosystem }, package: { name: pkg, ecosystem } }
      : { package: { name: pkg, ecosystem } };

    try {
      const response = await fetch("https://api.osv.dev/v1/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      if (!response.ok) return `Failed to query OSV for ${pkg}: HTTP ${response.status}`;

      const data = (await response.json()) as { vulns?: Array<{ id: string; summary: string; severity?: Array<{ score: number }>; aliases?: string[] }> };
      const vulns = data.vulns ?? [];

      if (vulns.length === 0) {
        return `✅ **${pkg}@${version || "any"}** — No known vulnerabilities found in OSV database for ecosystem: ${ecosystem}`;
      }

      const critical = vulns.filter((v) => (v.severity?.[0]?.score ?? 0) >= 9.0);
      const high = vulns.filter((v) => { const s = v.severity?.[0]?.score ?? 0; return s >= 7.0 && s < 9.0; });
      const medium = vulns.filter((v) => { const s = v.severity?.[0]?.score ?? 0; return s >= 4.0 && s < 7.0; });

      const lines = [
        `⚠️ **${pkg}@${version || "any"}** — ${vulns.length} vulnerability(s) found`,
        ``,
        `| Severity | Count |`,
        `|----------|-------|`,
        `| 🔴 Critical (CVSS ≥ 9.0) | ${critical.length} |`,
        `| 🟠 High (7.0–8.9) | ${high.length} |`,
        `| 🟡 Medium (4.0–6.9) | ${medium.length} |`,
        ``,
        `## Top Vulnerabilities`,
      ];

      for (const v of vulns.slice(0, 5)) {
        const score = v.severity?.[0]?.score;
        const cves = (v.aliases ?? []).filter((a) => a.startsWith("CVE-")).join(", ");
        lines.push(`- **${v.id}** ${cves ? `(${cves})` : ""} — CVSS: ${score?.toFixed(1) ?? "N/A"} — ${v.summary?.slice(0, 120) ?? "No summary"}`);
      }

      lines.push(`\n**Recommendation:** Upgrade ${pkg} to the latest patched version. Check https://osv.dev/list?q=${encodeURIComponent(pkg)} for full details.`);
      return lines.join("\n");
    } catch (err) {
      return `Error querying OSV API for ${pkg}: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const ANALYZE_COUPLING_TOOL: AITool = {
  name: "analyze_coupling",
  description: "Analyze the import/dependency graph of a file to detect high coupling (too many dependencies or circular-like patterns). Returns a coupling score and list of dependencies.",
  input_schema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "File to analyze for coupling",
      },
    },
    required: ["filename"],
  },
  async execute(input, ctx) {
    const filename = String(input.filename ?? "");
    const content = ctx.fileContents?.[filename];
    if (!content) return `File \`${filename}\` not found.`;

    // Extract all imports
    const importMatches = [...content.matchAll(/import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)?\s*from\s+['"]([^'"]+)['"]/gm)];
    const requireMatches = [...content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/gm)];
    const allImports = [...importMatches.map((m) => m[1]), ...requireMatches.map((m) => m[1])];

    const internal = allImports.filter((i) => i.startsWith(".") || i.startsWith("@/"));
    const external = allImports.filter((i) => !i.startsWith(".") && !i.startsWith("@/"));
    const totalCoupling = allImports.length;

    const couplingRisk = totalCoupling > 20 ? "🔴 HIGH" : totalCoupling > 12 ? "🟡 MODERATE" : "✅ LOW";

    // Check if any internal dep is also importing this file (shallow circular check)
    const circular: string[] = [];
    const fileBase = filename.replace(/\.[^.]+$/, "").replace(/^.*\//, "");
    for (const dep of internal) {
      const depFile = dep.replace(/^[@/]/, "").replace(/\//g, "/");
      for (const [f, c] of Object.entries(ctx.fileContents ?? {})) {
        if (f !== filename && f.includes(depFile) && c.includes(fileBase)) {
          circular.push(dep);
          break;
        }
      }
    }

    return `# Coupling Analysis: ${filename}

## Summary
| Metric | Value | Risk |
|--------|-------|------|
| Total Dependencies | ${totalCoupling} | ${couplingRisk} |
| Internal (local) | ${internal.length} | — |
| External (packages) | ${external.length} | — |
| Potential Circular | ${circular.length} | ${circular.length > 0 ? "🟡 CHECK" : "✅ None"} |

## Internal Dependencies
${internal.length > 0 ? internal.map((i) => `- \`${i}\``).join("\n") : "None"}

## External Dependencies
${external.length > 0 ? external.map((e) => `- \`${e}\``).join("\n") : "None"}

${circular.length > 0 ? `## ⚠️ Potential Circular Dependencies\n${circular.map((c) => `- \`${c}\` may create a cycle — verify with a dependency graph tool`).join("\n")}` : ""}

## Recommendation
${totalCoupling > 20 ? `This file has ${totalCoupling} dependencies — well above the recommended maximum of 10-12. Consider splitting into smaller modules or applying the Facade pattern to reduce coupling.` : totalCoupling > 12 ? `Coupling is moderate. Review whether all ${internal.length} internal imports are truly necessary.` : "Coupling is within healthy bounds."}`;
  },
};

export const ESTIMATE_TEST_COVERAGE_TOOL: AITool = {
  name: "estimate_test_coverage",
  description: "Estimate test coverage for a file by analyzing its exported functions/classes and checking if corresponding test files exist. Returns an estimated coverage percentage and lists untested exports.",
  input_schema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "Source file to estimate coverage for",
      },
    },
    required: ["filename"],
  },
  async execute(input, ctx) {
    const filename = String(input.filename ?? "");
    const content = ctx.fileContents?.[filename];
    if (!content) return `File \`${filename}\` not found.`;

    // Find all exports
    const exportMatches = [
      ...content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/gm),
      ...content.matchAll(/export\s+(?:const|let|class)\s+(\w+)/gm),
      ...content.matchAll(/export\s+default\s+(?:function\s+)?(\w+)/gm),
    ];
    const exports = [...new Set(exportMatches.map((m) => m[1]))].filter(Boolean);

    // Look for test files
    const baseName = filename.replace(/\.[^.]+$/, "").replace(/^.*\/([^/]+)$/, "$1");
    const testFiles = Object.keys(ctx.fileContents ?? {}).filter((f) =>
      f.includes(baseName) && (f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__"))
    );

    const testContent = testFiles.map((f) => ctx.fileContents?.[f] ?? "").join("\n");
    const tested = exports.filter((fn) => testContent.includes(fn));
    const untested = exports.filter((fn) => !testContent.includes(fn));
    const coverage = exports.length > 0 ? Math.round((tested.length / exports.length) * 100) : 0;

    const riskLevel = coverage < 30 ? "🔴 CRITICAL" : coverage < 60 ? "🟡 LOW" : coverage < 80 ? "🟢 MODERATE" : "✅ GOOD";

    return `# Test Coverage Estimate: ${filename}

## Coverage
| Metric | Value | Status |
|--------|-------|--------|
| Estimated Coverage | ${coverage}% | ${riskLevel} |
| Exported Symbols | ${exports.length} | — |
| Tested (found in test files) | ${tested.length} | — |
| Untested | ${untested.length} | — |
| Test Files Found | ${testFiles.length} | ${testFiles.length === 0 ? "⚠️ NONE" : "✅"} |

${testFiles.length > 0 ? `## Test Files\n${testFiles.map((f) => `- \`${f}\``).join("\n")}` : "## ⚠️ No Test Files Found\nNo test file found for `" + baseName + "`. Create `" + baseName + ".test.ts` or `" + baseName + ".spec.ts`."}

${untested.length > 0 ? `## Untested Exports\n${untested.map((fn) => `- \`${fn}\``).join("\n")}` : ""}

## Recommendation
${coverage < 60 ? `Coverage is critically low at ${coverage}%. Prioritize testing: ${untested.slice(0, 3).map((fn) => `\`${fn}\``).join(", ")}${untested.length > 3 ? ` and ${untested.length - 3} more` : ""}.` : coverage < 80 ? `Coverage is acceptable but could be improved. Focus on edge cases for: ${untested.map((fn) => `\`${fn}\``).join(", ")}.` : "Coverage looks solid. Ensure edge cases and error paths are covered."}`;
  },
};

export const GENERATE_FIX_TOOL: AITool = {
  name: "generate_fix",
  description: "Generate a concrete code fix for a specific finding. Returns the original vulnerable/problematic code and the fixed version as a unified diff.",
  input_schema: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "File containing the issue",
      },
      issue_description: {
        type: "string",
        description: "Brief description of the issue to fix",
      },
      line_number: {
        type: "number",
        description: "Approximate line number where the issue is",
      },
    },
    required: ["filename", "issue_description"],
  },
  async execute(input, ctx) {
    const filename = String(input.filename ?? "");
    const issue = String(input.issue_description ?? "");
    const lineNum = Number(input.line_number ?? 0);
    const content = ctx.fileContents?.[filename];

    if (!content) return `File \`${filename}\` not found.`;

    // Extract context around the line
    const lines = content.split("\n");
    const start = Math.max(0, lineNum - 5);
    const end = Math.min(lines.length - 1, lineNum + 15);
    const snippet = lines.slice(start, end + 1).join("\n");

    // This tool is a hint generator — the actual fix generation is done by the LLM
    return `## Code Context for Fix Generation
**File:** \`${filename}\`
**Issue:** ${issue}
**Lines ${start + 1}–${end + 1}:**

\`\`\`typescript
${snippet}
\`\`\`

Based on this context, generate:
1. A unified diff showing the exact change needed
2. An explanation of WHY this fix works
3. Any tests that should be added/updated`;
  },
};

export const LIST_API_ROUTES_TOOL: AITool = {
  name: "list_api_routes",
  description: "List all API routes detected in the codebase with their HTTP methods, paths, and authentication requirements. Essential for API security audits.",
  input_schema: {
    type: "object",
    properties: {
      include_middleware: {
        type: "boolean",
        description: "Whether to include middleware analysis",
      },
    },
  },
  async execute(input, ctx) {
    const routes: Array<{ file: string; method: string; hasAuth: boolean; hasValidation: boolean }> = [];

    for (const [file, content] of Object.entries(ctx.fileContents ?? {})) {
      // Next.js App Router style
      const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
      for (const method of methods) {
        if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(content)) {
          const hasAuth = /getServerSession|getToken|requireAuth|session\s*=/.test(content);
          const hasValidation = /zod|joi|yup|z\.object|validate|schema\.parse/.test(content);
          routes.push({ file, method, hasAuth, hasValidation });
        }
      }
      // Express style
      const expressMatches = content.matchAll(/(?:app|router)\.(get|post|put|patch|delete)\s*\(/g);
      for (const m of expressMatches) {
        const hasAuth = /auth|middleware|protect|requireLogin/.test(content);
        const hasValidation = /validate|schema|joi|zod/.test(content);
        routes.push({ file, method: m[1].toUpperCase(), hasAuth, hasValidation });
      }
    }

    if (routes.length === 0) {
      return "No API routes detected in the fetched files.";
    }

    const unprotected = routes.filter((r) => !r.hasAuth && r.method !== "GET");
    const noValidation = routes.filter((r) => !r.hasValidation && ["POST", "PUT", "PATCH"].includes(r.method));

    const lines = [
      `# API Routes Analysis — ${routes.length} routes found`,
      "",
      `| File | Method | Auth | Validation |`,
      `|------|--------|------|------------|`,
      ...routes.map((r) => `| \`${r.file}\` | ${r.method} | ${r.hasAuth ? "✅" : "❌"} | ${r.hasValidation ? "✅" : "❌"} |`),
      "",
    ];

    if (unprotected.length > 0) {
      lines.push(`## ⚠️ Unprotected Mutation Routes (${unprotected.length})`);
      lines.push(`${unprotected.map((r) => `- \`${r.method} ${r.file}\``).join("\n")}`);
    }

    if (noValidation.length > 0) {
      lines.push(`\n## ⚠️ Routes Without Input Validation (${noValidation.length})`);
      lines.push(`${noValidation.map((r) => `- \`${r.method} ${r.file}\``).join("\n")}`);
    }

    return lines.join("\n");
  },
};

export const FETCH_GITHUB_FILE_TOOL: AITool = {
  name: "fetch_github_file",
  description: "Fetch raw content of a specific file from GitHub that may not have been included in the initial scan. Use for Dockerfiles, CI/CD configs (.github/workflows/), .env.example, nginx.conf, etc.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path in the repo (e.g. '.github/workflows/ci.yml', 'Dockerfile')" },
      ref: { type: "string", description: "Branch or commit ref (default: HEAD)" },
    },
    required: ["path"],
  },
  async execute(input, ctx) {
    const path = String(input.path ?? "");
    const ref = String(input.ref ?? "HEAD");
    if (!ctx.repo || !ctx.githubToken) return "GitHub context not available — cannot fetch file.";
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${ctx.repo}/contents/${encodeURIComponent(path)}?ref=${ref}`,
        { headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github.v3.raw" } }
      );
      if (!resp.ok) return `File \`${path}\` not found (HTTP ${resp.status}).`;
      const content = await resp.text();
      const preview = content.slice(0, 4000);
      return `## ${path} (${content.length} chars)\n\n\`\`\`\n${preview}${content.length > 4000 ? "\n...(truncated)" : ""}\n\`\`\``;
    } catch (err) {
      return `Failed to fetch ${path}: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const COUNT_PATTERN_TOOL: AITool = {
  name: "count_pattern_occurrences",
  description: "Count how many times a regex pattern appears across all files with per-file breakdown. Use to estimate scope of a change or how widespread an anti-pattern is.",
  input_schema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to count" },
      group_by: { type: "string", description: "'file' for per-file breakdown, 'total' for global count", enum: ["file", "total"] },
    },
    required: ["pattern"],
  },
  async execute(input, ctx) {
    const pattern = String(input.pattern ?? "");
    const groupBy = String(input.group_by ?? "file");
    let total = 0;
    const perFile: Array<{ file: string; count: number }> = [];
    for (const [file, content] of Object.entries(ctx.fileContents ?? {})) {
      try {
        const regex = new RegExp(pattern, "gi");
        const matches = [...content.matchAll(regex)];
        if (matches.length > 0) { total += matches.length; perFile.push({ file, count: matches.length }); }
      } catch { /* bad regex */ }
    }
    perFile.sort((a, b) => b.count - a.count);
    if (total === 0) return `Pattern \`${pattern}\` not found in any file.`;
    if (groupBy === "total") return `Pattern \`${pattern}\` appears **${total} times** across ${perFile.length} files.`;
    const rows = perFile.slice(0, 15).map((f) => `- \`${f.file}\`: ${f.count}`).join("\n");
    return `## Pattern Count: \`${pattern}\`\n**Total: ${total} occurrences in ${perFile.length} files**\n\n${rows}${perFile.length > 15 ? `\n- …and ${perFile.length - 15} more files` : ""}`;
  },
};

export const CHECK_ACCESSIBILITY_TOOL: AITool = {
  name: "check_accessibility",
  description: "Scan a JSX/TSX/HTML file for WCAG 2.1 accessibility violations: missing alt text, unlabeled buttons, missing ARIA attributes, keyboard navigation issues, and form label gaps.",
  input_schema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "File to audit (must be .tsx, .jsx, or .html)" },
    },
    required: ["filename"],
  },
  async execute(input, ctx) {
    const filename = String(input.filename ?? "");
    const content = ctx.fileContents?.[filename];
    if (!content) return `File \`${filename}\` not found.`;
    const issues: string[] = [];

    const imgNoAlt = [...content.matchAll(/<img(?![^>]*\balt=)[^>]*>/gi)];
    if (imgNoAlt.length > 0) issues.push(`🔴 CRITICAL [${imgNoAlt.length}×] <img> missing alt attribute — WCAG 1.1.1`);

    const divClick = [...content.matchAll(/<div[^>]*onClick[^>]*>/gi)].filter((m) => !/role=/.test(m[0]));
    if (divClick.length > 0) issues.push(`🟠 HIGH [${divClick.length}×] <div onClick> without role="button" — not announced by screen readers. WCAG 4.1.2`);

    const iconButtons = [...content.matchAll(/<button[^>]*>(?:\s*<(?:svg|MaterialIcon|Icon|Lucide)[^/]*\/>?\s*)<\/button>/gi)].filter((m) => !/aria-label/.test(m[0]));
    if (iconButtons.length > 0) issues.push(`🟠 HIGH [${iconButtons.length}×] Icon-only <button> without aria-label — screen readers read nothing. WCAG 4.1.2`);

    const inputNoLabel = [...content.matchAll(/<input(?![^>]*(?:aria-label|aria-labelledby|id=))[^>]*>/gi)];
    if (inputNoLabel.length > 0) issues.push(`🟠 HIGH [${inputNoLabel.length}×] <input> without aria-label/id — cannot be associated with <label>. WCAG 1.3.1`);

    const ariaHiddenInteractive = [...content.matchAll(/(?:button|input|a\s)[^>]*aria-hidden="true"/gi)];
    if (ariaHiddenInteractive.length > 0) issues.push(`🔴 CRITICAL [${ariaHiddenInteractive.length}×] aria-hidden="true" on interactive element — keyboard focusable but invisible to AT. WCAG 4.1.2`);

    const tabIdxPositive = [...content.matchAll(/tabIndex=\{?["']?(\d+)["']?\}?/gi)].filter((m) => parseInt(m[1]) > 0);
    if (tabIdxPositive.length > 0) issues.push(`🟡 MEDIUM [${tabIdxPositive.length}×] tabIndex > 0 disrupts natural tab order. WCAG 2.4.3`);

    const unsafeBlank = [...content.matchAll(/target=["']_blank["'](?![^>]*rel=["'][^"']*noopener)/gi)];
    if (unsafeBlank.length > 0) issues.push(`🟡 MEDIUM [${unsafeBlank.length}×] target="_blank" without rel="noopener noreferrer"`);

    if (filename.includes("layout") && content.includes("<html") && !content.includes("lang=")) {
      issues.push(`🔴 CRITICAL <html> missing lang attribute — screen readers cannot determine language. WCAG 3.1.1`);
    }

    if (issues.length === 0) return `## ✅ Accessibility Check: ${filename}\n\nNo major WCAG violations detected in automated check. Test with a screen reader and verify color contrast manually.`;
    const critical = issues.filter((i) => i.startsWith("🔴")).length;
    const high = issues.filter((i) => i.startsWith("🟠")).length;
    return `## Accessibility Audit: ${filename}\n\n**${issues.length} issues** (${critical} critical, ${high} high)\n\n${issues.join("\n")}\n\n**WCAG 2.1 Level A:** ${critical > 0 ? "❌ FAILS" : "✅ PASSES"} | **Level AA:** ${critical + high > 0 ? "❌ FAILS" : "✅ PASSES"}`;
  },
};

export const ANALYZE_ENV_TOOL: AITool = {
  name: "analyze_env_config",
  description: "Analyze environment variable usage across the codebase: find all process.env references, detect variables used without validation or fallback, flag secrets in wrong places, and audit .env.example completeness.",
  input_schema: {
    type: "object",
    properties: {
      check_type: { type: "string", description: "What to check", enum: ["all", "missing-validation", "security", "consistency"] },
    },
  },
  async execute(_input, ctx) {
    const envRefs: Array<{ file: string; varName: string; line: number }> = [];
    for (const [file, content] of Object.entries(ctx.fileContents ?? {})) {
      for (const m of content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
        envRefs.push({ file, varName: m[1], line: lineNumber(content, m.index ?? 0) });
      }
    }
    const allVars = [...new Set(envRefs.map((r) => r.varName))].sort();
    const exampleContent = Object.entries(ctx.fileContents ?? {}).find(([f]) => f.includes(".env.example"))?.[1] ?? "";
    const declared = [...exampleContent.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    const undeclared = allVars.filter((v) => !declared.includes(v) && !["NODE_ENV", "PORT", "VERCEL_URL"].includes(v));

    const secretsInClient = envRefs.filter(
      (r) => /SECRET|PASSWORD|PASS|PRIVATE_KEY/.test(r.varName) && (r.file.includes("client") || r.file.includes("components"))
    );

    const lines = [
      `# Environment Config Analysis`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Unique env vars | ${allVars.length} |`,
      `| Total references | ${envRefs.length} |`,
      `| Undocumented (not in .env.example) | ${undeclared.length} |`,
      `| Potential secret leaks | ${secretsInClient.length} |`,
      ``,
      `## Variables Used\n${allVars.map((v) => `- \`${v}\`${declared.includes(v) ? " ✅" : " ⚠️ undocumented"}`).join("\n")}`,
    ];
    if (undeclared.length > 0) lines.push(`\n## ⚠️ Undocumented Variables\n${undeclared.map((v) => `- \`${v}\``).join("\n")}`);
    if (secretsInClient.length > 0) lines.push(`\n## 🔴 Possible Secret Exposure in Client Code\n${secretsInClient.map((r) => `- \`${r.varName}\` in \`${r.file}:${r.line}\``).join("\n")}`);
    return lines.join("\n");
  },
};

export const GET_GIT_BLAME_TOOL: AITool = {
  name: "get_git_blame_summary",
  description: "Fetch recent commit history for a specific file from GitHub. Shows who last modified it, when, and what changed — essential for identifying ownership and change frequency.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path in the repo" },
      limit: { type: "number", description: "Max commits to return (1–10, default 5)" },
    },
    required: ["path"],
  },
  async execute(input, ctx) {
    const path = String(input.path ?? "");
    const limit = Math.min(10, Math.max(1, Number(input.limit ?? 5)));
    if (!ctx.repo || !ctx.githubToken) return "GitHub token required for git history.";
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${ctx.repo}/commits?path=${encodeURIComponent(path)}&per_page=${limit}`,
        { headers: { Authorization: `Bearer ${ctx.githubToken}`, Accept: "application/vnd.github+json" } }
      );
      if (!resp.ok) return `Failed to fetch history for ${path}: HTTP ${resp.status}`;
      const commits = (await resp.json()) as Array<{ sha: string; commit: { message: string; author: { name: string; date: string } }; author?: { login: string } }>;
      if (!commits.length) return `No commits found for \`${path}\`.`;
      const rows = commits.map((c) => {
        const date = new Date(c.commit.author.date).toLocaleDateString();
        const author = c.author?.login ?? c.commit.author.name;
        const msg = c.commit.message.split("\n")[0].slice(0, 80);
        return `- **${date}** @${author} — ${msg} (\`${c.sha.slice(0, 7)}\`)`;
      });
      const authors = [...new Set(commits.map((c) => c.author?.login ?? c.commit.author.name))];
      return `## Git History: \`${path}\`\n\n${rows.join("\n")}\n\n**Active contributors:** ${authors.join(", ")}\n**Last modified:** ${new Date(commits[0].commit.author.date).toLocaleDateString()}`;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

/** All available tools as an array (for passing to AI providers) */
export const ALL_TOOLS: AITool[] = [
  SEARCH_CODE_TOOL,
  ANALYZE_COMPLEXITY_TOOL,
  CHECK_DEPENDENCY_TOOL,
  ANALYZE_COUPLING_TOOL,
  ESTIMATE_TEST_COVERAGE_TOOL,
  GENERATE_FIX_TOOL,
  LIST_API_ROUTES_TOOL,
  FETCH_GITHUB_FILE_TOOL,
  COUNT_PATTERN_TOOL,
  CHECK_ACCESSIBILITY_TOOL,
  ANALYZE_ENV_TOOL,
  GET_GIT_BLAME_TOOL,
];

/** Convert to Anthropic tool format */
export function toAnthropicTools(tools: AITool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/** Convert to OpenAI function-calling format */
export function toOpenAITools(tools: AITool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Execute a tool call and return the result.
 */
export async function executeTool(
  call: ToolCall,
  context: ToolContext
): Promise<ToolResult> {
  const tool = ALL_TOOLS.find((t) => t.name === call.name);
  if (!tool) {
    return {
      toolCallId: call.id,
      name: call.name,
      output: `Unknown tool: ${call.name}`,
      isError: true,
    };
  }

  try {
    const output = await tool.execute(call.input, context);
    return { toolCallId: call.id, name: call.name, output, isError: false };
  } catch (err) {
    return {
      toolCallId: call.id,
      name: call.name,
      output: `Tool execution error: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
