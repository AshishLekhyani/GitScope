/**
 * GitScope Neural AI Client
 * ==========================
 * TypeScript HTTP client for the Python neural engine (services/ai-engine/).
 *
 * The engine runs at AI_ENGINE_URL (default: http://localhost:8765).
 * If the engine isn't running, all functions gracefully return null so
 * the caller can fall back to the TypeScript rule engine.
 *
 * Protocol:
 *   Analysis requests return NDJSON (newline-delimited JSON).
 *   Each line is a JSON object with an `event` field:
 *     { event: "start", ... }          — analysis begun
 *     { event: "agent_complete", ... } — one agent finished
 *     { event: "complete", ... }       — full merged result
 *     { event: "error", ... }          — something went wrong
 */

const AI_ENGINE_URL = process.env.AI_ENGINE_URL ?? "http://localhost:8765";
const ENGINE_TIMEOUT_MS = parseInt(process.env.AI_ENGINE_TIMEOUT ?? "30000", 10);

export interface NeuralEngineHealth {
  status: string;
  version: string;
  engine: string;
  capabilities: string[];
}

export interface NeuralFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  description: string;
  suggestion: string;
  file?: string | null;
  line?: number | null;
  code_snippet?: string | null;
  confidence: number;
  cve_id?: string | null;
  rule_id?: string | null;
  learned: boolean;
}

export interface NeuralPRResult {
  model: "gitscope-neural-v2";
  is_demo: false;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  merge_risk: "low" | "medium" | "high" | "critical";
  confidence: number;
  scores: {
    overall: number;
    security: number;
    quality: number;
    architecture: number;
    performance: number;
    dependency: number;
    value: number;
    test_coverage: number;
    breaking_risk: number;
  };
  findings: NeuralFinding[];
  insights: string[];
  positives: string[];
  flags: string[];
  breaking_changes: string[];
  security_issues: string[];
  recommendation: string;
  review_checklist: string[];
  estimated_review_time: string;
  suggested_reviewers: number;
  impact_areas: string[];
  affected_systems: string[];
  diff_stats: {
    file_count: number;
    additions: number;
    deletions: number;
    hot_files: Array<{ filename: string; additions: number; deletions: number }>;
  };
  agents: Array<{ id: string; name: string; score: number; confidence: number; duration_ms: number }>;
  detected_languages: string[];
  detected_frameworks: string[];
  total_ms: number;
}

export interface NeuralRepoResult {
  model: "gitscope-neural-v2";
  is_demo: false;
  health_score: number;
  summary: string;
  architecture: { summary: string; patterns: string[]; strengths: string[]; concerns: string[] };
  security: { score: number; grade: string; issues: NeuralFinding[]; positives: string[] };
  code_quality: { score: number; grade: string; issues: NeuralFinding[]; strengths: string[] };
  testability: { score: number; grade: string; has_test_framework: boolean; coverage_estimate: string; gaps: string[] };
  performance: { score: number; grade: string; issues: NeuralFinding[]; positives: string[] };
  dependencies: { score: number; total_count: number; risks: string[]; outdated_signals: string[]; licenses: Record<string, unknown> };
  tech_debt: { score: number; level: string; hotspots: string[]; estimated_hours: string };
  recommendations: Array<{ priority: string; title: string; description: string; effort: string; source_agent?: string }>;
  insights: string[];
  metrics: { primary_language: string; file_count: number; contributors: number; open_issues: number; stars: number };
  agents: Array<{ id: string; score: number; duration_ms: number }>;
}

// ── Health check ──────────────────────────────────────────────────────────────

export async function checkEngineHealth(): Promise<NeuralEngineHealth | null> {
  try {
    const res = await fetch(`${AI_ENGINE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function isEngineAvailable(): Promise<boolean> {
  const health = await checkEngineHealth();
  return health?.status === "ok";
}

// ── PR / Commit analysis ──────────────────────────────────────────────────────

export interface NeuralPRRequest {
  repo: string;
  analysis_type: "pr" | "commit";
  files: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string | null;
  }>;
  pr_meta?: {
    title: string;
    body?: string | null;
    user?: { login: string };
    additions?: number;
    deletions?: number;
    changed_files?: number;
    draft?: boolean;
    labels?: Array<{ name: string }>;
  };
  commit_meta?: {
    commit?: { message: string; author?: { name: string } };
    stats?: { additions: number; deletions: number };
  };
  pr_number?: number | null;
  sha?: string | null;
}

/**
 * Run neural PR/commit analysis.
 *
 * @param request - The analysis request
 * @param onProgress - Optional callback for streaming progress events
 * @returns Full result on success, null if engine is unavailable
 */
export async function analyzeWithNeuralEngine(
  request: NeuralPRRequest,
  onProgress?: (event: { agent_id: string; agent_name: string; score: number; duration_ms: number }) => void,
): Promise<NeuralPRResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);

    const res = await fetch(`${AI_ENGINE_URL}/analyze/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok || !res.body) return null;

    return await readNDJSONStream<NeuralPRResult>(res.body, (chunk) => {
      if (chunk.event === "agent_complete" && onProgress) {
        onProgress(chunk as { agent_id: string; agent_name: string; score: number; duration_ms: number });
      }
    });
  } catch {
    return null;
  }
}

// ── Repo scan ─────────────────────────────────────────────────────────────────

export interface NeuralRepoRequest {
  repo: string;
  file_tree: string[];
  key_file_contents: Record<string, string>;
  recent_commits: string[];
  contributors: number;
  meta: Record<string, unknown>;
  scan_mode: "standard" | "deep";
}

export async function scanRepoWithNeuralEngine(
  request: NeuralRepoRequest,
  onProgress?: (event: { agent_id: string; score: number }) => void,
): Promise<NeuralRepoResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);

    const res = await fetch(`${AI_ENGINE_URL}/analyze/repo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok || !res.body) return null;

    return await readNDJSONStream<NeuralRepoResult>(res.body, (chunk) => {
      if (chunk.event === "agent_complete" && onProgress) {
        onProgress(chunk as { agent_id: string; score: number });
      }
    });
  } catch {
    return null;
  }
}

// ── Knowledge base stats ──────────────────────────────────────────────────────

export async function getKnowledgeStats(): Promise<{
  total_patterns: number;
  total_repos: number;
  vector_store_available: boolean;
  learning_enabled: boolean;
} | null> {
  try {
    const res = await fetch(`${AI_ENGINE_URL}/knowledge/stats`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.knowledge_base ? { ...data.knowledge_base, learning_enabled: data.learning_enabled } : null;
  } catch {
    return null;
  }
}

// ── Trigger manual learning ───────────────────────────────────────────────────

export async function triggerLearning(): Promise<boolean> {
  try {
    const res = await fetch(`${AI_ENGINE_URL}/knowledge/trigger-learn`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── NDJSON stream reader ──────────────────────────────────────────────────────

async function readNDJSONStream<T>(
  body: ReadableStream<Uint8Array>,
  onChunk?: (chunk: Record<string, unknown>) => void,
): Promise<T | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: T | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (onChunk) onChunk(parsed);
          // The "complete" event carries the full merged result
          if (parsed.event === "complete") {
            finalResult = parsed as unknown as T;
          }
        } catch {
          // Malformed line — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return finalResult;
}
