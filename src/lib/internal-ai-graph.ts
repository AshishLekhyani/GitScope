import {
  callArgsAt,
  computeTaint,
  evaluateSite,
  exprTaint,
  findClose,
  functionBodyAfter,
  getAssignments,
  getTaint,
  hasTaintSources,
  isGuarded,
  isSuppressed,
  leadingOperand,
  maskSource,
  prefixTaint,
  redactSecrets,
  reportableLine,
  sinkSites,
  splitTopLevel,
  statementEnd,
  type EngineFinding,
  type FileCtx,
  type Severity,
  type SinkRule,
  type TaintedVar,
  type TaintHit,
  type TaintState,
} from "@/lib/internal-ai-engine";
import { AUTH_INDICATOR, RATE_LIMIT_INDICATOR, TAINT_SINKS } from "@/lib/internal-ai-rules";

export interface AliasMap {
  prefixes: Array<{ prefix: string; targets: string[] }>;
}

const DEFAULT_ALIASES: AliasMap["prefixes"] = [
  { prefix: "@/", targets: ["src/", ""] },
  { prefix: "~/", targets: ["src/", ""] },
];

export function readAliases(tsconfigRaw?: string): AliasMap {
  if (!tsconfigRaw) return { prefixes: DEFAULT_ALIASES };
  try {
    const json = JSON.parse(maskSource(tsconfigRaw, "json").text.replace(/,(\s*[}\]])/g, "$1")) as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, unknown> };
    };
    const opts = json.compilerOptions ?? {};
    const baseUrl = normalizePath(String(opts.baseUrl ?? "."));
    const custom: AliasMap["prefixes"] = [];
    for (const [key, values] of Object.entries(opts.paths ?? {})) {
      if (!key.endsWith("/*") || !Array.isArray(values)) continue;
      const targets = values
        .filter((v): v is string => typeof v === "string" && v.endsWith("/*"))
        .map((v) => {
          const t = normalizePath(`${baseUrl}/${v.slice(0, -1)}`);
          return t ? `${t}/` : "";
        });
      if (targets.length > 0) custom.push({ prefix: key.slice(0, -1), targets });
    }
    custom.sort((a, b) => b.prefix.length - a.prefix.length);
    return { prefixes: [...custom, ...DEFAULT_ALIASES.filter((d) => !custom.some((c) => c.prefix === d.prefix))] };
  } catch {
    return { prefixes: DEFAULT_ALIASES };
  }
}

function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "." && seg !== "") out.push(seg);
  }
  return out.join("/");
}

function dirOf(file: string): string {
  return file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
}

const JS_RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

export interface Resolution {
  resolved: string | null;
  local: boolean;
}

export function resolveSpecifier(from: string, spec: string, files: Set<string>, aliases: AliasMap): Resolution {
  let bases: string[];
  if (spec === "." || spec === ".." || spec.startsWith("./") || spec.startsWith("../")) {
    bases = [normalizePath(`${dirOf(from)}/${spec}`)];
  } else {
    const alias = aliases.prefixes.find((p) => spec.startsWith(p.prefix));
    if (!alias) return { resolved: null, local: false };
    bases = alias.targets.map((t) => normalizePath(t + spec.slice(alias.prefix.length)));
  }
  for (const base of bases) {
    for (const suffix of JS_RESOLVE_SUFFIXES) {
      if (files.has(base + suffix)) return { resolved: base + suffix, local: true };
    }
    const jsExt = /\.(?:js|jsx|mjs|cjs)$/.exec(base);
    if (jsExt) {
      for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
        const candidate = base.slice(0, -jsExt[0].length) + ext;
        if (files.has(candidate)) return { resolved: candidate, local: true };
      }
    }
  }
  return { resolved: null, local: true };
}

function resolvePython(from: string, mod: string, files: Set<string>): Resolution {
  const dots = /^\.+/.exec(mod)?.[0].length ?? 0;
  const rest = mod.slice(dots).replace(/\./g, "/");
  if (dots > 0) {
    let dir = dirOf(from);
    for (let i = 1; i < dots; i++) dir = dirOf(dir);
    const base = normalizePath(`${dir}/${rest}`);
    for (const suffix of [".py", "/__init__.py"]) if (files.has(base + suffix)) return { resolved: base + suffix, local: true };
    return { resolved: null, local: true };
  }
  for (const suffix of [".py", "/__init__.py"]) {
    if (files.has(rest + suffix)) return { resolved: rest + suffix, local: true };
    const matches = [...files].filter((f) => f.endsWith(`/${rest}${suffix}`));
    if (matches.length === 1) return { resolved: matches[0], local: true };
  }
  return { resolved: null, local: false };
}

export function resolveImport(from: string, spec: string, files: Set<string>, aliases: AliasMap): string | null {
  return /\.py$/.test(from) ? resolvePython(from, spec, files).resolved : resolveSpecifier(from, spec, files, aliases).resolved;
}

export interface ImportBinding {
  local: string;
  imported: string;
  specifier: string;
  resolved: string | null;
  isLocalSpecifier: boolean;
  typeOnly: boolean;
  offset: number;
  reexport: boolean;
  dynamic?: boolean;
}

function parseClause(clause: string, typeOnly: boolean): Array<{ local: string; imported: string; typeOnly: boolean }> {
  const out: Array<{ local: string; imported: string; typeOnly: boolean }> = [];
  const c = clause.trim();
  const ns = /\*\s+as\s+([\w$]+)/.exec(c);
  if (ns) out.push({ local: ns[1], imported: "*", typeOnly });
  const braces = /\{([^}]*)\}/.exec(c);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const p = part.trim();
      const m = /^(type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(p);
      if (m) out.push({ local: m[3] ?? m[2], imported: m[2], typeOnly: typeOnly || Boolean(m[1]) });
    }
  }
  const def = /^([\w$]+)\s*(?:,|$)/.exec(c);
  if (def && def[1] !== "type") out.push({ local: def[1], imported: "default", typeOnly });
  return out;
}

const JS_IMPORT =
  /\bimport\s+(type\s+)?([\w$*{][^;]{0,400}?)\s+from\s+["']([^"'\n]+)["']|\bimport\s+["']([^"'\n]+)["']|\bexport\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+["']([^"'\n]+)["']|\b(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*["']([^"'\n]+)["']\s*\)|\b(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

export function importSpecifiers(content: string, filename: string): string[] {
  const lang = /\.py$/.test(filename) ? "py" : "js";
  const { text } = maskSource(content, lang, filename);
  const specs: string[] = [];
  if (lang === "py") {
    for (const m of text.matchAll(/^[ \t]*from\s+([\w.]+)\s+import\b|^[ \t]*import\s+([\w.]+)/gm)) specs.push(m[1] ?? m[2]);
    return specs;
  }
  for (const m of text.matchAll(JS_IMPORT)) {
    const spec = m[3] ?? m[4] ?? m[7] ?? m[9] ?? m[10];
    if (spec) specs.push(spec);
  }
  return specs;
}

function parseImports(ctx: FileCtx, files: Set<string>, aliases: AliasMap): ImportBinding[] {
  const out: ImportBinding[] = [];
  if (ctx.lang === "py") {
    for (const m of ctx.text.matchAll(/^[ \t]*from\s+([\w.]+)\s+import\s+\(?([^)\n]+)\)?/gm)) {
      const res = resolvePython(ctx.filename, m[1], files);
      for (const part of m[2].split(",")) {
        const p = /^\s*([\w*]+)(?:\s+as\s+(\w+))?/.exec(part);
        if (!p) continue;
        out.push({ local: p[2] ?? p[1], imported: p[1] === "*" ? "*" : p[1], specifier: m[1], resolved: res.resolved, isLocalSpecifier: res.local, typeOnly: false, offset: m.index, reexport: false });
      }
    }
    for (const m of ctx.text.matchAll(/^[ \t]*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)) {
      const res = resolvePython(ctx.filename, m[1], files);
      out.push({ local: m[2] ?? m[1].split(".")[0], imported: "*", specifier: m[1], resolved: res.resolved, isLocalSpecifier: res.local, typeOnly: false, offset: m.index, reexport: false });
    }
    return out;
  }
  if (ctx.lang !== "js") return out;
  for (const m of ctx.text.matchAll(JS_IMPORT)) {
    const spec = m[3] ?? m[4] ?? m[7] ?? m[9] ?? m[10];
    if (!spec || ctx.code[m.index] === " ") continue;
    const res = resolveSpecifier(ctx.filename, spec, files, aliases);
    const base = { specifier: spec, resolved: res.resolved, isLocalSpecifier: res.local, offset: m.index };
    if (m[3]) {
      for (const b of parseClause(m[2], Boolean(m[1]))) out.push({ ...b, ...base, reexport: false });
    } else if (m[4]) {
      out.push({ local: "", imported: "", typeOnly: false, reexport: false, ...base });
    } else if (m[7]) {
      const clause = m[6].trim();
      if (clause.startsWith("*")) {
        const as = /\*\s+as\s+([\w$]+)/.exec(clause);
        out.push({ local: as?.[1] ?? "", imported: "*", typeOnly: Boolean(m[5]), reexport: true, ...base });
      } else {
        for (const b of parseClause(clause, Boolean(m[5]))) out.push({ ...b, ...base, reexport: true });
      }
    } else if (m[9]) {
      const target = m[8].trim();
      if (target.startsWith("{")) {
        for (const part of target.slice(1, -1).split(",")) {
          const p = /^\s*([\w$]+)(?:\s*:\s*([\w$]+))?/.exec(part);
          if (p) out.push({ local: p[2] ?? p[1], imported: p[1], typeOnly: false, reexport: false, ...base });
        }
      } else {
        out.push({ local: target, imported: "*", typeOnly: false, reexport: false, ...base });
      }
    } else if (m[10]) {
      out.push({ local: "", imported: "*", typeOnly: true, reexport: false, dynamic: true, ...base });
    }
  }
  return out;
}

interface ExportTable {
  names: Map<string, string>;
  starFrom: string[];
  unresolvedStar: boolean;
  commonjs: boolean;
}

function parseExports(ctx: FileCtx, imports: ImportBinding[]): ExportTable {
  const names = new Map<string, string>();
  const code = ctx.code;
  for (const m of code.matchAll(/\bexport\s+(default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\s*\*?|class|const\s+enum|const|let|var|interface|type|enum|namespace|module)\s+([\w$]+)/g)) {
    names.set(m[1] ? "default" : m[2], m[2]);
  }
  const defaultIdent = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(code);
  if (defaultIdent && !/^(?:async|function|class|abstract|new)$/.test(defaultIdent[1])) names.set("default", defaultIdent[1]);
  for (const m of code.matchAll(/\bexport\s+(?:const|let|var)\s+\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const n = /([\w$]+)\s*$/.exec(part.replace(/=.*$/, "").trim());
      if (n) names.set(n[1], n[1]);
    }
  }
  if (/\bexport\s+default\b/.test(code)) names.set("default", names.get("default") ?? "default");
  for (const m of code.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of m[1].split(",")) {
      const p = /^\s*(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?/.exec(part);
      if (p) names.set(p[2] ?? p[1], p[1]);
    }
  }
  const starFrom: string[] = [];
  let unresolvedStar = false;
  for (const b of imports) {
    if (!b.reexport) continue;
    if (b.imported === "*" && !b.local) {
      if (b.resolved) starFrom.push(b.resolved);
      else unresolvedStar = true;
    } else {
      names.set(b.local, `reexport:${b.imported}`);
    }
  }
  const commonjs = /\bmodule\s*\.\s*exports\b|\bexports\s*\.\s*[\w$]+\s*=|\bexport\s*=/.test(code);
  return { names, starFrom, unresolvedStar, commonjs };
}

interface FnDef {
  name: string;
  params: string[][];
  offset: number;
  bodyStart: number;
  bodyEnd: number;
}

function paramNames(argCode: string, lang: FileCtx["lang"]): string[][] {
  return splitTopLevel(argCode).map((p) => {
    let t = p.text.trim().replace(/^\.\.\./, "").replace(/^\*{1,2}/, "");
    t = t.replace(/=[\s\S]*$/, "").trim();
    if (/^[{[]/.test(t)) {
      return [...t.matchAll(/([A-Za-z_$][\w$]*)\s*(?=[,}\]=]|$)/g)].map((m) => m[1]).filter((n) => n !== "type");
    }
    const n = /^([A-Za-z_$][\w$]*)/.exec(t)?.[1];
    if (!n || n === "this" || (lang === "py" && (n === "self" || n === "cls"))) return [];
    return [n];
  });
}

function functionDefs(ctx: FileCtx): FnDef[] {
  const code = ctx.code;
  const defs: FnDef[] = [];
  const seen = new Set<string>();
  const add = (d: FnDef) => {
    if (seen.has(d.name) || d.bodyEnd <= d.bodyStart) return;
    seen.add(d.name);
    defs.push(d);
  };
  if (ctx.lang === "py") {
    for (const m of code.matchAll(/^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(/gm)) {
      const call = callArgsAt(code, m.index + m[0].length - 1);
      if (!call) continue;
      const indent = m[1].length;
      const headerEnd = code.indexOf("\n", call.close);
      if (headerEnd < 0) continue;
      let end = code.length;
      const lineRe = /\n([ \t]*)(\S)/g;
      lineRe.lastIndex = headerEnd;
      for (let l = lineRe.exec(code); l; l = lineRe.exec(code)) {
        if (l[1].length <= indent) { end = l.index; break; }
      }
      add({ name: m[2], params: paramNames(code.slice(call.open + 1, call.close), "py"), offset: m.index + indent, bodyStart: headerEnd, bodyEnd: end });
    }
    return defs;
  }
  if (ctx.lang !== "js") return defs;
  for (const m of code.matchAll(/\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g)) {
    const paren = m.index + m[0].length - 1;
    const call = callArgsAt(code, paren);
    const body = functionBodyAfter(code, paren);
    if (!call || !body) continue;
    add({ name: m[1], params: paramNames(code.slice(call.open + 1, call.close), "js"), offset: m.index, bodyStart: body.start, bodyEnd: body.end });
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]{1,200})?=\s*(?:async\s*)?(?:function\s*\*?\s*[\w$]*\s*)?(?=\()/g)) {
    const paren = m.index + m[0].length;
    const call = callArgsAt(code, paren);
    if (!call) continue;
    const after = /^\s*(?::[^={;]{1,200}?)?\s*(=>)?\s*(\{)?/.exec(code.slice(call.close + 1, call.close + 260));
    if (!after || (!after[1] && !after[2])) continue;
    let bodyStart: number;
    let bodyEnd: number;
    if (after[2]) {
      bodyStart = call.close + after[0].length;
      bodyEnd = findClose(code, bodyStart);
    } else {
      bodyStart = call.close + after[0].length;
      bodyEnd = statementEnd(code, bodyStart);
    }
    if (bodyEnd < 0) continue;
    add({ name: m[1], params: paramNames(code.slice(call.open + 1, call.close), "js"), offset: m.index, bodyStart, bodyEnd });
  }
  return defs;
}

interface ParamFlow {
  sink: SinkRule;
  file: string;
  line: number;
  sinkName: string;
  chain: string[];
}

interface Summary {
  module: ModuleNode;
  def: FnDef;
  line: number;
  state: TaintState;
  flows: Map<number, ParamFlow>;
  authenticates: boolean;
  rateLimits: boolean;
  writesDb: string | null;
}

interface CallSite {
  callee: Summary;
  name: string;
  index: number;
  args: Array<{ code: string; text: string; start: number }>;
}

interface ModuleNode {
  file: string;
  ctx: FileCtx;
  imports: ImportBinding[];
  exports: ExportTable;
  functions: Map<string, Summary>;
  calls: CallSite[];
  useServer: boolean;
}

const DB_WRITE: Array<[RegExp, string]> = [
  [/\b(?:prisma|db|tx|knex|supabase)\s*\.\s*\w+\s*\.\s*(?:delete|deleteMany)\s*\(|\.\s*(?:deleteOne|deleteMany|destroy)\s*\(|\bDELETE\s+FROM\b/i, "deletes database records"],
  [/\b(?:prisma|db|tx|knex|supabase)\s*\.\s*\w+\s*\.\s*(?:create|createMany|update|updateMany|upsert)\s*\(|\.\s*(?:insertOne|insertMany|updateOne|updateMany|save)\s*\(|\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET)\b/i, "writes to the database"],
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function argList(ctx: FileCtx, parenIndex: number): CallSite["args"] | null {
  const call = callArgsAt(ctx.code, parenIndex);
  if (!call) return null;
  return call.args.map((a) => ({ code: a.text, text: ctx.text.slice(a.start, a.start + a.text.length), start: a.start }));
}

function shortPath(file: string): string {
  return file.split("/").slice(-2).join("/");
}

export interface GraphInsights {
  modules: number;
  edges: number;
  hubs: Array<{ file: string; fanIn: number; tested: boolean }>;
  godModules: Array<{ file: string; fanOut: number }>;
  cycles: string[][];
  crossFileFlows: number;
  unresolvedImports: number;
  testReach: {
    testFiles: number;
    sourceModules: number;
    reachable: number;
    direct: number;
    untestedCritical: Array<{ file: string; reason: string }>;
  };
  complexity: ComplexityHotspot[];
  duplicates: { blocks: number; lines: number; top: DuplicateBlock[] };
}

export interface GraphResult {
  findings: EngineFinding[];
  authenticatedFiles: Set<string>;
  rateLimitedFiles: Set<string>;
  privilegedCalls: Map<string, string>;
  insights: GraphInsights;
}

export interface GraphInput {
  contexts: FileCtx[];
  fileSet: Set<string>;
  targets?: Set<string>;
  tsconfig?: string;
  completeTree?: boolean;
  fullCoverage?: boolean;
  truncated?: Set<string>;
}

const ENTRY_FILE =
  /(?:^|\/)(?:app|pages)\/.*(?:page|layout|route|loading|error|not-found|template|default|global-error|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[jt]sx?$|(?:^|\/)pages\/|(?:^|\/)(?:middleware|proxy|instrumentation(?:-client)?)\.[jt]s$|\.config\.[cm]?[jt]s$|(?:^|\/)(?:index|main|server|cli)\.[cm]?[jt]sx?$|(?:^|\/)(?:scripts?|bin|tools|e2e|tests?|__tests__|spec|prisma)\/|\.d\.ts$|\.(?:test|spec|stories)\.[jt]sx?$|(?:^|\/)setup\.[jt]s$/;
const FRAMEWORK_EXPORTS = /^(?:default|GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|metadata|generateMetadata|generateStaticParams|generateViewport|viewport|config|dynamic|dynamicParams|revalidate|runtime|preferredRegion|maxDuration|fetchCache|middleware|proxy|register|onRequestError)$/;

const SERVER_ONLY: Array<{ re: RegExp; reason: string; severity: Severity; category: "security" | "quality"; impact: string }> = [
  { re: /new\s+PrismaClient\s*\(|from\s+["']@prisma\/client["']|\bprisma\s*\.\s*\w+\s*\.\s*(?:find\w*|create\w*|update\w*|delete\w*|upsert|count|aggregate|groupBy)\s*\(/, reason: "the Prisma database client", severity: "high", category: "security", impact: "database access code is bundled for the browser — it either breaks the build or ships server logic and connection handling to every visitor" },
  { re: /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV\b)[A-Z][A-Z0-9_]{2,}/, reason: "server-only environment variables", severity: "medium", category: "security", impact: "the values are undefined in the browser, and the server logic around them ships to every visitor (one NEXT_PUBLIC_ rename away from leaking the secret)" },
  { re: /from\s+["'](?:node:)?(?:fs|fs\/promises|child_process|net|tls|dgram|worker_threads|cluster)["']|require\s*\(\s*["'](?:node:)?(?:fs|child_process)["']\s*\)/, reason: "Node.js built-ins (fs / child_process)", severity: "medium", category: "quality", impact: "the client build fails or the code crashes in the browser" },
  { re: /from\s+["']next\/headers["']/, reason: "next/headers", severity: "medium", category: "quality", impact: "next/headers only works on the server, so the client build fails" },
  { re: /from\s+["']server-only["']|import\s+["']server-only["']/, reason: "a module guarded with `server-only`", severity: "medium", category: "quality", impact: "the build fails with a server-only import error" },
];

function layerOf(file: string): { name: string; rank: number } | null {
  if (/(?:^|\/)app\/api\/|(?:^|\/)pages\/api\//.test(file)) return { name: "API route", rank: 5 };
  if (/(?:^|\/)(?:app|pages)\//.test(file)) return { name: "page/route", rank: 4 };
  if (/(?:^|\/)features?\//.test(file)) return { name: "feature", rank: 3 };
  if (/(?:^|\/)components?\//.test(file)) return { name: "component", rank: 2 };
  if (/(?:^|\/)(?:lib|utils?|helpers?|hooks?|services?|server|store|types?|config)\//.test(file)) return { name: "lib", rank: 1 };
  return null;
}

export function analyzeProjectGraph(input: GraphInput): GraphResult {
  const aliases = readAliases(input.tsconfig);
  const fileSet = input.fileSet;
  const targets = input.targets;
  const truncated = input.truncated ?? new Set<string>();
  const modules = new Map<string, ModuleNode>();
  const findings: EngineFinding[] = [];

  for (const ctx of input.contexts) {
    if (ctx.lineMap || ctx.role === "generated" || (ctx.lang !== "js" && ctx.lang !== "py")) continue;
    const imports = parseImports(ctx, fileSet, aliases);
    modules.set(ctx.filename, {
      file: ctx.filename,
      ctx,
      imports,
      exports: parseExports(ctx, imports),
      functions: new Map(),
      calls: [],
      useServer: /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/.test(ctx.raw),
    });
  }

  const reportCtx = (ctx: FileCtx, offset: number, f: Omit<EngineFinding, "file" | "line" | "snippet" | "occurrences">): void => {
    if (targets && !targets.has(ctx.filename)) return;
    const aline = ctx.lines.lineOf(offset);
    const line = reportableLine(ctx, aline, aline);
    if (line === null || isSuppressed(ctx.suppress, line, f.ruleId, f.category)) return;
    const raw = ctx.lines.lineText(aline).trim();
    findings.push({
      ...f,
      description: redactSecrets(f.description),
      file: ctx.filename,
      line,
      snippet: redactSecrets(raw.length > 160 ? `${raw.slice(0, 157)}…` : raw),
      occurrences: 1,
    });
  };
  const report = (m: ModuleNode, offset: number, f: Omit<EngineFinding, "file" | "line" | "snippet" | "occurrences">): void =>
    reportCtx(m.ctx, offset, f);

  for (const m of modules.values()) {
    if (m.ctx.role !== "source" && m.ctx.role !== "fixture") continue;
    const assignments = getAssignments(m.ctx);
    const sites = sinkSites(m.ctx, TAINT_SINKS);
    for (const def of functionDefs(m.ctx)) {
      const region: [number, number] = [def.bodyStart, def.bodyEnd];
      const line = m.ctx.lines.lineOf(def.offset);
      const seeds: TaintedVar[] = [];
      def.params.forEach((names, i) => {
        for (const name of names) seeds.push({ name, line, region: 0, via: `param:${i}`, prefix: true });
      });
      const state = computeTaint(m.ctx.code, m.ctx.text, m.ctx.lang, m.file, m.ctx.lines, {
        seeds,
        useSources: false,
        range: region,
        regions: [region],
        assignments,
      });
      const summary: Summary = {
        module: m,
        def,
        line,
        state,
        flows: new Map(),
        authenticates: false,
        rateLimits: false,
        writesDb: null,
      };
      if (seeds.length > 0) {
        for (const site of sites) {
          if (site.index < def.bodyStart || site.index > def.bodyEnd) continue;
          const flow = evaluateSite(site, m.ctx, state);
          const idx = flow ? /^param:(\d+)$/.exec(flow.hit.via) : null;
          if (!flow || !idx) continue;
          const i = Number(idx[1]);
          const prev = summary.flows.get(i);
          if (!prev || severityRank(site.sink.severity) > severityRank(prev.sink.severity)) {
            summary.flows.set(i, { sink: site.sink, file: m.file, line: flow.aline, sinkName: site.sinkName, chain: [] });
          }
        }
      }
      const bodyText = m.ctx.text.slice(def.bodyStart, def.bodyEnd);
      summary.authenticates = AUTH_INDICATOR.test(bodyText);
      summary.rateLimits = RATE_LIMIT_INDICATOR.test(bodyText);
      summary.writesDb = DB_WRITE.find(([re]) => re.test(bodyText))?.[1] ?? null;
      m.functions.set(def.name, summary);
    }
  }

  const resolveCallable = (m: ModuleNode, name: string): Summary | null => {
    const local = m.functions.get(name);
    if (local) return local;
    const binding = m.imports.find((b) => b.local === name && !b.typeOnly && b.imported !== "*");
    if (!binding?.resolved) return null;
    return exportedFunction(binding.resolved, binding.imported, 0);
  };

  const exportedFunction = (file: string, name: string, depth: number): Summary | null => {
    const target = modules.get(file);
    if (!target || depth > 3) return null;
    const localName = target.exports.names.get(name) ?? (target.ctx.lang === "py" ? name : undefined);
    if (localName?.startsWith("reexport:")) {
      const via = target.imports.find((b) => b.reexport && b.local === name);
      return via?.resolved ? exportedFunction(via.resolved, localName.slice(9), depth + 1) : null;
    }
    if (localName) {
      const fn = target.functions.get(localName);
      if (fn) return fn;
      const imported = target.imports.find((b) => b.local === localName && b.resolved);
      if (imported?.resolved) return exportedFunction(imported.resolved, imported.imported, depth + 1);
    }
    for (const star of target.exports.starFrom) {
      const fn = exportedFunction(star, name, depth + 1);
      if (fn) return fn;
    }
    return null;
  };

  for (const m of modules.values()) {
    const names = new Set<string>([...m.functions.keys(), ...m.imports.filter((b) => !b.typeOnly && b.local && b.imported !== "*").map((b) => b.local)]);
    if (names.size > 0) {
      const re = new RegExp(`(?<![.\\w$])(${[...names].map(escapeRe).join("|")})\\s*\\(`, "g");
      for (const c of m.ctx.code.matchAll(re)) {
        if (/(?:function\s*\*?|def)\s+$/.test(m.ctx.code.slice(Math.max(0, c.index - 12), c.index))) continue;
        const callee = resolveCallable(m, c[1]);
        const args = callee ? argList(m.ctx, c.index + c[0].length - 1) : null;
        if (callee && args) m.calls.push({ callee, name: c[1], index: c.index, args });
      }
    }
    for (const ns of m.imports.filter((b) => b.imported === "*" && b.local && b.resolved && !b.typeOnly)) {
      const re = new RegExp(`(?<![.\\w$])${escapeRe(ns.local)}\\s*\\.\\s*([\\w$]+)\\s*\\(`, "g");
      for (const c of m.ctx.code.matchAll(re)) {
        const callee = exportedFunction(ns.resolved!, c[1], 0);
        const args = callee ? argList(m.ctx, c.index + c[0].length - 1) : null;
        if (callee && args) m.calls.push({ callee, name: `${ns.local}.${c[1]}`, index: c.index, args });
      }
    }
  }

  const argHit = (arg: CallSite["args"][number], flow: ParamFlow, state: TaintState): TaintHit | null => {
    if (flow.sink.prefixOnly) {
      const lead = leadingOperand(arg.code, arg.text);
      return lead ? prefixTaint(lead, state, arg.start) : null;
    }
    return exprTaint(arg.code, state, arg.start);
  };

  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const m of modules.values()) {
      for (const call of m.calls) {
        const caller = [...m.functions.values()].find((s) => call.index > s.def.bodyStart && call.index < s.def.bodyEnd);
        if (!caller || caller === call.callee) continue;
        if (call.callee.authenticates && !caller.authenticates) { caller.authenticates = true; changed = true; }
        if (call.callee.rateLimits && !caller.rateLimits) { caller.rateLimits = true; changed = true; }
        if (call.callee.writesDb && !caller.writesDb) {
          caller.writesDb = `${call.callee.writesDb} via \`${call.callee.def.name}()\``;
          changed = true;
        }
        for (const [k, flow] of call.callee.flows) {
          const arg = call.args[k];
          if (!arg || flow.chain.length >= 4) continue;
          const hit = argHit(arg, flow, caller.state);
          const idx = hit ? /^param:(\d+)$/.exec(hit.via) : null;
          if (!idx) continue;
          const j = Number(idx[1]);
          const prev = caller.flows.get(j);
          if (prev && severityRank(prev.sink.severity) >= severityRank(flow.sink.severity)) continue;
          caller.flows.set(j, { ...flow, chain: [`${call.callee.def.name}()`, ...flow.chain] });
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const authenticatedFiles = new Set<string>();
  const rateLimitedFiles = new Set<string>();
  const privilegedCalls = new Map<string, string>();
  let crossFileFlows = 0;

  for (const m of modules.values()) {
    for (const call of m.calls) {
      if (call.callee.module === m) continue;
      if (call.callee.authenticates) authenticatedFiles.add(m.file);
      if (call.callee.rateLimits) rateLimitedFiles.add(m.file);
      if (call.callee.writesDb && !privilegedCalls.has(m.file)) {
        privilegedCalls.set(m.file, `\`${call.name}()\` (${shortPath(call.callee.module.file)}) ${call.callee.writesDb}`);
      }
    }

    if (m.ctx.role !== "source" || !hasTaintSources(m.ctx.lang)) continue;
    const state = getTaint(m.ctx);
    const reported = new Set<string>();
    for (const call of m.calls) {
      for (const [k, flow] of call.callee.flows) {
        const arg = call.args[k];
        if (!arg) continue;
        const hit = argHit(arg, flow, state);
        if (!hit || hit.via.startsWith("param:")) continue;
        const aline = m.ctx.lines.lineOf(call.index);
        if (isGuarded(m.ctx.code, m.ctx.lines, hit, aline, flow.sink.guard === "strong")) continue;
        const key = `${flow.sink.cls}:${call.index}`;
        if (reported.has(key)) continue;
        reported.add(key);
        const crossFile = call.callee.module !== m || flow.file !== m.file;
        if (crossFile) crossFileFlows++;
        const via = hit.name ? `\`${hit.via}\` (via \`${hit.name}\`)` : `\`${hit.via}\``;
        const calleeLoc = `${shortPath(call.callee.module.file)}:${call.callee.line}`;
        const chain = flow.chain.length > 0 ? `, then through ${flow.chain.map((c) => `\`${c}\``).join(" → ")},` : "";
        report(m, call.index, {
          ruleId: `${crossFile ? "xfile" : "interproc"}-${flow.sink.id.replace(/^taint-/, "")}`,
          cls: flow.sink.cls,
          category: "security",
          severity: flow.sink.severity,
          confidence: Math.max(0.6, flow.sink.confidence - 0.05 * flow.chain.length),
          description: `${flow.sink.title}${crossFile ? " across files" : ""}: user input from ${via} in ${m.ctx.short} is passed to \`${call.name}()\` (${calleeLoc})${chain} which uses it in \`${flow.sinkName}\` at ${shortPath(flow.file)}:${flow.line}. ${flow.sink.impact}`,
          suggestion: `${flow.sink.suggestion} Fix it at the boundary where the request is read, or inside \`${call.callee.def.name}()\` so every caller is protected.`,
          fix: flow.sink.fix,
        });
      }
    }
  }

  const edges = new Map<string, Array<{ to: string; offset: number }>>();
  const fanIn = new Map<string, Set<string>>();
  let unresolvedImports = 0;
  for (const m of modules.values()) {
    const out: Array<{ to: string; offset: number }> = [];
    for (const b of m.imports) {
      if (!b.resolved) {
        if (b.isLocalSpecifier) unresolvedImports++;
        continue;
      }
      if (b.resolved === m.file) continue;
      if (!fanIn.has(b.resolved)) fanIn.set(b.resolved, new Set());
      fanIn.get(b.resolved)!.add(m.file);
      if (!b.typeOnly && modules.has(b.resolved) && !out.some((e) => e.to === b.resolved)) out.push({ to: b.resolved, offset: b.offset });
    }
    edges.set(m.file, out);
  }

  for (const m of modules.values()) {
    if (!m.ctx.isClient) continue;
    const queue: Array<{ file: string; path: string[]; firstOffset: number }> = (edges.get(m.file) ?? []).map((e) => ({ file: e.to, path: [e.to], firstOffset: e.offset }));
    const seen = new Set<string>([m.file]);
    let hitFound = false;
    while (queue.length > 0 && !hitFound) {
      const cur = queue.shift()!;
      if (seen.has(cur.file) || cur.path.length > 5) continue;
      seen.add(cur.file);
      const node = modules.get(cur.file);
      if (!node || node.useServer || node.ctx.isClient) continue;
      const so = SERVER_ONLY.find((s) => s.re.test(node.ctx.text));
      if (so) {
        hitFound = true;
        const chain = cur.path.map((p) => `\`${shortPath(p)}\``).join(" → ");
        report(m, cur.firstOffset, {
          ruleId: "client-imports-server-code",
          category: so.category,
          severity: so.severity,
          confidence: 0.8,
          description: `Client component ${m.ctx.short} imports server-only code: ${chain} uses ${so.reason}. Everything a "use client" module imports is bundled for the browser, so ${so.impact}.`,
          suggestion: "Keep the client component free of server imports: move the server logic behind a route handler or server action (\"use server\"), pass data down as props from a server component, and add `import \"server-only\"` to server modules so this fails loudly at build time.",
        });
        continue;
      }
      for (const e of edges.get(cur.file) ?? []) queue.push({ file: e.to, path: [...cur.path, e.to], firstOffset: cur.firstOffset });
    }
  }

  const cycles = findCycles(edges);
  for (const cycle of cycles.slice(0, 5)) {
    const first = modules.get(cycle[0]);
    const edge = (edges.get(cycle[0]) ?? []).find((e) => e.to === cycle[1]);
    if (!first || !edge) continue;
    report(first, edge.offset, {
      ruleId: "circular-import",
      category: "quality",
      severity: "medium",
      confidence: 0.75,
      description: `Circular import: ${[...cycle, cycle[0]].map((f) => `\`${shortPath(f)}\``).join(" → ")}. Modules in a cycle can observe each other half-initialized (undefined imports at load time), and the cycle defeats tree-shaking and code-splitting.`,
      suggestion: "Break the cycle: move the shared pieces into a lower-level module both sides import, or invert the dependency by passing the value in instead of importing it.",
    });
  }

  if (input.completeTree) {
    for (const m of modules.values()) {
      const seenSpecs = new Set<string>();
      for (const b of m.imports) {
        if (b.resolved || !b.isLocalSpecifier || seenSpecs.has(b.specifier)) continue;
        if (/generated|\.contentlayer|\.velite|\.source|__generated__|\.next\//.test(b.specifier)) continue;
        seenSpecs.add(b.specifier);
        report(m, b.offset, {
          ruleId: "unresolved-import",
          category: "quality",
          severity: "high",
          confidence: 0.8,
          description: `Import of \`${b.specifier}\` in ${m.ctx.short} doesn't resolve to any file in the repository — the build fails (renamed or deleted module, or a typo in the path).`,
          suggestion: "Point the import at the module's current path, or restore the deleted module.",
        });
      }
    }
  }

  const exportNames = (file: string, depth: number, visiting: Set<string>): Set<string> | null => {
    const target = modules.get(file);
    if (!target || truncated.has(file) || target.exports.commonjs || target.exports.unresolvedStar || depth > 3 || visiting.has(file)) return null;
    visiting.add(file);
    const names = new Set(target.exports.names.keys());
    for (const star of target.exports.starFrom) {
      const nested = exportNames(star, depth + 1, visiting);
      if (!nested) return null;
      for (const n of nested) if (n !== "default") names.add(n);
    }
    return names;
  };

  for (const m of modules.values()) {
    if (m.ctx.lang !== "js") continue;
    for (const b of m.imports) {
      if (!b.resolved || !b.imported || b.imported === "*" || !/\.[cm]?[jt]sx?$/.test(b.resolved) || /\.d\.ts$/.test(b.resolved)) continue;
      const names = exportNames(b.resolved, 0, new Set());
      if (!names || names.has(b.imported)) continue;
      report(m, b.offset, {
        ruleId: "missing-export",
        category: "quality",
        severity: "high",
        confidence: 0.75,
        description: `${m.ctx.short} imports \`${b.imported === "default" ? "the default export" : b.imported}\` from ${shortPath(b.resolved)}, but that module doesn't export it — this fails at build time (or is undefined at runtime in plain JS).`,
        suggestion: `Export \`${b.imported}\` from ${shortPath(b.resolved)}, or fix the import to use the name the module actually exports.`,
      });
    }
  }

  for (const m of modules.values()) {
    const from = layerOf(m.file);
    if (!from) continue;
    for (const b of m.imports) {
      if (!b.resolved || b.typeOnly) continue;
      const to = layerOf(b.resolved);
      if (!to || to.rank <= from.rank) continue;
      if (!(to.rank >= 4 || from.rank === 1)) continue;
      report(m, b.offset, {
        ruleId: "layer-violation",
        category: "quality",
        severity: "medium",
        confidence: 0.6,
        description: `${from.name} module ${m.ctx.short} imports from the ${to.name} module ${shortPath(b.resolved)}. Dependencies should point downward (pages → features → components → lib); upward imports create hidden coupling and${to.rank === 5 ? " pull route-handler (server) code into whatever imports this module" : " make the lower layer impossible to reuse or test in isolation"}.`,
        suggestion: "Move the shared code down into lib/ (or the component layer) and import it from both places.",
      });
      break;
    }
  }

  for (const m of modules.values()) {
    const importers = [...modules.values()].filter((o) => o !== m && o.imports.some((b) => b.resolved === m.file)).map((o) => o.file);
    if (importers.length === 0) continue;
    const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.exec(m.ctx.raw);
    if (emptyCatch && m.ctx.lang === "js") {
      report(m, emptyCatch.index, {
        ruleId: "silent-failure-propagation",
        category: "quality",
        severity: "medium",
        confidence: 0.7,
        description: `${m.ctx.short} swallows errors in an empty catch block, and ${importers.length} module${importers.length > 1 ? "s" : ""} depend on it (${importers.slice(0, 3).map((f) => `\`${shortPath(f)}\``).join(", ")}${importers.length > 3 ? ", …" : ""}). Failures surface far away as undefined values instead of errors.`,
        suggestion: "Log and rethrow, or return an explicit result type ({ ok: false, error }) so callers can react.",
      });
    }
    const mutable = /^export\s+let\s+([\w$]+)/m.exec(m.ctx.code);
    if (mutable) {
      const mutators = importers.filter((f) => {
        const other = modules.get(f)!;
        return other.imports.some((b) => b.resolved === m.file && b.imported === mutable[1]) &&
          new RegExp(`\\b${escapeRe(mutable[1])}\\s*(?:\\.\\s*(?:push|pop|splice|set|delete|clear)\\s*\\(|\\[[^\\]]*\\]\\s*=(?!=))`).test(other.ctx.code);
      });
      if (mutators.length >= 1) {
        report(m, mutable.index, {
          ruleId: "shared-mutable-state",
          category: "quality",
          severity: "medium",
          confidence: 0.65,
          description: `\`${mutable[1]}\` is exported as mutable module state from ${m.ctx.short} and mutated by ${mutators.map((f) => `\`${shortPath(f)}\``).join(", ")}. Module state is shared across all requests on a server instance — one user's data can leak into another's, and behaviour diverges between instances.`,
          suggestion: "Make the state request-scoped (pass it explicitly) or move it to a real store (Redis/DB) with explicit keys.",
        });
      }
    }
  }

  if (input.fullCoverage) {
    const usedNames = new Map<string, Set<string>>();
    const wholeModuleUsed = new Set<string>();
    for (const m of modules.values()) {
      for (const b of m.imports) {
        if (!b.resolved) continue;
        if (b.imported === "*" || !b.imported) wholeModuleUsed.add(b.resolved);
        else {
          if (!usedNames.has(b.resolved)) usedNames.set(b.resolved, new Set());
          usedNames.get(b.resolved)!.add(b.imported);
        }
      }
    }
    for (const m of modules.values()) {
      if (m.ctx.lang !== "js" || ENTRY_FILE.test(m.file) || wholeModuleUsed.has(m.file) || m.ctx.role !== "source") continue;
      const exported = [...m.exports.names.keys()].filter((n) => !FRAMEWORK_EXPORTS.test(n));
      if (exported.length === 0) continue;
      const used = usedNames.get(m.file);
      if (!used && !(fanIn.get(m.file)?.size)) {
        report(m, 0, {
          ruleId: "orphan-module",
          category: "quality",
          severity: "low",
          confidence: 0.55,
          description: `${m.ctx.short} is never imported by any other module in the repository — it looks like dead code.`,
          suggestion: "Delete the module if it is truly unused (git keeps the history), or wire it up where it was meant to be used.",
        });
        continue;
      }
      const unused = exported.filter((n) => !used?.has(n));
      if (unused.length === 0 || unused.length === exported.length) continue;
      const firstDecl = new RegExp(`\\bexport\\s+[^\\n]*\\b${escapeRe(unused[0])}\\b`).exec(m.ctx.code);
      report(m, firstDecl?.index ?? 0, {
        ruleId: "unused-export",
        category: "quality",
        severity: "low",
        confidence: 0.55,
        description: `${unused.length} export${unused.length > 1 ? "s" : ""} of ${m.ctx.short} ${unused.length > 1 ? "are" : "is"} never imported anywhere in the repository: ${unused.slice(0, 5).map((n) => `\`${n}\``).join(", ")}${unused.length > 5 ? ", …" : ""}.`,
        suggestion: "Remove dead exports (or drop the `export` keyword if they are only used locally) to shrink the API surface and bundle.",
      });
    }
  }

  const runtimeEdges = new Map<string, string[]>();
  for (const m of modules.values()) {
    runtimeEdges.set(m.file, [...new Set(
      m.imports
        .filter((b) => b.resolved && b.resolved !== m.file && modules.has(b.resolved) && (!b.typeOnly || b.dynamic))
        .map((b) => b.resolved as string),
    )]);
  }
  const testModules = [...modules.values()].filter((m) => m.ctx.role === "test").map((m) => m.file);
  const directlyTested = new Set<string>();
  const reachable = new Set<string>();
  const reachQueue: string[] = [];
  for (const t of testModules) {
    for (const to of runtimeEdges.get(t) ?? []) {
      directlyTested.add(to);
      if (!reachable.has(to)) { reachable.add(to); reachQueue.push(to); }
    }
  }
  while (reachQueue.length > 0) {
    const cur = reachQueue.pop()!;
    for (const to of runtimeEdges.get(cur) ?? []) {
      if (!reachable.has(to)) { reachable.add(to); reachQueue.push(to); }
    }
  }
  const testStems = new Set<string>();
  for (const f of fileSet) {
    const m = /(?:^|\/)([^/]+?)\.(?:test|spec)\.[cm]?[jt]sx?$/.exec(f) ?? /(?:^|\/)test_([^/]+)\.py$/.exec(f);
    if (m) testStems.add(m[1]);
  }
  const tested = (file: string) =>
    directlyTested.has(file) || testStems.has((file.split("/").pop() ?? file).replace(/\.[^.]+$/, ""));
  const countable = [...modules.values()].filter((m) =>
    m.ctx.role === "source" && !/\.d\.ts$|(?:^|\/)types?\/|\.config\.[cm]?[jt]s$|(?:^|\/)(?:layout|loading|error|not-found|template|page)\.[jt]sx?$/.test(m.file));
  const SENSITIVE_PATH = /(?:^|\/|-|_)(?:auth|session|payment|billing|stripe|checkout|webhooks?|security|crypto|permissions?|rbac|acl|password|tokens?|byok|encrypt\w*)(?:\/|\.|-|_)/i;
  const untestedCritical = countable
    .filter((m) => !tested(m.file) && ((fanIn.get(m.file)?.size ?? 0) >= 8 || SENSITIVE_PATH.test(m.file)))
    .map((m) => ({ file: m.file, fanIn: fanIn.get(m.file)?.size ?? 0 }))
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 8)
    .map(({ file, fanIn: n }) => ({
      file,
      reason: n >= 8 ? `imported by ${n} modules` : "security-sensitive code path",
    }));
  const testReach = {
    testFiles: testModules.length,
    sourceModules: countable.length,
    reachable: countable.filter((m) => reachable.has(m.file)).length,
    direct: countable.filter((m) => tested(m.file)).length,
    untestedCritical,
  };

  const complexity: ComplexityHotspot[] = [];
  for (const m of modules.values()) {
    if (m.ctx.role !== "source") continue;
    const spots = functionDefs(m.ctx).map((d) => ({ def: d, spot: complexityOf(m.ctx, d) }))
      .filter((x) => x.spot.complexity >= 25 || (x.spot.lines >= 250 && x.spot.complexity >= 10))
      .sort((a, b) => b.spot.complexity - a.spot.complexity);
    const taken: Array<[number, number]> = [];
    for (const { def, spot } of spots) {
      if (taken.some(([s, e]) => def.offset >= s && def.offset < e)) continue;
      taken.push([def.offset, def.bodyEnd]);
      complexity.push(spot);
      if (taken.length > 1) continue;
      reportCtx(m.ctx, def.offset, {
        ruleId: "complex-function",
        category: "quality",
        severity: spot.complexity >= 60 || spot.lines >= 400 ? "medium" : "low",
        confidence: 0.6,
        cls: "complexity",
        description: `\`${spot.name}\` in ${m.ctx.short} has a cyclomatic complexity of ${spot.complexity} across ${spot.lines} lines (aim for under ~15). Functions this branchy are hard to review, hard to test exhaustively and attract regressions.`,
        suggestion: "Split it: extract each responsibility into a named helper, hook or sub-component, replace long if/else or switch chains with lookup tables or early returns, and put tests around the extracted pieces.",
      });
    }
  }
  complexity.sort((a, b) => b.complexity - a.complexity);

  const duplicateBlocks = findDuplicates(input.contexts);
  const byFile = new Map(input.contexts.map((c) => [c.filename, c]));
  for (const block of duplicateBlocks.slice(0, 12)) {
    const [here, there] = targets && !targets.has(block.b.file) && targets.has(block.a.file) ? [block.a, block.b] : [block.b, block.a];
    const ctx = byFile.get(here.file);
    if (!ctx) continue;
    const sameFile = here.file === there.file;
    reportCtx(ctx, ctx.lines.offsetOf(here.line), {
      ruleId: "duplicate-code",
      category: "quality",
      severity: block.lines >= 40 ? "medium" : "low",
      confidence: 0.65,
      cls: "duplicate",
      description: `Lines ${here.line}–${here.endLine} of ${ctx.short} duplicate ${sameFile ? "lines" : shortPath(there.file) + " lines"} ${there.line}–${there.endLine}${sameFile ? " of the same file" : ""} (${block.lines} identical statements). Copy-pasted logic drifts apart — a fix applied to one copy is easily missed in the other.`,
      suggestion: "Extract the shared logic into one function, hook or component and call it from both places.",
    });
  }
  const hubs = [...fanIn.entries()]
    .filter(([file]) => modules.has(file) && !/\.d\.ts$|(?:^|\/)types?\//.test(file))
    .map(([file, set]) => ({ file, fanIn: set.size, tested: tested(file) }))
    .filter((h) => h.fanIn >= 8)
    .sort((a, b) => b.fanIn - a.fanIn)
    .slice(0, 5);
  const godModules = [...edges.entries()]
    .map(([file, out]) => ({ file, fanOut: out.length }))
    .filter((g) => g.fanOut >= 25)
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 3);

  return {
    findings,
    authenticatedFiles,
    rateLimitedFiles,
    privilegedCalls,
    insights: {
      modules: modules.size,
      edges: [...edges.values()].reduce((n, e) => n + e.length, 0),
      hubs,
      godModules,
      cycles,
      crossFileFlows,
      unresolvedImports,
      testReach,
      complexity: complexity.slice(0, 10),
      duplicates: {
        blocks: duplicateBlocks.length,
        lines: duplicateBlocks.reduce((n, b) => n + b.lines, 0),
        top: duplicateBlocks.slice(0, 10),
      },
    },
  };
}

function severityRank(s: Severity): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}

function findCycles(edges: Map<string, Array<{ to: string }>>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongConnect = (v: string) => {
    const work: Array<{ v: string; i: number }> = [{ v, i: 0 }];
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const out = edges.get(frame.v) ?? [];
      if (frame.i < out.length) {
        const w = out[frame.i++].to;
        if (!edges.has(w)) continue;
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index);
          index++;
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v)!, idx.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.v)!));
      }
      if (low.get(frame.v) === idx.get(frame.v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== frame.v);
        if (scc.length > 1) sccs.push(scc);
      }
    }
  };

  for (const v of [...edges.keys()].sort()) if (!idx.has(v)) strongConnect(v);

  return sccs.map((scc) => {
    const members = new Set(scc);
    const start = [...scc].sort()[0];
    const prev = new Map<string, string>();
    const queue = [start];
    const seen = new Set([start]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const e of edges.get(cur) ?? []) {
        if (!members.has(e.to)) continue;
        if (e.to === start) {
          const path = [cur];
          let p = cur;
          while (prev.has(p)) { p = prev.get(p)!; path.unshift(p); }
          return path;
        }
        if (!seen.has(e.to)) { seen.add(e.to); prev.set(e.to, cur); queue.push(e.to); }
      }
    }
    return [start];
  }).filter((c) => c.length > 1);
}

const DECISION_JS = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?(?!=)|\?(?![.?:=])/g;
const DECISION_PY = /\b(?:if|elif|for|while|except|and|or|case)\b/g;

export interface ComplexityHotspot {
  file: string;
  name: string;
  line: number;
  complexity: number;
  lines: number;
}

function complexityOf(ctx: FileCtx, def: FnDef): ComplexityHotspot {
  const body = ctx.code.slice(def.bodyStart, def.bodyEnd);
  const decisions = body.match(ctx.lang === "py" ? DECISION_PY : DECISION_JS)?.length ?? 0;
  const line = ctx.lines.lineOf(def.offset);
  return { file: ctx.filename, name: def.name, line, complexity: 1 + decisions, lines: ctx.lines.lineOf(def.bodyEnd) - line + 1 };
}

const DUP_WINDOW = 8;
const DUP_MIN_LINES = 10;
const DUP_LANGS = new Set<FileCtx["lang"]>(["js", "py", "go", "java", "cs", "rs", "rb", "php"]);
const DUP_SKIP_LINE = /^(?:import\b|from\s+\S+\s+import\b|export\s*\{|export\s+\*|package\s|using\s|require\s*\(|#include)/;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface SigFile {
  ctx: FileCtx;
  lines: number[];
  norm: string[];
  hashes: number[];
  chars: number[];
}

export interface DuplicateBlock {
  a: { file: string; line: number; endLine: number };
  b: { file: string; line: number; endLine: number };
  lines: number;
}

function significantLines(ctx: FileCtx): SigFile {
  const out: SigFile = { ctx, lines: [], norm: [], hashes: [], chars: [] };
  const raw = ctx.text.split("\n");
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i].trim().replace(/\s+/g, " ");
    if (t.length < 6 || DUP_SKIP_LINE.test(t)) continue;
    let word = 0;
    for (let k = 0; k < t.length && word < 3; k++) {
      const c = t.charCodeAt(k);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) word++;
    }
    if (word < 3) continue;
    out.lines.push(i + 1);
    out.norm.push(t);
    out.hashes.push(hashString(t));
    out.chars.push(t.length);
  }
  return out;
}

export function findDuplicates(contexts: FileCtx[], maxBlocks = 40): DuplicateBlock[] {
  const files = contexts
    .filter((c) => DUP_LANGS.has(c.lang) && c.role === "source" && !c.lineMap)
    .map(significantLines)
    .filter((f) => f.norm.length >= DUP_WINDOW);
  const index = new Map<number, Array<[number, number]>>();
  const found: Array<{ fa: number; ia: number; fb: number; ib: number; len: number }> = [];

  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    let skipUntil = -1;
    for (let i = 0; i + DUP_WINDOW <= f.norm.length; i++) {
      let h = 0;
      let chars = 0;
      for (let k = 0; k < DUP_WINDOW; k++) {
        h = (Math.imul(h, 31) + f.hashes[i + k]) >>> 0;
        chars += f.chars[i + k];
      }
      if (chars < 180) continue;
      const prior = index.get(h);
      if (prior && i > skipUntil) {
        for (const [fj, j] of prior) {
          const g = files[fj];
          if (fj === fi && i - j < DUP_WINDOW) continue;
          let same = true;
          for (let k = 0; k < DUP_WINDOW && same; k++) same = g.norm[j + k] === f.norm[i + k];
          if (!same) continue;
          let len = DUP_WINDOW;
          while (i + len < f.norm.length && j + len < g.norm.length && g.norm[j + len] === f.norm[i + len] && !(fj === fi && j + len >= i)) len++;
          if (len >= DUP_MIN_LINES) {
            found.push({ fa: fj, ia: j, fb: fi, ib: i, len });
            skipUntil = i + len - 1;
          }
          break;
        }
      }
      if (prior) prior.push([fi, i]);
      else index.set(h, [[fi, i]]);
    }
  }

  return found
    .sort((x, y) => y.len - x.len)
    .slice(0, maxBlocks)
    .map(({ fa, ia, fb, ib, len }) => {
      const a = files[fa];
      const b = files[fb];
      return {
        a: { file: a.ctx.filename, line: a.lines[ia], endLine: a.lines[ia + len - 1] },
        b: { file: b.ctx.filename, line: b.lines[ib], endLine: b.lines[ib + len - 1] },
        lines: len,
      };
    });
}
