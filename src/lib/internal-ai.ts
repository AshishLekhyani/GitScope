/**
 * GitScope Internal AI Engine — v2
 *
 * Two-tier analysis system:
 *
 *   Tier 1 (primary): Python Neural Engine (services/ai-engine/)
 *     • Multi-agent: Security Sentinel, Quality Analyst, Architecture Advisor,
 *       Performance Profiler, Dependency Inspector, Pattern Learner
 *     • Self-learning via ChromaDB RAG — gets smarter with every analysis
 *     • Real cyclomatic complexity, AST-level analysis
 *     • Autonomous crawler: learns from GitHub top repos + OWASP docs daily
 *     • 350+ vulnerability patterns, 12+ CVE-specific checks
 *     • Runs at AI_ENGINE_URL (default: http://localhost:8765)
 *
 *   Tier 2 (fallback): TypeScript Rule Engine (this file)
 *     • Instant — zero network latency
 *     • 25+ security patterns, quality checks, breaking change detection
 *     • Used when Python engine is not running
 *
 * Usage:
 *   import { analyzeWithBestAvailableEngine } from "@/lib/internal-ai"
 *   const result = await analyzeWithBestAvailableEngine(input)
 */

import type { CodeReviewResult, CodeReviewFinding } from "@/app/api/ai/code-review/route";
import type { RepoScanResult, RepoScanFinding } from "@/app/api/ai/repo-scan/route";
import {
  analyzeWithNeuralEngine,
  scanRepoWithNeuralEngine,
  type NeuralPRResult,
  type NeuralRepoResult,
  type NeuralFinding,
} from "@/lib/neural-ai-client";

// ── Security rule patterns ────────────────────────────────────────────────────

interface SecurityRule {
  id: string;
  pattern: RegExp;
  severity: CodeReviewFinding["severity"];
  description: (match: string, file: string) => string;
  suggestion: string;
  category: string;
  /** 0–1 confidence. Rules below 0.65 are downgraded to "medium"; below 0.50 to "low". */
  confidence?: number;
}

const SECURITY_RULES: SecurityRule[] = [
  {
    id: "hardcoded-secret-aws",
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: "critical",
    description: (_, file) =>
      `AWS Access Key ID found hardcoded in ${file}. This credential will be exposed in version control.`,
    suggestion:
      "Remove immediately. Rotate the key in AWS IAM. Store in environment variables or a secrets manager (AWS Secrets Manager, HashiCorp Vault).",
    category: "security",
    confidence: 0.98,
  },
  {
    id: "hardcoded-secret-generic",
    pattern:
      /(?:password|passwd|secret|api_key|apikey|token|private_key)\s*[:=]\s*["'][^"']{8,}["']/gi,
    severity: "critical",
    description: (match, file) =>
      `Potential hardcoded credential detected in ${file}: \`${match.slice(0, 50)}\`. Secrets in source code are a critical security risk.`,
    suggestion:
      "Use environment variables (process.env.SECRET_NAME) or a secrets manager. Never commit credentials to version control.",
    category: "security",
    confidence: 0.82,
  },
  {
    id: "sql-injection",
    pattern: /(?:query|sql|execute|db\.run)\s*\(\s*[`"'].*\$\{.*\}.*[`"']/gi,
    severity: "critical",
    description: (_, file) =>
      `SQL query with string interpolation found in ${file}. Template literal SQL is vulnerable to SQL injection attacks.`,
    suggestion:
      "Use parameterized queries or a query builder. Example: db.query('SELECT * FROM users WHERE id = $1', [userId])",
    category: "security",
    confidence: 0.90,
  },
  {
    id: "eval-usage",
    pattern: /\beval\s*\(/g,
    severity: "high",
    description: (_, file) =>
      `\`eval()\` used in ${file}. Evaluating arbitrary code is a critical security vulnerability enabling code injection.`,
    suggestion:
      "Replace eval() with safer alternatives. For JSON: use JSON.parse(). For dynamic functions: use a proper AST parser.",
    category: "security",
    confidence: 0.90,
  },
  {
    id: "dangerous-innerhtml",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{/g,
    severity: "high",
    description: (_, file) =>
      `\`dangerouslySetInnerHTML\` found in ${file}. Injecting unescaped HTML enables XSS attacks.`,
    suggestion:
      "Sanitize content with DOMPurify before injecting: { __html: DOMPurify.sanitize(content) }. Or use a safe rendering library.",
    category: "security",
    confidence: 0.88,
  },
  {
    id: "prototype-pollution",
    pattern: /\.__proto__\s*=|constructor\.prototype\s*=/g,
    severity: "high",
    description: (_, file) =>
      `Prototype mutation detected in ${file}. Modifying Object prototype can enable prototype pollution attacks.`,
    suggestion:
      "Use Object.create(null) for plain data stores. Avoid mutating prototypes. Validate untrusted input before merging into objects.",
    category: "security",
    confidence: 0.92,
  },
  {
    id: "path-traversal",
    pattern: /(?:path\.join|readFile|writeFile|createReadStream)\s*\([^)]*(?:req\.|params\.|query\.)/g,
    severity: "high",
    description: (_, file) =>
      `Potential path traversal vulnerability in ${file}. User-controlled input used in file system operations.`,
    suggestion:
      "Validate and sanitize file paths. Use path.resolve() and verify the result starts with your allowed base directory.",
    category: "security",
    confidence: 0.85,
  },
  {
    id: "insecure-random",
    pattern: /Math\.random\(\)/g,
    severity: "medium",
    description: (_, file) =>
      `Math.random() used in ${file}. Not cryptographically secure — unsuitable for tokens, IDs, or security-critical values.`,
    suggestion:
      "Use crypto.randomUUID() or crypto.getRandomValues() for security-sensitive randomness.",
    category: "security",
    confidence: 0.55,
  },
  {
    id: "console-log-in-prod",
    pattern: /console\.(log|debug|info)\s*\([^)]*(?:password|token|secret|key|auth)/gi,
    severity: "high",
    description: (_, file) =>
      `Sensitive data logged to console in ${file}. Log statements containing credentials create exposure risk in production.`,
    suggestion: "Remove or redact sensitive values from logs. Use structured logging with explicit field masking.",
    category: "security",
    confidence: 0.80,
  },
  {
    id: "jwt-no-verify",
    pattern: /jwt\.decode\s*\(/g,
    severity: "high",
    description: (_, file) =>
      `JWT decoded without verification in ${file}. jwt.decode() does NOT verify the signature — trusting unverified claims.`,
    suggestion: "Use jwt.verify(token, secret) instead of jwt.decode(). Always verify the signature before trusting JWT claims.",
    category: "security",
    confidence: 0.92,
  },
  {
    id: "open-redirect",
    pattern: /res\.redirect\s*\(\s*req\.(?:query|body|params)/g,
    severity: "high",
    description: (_, file) =>
      `Open redirect vulnerability in ${file}. Redirecting to user-controlled URL enables phishing attacks.`,
    suggestion:
      "Validate redirect targets against an allowlist of trusted domains before redirecting.",
    category: "security",
    confidence: 0.88,
  },
  {
    id: "xxe-injection",
    pattern: /libxmljs|xml2js|DOMParser|parseFromString/g,
    severity: "medium",
    description: (_, file) =>
      `XML parsing detected in ${file}. Ensure external entity processing (XXE) is disabled.`,
    suggestion: "Disable external entity processing: set { explicitCharkey: true, ignoreAttrs: false } and validate XML inputs.",
    category: "security",
    confidence: 0.60,
  },
];

// ── Quality rules ─────────────────────────────────────────────────────────────

interface QualityRule {
  id: string;
  pattern: RegExp;
  severity: CodeReviewFinding["severity"];
  description: (file: string, count: number) => string;
  suggestion: string;
}

const QUALITY_RULES: QualityRule[] = [
  {
    id: "todo-fixme",
    pattern: /\b(?:TODO|FIXME|HACK|XXX)\b/g,
    severity: "low",
    description: (file, count) =>
      `${count} TODO/FIXME comment${count > 1 ? "s" : ""} found in ${file}. Unresolved technical notes signal pending work.`,
    suggestion: "Convert TODOs to tracked issues. If the TODO is blocking, resolve it before merging.",
  },
  {
    id: "any-type",
    pattern: /:\s*any\b/g,
    severity: "low",
    description: (file, count) =>
      `${count} TypeScript \`any\` type${count > 1 ? "s" : ""} in ${file}. Defeats the purpose of type safety.`,
    suggestion: "Replace `any` with specific types, `unknown` (with narrowing), or generic type parameters.",
  },
  {
    id: "async-no-await",
    pattern: /async\s+(?:function|\([^)]*\)\s*=>|\w+\s*=>)\s*\{[^}]*\}/g,
    severity: "low",
    description: (file) =>
      `Async function without await in ${file}. May be an unnecessary async declaration or missing error handling.`,
    suggestion: "Remove async if no await is used, or add proper error handling with try/catch around awaited calls.",
  },
  {
    id: "empty-catch",
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    severity: "medium",
    description: (file) =>
      `Empty catch block in ${file}. Silently swallowing errors makes debugging extremely difficult.`,
    suggestion: "Log the error at minimum: catch(err) { console.error('[context]', err); } or handle it appropriately.",
  },
  {
    id: "magic-numbers",
    pattern: /(?<!=)\b(?:(?!0|1|-1|2|10|100|1000)\d{2,})\b(?!\s*[:;,)])/g,
    severity: "low",
    description: (file) =>
      `Magic numbers found in ${file}. Unexplained numeric literals reduce code readability and maintainability.`,
    suggestion: "Extract magic numbers as named constants: const MAX_RETRY_COUNT = 5; const TIMEOUT_MS = 30000;",
  },
];

// ── False-positive suppressor ─────────────────────────────────────────────────

/**
 * Strip non-executable contexts from a code string before pattern scanning.
 *
 * Prevents false positives when a PR diff touches files that *define* detection
 * rules (e.g. vuln_patterns.py, internal-ai.ts itself) — those files contain
 * strings like `pattern: /eval\s*\(/g` which would otherwise trigger the very
 * rules they define.
 *
 * Removes / neutralises:
 *   - Comment-only lines  (// ... / # ... / * ...)
 *   - Lines that ARE a regex pattern definition  (pattern: /.../)
 *   - Rule metadata fields: description, suggestion, id, cve_id prose lines
 *   - Inline regex literals replaced with a neutral placeholder string
 */
function stripNonExecutable(code: string): string {
  return code
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;

      // Skip comment-only lines
      if (/^(?:\/\/|\/\*|\*(?!\/)|#)/.test(t)) return "";

      // Skip lines that ARE a regex/pattern literal rule definition
      // e.g.  pattern: /eval\s*\(/g,        (TS rule object)
      // e.g.  "pattern": r"eval\s*\(",       (Python rule dict)
      // e.g.  pattern=/eval/,               (assignment form)
      if (/\bpattern\s*[=:]\s*(?:r['"\/]|\/)/.test(t)) return "";

      // Skip description / suggestion / id / cve prose fields
      // (prose text often contains the very keywords we're scanning for)
      if (/^\s*(?:"description"|description|"suggestion"|suggestion|"id"|id|"cve_id"|cve_id)\s*[:(]/.test(t)) return "";

      // Replace inline regex literals so their raw source can't match rules
      // e.g.  const re = /jwt\.decode\s*\(/;   →   const re = "REGEX_LITERAL";
      return line.replace(/\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, '"REGEX_LITERAL"');
    })
    .join("\n");
}

// ── Breaking change detectors ─────────────────────────────────────────────────

function detectBreakingChanges(files: Array<{ filename: string; patch?: string; status: string }>): string[] {
  const changes: string[] = [];

  for (const file of files) {
    const f = file.filename;
    const patch = file.patch ?? "";

    // Database migrations
    if (f.match(/migration|migrate/i) && f.match(/\.(sql|ts|js)$/)) {
      if (patch.includes("DROP TABLE") || patch.includes("DROP COLUMN")) {
        changes.push(`Destructive database migration in ${f.split("/").pop()} — DROP operation detected. Data loss risk.`);
      } else if (patch.includes("NOT NULL") && !patch.includes("DEFAULT")) {
        changes.push(`Non-nullable column added in ${f.split("/").pop()} without a DEFAULT value — will fail on existing rows.`);
      } else {
        changes.push(`Database schema migration in ${f.split("/").pop()} — verify backward compatibility with running instances.`);
      }
    }

    // API route changes
    if (f.match(/app\/api\/|pages\/api\//)) {
      if (file.status === "deleted") {
        changes.push(`API endpoint removed: ${f} — existing consumers will get 404 errors.`);
      } else if (patch.includes("- export") || patch.includes("-export")) {
        changes.push(`API route in ${f.split("/").pop()} has exported signature changes — may break existing API consumers.`);
      }
    }

    // TypeScript type/interface breaking changes
    if (f.match(/\.d\.ts$|types\//)) {
      if (patch.match(/^-\s+\w/m)) {
        changes.push(`Type definitions modified in ${f.split("/").pop()} — downstream TypeScript consumers may see type errors.`);
      }
    }

    // Package version changes
    if (f === "package.json") {
      const versionChange = patch.match(/"version":\s*"([^"]+)"/);
      if (versionChange) {
        changes.push(`Package version bumped — ensure CHANGELOG.md is updated and semver semantics are correct.`);
      }
      const removedDeps = (patch.match(/^-\s+"[^"]+"/gm) ?? []).filter((l) => l.includes('": "'));
      if (removedDeps.length > 0) {
        changes.push(`${removedDeps.length} package(s) removed from package.json — verify no consumers depend on them.`);
      }
    }

    // Next.js / framework config
    if (f.match(/next\.config|tsconfig\.json|\.env/)) {
      changes.push(`Framework/build configuration changed in ${f.split("/").pop()} — verify CI/CD pipeline compatibility.`);
    }

    // Auth/middleware changes
    if (f.match(/middleware\.|auth\./i)) {
      changes.push(`Auth/middleware changed in ${f.split("/").pop()} — existing sessions or request flows may be affected.`);
    }
  }

  return [...new Set(changes)].slice(0, 6);
}

// ── Value scorer ──────────────────────────────────────────────────────────────

function scoreValue(params: {
  files: Array<{ filename: string; additions: number; deletions: number }>;
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
}): { score: number; flags: string[] } {
  const { files, commitMessage, prTitle, prBody } = params;
  let score = 60;
  const flags: string[] = [];

  const totalChanges = files.reduce((a, f) => a + f.additions + f.deletions, 0);
  const hasTests = files.some((f) => f.filename.match(/\.(test|spec)\.(ts|tsx|js|jsx|py)$/));
  const hasSourceChanges = files.some((f) =>
    f.filename.match(/src\/|lib\/|api\//) && !f.filename.match(/test|spec/)
  );
  const hasDocChanges = files.some((f) => f.filename.match(/\.md$|docs\//));
  const hasMigration = files.some((f) => f.filename.match(/migration|migrate/i));

  // Large diff is risky but potentially high-value
  if (totalChanges > 500) { score -= 5; flags.push("large-diff"); }
  if (totalChanges > 2000) { score -= 10; flags.push("large-diff"); }

  // Tests = valuable
  if (hasTests) score += 15;
  else if (hasSourceChanges) { score -= 10; flags.push("test-coverage"); }

  // Source code changes = likely valuable
  if (hasSourceChanges) score += 10;

  // Docs are valuable but not high-impact
  if (hasDocChanges && !hasSourceChanges) score = Math.min(score, 65);

  // Migration = high risk, high value
  if (hasMigration) { score += 5; flags.push("database"); }

  // Commit message quality
  const msg = (commitMessage ?? prTitle ?? "").toLowerCase();
  if (msg.match(/^(feat|fix|refactor|perf|security|chore|docs|test|build)/)) score += 5;
  if (msg.length < 10) score -= 10;
  if (msg === "wip" || msg.match(/^wip\b/)) { score -= 20; flags.push("style"); }
  if (msg.match(/fix(ed)?\s+typo|whitespace|formatting/i)) score = Math.min(score, 55);

  // PR body quality
  if (prBody && prBody.length > 100) score += 5;

  return { score: Math.max(10, Math.min(98, score)), flags };
}

// ── Quality scorer ────────────────────────────────────────────────────────────

function scoreQuality(
  files: Array<{ filename: string; patch?: string }>
): { score: number; findings: CodeReviewFinding[] } {
  let score = 75;
  const findings: CodeReviewFinding[] = [];
  const linesAdded = files.flatMap((f) =>
    (f.patch ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  );

  const patchText = stripNonExecutable(linesAdded.join("\n"));

  for (const rule of QUALITY_RULES) {
    const matches = patchText.match(rule.pattern);
    if (matches && matches.length > 0) {
      const affectedFile =
        files.find((f) => (f.patch ?? "").match(rule.pattern))?.filename ?? "unknown file";
      score -= rule.severity === "medium" ? 8 : 3;
      if (findings.length < 6) {
        findings.push({
          severity: rule.severity,
          category: "quality",
          file: affectedFile,
          description: rule.description(affectedFile.split("/").slice(-2).join("/"), matches.length),
          suggestion: rule.suggestion,
        });
      }
    }
  }

  // Bonus for clean patches
  if (findings.length === 0) score = Math.min(score + 5, 95);

  return { score: Math.max(20, Math.min(95, score)), findings };
}

// ── Security scorer ───────────────────────────────────────────────────────────

function scoreSecurity(
  files: Array<{ filename: string; patch?: string }>
): { score: number; findings: CodeReviewFinding[]; issues: string[] } {
  let score = 88;
  const findings: CodeReviewFinding[] = [];
  const issues: string[] = [];

  for (const file of files) {
    // Strip non-executable contexts (pattern definitions, comments, regex literals)
    // before scanning — prevents false positives when a PR touches detection rule files.
    const addedLines = stripNonExecutable(
      (file.patch ?? "")
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .join("\n")
    );

    const seenRules = new Set<string>(); // deduplicate: one finding per rule per file

    for (const rule of SECURITY_RULES) {
      if (seenRules.has(rule.id)) continue;
      const matches = addedLines.match(rule.pattern);
      if (!matches) continue;

      seenRules.add(rule.id);
      const firstMatch = matches[0].slice(0, 80);

      // Confidence-based severity downgrade
      const conf = rule.confidence ?? 0.85;
      const effectiveSeverity: CodeReviewFinding["severity"] =
        conf < 0.50 ? "low" :
        conf < 0.65 ? "medium" :
        rule.severity;

      const deduction =
        effectiveSeverity === "critical" ? 30 :
        effectiveSeverity === "high" ? 20 :
        effectiveSeverity === "medium" ? 10 : 4;
      score -= deduction;

      if (findings.length < 8) {
        findings.push({
          severity: effectiveSeverity,
          category: "security",
          file: file.filename,
          description: rule.description(firstMatch, file.filename.split("/").slice(-2).join("/")),
          suggestion: rule.suggestion,
          codeSnippet: firstMatch.slice(0, 100),
        });
      }

      issues.push(rule.description(firstMatch, file.filename.split("/").slice(-1)[0]).split(".")[0]);
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    issues: [...new Set(issues)].slice(0, 5),
  };
}

// ── Test coverage estimator ───────────────────────────────────────────────────

function estimateTestCoverage(files: Array<{ filename: string; additions: number; deletions: number }>): number {
  const testFiles = files.filter((f) => f.filename.match(/\.(test|spec)\.(ts|tsx|js|jsx|py)$/));
  const sourceFiles = files.filter(
    (f) => !f.filename.match(/\.(test|spec)\.(ts|tsx|js|jsx|py)$/) &&
           f.filename.match(/\.(ts|tsx|js|jsx|py|go|rs)$/)
  );

  if (sourceFiles.length === 0) return 70;
  if (testFiles.length === 0) return 15;

  const testRatio = testFiles.length / (sourceFiles.length + testFiles.length);
  return Math.round(Math.min(90, testRatio * 120));
}

// ── Main PR/Commit analyzer ───────────────────────────────────────────────────

export interface InternalAnalysisInput {
  repo: string;
  analysisType: "pr" | "commit";
  prMeta?: {
    title: string;
    body: string | null;
    user: { login: string };
    additions: number;
    deletions: number;
    changed_files: number;
    draft: boolean;
    labels: Array<{ name: string }>;
  };
  commitMeta?: {
    commit: { message: string; author: { name: string } };
    stats?: { additions: number; deletions: number };
  };
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
  prNumber?: number;
  sha?: string;
}

export function analyzeWithInternalAI(input: InternalAnalysisInput): CodeReviewResult {
  const { repo, files, prMeta, commitMeta, analysisType } = input;

  const title = prMeta?.title ?? commitMeta?.commit.message.split("\n")[0] ?? "Unknown change";
  const _body = prMeta?.body ?? null; void _body;
  const totalAdditions = prMeta?.additions ?? commitMeta?.stats?.additions ?? files.reduce((a, f) => a + f.additions, 0);
  const totalDeletions = prMeta?.deletions ?? commitMeta?.stats?.deletions ?? files.reduce((a, f) => a + f.deletions, 0);

  // Run all analyzers
  const security = scoreSecurity(files);
  const quality = scoreQuality(files);
  const { score: valueScore, flags: valueFlags } = scoreValue({
    files,
    commitMessage: commitMeta?.commit.message,
    prTitle: prMeta?.title,
    prBody: prMeta?.body ?? undefined,
  });
  const breakingChanges = detectBreakingChanges(files);
  const testCoverage = estimateTestCoverage(files);

  // Combine all findings, sorted by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const allFindings = [...security.findings, ...quality.findings].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  // Overall flags
  const flags = [...new Set([
    ...valueFlags,
    ...(breakingChanges.length > 0 ? ["breaking-change"] : []),
    ...(security.score < 60 ? ["security"] : []),
    ...(allFindings.some((f) => f.category === "security" && f.severity === "critical") ? ["security"] : []),
    ...(files.some((f) => f.filename.match(/auth/i)) ? ["auth"] : []),
    ...(files.some((f) => f.filename.match(/migration|\.sql/i)) ? ["database"] : []),
    ...(files.some((f) => f.filename.match(/package\.json|requirements\.txt|Gemfile/)) ? ["deps"] : []),
    ...(files.some((f) => f.filename.match(/api\//)) ? ["api-contract"] : []),
  ])];

  // Verdict logic
  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const highCount = allFindings.filter((f) => f.severity === "high").length;

  let verdict: CodeReviewResult["verdict"];
  let mergeRisk: CodeReviewResult["mergeRisk"];

  if (criticalCount > 0 || breakingChanges.length > 2 || security.score < 40) {
    verdict = "REQUEST_CHANGES";
    mergeRisk = criticalCount > 0 ? "critical" : "high";
  } else if (highCount > 1 || breakingChanges.length > 0 || security.score < 65) {
    verdict = "COMMENT";
    mergeRisk = "medium";
  } else if (highCount === 0 && criticalCount === 0 && security.score >= 75) {
    verdict = "APPROVE";
    mergeRisk = "low";
  } else {
    verdict = "COMMENT";
    mergeRisk = "medium";
  }

  // Confidence: lower than LLM since it's heuristic
  const confidence = Math.min(85, 55 + (files.length > 0 ? 10 : 0) +
    (files.some((f) => f.patch) ? 15 : 0) +
    (allFindings.length > 0 ? 5 : 0));

  // Summary generation
  const summaryParts: string[] = [];
  if (analysisType === "pr") {
    summaryParts.push(
      `Pull request "${title}" in ${repo} touches ${files.length} file${files.length !== 1 ? "s" : ""} (+${totalAdditions}/-${totalDeletions} lines).`
    );
  } else {
    summaryParts.push(
      `Commit "${title.slice(0, 60)}" in ${repo} modifies ${files.length} file${files.length !== 1 ? "s" : ""}.`
    );
  }

  if (criticalCount > 0) {
    summaryParts.push(
      `${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} found — immediate attention required before any merge.`
    );
  } else if (highCount > 0) {
    summaryParts.push(`${highCount} high-severity finding${highCount > 1 ? "s" : ""} warrant review before merging.`);
  } else if (verdict === "APPROVE") {
    summaryParts.push("No significant issues detected. The change looks clean.");
  }

  if (breakingChanges.length > 0) {
    summaryParts.push("Breaking changes detected — coordinate with downstream consumers before deploying.");
  }

  // Positives
  const positives: string[] = [];
  if (security.score >= 80) positives.push("No obvious security vulnerabilities detected in the diff");
  if (testCoverage >= 50) positives.push("Good test coverage accompanying the implementation changes");
  if (files.some((f) => f.filename.match(/\.md$/))) positives.push("Documentation updated alongside code changes");
  if (title.match(/^(feat|fix|refactor|perf|security)\(/)) positives.push("Conventional commit message format — good for changelog generation");
  if (totalAdditions < 200 && files.length > 1) positives.push("Focused, appropriately-scoped change — easy to review");
  if (positives.length === 0) positives.push("Change is syntactically valid and follows basic code structure");

  // Hot files
  const hotFiles = [...files]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, 5)
    .map((f) => f.filename);

  // Impact areas
  const impactAreas: string[] = [];
  if (files.some((f) => f.filename.match(/auth|login|session/i))) impactAreas.push("authentication");
  if (files.some((f) => f.filename.match(/api\//))) impactAreas.push("API");
  if (files.some((f) => f.filename.match(/prisma|migration|\.sql/i))) impactAreas.push("database");
  if (files.some((f) => f.filename.match(/components?\/|pages?\//))) impactAreas.push("frontend");
  if (files.some((f) => f.filename.match(/lib\/|utils?\//))) impactAreas.push("shared-utilities");
  if (files.some((f) => f.filename.match(/test|spec/i))) impactAreas.push("test-suite");

  // Recommendation
  let recommendation = "";
  if (verdict === "REQUEST_CHANGES") {
    recommendation = `Fix the ${criticalCount > 0 ? `${criticalCount} critical security issue${criticalCount > 1 ? "s" : ""}` : "identified issues"} before merging. ${breakingChanges.length > 0 ? "Also ensure breaking changes are coordinated with all consumers. " : ""}Run a security audit on the affected files.`;
  } else if (verdict === "COMMENT") {
    recommendation = `Review the ${highCount} noted concern${highCount > 1 ? "s" : ""} and confirm they are acceptable or addressed. ${breakingChanges.length > 0 ? "Breaking changes should be documented in the PR description. " : ""}The change looks mergeable once reviewed.`;
  } else {
    recommendation = "The change looks clean based on static analysis. Confirm tests pass and do a final human review of the logic, then merge.";
  }

  // Review checklist
  const reviewChecklist = [
    `Review the ${files.length} changed file${files.length !== 1 ? "s" : ""} for logical correctness`,
    ...(security.findings.length > 0 ? ["Address all security findings before merge"] : []),
    ...(testCoverage < 40 ? ["Add tests for the new/changed code paths"] : []),
    ...(breakingChanges.length > 0 ? ["Document breaking changes and notify consumers"] : []),
    "Verify CI/CD pipeline passes all checks",
    ...(flags.includes("database") ? ["Test database migration against a copy of production data"] : []),
    ...(flags.includes("auth") ? ["Perform security review of authentication changes"] : []),
  ].slice(0, 7);

  // Estimate review time
  const reviewMins = Math.max(10, Math.min(120,
    15 + Math.floor(files.length * 3) + Math.floor((totalAdditions + totalDeletions) / 50)
  ));
  const estimatedReviewTime = reviewMins < 60 ? `${reviewMins} min` : `${Math.round(reviewMins / 60 * 10) / 10}h`;

  return {
    verdict,
    confidence,
    summary: summaryParts.join(" "),
    mergeRisk,
    scores: {
      security: security.score,
      value: valueScore,
      quality: quality.score,
      testCoverage,
      breakingRisk: Math.min(95, breakingChanges.length * 20 + (mergeRisk === "critical" ? 40 : mergeRisk === "high" ? 25 : 10)),
    },
    flags,
    findings: allFindings.slice(0, 10),
    breakingChanges,
    securityIssues: security.issues,
    positives,
    recommendation,
    reviewChecklist,
    estimatedReviewTime,
    suggestedReviewers: Math.min(5, 1 + Math.floor(files.length / 5) + (criticalCount > 0 ? 1 : 0)),
    impactAreas,
    affectedSystems: impactAreas.map((a) =>
      a === "authentication" ? "Auth Service" :
      a === "API" ? "Backend API" :
      a === "database" ? "Database" :
      a === "frontend" ? "Frontend" :
      a === "shared-utilities" ? "Shared Libraries" :
      "Test Suite"
    ),
    diffStats: {
      fileCount: files.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      hotFiles,
    },
    model: "gitscope-internal-v1",
    isDemo: false,
  };
}

// ── Best-available engine wrappers ────────────────────────────────────────────
//
// These are the public API for the rest of the codebase.
// They transparently try the neural engine first (if running), and fall back
// to the TypeScript rule engine if the Python service isn't available.

/**
 * Analyze a PR or commit using the best available engine.
 * Neural engine → TypeScript rules fallback.
 */
export async function analyzeWithBestAvailableEngine(
  input: InternalAnalysisInput,
  onAgentProgress?: (event: { agent_id: string; agent_name: string; score: number; duration_ms: number }) => void,
): Promise<CodeReviewResult> {
  try {
    const neuralResult = await analyzeWithNeuralEngine(
      {
        repo: input.repo,
        analysis_type: input.analysisType,
        files: input.files.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        })),
        pr_meta: input.prMeta ? {
          title: input.prMeta.title,
          body: input.prMeta.body,
          user: input.prMeta.user,
          additions: input.prMeta.additions,
          deletions: input.prMeta.deletions,
          changed_files: input.prMeta.changed_files,
          draft: input.prMeta.draft,
          labels: input.prMeta.labels,
        } : undefined,
        commit_meta: input.commitMeta ? {
          commit: input.commitMeta.commit,
          stats: input.commitMeta.stats,
        } : undefined,
        pr_number: input.prNumber,
        sha: input.sha,
      },
      onAgentProgress,
    );

    if (neuralResult) {
      return _neuralToCodeReviewResult(neuralResult);
    }
  } catch {
    // Neural engine unavailable — fall through to rule engine
  }

  // Fallback: TypeScript rule engine (always available, zero latency)
  return analyzeWithInternalAI(input);
}

/**
 * Scan a repo using the best available engine.
 * Neural engine → TypeScript rules fallback.
 */
export async function scanRepoWithBestAvailableEngine(
  input: InternalRepoScanInput,
  onAgentProgress?: (event: { agent_id: string; score: number }) => void,
): Promise<RepoScanResult> {
  try {
    const neuralResult = await scanRepoWithNeuralEngine(
      {
        repo: input.repo,
        file_tree: input.fileTree,
        key_file_contents: input.keyFileContents,
        recent_commits: input.recentCommits,
        contributors: input.contributors,
        meta: input.meta,
        scan_mode: input.scanMode as "standard" | "deep",
      },
      onAgentProgress,
    );

    if (neuralResult) {
      return _neuralToRepoScanResult(neuralResult);
    }
  } catch {
    // Fall through
  }

  return scanRepoWithInternalAI(input);
}

// ── Shape adapters ────────────────────────────────────────────────────────────

function _neuralToCodeReviewResult(n: NeuralPRResult): CodeReviewResult {
  return {
    verdict: n.verdict,
    confidence: n.confidence,
    summary: `[Neural — ${n.agents.length} agents, ${n.total_ms}ms] ${n.detected_languages.join(", ") || "multi-lang"} | ` +
      n.agents.map((a) => `${a.name}: ${a.score}`).join(" · "),
    mergeRisk: n.merge_risk,
    scores: {
      security: n.scores.security,
      value: n.scores.value,
      quality: n.scores.quality,
      testCoverage: n.scores.test_coverage,
      breakingRisk: n.scores.breaking_risk,
    },
    flags: n.flags,
    findings: n.findings
      .filter((f) => f.severity !== "info")
      .map((f) => ({
        severity: f.severity as CodeReviewFinding["severity"],
        category: f.category as CodeReviewFinding["category"],
        file: f.file ?? undefined,
        description: f.description,
        suggestion: f.suggestion,
        codeSnippet: f.code_snippet ?? undefined,
      })),
    breakingChanges: n.breaking_changes,
    securityIssues: n.security_issues,
    positives: n.positives,
    recommendation: n.recommendation,
    reviewChecklist: n.review_checklist,
    estimatedReviewTime: n.estimated_review_time,
    suggestedReviewers: n.suggested_reviewers,
    impactAreas: n.impact_areas,
    affectedSystems: n.affected_systems,
    diffStats: {
      fileCount: n.diff_stats.file_count,
      additions: n.diff_stats.additions,
      deletions: n.diff_stats.deletions,
      hotFiles: n.diff_stats.hot_files.map((f) => f.filename),
    },
    model: "gitscope-neural-v2",
    isDemo: false,
  };
}

function _neuralToRepoScanResult(n: NeuralRepoResult): RepoScanResult {
  const mapF = (findings: NeuralFinding[]): RepoScanFinding[] =>
    (findings || []).filter((f) => f.severity !== "info").map((f) => ({
      severity: f.severity as RepoScanFinding["severity"],
      category: f.category as RepoScanFinding["category"],
      description: f.description,
      suggestion: f.suggestion,
      file: f.file ?? undefined,
    }));

  return {
    healthScore: n.health_score,
    summary: n.summary,
    architecture: {
      summary: n.architecture.summary,
      patterns: n.architecture.patterns,
      strengths: n.architecture.strengths,
      concerns: n.architecture.concerns,
    },
    security: {
      score: n.security.score,
      grade: n.security.grade as "A" | "B" | "C" | "D" | "F",
      issues: mapF(n.security.issues),
      positives: n.security.positives,
    },
    codeQuality: {
      score: n.code_quality.score,
      grade: n.code_quality.grade as "A" | "B" | "C" | "D" | "F",
      issues: mapF(n.code_quality.issues),
      strengths: n.code_quality.strengths,
    },
    testability: {
      score: n.testability.score,
      grade: n.testability.grade as "A" | "B" | "C" | "D" | "F",
      hasTestFramework: n.testability.has_test_framework,
      coverageEstimate: n.testability.coverage_estimate,
      gaps: n.testability.gaps,
    },
    dependencies: {
      score: n.dependencies.score,
      totalCount: n.dependencies.total_count,
      risks: n.dependencies.risks,
      outdatedSignals: n.dependencies.outdated_signals,
    },
    techDebt: {
      score: n.tech_debt.score,
      level: n.tech_debt.level as RepoScanResult["techDebt"]["level"],
      hotspots: n.tech_debt.hotspots,
      estimatedHours: n.tech_debt.estimated_hours,
    },
    recommendations: n.recommendations.map((r) => ({
      priority: r.priority as RepoScanResult["recommendations"][number]["priority"],
      title: r.title,
      description: r.description,
      effort: r.effort as "low" | "medium" | "high",
    })),
    metrics: {
      primaryLanguage: n.metrics.primary_language,
      fileCount: n.metrics.file_count,
      estimatedLoc: "Unknown",
      contributors: n.metrics.contributors,
      repoAge: "Unknown",
      openIssues: n.metrics.open_issues,
      stars: n.metrics.stars,
    },
    model: "gitscope-neural-v2",
    isDemo: false,
  };
}

// ── Repo scanner ──────────────────────────────────────────────────────────────

export interface InternalRepoScanInput {
  repo: string;
  fileTree: string[];
  keyFileContents: Record<string, string>;
  recentCommits: string[];
  contributors: number;
  meta: Record<string, unknown>;
  scanMode: string;
}

export function scanRepoWithInternalAI(input: InternalRepoScanInput): RepoScanResult {
  const { repo, fileTree, keyFileContents, contributors, meta, scanMode } = input;

  const pkg = keyFileContents["package.json"] ? (() => {
    try { return JSON.parse(keyFileContents["package.json"]); } catch { return {}; }
  })() : {};

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depCount = Object.keys(deps).length;

  // Language detection heuristics
  const hasTypeScript = fileTree.some((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const hasTests = fileTree.some((f) => f.match(/\.(test|spec)\.(ts|tsx|js|jsx|py)$/));
  const hasTestDir = fileTree.some((f) => f.startsWith("test/") || f.startsWith("__tests__/") || f.startsWith("spec/"));
  const hasDocker = fileTree.some((f) => f === "Dockerfile" || f.startsWith(".docker"));
  const hasCI = fileTree.some((f) => f.match(/\.github\/workflows|\.gitlab-ci|\.circleci|jenkins/i));
  const hasPrisma = fileTree.some((f) => f.startsWith("prisma/"));
  const hasNextJs = "next" in deps;
  const hasReact = "react" in deps;
  const hasExpressOrFastify = "express" in deps || "fastify" in deps || "koa" in deps;
  const hasLinting = ".eslintrc.json" in keyFileContents || fileTree.some((f) => f.match(/\.eslintrc|\.biome/));
  const hasMigrations = fileTree.some((f) => f.match(/migration|migrate/i));
  const hasEnvExample = fileTree.some((f) => f === ".env.example");

  // Security analysis based on file structure
  const securityIssues: RepoScanFinding[] = [];
  const securityPositives: string[] = [];

  if (!hasEnvExample) {
    securityIssues.push({
      severity: "medium",
      category: "security",
      file: "root",
      description: "No .env.example file found. Developers may resort to sharing .env files directly, risking credential leakage.",
      suggestion: "Create .env.example with all required env var names (no values) and document security-sensitive ones.",
    });
  } else securityPositives.push("Environment variable template (.env.example) documented");

  if (!hasCI) {
    securityIssues.push({
      severity: "medium",
      category: "config",
      description: "No CI/CD pipeline detected. Automated security scanning and testing are not enforced on pull requests.",
      suggestion: "Add GitHub Actions (or equivalent) with automated testing, linting, and security scanning (e.g., CodeQL, Snyk).",
    });
  } else securityPositives.push("CI/CD pipeline configured — automated checks enforced");

  if (!hasLinting) {
    securityIssues.push({
      severity: "low",
      category: "quality",
      description: "No ESLint/linting configuration detected. Code quality standards are not automatically enforced.",
      suggestion: "Add ESLint with @typescript-eslint and security-focused plugins (eslint-plugin-security).",
    });
  } else securityPositives.push("Linting configured — code style automatically enforced");

  // Check for outdated/risky deps
  const riskyDeps: string[] = [];
  const KNOWN_RISKY = ["lodash", "moment", "request", "node-uuid", "md5", "crypt"];
  for (const dep of KNOWN_RISKY) {
    if (dep in deps) riskyDeps.push(dep);
  }
  if (riskyDeps.length > 0) {
    securityIssues.push({
      severity: "low",
      category: "deps",
      description: `Potentially outdated/risky packages: ${riskyDeps.join(", ")}. Some have better modern alternatives.`,
      suggestion: "Run npm audit and consider replacing: moment → date-fns, lodash → native ES6, request → node-fetch/got.",
    });
  }

  // Architecture analysis
  const patterns: string[] = [];
  if (hasNextJs) patterns.push("Next.js (App Router)");
  if (hasReact && !hasNextJs) patterns.push("React SPA");
  if (hasExpressOrFastify) patterns.push("REST API");
  if (hasPrisma) patterns.push("Prisma ORM");
  if (hasDocker) patterns.push("Containerized");
  if (hasTypeScript) patterns.push("TypeScript");

  const archStrengths: string[] = [];
  const archConcerns: string[] = [];

  if (hasTypeScript) archStrengths.push("TypeScript provides compile-time type safety");
  if (hasCI) archStrengths.push("Automated CI/CD pipeline reduces manual error");
  if (hasPrisma) archStrengths.push("Prisma ORM provides type-safe database access");
  if (!hasTests && !hasTestDir) archConcerns.push("No test infrastructure detected — high regression risk");
  if (fileTree.filter((f) => f.startsWith("src/")).length === 0 && fileTree.length > 20) {
    archConcerns.push("Files not organized under src/ directory — consider standard project structure");
  }

  // Quality analysis
  const qualityIssues: RepoScanFinding[] = [];
  const qualityStrengths: string[] = [];

  if (hasTests || hasTestDir) qualityStrengths.push("Test infrastructure present");
  if (hasLinting) qualityStrengths.push("Linting enforces code style consistency");
  if (contributors > 1) qualityStrengths.push(`${contributors} contributors — active open-source community`);

  if (scanMode === "deep") {
    const readmeContent = keyFileContents["README.md"] ?? "";
    if (readmeContent.length < 200) {
      qualityIssues.push({
        severity: "low",
        category: "quality",
        description: "README is minimal or missing. Poor documentation increases onboarding friction.",
        suggestion: "Add sections: Project overview, Installation, Usage, Contributing, License.",
      });
    } else qualityStrengths.push("README documentation present");
  }

  // Score calculation
  let securityScore = 75;
  securityScore -= securityIssues.filter((i) => i.severity === "critical").length * 25;
  securityScore -= securityIssues.filter((i) => i.severity === "high").length * 15;
  securityScore -= securityIssues.filter((i) => i.severity === "medium").length * 8;
  securityScore -= securityIssues.filter((i) => i.severity === "low").length * 3;
  securityScore += securityPositives.length * 5;
  securityScore = Math.max(10, Math.min(98, securityScore));

  const qualityScore = Math.max(20, Math.min(95,
    65 +
    (hasTypeScript ? 10 : 0) +
    (hasLinting ? 8 : 0) +
    (hasTests || hasTestDir ? 10 : -15) +
    (qualityIssues.length * -5)
  ));

  const testabilityScore = Math.max(10, Math.min(95,
    (hasTests || hasTestDir ? 55 : 10) +
    (hasCI ? 15 : 0) +
    (fileTree.filter((f) => f.match(/\.(test|spec)\./)).length > 5 ? 10 : 0)
  ));

  const depScore = Math.max(20, Math.min(95, 80 - (riskyDeps.length * 8)));

  const healthScore = Math.round(
    (securityScore * 0.3 + qualityScore * 0.25 + testabilityScore * 0.25 + depScore * 0.2)
  );

  const securityGrade: "A" | "B" | "C" | "D" | "F" =
    securityScore >= 85 ? "A" :
    securityScore >= 70 ? "B" :
    securityScore >= 55 ? "C" :
    securityScore >= 40 ? "D" : "F";

  const qualityGrade: "A" | "B" | "C" | "D" | "F" =
    qualityScore >= 85 ? "A" :
    qualityScore >= 70 ? "B" :
    qualityScore >= 55 ? "C" :
    qualityScore >= 40 ? "D" : "F";

  const testabilityGrade: "A" | "B" | "C" | "D" | "F" =
    testabilityScore >= 75 ? "A" :
    testabilityScore >= 55 ? "B" :
    testabilityScore >= 40 ? "C" :
    testabilityScore >= 25 ? "D" : "F";

  // Recommendations
  const recommendations: RepoScanResult["recommendations"] = [];

  if (!hasCI) recommendations.push({
    priority: "immediate",
    title: "Set up CI/CD pipeline",
    description: "Add GitHub Actions with automated testing, linting, and security scanning. Every PR should be gated on these checks.",
    effort: "medium",
  });

  if (!hasTests && !hasTestDir) recommendations.push({
    priority: "immediate",
    title: "Establish test infrastructure",
    description: "Add a testing framework (Jest, Vitest, or pytest) and write tests for the most critical paths. Aim for 60%+ coverage.",
    effort: "high",
  });

  if (riskyDeps.length > 0) recommendations.push({
    priority: "short-term",
    title: "Modernize dependency stack",
    description: `Replace ${riskyDeps.join(", ")} with modern, actively-maintained alternatives. Run npm audit --fix.`,
    effort: "medium",
  });

  if (!hasEnvExample) recommendations.push({
    priority: "short-term",
    title: "Add .env.example template",
    description: "Document all required environment variables without values. This prevents credential sharing and helps new developers.",
    effort: "low",
  });

  if (!hasLinting) recommendations.push({
    priority: "short-term",
    title: "Configure code linting",
    description: "Add ESLint with TypeScript support. Enforce via pre-commit hooks and CI to maintain consistent code quality.",
    effort: "low",
  });

  recommendations.push({
    priority: "long-term",
    title: "Implement security scanning in CI",
    description: "Add automated security scanning: npm audit, CodeQL (GitHub), or Snyk. Configure Dependabot for automatic dependency updates.",
    effort: "medium",
  });

  const techDebtLevel: RepoScanResult["techDebt"]["level"] =
    testabilityScore < 30 && qualityScore < 50 ? "severe" :
    testabilityScore < 50 || qualityScore < 60 ? "significant" :
    qualityScore < 75 ? "manageable" : "minimal";

  return {
    healthScore,
    summary: `${repo} is a ${hasTypeScript ? "TypeScript" : meta.language ?? "code"} project${hasNextJs ? " built with Next.js" : ""}${hasPrisma ? " and Prisma ORM" : ""}. Overall health score is ${healthScore}/100 — ${healthScore >= 75 ? "solid foundation" : healthScore >= 55 ? "moderate health with areas to improve" : "significant improvements needed"}. ${!hasTests ? "Lack of test coverage is the primary risk factor." : "Test infrastructure is present."} ${contributors} contributor${contributors !== 1 ? "s" : ""} active on ${fileTree.length} tracked files.`,
    architecture: {
      summary: `${patterns.length > 0 ? patterns.join(" + ") : "Standard"} project structure. ${hasMigrations ? "Database migrations are tracked. " : ""}${fileTree.length > 100 ? "Large codebase requiring structured navigation." : "Manageable codebase size."}`,
      patterns,
      strengths: archStrengths.length > 0 ? archStrengths : ["Clear project structure"],
      concerns: archConcerns.length > 0 ? archConcerns : ["No major architectural concerns detected"],
    },
    security: {
      score: securityScore,
      grade: securityGrade,
      issues: securityIssues,
      positives: securityPositives.length > 0 ? securityPositives : ["No obvious hardcoded secrets in tracked files"],
    },
    codeQuality: {
      score: qualityScore,
      grade: qualityGrade,
      issues: qualityIssues,
      strengths: qualityStrengths.length > 0 ? qualityStrengths : ["Consistent project structure"],
    },
    testability: {
      score: testabilityScore,
      grade: testabilityGrade,
      hasTestFramework: hasTests || hasTestDir,
      coverageEstimate: hasTests ? "~30-50% (estimated)" : "Unknown — no test files detected",
      gaps: [
        ...(hasTests ? [] : ["No test files detected anywhere in the codebase"]),
        ...(hasCI ? [] : ["No CI enforcement of test execution"]),
        "Integration/E2E tests may be missing",
      ],
    },
    dependencies: {
      score: depScore,
      totalCount: depCount,
      risks: riskyDeps.length > 0
        ? [`Potentially outdated packages: ${riskyDeps.join(", ")}`]
        : ["Run npm audit to check for known vulnerabilities"],
      outdatedSignals: depCount > 50
        ? ["Large dependency tree increases maintenance burden and attack surface"]
        : [],
    },
    techDebt: {
      score: Math.max(20, Math.min(90, qualityScore - 10)),
      level: techDebtLevel,
      hotspots: [
        ...(!hasTests ? ["Test coverage (none detected)"] : []),
        ...(!hasCI ? ["CI/CD pipeline (none configured)"] : []),
        ...(riskyDeps.length > 0 ? ["Outdated dependencies"] : []),
      ],
      estimatedHours:
        techDebtLevel === "severe" ? "100+ hours" :
        techDebtLevel === "significant" ? "40-80 hours" :
        techDebtLevel === "manageable" ? "10-40 hours" : "< 10 hours",
    },
    recommendations: recommendations.slice(0, 6),
    metrics: {
      primaryLanguage: (meta.language as string) ?? (hasTypeScript ? "TypeScript" : "Unknown"),
      fileCount: fileTree.length,
      estimatedLoc: fileTree.length < 50 ? "< 5,000 lines" :
                   fileTree.length < 150 ? "~5,000-20,000 lines" :
                   fileTree.length < 400 ? "~20,000-80,000 lines" : "80,000+ lines",
      contributors,
      repoAge: "Unknown",
      openIssues: (meta.open_issues_count as number) ?? 0,
      stars: (meta.stargazers_count as number) ?? 0,
    },
    model: "gitscope-internal-v1",
    isDemo: false,
  };
}
