import {
  callArgsAt,
  computeTaint,
  evaluateSite,
  exprTaint,
  findClose,
  getAssignments,
  getTaint,
  sinkSites,
  type CheckFinding,
  type FileCtx,
  type PatternRule,
  type RuleMatch,
  type Severity,
  type StructuralCheck,
} from "@/lib/internal-ai-engine";
import { TAINT_SINKS } from "@/lib/internal-ai-rules";

const AI_IMPORT =
  /from\s+["'](?:@anthropic-ai\/sdk|openai|@google\/generative-ai|@google\/genai|ai|@ai-sdk\/[\w-]+|groq-sdk|langchain|@langchain\/[\w-]+|ollama|cohere-ai)["']|^\s*(?:from|import)\s+(?:openai|anthropic|langchain\w*|google\.generativeai|google\.genai)\b/m;

const LLM_OUTPUT_JS =
  /\.choices\s*\[[^\]]*\]\s*\.\s*(?:message|text|delta)\b|\.content\s*\[[^\]]*\]\s*\.\s*(?:text|input)\b|\.output_text\b|\.response\s*\.\s*text\s*\(|\b(?:generateText|generateObject)\s*\(|\.\s*function\s*\.\s*arguments\b|\b(?:aiRes|aiResponse|aiResult|llmRes|llmResponse|llmResult|llmOutput|modelOutput|modelResponse|completion)\s*\??\.\s*(?:text|content|output|choices)\b/;
const LLM_OUTPUT_PY =
  /\.choices\s*\[[^\]]*\]\s*\.\s*message\b|\.content\s*\[[^\]]*\]\s*\.\s*text\b|\.output_text\b|\.generate_content\s*\(|\bcompletion\s*\.\s*(?:text|content)\b/;

const LLM_CALL =
  /\.\s*messages\s*\.\s*(?:create|stream)\s*\(|\.\s*chat\s*\.\s*completions\s*\.\s*create\s*\(|\.\s*responses\s*\.\s*create\s*\(|\b(?:generateText|streamText|generateObject|streamObject)\s*\(|\.\s*generateContent(?:Stream)?\s*\(|\bcallAI\w*\s*\(/;

const isAiFile = (ctx: FileCtx) =>
  ctx.project.traits.includes("ai-powered") || AI_IMPORT.test(ctx.text) || LLM_CALL.test(ctx.code) || LLM_OUTPUT_JS.test(ctx.code);

const LLM_SINK_SEVERITY: Record<string, Severity> = {
  code: "critical",
  cmdi: "critical",
  sqli: "high",
  deser: "high",
  xss: "high",
  ssrf: "high",
  path: "high",
  redirect: "medium",
  ssti: "critical",
  nosqli: "medium",
};

function valueEnd(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < Math.min(code.length, from + 4000); i++) {
    const ch = code[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && (ch === "," || ch === ";")) return i;
  }
  return Math.min(code.length, from + 4000);
}

function finding(offset: number, f: Omit<CheckFinding, "offset">): CheckFinding {
  return { ...f, offset };
}

const llmOutputCheck: StructuralCheck = {
  id: "llm-output-handling",
  langs: ["js", "py"],
  when: isAiFile,
  run: (ctx) => {
    const sources = ctx.lang === "py" ? LLM_OUTPUT_PY : LLM_OUTPUT_JS;
    if (!sources.test(ctx.code)) return [];
    const state = computeTaint(ctx.code, ctx.text, ctx.lang, ctx.filename, ctx.lines, {
      sources,
      useSources: false,
      assignments: getAssignments(ctx),
    });
    const out: CheckFinding[] = [];
    for (const site of sinkSites(ctx, TAINT_SINKS)) {
      const severity = LLM_SINK_SEVERITY[site.sink.cls];
      if (!severity) continue;
      const flow = evaluateSite(site, ctx, state);
      if (!flow) continue;
      out.push(finding(site.index, {
        ruleId: `llm-output-${site.sink.cls}`,
        cls: site.sink.cls,
        category: "security",
        severity,
        confidence: 0.75,
        description: `Model output reaches \`${site.sinkName}\` in ${ctx.short}${flow.hit.name ? ` (via \`${flow.hit.name}\`)` : ""} — ${site.sink.title.toLowerCase()} driven by the LLM. Prompt-injected content (from a user, a scraped page or a repository file) can make the model emit exactly the payload that ${site.sinkName} executes (OWASP LLM05: improper output handling).`,
        suggestion: "Treat model output as untrusted input: validate it against a strict schema, render it as text (or sanitize HTML), and never pass it to eval, a shell, SQL or a URL/path without an allowlist.",
      }));
    }
    for (const m of ctx.code.matchAll(/\bJSON\s*\.\s*parse\s*\(/g)) {
      if (ctx.lang !== "js") break;
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call || call.args.length === 0) continue;
      const hit = exprTaint(call.args[0].text, state, call.args[0].start);
      if (!hit) continue;
      const after = ctx.code.slice(call.close + 1, call.close + 600);
      const casted = /^\s*as\s+[A-Z][\w<>[\]]*/.test(after);
      if (/\.(?:parse|safeParse|parseAsync)\s*\(|\bvalidate\w*\s*\(|\bassert\w*\s*\(|\bis[A-Z]\w*\s*\(/.test(after.split("\n").slice(0, 8).join("\n"))) continue;
      out.push(finding(m.index, {
        ruleId: "llm-output-unvalidated",
        category: "quality",
        severity: "medium",
        confidence: casted ? 0.75 : 0.6,
        description: `Model output is parsed with JSON.parse${casted ? " and cast with `as`" : ""} in ${ctx.short} without schema validation. LLMs regularly return missing fields, wrong types or extra prose; the type assertion hides that until something downstream crashes or renders garbage.`,
        suggestion: "Validate the parsed object with a schema (zod: Schema.safeParse(JSON.parse(text))) and fall back or retry when it fails. Prefer structured-output / JSON-schema modes where the provider supports them.",
      }));
    }
    return out;
  },
};

const promptInjectionCheck: StructuralCheck = {
  id: "llm-prompt-injection",
  langs: ["js", "py"],
  when: isAiFile,
  run: (ctx) => {
    const state = getTaint(ctx);
    if (!state.sourceRe && state.vars.size === 0) return [];
    const out: CheckFinding[] = [];
    const re = /\b(?:system|systemPrompt|system_prompt|systemInstruction|system_instruction|instructions)\s*:(?!:)|["']?role["']?\s*:\s*["']system["']\s*,\s*["']?content["']?\s*:/g;
    for (const m of ctx.text.matchAll(re)) {
      if (ctx.code[m.index] === " ") continue;
      const start = m.index + m[0].length;
      const end = valueEnd(ctx.code, start);
      const hit = exprTaint(ctx.code.slice(start, end), state, start);
      if (!hit) continue;
      out.push(finding(m.index, {
        ruleId: "llm-prompt-injection",
        cls: "prompt-injection",
        category: "security",
        severity: "medium",
        confidence: 0.65,
        description: `Untrusted input from \`${hit.via}\`${hit.name ? ` (via \`${hit.name}\`)` : ""} is placed into the system prompt in ${ctx.short}. Text in the system role is treated as instructions, so the user — or anyone who controls content fetched into that prompt, such as a repository file or web page — can override your guardrails, extract the prompt or steer tool use (OWASP LLM01: prompt injection).`,
        suggestion: "Keep the system prompt static. Put user-provided text in a user message, clearly delimited (e.g. inside <user_input> tags) and described as data, and enforce any security decision outside the model.",
      }));
    }
    return out;
  },
};

const RN = (ctx: FileCtx) => "react-native" in ctx.project.deps || "expo" in ctx.project.deps || /from\s+["']react-native["']/.test(ctx.text);
const ELECTRON = (ctx: FileCtx) => "electron" in ctx.project.deps || /from\s+["']electron["']|require\s*\(\s*["']electron["']\s*\)/.test(ctx.text);
const NEXT = (ctx: FileCtx) => "next" in ctx.project.deps || /from\s+["']next\//.test(ctx.text);
const nextMajor = (ctx: FileCtx) => ctx.project.majors.next ?? 0;

const redirectInTryCheck: StructuralCheck = {
  id: "next-redirect-in-try",
  langs: ["js"],
  when: (ctx) => NEXT(ctx) && /from\s+["']next\/navigation["']/.test(ctx.text),
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const t of ctx.code.matchAll(/\btry\s*\{/g)) {
      const open = t.index + t[0].length - 1;
      const close = findClose(ctx.code, open);
      if (close < 0) continue;
      const body = ctx.code.slice(open, close);
      const call = /(?<![.\w$])(redirect|permanentRedirect|notFound|forbidden|unauthorized)\s*\(/.exec(body);
      if (!call) continue;
      const catchHead = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(ctx.code.slice(close + 1, close + 120));
      if (!catchHead) continue;
      const cOpen = close + 1 + catchHead[0].length - 1;
      const cClose = findClose(ctx.code, cOpen);
      const catchBody = ctx.code.slice(cOpen, cClose < 0 ? cOpen + 400 : cClose);
      if (/\bthrow\b|isRedirectError|unstable_rethrow|isNotFoundError|rethrow/.test(catchBody)) continue;
      out.push(finding(open + call.index, {
        ruleId: "next-redirect-in-try",
        category: "quality",
        severity: "medium",
        confidence: 0.8,
        description: `\`${call[1]}()\` is called inside a try block in ${ctx.short}, and the catch doesn't rethrow. Next.js implements ${call[1]}() by throwing a special error, so the catch swallows it and the navigation silently never happens.`,
        suggestion: "Call redirect()/notFound() after the try/catch, or rethrow with `unstable_rethrow(err)` (or `if (isRedirectError(err)) throw err`) at the top of the catch block.",
      }));
    }
    return out;
  },
};

const cachedPersonalizedCheck: StructuralCheck = {
  id: "next-cached-personalized",
  langs: ["js"],
  when: NEXT,
  run: (ctx) => {
    const cfg = /export\s+const\s+(?:dynamic\s*=\s*["']force-static["']|revalidate\s*=\s*[1-9]\d*)/.exec(ctx.text);
    if (!cfg) return [];
    if (!/getServerSession|\bauth\s*\(\s*\)|currentUser\s*\(|\bcookies\s*\(\s*\)|\bheaders\s*\(\s*\)|getToken\s*\(/.test(ctx.code)) return [];
    return [finding(cfg.index, {
      ruleId: "next-cached-personalized",
      category: "security",
      severity: "high",
      confidence: 0.75,
      description: `${ctx.short} is statically cached (\`${cfg[0].replace(/export\s+const\s+/, "")}\`) but reads the session, cookies or headers. The first visitor's personalized output can be cached and served to everyone else.`,
      suggestion: "Remove force-static/revalidate from routes that depend on the user, or move the personalized part into a dynamic segment / client fetch.",
    })];
  },
};

const fetchCacheCheck: StructuralCheck = {
  id: "next-fetch-cache-personal",
  langs: ["js"],
  when: (ctx) => NEXT(ctx) && nextMajor(ctx) > 0 && nextMajor(ctx) <= 14 && /(?:^|\/)app\//.test(ctx.filename) && !ctx.isClient,
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/(?<![.\w$])fetch\s*\(/g)) {
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call || call.args.length < 2) continue;
      const opts = ctx.text.slice(call.args[1].start, call.args[1].start + call.args[1].text.length);
      if (!/authorization|cookie|x-api-key|token/i.test(opts) || /\bcache\s*:|\brevalidate\b|no-store/.test(opts)) continue;
      out.push(finding(m.index, {
        ruleId: "next-fetch-cache-personal",
        category: "security",
        severity: "high",
        confidence: 0.7,
        description: `Authenticated fetch in ${ctx.short} relies on Next.js ${nextMajor(ctx)} defaults, which cache fetch responses across requests. A user-specific response can be stored and served to other users.`,
        suggestion: "Pass { cache: \"no-store\" } (or next: { revalidate: 0 }) on fetches that send user credentials.",
      }));
    }
    return out;
  },
};

const fastapiAuthCheck: StructuralCheck = {
  id: "fastapi-route-no-auth",
  langs: ["py"],
  when: (ctx) => /\bfrom\s+fastapi\b|\bimport\s+fastapi\b/.test(ctx.text),
  run: (ctx) => {
    if (/\bdependencies\s*=\s*\[[^\]]*Depends/.test(ctx.text) && /APIRouter\s*\([^)]*dependencies/.test(ctx.text)) return [];
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/@\w+\s*\.\s*(post|put|patch|delete)\s*\(([^\n]*)\)\s*\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/g)) {
      if (/Depends\s*\(|dependencies\s*=/.test(m[2] + m[4])) continue;
      const path = /["']([^"']*)["']/.exec(ctx.text.slice(m.index, m.index + m[0].length))?.[1] ?? "";
      if (/\/(?:auth|login|register|signup|token|webhook|health)/i.test(path)) continue;
      out.push(finding(m.index, {
        ruleId: "fastapi-route-no-auth",
        cls: "authz",
        category: "security",
        severity: "medium",
        confidence: 0.65,
        description: `FastAPI ${m[1].toUpperCase()} handler \`${m[3]}\` (${path || ctx.short}) has no authentication dependency. Without Depends(get_current_user) (or router-level dependencies) anyone can call it.`,
        suggestion: "Add an auth dependency to the handler signature (user: User = Depends(get_current_user)) or to the APIRouter(dependencies=[Depends(...)]).",
      }));
    }
    return out;
  },
};

export const STACK_CHECKS: StructuralCheck[] = [
  llmOutputCheck,
  promptInjectionCheck,
  redirectInTryCheck,
  cachedPersonalizedCheck,
  fetchCacheCheck,
  fastapiAuthCheck,
];

function majorSeverity(ctx: FileCtx): Severity {
  return nextMajor(ctx) >= 16 ? "high" : "medium";
}

const literalArg = (m: RuleMatch) => {
  const call = callArgsAt(m.ctx.code, m.end - 1);
  return !call || /^[\s"'`]*$/.test(m.ctx.code.slice(call.open + 1, call.close));
};

export const STACK_RULES: PatternRule[] = [
  {
    id: "llm-browser-client",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["js"],
    view: "code",
    cls: "secret-exposure",
    pattern: /\bnew\s+(?:OpenAI|Anthropic|GoogleGenerativeAI|GoogleGenAI|Groq)\s*\(|\bdangerouslyAllowBrowser\s*:\s*true/g,
    refine: (m) => m.ctx.isClient || /dangerouslyAllowBrowser/.test(m.text),
    message: (m) => `LLM provider client used from browser code in ${m.ctx.short}. The API key has to ship to the browser, where anyone can copy it and spend your quota.`,
    suggestion: "Call the model from a route handler or server action and stream the result to the client; never enable dangerouslyAllowBrowser in production.",
  },
  {
    id: "llm-no-token-cap",
    category: "performance",
    severity: "low",
    confidence: 0.7,
    langs: ["js", "py"],
    view: "code",
    pattern: /\.\s*(?:chat\s*\.\s*completions|responses)\s*\.\s*create\s*\(|\b(?:generateText|streamText)\s*\(/g,
    refine: (m) => {
      const call = callArgsAt(m.ctx.code, m.end - 1);
      return !!call && !/max_?(?:completion_|output_)?tokens|maxTokens|maxOutputTokens|max_output_tokens/i.test(m.ctx.code.slice(call.open, call.close));
    },
    message: (m) => `Model call without an output-token cap in ${m.ctx.short}. A long or adversarial prompt can produce very long (slow, expensive) completions.`,
    label: "LLM calls without an output-token cap",
    suggestion: "Set max_tokens / maxOutputTokens to the largest response you actually need.",
  },
  {
    id: "markdown-raw-html",
    category: "security",
    severity: "medium",
    confidence: 0.7,
    langs: ["js"],
    view: "code",
    cls: "xss",
    pattern: /\brehypeRaw\b|\ballowDangerousHtml\s*:\s*true|\bskipHtml\s*=\s*\{\s*false\s*\}/g,
    refine: (m) => !/rehypeSanitize|sanitize|DOMPurify/.test(m.ctx.code),
    message: (m) => `Markdown rendering in ${m.ctx.short} passes raw HTML through without sanitization. Any user- or AI-provided markdown can inject <script>/<img onerror> into the page.`,
    suggestion: "Add rehype-sanitize after rehype-raw (or drop raw HTML support).",
  },
  {
    id: "next-sync-dynamic-api",
    category: "quality",
    severity: "medium",
    confidence: 0.8,
    langs: ["js"],
    view: "code",
    when: (ctx) => NEXT(ctx) && nextMajor(ctx) >= 15 && /from\s+["']next\/headers["']/.test(ctx.text),
    pattern: /(?<![\w$.])(?:cookies|headers|draftMode)\s*\(\s*\)\s*\.\s*(?:get|getAll|set|has|delete|isEnabled|enable|disable|entries|forEach|keys)\b/g,
    refine: (m) => (/\bawait\s*\(?\s*$/.test(m.ctx.code.slice(Math.max(0, m.index - 12), m.index)) ? false : { severity: majorSeverity(m.ctx) }),
    message: (m) => `\`${m.text.replace(/\s+/g, "")}\` is used synchronously in ${m.ctx.short}. Since Next.js 15 these APIs return promises${nextMajor(m.ctx) >= 16 ? " and Next.js 16 removed the synchronous fallback, so this throws at runtime" : "; synchronous access is deprecated"}.`,
    suggestion: "Await it: const store = await cookies(); store.get(\"name\").",
  },
  {
    id: "next-sync-params",
    category: "quality",
    severity: "medium",
    confidence: 0.75,
    langs: ["js"],
    view: "code",
    files: /(?:^|\/)app\/.*\.[jt]sx?$/,
    when: (ctx) => NEXT(ctx) && nextMajor(ctx) >= 15,
    pattern: /\{\s*(?:params|searchParams)(?:\s*,\s*(?:params|searchParams))?\s*\}\s*:\s*\{\s*(?:params|searchParams)\s*\??\s*:\s*\{|\b(?:props|context|ctx)\s*:\s*\{\s*(?:params|searchParams)\s*\??\s*:\s*\{|\b(?:type|interface)\s+\w*(?:Props|Params|Context)\w*\s*=?\s*\{\s*(?:params|searchParams)\s*\??\s*:\s*\{/g,
    refine: (m) => ({ severity: majorSeverity(m.ctx) }),
    message: (m) => `${/searchParams\s*\??\s*:\s*\{$/.test(m.text) ? "searchParams" : "params"} is typed as a plain object in ${m.ctx.short}, but in Next.js 15+ it is a Promise. Reading its fields synchronously ${nextMajor(m.ctx) >= 16 ? "breaks in Next.js 16" : "is deprecated"}.`,
    suggestion: "Type it as Promise<{ … }> and await it: const { id } = await params;",
  },
  {
    id: "next-image-remote-wildcard",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["js"],
    view: "text",
    files: /(?:^|\/)next\.config\.[cm]?[jt]s$/,
    pattern: /\bhostname\s*:\s*["']\*{1,2}["']|\bdomains\s*:\s*\[[^\]]*["']\*/g,
    message: (m) => `next/image accepts any remote host in ${m.ctx.short}. Your image optimizer becomes an open proxy: anyone can make your server fetch and resize arbitrary URLs at your expense.`,
    suggestion: "List the exact hostnames you load images from in images.remotePatterns.",
  },
  {
    id: "next-ignore-build-errors",
    category: "quality",
    severity: "medium",
    confidence: 0.9,
    langs: ["js"],
    view: "code",
    files: /(?:^|\/)next\.config\.[cm]?[jt]s$/,
    pattern: /\bignoreBuildErrors\s*:\s*true|\bignoreDuringBuilds\s*:\s*true/g,
    message: (m) => `${m.text.includes("ignoreBuildErrors") ? "TypeScript" : "ESLint"} errors are ignored during production builds in ${m.ctx.short}, so broken code deploys.`,
    suggestion: "Remove the flag and fix the errors (or run typecheck/lint as a required CI step if you need fast builds).",
  },
  {
    id: "electron-insecure-webpreferences",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["js"],
    view: "code",
    when: ELECTRON,
    pattern: /\b(?:nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|webSecurity\s*:\s*false|allowRunningInsecureContent\s*:\s*true|enableRemoteModule\s*:\s*true|sandbox\s*:\s*false)/g,
    refine: (m) => (/sandbox/.test(m.text) ? { severity: "medium" } : true),
    message: (m) => `Electron window created with \`${m.text.replace(/\s+/g, " ")}\` in ${m.ctx.short}. Any XSS in the renderer becomes full code execution on the user's machine.`,
    suggestion: "Use contextIsolation: true, nodeIntegration: false, sandbox: true and expose only narrow APIs through a preload script with contextBridge.",
  },
  {
    id: "electron-open-external",
    category: "security",
    severity: "medium",
    confidence: 0.7,
    langs: ["js"],
    view: "code",
    when: ELECTRON,
    pattern: /\bshell\s*\.\s*openExternal\s*\(/g,
    refine: (m) => !literalArg(m),
    message: (m) => `shell.openExternal() with a dynamic URL in ${m.ctx.short}. A malicious link (file://, smb://, custom protocol handlers) can launch local programs.`,
    suggestion: "Parse the URL and only open http:/https: (or an explicit allowlist of hosts).",
  },
  {
    id: "rn-insecure-token-storage",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["js"],
    view: "text",
    when: RN,
    pattern: /\bAsyncStorage\s*\.\s*setItem\s*\(\s*["'`][^"'`]*(?:token|password|secret|jwt|session|auth|credential)[^"'`]*["'`]/gi,
    message: (m) => `Sensitive value stored in AsyncStorage in ${m.ctx.short}. AsyncStorage is unencrypted plain-text storage readable on rooted/jailbroken devices and in backups.`,
    suggestion: "Store tokens with expo-secure-store or react-native-keychain (Keychain/Keystore backed).",
  },
  {
    id: "mobile-cleartext-traffic",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: "any",
    view: "raw",
    files: /AndroidManifest\.xml$|Info\.plist$|app\.json$|app\.config\.[jt]s$/,
    pattern: /usesCleartextTraffic\s*[=:]\s*["']?true|NSAllowsArbitraryLoads<\/key>\s*<true\s*\/>|"NSAllowsArbitraryLoads"\s*:\s*true/g,
    message: (m) => `Cleartext HTTP is allowed app-wide in ${m.ctx.short}. Traffic on public Wi-Fi can be read and modified.`,
    suggestion: "Disable cleartext traffic globally and, if unavoidable, allow it only for specific debug hosts.",
  },
  {
    id: "rn-webview-any-origin",
    category: "security",
    severity: "medium",
    confidence: 0.75,
    langs: ["js"],
    view: "text",
    when: RN,
    pattern: /\boriginWhitelist\s*=\s*\{\s*\[\s*["']\*["']\s*\]\s*\}/g,
    message: (m) => `WebView in ${m.ctx.short} navigates to any origin. Combined with injected JavaScript or postMessage bridges, a hostile page gets access to native capabilities.`,
    suggestion: "Restrict originWhitelist to the domains you control and validate every onMessage payload.",
  },
  {
    id: "extension-broad-host-permissions",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["json"],
    view: "text",
    files: /(?:^|\/)manifest\.json$/,
    when: (ctx) => /"manifest_version"\s*:/.test(ctx.text),
    pattern: /"<all_urls>"|"\*:\/\/\*\/\*"|"(?:debugger|nativeMessaging|management|proxy|webRequestBlocking|history|clipboardRead|cookies)"/g,
    refine: (m) => (/all_urls|\*:\/\//.test(m.text) ? true : { severity: "low" }),
    message: (m) => `Extension requests ${m.text} in ${m.ctx.short}. Broad permissions turn any bug or compromised update into access to every site the user visits (and get extensions rejected or flagged by stores).`,
    suggestion: "Request the narrowest host permissions possible, prefer activeTab and optional_permissions requested at runtime.",
  },
  {
    id: "extension-csp-unsafe-eval",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["json"],
    view: "text",
    files: /(?:^|\/)manifest\.json$/,
    when: (ctx) => /"manifest_version"\s*:/.test(ctx.text),
    pattern: /"content_security_policy"[\s\S]{0,300}?unsafe-eval/g,
    message: (m) => `Extension CSP allows 'unsafe-eval' in ${m.ctx.short}, re-enabling eval-style code execution in privileged extension pages.`,
    suggestion: "Remove 'unsafe-eval' and replace eval/new Function usage with static code.",
  },
  {
    id: "fastapi-cors-credentials-wildcard",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["py"],
    view: "text",
    cls: "cors",
    pattern: /allow_origins\s*=\s*\[\s*["']\*["']\s*\][\s\S]{0,300}?allow_credentials\s*=\s*True|allow_credentials\s*=\s*True[\s\S]{0,300}?allow_origins\s*=\s*\[\s*["']\*["']\s*\]/g,
    message: (m) => `CORSMiddleware allows every origin with credentials in ${m.ctx.short}. Any website can make authenticated requests on behalf of logged-in users.`,
    suggestion: "List the exact front-end origins in allow_origins when allow_credentials=True.",
  },
  {
    id: "django-csrf-exempt",
    category: "security",
    severity: "medium",
    confidence: 0.75,
    langs: ["py"],
    view: "code",
    pattern: /@csrf_exempt\b/g,
    message: (m) => `CSRF protection disabled on a view in ${m.ctx.short}. If the view uses session cookies, any site can submit requests as the logged-in user.`,
    suggestion: "Remove @csrf_exempt for cookie-authenticated views; for webhooks, verify the provider's signature instead.",
  },
  {
    id: "django-insecure-cookies",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["py"],
    view: "code",
    pattern: /\b(?:SESSION|CSRF)_COOKIE_SECURE\s*=\s*False\b|\bSESSION_COOKIE_HTTPONLY\s*=\s*False\b/g,
    message: (m) => `\`${m.text}\` in ${m.ctx.short} lets session/CSRF cookies travel over HTTP or be read by JavaScript.`,
    suggestion: "Set SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True in production settings.",
  },
  {
    id: "express-rate-limit-no-trust-proxy",
    category: "security",
    severity: "low",
    confidence: 0.55,
    langs: ["js"],
    view: "code",
    when: (ctx) => "express" in ctx.project.deps || /from\s+["']express["']|require\s*\(\s*["']express["']\s*\)/.test(ctx.text),
    pattern: /\brateLimit\s*\(/g,
    refine: (m) => !/trust proxy/.test(m.ctx.text),
    message: (m) => `Express rate limiter in ${m.ctx.short} without app.set("trust proxy", …). Behind a load balancer every request appears to come from the proxy's IP, so all users share one bucket.`,
    suggestion: "Set app.set(\"trust proxy\", 1) (the number of proxies in front of the app) when deployed behind a reverse proxy.",
  },
  {
    id: "gha-action-input-injection",
    category: "security",
    severity: "medium",
    confidence: 0.7,
    langs: ["yaml"],
    view: "code",
    files: /(?:^|\/)action\.ya?ml$/,
    pattern: /\$\{\{\s*inputs\.[\w-]+\s*\}\}/g,
    refine: (m) => /^\s*(?:-\s*)?run\s*:|^\s{6,}\S/.test(m.lineText),
    message: (m) => `Composite action interpolates \`${m.text}\` directly into a shell script in ${m.ctx.short}. Workflows passing untrusted values (PR titles, branch names) get script injection.`,
    suggestion: "Map inputs to environment variables (env: VALUE: ${{ inputs.value }}) and reference \"$VALUE\" in the script.",
  },
];
