export type Lang =
  | "js" | "py" | "go" | "java" | "rb" | "php" | "rs" | "cs"
  | "yaml" | "docker" | "shell" | "tf" | "json" | "sql" | "env" | "other";

export type FileRole = "source" | "test" | "fixture" | "generated";

const EXT_LANG: Record<string, Lang> = {
  ts: "js", tsx: "js", mts: "js", cts: "js", js: "js", jsx: "js", mjs: "js", cjs: "js",
  vue: "js", svelte: "js", astro: "js",
  py: "py", pyw: "py",
  go: "go",
  java: "java", kt: "java", kts: "java", scala: "java", groovy: "java",
  rb: "rb", rake: "rb",
  php: "php",
  rs: "rs",
  cs: "cs",
  yml: "yaml", yaml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell",
  tf: "tf", hcl: "tf",
  json: "json", jsonc: "json",
  sql: "sql",
};

export function detectLang(filename: string): Lang {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  if (/^(?:dockerfile|containerfile)(?:\..+)?$/.test(base) || base.endsWith(".dockerfile")) return "docker";
  if (base.startsWith(".env")) return "env";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return EXT_LANG[ext] ?? "other";
}

const GENERATED_FILE =
  /(?:^|\/)(?:node_modules|vendor|dist|build|out|\.next|coverage|third_party|bower_components)\/|\.min\.(?:js|css)$|\.bundle\.js$|\.generated\.|_pb2(?:_grpc)?\.py$|\.pb\.go$|\.d\.ts$|(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock|Gemfile\.lock)$/i;
const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|tests?|specs?|e2e|cypress|playwright)\/|\.(?:test|spec|e2e|cy)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go)$|(?:^|\/)conftest\.py$|Tests?\.(?:java|cs|kt)$|_spec\.rb$/i;
const FIXTURE_FILE =
  /(?:^|\/)(?:__fixtures__|fixtures?|testdata|examples?|samples?|demos?|docs?|mocks?|stories|storybook|benchmarks?)\/|\.stories\.[jt]sx?$|\.(?:example|sample|template)$/i;

export function fileRole(filename: string): FileRole {
  if (GENERATED_FILE.test(filename)) return "generated";
  if (TEST_FILE.test(filename)) return "test";
  if (FIXTURE_FILE.test(filename)) return "fixture";
  return "source";
}

export function isRuleDefinitionFile(filename: string, content: string): boolean {
  const base = filename.split("/").pop() ?? filename;
  if (/^(?:internal-ai|security-rules?|vuln[_-]patterns?|rule[_-]definitions?|static[_-]analysis)[\w.-]*\.(?:ts|js|py|ya?ml)$/i.test(base)) return true;
  const patternDefs = content.match(/\bpattern\s*[:=]\s*(?:\/[^/\s]|r?["'`]|re\.compile)/g);
  return (patternDefs?.length ?? 0) >= 8;
}

export interface MaskedSource {
  code: string;
  text: string;
}

interface Syntax {
  line: string[];
  block: boolean;
  hashNeedsSpace?: boolean;
  blankStrings: boolean;
  quotes: string;
  backtick?: "template" | "raw" | "interp";
  triple?: boolean;
  multilineStrings?: boolean;
  regex?: boolean;
  pyPrefixes?: boolean;
  dqInterp?: string;
}

const SYNTAX: Record<Lang, Syntax> = {
  js: { line: ["//"], block: true, blankStrings: true, quotes: "'\"", backtick: "template", regex: true },
  py: { line: ["#"], block: false, blankStrings: true, quotes: "'\"", triple: true, pyPrefixes: true },
  go: { line: ["//"], block: true, blankStrings: true, quotes: "\"'", backtick: "raw" },
  java: { line: ["//"], block: true, blankStrings: true, quotes: "\"'", triple: true },
  cs: { line: ["//"], block: true, blankStrings: true, quotes: "\"'" },
  rs: { line: ["//"], block: true, blankStrings: true, quotes: "\"", multilineStrings: true },
  rb: { line: ["#"], block: false, blankStrings: true, quotes: "'\"", backtick: "interp", multilineStrings: true, dqInterp: "#{" },
  php: { line: ["//", "#"], block: true, blankStrings: true, quotes: "'\"", multilineStrings: true },
  tf: { line: ["//", "#"], block: true, blankStrings: false, quotes: "\"" },
  sql: { line: ["--"], block: true, blankStrings: false, quotes: "'" },
  yaml: { line: ["#"], block: false, hashNeedsSpace: true, blankStrings: false, quotes: "'\"" },
  docker: { line: ["#"], block: false, hashNeedsSpace: true, blankStrings: false, quotes: "'\"" },
  shell: { line: ["#"], block: false, hashNeedsSpace: true, blankStrings: false, quotes: "'\"" },
  env: { line: ["#"], block: false, hashNeedsSpace: true, blankStrings: false, quotes: "'\"" },
  json: { line: ["//"], block: true, blankStrings: false, quotes: "\"" },
  other: { line: [], block: false, blankStrings: false, quotes: "" },
};

const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await",
]);

type StrFrame = {
  kind: "str";
  close: string;
  escapes: boolean;
  multiline: boolean;
  interp: string | null;
  contentStart: number;
};
type HoleFrame = { kind: "hole"; depth: number };

function regexAllowed(src: string, lastSig: number): boolean {
  if (lastSig < 0) return true;
  const p = src[lastSig];
  if (/[\w$]/.test(p)) {
    let s = lastSig;
    while (s > 0 && /[\w$]/.test(src[s - 1])) s--;
    return REGEX_PRECEDING_KEYWORDS.has(src.slice(s, lastSig + 1));
  }
  return !")]}<'\"`".includes(p);
}

function scanRegexLiteral(src: string, start: number): number {
  let j = start + 1;
  if (src[j] === "/" || src[j] === "*") return -1;
  let inClass = false;
  while (j < src.length) {
    const ch = src[j];
    if (ch === "\n") return -1;
    if (ch === "\\") { j += 2; continue; }
    if (inClass) {
      if (ch === "]") inClass = false;
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "/") {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

function applyBlanks(src: string, ranges: number[]): string {
  if (ranges.length === 0) return src;
  const out: string[] = [];
  let prev = 0;
  for (let k = 0; k < ranges.length; k += 2) {
    const s = Math.max(ranges[k], prev);
    const e = ranges[k + 1];
    if (e <= s) continue;
    out.push(src.slice(prev, s), src.slice(s, e).replace(/[^\n]/g, " "));
    prev = e;
  }
  out.push(src.slice(prev));
  return out.join("");
}

const JSX_TEXT = />([^<>{}\n]*[A-Za-z][^<>{}\n]*)<\//g;

function maskJsxText(s: string): string {
  return s.replace(JSX_TEXT, (m, inner: string) => ">" + " ".repeat(inner.length) + m.slice(1 + inner.length));
}

export function maskSource(src: string, lang: Lang, filename = ""): MaskedSource {
  const syn = SYNTAX[lang];
  const n = src.length;
  const codeBlank: number[] = [];
  const textBlank: number[] = [];
  const blankBoth = (s: number, e: number) => { codeBlank.push(s, e); textBlank.push(s, e); };
  const blankCode = (s: number, e: number) => { if (syn.blankStrings && e > s) codeBlank.push(s, e); };

  const stack: Array<StrFrame | HoleFrame> = [];
  let i = 0;
  let lastSig = -1;

  const openString = (quoteLen: number, frame: Omit<StrFrame, "kind" | "contentStart">) => {
    stack.push({ kind: "str", contentStart: i + quoteLen, ...frame });
    i += quoteLen;
  };

  while (i < n) {
    const top = stack[stack.length - 1];

    if (top?.kind === "str") {
      const c = src[i];
      if (top.escapes && c === "\\") { i += 2; continue; }
      if (src.startsWith(top.close, i)) {
        blankCode(top.contentStart, i);
        stack.pop();
        i += top.close.length;
        lastSig = i - 1;
        continue;
      }
      if (c === "\n" && !top.multiline) {
        blankCode(top.contentStart, i);
        stack.pop();
        continue;
      }
      if (top.interp && src.startsWith(top.interp, i)) {
        if (top.interp === "{" && src[i + 1] === "{") { i += 2; continue; }
        blankCode(top.contentStart, i);
        stack.push({ kind: "hole", depth: 0 });
        i += top.interp.length;
        lastSig = i - 1;
        continue;
      }
      i++;
      continue;
    }

    const c = src[i];

    if (top?.kind === "hole") {
      if (c === "{") {
        top.depth++;
      } else if (c === "}") {
        if (top.depth === 0) {
          stack.pop();
          const str = stack[stack.length - 1] as StrFrame;
          str.contentStart = i + 1;
          i++;
          continue;
        }
        top.depth--;
      }
    }

    if (syn.block && c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      blankBoth(i, stop);
      i = stop;
      continue;
    }

    let isLineComment = false;
    for (const lc of syn.line) {
      if (!src.startsWith(lc, i)) continue;
      if (lc === "#" && syn.hashNeedsSpace && i > 0 && !/\s/.test(src[i - 1])) continue;
      if (lc === "#" && lang === "php" && src[i + 1] === "[") continue;
      isLineComment = true;
      break;
    }
    if (isLineComment) {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      blankBoth(i, stop);
      i = stop;
      continue;
    }

    if (syn.triple && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      const interp = syn.pyPrefixes && /[fF]/.test(pyPrefix(src, i)) ? "{" : null;
      openString(3, { close: src.slice(i, i + 3), escapes: true, multiline: true, interp });
      continue;
    }

    if (syn.quotes.includes(c)) {
      let interp: string | null = null;
      if (syn.pyPrefixes && /[fF]/.test(pyPrefix(src, i))) interp = "{";
      if (syn.dqInterp && c === '"') interp = syn.dqInterp;
      const escapes = !(c === "'" && (lang === "yaml" || lang === "shell" || lang === "docker"));
      openString(1, { close: c, escapes, multiline: !!syn.multilineStrings, interp });
      continue;
    }

    if (c === "`" && syn.backtick) {
      if (syn.backtick === "template") openString(1, { close: "`", escapes: true, multiline: true, interp: "${" });
      else if (syn.backtick === "raw") openString(1, { close: "`", escapes: false, multiline: true, interp: null });
      else openString(1, { close: "`", escapes: true, multiline: true, interp: "#{" });
      continue;
    }

    if (syn.regex && c === "/" && regexAllowed(src, lastSig)) {
      const end = scanRegexLiteral(src, i);
      if (end > 0) {
        blankBoth(i, end);
        i = end;
        lastSig = end - 1;
        continue;
      }
    }

    if (!/\s/.test(c)) lastSig = i;
    i++;
  }

  const open = stack.find((f): f is StrFrame => f.kind === "str");
  if (open) blankCode(open.contentStart, n);

  let code = applyBlanks(src, codeBlank);
  let text = applyBlanks(src, textBlank);
  if (/\.[jt]sx$/.test(filename)) {
    code = maskJsxText(code);
    text = maskJsxText(text);
  }
  return { code, text };
}

function pyPrefix(src: string, quoteIdx: number): string {
  let s = quoteIdx;
  while (s > 0 && quoteIdx - s < 2 && /[rRbBuUfF]/.test(src[s - 1])) s--;
  if (s > 0 && /[\w]/.test(src[s - 1])) return "";
  return src.slice(s, quoteIdx);
}

export class LineIndex {
  readonly src: string;
  readonly starts: number[];

  constructor(src: string) {
    this.src = src;
    const starts = [0];
    for (let i = src.indexOf("\n"); i !== -1; i = src.indexOf("\n", i + 1)) starts.push(i + 1);
    this.starts = starts;
  }

  get count(): number {
    return this.starts.length;
  }

  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  lineText(line: number): string {
    const s = this.starts[line - 1];
    if (s === undefined) return "";
    const e = line < this.starts.length ? this.starts[line] - 1 : this.src.length;
    return this.src.slice(s, e).replace(/\r$/, "");
  }

  offsetOf(line: number): number {
    if (line > this.starts.length) return this.src.length;
    return this.starts[Math.max(0, line - 1)];
  }
}

export interface Suppressions {
  file: boolean;
  byLine: Map<number, Set<string> | "all">;
  nosec: Set<number>;
}

const SUPPRESS_RE = /gitscope-ignore(-next-line|-file)?(?::\s*([\w-]+(?:\s*,\s*[\w-]+)*))?/;
const NOSEC_RE = /(?:#|\/\/|\/\*)\s*(?:nosec|NOSONAR)\b/i;

export function parseSuppressions(src: string): Suppressions {
  const res: Suppressions = { file: false, byLine: new Map(), nosec: new Set() };
  if (!/gitscope-ignore|nosec|NOSONAR/i.test(src)) return res;
  src.split("\n").forEach((text, idx) => {
    const lineNo = idx + 1;
    const m = SUPPRESS_RE.exec(text);
    if (m) {
      if (m[1] === "-file") {
        res.file = true;
      } else {
        const target = m[1] === "-next-line" ? lineNo + 1 : lineNo;
        const ids = m[2] ? m[2].split(/\s*,\s*/) : null;
        const existing = res.byLine.get(target);
        if (!ids || existing === "all") res.byLine.set(target, "all");
        else res.byLine.set(target, new Set([...(existing ?? []), ...ids]));
      }
    }
    if (NOSEC_RE.test(text)) res.nosec.add(lineNo);
  });
  return res;
}

export function isSuppressed(s: Suppressions, line: number, ruleId: string, category: string): boolean {
  if (s.file) return true;
  const entry = s.byLine.get(line);
  if (entry === "all") return true;
  if (entry && [...entry].some((id) => id === ruleId || id === category || ruleId.startsWith(`${id}-`))) return true;
  return category === "security" && s.nosec.has(line);
}

export interface PatchView {
  hunks: Array<{ text: string; newLines: number[] }>;
  added: Set<number>;
}

export function parsePatch(patch: string): PatchView {
  const hunks: PatchView["hunks"] = [];
  const added = new Set<number>();
  const hasHeaders = /^@@ /m.test(patch);
  let cur = 1;
  let lines: string[] = [];
  let newLines: number[] = [];
  let inHunk = !hasHeaders;

  const flush = () => {
    if (lines.length) hunks.push({ text: lines.join("\n"), newLines });
    lines = [];
    newLines = [];
  };

  for (const raw of patch.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      flush();
      cur = Number(h[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || raw.startsWith("+++ ") || raw.startsWith("--- ")) continue;
    const tag = raw[0];
    if (tag === "+") {
      lines.push(raw.slice(1));
      newLines.push(cur);
      added.add(cur);
      cur++;
    } else if (tag === " ") {
      lines.push(raw.slice(1));
      newLines.push(cur);
      cur++;
    } else if (tag === "-" || tag === "\\") {
      continue;
    } else if (raw === "") {
      lines.push("");
      newLines.push(cur);
      cur++;
    }
  }
  flush();
  return { hunks, added };
}

const CLOSERS: Record<string, string> = { "(": ")", "{": "}", "[": "]" };

export function findClose(code: string, open: number, limit = 60_000): number {
  const o = code[open];
  const c = CLOSERS[o];
  if (!c) return -1;
  let depth = 0;
  const stop = Math.min(code.length, open + limit);
  for (let i = open; i < stop; i++) {
    const ch = code[i];
    if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return -1;
}

export interface Part {
  text: string;
  start: number;
}

export function splitTopLevel(s: string, sep = ","): Part[] {
  const parts: Part[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === sep && depth === 0) {
      parts.push({ text: s.slice(start, i), start });
      start = i + 1;
    }
  }
  parts.push({ text: s.slice(start), start });
  return parts.filter((p) => p.text.trim().length > 0);
}

export interface CallArgs {
  open: number;
  close: number;
  args: Part[];
}

export function callArgsAt(code: string, from: number): CallArgs | null {
  let open = from;
  while (open < code.length && open - from < 4 && code[open] !== "(") open++;
  if (code[open] !== "(") return null;
  const close = findClose(code, open);
  if (close < 0) return null;
  const inner = code.slice(open + 1, close);
  return {
    open,
    close,
    args: splitTopLevel(inner).map((p) => ({ text: p.text, start: open + 1 + p.start })),
  };
}

export function functionBodyAfter(code: string, from: number): { start: number; end: number } | null {
  const paren = code.indexOf("(", from);
  if (paren < 0 || paren - from > 240) return null;
  const pclose = findClose(code, paren);
  if (pclose < 0) return null;
  let angle = 0;
  const stop = Math.min(code.length, pclose + 800);
  for (let i = pclose + 1; i < stop; i++) {
    const ch = code[i];
    if (ch === "<") angle++;
    else if (ch === ">" && code[i - 1] !== "=") angle = Math.max(0, angle - 1);
    else if (ch === ";" && angle === 0) return null;
    else if (ch === "(" || ch === "[") {
      const c = findClose(code, i);
      if (c < 0) return null;
      i = c;
    } else if (ch === "{") {
      const close = findClose(code, i);
      if (close < 0) return null;
      const prev = /(\S)\s*$/.exec(code.slice(pclose + 1, i))?.[1] ?? ")";
      if (angle === 0 && !":<|&,".includes(prev)) return { start: i, end: close };
      i = close;
    }
  }
  return null;
}

export function statementEnd(code: string, from: number, limit = 4000): number {
  let depth = 0;
  const stop = Math.min(code.length, from + limit);
  for (let i = from; i < stop; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && ch === ";") return i;
    else if (depth === 0 && ch === "\n") {
      const next = /^\s*(\S)/.exec(code.slice(i + 1, i + 200));
      const prev = /(\S)\s*$/.exec(code.slice(Math.max(from, i - 200), i));
      const continues = (next && ".?:+-*|&,".includes(next[1])) || (prev && "=?:+-*|&,(<>!".includes(prev[1])) || !prev;
      if (!continues) return i;
    }
  }
  return stop;
}

export function scopeRegions(code: string, lang: Lang): Array<[number, number]> {
  if (lang === "py" || lang === "rb") {
    const starts: number[] = [];
    let prevWasDecorator = false;
    for (const m of code.matchAll(/^[^\s#]/gm)) {
      if (!prevWasDecorator) starts.push(m.index);
      prevWasDecorator = code[m.index] === "@";
    }
    return starts.map((s, k): [number, number] => [s, (starts[k + 1] ?? code.length + 1) - 1]);
  }
  const depthWanted = lang === "java" || lang === "cs" ? 1 : 0;
  const regions: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "{") {
      if (depth === depthWanted) start = i;
      depth++;
    } else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === depthWanted && start >= 0) {
        regions.push([start, i]);
        start = -1;
      }
    }
  }
  return regions;
}

export function regionAt(regions: Array<[number, number]>, offset: number): number {
  for (let k = 0; k < regions.length; k++) {
    if (offset >= regions[k][0] && offset <= regions[k][1]) return k;
  }
  return -1;
}

const SOURCES: Partial<Record<Lang, RegExp>> = {
  js: /\b(?:req|request|ctx\s*\.\s*request|context\s*\.\s*request)\s*\.\s*(?:body|query|params|headers|cookies|files?|url|nextUrl)\b|\b(?:req|request)\s*\.\s*(?:json|formData|text|arrayBuffer)\s*\(|\bsearchParams\b|\buseSearchParams\s*\(|\bformData\s*\.\s*get(?:All)?\s*\(|\bevent\s*\.\s*(?:body|queryStringParameters|pathParameters)\b|\b(?:window\s*\.\s*)?location\s*\.\s*(?:search|hash|href)\b|\bdocument\s*\.\s*(?:URL|documentURI|referrer|baseURI)\b|\b(?:e|ev|evt|event)\s*\.\s*target\s*\.\s*value\b|\brouter\s*\.\s*query\b|\bprocess\s*\.\s*argv\b/,
  py: /\brequest\s*\.\s*(?:args|form|values|json|data|files|cookies|headers|get_json|get_data|GET|POST|FILES|COOKIES|META|body|query_params|path_params)\b|(?<![.\w])input\s*\(|\bsys\s*\.\s*argv\b/,
  go: /\b(?:r|req|request)\s*\.\s*(?:URL\s*\.\s*(?:Query\s*\(\s*\)|Path|RawQuery)|FormValue\s*\(|PostFormValue\s*\(|Form\b|PostForm\b|Body\b|Header\s*\.\s*Get\s*\(|Cookie\s*\()|\bmux\s*\.\s*Vars\s*\(|\bchi\s*\.\s*URLParam\s*\(|\bc\s*\.\s*(?:Param|Query|PostForm|FormValue|DefaultQuery|DefaultPostForm|GetHeader|QueryParam|FormParams)\s*\(|\bos\s*\.\s*Args\b/,
  java: /\b(?:request|req|httpRequest|servletRequest)\s*\.\s*(?:getParameter|getParameterValues|getParameterMap|getHeader|getQueryString|getCookies|getInputStream|getReader|getRequestURI|getPathInfo)\s*\(/,
  cs: /\bRequest\s*\.\s*(?:Query|Form|Headers|Cookies|Body|QueryString|RouteValues)\b/,
  php: /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b|\$request\s*->\s*(?:input|get|query|post|all|cookie|header|route)\s*\(/,
  rb: /\bparams\b|\brequest\s*\.\s*(?:body|params|query_string|headers|cookies|env|raw_post_data)\b|\bcookies\s*\[/,
};

const JS_ROUTE_FILE = /(?:^|\/)(?:app|pages)\/.*\.(?:[jt]sx?)$|(?:^|\/)api\//;

const SANITIZER =
  /^\s*(?:await\s+)?(?:new\s+)?(?:Number|parseInt|parseFloat|BigInt|Boolean|Math\s*\.\s*\w+|encodeURIComponent|encodeURI|escape\w*|\w+\s*\.\s*escape\w*|sanitize\w*|\w+\s*\.\s*sanitize\w*|purify|DOMPurify\s*\.\s*sanitize|xss|validator\s*\.\s*\w+|path\s*\.\s*basename|basename|int|float|bool|len|uuid\s*\.\s*UUID|UUID|strconv\s*\.\s*\w+|html\s*\.\s*escape|shlex\s*\.\s*quote|secure_filename|escapeshellarg|escapeshellcmd|htmlspecialchars|htmlentities|intval|floatval|filepath\s*\.\s*Base|url\s*\.\s*QueryEscape|html\s*\.\s*EscapeString|Integer\s*\.\s*parseInt|Long\s*\.\s*parseLong|ObjectId|isValidObjectId|z\s*\.[\s\S]*\.parse\w*|\w+(?:Schema|Validator|schema|validator)\s*\.\s*(?:parse|safeParse|validate)\w*|\w+\s*\.\s*(?:parse|safeParse)(?:Async)?)\s*\(/;
const DERIVED_SAFE =
  /===|!==|(?<![=!<>])==(?!=)|!=(?!=)|\.\s*(?:length|size)\b|\.\s*(?:includes|test|startsWith|endsWith|has)\s*\(|\binstanceof\b|\btypeof\b|\bisNaN\s*\(|^\s*(?:await\s+)?(?:prisma|db|tx|knex|supabase|mongoose|redis|cache|kv|\w+Model|\w+Repository|\w+Service)\s*\.|^\s*(?:await\s+)?(?:fetch|axios|got|ky)\b/;

export interface TaintedVar {
  name: string;
  line: number;
  region: number;
  via: string;
  prefix: boolean;
}

export interface TaintState {
  lang: Lang;
  vars: Map<string, TaintedVar>;
  sourceRe: RegExp | null;
  regions: Array<[number, number]>;
  lines: LineIndex;
}

function identPattern(name: string): RegExp {
  const esc = name.replace(/[$]/g, "\\$");
  return new RegExp(`(?<![\\w$.])${esc}(?![\\w$])(?!\\s*:(?!:))`);
}

function destructuredNames(lhs: string): string[] {
  const inner = lhs.trim().replace(/^[{[]|[}\]]$/g, "");
  const names: string[] = [];
  for (const part of splitTopLevel(inner)) {
    let p = part.text.replace(/=[\s\S]*$/, "").replace(/^\s*\.\.\./, "").trim();
    if (/:(?!:)/.test(p)) p = p.slice(p.indexOf(":") + 1).trim();
    if (/^[{[]/.test(p)) names.push(...destructuredNames(p));
    else if (/^[A-Za-z_$][\w$]*$/.test(p)) names.push(p);
  }
  return names;
}

export interface Assignment {
  names: string[];
  offset: number;
  rhsStart: number;
  rhsEnd: number;
}

export function extractAssignments(code: string, lang: Lang): Assignment[] {
  const out: Assignment[] = [];
  const push = (names: string[], offset: number, rhsStart: number, rhsEnd: number) =>
    out.push({ names, offset, rhsStart, rhsEnd });
  if (lang === "js") {
    const decl = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*|\{[^;]{0,400}?\}|\[[^;]{0,200}?\])\s*(?::[^=;]+?)?=(?![=>])\s*/g;
    for (let m = decl.exec(code); m; m = decl.exec(code)) {
      const names = /^[{[]/.test(m[1]) ? destructuredNames(m[1]) : [m[1]];
      push(names, m.index, decl.lastIndex, statementEnd(code, decl.lastIndex));
    }
    const reassign = /(?<![\w$.\])])([A-Za-z_$][\w$]*)\s*(?:\+)?=(?![=>])\s*/g;
    for (let m = reassign.exec(code); m; m = reassign.exec(code)) {
      const before = code.slice(Math.max(0, m.index - 12), m.index);
      if (/\b(?:const|let|var)\s+$/.test(before) || /[!<>=]$/.test(before)) continue;
      push([m[1]], m.index, reassign.lastIndex, statementEnd(code, reassign.lastIndex));
    }
  } else if (lang === "py" || lang === "go" || lang === "rb") {
    const re = lang === "go"
      ? /^[ \t]*(?:var\s+)?([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)(?:\s+[\w.*[\]]+)?\s*:?=(?!=)\s*(.+)$/gm
      : /^[ \t]*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::\s*[^=\n]+)?(?:\+)?=(?![=~>])\s*(.+)$/gm;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const rhsStart = m.index + m[0].length - m[2].length;
      push(m[1].split(/\s*,\s*/).filter((x) => x !== "_"), m.index, rhsStart, m.index + m[0].length);
    }
    if (lang === "py") {
      const forIn = /^[ \t]*for\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\s+(.+):/gm;
      for (let m = forIn.exec(code); m; m = forIn.exec(code)) {
        const rhsStart = m.index + m[0].length - 1 - m[2].length;
        push(m[1].split(/\s*,\s*/), m.index, rhsStart, rhsStart + m[2].length);
      }
    }
  } else if (lang === "java" || lang === "cs" || lang === "php") {
    const re = lang === "php"
      ? /(\$[A-Za-z_]\w*)\s*(?:\.)?=(?![=>])\s*([^;]+);/g
      : /\b([A-Za-z_]\w*)\s*(?:\+)?=(?!=)\s*([^;]+);/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const rhsEnd = m.index + m[0].length - 1;
      push([m[1]], m.index, rhsEnd - m[2].length, rhsEnd);
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

function implicitSources(code: string, lang: Lang, lines: LineIndex, regions: Array<[number, number]>): TaintedVar[] {
  const out: TaintedVar[] = [];
  if (lang === "py") {
    const re = /@\w+\s*\.\s*(?:get|post|put|patch|delete|route|api_route)\s*\([^\n]*\)\s*\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      for (const p of splitTopLevel(m[1])) {
        const name = /^\s*\*{0,2}([A-Za-z_]\w*)/.exec(p.text)?.[1];
        if (!name || /^(?:self|cls|request|req|db|session|response|background_tasks|current_user|user|settings)$/.test(name)) continue;
        if (/Depends\s*\(/.test(p.text)) continue;
        const off = m.index + m[0].length;
        out.push({ name, line: lines.lineOf(off), region: regionAt(regions, off), via: "route parameter", prefix: true });
      }
    }
  } else if (lang === "java") {
    const re = /@(?:RequestParam|PathVariable|RequestBody|RequestHeader|CookieValue)\b(?:\([^)]*\))?\s+(?:final\s+)?[\w<>[\],.?]+\s+(\w+)/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      out.push({ name: m[1], line: lines.lineOf(m.index), region: regionAt(regions, m.index), via: "request parameter", prefix: true });
    }
  } else if (lang === "cs") {
    const re = /\[From(?:Query|Body|Route|Form|Header)\b[^\]]*\]\s*[\w<>[\],.?]+\s+(\w+)/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      out.push({ name: m[1], line: lines.lineOf(m.index), region: regionAt(regions, m.index), via: "request parameter", prefix: true });
    }
  }
  return out;
}

function sourceLabel(expr: string, sourceRe: RegExp): string {
  const m = sourceRe.exec(expr);
  return m ? m[0].replace(/\s+/g, "").replace(/\($/, "()") : "user input";
}

export interface TaintOptions {
  seeds?: TaintedVar[];
  useSources?: boolean;
  range?: [number, number];
  regions?: Array<[number, number]>;
  assignments?: Assignment[];
  sources?: RegExp;
}

export function computeTaint(
  code: string,
  text: string,
  lang: Lang,
  filename: string,
  lines: LineIndex,
  opts: TaintOptions = {},
): TaintState {
  const useSources = opts.useSources ?? true;
  let sourceRe = opts.sources ?? (useSources ? SOURCES[lang] ?? null : null);
  if (sourceRe && !opts.sources && lang === "js" && JS_ROUTE_FILE.test(filename)) {
    sourceRe = new RegExp(`${sourceRe.source}|\\bparams\\b`);
  }
  const regions = opts.regions ?? scopeRegions(code, lang);
  const vars = new Map<string, TaintedVar>();
  const state: TaintState = { lang, vars, sourceRe, regions, lines };
  for (const v of opts.seeds ?? []) vars.set(`${v.region}:${v.name}`, v);
  if (!sourceRe && vars.size === 0) return state;

  if (useSources) for (const v of implicitSources(code, lang, lines, regions)) vars.set(`${v.region}:${v.name}`, v);
  const all = opts.assignments ?? extractAssignments(code, lang);
  const assignments = opts.range ? all.filter((a) => a.offset >= opts.range![0] && a.offset <= opts.range![1]) : all;

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const a of assignments) {
      const rhs = code.slice(a.rhsStart, a.rhsEnd);
      if (SANITIZER.test(rhs) || DERIVED_SAFE.test(rhs)) continue;
      const hit = exprTaint(rhs, state, a.offset);
      if (!hit) continue;
      const lead = leadingOperand(rhs, text.slice(a.rhsStart, a.rhsEnd));
      const prefix = lead !== null && prefixTaint(lead, state, a.offset) !== null;
      const region = regionAt(regions, a.offset);
      const line = lines.lineOf(a.offset);
      for (const name of a.names) {
        const key = `${region}:${name}`;
        const prev = vars.get(key);
        if (prev && (prev.prefix || !prefix)) continue;
        vars.set(key, { name, line: prev?.line ?? line, region, via: hit.via, prefix });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return state;
}

export interface TaintHit {
  via: string;
  name?: string;
  sourceLine?: number;
}

export function exprTaint(expr: string, state: TaintState, offset: number, prefixOnly = false): TaintHit | null {
  if (state.sourceRe && state.sourceRe.test(expr)) return { via: sourceLabel(expr, state.sourceRe) };
  if (state.vars.size === 0) return null;
  const region = regionAt(state.regions, offset);
  const line = state.lines.lineOf(offset);
  for (const v of state.vars.values()) {
    if (v.region !== region && v.region !== -1) continue;
    if (v.line > line || (prefixOnly && !v.prefix)) continue;
    if (identPattern(v.name).test(expr)) return { via: v.via, name: v.name, sourceLine: v.line };
  }
  return null;
}

export function prefixTaint(lead: string, state: TaintState, offset: number): TaintHit | null {
  const call = /^\s*(?:await\s+)?([A-Za-z_$][\w$.\s]*?)\s*\(/.exec(lead);
  if (call && !exprTaint(`${call[1]}(`, state, offset, true)) return null;
  return exprTaint(lead, state, offset, true);
}

const GUARD_STRONG =
  /\b(?:includes|startsWith|endsWith|has|indexOf|isAllowed\w*|isSafe\w*|isValid\w*|validate\w*|allow\w*|whitelist\w*|ALLOWED\w*|ALLOW_\w*|hostname|origin|protocol|normalize|relative|test|match)\b|===|!==/;
const GUARD_WEAK = /\b(?:isAllowed\w*|isSafe\w*|isValid\w*|validate\w*|sanitize\w*|allow\w*|whitelist\w*|ALLOWED\w*|includes|test|match)\b/;

export function isGuarded(code: string, lines: LineIndex, hit: TaintHit, sinkLine: number, strong: boolean): boolean {
  if (!hit.name || !hit.sourceLine) return false;
  const ident = identPattern(hit.name);
  const guard = strong ? GUARD_STRONG : GUARD_WEAK;
  for (let l = hit.sourceLine + 1; l < sinkLine; l++) {
    const text = code.slice(lines.offsetOf(l), lines.offsetOf(l + 1));
    if (ident.test(text) && guard.test(text)) return true;
  }
  return false;
}

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PLACEHOLDER =
  /^(?:x+|\*+|\.+|-+|0+|1234\w*|abc\w*|test\w*|dummy\w*|fake\w*|mock\w*|sample\w*|example\w*|placeholder\w*|changeme\w*|change[_-]?me\w*|your[_-]?\w*|my[_-]?\w*|insert[_-]?\w*|replace[_-]?\w*|todo\w*|secret|password|passwd|admin|root|guest|default|none|null|undefined|redacted|hidden|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%\w+%|__\w+__)$/i;

export function looksLikePlaceholder(value: string): boolean {
  const v = value.trim();
  if (PLACEHOLDER.test(v)) return true;
  if (/(?:example|sample|placeholder|dummy|changeme|your[_-]|xxxx|<|>|\$\{|\{\{|process\.env|os\.environ|getenv)/i.test(v)) return true;
  if (/^(.)\1+$/.test(v)) return true;
  return false;
}

export function looksLikeSecretValue(value: string, keyName = ""): boolean {
  const v = value.trim();
  if (v.length < 6 || looksLikePlaceholder(v)) return false;
  if (/\s/.test(v)) return false;
  if (/[()[\]{}<>,;]/.test(v)) return false;
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v)) return false;
  if (/^(?:https?:|\/|\.\/|\.\.\/|#|@|mailto:)/i.test(v)) return false;
  if (/^[A-Z][A-Z0-9_]+$/.test(v)) return false;
  if (/^[a-z]+(?:[._:-][a-z]+)+$/.test(v)) return false;
  if (/^[a-z]+(?:[A-Z][a-z]+)+$/.test(v)) return false;
  if (/^(?:true|false|null|none|yes|no|on|off)$/i.test(v)) return false;
  const isPassword = /pass(?:word|wd)?|pwd/i.test(keyName);
  if (isPassword) return v.length >= 6;
  const hasDigit = /\d/.test(v);
  const hasAlpha = /[A-Za-z]/.test(v);
  const entropy = shannonEntropy(v);
  if (!hasDigit) return v.length >= 32 && entropy >= 4.0;
  if (v.length >= 20 && entropy >= 3.5) return true;
  return hasAlpha && v.length >= 12 && entropy >= 3.0;
}

const SECRET_TOKEN_SHAPES: RegExp[] = [
  /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bsk-(?:ant-[a-z0-9]+-|proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:npm|pypi|hf|gsk|shpat|shpss|dop_v1|glc|xai)_[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function redactSecrets(s: string): string {
  let out = s;
  for (const re of SECRET_TOKEN_SHAPES) {
    out = out.replace(re, (m) => `${m.slice(0, Math.min(6, Math.floor(m.length / 4)))}…[redacted]`);
  }
  out = out.replace(/(["'`])([^"'`\s]{16,})\1/g, (m, q: string, v: string) =>
    looksLikeSecretValue(v) && shannonEntropy(v) >= 3.5 ? `${q}${v.slice(0, 4)}…[redacted]${q}` : m,
  );
  out = out.replace(/(\/\/[^:/\s"'@]+:)[^@/\s"']+@/g, "$1…[redacted]@");
  return out;
}

export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "security" | "quality" | "performance";

export interface RuleFix {
  before: string;
  after: string;
  language?: string;
}

export interface ProjectCtx {
  globalAuth: boolean;
  globalRateLimit: boolean;
  reactCompiler: boolean;
  deps: Record<string, string>;
  kinds: string[];
  traits: string[];
  majors: Record<string, number>;
}

export const EMPTY_PROJECT: ProjectCtx = {
  globalAuth: false,
  globalRateLimit: false,
  reactCompiler: false,
  deps: {},
  kinds: [],
  traits: [],
  majors: {},
};

export interface FileCtx {
  filename: string;
  short: string;
  lang: Lang;
  role: FileRole;
  raw: string;
  code: string;
  text: string;
  lines: LineIndex;
  lineMap?: number[];
  reportable?: Set<number>;
  suppress: Suppressions;
  isClient: boolean;
  isServer: boolean;
  project: ProjectCtx;
  taint?: TaintState;
  assignments?: Assignment[];
  sites?: SinkSite[];
}

const SERVER_FILE =
  /(?:^|\/)(?:app|src\/app)\/(?:.*\/)?route\.[jt]s$|(?:^|\/)pages\/api\/|(?:^|\/)api\/|(?:^|\/)(?:server|routes?|controllers?|handlers?|services?|actions?)(?:\/|\.[jt]s$)|\.server\.[jt]sx?$/;
const BACKEND_LANGS: ReadonlySet<Lang> = new Set<Lang>(["py", "go", "java", "php", "rb", "cs"]);

function contentMatchesPatch(content: string, view: PatchView): boolean {
  const idx = new LineIndex(content);
  let checked = 0;
  let ok = 0;
  for (const h of view.hunks) {
    const hunkLines = h.text.split("\n");
    h.newLines.forEach((ln, k) => {
      if (!view.added.has(ln) || checked >= 40) return;
      checked++;
      if (idx.lineText(ln).trimEnd() === hunkLines[k].replace(/\r$/, "").trimEnd()) ok++;
    });
  }
  return checked > 0 && ok / checked >= 0.9;
}

export function buildFileCtx(params: {
  filename: string;
  content?: string;
  patch?: string;
  project?: ProjectCtx;
}): FileCtx | null {
  const { filename, content, patch } = params;
  const lang = detectLang(filename);
  let raw: string;
  let code: string;
  let text: string;
  let lineMap: number[] | undefined;
  let reportable: Set<number> | undefined;

  const view = patch ? parsePatch(patch) : null;
  if (content !== undefined && (!view || contentMatchesPatch(content, view))) {
    raw = content;
    ({ code, text } = maskSource(raw, lang, filename));
    if (view) reportable = view.added;
  } else if (view) {
    if (view.added.size === 0) return null;
    const rawParts: string[] = [];
    const codeParts: string[] = [];
    const textParts: string[] = [];
    lineMap = [];
    for (const h of view.hunks) {
      const m = maskSource(h.text, lang, filename);
      rawParts.push(h.text);
      codeParts.push(m.code);
      textParts.push(m.text);
      lineMap.push(...h.newLines, 0);
    }
    raw = rawParts.join("\n\n");
    code = codeParts.join("\n\n");
    text = textParts.join("\n\n");
    reportable = view.added;
  } else {
    return null;
  }

  return {
    filename,
    short: filename.split("/").slice(-2).join("/"),
    lang,
    role: fileRole(filename),
    raw,
    code,
    text,
    lines: new LineIndex(raw),
    lineMap,
    reportable,
    suppress: parseSuppressions(raw),
    isClient: lang === "js" && /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/.test(raw),
    isServer:
      BACKEND_LANGS.has(lang) ||
      SERVER_FILE.test(filename) ||
      (lang === "js" &&
        (/^(?:\s|\/\/[^\n]*\n)*["']use server["']/.test(raw) || /from\s+["'](?:next\/server|server-only)["']/.test(raw))),
    project: params.project ?? EMPTY_PROJECT,
  };
}

export function realLine(ctx: FileCtx, analyzedLine: number): number {
  return ctx.lineMap ? (ctx.lineMap[analyzedLine - 1] ?? 0) : analyzedLine;
}

export function reportableLine(ctx: FileCtx, startLine: number, endLine: number): number | null {
  for (let l = startLine; l <= endLine; l++) {
    const real = realLine(ctx, l);
    if (real === 0) continue;
    if (!ctx.reportable || ctx.reportable.has(real)) return real;
  }
  return null;
}

export function getAssignments(ctx: FileCtx): Assignment[] {
  ctx.assignments ??= extractAssignments(ctx.code, ctx.lang);
  return ctx.assignments;
}

export function getTaint(ctx: FileCtx): TaintState {
  ctx.taint ??= computeTaint(ctx.code, ctx.text, ctx.lang, ctx.filename, ctx.lines, { assignments: getAssignments(ctx) });
  return ctx.taint;
}

export interface RuleMatch {
  ctx: FileCtx;
  text: string;
  groups: Array<string | undefined>;
  index: number;
  end: number;
  aline: number;
  line: number;
  lineText: string;
}

export interface Refinement {
  severity?: Severity;
  confidence?: number;
}

export interface PatternRule {
  id: string;
  category: Category;
  severity: Severity;
  confidence: number;
  langs: Lang[] | "any";
  view?: "code" | "text" | "raw";
  files?: RegExp;
  roles?: FileRole[];
  cls?: string;
  pattern: RegExp;
  inStrings?: boolean;
  when?: (ctx: FileCtx) => boolean;
  refine?: (m: RuleMatch) => boolean | Refinement;
  message: (m: RuleMatch) => string;
  label?: string;
  suggestion: string;
  fix?: RuleFix;
}

export interface CheckFinding {
  ruleId: string;
  cls?: string;
  category: Category;
  severity: Severity;
  confidence: number;
  offset: number;
  end?: number;
  description: string;
  label?: string;
  suggestion: string;
  fix?: RuleFix;
}

export interface StructuralCheck {
  id: string;
  langs: Lang[] | "any";
  roles?: FileRole[];
  files?: RegExp;
  when?: (ctx: FileCtx) => boolean;
  run: (ctx: FileCtx) => CheckFinding[];
}

export interface SinkRule {
  id: string;
  cls: string;
  langs: Lang[];
  pattern: RegExp;
  kind: "call" | "assign" | "expr";
  args?: "first" | "last" | "all" | "query" | number[];
  prefixOnly?: boolean;
  guard?: "strong" | "weak" | "none";
  extract?: (argCode: string) => string | null;
  when?: (call: { argsCode: string; argsText: string }, ctx: FileCtx) => boolean;
  skipClient?: boolean;
  severity: Severity;
  confidence: number;
  title: string;
  impact: string;
  suggestion: string;
  fix?: RuleFix;
}

export interface EngineFinding {
  ruleId: string;
  cls?: string;
  category: Category;
  severity: Severity;
  confidence: number;
  file: string;
  line?: number;
  snippet?: string;
  description: string;
  label?: string;
  suggestion: string;
  fix?: RuleFix;
  occurrences: number;
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function ruleApplies(
  r: { langs: Lang[] | "any"; roles?: FileRole[]; files?: RegExp; when?: (ctx: FileCtx) => boolean },
  ctx: FileCtx,
): boolean {
  if (r.langs !== "any" && !r.langs.includes(ctx.lang)) return false;
  if (r.files && !r.files.test(ctx.filename)) return false;
  if (!(r.roles ?? ["source"]).includes(ctx.role)) return false;
  return !r.when || r.when(ctx);
}

const regexCache = new WeakMap<RegExp, RegExp>();
function globalRe(re: RegExp): RegExp {
  let g = regexCache.get(re);
  if (!g) {
    g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    regexCache.set(re, g);
  }
  g.lastIndex = 0;
  return g;
}

function snippetAt(ctx: FileCtx, aline: number): string {
  const t = ctx.lines.lineText(aline).trim();
  return redactSecrets(t.length > 160 ? `${t.slice(0, 157)}…` : t);
}

function rankOf(sev: Severity, conf: number): number {
  return SEVERITY_RANK[sev] * 10 + conf;
}

class Aggregator {
  private groups = new Map<string, { best: Omit<EngineFinding, "occurrences">; rank: number; count: number }>();

  add(f: Omit<EngineFinding, "occurrences">): void {
    const rank = rankOf(f.severity, f.confidence);
    const g = this.groups.get(f.ruleId);
    if (!g) this.groups.set(f.ruleId, { best: f, rank, count: 1 });
    else {
      g.count++;
      if (rank > g.rank) { g.best = f; g.rank = rank; }
    }
  }

  results(): EngineFinding[] {
    return [...this.groups.values()].map((g) => ({ ...g.best, occurrences: g.count }));
  }
}

const MAX_MATCHES_PER_RULE = 50;

export function insideString(ctx: FileCtx, offset: number): boolean {
  return ctx.code[offset] === " " && ctx.text[offset] !== " " && !/\s/.test(ctx.raw[offset] ?? " ");
}

const OWN_ORIGIN = /\.\s*(?:origin|host|hostname|protocol)\s*$/;

function runPatternRule(rule: PatternRule, ctx: FileCtx, agg: Aggregator): void {
  const view = rule.view ?? (rule.category === "security" ? "text" : "code");
  const hay = view === "code" ? ctx.code : view === "text" ? ctx.text : ctx.raw;
  const re = globalRe(rule.pattern);
  let accepted = 0;
  let scanned = 0;
  for (let m = re.exec(hay); m && scanned < MAX_MATCHES_PER_RULE * 4; m = re.exec(hay)) {
    scanned++;
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (view !== "code" && !rule.inStrings && insideString(ctx, m.index)) continue;
    const aline = ctx.lines.lineOf(m.index);
    const line = reportableLine(ctx, aline, ctx.lines.lineOf(m.index + m[0].length - 1));
    if (line === null || isSuppressed(ctx.suppress, line, rule.id, rule.category)) continue;
    const rm: RuleMatch = {
      ctx,
      text: m[0],
      groups: m.slice(1),
      index: m.index,
      end: m.index + m[0].length,
      aline,
      line,
      lineText: ctx.lines.lineText(aline),
    };
    const verdict = rule.refine ? rule.refine(rm) : true;
    if (verdict === false) continue;
    const ref = verdict === true ? {} : verdict;
    agg.add({
      ruleId: rule.id,
      cls: rule.cls,
      category: rule.category,
      severity: ref.severity ?? rule.severity,
      confidence: ref.confidence ?? rule.confidence,
      file: ctx.filename,
      line,
      snippet: snippetAt(ctx, aline),
      description: redactSecrets(rule.message(rm)),
      label: rule.label,
      suggestion: rule.suggestion,
      fix: rule.fix,
    });
    if (++accepted >= MAX_MATCHES_PER_RULE) break;
  }
}

function runCheck(check: StructuralCheck, ctx: FileCtx, agg: Aggregator): void {
  for (const cf of check.run(ctx)) {
    const aline = ctx.lines.lineOf(cf.offset);
    const line = reportableLine(ctx, aline, ctx.lines.lineOf(cf.end ?? cf.offset));
    if (line === null || isSuppressed(ctx.suppress, line, cf.ruleId, cf.category)) continue;
    agg.add({
      ruleId: cf.ruleId,
      cls: cf.cls,
      category: cf.category,
      severity: cf.severity,
      confidence: cf.confidence,
      file: ctx.filename,
      line,
      snippet: snippetAt(ctx, aline),
      description: redactSecrets(cf.description),
      label: cf.label,
      suggestion: cf.suggestion,
      fix: cf.fix,
    });
  }
}

export function leadingOperand(argCode: string, argText: string): string | null {
  let code = argCode;
  let text = argText;
  for (let depth = 0; depth < 4; depth++) {
    const lead = /^\s*(?:await\s+)?/.exec(code)?.[0].length ?? 0;
    code = code.slice(lead);
    text = text.slice(lead);
    const wrap = /^(?:new\s+URL|new\s+Request|URL|String|encodeURI|decodeURIComponent|decodeURI|unescape|str|url\s*\.\s*parse|urllib\s*\.\s*parse\s*\.\s*unquote|unquote)\s*\(/.exec(code);
    if (!wrap) break;
    const call = callArgsAt(code, wrap[0].length - 1);
    if (!call || call.args.length === 0) return null;
    const a = call.args[0];
    code = code.slice(a.start, a.start + a.text.length);
    text = text.slice(a.start, a.start + a.text.length);
  }
  const branches = splitTernary(code);
  if (branches) {
    const leads = branches
      .map(([s, e]) => leadingOperand(code.slice(s, e), text.slice(s, e)))
      .filter((l): l is string => l !== null);
    return leads.length > 0 ? leads.join(" ") : null;
  }
  const trimmed = text.trimStart();
  const at = text.length - trimmed.length;
  if (/^[fF]?["']/.test(trimmed)) {
    const q = trimmed.search(/["']/);
    if (q === 1 && trimmed[q + 1] === "{") {
      const close = findClose(code, at + q + 1);
      return close > 0 ? code.slice(at + q + 2, close) : null;
    }
    return null;
  }
  if (trimmed.startsWith("`")) {
    if (!trimmed.startsWith("`${")) return null;
    const close = findClose(code, at + 2);
    return close > 0 ? code.slice(at + 3, close) : null;
  }
  return splitTopLevel(code.trim(), "+")[0]?.text ?? null;
}

function splitTernary(code: string): Array<[number, number]> | null {
  let depth = 0;
  let q = -1;
  let nested = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth !== 0) continue;
    else if (ch === "?" && code[i + 1] !== "." && code[i + 1] !== "?" && code[i - 1] !== "?") {
      if (q < 0) q = i;
      else nested++;
    } else if (ch === ":" && q >= 0) {
      if (nested > 0) nested--;
      else return [[q + 1, i], [i + 1, code.length]];
    }
  }
  return null;
}

function selectArgs(call: CallArgs, mode: SinkRule["args"]): Part[] {
  const args = call.args;
  if (args.length === 0) return [];
  if (Array.isArray(mode)) return mode.map((i) => args[i]).filter((p): p is Part => Boolean(p));
  switch (mode ?? "first") {
    case "last": return [args[args.length - 1]];
    case "all": return args;
    case "query": {
      const q = /^\s*(?:ctx|context|c)\s*$|context\s*\.|\.Context\s*\(/.test(args[0].text) ? args[1] : args[0];
      return q ? [q] : [];
    }
    default: return [args[0]];
  }
}

export interface SinkSite {
  sink: SinkRule;
  index: number;
  end: number;
  sinkName: string;
  exprs: Array<{ code: string; text: string; start: number }>;
}

export function sinkSites(ctx: FileCtx, sinks: SinkRule[]): SinkSite[] {
  if (ctx.sites) return ctx.sites;
  const sites: SinkSite[] = [];
  for (const sink of sinks) {
    if (!sink.langs.includes(ctx.lang) || (sink.skipClient && ctx.isClient)) continue;
    const re = globalRe(sink.pattern);
    let count = 0;
    for (let m = re.exec(ctx.code); m && count < MAX_MATCHES_PER_RULE * 2; m = re.exec(ctx.code)) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      count++;
      const matchEnd = m.index + m[0].length;
      let exprs: SinkSite["exprs"];
      let argsCode: string;
      let argsText: string;
      let end: number;
      if (sink.kind === "call") {
        const call = callArgsAt(ctx.code, matchEnd - 1);
        if (!call) continue;
        end = call.close;
        argsCode = ctx.code.slice(call.open + 1, call.close);
        argsText = ctx.text.slice(call.open + 1, call.close);
        exprs = selectArgs(call, sink.args).map((p) => ({
          code: p.text,
          text: ctx.text.slice(p.start, p.start + p.text.length),
          start: p.start,
        }));
      } else {
        end = statementEnd(ctx.code, matchEnd);
        argsCode = ctx.code.slice(matchEnd, end);
        argsText = ctx.text.slice(matchEnd, end);
        exprs = [{ code: argsCode, text: argsText, start: matchEnd }];
      }
      if (sink.when && !sink.when({ argsCode, argsText }, ctx)) continue;
      const sinkName = `${m[0].replace(/\s+/g, "").replace(/[(=]$/, "")}${sink.kind === "call" ? "()" : ""}`;
      sites.push({ sink, index: m.index, end, sinkName, exprs });
    }
  }
  ctx.sites = sites;
  return sites;
}

export interface SinkFlow {
  site: SinkSite;
  hit: TaintHit;
  aline: number;
}

export function evaluateSite(site: SinkSite, ctx: FileCtx, state: TaintState): SinkFlow | null {
  const { sink } = site;
  for (const e of site.exprs) {
    const expr = sink.extract ? sink.extract(e.code) : sink.prefixOnly ? leadingOperand(e.code, e.text) : e.code;
    if (!expr || SANITIZER.test(expr)) continue;
    if (sink.prefixOnly && OWN_ORIGIN.test(expr.trim())) continue;
    const hit = sink.prefixOnly ? prefixTaint(expr, state, e.start) : exprTaint(expr, state, e.start);
    if (!hit) continue;
    const aline = ctx.lines.lineOf(site.index);
    const guard = sink.guard ?? "weak";
    if (guard !== "none" && isGuarded(ctx.code, ctx.lines, hit, aline, guard === "strong")) continue;
    return { site, hit, aline };
  }
  return null;
}

function runSinks(ctx: FileCtx, sinks: SinkRule[], state: TaintState, agg: Aggregator): void {
  for (const site of sinkSites(ctx, sinks)) {
    const flow = evaluateSite(site, ctx, state);
    if (!flow) continue;
    const { sink, sinkName } = site;
    const line = reportableLine(ctx, flow.aline, ctx.lines.lineOf(site.end));
    if (line === null || isSuppressed(ctx.suppress, line, sink.id, "security")) continue;
    const fromLine = flow.hit.sourceLine ? realLine(ctx, flow.hit.sourceLine) : 0;
    const via = flow.hit.name
      ? `\`${flow.hit.via}\` (assigned to \`${flow.hit.name}\`${fromLine ? ` on line ${fromLine}` : ""})`
      : `\`${flow.hit.via}\``;
    agg.add({
      ruleId: sink.id,
      cls: sink.cls,
      category: "security",
      severity: sink.severity,
      confidence: sink.confidence,
      file: ctx.filename,
      line,
      snippet: snippetAt(ctx, flow.aline),
      description: redactSecrets(
        `${sink.title} in ${ctx.short}: user input from ${via} reaches \`${sinkName}\` on line ${line}. ${sink.impact}`,
      ),
      suggestion: sink.suggestion,
      fix: sink.fix,
    });
  }
}

const MAX_ANALYZED_CHARS = 400_000;

export interface RulePacks {
  patterns: PatternRule[];
  checks: StructuralCheck[];
  sinks: SinkRule[];
}

export function analyzeFileCtx(ctx: FileCtx, packs: RulePacks): EngineFinding[] {
  if (ctx.role === "generated" || ctx.raw.length > MAX_ANALYZED_CHARS) return [];
  if (ctx.suppress.file || isRuleDefinitionFile(ctx.filename, ctx.raw)) return [];

  const agg = new Aggregator();
  for (const rule of packs.patterns) {
    if (ruleApplies(rule, ctx)) runPatternRule(rule, ctx, agg);
  }
  for (const check of packs.checks) {
    if (ruleApplies(check, ctx)) runCheck(check, ctx, agg);
  }
  if (ctx.role === "source" && SOURCES[ctx.lang] && packs.sinks.some((s) => s.langs.includes(ctx.lang))) {
    runSinks(ctx, packs.sinks, getTaint(ctx), agg);
  }
  return mergeByClass(agg.results());
}

export function hasTaintSources(lang: Lang): boolean {
  return Boolean(SOURCES[lang]);
}

export function mergeByClass(findings: EngineFinding[]): EngineFinding[] {
  const score = (f: EngineFinding) => rankOf(f.severity, f.confidence) + (f.ruleId.startsWith("taint-") ? 0.5 : 0);
  const byKey = new Map<string, EngineFinding>();
  const rest: EngineFinding[] = [];
  for (const f of findings) {
    if (!f.cls || f.line === undefined) { rest.push(f); continue; }
    const key = `${f.file}:${f.cls}:${f.line}`;
    const prev = byKey.get(key);
    if (!prev || score(f) > score(prev)) byKey.set(key, f);
  }
  return [...rest, ...byKey.values()];
}
