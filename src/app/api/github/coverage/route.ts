export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

async function ghText(path: string, token: string | null): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${path}`, {
      headers: {
        Accept: "application/vnd.github.v3.raw",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.text();
  } catch { return null; }
}

async function ghJson<T>(url: string, token: string | null): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

interface CoverageResult {
  coverage: number | null;       // 0-100 or null if not found
  source: string;                // "codecov" | "detected" | "none"
  frameworks: string[];          // detected test frameworks
  hasConfig: boolean;
  configFiles: string[];
  lines?: number;
  branches?: number;
  functions?: number;
  trend?: { date: string; coverage: number }[];
}

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const repo = req.nextUrl.searchParams.get("repo");
  if (!repo || !repo.includes("/")) {
    return NextResponse.json({ error: "repo param required (owner/name)" }, { status: 400 });
  }

  const [owner, repoName] = repo.split("/");
  const token = await getGitHubToken();

  const result: CoverageResult = {
    coverage: null,
    source: "none",
    frameworks: [],
    hasConfig: false,
    configFiles: [],
  };

  // ── 1. Try Codecov public API ────────────────────────────────────────────────
  try {
    const codecovRes = await fetch(`https://codecov.io/api/v2/github/${owner}/repos/${repoName}/`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (codecovRes.ok) {
      const data = await codecovRes.json() as { totals?: { coverage?: string | number } };
      const cov = data?.totals?.coverage;
      if (cov !== undefined && cov !== null) {
        result.coverage = Math.round(parseFloat(String(cov)) * 10) / 10;
        result.source = "codecov";
      }

      // Fetch commit history for trend
      const histRes = await fetch(
        `https://codecov.io/api/v2/github/${owner}/repos/${repoName}/commits/?page_size=10`,
        { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
      );
      if (histRes.ok) {
        const hist = await histRes.json() as { results?: { timestamp: string; totals?: { coverage?: string | number } }[] };
        if (hist.results) {
          result.trend = hist.results
            .filter((c) => c.totals?.coverage !== undefined)
            .map((c) => ({
              date: c.timestamp,
              coverage: Math.round(parseFloat(String(c.totals!.coverage)) * 10) / 10,
            }))
            .reverse();
        }
      }
    }
  } catch { /* Codecov not available — fall through */ }

  // ── 2. Detect test frameworks from package.json / requirements.txt ──────────
  const configChecks = [
    { file: "contents/jest.config.js",        label: "jest.config.js",        framework: "Jest"      },
    { file: "contents/jest.config.ts",        label: "jest.config.ts",        framework: "Jest"      },
    { file: "contents/vitest.config.ts",      label: "vitest.config.ts",      framework: "Vitest"    },
    { file: "contents/vitest.config.js",      label: "vitest.config.js",      framework: "Vitest"    },
    { file: "contents/.nycrc",                label: ".nycrc",                 framework: "nyc"       },
    { file: "contents/codecov.yml",           label: "codecov.yml",           framework: "Codecov"   },
    { file: "contents/.codecov.yml",          label: ".codecov.yml",          framework: "Codecov"   },
    { file: "contents/pytest.ini",            label: "pytest.ini",            framework: "pytest"    },
    { file: "contents/setup.cfg",             label: "setup.cfg",             framework: "pytest"    },
    { file: "contents/.coveragerc",           label: ".coveragerc",           framework: "coverage.py"},
    { file: "contents/go.mod",               label: "go.mod",                framework: "go test"   },
  ];

  const fileChecks = await Promise.all(
    configChecks.map(async (c) => {
      const res = await ghJson<{ name: string }>(
        `https://api.github.com/repos/${repo}/${c.file}`,
        token
      );
      return res ? c : null;
    })
  );

  const found = fileChecks.filter(Boolean) as typeof configChecks;
  result.configFiles = found.map((c) => c.label);
  result.frameworks  = [...new Set(found.map((c) => c.framework))];
  result.hasConfig   = found.length > 0;

  // Check package.json for test scripts/coverage config
  const pkgText = await ghText(`${repo}/contents/package.json`, token);
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as {
        scripts?: Record<string, string>;
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const allDeps = { ...pkg.devDependencies, ...pkg.dependencies };
      if (allDeps.jest)     result.frameworks.push("Jest");
      if (allDeps.vitest)   result.frameworks.push("Vitest");
      if (allDeps.mocha)    result.frameworks.push("Mocha");
      if (allDeps.jasmine)  result.frameworks.push("Jasmine");
      if (allDeps.ava)      result.frameworks.push("Ava");
      if (allDeps.tap)      result.frameworks.push("Tap");
      if (allDeps.c8)       result.frameworks.push("c8");
      if (allDeps.nyc)      result.frameworks.push("nyc");
      result.frameworks = [...new Set(result.frameworks)];
    } catch { /* ignore */ }
  }

  // Check requirements.txt for Python test frameworks
  const reqText = await ghText(`${repo}/contents/requirements.txt`, token);
  if (reqText) {
    if (reqText.includes("pytest"))   result.frameworks.push("pytest");
    if (reqText.includes("coverage")) result.frameworks.push("coverage.py");
    if (reqText.includes("nose"))     result.frameworks.push("nose");
    result.frameworks = [...new Set(result.frameworks)];
  }

  if (result.frameworks.length > 0) result.hasConfig = true;

  return NextResponse.json(result);
}

export const GET = withRouteSecurity(handler, SecurityPresets.standard);
