export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGitHubToken } from "@/lib/github-auth";
import { withRouteSecurity, SecurityPresets } from "@/lib/security-middleware";

// Google OSV batch query — up to 1000 packages per request
const OSV_BATCH_URL = "https://api.osv.dev/v1/querybatch";

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  severity?: { type: string; score: string }[];
  affected?: { package: { name: string; ecosystem: string }; versions?: string[] }[];
  references?: { type: string; url: string }[];
  database_specific?: { severity?: string };
}

interface OsvQueryResult {
  vulns?: OsvVuln[];
}

interface PkgEntry {
  name: string;
  version: string;
  devDependency: boolean;
}

function normalizeSeverity(vuln: OsvVuln): "critical" | "high" | "medium" | "low" {
  const raw = (vuln.database_specific?.severity ?? "").toLowerCase();
  if (raw === "critical") return "critical";
  if (raw === "high") return "high";
  if (raw === "moderate" || raw === "medium") return "medium";
  // Try CVSS score from severity array
  const cvss = vuln.severity?.find((s) => s.type === "CVSS_V3" || s.type === "CVSS_V2");
  if (cvss) {
    const score = parseFloat(cvss.score);
    if (score >= 9) return "critical";
    if (score >= 7) return "high";
    if (score >= 4) return "medium";
    return "low";
  }
  return "medium";
}

async function handler(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { repo?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { repo } = body;
  if (!repo || !repo.includes("/")) {
    return NextResponse.json({ error: "repo is required (owner/name)" }, { status: 400 });
  }

  const token = await getGitHubToken();
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (token) headers["Authorization"] = `token ${token}`;

  // ── Fetch package.json from default branch ────────────────────────────────
  const pkgRes = await fetch(`https://api.github.com/repos/${repo}/contents/package.json`, {
    headers,
    next: { revalidate: 0 },
  });

  if (!pkgRes.ok) {
    const hint =
      pkgRes.status === 403 ? "Repo is private or requires GitHub authentication." :
      pkgRes.status === 404 ? "No package.json found — repo may not be a Node.js project." :
      "GitHub API error fetching package.json.";
    return NextResponse.json({ error: hint }, { status: pkgRes.status === 404 ? 404 : 422 });
  }

  const pkgJson = await pkgRes.json();
  let pkgContent: Record<string, unknown>;
  try {
    pkgContent = JSON.parse(Buffer.from(pkgJson.content, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Failed to parse package.json" }, { status: 422 });
  }

  // ── Extract dependencies ──────────────────────────────────────────────────
  const packages: PkgEntry[] = [];
  for (const [name, ver] of Object.entries((pkgContent.dependencies ?? {}) as Record<string, string>)) {
    const clean = ver.replace(/^[\^~>=<]/, "").split(" ")[0];
    if (clean && /^\d/.test(clean)) packages.push({ name, version: clean, devDependency: false });
  }
  for (const [name, ver] of Object.entries((pkgContent.devDependencies ?? {}) as Record<string, string>)) {
    const clean = ver.replace(/^[\^~>=<]/, "").split(" ")[0];
    if (clean && /^\d/.test(clean)) packages.push({ name, version: clean, devDependency: true });
  }

  if (packages.length === 0) {
    return NextResponse.json({ repo, total: 0, findings: [], scannedPackages: 0, ecosystems: [] });
  }

  // OSV batch — cap at 500 packages to avoid huge payloads
  const limited = packages.slice(0, 500);

  const osvPayload = {
    queries: limited.map((p) => ({
      version: p.version,
      package: { name: p.name, ecosystem: "npm" },
    })),
  };

  const osvRes = await fetch(OSV_BATCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(osvPayload),
    next: { revalidate: 3600 },
  });

  if (!osvRes.ok) {
    return NextResponse.json({ error: "OSV API error" }, { status: 502 });
  }

  const osvData: { results: OsvQueryResult[] } = await osvRes.json();

  // ── Merge results back to packages ────────────────────────────────────────
  const findings: {
    id: string;
    package: string;
    version: string;
    ecosystem: string;
    summary: string;
    severity: "critical" | "high" | "medium" | "low";
    cvss?: string;
    fixedIn?: string[];
    url?: string;
  }[] = [];

  for (let i = 0; i < limited.length; i++) {
    const vulns = osvData.results[i]?.vulns ?? [];
    for (const v of vulns) {
      const url = v.references?.find((r) => r.type === "ADVISORY")?.url
        ?? v.references?.[0]?.url
        ?? `https://osv.dev/vulnerability/${v.id}`;
      const cvssEntry = v.severity?.find((s) => s.type === "CVSS_V3" || s.type === "CVSS_V2");
      const ecosystem = v.affected?.[0]?.package.ecosystem ?? "npm";
      const fixedIn = v.affected?.[0]?.versions?.filter((ver) => ver > limited[i].version).slice(0, 3);
      findings.push({
        id: v.id,
        package: limited[i].name,
        version: limited[i].version,
        ecosystem,
        summary: v.summary ?? v.details?.slice(0, 200) ?? "No description",
        severity: normalizeSeverity(v),
        cvss: cvssEntry ? parseFloat(cvssEntry.score).toFixed(1) : undefined,
        fixedIn: fixedIn?.length ? fixedIn : undefined,
        url,
      });
    }
  }

  // Sort: critical → high → medium → low, then by package name
  const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.package.localeCompare(b.package));

  const ecosystems = [...new Set(findings.map((f) => f.ecosystem))];

  return NextResponse.json({
    repo,
    total: findings.length,
    findings,
    scannedPackages: limited.length,
    ecosystems,
  });
}

export const POST = withRouteSecurity(handler, SecurityPresets.ai);
