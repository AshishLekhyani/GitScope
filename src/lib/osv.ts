export type OsvEcosystem = "npm" | "PyPI" | "Go" | "crates.io" | "RubyGems" | "Packagist" | "Maven";
export type VulnSeverity = "critical" | "high" | "medium" | "low";

export interface LockedPackage {
  name: string;
  version: string;
  ecosystem: OsvEcosystem;
  dev: boolean;
  direct: boolean;
  source: string;
  approximate: boolean;
}

export interface Vulnerability {
  id: string;
  aliases: string[];
  package: string;
  version: string;
  ecosystem: OsvEcosystem;
  summary: string;
  severity: VulnSeverity;
  cvss?: string;
  fixedIn?: string[];
  url: string;
  dev: boolean;
  direct: boolean;
  approximate: boolean;
  source: string;
}

export interface OsvScanResult {
  vulnerabilities: Vulnerability[];
  scanned: number;
  lockfiles: string[];
  complete: boolean;
}

export interface OsvVulnRecord {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: Array<{ type: string; score: string }>;
  affected?: Array<{
    package?: { name: string; ecosystem: string };
    ranges?: Array<{ type: string; events: Array<{ introduced?: string; fixed?: string; last_affected?: string; limit?: string }> }>;
    database_specific?: { severity?: string };
    ecosystem_specific?: { severity?: string };
  }>;
  references?: Array<{ type: string; url: string }>;
  database_specific?: { severity?: string };
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

function npmNameFromKey(key: string): string {
  const idx = key.lastIndexOf("node_modules/");
  return idx >= 0 ? key.slice(idx + "node_modules/".length) : key;
}

function rootManifest(files: Map<string, string>, dir: string): { deps: Set<string>; devDeps: Set<string> } {
  const raw = files.get(`${dir}package.json`);
  if (!raw) return { deps: new Set(), devDeps: new Set() };
  try {
    const pkg = JSON.parse(raw) as Record<string, Record<string, string> | undefined>;
    return {
      deps: new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]),
      devDeps: new Set(Object.keys(pkg.devDependencies ?? {})),
    };
  } catch {
    return { deps: new Set(), devDeps: new Set() };
  }
}

function parsePackageLock(raw: string, path: string, manifest: { deps: Set<string>; devDeps: Set<string> }): LockedPackage[] {
  let lock: Record<string, unknown>;
  try { lock = JSON.parse(raw); } catch { return []; }
  const out: LockedPackage[] = [];
  const packages = lock.packages as Record<string, { version?: string; dev?: boolean; devOptional?: boolean; link?: boolean; inBundle?: boolean }> | undefined;
  if (packages) {
    for (const [key, entry] of Object.entries(packages)) {
      if (!key || !key.includes("node_modules/") || entry.link || !entry.version || !/^\d/.test(entry.version)) continue;
      const name = npmNameFromKey(key);
      const top = key === `node_modules/${name}`;
      out.push({
        name, version: entry.version, ecosystem: "npm", dev: Boolean(entry.dev || entry.devOptional),
        direct: top && (manifest.deps.has(name) || manifest.devDeps.has(name)), source: path, approximate: false,
      });
    }
    return out;
  }
  const walk = (deps: Record<string, { version?: string; dev?: boolean; dependencies?: Record<string, unknown> }> | undefined, depth: number) => {
    if (!deps || depth > 12) return;
    for (const [name, entry] of Object.entries(deps)) {
      if (entry.version && /^\d/.test(entry.version)) {
        out.push({ name, version: entry.version, ecosystem: "npm", dev: Boolean(entry.dev), direct: depth === 0 && (manifest.deps.has(name) || manifest.devDeps.has(name)), source: path, approximate: false });
      }
      walk(entry.dependencies as typeof deps, depth + 1);
    }
  };
  walk(lock.dependencies as Parameters<typeof walk>[0], 0);
  return out;
}

function specName(spec: string): string {
  const clean = spec.trim().replace(/^["']|["']$/g, "");
  const at = clean.indexOf("@", clean.startsWith("@") ? 1 : 0);
  return at > 0 ? clean.slice(0, at) : clean;
}

function parseYarnLock(raw: string, path: string, manifest: { deps: Set<string>; devDeps: Set<string> }): LockedPackage[] {
  const out: LockedPackage[] = [];
  let names: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line) && line.trimEnd().endsWith(":")) {
      const specs = line.trimEnd().slice(0, -1).split(/,\s*/).filter((spec) => !/@(?:workspace|patch|link|portal|file|exec):/.test(spec));
      names = [...new Set(specs.map(specName))].filter((n) => n && n !== "__metadata");
      continue;
    }
    const m = /^\s{2}version:?\s+"?([^"\s]+)"?/.exec(line);
    if (m && names.length > 0 && /^\d/.test(m[1])) {
      for (const name of names) {
        out.push({ name, version: m[1], ecosystem: "npm", dev: manifest.devDeps.has(name) && !manifest.deps.has(name), direct: manifest.deps.has(name) || manifest.devDeps.has(name), source: path, approximate: false });
      }
      names = [];
    }
  }
  return out;
}

function parsePnpmLock(raw: string, path: string, manifest: { deps: Set<string>; devDeps: Set<string> }): LockedPackage[] {
  const out: LockedPackage[] = [];
  let inPackages = false;
  let current: LockedPackage | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      current = null;
      continue;
    }
    if (!inPackages) continue;
    const head = /^ {2}['"]?\/?((?:@[^/@\s]+\/)?[^/@\s(]+)[@/](\d[^:'"()\s_]*)[^:]*['"]?:\s*$/.exec(line);
    if (head) {
      const name = head[1];
      current = { name, version: head[2], ecosystem: "npm", dev: manifest.devDeps.has(name) && !manifest.deps.has(name), direct: manifest.deps.has(name) || manifest.devDeps.has(name), source: path, approximate: false };
      out.push(current);
      continue;
    }
    if (current && /^\s{4}dev:\s*true/.test(line)) current.dev = true;
  }
  return out;
}

function parseTomlPackages(raw: string, path: string, ecosystem: OsvEcosystem, requireRegistry: boolean): LockedPackage[] {
  const out: LockedPackage[] = [];
  for (const block of raw.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    if (requireRegistry && !/^source\s*=\s*"registry\+/m.test(block)) continue;
    const category = /^category\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    out.push({ name, version, ecosystem, dev: category === "dev", direct: false, source: path, approximate: false });
  }
  return out;
}

function parsePipfileLock(raw: string, path: string): LockedPackage[] {
  let lock: Record<string, Record<string, { version?: string }> | undefined>;
  try { lock = JSON.parse(raw); } catch { return []; }
  const out: LockedPackage[] = [];
  for (const [section, dev] of [["default", false], ["develop", true]] as const) {
    for (const [name, entry] of Object.entries(lock[section] ?? {})) {
      const version = entry.version?.replace(/^==/, "");
      if (version && /^\d/.test(version)) out.push({ name, version, ecosystem: "PyPI", dev, direct: true, source: path, approximate: false });
    }
  }
  return out;
}

function parseRequirements(raw: string, path: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  const dev = /dev|test/i.test(basename(path));
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*==\s*([\w.!+-]+)/.exec(line);
    if (m) out.push({ name: m[1], version: m[2], ecosystem: "PyPI", dev, direct: true, source: path, approximate: false });
  }
  return out;
}

function parseGemfileLock(raw: string, path: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  let inSpecs = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inSpecs = false; continue; }
    if (/^ {2}specs:\s*$/.test(line)) { inSpecs = true; continue; }
    if (!inSpecs) continue;
    const m = /^ {4}([\w.-]+) \(([^)]+)\)\s*$/.exec(line);
    if (m) out.push({ name: m[1], version: m[2].replace(/-(?:x86|arm|aarch|java|universal|x64|mingw|darwin|linux)[\w-]*$/, ""), ecosystem: "RubyGems", dev: false, direct: false, source: path, approximate: false });
  }
  return out;
}

function parseComposerLock(raw: string, path: string): LockedPackage[] {
  let lock: Record<string, Array<{ name?: string; version?: string }> | undefined>;
  try { lock = JSON.parse(raw); } catch { return []; }
  const out: LockedPackage[] = [];
  for (const [section, dev] of [["packages", false], ["packages-dev", true]] as const) {
    for (const entry of lock[section] ?? []) {
      const version = entry.version?.replace(/^v/, "");
      if (entry.name && version && /^\d/.test(version)) out.push({ name: entry.name, version, ecosystem: "Packagist", dev, direct: false, source: path, approximate: false });
    }
  }
  return out;
}

function parseGoMod(raw: string, path: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  const add = (mod: string, ver: string, comment: string) => {
    if (!/^v\d/.test(ver)) return;
    out.push({ name: mod, version: ver.replace(/^v/, "").replace(/\+incompatible$/, ""), ecosystem: "Go", dev: false, direct: !/indirect/.test(comment), source: path, approximate: false });
  };
  for (const block of raw.matchAll(/^require\s*\(([\s\S]*?)^\)/gm)) {
    for (const line of block[1].split(/\r?\n/)) {
      const m = /^\s*(\S+)\s+(v\S+)(.*)$/.exec(line);
      if (m) add(m[1], m[2], m[3]);
    }
  }
  for (const m of raw.matchAll(/^require\s+(\S+)\s+(v\S+)(.*)$/gm)) add(m[1], m[2], m[3]);
  return out;
}

function lowerBound(range: string): string | null {
  const trimmed = range.trim();
  if (/^(?:workspace|file|link|git|github|http|npm):|\|\||\s-\s|^\*$|^latest$/i.test(trimmed)) return null;
  const m = /^(?:[\^~]|>=|=)?\s*v?(\d+(?:\.\d+){0,2}(?:-[\w.]+)?)/.exec(trimmed);
  if (!m) return null;
  const parts = m[1].split("-")[0].split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".") + (m[1].includes("-") ? m[1].slice(m[1].indexOf("-")) : "");
}

function declaredNpm(raw: string, path: string): LockedPackage[] {
  let pkg: Record<string, Record<string, string> | undefined>;
  try { pkg = JSON.parse(raw); } catch { return []; }
  const out: LockedPackage[] = [];
  for (const [section, dev] of [["dependencies", false], ["optionalDependencies", false], ["devDependencies", true]] as const) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (typeof range !== "string") continue;
      const version = lowerBound(range);
      if (version) out.push({ name, version, ecosystem: "npm", dev, direct: true, source: path, approximate: !/^\d/.test(range.trim()) });
    }
  }
  return out;
}

function declaredPython(raw: string, path: string): LockedPackage[] {
  const out: LockedPackage[] = [];
  const deps = /^\[(?:tool\.poetry\.)?dependencies\]\s*$([\s\S]*?)(?=^\[)/m.exec(`${raw}\n[`)?.[1] ?? "";
  for (const m of deps.matchAll(/^([A-Za-z0-9][\w.-]*)\s*=\s*"[\^~>=]*\s*(\d[\w.]*)"/gm)) {
    if (m[1].toLowerCase() !== "python") out.push({ name: m[1], version: m[2], ecosystem: "PyPI", dev: false, direct: true, source: path, approximate: true });
  }
  for (const m of raw.matchAll(/"([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*(==|>=|~=)\s*(\d[\w.]*)/g)) {
    out.push({ name: m[1], version: m[3], ecosystem: "PyPI", dev: false, direct: true, source: path, approximate: m[2] !== "==" });
  }
  return out;
}

const LOCK_PARSERS: Array<{ test: RegExp; parse: (raw: string, path: string, files: Map<string, string>) => LockedPackage[] }> = [
  { test: /(?:^|\/)(?:package-lock|npm-shrinkwrap)\.json$/, parse: (raw, path, files) => parsePackageLock(raw, path, rootManifest(files, dirname(path))) },
  { test: /(?:^|\/)yarn\.lock$/, parse: (raw, path, files) => parseYarnLock(raw, path, rootManifest(files, dirname(path))) },
  { test: /(?:^|\/)pnpm-lock\.yaml$/, parse: (raw, path, files) => parsePnpmLock(raw, path, rootManifest(files, dirname(path))) },
  { test: /(?:^|\/)poetry\.lock$/, parse: (raw, path) => parseTomlPackages(raw, path, "PyPI", false) },
  { test: /(?:^|\/)Pipfile\.lock$/, parse: (raw, path) => parsePipfileLock(raw, path) },
  { test: /(?:^|\/)Cargo\.lock$/, parse: (raw, path) => parseTomlPackages(raw, path, "crates.io", true) },
  { test: /(?:^|\/)Gemfile\.lock$/, parse: (raw, path) => parseGemfileLock(raw, path) },
  { test: /(?:^|\/)composer\.lock$/, parse: (raw, path) => parseComposerLock(raw, path) },
  { test: /(?:^|\/)go\.mod$/, parse: (raw, path) => parseGoMod(raw, path) },
  { test: /(?:^|\/)requirements(?:[-_.][\w-]+)?\.txt$/, parse: (raw, path) => parseRequirements(raw, path) },
];

const SKIP_PATH = /(?:^|\/)(?:node_modules|vendor|\.git|dist|build|fixtures?|__fixtures__|test-?data|examples?)\//i;

export function collectPackages(input: Map<string, string> | Record<string, string>): { packages: LockedPackage[]; lockfiles: string[] } {
  const files = input instanceof Map ? input : new Map(Object.entries(input));
  const packages: LockedPackage[] = [];
  const lockfiles: string[] = [];
  const lockedDirs = new Map<OsvEcosystem, Set<string>>();
  const markLocked = (eco: OsvEcosystem, dir: string) => {
    if (!lockedDirs.has(eco)) lockedDirs.set(eco, new Set());
    lockedDirs.get(eco)!.add(dir);
  };

  for (const [path, raw] of files) {
    if (SKIP_PATH.test(path)) continue;
    const parser = LOCK_PARSERS.find((p) => p.test.test(path));
    if (!parser) continue;
    const found = parser.parse(raw, path, files);
    if (found.length === 0) continue;
    lockfiles.push(path);
    packages.push(...found);
    markLocked(found[0].ecosystem, dirname(path));
  }

  for (const [path, raw] of files) {
    if (SKIP_PATH.test(path)) continue;
    const name = basename(path);
    if (name === "package.json" && !lockedDirs.get("npm")?.has(dirname(path))) packages.push(...declaredNpm(raw, path));
    if (name === "pyproject.toml" && !lockedDirs.get("PyPI")?.has(dirname(path))) packages.push(...declaredPython(raw, path));
  }

  const seen = new Map<string, LockedPackage>();
  for (const p of packages) {
    const key = `${p.ecosystem}:${p.ecosystem === "PyPI" ? p.name.toLowerCase().replace(/[-_.]+/g, "-") : p.name}@${p.version}`;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, { ...p }); continue; }
    prev.dev = prev.dev && p.dev;
    prev.direct = prev.direct || p.direct;
    prev.approximate = prev.approximate && p.approximate;
  }
  return { packages: [...seen.values()], lockfiles };
}

export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const plain = v.replace(/^v/, "");
    const cut = plain.indexOf("-");
    const [core, pre] = cut >= 0 ? [plain.slice(0, cut), plain.slice(cut + 1)] : [plain, undefined];
    return { core: core.split(/[.+]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x)), pre: pre ?? "" };
  };
  const va = split(a);
  const vb = split(b);
  for (let i = 0; i < Math.max(va.core.length, vb.core.length); i++) {
    const x = va.core[i] ?? 0;
    const y = vb.core[i] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y));
  }
  if (va.pre === vb.pre) return 0;
  if (!va.pre) return 1;
  if (!vb.pre) return -1;
  return va.pre.localeCompare(vb.pre, undefined, { numeric: true });
}

const CVSS3: Record<string, Record<string, number>> = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  CIA: { H: 0.56, L: 0.22, N: 0 },
};

export function cvss3BaseScore(vector: string): number | null {
  const m = Object.fromEntries(vector.split("/").map((part) => part.split(":")).filter((kv) => kv.length === 2));
  if (!/^3\.[01]$/.test(m.CVSS ?? "")) return null;
  const changed = m.S === "C";
  const av = CVSS3.AV[m.AV];
  const ac = CVSS3.AC[m.AC];
  const ui = CVSS3.UI[m.UI];
  const pr = m.PR === "N" ? 0.85 : m.PR === "L" ? (changed ? 0.68 : 0.62) : m.PR === "H" ? (changed ? 0.5 : 0.27) : undefined;
  const [c, i, a] = [CVSS3.CIA[m.C], CVSS3.CIA[m.I], CVSS3.CIA[m.A]];
  if ([av, ac, ui, pr, c, i, a].some((x) => x === undefined)) return null;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr! * ui;
  const raw = changed ? Math.min(1.08 * (impact + exploitability), 10) : Math.min(impact + exploitability, 10);
  const scaled = Math.round(raw * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
}

function cvss4Estimate(vector: string): number | null {
  const m = Object.fromEntries(vector.split("/").map((part) => part.split(":")).filter((kv) => kv.length === 2));
  if (!(m.CVSS ?? "").startsWith("4")) return null;
  const impact = ["VC", "VI", "VA"].reduce((n, k) => n + (m[k] === "H" ? 2 : m[k] === "L" ? 1 : 0), 0);
  const reach = (m.AV === "N" ? 2 : m.AV === "A" ? 1 : 0) + (m.PR === "N" ? 1 : 0) + (m.UI === "N" ? 1 : 0) + (m.AC === "L" ? 1 : 0);
  return Math.min(10, Math.round((impact * 1.1 + reach * 0.9) * 10) / 10);
}

const severityFromScore = (score: number): VulnSeverity => (score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : "low");

function severityLabel(raw: string | undefined): VulnSeverity | null {
  const s = (raw ?? "").toLowerCase();
  if (s === "critical") return "critical";
  if (s === "high") return "high";
  if (s === "moderate" || s === "medium") return "medium";
  if (s === "low") return "low";
  return null;
}

export function vulnSeverity(record: OsvVulnRecord): { severity: VulnSeverity; score?: number } {
  let score: number | undefined;
  for (const entry of record.severity ?? []) {
    const value = entry.type === "CVSS_V3" ? cvss3BaseScore(entry.score) : entry.type === "CVSS_V4" ? cvss4Estimate(entry.score) : null;
    if (value !== null && (score === undefined || entry.type === "CVSS_V3")) score = value;
  }
  const label = severityLabel(record.database_specific?.severity)
    ?? severityLabel(record.affected?.find((a) => a.database_specific?.severity)?.database_specific?.severity)
    ?? severityLabel(record.affected?.find((a) => a.ecosystem_specific?.severity)?.ecosystem_specific?.severity);
  return { severity: label ?? (score !== undefined ? severityFromScore(score) : "medium"), score };
}

function normName(ecosystem: OsvEcosystem, name: string): string {
  return ecosystem === "PyPI" ? name.toLowerCase().replace(/[-_.]+/g, "-") : name;
}

export function fixedVersions(record: OsvVulnRecord, pkg: Pick<LockedPackage, "name" | "ecosystem" | "version">): string[] {
  const fixes = new Set<string>();
  for (const affected of record.affected ?? []) {
    if (!affected.package || normName(pkg.ecosystem, affected.package.name) !== normName(pkg.ecosystem, pkg.name)) continue;
    for (const range of affected.ranges ?? []) {
      if (range.type === "GIT") continue;
      for (const event of range.events) {
        if (event.fixed && compareVersions(event.fixed, pkg.version) > 0) fixes.add(event.fixed);
      }
    }
  }
  return [...fixes].sort(compareVersions).slice(0, 3);
}

async function pool<T, R>(items: T[], limit: number, deadline: number, fn: (item: T) => Promise<R>): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length && Date.now() < deadline) {
      const i = next++;
      try { results[i] = await fn(items[i]); } catch { results[i] = undefined; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface OsvQueryOptions {
  timeoutMs?: number;
  maxPackages?: number;
  maxDetails?: number;
  fetchImpl?: typeof fetch;
}

const OSV_API = "https://api.osv.dev/v1";
const VULN_SEVERITY_RANK: Record<VulnSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function queryOsv(packages: LockedPackage[], opts: OsvQueryOptions = {}): Promise<OsvScanResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  const ordered = [...packages].sort((a, b) => Number(a.dev) - Number(b.dev) || Number(b.direct) - Number(a.direct));
  const limited = ordered.slice(0, opts.maxPackages ?? 3000);
  let complete = limited.length === packages.length;

  const hits: Array<{ pkg: LockedPackage; ids: string[] }> = [];
  for (let start = 0; start < limited.length; start += 1000) {
    if (Date.now() >= deadline) { complete = false; break; }
    const chunk = limited.slice(start, start + 1000);
    try {
      const res = await doFetch(`${OSV_API}/querybatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: chunk.map((p) => ({ version: p.version, package: { name: p.name, ecosystem: p.ecosystem } })) }),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
      if (!res.ok) { complete = false; continue; }
      const data = (await res.json()) as { results?: Array<{ vulns?: Array<{ id: string }> }> };
      (data.results ?? []).forEach((r, i) => {
        if (r.vulns?.length && chunk[i]) hits.push({ pkg: chunk[i], ids: r.vulns.map((v) => v.id) });
      });
    } catch {
      complete = false;
    }
  }

  const uniqueIds = [...new Set(hits.flatMap((h) => h.ids))];
  const detailIds = uniqueIds.slice(0, opts.maxDetails ?? 250);
  if (detailIds.length < uniqueIds.length) complete = false;
  const records = new Map<string, OsvVulnRecord>();
  const fetched = await pool(detailIds, 10, deadline, async (id) => {
    const res = await doFetch(`${OSV_API}/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())) });
    return res.ok ? ((await res.json()) as OsvVulnRecord) : undefined;
  });
  fetched.forEach((r, i) => { if (r) records.set(detailIds[i], r); });
  if (records.size < detailIds.length) complete = false;

  const vulnerabilities: Vulnerability[] = [];
  for (const { pkg, ids } of hits) {
    const covered = new Set<string>();
    const ranked = ids
      .map((id) => records.get(id) ?? ({ id } as OsvVulnRecord))
      .sort((a, b) => Number(!a.id.startsWith("GHSA")) - Number(!b.id.startsWith("GHSA")));
    for (const record of ranked) {
      if (covered.has(record.id)) continue;
      covered.add(record.id);
      for (const alias of record.aliases ?? []) covered.add(alias);
      const { severity, score } = vulnSeverity(record);
      const fixes = fixedVersions(record, pkg);
      vulnerabilities.push({
        id: record.id,
        aliases: (record.aliases ?? []).filter((a) => a !== record.id),
        package: pkg.name,
        version: pkg.version,
        ecosystem: pkg.ecosystem,
        summary: record.summary ?? record.details?.split("\n")[0].slice(0, 200) ?? "Known vulnerability",
        severity,
        cvss: score !== undefined ? score.toFixed(1) : undefined,
        fixedIn: fixes.length > 0 ? fixes : undefined,
        url: record.references?.find((r) => r.type === "ADVISORY")?.url ?? `https://osv.dev/vulnerability/${record.id}`,
        dev: pkg.dev,
        direct: pkg.direct,
        approximate: pkg.approximate,
        source: pkg.source,
      });
    }
  }

  vulnerabilities.sort((a, b) =>
    VULN_SEVERITY_RANK[a.severity] - VULN_SEVERITY_RANK[b.severity] ||
    Number(a.dev) - Number(b.dev) ||
    a.package.localeCompare(b.package));
  return { vulnerabilities, scanned: limited.length, lockfiles: [], complete };
}

export async function scanDependencies(files: Map<string, string> | Record<string, string>, opts: OsvQueryOptions = {}): Promise<OsvScanResult & { packages: LockedPackage[] }> {
  const { packages, lockfiles } = collectPackages(files);
  if (packages.length === 0) return { vulnerabilities: [], scanned: 0, lockfiles, complete: true, packages };
  const result = await queryOsv(packages, opts);
  return { ...result, lockfiles, packages };
}

export interface VulnerablePackage {
  name: string;
  version: string;
  ecosystem: OsvEcosystem;
  severity: VulnSeverity;
  counts: Record<VulnSeverity, number>;
  ids: string[];
  cves: string[];
  summaries: string[];
  fixTarget?: string;
  unfixed: number;
  dev: boolean;
  direct: boolean;
  approximate: boolean;
  source: string;
}

export function groupVulnerabilities(vulns: Vulnerability[]): VulnerablePackage[] {
  const groups = new Map<string, VulnerablePackage>();
  for (const v of vulns) {
    const key = `${v.ecosystem}:${v.package}@${v.version}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        name: v.package, version: v.version, ecosystem: v.ecosystem, severity: v.severity,
        counts: { critical: 0, high: 0, medium: 0, low: 0 }, ids: [], cves: [], summaries: [],
        unfixed: 0, dev: v.dev, direct: v.direct, approximate: v.approximate, source: v.source,
      };
      groups.set(key, g);
    }
    g.counts[v.severity]++;
    if (VULN_SEVERITY_RANK[v.severity] < VULN_SEVERITY_RANK[g.severity]) g.severity = v.severity;
    g.ids.push(v.id);
    g.cves.push(...v.aliases.filter((a) => a.startsWith("CVE-")));
    if (g.summaries.length < 3 && !g.summaries.includes(v.summary)) g.summaries.push(v.summary);
    const minimalFix = v.fixedIn?.[0];
    if (!minimalFix) g.unfixed++;
    else if (!g.fixTarget || compareVersions(minimalFix, g.fixTarget) > 0) g.fixTarget = minimalFix;
  }
  return [...groups.values()].sort((a, b) =>
    VULN_SEVERITY_RANK[a.severity] - VULN_SEVERITY_RANK[b.severity] ||
    Number(a.dev) - Number(b.dev) ||
    Number(b.direct) - Number(a.direct) ||
    b.ids.length - a.ids.length);
}

export function describeCounts(counts: Record<VulnSeverity, number>): string {
  return (["critical", "high", "medium", "low"] as const).filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`).join(", ");
}
