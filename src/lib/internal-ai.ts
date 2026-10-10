
import type { CodeReviewResult, CodeReviewFinding } from "@/app/api/ai/code-review/route";
import type { RepoScanResult, RepoScanFinding } from "@/app/api/ai/repo-scan/route";
import {
  analyzeFileCtx,
  buildFileCtx,
  callArgsAt,
  EMPTY_PROJECT,
  isDiscardedExpression,
  findClose,
  fileRole,
  SEVERITY_RANK,
  mergeByClass,
  type EngineFinding,
  type FileCtx,
  type FileRole,
  type Lang,
  type PatternRule,
  type ProjectCtx,
  type Refinement,
  type RuleFix,
  type RuleMatch,
  type RulePacks,
  type Severity,
} from "@/lib/internal-ai-engine";
import {
  INFRA_RULES,
  JS_EXTRA_RULES,
  LANGUAGE_RULES,
  SECRET_RULES,
  STRUCTURAL_CHECKS,
  TAINT_SINKS,
} from "@/lib/internal-ai-rules";
import { analyzeProjectGraph, type GraphResult } from "@/lib/internal-ai-graph";
import {
  buildSurface,
  calibrateFindings,
  detectProfile,
  healthWeights,
  parsePackageJson,
  profileIssues,
  projectCtxFrom,
  type ProfileInput,
  type ScoreFactor,
} from "@/lib/internal-ai-profile";
import { STACK_CHECKS, STACK_RULES } from "@/lib/internal-ai-stacks";
import { describeCounts, groupVulnerabilities, type Vulnerability, type VulnerablePackage } from "@/lib/osv";


interface RuleScope {
  langs?: Lang[] | "any";
  view?: "code" | "text" | "raw";
  files?: RegExp;
  roles?: FileRole[];
  cls?: string;
  inStrings?: boolean;
  refine?: (m: RuleMatch) => boolean | Refinement;
}

const CODE_LANGS: Lang[] = ["js", "py", "go", "java", "rb", "php", "cs", "rs"];

const SECURITY_CONTEXT = /passw|secret|token|nonce|salt|otp|csrf|session|api[_-]?key|credential|reset|verif|invite|signature|hmac|\bauth|cookie/i;

function nearbyText(m: RuleMatch, radius = 2): string {
  const lines: string[] = [];
  for (let l = Math.max(1, m.aline - radius); l <= Math.min(m.ctx.lines.count, m.aline + radius); l++) {
    lines.push(m.ctx.lines.lineText(l));
  }
  return lines.join("\n");
}

function callArgsText(m: RuleMatch): string | null {
  const call = callArgsAt(m.ctx.code, m.end - 1);
  return call ? m.ctx.code.slice(call.open + 1, call.close) : null;
}

function onlyLiterals(m: RuleMatch): boolean {
  return /^[\s"'`+,]*$/.test(callArgsText(m) ?? "x");
}

function findBodyEnd(code: string, open: number): number {
  const close = findClose(code, open);
  return close < 0 ? Math.min(code.length, open + 2000) : close;
}

function staticUrlPrefix(m: RuleMatch): boolean {
  const call = callArgsAt(m.ctx.code, m.end - 1);
  if (!call || call.args.length === 0) return false;
  const a = call.args[0];
  return /^\s*(?:["']|`(?!\$\{))/.test(m.ctx.text.slice(a.start, a.start + a.text.length));
}

// ── Security rule patterns ────────────────────────────────────────────────────

interface SecurityRule extends RuleScope {
  id: string;
  pattern: RegExp;
  severity: CodeReviewFinding["severity"];
  description: (match: string, file: string) => string;
  suggestion: string;
  category: string;
  /** 0–1 confidence. Rules below 0.65 → "medium"; below 0.50 → "low". */
  confidence?: number;
  fix?: RuleFix;
}

const SECURITY_RULES: SecurityRule[] = [
  // ── Injection ──────────────────────────────────────────────────────────────
  {
    id: "sql-injection",
    pattern: /(?:query|sql|execute|db\.run|db\.query)\s*\(\s*`[^`]*\$\{[^`]*`/gi,
    severity: "high",
    description: (_, file) =>
      `SQL query built with template-literal interpolation in ${file}. Interpolated values become part of the SQL text and can rewrite the query.`,
    suggestion:
      "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [userId]). Never interpolate user input into SQL.",
    category: "security",
    confidence: 0.85,
    cls: "sqli",
    refine: (m) =>
      /\b(?:select|insert|update|delete|where|from)\b/i.test(m.text) &&
      [...m.text.matchAll(/\$\{([^}]*)\}/g)].some((h) => !/^\s*[A-Z][A-Z0-9_]*\s*$/.test(h[1])),
    fix: {
      before: `// VULNERABLE — SQL injection via string interpolation\nconst result = await db.query(\n  \`SELECT * FROM users WHERE email = '\${req.body.email}'\`\n);`,
      after: `// SAFE — parameterized query\nconst result = await db.query(\n  "SELECT * FROM users WHERE email = $1",\n  [req.body.email]\n);`,
      language: "typescript",
    },
  },
  {
    id: "command-injection",
    pattern: /(?:(?<![.\w$])|\b(?:child_process|childProcess|cp)\s*\.\s*)(?:exec|execSync|spawn|spawnSync|execFile)\s*\([^)]*(?:req\.|params\.|query\.|body\.|args\[)/g,
    severity: "critical",
    description: (_, file) =>
      `Command injection risk in ${file}: user-controlled input passed to a shell execution function.`,
    suggestion:
      "Never pass user input to exec/spawn. Use an allowlist of safe commands. Prefer child_process.execFile() with argument arrays.",
    category: "security",
    confidence: 0.88,
    view: "code",
    cls: "cmdi",
    fix: {
      before: `// VULNERABLE — user input injected into shell command\nimport { exec } from "child_process";\nexec(\`git clone \${req.body.repoUrl}\`, callback);`,
      after: `// SAFE — use execFile with argument array, validate input\nimport { execFile } from "child_process";\nconst ALLOWED_HOSTS = ["github.com", "gitlab.com"];\nconst url = new URL(req.body.repoUrl);\nif (!ALLOWED_HOSTS.includes(url.hostname)) throw new Error("Disallowed host");\nexecFile("git", ["clone", "--", url.href], callback);`,
      language: "typescript",
    },
  },
  {
    id: "eval-usage",
    pattern: /(?<![.\w$])eval\s*\(/g,
    severity: "high",
    description: (_, file) =>
      `\`eval()\` used in ${file}. Executing arbitrary code strings enables remote code execution.`,
    suggestion:
      "Replace eval() with safer alternatives: JSON.parse() for data, a proper AST/template engine for logic.",
    category: "security",
    confidence: 0.90,
    view: "code",
    cls: "code",
    refine: (m) => !onlyLiterals(m),
    fix: {
      before: `// DANGEROUS — arbitrary code execution\nconst result = eval(userInput);\nconst data = eval("(" + jsonString + ")");`,
      after: `// SAFE — use purpose-built parsers\nconst data = JSON.parse(jsonString); // for JSON\n// For math expressions: use mathjs or expr-eval\nimport { evaluate } from "mathjs";\nconst result = evaluate(sanitizedExpression);`,
      language: "typescript",
    },
  },
  // ── XSS ───────────────────────────────────────────────────────────────────
  {
    id: "dangerous-innerhtml",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:([^}]*)\}/g,
    severity: "medium",
    description: (_, file) =>
      `\`dangerouslySetInnerHTML\` renders unescaped HTML in ${file}. If any part of the content can come from users or third parties, this is an XSS vector.`,
    suggestion:
      "Sanitize with DOMPurify: { __html: DOMPurify.sanitize(content) }. Or use a safe markdown renderer.",
    category: "security",
    confidence: 0.75,
    view: "code",
    cls: "xss",
    refine: (m) => {
      const value = m.groups[0] ?? "";
      if (/sanitize|purify|DOMPurify|escape|xss\s*\(/i.test(value) || /^[\s"'`]*$/.test(value)) return false;
      return /JSON\s*\.\s*stringify/.test(value) ? { severity: "low", confidence: 0.5 } : true;
    },
    fix: {
      before: `// VULNERABLE — raw HTML from user/API injected directly\n<div dangerouslySetInnerHTML={{ __html: userComment }} />`,
      after: `// SAFE — sanitize before rendering\nimport DOMPurify from "dompurify";\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userComment) }} />\n// Or use a safe markdown renderer:\nimport ReactMarkdown from "react-markdown";\n<ReactMarkdown>{userComment}</ReactMarkdown>`,
      language: "tsx",
    },
  },
  {
    id: "innerhtml-assignment",
    pattern: /\.innerHTML\s*=(?!=)([^;\n]*)/g,
    severity: "medium",
    description: (_, file) =>
      `Direct innerHTML assignment in ${file}. Assigning unescaped HTML to innerHTML creates XSS vulnerabilities.`,
    suggestion:
      "Use textContent for plain text. For HTML, sanitize with DOMPurify before assigning to innerHTML.",
    category: "security",
    confidence: 0.75,
    view: "code",
    cls: "xss",
    refine: (m) => {
      const rhs = m.groups[0] ?? "";
      return !/^[\s"'`]*;?$/.test(rhs) && !/sanitize|purify|DOMPurify|escape/i.test(rhs);
    },
    fix: {
      before: `// VULNERABLE\ndocument.getElementById("output").innerHTML = apiResponse.html;`,
      after: `// SAFE — plain text\ndocument.getElementById("output").textContent = apiResponse.text;\n// Or for HTML with sanitization:\nimport DOMPurify from "dompurify";\ndocument.getElementById("output").innerHTML = DOMPurify.sanitize(apiResponse.html);`,
      language: "typescript",
    },
  },
  // ── SSRF ──────────────────────────────────────────────────────────────────
  {
    id: "ssrf-risk",
    pattern: /(?:(?<![.\w$])fetch|axios\.get|axios\.post|http\.get|https\.get)\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)\b/g,
    severity: "high",
    description: (_, file) =>
      `Potential SSRF in ${file}: user-controlled input used in an outbound HTTP request URL.`,
    suggestion:
      "Validate request URLs against an allowlist of trusted domains. Never forward raw user-supplied URLs.",
    category: "security",
    confidence: 0.80,
    view: "code",
    cls: "ssrf",
    refine: (m) => !m.ctx.isClient && !staticUrlPrefix(m),
    fix: {
      before: `// VULNERABLE — user-supplied URL forwarded directly\napp.post("/proxy", async (req, res) => {\n  const data = await fetch(req.body.url);\n  res.json(await data.json());\n});`,
      after: `// SAFE — allowlist validation\nconst ALLOWED_ORIGINS = ["https://api.trusted.com", "https://cdn.example.com"];\napp.post("/proxy", async (req, res) => {\n  const url = new URL(req.body.url); // throws on invalid URL\n  if (!ALLOWED_ORIGINS.some(o => req.body.url.startsWith(o))) {\n    return res.status(400).json({ error: "Disallowed URL" });\n  }\n  const data = await fetch(url.href);\n  res.json(await data.json());\n});`,
      language: "typescript",
    },
  },
  // ── Cryptography ──────────────────────────────────────────────────────────
  {
    id: "weak-crypto-md5",
    pattern: /createHash\s*\(\s*['"]md5['"]\s*\)/gi,
    severity: "high",
    description: (_, file) =>
      `MD5 hashing used in ${file}. MD5 is cryptographically broken and must not be used for passwords or data integrity.`,
    suggestion:
      "Use SHA-256 or SHA-512: crypto.createHash('sha256'). For passwords specifically, use bcrypt, argon2, or scrypt. MD5 is acceptable only for non-security checksums (cache keys, ETags, Gravatar).",
    category: "security",
    confidence: 0.95,
    cls: "crypto",
    refine: (m) => (SECURITY_CONTEXT.test(nearbyText(m)) ? true : { severity: "low", confidence: 0.5 }),
    fix: {
      before: `import crypto from "crypto";\n// WEAK — MD5 is broken\nconst hash = crypto.createHash("md5").update(data).digest("hex");`,
      after: `import crypto from "crypto";\n// STRONG — SHA-256 for checksums/data integrity\nconst hash = crypto.createHash("sha256").update(data).digest("hex");\n// For passwords — use bcrypt instead:\nimport bcrypt from "bcryptjs";\nconst hashed = await bcrypt.hash(password, 12);`,
      language: "typescript",
    },
  },
  {
    id: "weak-crypto-sha1",
    pattern: /createHash\s*\(\s*['"]sha1['"]\s*\)/gi,
    severity: "medium",
    description: (_, file) =>
      `SHA-1 hashing used in ${file}. SHA-1 is deprecated and collision-vulnerable for security purposes.`,
    suggestion:
      "Upgrade to SHA-256: crypto.createHash('sha256'). For passwords use bcrypt/argon2.",
    category: "security",
    confidence: 0.92,
    cls: "crypto",
    refine: (m) => (SECURITY_CONTEXT.test(nearbyText(m)) ? true : { severity: "low", confidence: 0.5 }),
    fix: {
      before: `const sig = crypto.createHash("sha1").update(payload).digest("hex");`,
      after: `const sig = crypto.createHash("sha256").update(payload).digest("hex");`,
      language: "typescript",
    },
  },
  {
    id: "insecure-random",
    pattern: /Math\.random\(\)/g,
    severity: "medium",
    description: (_, file) =>
      `Math.random() generates a security-sensitive value in ${file}. Its output is predictable — tokens, codes or ids built from it can be guessed.`,
    suggestion:
      "Use crypto.randomUUID() for IDs or crypto.getRandomValues() for raw bytes.",
    category: "security",
    confidence: 0.8,
    view: "code",
    cls: "random",
    refine: (m) => SECURITY_CONTEXT.test(nearbyText(m, 1)),
  },
  // ── Auth & session ─────────────────────────────────────────────────────────
  {
    id: "jwt-no-verify",
    pattern: /jwt\.decode\s*\(/g,
    severity: "high",
    description: (_, file) =>
      `JWT decoded without verification in ${file}. jwt.decode() does NOT verify the signature.`,
    suggestion: "Use jwt.verify(token, secret) — always verify the signature before trusting any claim.",
    category: "security",
    confidence: 0.75,
    view: "code",
    cls: "auth",
    fix: {
      before: `// DANGEROUS — skips signature verification entirely\nconst payload = jwt.decode(token);\nif (payload.role === "admin") grantAccess();`,
      after: `// SAFE — verifies signature before trusting claims\ntry {\n  const payload = jwt.verify(token, process.env.JWT_SECRET, {\n    algorithms: ["HS256"],\n  });\n  if (payload.role === "admin") grantAccess();\n} catch (err) {\n  return res.status(401).json({ error: "Invalid token" });\n}`,
      language: "typescript",
    },
  },
  {
    id: "timing-attack",
    pattern: /(?:password|token|secret|hash)\s*===?\s*(?:req\.|params\.|body\.|query\.|\w+password|\w+token)/gi,
    severity: "medium",
    description: (_, file) =>
      `Direct string comparison of secrets in ${file}. Non-constant-time comparisons enable timing side-channel attacks.`,
    suggestion:
      "Use crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) for all secret comparisons.",
    category: "security",
    confidence: 0.70,
    view: "code",
    refine: (m) => !m.ctx.isClient && !/confirm|repeat|retype|\.length/i.test(m.lineText),
    fix: {
      before: `// VULNERABLE — timing oracle leaks length/prefix info\nif (req.body.token === storedToken) { grantAccess(); }`,
      after: `// SAFE — constant-time comparison\nimport crypto from "crypto";\nconst a = Buffer.from(req.body.token);\nconst b = Buffer.from(storedToken);\nif (a.length === b.length && crypto.timingSafeEqual(a, b)) { grantAccess(); }`,
      language: "typescript",
    },
  },
  {
    id: "insecure-cookie",
    pattern: /(?:cookie|setCookie|cookies\.set)\s*\([^)]*(?:httpOnly\s*:\s*false|secure\s*:\s*false)/gi,
    severity: "high",
    description: (_, file) =>
      `Insecure cookie configuration in ${file}: httpOnly or secure flag explicitly disabled.`,
    suggestion:
      "Always set httpOnly: true (prevents JS access) and secure: true (HTTPS only). Add sameSite: 'strict' or 'lax'.",
    category: "security",
    confidence: 0.88,
    fix: {
      before: `res.cookie("session", token, {\n  httpOnly: false,  // accessible to JS — XSS steals this\n  secure: false,    // sent over HTTP — MITM can intercept\n});`,
      after: `res.cookie("session", token, {\n  httpOnly: true,        // JS cannot read this cookie\n  secure: true,          // HTTPS only\n  sameSite: "strict",    // no cross-site sending\n  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days\n});`,
      language: "typescript",
    },
  },
  // ── Network & CORS ─────────────────────────────────────────────────────────
  {
    id: "cors-wildcard",
    pattern: /(?:origin|Access-Control-Allow-Origin)\s*[:=]\s*["']\*["']/gi,
    severity: "medium",
    cls: "cors",
    description: (_, file) =>
      `CORS wildcard origin in ${file}. Fine for genuinely public, unauthenticated APIs — anywhere else it lets every website read your responses.`,
    suggestion:
      "Specify an explicit allowlist: origin: ['https://yourdomain.com']. Never use '*' with credentialed requests.",
    category: "security",
    confidence: 0.85,
    fix: {
      before: `app.use(cors({ origin: "*" })); // any site can call your API with user credentials`,
      after: `const ALLOWED_ORIGINS = [\n  "https://yourdomain.com",\n  "https://app.yourdomain.com",\n];\napp.use(cors({\n  origin: (origin, cb) => {\n    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);\n    else cb(new Error("Not allowed by CORS"));\n  },\n  credentials: true,\n}));`,
      language: "typescript",
    },
  },
  {
    id: "sensitive-url-params",
    pattern: /[?&](?:password|passwd|secret|client_secret|api_?key|apikey|access_token|private_key)=[^&"'\s]/gi,
    inStrings: true,
    severity: "high",
    description: (_, file) =>
      `Long-lived credential in a URL query parameter in ${file}. URL parameters appear in server logs, proxy logs, browser history and Referer headers.`,
    suggestion:
      "Send sensitive data in request body (POST) or Authorization header. Never in query strings.",
    category: "security",
    confidence: 0.80,
    fix: {
      before: `// VULNERABLE — token visible in logs, browser history, Referer\nfetch(\`/api/data?token=\${userToken}&userId=\${id}\`)`,
      after: `// SAFE — token in Authorization header, never in URL\nfetch("/api/data", {\n  headers: {\n    Authorization: \`Bearer \${userToken}\`,\n  },\n  body: JSON.stringify({ userId: id }),\n  method: "POST",\n})`,
      language: "typescript",
    },
  },
  {
    id: "hardcoded-http",
    pattern: /["']http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^"'\s]{10,}["']/gi,
    severity: "medium",
    description: (_, file) =>
      `Hardcoded HTTP (non-TLS) URL in ${file}. Unencrypted traffic exposes data to man-in-the-middle attacks.`,
    suggestion:
      "Use HTTPS for all external URLs. For development, use environment variables to configure base URLs.",
    category: "security",
    confidence: 0.72,
    langs: CODE_LANGS,
    refine: (m) =>
      !/w3\.org|xmlns|schemas?\.|purl\.org|json-schema\.org|apache\.org\/licenses|opensource\.org|example\.(?:com|org)|\.local\b|\.test\b|\.internal\b/i.test(m.text),
    fix: {
      before: `const API_BASE = "http://api.example.com/v1";`,
      after: `const API_BASE = process.env.API_BASE_URL ?? "https://api.example.com/v1";`,
      language: "typescript",
    },
  },
  // ── Prototype & injection ──────────────────────────────────────────────────
  {
    id: "prototype-pollution",
    pattern: /\.__proto__\s*=|constructor\.prototype\s*=/g,
    severity: "high",
    description: (_, file) =>
      `Prototype mutation in ${file}. Modifying Object prototypes enables prototype pollution attacks.`,
    suggestion:
      "Use Object.create(null) for plain data maps. Validate untrusted input before merging into objects.",
    category: "security",
    confidence: 0.92,
    fix: {
      before: `function merge(target, source) {\n  for (const key of Object.keys(source)) {\n    target[key] = source[key]; // attacker sends { "__proto__": { "isAdmin": true } }\n  }\n}`,
      after: `function merge(target: Record<string, unknown>, source: Record<string, unknown>) {\n  for (const key of Object.keys(source)) {\n    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;\n    target[key] = source[key];\n  }\n}\n// Or use structuredClone / lodash.mergeWith with prototype check`,
      language: "typescript",
    },
  },
  {
    id: "redos-risk",
    pattern: /new RegExp\s*\(\s*(?:req\.|params\.|query\.|body\.|searchParams\.get|formData\.get)/g,
    severity: "high",
    description: (_, file) =>
      `User-controlled RegExp construction in ${file}. Attacker-supplied patterns can cause catastrophic backtracking (ReDoS).`,
    suggestion:
      "Never construct RegExp from user input. Use a fixed pattern with user input as a literal string match.",
    category: "security",
    confidence: 0.85,
    view: "code",
    cls: "redos",
    refine: (m) => {
      const call = callArgsAt(m.ctx.code, m.ctx.code.indexOf("(", m.index));
      return !call || !isDiscardedExpression(m.ctx.code, m.index, call.close);
    },
    fix: {
      before: `// VULNERABLE — attacker sends catastrophic regex like (a+)+$\nconst re = new RegExp(req.query.pattern);\nconst match = content.match(re);`,
      after: "// SAFE — treat user input as a literal string, not a pattern\nconst escaped = req.query.pattern.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\");\nconst re = new RegExp(escaped);\nconst match = content.match(re);\n// Or use safe-regex to validate patterns if regex input is required",
      language: "typescript",
    },
  },
  // ── File system ────────────────────────────────────────────────────────────
  {
    id: "path-traversal",
    pattern: /(?:path\.join|readFile|writeFile|createReadStream|readdir)\s*\([^)]*(?:req\.|params\.|query\.|body\.)/g,
    severity: "high",
    description: (_, file) =>
      `Path traversal risk in ${file}: user-controlled input in a file system operation.`,
    suggestion:
      "Validate file paths: use path.resolve() and assert the result starts with your allowed base directory.",
    category: "security",
    confidence: 0.85,
    view: "code",
    cls: "path",
    fix: {
      before: `// VULNERABLE — attacker sends "../../../etc/passwd"\nconst filePath = path.join(__dirname, "uploads", req.params.filename);\nconst data = fs.readFileSync(filePath);`,
      after: `import path from "path";\nconst UPLOADS_DIR = path.resolve(__dirname, "uploads");\nconst requested = path.resolve(UPLOADS_DIR, req.params.filename);\n// Ensure resolved path is within the allowed directory\nif (!requested.startsWith(UPLOADS_DIR + path.sep)) {\n  return res.status(400).json({ error: "Invalid file path" });\n}\nconst data = fs.readFileSync(requested);`,
      language: "typescript",
    },
  },
  // ── Info disclosure ────────────────────────────────────────────────────────
  {
    id: "console-log-secret",
    pattern: /console\.(?:log|debug|info|warn|error)\s*\([^)]*\b(?:password|passwd|secret|token|apiKey|api_key|privateKey|accessToken|refreshToken|clientSecret|credentials?|authorization|cookie)\b/gi,
    severity: "high",
    description: (_, file) =>
      `Sensitive value logged to console in ${file}. Credentials in logs are exposed in log aggregators and stdout.`,
    suggestion: "Remove sensitive values from logs. Use a structured logger with field masking for any secrets.",
    category: "security",
    confidence: 0.75,
    view: "code",
    refine: (m) =>
      !/!!\s*\w+|typeof\s+\w+|\.length\b|Boolean\s*\(/.test(m.text) &&
      !/^\s*\??\.\s*(?:id|sub|email|name|type|exp|iat|length|userId|role|provider|expiresAt)\b/.test(m.ctx.code.slice(m.end, m.end + 20)),
    fix: {
      before: `console.log("User login:", { email, password, token }); // exposes credentials in logs`,
      after: `// Log only non-sensitive fields\nconsole.log("User login:", { email }); // never log password or token\n// Use a structured logger that redacts secrets automatically:\nimport pino from "pino";\nconst logger = pino({ redact: ["password", "token", "secret"] });\nlogger.info({ email, password }, "login"); // password will be [Redacted]`,
      language: "typescript",
    },
  },
  {
    id: "open-redirect",
    pattern: /res\.redirect\s*\(\s*req\.(?:query|body|params)/g,
    severity: "high",
    description: (_, file) =>
      `Open redirect in ${file}: redirecting to a user-controlled URL enables phishing.`,
    suggestion:
      "Validate redirect targets against an explicit allowlist of trusted domains.",
    category: "security",
    confidence: 0.88,
    view: "code",
    cls: "redirect",
    fix: {
      before: `// VULNERABLE — attacker crafts: /redirect?to=https://evil.com\napp.get("/redirect", (req, res) => {\n  res.redirect(req.query.to);\n});`,
      after: `const ALLOWED_REDIRECT_PATHS = ["/dashboard", "/profile", "/settings"];\napp.get("/redirect", (req, res) => {\n  const to = req.query.to as string;\n  // Only allow relative paths we control\n  if (!ALLOWED_REDIRECT_PATHS.includes(to)) {\n    return res.redirect("/dashboard");\n  }\n  res.redirect(to);\n});`,
      language: "typescript",
    },
  },
  // ── XML ────────────────────────────────────────────────────────────────────
  {
    id: "xxe-injection",
    pattern: /\bnoent\s*:\s*true\b/g,
    severity: "high",
    description: (_, file) =>
      `XML parsed with external entity expansion enabled (noent: true) in ${file}. Untrusted XML can read local files (file:///etc/passwd) or trigger SSRF.`,
    suggestion: "Remove noent: true. Parse untrusted XML with entity expansion disabled (libxmljs defaults) or use fast-xml-parser.",
    category: "security",
    confidence: 0.85,
    view: "code",
    cls: "xxe",
    fix: {
      before: `const doc = libxmljs.parseXml(req.body, { noent: true }); // resolves external entities`,
      after: `const doc = libxmljs.parseXml(req.body, { noent: false, nonet: true });`,
      language: "typescript",
    },
  },
  // ── npm / supply chain ─────────────────────────────────────────────────────
  {
    id: "unsafe-npm-scripts",
    pattern: /npm install\s+(?:--unsafe-perm|--allow-root)/gi,
    severity: "medium",
    description: (_, file) =>
      `Unsafe npm flag in ${file}: --unsafe-perm or --allow-root disables npm's permission safety model.`,
    suggestion:
      "Remove these flags. If running as root is required, configure the container/environment to run as a non-root user.",
    category: "security",
    confidence: 0.90,
    langs: "any",
    fix: {
      before: `# Dockerfile\nRUN npm install --unsafe-perm`,
      after: `# Dockerfile — run as non-root user instead\nRUN addgroup -S appgroup && adduser -S appuser -G appgroup\nUSER appuser\nRUN npm install`,
      language: "bash",
    },
  },
  // ── NoSQL Injection ────────────────────────────────────────────────────────
  {
    id: "nosql-injection",
    pattern: /\.(?:find|findOne|findOneAndUpdate|findOneAndDelete|updateOne|updateMany|deleteOne|deleteMany|countDocuments)\s*\(\s*\{[^}]*\breq\.(?:body|query|params)\b[^}]*\}/g,
    severity: "high",
    view: "code",
    cls: "nosqli",
    refine: (m) => /mongoose|mongodb|\.collection\s*\(/.test(m.ctx.text),
    description: (_, file) =>
      `NoSQL injection risk in ${file}: user-controlled input passed directly into a MongoDB/Mongoose query object. Operators like \`$where\`, \`$gt\`, \`$ne\` can bypass authentication.`,
    suggestion:
      "Validate and sanitize all query params. Use mongoose-sanitize or strip MongoDB operators: const safe = JSON.parse(JSON.stringify(input).replace(/\\$[a-z]+/g, ''))",
    category: "security",
    confidence: 0.82,
    fix: {
      before: `// VULNERABLE — attacker sends: { "username": { "$ne": null }, "password": { "$ne": null } }\nconst user = await User.findOne({ username: req.body.username, password: req.body.password });`,
      after: `import mongoSanitize from "express-mongo-sanitize";\n// Apply middleware globally\napp.use(mongoSanitize());\n// Or sanitize manually:\nconst { username, password } = req.body;\n// Validate types — MongoDB operators start with $\nif (typeof username !== "string" || typeof password !== "string") {\n  return res.status(400).json({ error: "Invalid input" });\n}\nconst user = await User.findOne({ username, password: hashedPassword });`,
      language: "typescript",
    },
  },
  // ── LDAP Injection ─────────────────────────────────────────────────────────
  {
    id: "ldap-injection",
    pattern: /ldap(?:js|search|bind|client)\s*[.(][^)]*(?:req\.|params\.|query\.|body\.)/gi,
    severity: "high",
    description: (_, file) =>
      `LDAP injection risk in ${file}: user-supplied input used in LDAP query construction without escaping.`,
    suggestion:
      "Escape special LDAP characters: replace (, ), *, /, \\\\, NUL with their escaped equivalents before including in a filter string.",
    category: "security",
    confidence: 0.78,
    fix: {
      before: `// VULNERABLE — attacker sends: *)(uid=*))(|(uid=*\nconst filter = \`(uid=\${req.body.username})\`;\nclient.search(baseDN, { filter }, callback);`,
      after: `function escapeLdap(input: string): string {\n  return input.replace(/[\\\\*()\\0/]/g, (c) => \`\\\\\${c.charCodeAt(0).toString(16).padStart(2, "0")}\`);\n}\nconst safeUsername = escapeLdap(req.body.username);\nconst filter = \`(uid=\${safeUsername})\`;\nclient.search(baseDN, { filter }, callback);`,
      language: "typescript",
    },
  },
  // ── HTTP Header Injection / CRLF ──────────────────────────────────────────
  {
    id: "header-injection",
    pattern: /res\.(?:setHeader|header)\s*\([^)]*(?:req\.|params\.|query\.|body\.)[^)]*\)/g,
    severity: "medium",
    description: (_, file) =>
      `User-controlled input set directly in a response header in ${file}. Reflected header values enable cache poisoning and, on older runtimes or proxies, response splitting.`,
    suggestion:
      "Sanitize header values: strip \\r, \\n, and null bytes before calling setHeader. Validate against an allowlist where possible.",
    category: "security",
    confidence: 0.6,
    view: "code",
    fix: {
      before: `// VULNERABLE — attacker injects \\r\\n to split the HTTP response\nres.setHeader("X-Custom-Header", req.query.value);`,
      after: `// SAFE — strip CRLF and null bytes before setting header\nconst safeValue = String(req.query.value)\n  .replace(/[\\r\\n\\0]/g, "")\n  .slice(0, 200); // also cap length\nres.setHeader("X-Custom-Header", safeValue);`,
      language: "typescript",
    },
  },
  // ── JWT Algorithm Confusion ────────────────────────────────────────────────
  {
    id: "jwt-algorithm-none",
    pattern: /(?:algorithm|algorithms)\s*:\s*['"]none['"]/gi,
    severity: "critical",
    description: (_, file) =>
      `JWT 'none' algorithm in ${file}. Accepting unsigned tokens lets any attacker forge valid JWTs with arbitrary claims.`,
    suggestion:
      "Always specify an explicit algorithm allowlist: jwt.verify(token, secret, { algorithms: ['HS256'] }). Never allow 'none'.",
    category: "security",
    confidence: 0.98,
    fix: {
      before: `// CRITICAL — accepts tokens with no signature\nconst payload = jwt.verify(token, secret, { algorithms: ["HS256", "none"] });`,
      after: `// SAFE — explicit allowlist, never 'none'\nconst payload = jwt.verify(token, process.env.JWT_SECRET!, {\n  algorithms: ["HS256"],\n  issuer: "your-app",\n  audience: "your-users",\n});`,
      language: "typescript",
    },
  },
  {
    id: "jwt-weak-secret",
    pattern: /(?:jwt\.sign|sign)\s*\([^,]+,\s*['"][^'"]{1,8}['"]/g,
    severity: "high",
    description: (_, file) =>
      `Short JWT secret detected in ${file}. Secrets under 32 characters are brute-forceable in minutes.`,
    suggestion:
      "Use a randomly generated secret of at least 32 bytes: crypto.randomBytes(32).toString('hex'). Store in environment variables.",
    category: "security",
    confidence: 0.75,
    fix: {
      before: `const token = jwt.sign({ userId }, "secret"); // 6 chars — brute-forced in seconds`,
      after: `// Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"\nconst token = jwt.sign(\n  { userId },\n  process.env.JWT_SECRET!, // 64-char hex string in .env\n  { expiresIn: "15m", algorithm: "HS256" }\n);`,
      language: "typescript",
    },
  },
  // ── Server-side Template Injection ────────────────────────────────────────
  {
    id: "template-injection",
    pattern: /(?:ejs\.render|pug\.render|handlebars\.compile|nunjucks\.renderString|mustache\.render)\s*\([^)]*(?:req\.|params\.|query\.|body\.)/gi,
    severity: "critical",
    description: (_, file) =>
      `Server-side template injection (SSTI) in ${file}: user input passed directly to a template engine renderer. This enables remote code execution.`,
    suggestion:
      "Never render user input as a template. Pass user data as template variables: ejs.render('<%= name %>', { name: req.body.name })",
    category: "security",
    confidence: 0.88,
    view: "code",
    cls: "ssti",
    fix: {
      before: `// CRITICAL RCE — attacker sends: <%= process.mainModule.require('child_process').execSync('id') %>\nconst html = ejs.render(req.body.template, { user });`,
      after: `// SAFE — user data as variables, not as the template itself\nconst TEMPLATE = "<h1>Hello <%= name %></h1><p><%= message %></p>";\nconst html = ejs.render(TEMPLATE, {\n  name: req.body.name,    // data only\n  message: req.body.message, // data only\n});`,
      language: "typescript",
    },
  },
  // ── Deserialization ────────────────────────────────────────────────────────
  {
    id: "unsafe-deserialize",
    pattern: /\bserialize\s*\.\s*unserialize\s*\(|(?<![.\w$])unserialize\s*\(|require\s*\(\s*["']node-serialize["']\s*\)|from\s+["']node-serialize["']/g,
    severity: "critical",
    description: (_, file) =>
      `Unsafe deserialization in ${file}. node-serialize style deserializers execute functions embedded in the payload (remote code execution).`,
    suggestion:
      "Use JSON.parse() for data interchange and validate the result with a schema. Never deserialize untrusted data with function support.",
    category: "security",
    confidence: 0.88,
    view: "text",
    cls: "deser",
    fix: {
      before: `// CRITICAL — node-serialize executes embedded JavaScript functions\nconst data = serialize.unserialize(req.body.data);\n// Python: pickle.loads(user_data) — executes arbitrary code`,
      after: `// SAFE — use JSON for all data interchange\nconst data = JSON.parse(req.body.data);\n// For YAML config files (not user input):\nimport yaml from "js-yaml";\nconst config = yaml.load(fs.readFileSync("config.yaml", "utf8"), {\n  schema: yaml.DEFAULT_SAFE_SCHEMA, // no JS types\n});`,
      language: "typescript",
    },
  },
  // ── GraphQL Security ───────────────────────────────────────────────────────
  {
    id: "graphql-introspection",
    pattern: /introspection\s*:\s*true/gi,
    severity: "medium",
    description: (_, file) =>
      `GraphQL introspection enabled in ${file}. Introspection exposes your full schema to attackers, aiding reconnaissance.`,
    suggestion:
      "Disable in production: { introspection: process.env.NODE_ENV !== 'production' }. Use persisted queries instead.",
    category: "security",
    confidence: 0.80,
    fix: {
      before: `const server = new ApolloServer({\n  typeDefs,\n  resolvers,\n  introspection: true, // exposes full schema in production\n});`,
      after: `const server = new ApolloServer({\n  typeDefs,\n  resolvers,\n  introspection: process.env.NODE_ENV !== "production",\n  plugins: [ApolloServerPluginLandingPageDisabled()], // disable playground in prod\n});`,
      language: "typescript",
    },
  },
  {
    id: "graphql-depth-limit",
    pattern: /\b(?:new\s+ApolloServer|createYoga|createHandler|graphqlHTTP|createSchema)\s*\(/g,
    severity: "medium",
    view: "code",
    refine: (m) => !/depthLimit|queryComplexity|complexity|maxDepth|costAnalysis|armor|useDepthLimit/i.test(m.ctx.text),
    description: (_, file) =>
      `GraphQL server in ${file} without visible depth/complexity limiting. Deeply nested queries can DoS the server.`,
    suggestion:
      "Add graphql-depth-limit and graphql-query-complexity: validationRules: [depthLimit(7), createComplexityRule({ maximumComplexity: 1000 })]",
    category: "security",
    confidence: 0.60,
    fix: {
      before: `const server = new ApolloServer({ typeDefs, resolvers }); // no depth or complexity limits`,
      after: `import depthLimit from "graphql-depth-limit";\nimport { createComplexityLimitRule } from "graphql-validation-complexity";\nconst server = new ApolloServer({\n  typeDefs,\n  resolvers,\n  validationRules: [\n    depthLimit(7),                           // prevent deeply nested queries\n    createComplexityLimitRule(1000),         // prevent expensive queries\n  ],\n});`,
      language: "typescript",
    },
  },
  // ── IDOR / Missing Authorization ──────────────────────────────────────────
  {
    id: "idor-risk",
    pattern: /(?:findById|findByPk|findUnique)\s*\([^)]*(?:req\.params|params\.id|query\.id|body\.id)\s*\)/g,
    severity: "medium",
    description: (_, file) =>
      `Potential Insecure Direct Object Reference (IDOR) in ${file}: resource fetched by user-supplied ID without visible ownership check.`,
    suggestion:
      "Always filter by both the resource ID AND the authenticated user: prisma.post.findUnique({ where: { id, userId: session.user.id } })",
    category: "security",
    confidence: 0.65,
    view: "code",
    cls: "authz",
    refine: (m) => !/userId|ownerId|authorId|organizationId|teamId|session\.user|currentUser|\.can\(|authorize/i.test(nearbyText(m, 6)),
    fix: {
      before: `// VULNERABLE — any user can read any post by guessing the ID\nconst post = await prisma.post.findUnique({\n  where: { id: req.params.id },\n});`,
      after: `// SAFE — ownership enforced at the query level\nconst post = await prisma.post.findUnique({\n  where: {\n    id: req.params.id,\n    userId: session.user.id, // only returns if this user owns it\n  },\n});\nif (!post) return res.status(404).json({ error: "Not found" }); // same error for security`,
      language: "typescript",
    },
  },
  // ── Clickjacking ──────────────────────────────────────────────────────────
  {
    id: "missing-xframe",
    pattern: /(?:headers|setHeader)\s*\(\s*['"]X-Frame-Options['"]\s*,\s*['"]ALLOWALL['"]/gi,
    severity: "medium",
    description: (_, file) =>
      `X-Frame-Options set to ALLOWALL in ${file}. This permits clickjacking attacks where your page is embedded in a malicious iframe.`,
    suggestion:
      "Set X-Frame-Options: DENY or SAMEORIGIN, or use Content-Security-Policy: frame-ancestors 'none'.",
    category: "security",
    confidence: 0.90,
    fix: {
      before: `res.setHeader("X-Frame-Options", "ALLOWALL"); // page can be embedded anywhere`,
      after: `res.setHeader("X-Frame-Options", "DENY");\n// Or use CSP (modern, more flexible):\nres.setHeader("Content-Security-Policy", "frame-ancestors 'none'");`,
      language: "typescript",
    },
  },
  // ── Session fixation ──────────────────────────────────────────────────────
  {
    id: "session-fixation",
    pattern: /req\.session\.id\s*=|session\[['"]id['"]\]\s*=/g,
    severity: "high",
    description: (_, file) =>
      `Session ID manually assigned in ${file}. Manually setting session IDs enables session fixation attacks.`,
    suggestion:
      "Let the session library generate IDs. On login, regenerate the session: req.session.regenerate(cb) to prevent fixation.",
    category: "security",
    confidence: 0.80,
    fix: {
      before: `// VULNERABLE — attacker can pre-set a known session ID then log in as user\nreq.session.id = req.query.sessionId;\nreq.session.userId = user.id;`,
      after: `// SAFE — regenerate session on privilege escalation (login)\nreq.session.regenerate((err) => {\n  if (err) return next(err);\n  req.session.userId = user.id; // new session ID generated by library\n  req.session.save(next);\n});`,
      language: "typescript",
    },
  },
  // ── Insecure Object Spread ────────────────────────────────────────────────
  {
    id: "mass-assignment",
    pattern: /(?:create|update|upsert)\s*\(\s*\{[^}]*data\s*:\s*(?:\{\s*\.\.\.\s*)?req\.body\s*(?:,|\})/g,
    severity: "high",
    view: "code",
    cls: "mass-assign",
    description: (_, file) =>
      `Mass assignment risk in ${file}: entire request body spread into a database create/update call. Attackers can set privileged fields (role, isAdmin) they shouldn't be able to.`,
    suggestion:
      "Explicitly pick allowed fields: data: { name: body.name, email: body.email }. Never spread req.body directly into database operations.",
    category: "security",
    confidence: 0.78,
    fix: {
      before: `// VULNERABLE — attacker sends { "role": "admin", "isVerified": true }\nawait prisma.user.update({ where: { id }, data: req.body });`,
      after: `// SAFE — explicit field allowlist\nconst { name, bio, avatarUrl } = req.body; // only user-editable fields\nawait prisma.user.update({\n  where: { id, userId: session.user.id },\n  data: { name, bio, avatarUrl },\n  // role, isAdmin, isVerified are NEVER taken from user input\n});`,
      language: "typescript",
    },
  },
  // ── Exposed Stack Traces ──────────────────────────────────────────────────
  {
    id: "exposed-stack-trace",
    pattern: /(?:res\.json|res\.send|NextResponse\.json)\s*\(\s*\{[^}]*(?:stack|err\.stack|error\.stack)/g,
    severity: "high",
    description: (_, file) =>
      `Stack trace sent in API response in ${file}. Stack traces reveal internal paths, library versions, and code structure to attackers.`,
    suggestion:
      "Return generic errors to clients: { error: 'Internal server error' }. Log full stack server-side: console.error(err.stack).",
    category: "security",
    confidence: 0.85,
    fix: {
      before: `} catch (err: any) {\n  return res.json({ error: err.message, stack: err.stack }); // reveals internals\n}`,
      after: `} catch (err) {\n  console.error("[API Error]", err); // full details server-side only\n  return res.status(500).json({ error: "Internal server error" }); // generic to client\n}`,
      language: "typescript",
    },
  },
  // ── Weak Password Validation ──────────────────────────────────────────────
  {
    id: "weak-password-policy",
    pattern: /password\.length\s*[<>]=?\s*[1-5]\b/g,
    severity: "medium",
    description: (_, file) =>
      `Weak minimum password length enforcement in ${file}. Passwords shorter than 8 characters are trivially brute-forced.`,
    suggestion:
      "Require minimum 12 characters. Add complexity requirements. Consider using zxcvbn for strength estimation.",
    category: "security",
    confidence: 0.72,
    fix: {
      before: `if (password.length < 6) throw new Error("Password too short");`,
      after: `import { zxcvbn } from "@zxcvbn-ts/core";\nif (password.length < 12) throw new Error("Password must be at least 12 characters");\nconst strength = zxcvbn(password);\nif (strength.score < 3) throw new Error("Password is too weak. Try a passphrase.");`,
      language: "typescript",
    },
  },
  // ── Token in localStorage ─────────────────────────────────────────────────
  {
    id: "token-localstorage",
    pattern: /localStorage\.(?:setItem|getItem)\s*\([^)]*['"](?:token|jwt|auth|access_token|id_token)['"]/gi,
    severity: "high",
    description: (_, file) =>
      `Auth token stored in localStorage in ${file}. localStorage is accessible to any JavaScript on the page — XSS attacks steal the token.`,
    suggestion:
      "Store tokens in httpOnly cookies (set by the server). Never store JWTs or session tokens in localStorage or sessionStorage.",
    category: "security",
    confidence: 0.88,
    fix: {
      before: `// VULNERABLE — XSS can steal token with: document.cookie or localStorage.getItem("token")\nlocalStorage.setItem("token", res.data.accessToken);\n// Later:\nconst token = localStorage.getItem("token");`,
      after: `// SAFE — token stored in httpOnly cookie by server, never touches JS\n// Server-side (set in API route):\nres.cookie("session", token, { httpOnly: true, secure: true, sameSite: "strict" });\n// Client-side — just make requests, browser sends cookie automatically:\nconst data = await fetch("/api/protected"); // no manual token handling needed`,
      language: "typescript",
    },
  },
  // ── Unvalidated File Upload ───────────────────────────────────────────────
  {
    id: "unvalidated-file-upload",
    pattern: /(?:multer|formidable|busboy|multiparty)\s*\([^)]*\)(?![^]*(?:fileFilter|mimetype|allowedTypes|mimeTypes))/g,
    severity: "high",
    description: (_, file) =>
      `File upload without MIME type validation in ${file}. Accepting arbitrary file types enables uploading malicious scripts (PHP shells, SVG XSS).`,
    suggestion:
      "Add fileFilter: (req, file, cb) => { const allowed = ['image/jpeg','image/png']; cb(null, allowed.includes(file.mimetype)); }. Also limit size.",
    category: "security",
    confidence: 0.72,
    fix: {
      before: `const upload = multer({ dest: "uploads/" }); // accepts any file type`,
      after: `const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];\nconst MAX_SIZE = 5 * 1024 * 1024; // 5 MB\nconst upload = multer({\n  dest: "uploads/",\n  limits: { fileSize: MAX_SIZE },\n  fileFilter: (req, file, cb) => {\n    if (!ALLOWED_TYPES.includes(file.mimetype)) {\n      cb(new Error("File type not allowed"));\n    } else {\n      cb(null, true);\n    }\n  },\n});`,
      language: "typescript",
    },
  },
  // ── Data exposure ──────────────────────────────────────────────────────────
  {
    id: "debug-mode",
    pattern: /(?:DEBUG|NODE_ENV)\s*=\s*["']?(?:true|1|development|debug)["']?/g,
    severity: "low",
    description: (_, file) =>
      `Debug/development mode flag hardcoded in ${file}. Debug modes often expose stack traces and verbose errors.`,
    suggestion:
      "Use environment variables exclusively: NODE_ENV is set by your deployment platform, never hardcode it.",
    category: "security",
    confidence: 0.60,
    cls: "debug",
    fix: {
      before: `const isDev = true; // hardcoded — this reaches production\nif (isDev) showDetailedErrors();`,
      after: `const isDev = process.env.NODE_ENV === "development";\nif (isDev) showDetailedErrors(); // automatically false in production`,
      language: "typescript",
    },
  },
  // ── TLS verification disabled ─────────────────────────────────────────────
  {
    id: "tls-reject-unauthorized",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED["']?\s*[:=]\s*["']?0\b/gi,
    severity: "critical",
    langs: "any",
    cls: "tls",
    description: (_, file) =>
      `TLS certificate verification disabled in ${file}. rejectUnauthorized: false accepts any certificate including attacker-issued ones — all traffic is vulnerable to MITM interception.`,
    suggestion:
      "Remove rejectUnauthorized: false entirely (true is the default). For self-signed certs in dev, use ca: fs.readFileSync('ca.pem') to pin your own CA instead.",
    category: "security",
    confidence: 0.96,
    fix: {
      before: `https.request({\n  hostname: "api.example.com",\n  rejectUnauthorized: false, // attacker reads all traffic\n});`,
      after: `// SAFE — default rejectUnauthorized: true verifies the cert\nhttps.request({ hostname: "api.example.com" });\n// For self-signed CA in dev:\nhttps.request({ ca: fs.readFileSync("./certs/ca.pem") });`,
      language: "typescript",
    },
  },
  // ── Credentials embedded in connection URLs ───────────────────────────────
  {
    id: "credentials-in-url",
    pattern: /["'](?:https?|mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/[^:/"'\s]+:([^@/"'\s]+)@([^"'\s/:]+)/gi,
    severity: "critical",
    langs: "any",
    roles: ["source", "fixture"],
    cls: "secret",
    refine: (m) => {
      const password = m.groups[0] ?? "";
      const host = m.groups[1] ?? "";
      if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|db|postgres|mysql|redis|mongo|database)$/i.test(host)) return false;
      if (/^(?:password|passwd|pass|secret|postgres|root|admin|user|changeme|example|\$\{?\w+\}?|<[^>]+>|\*+|x+)$/i.test(password) || /[${}<>]/.test(password)) return false;
      return m.ctx.role === "source" ? true : { severity: "high", confidence: 0.7 };
    },
    description: (_, file) =>
      `Credentials embedded in a connection URL in ${file}. Passwords in URLs appear in HTTP logs, load balancer access logs, and browser history.`,
    suggestion:
      "Use separate env vars: process.env.DB_USER and process.env.DB_PASS. Build the URL from parts or pass host/user/password as separate connection options.",
    category: "security",
    confidence: 0.95,
    fix: {
      before: `const db = new Client("postgresql://admin:s3cr3tp@ss@localhost/mydb");`,
      after: `const db = new Client({\n  host: process.env.DB_HOST,\n  user: process.env.DB_USER,\n  password: process.env.DB_PASS,\n  database: process.env.DB_NAME,\n});`,
      language: "typescript",
    },
  },
  // ── UUID v1 predictability ─────────────────────────────────────────────────
  {
    id: "uuid-v1-predictable",
    pattern: /(?:uuidv1|uuid\.v1)\s*\(/gi,
    severity: "medium",
    description: (_, file) =>
      `UUID v1 used in ${file}. UUID v1 is time-based and encodes the MAC address — highly predictable. Unsuitable for session tokens, CSRF nonces, or any value that must be unguessable.`,
    suggestion:
      "Use UUID v4 (random): import { v4 as uuidv4 } from 'uuid'; or the native crypto.randomUUID() (Node 14.17+, all modern browsers).",
    category: "security",
    confidence: 0.88,
    fix: {
      before: `import { v1 as uuidv1 } from "uuid";\nconst sessionId = uuidv1(); // predictable — encodes timestamp + MAC address`,
      after: `import { v4 as uuidv4 } from "uuid";\nconst sessionId = uuidv4(); // 122 bits of cryptographic randomness\n// Or native (no package needed):\nconst sessionId = crypto.randomUUID();`,
      language: "typescript",
    },
  },
  // ── Client-side open redirect ─────────────────────────────────────────────
  {
    id: "client-redirect-injection",
    pattern: /(?:window\.location|location\.href|location\.replace|location\.assign)\s*=\s*[^;]*(?:searchParams\.get|URLSearchParams|location\.search)/gi,
    severity: "high",
    description: (_, file) =>
      `Client-side open redirect in ${file}: window.location/href set from URL parameters. Attackers craft malicious redirect URLs to steal tokens or phish users after OAuth callbacks.`,
    suggestion:
      "Allow only relative paths: if (!target.startsWith('/') || target.startsWith('//')) target = '/'. Never redirect to an arbitrary URL from a query parameter.",
    category: "security",
    confidence: 0.78,
    view: "code",
    cls: "redirect",
    refine: (m) => !/startsWith|ALLOWED|allowlist|isSafe|isAllowed/i.test(nearbyText(m, 4)),
    fix: {
      before: `// VULNERABLE — attacker: /callback?next=https://evil.com/steal-token\nconst next = new URLSearchParams(location.search).get("next");\nwindow.location.href = next;`,
      after: `const next = new URLSearchParams(location.search).get("next") ?? "/";\n// Only allow safe relative paths (no protocol-relative //)\nconst safe = next.startsWith("/") && !next.startsWith("//") ? next : "/";\nwindow.location.href = safe;`,
      language: "typescript",
    },
  },
  // ── TOCTOU in filesystem operations ──────────────────────────────────────
  {
    id: "toctou-fs",
    pattern: /existsSync\s*\([^)]+\)[^;]*\n(?:[^\n]*\n){0,4}[^\n]*(?:readFileSync|writeFileSync|readFile|writeFile|createReadStream|unlink|rename)\s*\(/gm,
    severity: "low",
    view: "code",
    description: (_, file) =>
      `TOCTOU (Time-of-Check/Time-of-Use) pattern in ${file}: file existence check followed by file operation. Another process can modify the path between the check and the use.`,
    suggestion:
      "Attempt the file operation directly and handle ENOENT. Use try/catch around readFile rather than existsSync before it — the check-then-act pattern is inherently racy.",
    category: "security",
    confidence: 0.68,
    fix: {
      before: `if (fs.existsSync(filePath)) {\n  const data = fs.readFileSync(filePath);\n}`,
      after: `try {\n  const data = await fs.promises.readFile(filePath, "utf8");\n} catch (err) {\n  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;\n  // file doesn't exist — handle gracefully\n}`,
      language: "typescript",
    },
  },
  // ── bcrypt rounds too low ─────────────────────────────────────────────────
  {
    id: "bcrypt-weak-rounds",
    pattern: /bcrypt(?:\.hash|js\.hash|\s*\.\s*hash)\s*\([^,]+,\s*[1-9]\s*\)/g,
    severity: "medium",
    description: (_, file) =>
      `bcrypt with fewer than 10 rounds in ${file}. Low cost factor makes brute-force attacks significantly faster.`,
    suggestion: "Use at least 12 rounds: bcrypt.hash(password, 12). Each increment doubles computation time. 12 rounds takes ~300ms on modern hardware — a good balance.",
    category: "security",
    confidence: 0.85,
    fix: {
      before: `const hashed = await bcrypt.hash(password, 6); // too fast — brute-forceable`,
      after: `const hashed = await bcrypt.hash(password, 12); // ~300ms — resistant to GPU attacks`,
      language: "typescript",
    },
  },
  // ── Express without security headers (helmet) ─────────────────────────────
  {
    id: "express-no-helmet",
    pattern: /express\s*\(\s*\)(?![^]*helmet)/g,
    severity: "medium",
    description: (_, file) =>
      `Express app in ${file} without helmet middleware. Missing security headers (X-Frame-Options, CSP, HSTS, etc.) leave the app exposed to common browser attacks.`,
    suggestion: "Add helmet at the top of your middleware stack: app.use(helmet()). It sets 11 security headers automatically.",
    category: "security",
    confidence: 0.60,
    fix: {
      before: `const app = express();\napp.use(express.json());\n// No security headers — X-Frame-Options, CSP, HSTS are all missing`,
      after: `import helmet from "helmet";\nconst app = express();\napp.use(helmet()); // sets X-Frame-Options, CSP, HSTS, X-Content-Type-Options, etc.\napp.use(express.json({ limit: "10mb" })); // also limit body size`,
      language: "typescript",
    },
  },
  // ── Stripe webhook without signature verification ──────────────────────────
  {
    id: "stripe-webhook-no-verify",
    pattern: /stripe\.webhooks(?!\.constructEvent)|(?:webhook|stripe_event)\s*=\s*(?:await\s+)?req\.json\s*\(\s*\)(?![^]*constructEvent)/gi,
    severity: "critical",
    description: (_, file) =>
      `Stripe webhook endpoint in ${file} without signature verification. Without verifying the webhook signature, anyone can forge webhook events (fake payments, refunds, etc.).`,
    suggestion: "Always verify the Stripe-Signature header: stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)",
    category: "security",
    confidence: 0.75,
    cls: "authz",
    refine: (m) => /stripe/i.test(m.ctx.text) && !/constructEvent/.test(m.ctx.code),
    fix: {
      before: `export async function POST(req: Request) {\n  const event = await req.json(); // anyone can POST fake events!\n  if (event.type === "payment_intent.succeeded") handlePayment(event);\n}`,
      after: `export async function POST(req: Request) {\n  const rawBody = await req.text(); // need raw body for signature\n  const sig = req.headers.get("stripe-signature")!;\n  let event;\n  try {\n    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!);\n  } catch (err) {\n    return Response.json({ error: "Invalid signature" }, { status: 400 });\n  }\n  if (event.type === "payment_intent.succeeded") await handlePayment(event.data.object);\n}`,
      language: "typescript",
    },
  },
  // ── CORS reflecting arbitrary Origin ─────────────────────────────────────
  {
    id: "cors-reflect-origin",
    pattern: /(?:Access-Control-Allow-Origin|origin)\s*[:=]\s*(?:req\.headers\.origin|request\.headers\.get\s*\(\s*['"]origin['"]\s*\)|origin\s*\?\?\s*['"])/gi,
    severity: "high",
    description: (_, file) =>
      `CORS blindly reflecting the request Origin header in ${file}. This is equivalent to a wildcard '*' with credentials — any site can make credentialed cross-origin requests to your API.`,
    suggestion: "Validate origin against an explicit allowlist before reflecting it. Deny unknown origins with a 403.",
    category: "security",
    confidence: 0.82,
    cls: "cors",
    refine: (m) => !/ALLOWED|allowlist|whitelist|allowedOrigins|\.includes\s*\(\s*origin|isAllowedOrigin/i.test(m.ctx.text),
    fix: {
      before: `// VULNERABLE — mirrors any origin back, effectively wildcard\nres.setHeader("Access-Control-Allow-Origin", req.headers.origin);\nres.setHeader("Access-Control-Allow-Credentials", "true");`,
      after: `const ALLOWED_ORIGINS = ["https://app.yourdomain.com", "https://yourdomain.com"];\nconst origin = req.headers.origin;\nif (origin && ALLOWED_ORIGINS.includes(origin)) {\n  res.setHeader("Access-Control-Allow-Origin", origin);\n  res.setHeader("Access-Control-Allow-Credentials", "true");\n  res.setHeader("Vary", "Origin");\n} else {\n  return res.status(403).json({ error: "Forbidden" });\n}`,
      language: "typescript",
    },
  },
  // ── window.postMessage without origin check ───────────────────────────────
  {
    id: "postmessage-no-origin",
    pattern: /addEventListener\s*\(\s*['"]message['"]/g,
    severity: "high",
    refine: (m) => !/\.\s*origin\b|\.\s*source\s*(?:!==|===)/.test(m.ctx.code),
    description: (_, file) =>
      `window.postMessage listener in ${file} without origin validation. Without checking event.origin, malicious pages can send messages to your app and execute logic.`,
    suggestion: "Always validate the sender: if (event.origin !== 'https://trusted.com') return; before processing postMessage data.",
    category: "security",
    confidence: 0.75,
    fix: {
      before: `window.addEventListener("message", (event) => {\n  processData(event.data); // executes for messages from ANY origin\n});`,
      after: `const TRUSTED_ORIGIN = "https://your-partner-app.com";\nwindow.addEventListener("message", (event) => {\n  if (event.origin !== TRUSTED_ORIGIN) return; // reject unknown senders\n  processData(event.data);\n});`,
      language: "typescript",
    },
  },
  // ── Missing Content-Security-Policy header ────────────────────────────────
  {
    id: "missing-csp",
    pattern: /\b(?:async\s+)?headers\s*\(\s*\)\s*\{/g,
    files: /(?:^|\/)next\.config\.[cm]?[jt]s$/,
    refine: (m) => !/content-security-policy/i.test(m.ctx.text),
    severity: "medium",
    description: (_, file) =>
      `Next.js headers configuration in ${file} without Content-Security-Policy (CSP). Without CSP, a single XSS vulnerability can compromise the entire application.`,
    suggestion: "Add a strict CSP: Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{nonce}'; Connect it to the nonce in middleware.",
    category: "security",
    confidence: 0.58,
    fix: {
      before: `// next.config.js — missing CSP means XSS can load arbitrary scripts\nasync headers() {\n  return [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] }];\n}`,
      after: `async headers() {\n  return [{\n    source: "/(.*)",\n    headers: [\n      { key: "X-Frame-Options", value: "DENY" },\n      { key: "X-Content-Type-Options", value: "nosniff" },\n      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },\n      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },\n      // Use nonce-based CSP with middleware for the best security:\n      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" },\n    ],\n  }];\n}`,
      language: "typescript",
    },
  },
  // ── Insecure file upload path ─────────────────────────────────────────────
  {
    id: "upload-path-user-controlled",
    pattern: /(?:dest|uploadDir|directory)\s*:\s*(?:req|request)\s*\.\s*(?:body|query|params)\b/gi,
    severity: "critical",
    view: "code",
    cls: "path",
    description: (_, file) =>
      `File upload destination controlled by user input in ${file}. Attackers can write files to arbitrary server paths, enabling remote code execution.`,
    suggestion: "Hardcode the upload directory: dest: path.join(process.cwd(), 'uploads'). Never derive upload paths from user input.",
    category: "security",
    confidence: 0.80,
    fix: {
      before: `const upload = multer({ dest: req.body.uploadPath }); // RCE via path control`,
      after: `import path from "path";\nconst UPLOAD_DIR = path.join(process.cwd(), "uploads"); // fixed, safe path\nconst upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 5 * 1024 * 1024 } });`,
      language: "typescript",
    },
  },
  // ── GraphQL mutation without auth ─────────────────────────────────────────
  {
    id: "graphql-mutation-no-auth",
    pattern: /\bMutation\s*:?\s*\{/g,
    severity: "high",
    view: "code",
    cls: "authz",
    refine: (m) => !/context\s*\.\s*(?:user|auth|session)|ctx\s*\.\s*(?:user|auth|session)|requireAuth|isAuthenticated|getUser|@auth\b|shield\s*\(|authDirective/i.test(m.ctx.text),
    description: (_, file) =>
      `GraphQL mutation resolver in ${file} without visible authentication check. Any caller can execute this mutation without being authenticated.`,
    suggestion: "Check auth in every mutation resolver: if (!context.user) throw new AuthenticationError('Must be logged in'). Or use a directive: @auth(requires: USER).",
    category: "security",
    confidence: 0.65,
    fix: {
      before: `const resolvers = {\n  Mutation: {\n    deleteAccount: async (_, { id }, context) => {\n      return prisma.user.delete({ where: { id } }); // no auth!\n    },\n  },\n};`,
      after: `import { AuthenticationError, ForbiddenError } from "apollo-server";\nconst resolvers = {\n  Mutation: {\n    deleteAccount: async (_, { id }, context) => {\n      if (!context.user) throw new AuthenticationError("Must be logged in");\n      if (context.user.id !== id && context.user.role !== "ADMIN") {\n        throw new ForbiddenError("Can only delete your own account");\n      }\n      return prisma.user.delete({ where: { id } });\n    },\n  },\n};`,
      language: "typescript",
    },
  },
  // ── Kubernetes secrets in plaintext ──────────────────────────────────────
  {
    id: "k8s-plaintext-secret",
    pattern: /kind\s*:\s*Secret[\s\S]{0,200}stringData\s*:|kind\s*:\s*ConfigMap[\s\S]{0,200}(?:password|secret|key|token)\s*:/gi,
    severity: "high",
    langs: ["yaml"],
    cls: "secret",
    description: (_, file) =>
      `Kubernetes Secret with plaintext data in ${file}. Kubernetes Secrets are base64-encoded, not encrypted — anyone with cluster access or in the Git history can read them.`,
    suggestion: "Use Sealed Secrets, External Secrets Operator, or Vault Agent. Never store sensitive values in ConfigMaps or unencrypted Secrets in Git.",
    category: "security",
    confidence: 0.78,
    fix: {
      before: `# kubernetes/secret.yaml — checked into Git!\napiVersion: v1\nkind: Secret\nstringData:\n  DATABASE_URL: postgres://admin:mypassword@db:5432/prod`,
      after: `# Use External Secrets Operator + AWS Secrets Manager / Vault:\napiVersion: external-secrets.io/v1beta1\nkind: ExternalSecret\nspec:\n  secretStoreRef: { name: vault-backend, kind: SecretStore }\n  target: { name: app-secrets }\n  data:\n    - secretKey: DATABASE_URL\n      remoteRef: { key: prod/app, property: database_url }`,
      language: "yaml",
    },
  },
  // ── Unsafe S3 bucket ACL ──────────────────────────────────────────────────
  {
    id: "s3-public-acl",
    pattern: /\bacl\s*[:=]\s*['"]public-read(?:-write)?['"]/gi,
    severity: "critical",
    langs: ["js", "py", "tf", "yaml", "json"],
    description: (_, file) =>
      `S3 bucket or object set to public-read ACL in ${file}. Public-read makes ALL objects in the bucket accessible by anyone on the internet.`,
    suggestion: "Remove ACL: 'public-read'. Use pre-signed URLs with short expiry for temporary access. Block public access at the S3 account level.",
    category: "security",
    confidence: 0.92,
    fix: {
      before: `await s3.putObject({\n  Bucket: "my-app-bucket",\n  Key: key,\n  Body: fileBuffer,\n  ACL: "public-read", // world-readable!`,
      after: `await s3.putObject({\n  Bucket: "my-app-bucket",\n  Key: key,\n  Body: fileBuffer,\n  // No ACL — defaults to private (bucket owner only)\n});\n// For temporary access, generate a pre-signed URL:\nconst url = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });`,
      language: "typescript",
    },
  },
];

// ── Unified quality rules ─────────────────────────────────────────────────────
// Used by both the PR reviewer and the repo scanner (no duplication).

interface QualityRule extends RuleScope {
  id: string;
  pattern: RegExp;
  severity: CodeReviewFinding["severity"];
  /** For PR review — takes (file, matchCount) */
  description: (file: string, count: number) => string;
  suggestion: string;
  /** Repo-scan label used when generating RepoScanFinding descriptions */
  scanLabel: string;
  fix?: RuleFix;
}

const QUALITY_RULES: QualityRule[] = [
  {
    id: "todo-fixme",
    pattern: /(?:\/\/|#|\/\*|^\s*\*)\s*(?:TODO|FIXME|HACK|XXX|BUG)\b/gm,
    severity: "low",
    langs: CODE_LANGS,
    view: "raw",
    description: (file, count) =>
      `${count} TODO/FIXME comment${count > 1 ? "s" : ""} in ${file}. Unresolved notes signal pending technical work.`,
    suggestion: "Convert TODOs to tracked GitHub issues. If blocking, resolve before merging.",
    scanLabel: "TODO/FIXME comments indicate incomplete or deferred work",
  },
  {
    id: "any-type",
    pattern: /:\s*any\b(?![\w$])|\bas\s+any\b|<any>/g,
    severity: "low",
    files: /\.(?:ts|tsx|mts|cts)$/,
    description: (file, count) =>
      `${count} TypeScript \`any\` type${count > 1 ? "s" : ""} in ${file}. Defeats compile-time type safety.`,
    suggestion: "Replace `any` with a specific type, `unknown` (with narrowing), or a generic type parameter.",
    scanLabel: "TypeScript 'any' type disables type checking",
    fix: {
      before: `function processData(data: any) {\n  return data.value; // no type checking — runtime crash if .value doesn't exist\n}`,
      after: `interface DataPayload { value: string; id: number; }\nfunction processData(data: DataPayload) {\n  return data.value; // type-checked at compile time\n}\n// For truly unknown external data:\nfunction processUnknown(data: unknown) {\n  if (typeof data === "object" && data !== null && "value" in data) {\n    return (data as { value: string }).value;\n  }\n}`,
      language: "typescript",
    },
  },
  {
    id: "empty-catch",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
    severity: "medium",
    langs: ["js", "java", "cs", "php"],
    view: "raw",
    description: (file) =>
      `Empty catch block in ${file}. Silently swallowing errors makes debugging nearly impossible.`,
    suggestion: "At minimum: catch(err) { console.error('[context]', err); }. Better: handle or rethrow with context.",
    scanLabel: "Empty catch blocks silently swallow errors",
    fix: {
      before: `try {\n  await riskyOperation();\n} catch (err) {\n  // completely silent — bug disappears\n}`,
      after: `try {\n  await riskyOperation();\n} catch (err) {\n  console.error("[riskyOperation] failed:", err);\n  // throw err; // re-throw if caller should handle it\n}`,
      language: "typescript",
    },
  },
  {
    id: "use-var",
    pattern: /\bvar\s+\w/g,
    severity: "low",
    description: (file, count) =>
      `${count} \`var\` declaration${count > 1 ? "s" : ""} in ${file}. var has function scope and hoisting surprises.`,
    suggestion: "Use 'const' for immutable bindings, 'let' for mutable ones. Never use 'var' in modern JS/TS.",
    scanLabel: "'var' declarations with function-scope hoisting issues",
    fix: {
      before: `var count = 0;\nvar name = getUserName();`,
      after: `const name = getUserName(); // immutable — prefer const\nlet count = 0;             // mutable — use let`,
      language: "typescript",
    },
  },
  {
    id: "ts-ignore",
    pattern: /@ts-ignore|@ts-nocheck/g,
    severity: "low",
    view: "raw",
    files: /\.(?:ts|tsx|mts|cts)$/,
    description: (file, count) =>
      `${count} TypeScript suppression${count > 1 ? "s" : ""} in ${file}. @ts-ignore hides real type errors.`,
    suggestion: "Fix the underlying type error rather than suppressing it. Use @ts-expect-error with a comment if unavoidable.",
    scanLabel: "TypeScript suppression comments hide type errors",
  },
  {
    id: "nested-ternary",
    pattern: /(?<!\?)\?(?![.?:])[^:?\n;{}]{1,80}(?<!\?)\?(?![.?:])[^:?\n;{}]{1,80}:/g,
    severity: "low",
    description: (file) =>
      `Nested ternary operators in ${file}. Hard to read and easy to get wrong.`,
    suggestion: "Refactor into a clear if/else block or a named function.",
    scanLabel: "Nested ternary operators reduce readability",
  },
  {
    id: "console-log-debug",
    pattern: /\bconsole\.(log|debug)\s*\(/g,
    severity: "low",
    refine: (m) => !/(?:^|\/)(?:scripts?|bin|cli|tools|seed)\b|\.config\.[cm]?[jt]s$/.test(m.ctx.filename),
    description: (file, count) =>
      `${count} console.log/debug call${count > 1 ? "s" : ""} in ${file}. Debug logs should not reach production.`,
    suggestion: "Remove debug logs or replace with a structured logger (pino, winston) configured by log level.",
    scanLabel: "Debug console statements left in code",
    fix: {
      before: `console.log("user data:", user);\nconsole.log("response:", response);`,
      after: `// Use a level-based logger — silent in production unless LOG_LEVEL=debug\nimport pino from "pino";\nconst logger = pino({ level: process.env.LOG_LEVEL ?? "info" });\nlogger.debug({ user }, "processing user");\nlogger.info({ status: response.status }, "request completed");`,
      language: "typescript",
    },
  },
  {
    id: "callback-hell",
    pattern: /function[^{]{0,200}\{[^}]{0,600}function[^{]{0,200}\{[^}]{0,600}function[^{]{0,200}\{/g,
    severity: "low",
    description: (file) =>
      `Deeply nested callback functions in ${file}. Callback nesting makes code hard to read and error-prone.`,
    suggestion: "Refactor to async/await or Promise chains. Extract inner callbacks to named functions.",
    scanLabel: "Callback nesting (callback hell) in function definitions",
  },
  {
    id: "commented-code",
    pattern: /^\s*\/\/\s*(?:(?:const|let|var)\s+\w+\s*=|(?:import|export)\s+[\w{*]|(?:if|for|while)\s*\(|return\s+[\w.]+\s*;|await\s+\w|[\w.]+\([^)\n]*\);\s*$)/gm,
    severity: "low",
    view: "raw",
    description: (file, count) =>
      `${count} block${count > 1 ? "s" : ""} of commented-out code in ${file}. Dead code clutters the codebase.`,
    suggestion: "Delete commented-out code. Version control (git) preserves history — you can always recover it.",
    scanLabel: "Commented-out code blocks cluttering the codebase",
  },
  {
    id: "long-parameter-list",
    pattern: /function\s+\w+\s*\(/g,
    severity: "low",
    refine: (m) => (callArgsAt(m.ctx.code, m.end - 1)?.args.length ?? 0) >= 6,
    description: (file) =>
      `Function with 6+ parameters detected in ${file}. Long parameter lists indicate a design smell.`,
    suggestion: "Group related parameters into an options object: function foo({ a, b, c, d, e }: FooOptions) {}",
    scanLabel: "Functions with too many parameters (6+) — design smell",
  },
  {
    id: "hardcoded-localhost",
    pattern: /["']https?:\/\/localhost:\d{4,5}\/[^"']{5,}["']/g,
    severity: "low",
    view: "text",
    refine: (m) => !/process\.env|import\.meta\.env|\?\?|\|\||os\.environ|getenv/.test(m.lineText),
    description: (file) =>
      `Hardcoded localhost URL in ${file}. Development URLs committed to source code will break in production.`,
    suggestion: "Use environment variables: process.env.API_BASE_URL. Never hardcode localhost in non-test code.",
    scanLabel: "Hardcoded localhost URLs that will break in production",
  },
  // ── Complexity indicators ──────────────────────────────────────────────────
  {
    id: "deep-nesting",
    pattern: /if\s*\([^)]+\)\s*\{[^{}]*if\s*\([^)]+\)\s*\{[^{}]*if\s*\([^)]+\)\s*\{[^{}]*if\s*\(/g,
    severity: "medium",
    description: (file) =>
      `4+ levels of if-nesting detected in ${file}. Deep nesting is a strong indicator of high cyclomatic complexity and makes testing and reasoning hard.`,
    suggestion: "Refactor using early returns (guard clauses), strategy pattern, or extraction to smaller functions. Each function should have one clear level of abstraction.",
    scanLabel: "4+ levels of conditional nesting — high cyclomatic complexity",
    fix: {
      before: `function process(user) {\n  if (user) {\n    if (user.isActive) {\n      if (user.role === "admin") {\n        if (hasPermission(user, "write")) {\n          doWork();\n        }\n      }\n    }\n  }\n}`,
      after: `// Guard clauses — fail fast, main path stays left-aligned\nfunction process(user) {\n  if (!user) return;\n  if (!user.isActive) return;\n  if (user.role !== "admin") return;\n  if (!hasPermission(user, "write")) return;\n  doWork();\n}`,
      language: "typescript",
    },
  },
  {
    id: "string-concat-loop",
    pattern: /(?:let|var)\s+\w+\s*=\s*["'`]["'`]?;?\s*for\s*\([^)]+\)\s*\{[^}]*\+=\s*(?:\w+\s*\+|["'`])/g,
    severity: "medium",
    description: (file) =>
      `String concatenation inside a loop in ${file}. Each += creates a new string — O(n²) memory for large arrays.`,
    suggestion: "Collect into an array and join: const parts = []; for (...) { parts.push(val); } const result = parts.join('');",
    scanLabel: "String concatenation in loops (quadratic memory allocation)",
  },
  // ── Hardcoded values ───────────────────────────────────────────────────────
  {
    id: "hardcoded-port",
    pattern: /\blisten\s*\(\s*(?:3000|8080|8000|4000|5000)\s*\)/g,
    severity: "low",
    description: (file) =>
      `Hardcoded server port in ${file}. Hardcoded ports conflict with different environments and Docker port mapping.`,
    suggestion: "Use environment variable: server.listen(process.env.PORT ?? 3000). This respects cloud platform port injection.",
    scanLabel: "Hardcoded server port — should use PORT env variable",
  },
  {
    id: "missing-input-validation",
    pattern: /\b(?:express|fastify|app|router)\.(?:post|put|patch)\s*\(\s*['"][^'"]*['"]\s*,\s*(?:async\s*)?\([^)]*\breq\b[^)]*\)\s*=>\s*\{/g,
    severity: "medium",
    refine: (m) => {
      const close = findBodyEnd(m.ctx.code, m.end - 1);
      const body = m.ctx.code.slice(m.end, close);
      return /\breq\s*\.\s*(?:body|params|query)\b/.test(body) &&
        !/\b(?:z|joi|yup|Joi)\s*\.|\bvalidate\w*\s*\(|\bsanitize\w*\s*\(|\.(?:parse|safeParse|validate)\s*\(|checkSchema|validationResult/.test(body);
    },
    description: (file) =>
      `Express/Fastify route handler in ${file} uses request data without visible schema validation. Unvalidated input leads to type errors, crashes, and injection.`,
    suggestion: "Add Zod validation: const body = z.object({ name: z.string(), age: z.number() }).parse(req.body). Reject early on parse error.",
    scanLabel: "Route handlers using request data without schema validation",
    fix: {
      before: `app.post("/users", async (req, res) => {\n  const { name, age, role } = req.body; // unvalidated — any type, any value\n  await db.users.create({ name, age, role });\n});`,
      after: `import { z } from "zod";\nconst CreateUserSchema = z.object({\n  name: z.string().min(1).max(100),\n  age: z.number().int().min(0).max(150),\n  // role NOT accepted from user input — set server-side\n});\napp.post("/users", async (req, res) => {\n  const parsed = CreateUserSchema.safeParse(req.body);\n  if (!parsed.success) {\n    return res.status(400).json({ errors: parsed.error.flatten() });\n  }\n  await db.users.create({ ...parsed.data, role: "user" }); // role hardcoded\n});`,
      language: "typescript",
    },
  },
  // ── for...in on arrays ────────────────────────────────────────────────────
  {
    id: "for-in-array",
    pattern: /for\s*\(\s*(?:const|let|var)\s+\w+\s+in\s+\w+/g,
    severity: "low",
    description: (file, count) =>
      `${count} for...in loop${count > 1 ? "s" : ""} in ${file}. for...in iterates enumerable properties (including inherited ones) — incorrect for arrays and slower than for...of.`,
    suggestion:
      "Use for...of for arrays: for (const item of arr). Use Object.entries/keys/values for objects: for (const [k, v] of Object.entries(obj)).",
    scanLabel: "for...in loops — should use for...of for arrays, Object.entries for objects",
    fix: {
      before: `// iterates inherited properties too, index order not guaranteed\nfor (const i in myArray) {\n  process(myArray[i]);\n}`,
      after: `// for...of — values in guaranteed order\nfor (const item of myArray) {\n  process(item);\n}\n// For plain objects:\nfor (const [key, value] of Object.entries(myObj)) {\n  console.log(key, value);\n}`,
      language: "typescript",
    },
  },
  // ── Array mutation on sort ────────────────────────────────────────────────
  {
    id: "sort-mutation",
    pattern: /(?:const|let)\s+\w+\s*=\s*\w+\.sort\s*\(/g,
    severity: "low",
    description: (file, count) =>
      `${count} .sort() assignment${count > 1 ? "s" : ""} in ${file}. Array.sort() mutates the original array AND returns it — assigning the return value creates a false impression of a copy.`,
    suggestion:
      "Spread before sorting to avoid mutating the source: const sorted = [...original].sort((a, b) => a - b).",
    scanLabel: "Array.sort() mutates the original — spread first to get a copy",
    fix: {
      before: `const sorted = items.sort((a, b) => a.date - b.date);\n// 'items' is now also sorted — unexpected mutation`,
      after: `const sorted = [...items].sort((a, b) => a.date - b.date);\n// 'items' is unchanged`,
      language: "typescript",
    },
  },
  // ── Non-strict equality ───────────────────────────────────────────────────
  {
    id: "loose-equality",
    pattern: /(?<![=!<>])==(?![=>])(?!\s*(?:null|undefined)\b)/g,
    severity: "low",
    description: (file, count) =>
      `${count} loose equality (==) comparison${count > 1 ? "s" : ""} in ${file}. JavaScript's == performs type coercion: "1" == 1 and 0 == "" are both true, causing subtle bugs.`,
    suggestion:
      "Use strict equality (===) everywhere. The single accepted exception is x == null as a shorthand for x === null || x === undefined.",
    scanLabel: "Loose equality (==) — use === to avoid type coercion surprises",
    fix: {
      before: `if (userId == "123") { } // "123" == 123 is true\nif (status == 200) { }   // type coercion risk`,
      after: `if (userId === "123") { } // strict — no coercion\nif (status === 200) { }   // explicit\nif (value == null) { }    // this one exception is intentional`,
      language: "typescript",
    },
  },
  // ── Object spread overwriting unknown keys ────────────────────────────────
  {
    id: "unsafe-object-spread",
    pattern: /(?:useState|useReducer|setState)\s*\([^)]*\{[^}]*\.\.\.\w+(?:req\.body|req\.params|params|body|data)\b/gi,
    severity: "medium",
    description: (file) =>
      `Unsafe state update via object spread in ${file}: spreading untrusted/external data directly into state. Attacker-supplied keys can overwrite security-sensitive properties.`,
    suggestion:
      "Explicitly pick only the fields you trust: setState({ name: data.name, bio: data.bio }). Never spread external objects directly into state.",
    scanLabel: "Unsafe object spread from external data into state",
    fix: {
      before: `setState({ ...prev, ...req.body }); // attacker can set isAdmin, role, etc.`,
      after: `// Explicitly pick safe, known fields only\nsetState({ ...prev, name: data.name, bio: data.bio });`,
      language: "typescript",
    },
  },
  // ── Accessibility: img without alt ───────────────────────────────────────
  {
    id: "img-missing-alt",
    pattern: /<img(?![^>]*\balt\s*=)[^>]*>/gi,
    severity: "medium",
    files: /\.(?:jsx|tsx|vue|svelte|astro)$/,
    refine: (m) => !/\{\s*\.\.\./.test(m.text),
    description: (file, count) =>
      `${count} <img> element${count > 1 ? "s" : ""} without an alt attribute in ${file}. Screen readers cannot describe the image to visually-impaired users, and it fails WCAG 2.1 AA.`,
    suggestion: "Add descriptive alt text: <img alt='Company logo' ... />. For decorative images use alt=\"\" to indicate it should be skipped by screen readers.",
    scanLabel: "Images missing alt text — accessibility (WCAG 2.1 AA failure)",
    fix: {
      before: `<img src="/logo.png" className="h-8" /> {/* screen readers skip this */}`,
      after: `<img src="/logo.png" className="h-8" alt="GitScope logo" />\n{/* For decorative images that add no information: */}\n<img src="/divider.svg" alt="" role="presentation" />`,
      language: "tsx",
    },
  },
  // ── Accessibility: button without type ───────────────────────────────────
  {
    id: "button-missing-type",
    pattern: /<button(?![^>]*\btype\s*=)[^>]*>/gi,
    severity: "low",
    files: /\.(?:jsx|tsx|vue|svelte|astro)$/,
    refine: (m) => /<form\b|\bonSubmit\s*=/.test(m.ctx.code) && !/\{\s*\.\.\./.test(m.text),
    description: (file, count) =>
      `${count} <button> element${count > 1 ? "s" : ""} in ${file} without an explicit type. Default type is "submit" — buttons inside forms will unintentionally submit the form.`,
    suggestion: "Always specify type: <button type='button'> for non-submitting buttons, <button type='submit'> for form submit.",
    scanLabel: "Buttons without explicit type — may unintentionally submit forms",
    fix: {
      before: `<button onClick={handleClear}>Clear</button> {/* inside a form, this submits! */}`,
      after: `<button type="button" onClick={handleClear}>Clear</button>\n<button type="submit">Save Changes</button>`,
      language: "tsx",
    },
  },
  // ── Accessibility: interactive element without aria-label ─────────────────
  {
    id: "icon-button-no-label",
    pattern: /<button\b([^>]*)>(?:\s*<(?:svg|Icon|icon|[A-Z]\w*Icon)\b[^>]*>|[\s]*<i\s)/g,
    severity: "medium",
    files: /\.(?:jsx|tsx|vue|svelte|astro)$/,
    refine: (m) => {
      if (/aria-label|aria-labelledby|\btitle\s*=|\{\s*\.\.\./.test(m.groups[0] ?? "")) return false;
      const close = m.ctx.code.indexOf("</button>", m.end);
      const inner = m.ctx.text.slice(m.end, close < 0 ? m.end + 400 : close);
      return !/sr-only|visually-hidden|>\s*[A-Za-z{][^<]*</.test(inner) && !/^[^<]*[A-Za-z]/.test(inner);
    },
    description: (file) =>
      `Icon-only button detected in ${file} without visible text. Screen readers will announce no useful label, making the control unusable for keyboard/screen reader users.`,
    suggestion: "Add aria-label: <button aria-label='Close dialog' type='button'><CloseIcon /></button>. Or use visually-hidden text: <span className='sr-only'>Close</span>",
    scanLabel: "Icon-only buttons without aria-label — WCAG 2.1 AA failure",
    fix: {
      before: `<button onClick={onClose}><XMarkIcon className="h-5 w-5" /></button>`,
      after: `<button\n  type="button"\n  aria-label="Close dialog"\n  onClick={onClose}\n>\n  <XMarkIcon className="h-5 w-5" aria-hidden="true" />\n</button>`,
      language: "tsx",
    },
  },
  // ── Non-null assertion abuse ──────────────────────────────────────────────
  {
    id: "non-null-assertion-chain",
    pattern: /\w+!(?:\.\w+!){2,}/g,
    severity: "medium",
    description: (file, count) =>
      `${count} chained non-null assertion${count > 1 ? "s" : ""} (x!.y!.z!) in ${file}. Each ! suppresses a null-check TypeScript would otherwise enforce — chain failures cause unhandled runtime crashes.`,
    suggestion: "Use optional chaining and provide a fallback: x?.y?.z ?? defaultValue. Only use ! when you are 100% certain a value cannot be null at that point.",
    scanLabel: "Chained non-null assertions (!) suppress null safety checks",
    fix: {
      before: `const city = user!.address!.city!; // any null = runtime crash`,
      after: `const city = user?.address?.city ?? "Unknown";\n// Or throw early with a clear message:\nif (!user?.address?.city) throw new Error(\`User \${userId} has no city\`);`,
      language: "typescript",
    },
  },
  // ── useState with array index as key ─────────────────────────────────────
  {
    id: "key-from-array-index",
    pattern: /key\s*=\s*\{\s*(?:index|i|idx|_i|_idx)\s*\}/gi,
    severity: "low",
    description: (file, count) =>
      `${count} React list render${count > 1 ? "s" : ""} in ${file} using array index as key. When items are added, removed, or reordered, React re-uses wrong DOM nodes — causing incorrect UI state, animation bugs, and stale input values.`,
    suggestion: "Use a stable unique ID from your data: key={item.id}. Never use index as key for sortable, filterable, or dynamic lists.",
    scanLabel: "Array index used as React key — causes UI state bugs on reorder/delete",
    fix: {
      before: `{items.map((item, index) => (\n  <ListItem key={index} data={item} /> // stale state when list changes\n))}`,
      after: `{items.map((item) => (\n  <ListItem key={item.id} data={item} /> // stable identity through changes\n))}`,
      language: "tsx",
    },
  },
  // ── TypeScript strict mode missing ────────────────────────────────────────
  {
    id: "tsconfig-no-strict",
    pattern: /"strict"\s*:\s*false/g,
    severity: "medium",
    langs: ["json"],
    view: "text",
    files: /(?:^|\/)tsconfig[\w.-]*\.json$/,
    description: (file) =>
      `TypeScript strict mode disabled in ${file}. Without strict mode, TypeScript misses null dereferences, implicit any, and unsafe function calls — these are the most common sources of runtime crashes.`,
    suggestion: "Set \"strict\": true in tsconfig.json. It enables strictNullChecks, noImplicitAny, strictFunctionTypes, and 6 other checks. Fix type errors rather than disabling the check.",
    scanLabel: "TypeScript strict mode disabled — misses null/any type errors",
    fix: {
      before: `{\n  "compilerOptions": {\n    "strict": false // null dereferences compile without error\n  }\n}`,
      after: `{\n  "compilerOptions": {\n    "strict": true,          // enables all strict checks\n    "noUncheckedIndexedAccess": true, // array[i] is T | undefined\n    "exactOptionalPropertyTypes": true\n  }\n}`,
      language: "json",
    },
  },
  // ── Async event handler without error handling ────────────────────────────
  {
    id: "async-event-handler-no-catch",
    pattern: /on(?:Click|Submit|Change|Blur|Focus|KeyDown|KeyUp)\s*=\s*\{\s*async\s*(?:\([^)]*\)|\w+)\s*=>\s*\{/g,
    severity: "medium",
    refine: (m) => {
      const body = m.ctx.code.slice(m.end, findBodyEnd(m.ctx.code, m.end - 1));
      return /\bawait\b/.test(body) && !/\btry\s*\{|\.\s*catch\s*\(/.test(body);
    },
    description: (file) =>
      `Async event handler without try/catch in ${file}. Unhandled async errors in event handlers are swallowed by React — the UI appears to hang with no feedback to the user.`,
    suggestion: "Wrap async event handler bodies in try/catch and update UI state: catch(err) { setError(err.message); toast.error('Something went wrong'); }",
    scanLabel: "Async event handlers without try/catch — errors swallowed silently",
    fix: {
      before: `const handleSubmit = async (e) => {\n  e.preventDefault();\n  const data = await submitForm(formData); // error silently disappears\n  router.push("/success");\n};`,
      after: `const handleSubmit = async (e: React.FormEvent) => {\n  e.preventDefault();\n  setLoading(true);\n  try {\n    const data = await submitForm(formData);\n    router.push("/success");\n  } catch (err) {\n    const msg = err instanceof Error ? err.message : "Something went wrong";\n    setError(msg); // show error in UI\n    toast.error(msg);\n  } finally {\n    setLoading(false);\n  }\n};`,
      language: "typescript",
    },
  },
  // ── Missing React error boundary ─────────────────────────────────────────
  {
    id: "no-error-boundary",
    pattern: /ReactDOM\.createRoot|createRoot\s*\(/g,
    severity: "low",
    refine: (m) => !/ErrorBoundary/.test(m.ctx.code),
    description: (file) =>
      `React root rendered in ${file} without evidence of an Error Boundary. Runtime render errors crash the entire React tree with a blank white screen and no user feedback.`,
    suggestion: "Wrap root-level components with an ErrorBoundary: <ErrorBoundary fallback={<ErrorPage />}><App /></ErrorBoundary>. Use react-error-boundary package.",
    scanLabel: "React app without error boundary — crashes show blank screen",
    fix: {
      before: `createRoot(document.getElementById("root")!).render(<App />);`,
      after: `import { ErrorBoundary } from "react-error-boundary";\ncreateRoot(document.getElementById("root")!).render(\n  <ErrorBoundary\n    fallback={<div>Something went wrong. <button onClick={() => window.location.reload()}>Reload</button></div>}\n    onError={(err) => console.error("[ErrorBoundary]", err)}\n  >\n    <App />\n  </ErrorBoundary>\n);`,
      language: "tsx",
    },
  },
  // ── Unused React import (React 17+) ──────────────────────────────────────
  {
    id: "unused-react-import",
    pattern: /^import React from ['"]react['"]/gm,
    severity: "low",
    view: "text",
    refine: (m) => !/\bReact\s*\./.test(m.ctx.code),
    description: (file) =>
      `Explicit \`import React from 'react'\` in ${file}. React 17+ with the new JSX transform doesn't require this import — it adds unnecessary bundle weight and signals an outdated codebase.`,
    suggestion: "Remove the default React import unless you're using React.memo, React.forwardRef, or other React namespace APIs. Configure jsx: 'react-jsx' in tsconfig.",
    scanLabel: "Unnecessary React default import — not needed with React 17+ JSX transform",
    fix: {
      before: `import React from "react"; // unnecessary with React 17+ new JSX transform\nimport { useState } from "react";`,
      after: `import { useState } from "react"; // just import what you use\n// tsconfig: "jsx": "react-jsx" enables the automatic transform`,
      language: "typescript",
    },
  },
  // ── Direct mutation of state ──────────────────────────────────────────────
  {
    id: "state-direct-mutation",
    pattern: /\bthis\.state\.\w+(?:\.\w+)*\s*=(?!=)|\bthis\.state\.\w+\.(?:push|pop|splice|shift|unshift|sort|reverse)\s*\(/g,
    severity: "high",
    refine: (m) => !/constructor\s*\([^)]*\)\s*\{[^}]*$/.test(m.ctx.code.slice(Math.max(0, m.index - 400), m.index)),
    description: (file) =>
      `Direct state mutation detected in ${file}. Mutating state directly bypasses React's change detection — the component will not re-render and the UI will be out of sync with the data.`,
    suggestion: "Never mutate state directly. Use setState or the useState setter with a new array/object: setState(prev => [...prev, newItem])",
    scanLabel: "Direct state mutation — component will not re-render",
    fix: {
      before: `// Class component\nthis.state.items.push(newItem); // no re-render!\n// Functional component\nconst { items } = state;\nitems.push(newItem); // mutating ref — component won't update`,
      after: `// Class component\nthis.setState(prev => ({ items: [...prev.items, newItem] }));\n// Functional component\nsetItems(prev => [...prev, newItem]); // new array reference triggers re-render`,
      language: "typescript",
    },
  },
  {
    id: "missing-db-transaction",
    pattern: /(?:prisma\.\w+\.create|prisma\.\w+\.update|prisma\.\w+\.delete)[^;]+;\s*(?:await\s+)?prisma\.\w+\.(?:create|update|delete)/g,
    severity: "medium",
    description: (file) =>
      `Multiple dependent database writes in ${file} without a transaction. If the second write fails, the first is already committed and the data is left inconsistent.`,
    suggestion: "Wrap related writes in a transaction: await prisma.$transaction(async (tx) => { … }) so they succeed or roll back together.",
    scanLabel: "Related database writes without a transaction",
    fix: {
      before: `await prisma.order.create({ data: orderData });\nawait prisma.inventory.update({ where: { id }, data: { stock: stock - 1 } });`,
      after: `await prisma.$transaction(async (tx) => {\n  await tx.order.create({ data: orderData });\n  await tx.inventory.update({ where: { id }, data: { stock: { decrement: 1 } } });\n});`,
      language: "typescript",
    },
  },
];

// ── Performance rules ─────────────────────────────────────────────────────────
// Detects patterns that cause measurable runtime performance problems.

interface PerformanceRule extends RuleScope {
  id: string;
  pattern: RegExp;
  severity: CodeReviewFinding["severity"];
  description: (file: string, count: number) => string;
  suggestion: string;
  scanLabel: string;
  fix?: RuleFix;
}

const NON_REQUEST_FILE = /(?:^|\/)(?:scripts?|bin|cli|tools|seed|migrations?)\/|\.config\.[cm]?[jt]s$|(?:^|\/)(?:build|setup|instrumentation)\.[jt]s$/;

function insideBlock(m: RuleMatch): boolean {
  let depth = 0;
  const code = m.ctx.code;
  for (let i = 0; i < m.index; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}") depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

const PERFORMANCE_RULES: PerformanceRule[] = [
  // ── Database ───────────────────────────────────────────────────────────────
  {
    id: "select-star",
    pattern: /(?:db\.query|pool\.query|connection\.query)\s*\(\s*['"`]SELECT\s+\*/gi,
    severity: "medium",
    view: "text",
    description: (file) =>
      `SELECT * query in ${file}. Fetching all columns wastes bandwidth and memory, especially on tables with large text/blob fields.`,
    suggestion:
      "Select only needed columns: SELECT id, name, email FROM users. In ORMs: prisma.user.findMany({ select: { id: true, name: true } })",
    scanLabel: "SELECT * queries — fetch only needed columns",
    fix: {
      before: `const rows = await db.query("SELECT * FROM users WHERE active = true");`,
      after: `// Only fetch what you need — especially important for tables with BLOBs\nconst rows = await db.query(\n  "SELECT id, name, email, created_at FROM users WHERE active = true"\n);\n// With Prisma ORM:\nconst users = await prisma.user.findMany({\n  where: { active: true },\n  select: { id: true, name: true, email: true, createdAt: true },\n});`,
      language: "typescript",
    },
  },
  // ── I/O ────────────────────────────────────────────────────────────────────
  {
    id: "sync-file-io",
    pattern: /\b(?:readFileSync|writeFileSync|appendFileSync|existsSync|readdirSync|mkdirSync|unlinkSync|statSync|copyFileSync)\s*\(/g,
    severity: "high",
    refine: (m) => m.ctx.isServer && !NON_REQUEST_FILE.test(m.ctx.filename) && insideBlock(m),
    description: (file) =>
      `Synchronous file I/O in ${file}. Sync FS operations block the Node.js event loop for their entire duration — all concurrent requests freeze.`,
    suggestion:
      "Use async alternatives: await fs.promises.readFile(path, 'utf8') or import { readFile } from 'fs/promises'. Sync is only acceptable in startup scripts.",
    scanLabel: "Synchronous FS operations block the event loop",
    fix: {
      before: `// BLOCKS the event loop — all other requests wait\nconst data = fs.readFileSync("./data.json", "utf8");\nfs.writeFileSync("./output.txt", result);`,
      after: `// Non-blocking — event loop handles other requests while I/O happens\nimport { readFile, writeFile } from "fs/promises";\nconst data = await readFile("./data.json", "utf8");\nawait writeFile("./output.txt", result);`,
      language: "typescript",
    },
  },
  {
    id: "sync-crypto",
    pattern: /crypto\.(?:pbkdf2Sync|scryptSync|randomFillSync)\s*\(/g,
    severity: "high",
    description: (file) =>
      `Synchronous cryptographic operation in ${file}. PBKDF2/scrypt are intentionally CPU-intensive — the sync version blocks the event loop for all other requests.`,
    suggestion:
      "Use the async version with a Promise wrapper: await new Promise((res, rej) => crypto.pbkdf2(pw, salt, 100000, 64, 'sha512', (e, k) => e ? rej(e) : res(k)))",
    scanLabel: "Synchronous crypto (pbkdf2Sync/scryptSync) blocks event loop",
    fix: {
      before: `// BLOCKS for ~100-500ms — server-wide freeze while hashing\nconst hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512");`,
      after: `// Use bcryptjs or argon2 (they're already async-safe)\nimport bcrypt from "bcryptjs";\nconst hash = await bcrypt.hash(password, 12); // non-blocking\n// Or promisify the native:\nconst hash = await new Promise<Buffer>((res, rej) =>\n  crypto.pbkdf2(password, salt, 100000, 64, "sha512", (e, k) => e ? rej(e) : res(k))\n);`,
      language: "typescript",
    },
  },
  // ── React/Frontend ─────────────────────────────────────────────────────────
  {
    id: "missing-lazy-load",
    pattern: /import\s+\w+\s+from\s+['"](?:react-pdf|@monaco-editor|recharts|chart\.js|three|@three|@lottiefiles|react-quill)/gi,
    severity: "low",
    view: "text",
    description: (file) =>
      `Heavy library imported at top-level in ${file}. Synchronous imports of large libraries increase initial bundle size and Time to Interactive.`,
    suggestion:
      "Lazy-load heavy components: const Chart = React.lazy(() => import('./Chart')). Wrap in <Suspense fallback={<Spinner/>}>.",
    scanLabel: "Heavy library imported without code-splitting — large initial bundle",
  },
  // ── Memory ─────────────────────────────────────────────────────────────────
  {
    id: "event-listener-leak",
    pattern: /addEventListener\s*\(/g,
    severity: "medium",
    refine: (m) => {
      const code = m.ctx.code;
      if (!/\buseEffect\b|\buseLayoutEffect\b|componentDidMount/.test(code) || /removeEventListener|\bAbortController\b/.test(code)) return false;
      const call = callArgsAt(code, m.end - 1);
      return !call || !/\bonce\s*:\s*true|\bsignal\s*:/.test(code.slice(call.open, call.close));
    },
    description: (file) =>
      `addEventListener without corresponding removeEventListener cleanup in ${file}. In React components this causes memory leaks and duplicate handlers.`,
    suggestion:
      "Return a cleanup function from useEffect: useEffect(() => { window.addEventListener('resize', handler); return () => window.removeEventListener('resize', handler); }, []);",
    scanLabel: "Event listeners without cleanup — memory leak in components",
    fix: {
      before: `useEffect(() => {\n  window.addEventListener("resize", handleResize);\n  // No cleanup — handler accumulates on every render, memory leaks\n}, []);`,
      after: `useEffect(() => {\n  window.addEventListener("resize", handleResize);\n  // Cleanup runs when component unmounts or deps change\n  return () => window.removeEventListener("resize", handleResize);\n}, []); // handleResize should be stable (useCallback or defined outside)`,
      language: "typescript",
    },
  },
  {
    id: "setinterval-leak",
    pattern: /setInterval\s*\(/g,
    severity: "medium",
    refine: (m) => !/clearInterval/.test(m.ctx.code),
    description: (file) =>
      `setInterval without clearInterval in ${file}. Intervals continue running after component unmount, causing memory leaks and bugs.`,
    suggestion:
      "Store the interval ID and clear it: useEffect(() => { const id = setInterval(fn, 1000); return () => clearInterval(id); }, []);",
    scanLabel: "setInterval without clearInterval — memory leak",
    fix: {
      before: `useEffect(() => {\n  setInterval(() => setCount(c => c + 1), 1000);\n  // No clearInterval — interval outlives component, still ticking after unmount\n}, []);`,
      after: `useEffect(() => {\n  const intervalId = setInterval(() => setCount(c => c + 1), 1000);\n  return () => clearInterval(intervalId); // stops when component unmounts\n}, []);`,
      language: "typescript",
    },
  },
  // ── Bundle ─────────────────────────────────────────────────────────────────
  {
    id: "lodash-full-import",
    pattern: /import\s+_\s+from\s+['"]lodash['"]/g,
    severity: "medium",
    description: (file) =>
      `Full lodash import in ${file}. Importing all of lodash adds ~70KB gzipped to the bundle. Only specific methods are used.`,
    suggestion:
      "Import only what you need: import debounce from 'lodash/debounce'. Or use native ES2020+: native Array/Object methods cover most lodash use cases.",
    scanLabel: "Full lodash import adds ~70KB to bundle",
    fix: {
      before: `import _ from "lodash"; // ~70KB gzipped bundled\nconst result = _.debounce(fn, 300);\nconst grouped = _.groupBy(items, "category");`,
      after: `// Tree-shakeable — only the functions you use are bundled\nimport debounce from "lodash/debounce"; // ~2KB\nimport groupBy from "lodash/groupBy";   // ~1KB\nconst result = debounce(fn, 300);\nconst grouped = groupBy(items, "category");\n// Or use native equivalents (zero bytes):\nconst grouped = Object.groupBy(items, i => i.category); // ES2024`,
      language: "typescript",
    },
  },
  {
    id: "moment-import",
    pattern: /import\s+\w+\s+from\s+['"]moment['"]/g,
    severity: "medium",
    description: (file) =>
      `Moment.js imported in ${file}. Moment adds ~67KB gzipped and is no longer maintained. Every locale is bundled by default.`,
    suggestion:
      "Migrate to date-fns (tree-shakeable, ~12KB) or Day.js (~2KB): import { format, parseISO } from 'date-fns';",
    scanLabel: "Moment.js import — 67KB bundle weight, unmaintained",
    fix: {
      before: `import moment from "moment"; // 67KB gzipped, deprecated\nconst formatted = moment(date).format("YYYY-MM-DD");\nconst diff = moment(end).diff(start, "days");`,
      after: `// date-fns — tree-shakeable, actively maintained (~12KB total)\nimport { format, differenceInDays, parseISO } from "date-fns";\nconst formatted = format(new Date(date), "yyyy-MM-dd");\nconst diff = differenceInDays(new Date(end), new Date(start));\n// Or Day.js — moment-compatible API, ~2KB:\nimport dayjs from "dayjs";\nconst formatted = dayjs(date).format("YYYY-MM-DD");`,
      language: "typescript",
    },
  },
  // ── API ────────────────────────────────────────────────────────────────────
  {
    id: "sequential-awaits",
    pattern: /(?:const|let)\s+(\w+)\s*=\s*await\s+([\w.]+\([^;]*\));\s*(?:const|let)\s+(\w+)\s*=\s*await\s+([\w.]+\([^;]*\));\s*(?:const|let)\s+\w+\s*=\s*await\s+([\w.]+\([^;]*\));/g,
    severity: "medium",
    refine: (m) => {
      const [a, , b, callB, callC] = m.groups.map((g) => g ?? "");
      const uses = (call: string, name: string) => new RegExp(`\\b${name}\\b`).test(call);
      return !uses(callB, a) && !uses(callC, a) && !uses(callC, b);
    },
    description: (file) =>
      `Three or more sequential awaits in ${file}. If these operations are independent, they execute serially rather than concurrently — wasting latency.`,
    suggestion:
      "Run independent operations in parallel: const [a, b, c] = await Promise.all([fetchA(), fetchB(), fetchC()]); Total time = max(a, b, c) instead of a + b + c.",
    scanLabel: "Sequential awaits for independent operations — latency waste",
    fix: {
      before: `// SLOW — total time = t(user) + t(posts) + t(settings)\nconst user = await fetchUser(id);\nconst posts = await fetchPosts(id);\nconst settings = await fetchSettings(id);`,
      after: `// FAST — total time = max(t(user), t(posts), t(settings))\nconst [user, posts, settings] = await Promise.all([\n  fetchUser(id),\n  fetchPosts(id),\n  fetchSettings(id),\n]);\n// Only use sequential when each result depends on the previous one`,
      language: "typescript",
    },
  },
  // ── fetch() without timeout ───────────────────────────────────────────────
  {
    id: "fetch-no-timeout",
    pattern: /(?<![.\w$])fetch\s*\(/g,
    severity: "low",
    refine: (m) => {
      if (!m.ctx.isServer || m.ctx.isClient || /AbortSignal|AbortController|\bsignal\s*:|\btimeout\s*:/.test(m.ctx.code)) return false;
      const call = callArgsAt(m.ctx.code, m.end - 1);
      if (!call || call.args.length === 0) return false;
      const first = m.ctx.text.slice(call.args[0].start, call.args[0].start + call.args[0].text.length).trim();
      return !/^["'`]\//.test(first);
    },
    description: (file) =>
      `fetch() call in ${file} without an AbortController timeout. If the remote server hangs, the request runs forever — tying up Node.js resources and eventually exhausting the connection pool.`,
    suggestion: "Add a timeout: const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 10_000); fetch(url, { signal: ctrl.signal });",
    scanLabel: "fetch() without timeout — connection hangs indefinitely on slow servers",
    fix: {
      before: `const res = await fetch("https://api.example.com/data"); // no timeout`,
      after: `const ctrl = new AbortController();\nconst timeout = setTimeout(() => ctrl.abort(), 10_000); // 10 second timeout\ntry {\n  const res = await fetch("https://api.example.com/data", { signal: ctrl.signal });\n  const data = await res.json();\n  return data;\n} finally {\n  clearTimeout(timeout);\n}`,
      language: "typescript",
    },
  },
  // ── img without lazy loading ──────────────────────────────────────────────
  {
    id: "img-no-lazy-load",
    pattern: /<img(?![^>]*\bloading\s*=)[^>]*src\s*=/gi,
    severity: "low",
    files: /\.(?:jsx|tsx|vue|svelte|astro|html)$/,
    description: (file, count) =>
      `${count} <img> element${count > 1 ? "s" : ""} in ${file} without loading="lazy". All images load eagerly on page load — including ones below the fold — increasing initial payload and Time to Interactive.`,
    suggestion: "Add loading='lazy' to below-the-fold images: <img loading='lazy' src={url} alt='...' />. Use loading='eager' only for hero/LCP images.",
    scanLabel: "Images without lazy loading — increases initial page load",
    fix: {
      before: `<img src={product.imageUrl} className="w-full" alt={product.name} />`,
      after: `{/* Hero/LCP image — eager load */}\n<img src={hero.imageUrl} loading="eager" fetchPriority="high" alt={hero.title} />\n{/* Below-fold images — lazy load */}\n<img src={product.imageUrl} loading="lazy" className="w-full" alt={product.name} />`,
      language: "tsx",
    },
  },
  // ── <img> instead of Next.js <Image> ─────────────────────────────────────
  {
    id: "img-not-next-image",
    pattern: /<img\s+(?=[^>]*src\s*=\s*['"](?:\/|https?:\/\/))[^>]*>/gi,
    severity: "low",
    view: "text",
    files: /\.(?:jsx|tsx)$/,
    refine: (m) => "next" in m.ctx.project.deps || /from\s+["']next\//.test(m.ctx.text),
    description: (file) =>
      `Plain <img> used for a local/CDN image in ${file}. Next.js <Image> provides automatic WebP conversion, responsive sizes, lazy loading, blur placeholder, and priority hints — all missing with plain <img>.`,
    suggestion: "Replace with Next.js <Image>: import Image from 'next/image'; <Image src={url} width={800} height={600} alt='...' />",
    scanLabel: "Plain <img> instead of Next.js <Image> — missing WebP, lazy load, responsive sizes",
    fix: {
      before: `<img src="/hero.jpg" className="w-full h-[400px] object-cover" alt="Hero" />`,
      after: `import Image from "next/image";\n<Image\n  src="/hero.jpg"\n  width={1200}\n  height={400}\n  alt="Hero"\n  priority // hero images should load eagerly\n  className="w-full h-[400px] object-cover"\n/>`,
      language: "tsx",
    },
  },
  // ── Missing debounce on input handler ─────────────────────────────────────
  {
    id: "input-no-debounce",
    pattern: /onChange\s*=\s*\{[^}]*(?<![\w$])(?:fetch|axios(?:\.\w+)?|ky|search|runSearch|doSearch|query|api\.\w+)\s*\(/g,
    severity: "medium",
    refine: (m) => !/debounce|throttle|useDeferredValue|useTransition|setTimeout/i.test(m.ctx.code),
    description: (file) =>
      `API call directly in an onChange handler in ${file}. Every keystroke fires a request — 10 chars typed = 10 requests. This hammers your API and often returns results out of order.`,
    suggestion: "Debounce the handler: const debouncedSearch = useMemo(() => debounce(search, 300), []). Cancel in-flight requests with AbortController.",
    scanLabel: "API calls directly in onChange — fires on every keystroke",
    fix: {
      before: `<input onChange={(e) => fetchSearchResults(e.target.value)} /> // fires 10+ req/word`,
      after: `import { useDebouncedCallback } from "use-debounce";\nconst handleSearch = useDebouncedCallback(async (value: string) => {\n  const results = await fetchSearchResults(value);\n  setResults(results);\n}, 300); // waits 300ms after last keystroke\n<input onChange={(e) => handleSearch(e.target.value)} />`,
      language: "tsx",
    },
  },
  // ── Missing database connection pool ─────────────────────────────────────
  {
    id: "db-no-connection-pool",
    pattern: /\bnew\s+(?:Client|Connection|MongoClient)\s*\(|\bmysql2?\s*\.\s*createConnection\s*\(/g,
    severity: "high",
    refine: (m) => /["'](?:pg|mysql2?|mongodb|tedious|oracledb)["']/.test(m.ctx.text) && insideBlock(m),
    description: (file) =>
      `Database client instantiated without pooling in ${file}. Creating a new connection per request is extremely slow (100-300ms per connect) and exhausts DB connection limits under load.`,
    suggestion: "Create one connection pool at module level and reuse it: const pool = new Pool({ connectionString, max: 20 }). Export and reuse across requests.",
    scanLabel: "Database connection created per request — exhausts connection limits",
    fix: {
      before: `// In API route — new connection on EVERY request!\nexport async function GET() {\n  const client = new Client({ connectionString: process.env.DATABASE_URL });\n  await client.connect(); // slow! 100-300ms\n  const data = await client.query("SELECT * FROM users");\n  await client.end();\n  return Response.json(data.rows);\n}`,
      after: `// In db.ts — ONE pool shared across all requests\nimport { Pool } from "pg";\nexport const pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  max: 20, // maximum connections\n  idleTimeoutMillis: 30_000,\n  connectionTimeoutMillis: 2_000,\n});\n// In API route:\nimport { pool } from "@/lib/db";\nexport async function GET() {\n  const { rows } = await pool.query("SELECT * FROM users"); // reuses pooled connection\n  return Response.json(rows);\n}`,
      language: "typescript",
    },
  },
  // ── Regex created inside component/loop ──────────────────────────────────
  {
    id: "regex-in-render-or-loop",
    pattern: /(?:for|while|\.map|\.filter|\.forEach)\s*\([^{]+\{[^}]*new RegExp\s*\(/g,
    severity: "low",
    description: (file) =>
      `RegExp constructed inside a loop or map in ${file}. A new RegExp object is created on every iteration — hoist it outside the loop for a significant performance gain.`,
    suggestion: "Move RegExp construction outside the loop: const pattern = /regex/; array.map(item => pattern.test(item));",
    scanLabel: "RegExp created inside loop — should be hoisted to module scope",
    fix: {
      before: `const results = items.map(item => {\n  const emailRegex = new RegExp(EMAIL_PATTERN, "i"); // new object each iteration!\n  return emailRegex.test(item.email);\n});`,
      after: `const EMAIL_REGEX = /^[^\\\\s@]+@[^\\\\s@]+\\\\.[^\\\\s@]+$/i; // created once, module scope\nconst results = items.map(item => EMAIL_REGEX.test(item.email));`,
      language: "typescript",
    },
  },
  // ── Unbounded in-memory cache ─────────────────────────────────────────────
  {
    id: "unbounded-cache",
    pattern: /(?:const|let)\s+\w*[Cc]ache\w*\s*=\s*(?:new Map|new Set|\{\}|\[\])/g,
    severity: "low",
    refine: (m) => !/\.delete\s*\(|\.clear\s*\(|LRU|\bttl\b|maxSize|\bmax\s*:|\.size\s*>=?/.test(m.ctx.code),
    description: (file) =>
      `In-memory cache with no eviction policy in ${file}. Caches that grow without bound cause memory leaks — every unique key adds an entry that is never removed.`,
    suggestion: "Use LRU cache with a max size: import { LRUCache } from 'lru-cache'; const cache = new LRUCache({ max: 500, ttl: 60_000 });",
    scanLabel: "Unbounded in-memory Map/object used as cache — memory leak",
    fix: {
      before: `const cache = new Map<string, User>(); // grows without limit\nasync function getUser(id: string): Promise<User> {\n  if (cache.has(id)) return cache.get(id)!;\n  const user = await fetchUser(id);\n  cache.set(id, user); // never evicted!\n  return user;\n}`,
      after: `import { LRUCache } from "lru-cache";\nconst cache = new LRUCache<string, User>({\n  max: 500,        // maximum 500 entries\n  ttl: 5 * 60_000, // expire after 5 minutes\n});\nasync function getUser(id: string): Promise<User> {\n  const cached = cache.get(id);\n  if (cached) return cached;\n  const user = await fetchUser(id);\n  cache.set(id, user);\n  return user;\n}`,
      language: "typescript",
    },
  },
  // ── Text search with leading wildcard ────────────────────────────────────
  {
    id: "sql-leading-wildcard",
    pattern: /LIKE\s+['"]%[^%'"]+['"]/gi,
    severity: "medium",
    inStrings: true,
    langs: [...CODE_LANGS, "sql"],
    view: "text",
    description: (file) =>
      `SQL LIKE with leading % wildcard in ${file}. A leading wildcard forces a full table scan — no index can be used, causing O(n) latency that grows with table size.`,
    suggestion: "Use full-text search instead: Postgres tsvector/tsquery, Elasticsearch, or a dedicated search index. If LIKE is needed, use a trailing wildcard LIKE 'prefix%' which CAN use an index.",
    scanLabel: "SQL LIKE '%value' — leading wildcard prevents index usage, forces table scan",
    fix: {
      before: `// Full table scan — O(n) even with an index on name\nSELECT * FROM products WHERE name LIKE '%keyboard%';`,
      after: `-- Option 1: Postgres full-text search (uses GIN index)\nSELECT * FROM products\nWHERE to_tsvector('english', name) @@ plainto_tsquery('english', 'keyboard');\n-- GIN index: CREATE INDEX idx_products_fts ON products USING gin(to_tsvector('english', name));\n\n-- Option 2: Trailing wildcard CAN use a B-tree index:\nSELECT * FROM products WHERE name LIKE 'keyboard%'; -- uses idx_products_name`,
      language: "sql",
    },
  },
];

function fromSecurityRule(r: SecurityRule): PatternRule {
  const confidence = r.confidence ?? 0.85;
  return {
    id: r.id,
    category: "security",
    severity: confidence < 0.5 ? "low" : confidence < 0.65 ? "medium" : r.severity,
    confidence,
    langs: r.langs ?? ["js"],
    view: r.view,
    files: r.files,
    roles: r.roles,
    cls: r.cls,
    pattern: r.pattern,
    inStrings: r.inStrings,
    refine: r.refine,
    message: (m) => r.description(m.text.slice(0, 80), m.ctx.short),
    suggestion: r.suggestion,
    fix: r.fix,
  };
}

const COUNTED_DESCRIPTIONS = new Map<string, (file: string, count: number) => string>();

function fromCountedRule(r: QualityRule | PerformanceRule, category: "quality" | "performance"): PatternRule {
  COUNTED_DESCRIPTIONS.set(r.id, r.description);
  return {
    id: r.id,
    category,
    severity: r.severity,
    confidence: 0.8,
    langs: r.langs ?? ["js"],
    view: r.view,
    files: r.files,
    roles: r.roles,
    cls: r.cls,
    pattern: r.pattern,
    inStrings: r.inStrings,
    refine: r.refine,
    message: (m) => r.description(m.ctx.short, 1),
    label: r.scanLabel,
    suggestion: r.suggestion,
    fix: r.fix,
  };
}

const RULE_PACKS: RulePacks = {
  patterns: [
    ...SECRET_RULES,
    ...SECURITY_RULES.map(fromSecurityRule),
    ...STACK_RULES,
    ...JS_EXTRA_RULES,
    ...LANGUAGE_RULES,
    ...INFRA_RULES,
    ...QUALITY_RULES.map((r) => fromCountedRule(r, "quality")),
    ...PERFORMANCE_RULES.map((r) => fromCountedRule(r, "performance")),
  ],
  checks: [...STRUCTURAL_CHECKS, ...STACK_CHECKS],
  sinks: TAINT_SINKS,
};

function shortPath(file: string): string {
  return file.split("/").slice(-2).join("/");
}

function describeFinding(f: EngineFinding): string {
  const counted = COUNTED_DESCRIPTIONS.get(f.ruleId);
  if (counted) return counted(shortPath(f.file), f.occurrences);
  return f.occurrences > 1 ? `${f.description} (${f.occurrences} occurrences in this file)` : f.description;
}

function locationOf(f: { file?: string; line?: number }): string {
  return f.file ? `${shortPath(f.file)}${f.line ? `:${f.line}` : ""}` : "";
}

const CATEGORY_ORDER: Record<EngineFinding["category"], number> = { security: 0, performance: 1, quality: 2 };

function compareFindings(a: EngineFinding, b: EngineFinding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    b.confidence - a.confidence ||
    CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0)
  );
}

const PENALTY_WEIGHT: Record<Severity, number> = { critical: 28, high: 15, medium: 6, low: 2 };

function penaltyOf(findings: Array<{ ruleId: string; severity: Severity; confidence: number }>): number {
  const byRule = new Map<string, { weight: number; count: number }>();
  for (const f of findings) {
    const weight = PENALTY_WEIGHT[f.severity] * f.confidence;
    const g = byRule.get(f.ruleId);
    if (!g) byRule.set(f.ruleId, { weight, count: 1 });
    else {
      g.weight = Math.max(g.weight, weight);
      g.count++;
    }
  }
  let total = 0;
  for (const g of byRule.values()) total += g.weight * (1 + 0.35 * Math.min(g.count - 1, 4));
  return total;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface PenaltyItem {
  ruleId: string;
  severity: Severity;
  confidence: number;
  label: string;
  file?: string;
  line?: number;
}

function engineItem(f: EngineFinding): PenaltyItem {
  return { ruleId: f.ruleId, severity: f.severity, confidence: f.confidence, label: firstSentence(describeFinding(f)), file: f.file, line: f.line };
}

function scanItems(findings: Array<{ severity: string; description: string; file?: string; line?: number }>): PenaltyItem[] {
  return findings
    .filter((f): f is typeof f & { severity: Severity } => f.severity in SEVERITY_RANK)
    .map((f) => ({ ruleId: `repo:${f.description.slice(0, 40)}`, severity: f.severity, confidence: 0.8, label: firstSentence(f.description), file: f.file && f.file !== "root" ? f.file : undefined, line: f.line }));
}

function deductionFactors(items: PenaltyItem[], ceiling: number, scale: number): { remaining: number; factors: ScoreFactor[] } {
  const groups = new Map<string, { weight: number; count: number; sample: PenaltyItem }>();
  for (const item of items) {
    const weight = PENALTY_WEIGHT[item.severity] * item.confidence;
    const g = groups.get(item.ruleId);
    if (!g) groups.set(item.ruleId, { weight, count: 1, sample: item });
    else {
      g.count++;
      if (weight > g.weight) { g.weight = weight; g.sample = item; }
    }
  }
  const penalties = [...groups.values()].map((g) => ({ ...g, penalty: g.weight * (1 + 0.35 * Math.min(g.count - 1, 4)) }));
  const total = penalties.reduce((n, p) => n + p.penalty, 0);
  const remaining = ceiling * Math.exp(-total / scale);
  const lost = ceiling - remaining;
  const factors = penalties
    .sort((a, b) => b.penalty - a.penalty)
    .map((p) => ({
      label: `${p.sample.label}${p.count > 1 ? ` (+${p.count - 1} more file${p.count > 2 ? "s" : ""})` : ""}`,
      points: -round1(total > 0 ? (lost * p.penalty) / total : 0),
      file: p.sample.file,
      line: p.sample.line,
      severity: p.sample.severity,
    }));
  return { remaining, factors };
}

function capFactor(raw: number, final: number): ScoreFactor[] {
  const diff = round1(final - raw);
  if (Math.abs(diff) < 0.5) return [];
  return [{ label: diff < 0 ? "Capped — static analysis can't prove the absence of issues" : "Floor applied", points: diff }];
}

// ── Breaking change detectors ─────────────────────────────────────────────────

const REMOVED_STATUS = new Set(["removed", "deleted"]);

function removedSymbols(patch: string, re: RegExp): Array<{ name: string; before: string; after?: string }> {
  const removed = new Map<string, string>();
  const added = new Map<string, string>();
  for (const line of patch.split("\n")) {
    const target = line.startsWith("-") && !line.startsWith("---") ? removed : line.startsWith("+") && !line.startsWith("+++") ? added : null;
    if (!target) continue;
    const m = re.exec(line.slice(1));
    if (m) target.set(m[1], line.slice(1).trim());
  }
  return [...removed].map(([name, before]) => ({ name, before, after: added.get(name) }));
}

function detectBreakingChanges(files: Array<{ filename: string; patch?: string; status: string }>): string[] {
  const changes: string[] = [];
  const newEnvVars = new Set<string>();

  for (const file of files) {
    const f = file.filename;
    const patch = file.patch ?? "";
    const base = f.split("/").pop() ?? f;
    const role = fileRole(f);

    if (/migration|migrate/i.test(f) && /\.(sql|ts|js)$/.test(f)) {
      if (patch.includes("DROP TABLE") || patch.includes("DROP COLUMN")) {
        changes.push(`Destructive DB migration in ${base} — DROP operation detected. Data loss risk.`);
      } else if (/ADD COLUMN.+NOT NULL/i.test(patch) && !/DEFAULT/i.test(patch)) {
        changes.push(`Non-nullable column added in ${base} without DEFAULT — will fail on existing rows.`);
      } else if (patch.includes("ALTER TABLE") || patch.includes("CREATE TABLE")) {
        changes.push(`Database schema migration in ${base} — verify backward compatibility with running instances.`);
      }
    }

    if (/\.prisma$/.test(f)) {
      for (const { name } of removedSymbols(patch, /^model\s+(\w+)/)) {
        changes.push(`Prisma model \`${name}\` removed in ${base} — its table and data are dropped by the next migration.`);
      }
      const fields = removedSymbols(patch, /^\s+(\w+)\s+[A-Z]\w*(?:\[\])?\??(?:\s|$)/).filter((s) => !s.after);
      if (fields.length > 0) {
        changes.push(`${fields.length} Prisma field${fields.length > 1 ? "s" : ""} removed in ${base} (${fields.slice(0, 3).map((s) => `\`${s.name}\``).join(", ")}) — the column data is dropped and code still reading it breaks.`);
      }
    }

    if (/app\/api\/|pages\/api\//.test(f)) {
      if (REMOVED_STATUS.has(file.status)) {
        changes.push(`API endpoint removed: ${f} — existing consumers will receive 404 errors.`);
      } else if (/^-\s*export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/m.test(patch)) {
        const methods = removedSymbols(patch, /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/).filter((s) => !s.after);
        if (methods.length > 0) changes.push(`HTTP method${methods.length > 1 ? "s" : ""} ${methods.map((s) => s.name).join(", ")} removed from ${base} — callers using ${methods.length > 1 ? "them" : "it"} will get 405 errors.`);
      }
    }

    if (role === "source" && /\.(?:[cm]?[jt]sx?)$/.test(f) && !REMOVED_STATUS.has(file.status)) {
      const exportsRe = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
      for (const s of removedSymbols(patch, exportsRe)) {
        if (/^(?:GET|POST|PUT|PATCH|DELETE)$/.test(s.name)) continue;
        if (!s.after) {
          changes.push(`Export \`${s.name}\` removed from ${base} — every module importing it will fail to compile.`);
        } else if (/function/.test(s.before)) {
          const params = (line: string) => /\(([^)]*)\)/.exec(line)?.[1].replace(/\s+/g, "") ?? "";
          if (params(s.before) !== params(s.after)) changes.push(`Signature of exported \`${s.name}\` changed in ${base} — review all call sites.`);
        }
      }
    }

    if (role === "source" && /\.py$/.test(f)) {
      for (const s of removedSymbols(patch, /^(?:async\s+)?def\s+([a-zA-Z]\w*)\s*\(/)) {
        if (!s.after) changes.push(`Public function \`${s.name}\` removed from ${base} — importers will raise ImportError.`);
      }
    }

    if (role === "source" && /\.go$/.test(f)) {
      for (const s of removedSymbols(patch, /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)\s*\(/)) {
        if (!s.after) changes.push(`Exported Go function \`${s.name}\` removed from ${base} — dependent packages will not compile.`);
      }
    }

    if (/\.(?:graphql|gql)$/.test(f)) {
      const fields = removedSymbols(patch, /^\s+(\w+)\s*(?:\([^)]*\))?\s*:/).filter((s) => !s.after);
      if (fields.length > 0) changes.push(`${fields.length} GraphQL field${fields.length > 1 ? "s" : ""} removed from ${base} — clients querying ${fields.length > 1 ? "them" : "it"} will get validation errors.`);
    }

    if (/\.d\.ts$|\/types\//.test(f)) {
      if (/^-\s+\w/m.test(patch)) {
        changes.push(`Type definitions modified in ${base} — TypeScript consumers may see compile errors.`);
      }
    }

    if (f === "package.json") {
      if (/"version":\s*"/.test(patch)) {
        changes.push("Package version bumped — ensure CHANGELOG.md is updated with semver-correct notes.");
      }
      const removedDeps = (patch.match(/^-\s+"[^"]+"/gm) ?? []).filter((l) => l.includes('": "'));
      if (removedDeps.length > 0) {
        changes.push(`${removedDeps.length} package(s) removed from package.json — verify no consumers depend on them.`);
      }
      if (/^[-+]\s+"engines"|^[-+]\s+"node"\s*:/m.test(patch)) {
        changes.push("Node.js engine requirement changed in package.json — confirm CI and hosting runtimes match.");
      }
    }

    if (f === "package-lock.json" || f === "yarn.lock" || f === "pnpm-lock.yaml") {
      const addedPkgs = (patch.match(/^\+\s+"[^"]+"/gm) ?? []).length;
      if (addedPkgs > 20) {
        changes.push(`Lock file has ${addedPkgs} new entries — verify no unexpected transitive dependency was introduced.`);
      }
    }

    if (/next\.config|tsconfig\.json|vite\.config|webpack\.config/.test(f)) {
      changes.push(`Build config changed in ${base} — verify CI/CD pipeline and all environments remain compatible.`);
    }

    if (f === ".env.example" || f === ".env.sample") {
      const newVars = (patch.match(/^\+[A-Z_]+=/gm) ?? []).length;
      if (newVars > 0) {
        changes.push(`${newVars} new environment variable${newVars > 1 ? "s" : ""} added to .env.example — update all deployment environments.`);
      }
    } else if (role === "source") {
      for (const m of patch.matchAll(/^\+.*?\b(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]+)|^\+.*?\bos\.(?:environ\.get|getenv)\s*\(\s*["']([A-Z][A-Z0-9_]+)["']/gm)) {
        const name = m[1] ?? m[2];
        if (name && name !== "NODE_ENV" && !new RegExp(`^-.*\\b${name}\\b`, "m").test(patch)) newEnvVars.add(name);
      }
    }

    if (/(?:^|\/)(?:middleware|proxy)\.[jt]s$|auth\./i.test(f)) {
      changes.push(`Auth/middleware changed in ${base} — existing sessions or request pipelines may be affected.`);
    }

    if (REMOVED_STATUS.has(file.status) && role === "test") {
      changes.push(`Test file deleted: ${base} — regression coverage reduced, ensure the feature is tested elsewhere.`);
    }

    if (/index\.(ts|tsx|js)$/.test(f) && /^-\s*export\s+/m.test(patch)) {
      changes.push(`Public export removed from ${base} — downstream imports of this module may break.`);
    }
  }

  const documented = files.some((f) => /\.env\.(?:example|sample|template)$/.test(f.filename));
  if (newEnvVars.size > 0 && !documented) {
    const names = [...newEnvVars];
    changes.push(`New environment variable${names.length > 1 ? "s" : ""} referenced (${names.slice(0, 4).map((n) => `\`${n}\``).join(", ")}${names.length > 4 ? ", …" : ""}) but .env.example was not updated — deployments without ${names.length > 1 ? "them" : "it"} will misbehave.`);
  }

  return [...new Set(changes)].slice(0, 10);
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
  const hasTests = files.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/.test(f.filename));
  const hasSourceChanges = files.some((f) =>
    /src\/|lib\/|api\//.test(f.filename) && !/test|spec/.test(f.filename)
  );
  const hasDocChanges = files.some((f) => /\.md$|docs\//.test(f.filename));
  const hasMigration = files.some((f) => /migration|migrate/i.test(f.filename));
  const isSecurityFix = (commitMessage ?? prTitle ?? "").match(/security|vuln|cve|xss|inject|csrf/i);
  const isPerfImprovement = (commitMessage ?? prTitle ?? "").match(/perf|performance|speed|optim|cache/i);

  // Large diffs are risky and harder to review
  if (totalChanges > 500) { score -= 5; flags.push("large-diff"); }
  if (totalChanges > 2000) { score -= 10; }
  if (totalChanges > 5000) { score -= 10; flags.push("large-diff"); }

  // Tests = high value signal
  if (hasTests) score += 15;
  else if (hasSourceChanges) { score -= 10; flags.push("test-coverage"); }

  // Source code = likely valuable
  if (hasSourceChanges) score += 10;

  // Pure docs — limited impact
  if (hasDocChanges && !hasSourceChanges) score = Math.min(score, 65);

  // Database migration = high risk + high value
  if (hasMigration) { score += 5; flags.push("database"); }

  // Security fixes get a bonus
  if (isSecurityFix) { score += 10; flags.push("security-fix"); }
  if (isPerfImprovement) { score += 5; }

  // Commit message quality
  const msg = (commitMessage ?? prTitle ?? "").toLowerCase();
  if (/^(feat|fix|refactor|perf|security|chore|docs|test|build)(\(.+\))?:/.test(msg)) score += 5;
  if (msg.length < 10) score -= 10;
  if (/^wip\b|^wip$/.test(msg)) { score -= 20; flags.push("style"); }
  if (/fix(ed)?\s+typo|whitespace|formatting/i.test(msg)) score = Math.min(score, 55);

  // PR body quality
  if (prBody && prBody.length > 100) score += 5;
  if (prBody && prBody.length > 300) score += 3;

  return { score: Math.max(10, Math.min(98, score)), flags };
}

// ── Test coverage estimator ───────────────────────────────────────────────────

const CODE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs)$/;

function testStem(path: string): string {
  return (path.split("/").pop() ?? path)
    .replace(/\.[^.]+$/, "")
    .replace(/\.(?:test|spec|e2e|cy)$/, "")
    .replace(/^test_|_test$|Tests?$/, "")
    .toLowerCase();
}

function estimateTestCoverage(files: Array<{ filename: string; additions: number; deletions: number }>): number {
  const testFiles = files.filter((f) => fileRole(f.filename) === "test" && CODE_FILE.test(f.filename));
  const sourceFiles = files.filter((f) => fileRole(f.filename) === "source" && CODE_FILE.test(f.filename));

  if (sourceFiles.length === 0) return 70;
  if (testFiles.length === 0) return 15;

  const testStems = new Set(testFiles.map((f) => testStem(f.filename)));
  const covered = sourceFiles.filter((f) => testStems.has(testStem(f.filename))).length / sourceFiles.length;
  const density = testFiles.length / (sourceFiles.length + testFiles.length);
  return clamp(20 + Math.max(covered, density * 0.8) * 72, 15, 92);
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
  fileContents?: Record<string, string>;
  baseContents?: Record<string, string>;
  repoFiles?: string[];
  project?: Partial<ProjectCtx>;
}

const AUTH_RULES = new Set(["api-route-no-auth", "nextjs-server-action-no-auth"]);

function applyGraph(findings: EngineFinding[], graph: GraphResult): EngineFinding[] {
  const adjusted = findings.flatMap((f): EngineFinding[] => {
    if (AUTH_RULES.has(f.ruleId) && graph.authenticatedFiles.has(f.file)) return [];
    if (f.ruleId === "missing-rate-limit" && graph.rateLimitedFiles.has(f.file)) return [];
    const privileged = f.ruleId === "api-route-no-auth" ? graph.privilegedCalls.get(f.file) : undefined;
    if (privileged) {
      return [{
        ...f,
        severity: "high",
        confidence: Math.max(f.confidence, 0.75),
        description: `${f.description} The handler calls ${privileged}, so an unauthenticated request can change data.`,
      }];
    }
    return [f];
  });
  return mergeByClass([...adjusted, ...graph.findings]);
}

const SUPPRESSION_MARKER = /gitscope-ignore(?:-next-line|-file)?(?::[^\n]*)?|\bnosec\b/g;

function findingFingerprint(f: EngineFinding): string {
  return `${f.ruleId}|${(f.snippet ?? "").replace(/\s+/g, " ").trim()}`;
}

function resolvedByChange(input: InternalAnalysisInput, project: ProjectCtx): EngineFinding[] {
  const base = input.baseContents ?? {};
  const head = input.fileContents ?? {};
  const resolved: EngineFinding[] = [];
  for (const file of input.files) {
    if (REMOVED_STATUS.has(file.status) || file.status === "added") continue;
    const before = base[file.filename];
    const after = head[file.filename];
    if (before === undefined || after === undefined || before === after) continue;
    const baseCtx = buildFileCtx({ filename: file.filename, content: before.replace(SUPPRESSION_MARKER, ""), project });
    const headCtx = buildFileCtx({ filename: file.filename, content: after.replace(SUPPRESSION_MARKER, ""), project });
    if (!baseCtx || !headCtx || baseCtx.role !== "source") continue;
    const headFindings = analyzeFileCtx(headCtx, RULE_PACKS);
    const headPrints = new Set(headFindings.map(findingFingerprint));
    const headCount = new Map<string, number>();
    for (const f of headFindings) headCount.set(f.ruleId, (headCount.get(f.ruleId) ?? 0) + f.occurrences);
    const byRule = new Map<string, EngineFinding[]>();
    for (const f of analyzeFileCtx(baseCtx, RULE_PACKS)) {
      if (!byRule.has(f.ruleId)) byRule.set(f.ruleId, []);
      byRule.get(f.ruleId)!.push(f);
    }
    for (const [ruleId, list] of byRule) {
      const baseTotal = list.reduce((n, f) => n + f.occurrences, 0);
      let budget = baseTotal - (headCount.get(ruleId) ?? 0);
      for (const f of list) {
        if (budget <= 0) break;
        if (headPrints.has(findingFingerprint(f))) continue;
        resolved.push(f);
        budget -= f.occurrences;
      }
    }
  }
  return resolved;
}

function analyzeChangedFiles(input: InternalAnalysisInput): {
  findings: EngineFinding[];
  resolved: EngineFinding[];
  analyzed: number;
  withContext: number;
  graph: GraphResult;
} {
  const contents = input.fileContents ?? {};
  const pkg = parsePackageJson(contents["package.json"]);
  const prodDeps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
  const profile = Object.keys(pkg).length > 0
    ? detectProfile({ fileTree: input.repoFiles ?? input.files.map((f) => f.filename), contents, prodDeps, devDeps, pkg })
    : null;
  const project: ProjectCtx = {
    ...(profile ? projectCtxFrom(profile, { ...devDeps, ...prodDeps }, contents) : EMPTY_PROJECT),
    ...input.project,
  };
  const findings: EngineFinding[] = [];
  const contexts: FileCtx[] = [];
  const changed = new Set<string>();
  let analyzed = 0;
  let withContext = 0;
  for (const file of input.files) {
    if (!file.patch || REMOVED_STATUS.has(file.status)) continue;
    const ctx = buildFileCtx({ filename: file.filename, patch: file.patch, content: input.fileContents?.[file.filename], project });
    if (!ctx) continue;
    analyzed++;
    changed.add(file.filename);
    if (!ctx.lineMap) withContext++;
    contexts.push(ctx);
    findings.push(...analyzeFileCtx(ctx, RULE_PACKS));
  }
  for (const [filename, content] of Object.entries(input.fileContents ?? {})) {
    if (changed.has(filename)) continue;
    const ctx = buildFileCtx({ filename, content, project });
    if (ctx) contexts.push(ctx);
  }
  const known = new Set([...(input.repoFiles ?? []), ...input.files.map((f) => f.filename), ...Object.keys(input.fileContents ?? {})]);
  const graph = analyzeProjectGraph({
    contexts,
    fileSet: known,
    targets: changed,
    tsconfig: input.fileContents?.["tsconfig.json"],
    completeTree: Boolean(input.repoFiles && input.repoFiles.length > 0 && input.repoFiles.length < 100_000),
  });
  const merged = applyGraph(findings, graph);
  const resolvedRaw = input.baseContents ? resolvedByChange(input, project) : [];
  const resolved = (profile ? calibrateFindings(resolvedRaw, profile) : resolvedRaw).sort(compareFindings);
  return { findings: (profile ? calibrateFindings(merged, profile) : merged).sort(compareFindings), resolved, analyzed, withContext, graph };
}

function toReviewFinding(f: EngineFinding): CodeReviewFinding {
  return {
    severity: f.severity,
    category: f.category,
    file: f.file,
    line: f.line,
    description: describeFinding(f),
    suggestion: f.suggestion,
    codeSnippet: f.snippet,
    fix: f.fix,
  };
}

function firstSentence(s: string): string {
  const m = /^(.+?\.)(?:\s|$)/.exec(s);
  return (m ? m[1] : s).slice(0, 180);
}

export function analyzeWithInternalAI(input: InternalAnalysisInput): CodeReviewResult {
  const { repo, files, prMeta, commitMeta, analysisType } = input;

  const title = prMeta?.title ?? commitMeta?.commit.message.split("\n")[0] ?? "Unknown change";
  const totalAdditions = prMeta?.additions ?? commitMeta?.stats?.additions ?? files.reduce((a, f) => a + f.additions, 0);
  const totalDeletions = prMeta?.deletions ?? commitMeta?.stats?.deletions ?? files.reduce((a, f) => a + f.deletions, 0);

  const { findings: engineFindings, resolved, analyzed, withContext } = analyzeChangedFiles(input);
  const securityFindings = engineFindings.filter((f) => f.category === "security");
  const qualityFindings = engineFindings.filter((f) => f.category === "quality");
  const securityScore = clamp(96 * Math.exp(-penaltyOf(securityFindings) / 70), 0, 100);
  const qualityScore = clamp(20 + 75 * Math.exp(-penaltyOf(qualityFindings) / 45), 20, 95);
  const { score: valueScore, flags: valueFlags } = scoreValue({
    files,
    commitMessage: commitMeta?.commit.message,
    prTitle: prMeta?.title,
    prBody: prMeta?.body ?? undefined,
  });
  const breakingChanges = detectBreakingChanges(files);
  const testCoverage = estimateTestCoverage(files);
  const allFindings = engineFindings.map(toReviewFinding);

  const confident = (f: EngineFinding) => f.confidence >= 0.6;
  const criticalCount = engineFindings.filter((f) => f.severity === "critical" && confident(f)).length;
  const highCount = engineFindings.filter((f) => f.severity === "high" && confident(f)).length;
  const mediumCount = engineFindings.filter((f) => f.severity === "medium").length;
  const taintFlows = securityFindings.filter((f) => /^(?:taint|xfile|interproc)-/.test(f.ruleId)).length;
  const crossFileFlows = securityFindings.filter((f) => f.ruleId.startsWith("xfile-")).length;
  const secretCount = securityFindings.filter((f) => f.cls === "secret").length;

  const flags = [...new Set([
    ...valueFlags,
    ...(breakingChanges.length > 0 ? ["breaking-change"] : []),
    ...(securityScore < 60 ? ["security"] : []),
    ...(securityFindings.some((f) => f.severity === "critical" || f.severity === "high") ? ["security"] : []),
    ...(secretCount > 0 ? ["secrets"] : []),
    ...(files.some((f) => /auth|login|session|oauth/i.test(f.filename)) ? ["auth"] : []),
    ...(files.some((f) => /migration|\.sql|\.prisma$/i.test(f.filename)) ? ["database"] : []),
    ...(files.some((f) => /package\.json|requirements\.txt|Gemfile|go\.mod|Cargo\.toml|pyproject\.toml/.test(f.filename)) ? ["deps"] : []),
    ...(files.some((f) => /api\//.test(f.filename)) ? ["api-contract"] : []),
    ...(files.some((f) => /\.github\/workflows\/|Dockerfile|docker-compose|\.tf$/.test(f.filename)) ? ["infra"] : []),
    ...(files.some((f) => fileRole(f.filename) === "test") ? ["tests"] : []),
  ])];

  let verdict: CodeReviewResult["verdict"];
  let mergeRisk: CodeReviewResult["mergeRisk"];

  if (criticalCount > 0 || breakingChanges.length > 3 || securityScore < 40) {
    verdict = "REQUEST_CHANGES";
    mergeRisk = criticalCount > 0 ? "critical" : "high";
  } else if (highCount > 1 || breakingChanges.length > 0 || securityScore < 65) {
    verdict = "COMMENT";
    mergeRisk = "medium";
  } else if (highCount === 0 && securityScore >= 75) {
    verdict = "APPROVE";
    mergeRisk = "low";
  } else {
    verdict = "COMMENT";
    mergeRisk = "medium";
  }

  const confidence = Math.min(90,
    45 +
    (files.length > 0 ? 10 : 0) +
    (analyzed > 0 ? 15 : 0) +
    (analyzed > 0 ? Math.round((withContext / analyzed) * 10) : 0) +
    (allFindings.length > 0 ? 5 : 0) +
    (breakingChanges.length > 0 ? 5 : 0)
  );

  const summaryParts: string[] = [];
  if (analysisType === "pr") {
    summaryParts.push(
      `PR "${title}" in ${repo} touches ${files.length} file${files.length !== 1 ? "s" : ""} (+${totalAdditions}/-${totalDeletions} lines).`
    );
  } else {
    summaryParts.push(
      `Commit "${title.slice(0, 60)}" in ${repo} modifies ${files.length} file${files.length !== 1 ? "s" : ""}.`
    );
  }

  if (criticalCount > 0) {
    summaryParts.push(`${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} found — do not merge until resolved.`);
  } else if (highCount > 0) {
    summaryParts.push(`${highCount} high-severity issue${highCount > 1 ? "s" : ""} warrant review before merging.`);
  } else if (mediumCount > 0 && verdict === "COMMENT") {
    summaryParts.push(`${mediumCount} medium-severity concern${mediumCount > 1 ? "s" : ""} noted — review before merging.`);
  } else if (verdict === "APPROVE") {
    summaryParts.push("No significant issues detected in the added lines.");
  }

  if (taintFlows > 0) {
    summaryParts.push(`${taintFlows} confirmed flow${taintFlows > 1 ? "s" : ""} of user input into a dangerous sink (SQL, shell, filesystem, network or HTML)${crossFileFlows > 0 ? `, ${crossFileFlows} of them crossing module boundaries` : ""}.`);
  }
  if (secretCount > 0) {
    summaryParts.push(`${secretCount} hardcoded credential${secretCount > 1 ? "s" : ""} added — rotate ${secretCount > 1 ? "them" : "it"} even after removing from the diff.`);
  }
  if (breakingChanges.length > 0) {
    summaryParts.push("Breaking changes detected — coordinate with downstream consumers before deploying.");
  }
  if (resolved.length > 0) {
    const serious = resolved.filter((f) => f.severity === "critical" || f.severity === "high").length;
    summaryParts.push(`Resolves ${resolved.length} pre-existing issue${resolved.length > 1 ? "s" : ""}${serious > 0 ? ` (${serious} critical/high)` : ""} found in the base version of the changed files.`);
  }

  const positives: string[] = [];
  if (securityScore >= 85) positives.push("No security vulnerabilities detected in the added lines");
  else if (securityScore >= 70) positives.push("Minor security notes only — no critical or high severity issues");
  if (analyzed > 0 && secretCount === 0) positives.push("No hardcoded secrets or credentials in the added code");
  if (testCoverage >= 60) positives.push("Good test coverage accompanying the changes");
  else if (testCoverage >= 40) positives.push("Some test coverage included with the changes");
  if (files.some((f) => /\.md$/.test(f.filename))) positives.push("Documentation updated alongside the code");
  if (/^(feat|fix|refactor|perf|security|chore|docs|test)(\(.+\))?!?:/.test(title)) positives.push("Conventional commit message format — great for changelog generation");
  if (totalAdditions < 150 && files.length > 1) positives.push("Focused, well-scoped change — easy to review");
  if (resolved.length > 0) {
    const notable = resolved.filter((f) => f.severity !== "low");
    positives.unshift(`Fixes ${resolved.length} pre-existing issue${resolved.length > 1 ? "s" : ""}${notable.length > 0 ? `, including ${notable.slice(0, 2).map((f) => `${firstSentence(describeFinding(f)).replace(/\.$/, "")} (${f.file.split("/").pop()})`).join("; ")}` : ""}`);
  }
  if (positives.length === 0) positives.push("Change is syntactically valid and follows basic code structure");

  const hotFiles = [...files]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, 5)
    .map((f) => f.filename);

  const impactAreas: string[] = [];
  if (files.some((f) => /auth|login|session|oauth/i.test(f.filename))) impactAreas.push("authentication");
  if (files.some((f) => /api\//.test(f.filename))) impactAreas.push("API");
  if (files.some((f) => /prisma|migration|\.sql/i.test(f.filename))) impactAreas.push("database");
  if (files.some((f) => /components?\/|pages?\/|app\//.test(f.filename))) impactAreas.push("frontend");
  if (files.some((f) => /lib\/|utils?\/|helpers?\//.test(f.filename))) impactAreas.push("shared-utilities");
  if (files.some((f) => fileRole(f.filename) === "test")) impactAreas.push("test-suite");
  if (files.some((f) => /(?:^|\/)(?:middleware|proxy)\.[jt]s$|\.middleware\./.test(f.filename))) impactAreas.push("middleware");
  if (files.some((f) => /package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml/.test(f.filename))) impactAreas.push("dependencies");
  if (files.some((f) => /\.github\/workflows\/|Dockerfile|docker-compose|\.tf$|k8s\/|helm\//.test(f.filename))) impactAreas.push("infrastructure");

  let recommendation = "";
  if (verdict === "REQUEST_CHANGES") {
    recommendation = `Fix the ${criticalCount > 0 ? `${criticalCount} critical issue${criticalCount > 1 ? "s" : ""}` : "identified high-severity issues"} before merging${securityFindings[0] ? ` — start with ${locationOf(securityFindings[0])}` : ""}.${breakingChanges.length > 0 ? " Coordinate breaking changes with all consumers." : ""}`;
  } else if (verdict === "COMMENT") {
    recommendation = `Review the ${highCount > 0 ? `${highCount} high` : `${mediumCount} medium`}-severity concern${highCount + mediumCount > 1 ? "s" : ""} and confirm they are acceptable or addressed.${breakingChanges.length > 0 ? " Document breaking changes in the PR description." : ""} The change is mergeable once reviewed.`;
  } else {
    recommendation = "Static analysis is clean. Confirm CI passes and do a final human review of the logic, then merge.";
  }

  const reviewChecklist = [
    `Review all ${files.length} changed file${files.length !== 1 ? "s" : ""} for logical correctness`,
    ...(securityFindings.length > 0 ? [`Address ${securityFindings.length} security finding${securityFindings.length > 1 ? "s" : ""} before merge`] : []),
    ...(secretCount > 0 ? ["Rotate every credential that appeared in the diff"] : []),
    ...(testCoverage < 40 ? ["Add tests for new/changed code paths"] : []),
    ...(breakingChanges.length > 0 ? ["Document and communicate all breaking changes to consumers"] : []),
    "Verify all CI/CD checks pass",
    ...(flags.includes("database") ? ["Test DB migration against a copy of production data"] : []),
    ...(flags.includes("auth") ? ["Security review authentication/session changes"] : []),
    ...(flags.includes("deps") ? ["Verify new/changed dependencies have no known CVEs"] : []),
  ].slice(0, 8);

  const reviewMins = Math.max(10, Math.min(120,
    15 + Math.floor(files.length * 3) + Math.floor((totalAdditions + totalDeletions) / 50)
  ));
  const estimatedReviewTime = reviewMins < 60 ? `${reviewMins} min` : `${Math.round(reviewMins / 60 * 10) / 10}h`;

  const securityIssues = [...new Set(
    securityFindings
      .filter((f) => f.severity !== "low")
      .map((f) => `${firstSentence(describeFinding(f))} (${locationOf(f)})`)
  )].slice(0, 6);

  return {
    verdict,
    confidence,
    summary: summaryParts.join(" "),
    mergeRisk,
    scores: {
      security: securityScore,
      value: valueScore,
      quality: qualityScore,
      testCoverage,
      breakingRisk: Math.min(95, breakingChanges.length * 18 + (mergeRisk === "critical" ? 45 : mergeRisk === "high" ? 28 : 12)),
    },
    flags,
    findings: allFindings.slice(0, 20),
    resolvedFindings: resolved.slice(0, 12).map(toReviewFinding),
    breakingChanges,
    securityIssues,
    positives,
    recommendation,
    reviewChecklist,
    estimatedReviewTime,
    suggestedReviewers: Math.min(5, 1 + Math.floor(files.length / 5) + (criticalCount > 0 ? 2 : highCount > 0 ? 1 : 0)),
    impactAreas,
    affectedSystems: impactAreas.map((a) =>
      a === "authentication" ? "Auth Service" :
      a === "API" ? "Backend API" :
      a === "database" ? "Database" :
      a === "frontend" ? "Frontend UI" :
      a === "shared-utilities" ? "Shared Libraries" :
      a === "test-suite" ? "Test Suite" :
      a === "middleware" ? "Request Middleware" :
      a === "infrastructure" ? "Infrastructure / CI" :
      "Dependency Tree"
    ),
    diffStats: {
      fileCount: files.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      hotFiles,
    },
    model: "gitscope-internal-v4",
    isDemo: false,
  };
}

// ── Public wrappers ───────────────────────────────────────────────────────────

export async function analyzeWithBestAvailableEngine(
  input: InternalAnalysisInput,
): Promise<CodeReviewResult> {
  return analyzeWithInternalAI(input);
}

export async function scanRepoWithBestAvailableEngine(
  input: InternalRepoScanInput,
): Promise<RepoScanResult> {
  return scanRepoWithInternalAI(input);
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
  /** Real LOC computed from GitHub file sizes — use instead of estimating */
  realLoc?: string;
  /** LOC broken down by file extension */
  realLocByExt?: Record<string, number>;
  /** Total number of code files in the repo */
  totalCodeFiles?: number;
  /** Import graph: file → list of import specifiers it imports */
  importGraph?: Record<string, string[]>;
  truncatedFiles?: string[];
  completeTree?: boolean;
  vulnerabilities?: Vulnerability[];
  dependencyScan?: { scanned: number; lockfiles: string[]; complete: boolean };
}

// Files that are never code — skip during content scanning
const NON_CODE_EXTENSIONS = /\.(md|txt|lock|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|tar|gz|map|d\.ts)$/;

// ── Expanded risky dependency table ───────────────────────────────────────────
const RISKY_DEP_REASONS: Record<string, string> = {
  // Deprecated / archived
  "moment": "deprecated — migrate to date-fns or dayjs (smaller, tree-shakeable)",
  "request": "archived — migrate to native fetch, got, or axios",
  "node-uuid": "deprecated — use the 'uuid' package",
  "colors": "supply-chain incident — use 'chalk' or 'kleur'",
  "faker": "now '@faker-js/faker' — the old package is unmaintained",
  "event-stream": "supply-chain attack history — avoid unless absolutely necessary",
  "left-pad": "removed from npm in 2016 — use String.prototype.padStart()",
  "is-thirteen": "joke package — remove",
  "core-js": "bundle bloat — use targeted polyfills or target modern browsers",
  // Cryptographically weak
  "md5": "MD5 is broken — use crypto.createHash('sha256')",
  "md5-hex": "MD5 is broken — use crypto.createHash('sha256')",
  "crc32": "not cryptographically secure — use SHA-256 for integrity checks",
  "bcrypt": "OK for passwords but slow — ensure it doesn't block event loop; use bcryptjs in serverless",
  // Bundle weight / superseded
  "lodash": "large bundle — use native ES2020+ or lodash-es with tree-shaking",
  "underscore": "superseded by lodash-es/native — migrate",
  "jquery": "unnecessary in modern SPAs — use native DOM APIs or a framework",
  "bluebird": "Promises are native since Node 10 — use native Promise or async/await",
  "q": "archived — use native Promise or async/await",
  "async": "archived utility — use native async/await",
  // Security concerns
  "node-serialize": "known RCE vulnerability (CVE-2017-5941) — never use for untrusted data",
  "serialize-javascript": "verify usage — unsafe deserialization is possible with eval",
  "ini": "prototype pollution vulnerability in versions < 1.3.6 — pin to 1.3.8+",
  "minimist": "prototype pollution — ensure version >= 1.2.6",
  "path-parse": "ReDoS vulnerability in < 1.0.7 — ensure latest",
  "semver": "ReDoS in < 7.5.2 — ensure latest",
  // Outdated / poor maintenance
  "xml2js": "XXE risk if using older versions; prefer fast-xml-parser with entity processing disabled",
  "htmlparser2": "verify version — older versions had XSS issues",
  "express": "if < 4.21.0 — update for security fixes",
  "multer": "verify version — ensure >= 1.4.5-lts.1 for path traversal fixes",
  "passport": "ensure passport-local uses bcrypt; verify session handling is correct",
  "jsonwebtoken": "verify version >= 9.0.0 for security fixes",
  // ── More deprecated / archived ─────────────────────────────────────────────
  "node-fetch": "v2 is CommonJS-only and outdated — use native fetch (Node 18+) or upgrade to node-fetch v3",
  "cross-fetch": "unnecessary in Node 18+ — native fetch is available globally",
  "got": "v11 and below have known SSRF risks — ensure latest v12+ with redirect limits",
  "superagent": "poorly maintained — migrate to native fetch or ky",
  "mongoose-paginate": "unmaintained — use mongoose-paginate-v2 or manual pagination",
  "chalk": "v4 is CommonJS; v5 is ESM-only — pin correctly to avoid CJS/ESM mismatch",
  "glob": "v7 and below use sync methods that block the event loop — upgrade to v9+ with async API",
  "rimraf": "v3 and below use sync fs — upgrade to v5+ or use fs.rm(path, { recursive: true })",
  "mkdirp": "superseded by fs.mkdir with { recursive: true } in Node 12+",
  "ncp": "unmaintained — use fs.cp() (Node 16.7+) or cpx",
  "concurrently": "OK but verify version — older versions had shell injection in custom args",
  "node-gyp": "requires Python/build tools — prefer pure-JS alternatives when possible",
  "fibers": "deprecated since Node 16 — async/await is the correct pattern",
  "domain": "deprecated Node.js module — use async_hooks or error boundaries instead",
  // ── Bundle weight ──────────────────────────────────────────────────────────
  "rxjs": "large if not tree-shaken — use pipeable operators and ensure bundler can tree-shake",
  "immutable": "large library — consider Immer (smaller, proxy-based) for immutable patterns",
  "ramda": "large functional library — import named functions to tree-shake",
  "mathjs": "very large (~200KB) — consider mathjs/entry/number for a lighter build",
  "three": "WebGL library ~600KB — always lazy-load: React.lazy(() => import('./ThreeScene'))",
  "pdfmake": "heavy PDF library — lazy-load or use a server-side generation approach",
  "exceljs": "large Excel library — lazy-load; consider server-side generation",
  "puppeteer": "bundles Chromium (~170MB) — use puppeteer-core + system Chrome in production",
  "jsdom": "heavy DOM emulation — only use in tests; never bundle for the client",
  // ── Security CVEs ──────────────────────────────────────────────────────────
  "node-ipc": "supply-chain attack (deliberate malware in 10.1.1, 10.1.2) — audit usage",
  "ua-parser-js": "supply-chain attack in 0.7.29, 1.0.0-0.1.0 — pin to 0.7.33+ or 1.0.2+",
  "flatmap-stream": "supply-chain malware targeting bitcoin wallets — remove immediately",
  "rc": "prototype pollution in < 1.2.8 — ensure latest",
  "ansi-regex": "ReDoS in < 5.0.1 — ensure latest",
  "nth-check": "ReDoS vulnerability — ensure >= 2.0.1",
  "parse-url": "SSRF + open redirect vulnerabilities — ensure >= 6.0.0 or replace",
  "lodash.template": "prototype pollution — ensure >= 4.5.0; prefer handlebars or ejs",
  "handlebars": "prototype pollution in < 4.7.7 — ensure latest",
  "marked": "XSS in older versions — ensure >= 4.0.0 or use DOMPurify with it",
  "dompurify": "XSS bypass in some versions — always pin to latest",
  "sanitize-html": "XSS bypass reported in some versions — ensure latest and review allowlist",
  "netmask": "SSRF / IP parse confusion — ensure >= 2.0.1",
  "is-svg": "ReDoS vulnerability — ensure >= 4.3.0",
  "postcss": "parsing error in < 8.4.31 — ensure latest",
  "braces": "ReDoS vulnerability — ensure >= 3.0.3",
  "follow-redirects": "open redirect and header leak — ensure >= 1.15.4",
  "tough-cookie": "prototype pollution in < 4.1.3 — ensure latest",
  "undici": "multiple CVEs in < 5.28.3 — ensure latest",
  "ws": "DoS vulnerability in < 8.17.1 — ensure latest",
  "tar": "path traversal in < 6.2.1 — ensure latest",
  "word-wrap": "ReDoS in < 1.2.4 — ensure latest",
  // ── Auth / Payments — verify config ───────────────────────────────────────
  "stripe": "ensure webhooks validated with stripe.webhooks.constructEvent() + raw body",
  "paypal-rest-sdk": "deprecated — migrate to @paypal/checkout-server-sdk",
  "braintree": "verify webhook signature validation and 3DS enforcement",
  "twilio": "verify auth token stored securely; validate webhook signatures",
  "aws-sdk": "v2 is in maintenance mode — migrate to @aws-sdk/* v3 (modular, tree-shakeable)",
  "@aws-sdk/client-s3": "ensure S3 bucket policies block public access; sign all URLs",
  "firebase-admin": "verify service account key not committed; use Workload Identity in GCP",
  "googleapis": "verify OAuth scopes are minimal; rotate service account keys regularly",
  "sendgrid": "now @sendgrid/mail — verify webhook signature validation",
  "@sendgrid/mail": "verify webhook signature validation with sendgrid.eventWebhook.verifySignature()",
  "resend": "verify API key stored in env only; never expose in client-side code",
  // ── ORM / DB ───────────────────────────────────────────────────────────────
  "sequelize": "SQL injection via prototype pollution in < 6.29.0 — ensure latest",
  "knex": "verify all user input uses parameterized bindings — .where('id', userId) not .whereRaw",
  "mongoose": "ensure mongoose >= 7.0 for security fixes; disable autoIndex in production",
  "typeorm": "SQL injection risk in .query() with template literals — use .createQueryBuilder()",
  // ── Testing (dev-only concerns) ────────────────────────────────────────────
  "nock": "ensure not bundled in production builds — devDependency only",
  "msw": "ensure not bundled in production builds — devDependency only",
  "sinon": "powerful stubbing — ensure stubs are always restored to avoid test pollution",
};

const DEP_FIXED_IN: Record<string, string> = {
  "ini": "1.3.6",
  "minimist": "1.2.6",
  "path-parse": "1.0.7",
  "semver": "7.5.2",
  "express": "4.21.0",
  "multer": "1.4.5",
  "jsonwebtoken": "9.0.0",
  "node-fetch": "3.0.0",
  "got": "12.0.0",
  "glob": "9.0.0",
  "rimraf": "5.0.0",
  "ua-parser-js": "0.7.33",
  "rc": "1.2.8",
  "ansi-regex": "5.0.1",
  "nth-check": "2.0.1",
  "parse-url": "6.0.0",
  "lodash.template": "4.5.0",
  "handlebars": "4.7.7",
  "marked": "4.0.0",
  "netmask": "2.0.1",
  "is-svg": "4.3.0",
  "postcss": "8.4.31",
  "braces": "3.0.3",
  "follow-redirects": "1.15.4",
  "tough-cookie": "4.1.3",
  "undici": "5.28.3",
  "ws": "8.17.1",
  "tar": "6.2.1",
  "word-wrap": "1.2.4",
  "sequelize": "6.29.0",
  "mongoose": "7.0.0",
};

const DEP_DEV_ONLY = new Set(["jsdom", "nock", "msw", "sinon", "puppeteer"]);

const DEP_ADVISORY = new Set([
  "stripe", "resend", "twilio", "braintree", "@aws-sdk/client-s3", "firebase-admin", "googleapis",
  "@sendgrid/mail", "passport", "knex", "typeorm", "concurrently", "chalk", "rxjs", "immutable", "ramda",
  "bcrypt", "dompurify", "sanitize-html", "xml2js", "htmlparser2", "node-gyp", "core-js", "mathjs", "three",
  "pdfmake", "exceljs", "lodash", "serialize-javascript", "superagent", "cross-fetch", "mkdirp",
]);

function declaredMinVersion(range: string): number[] | null {
  if (/^(?:workspace|file|link|git|github|https?|npm):/.test(range)) return null;
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

function versionBelow(declared: number[], fixed: string): boolean {
  const target = fixed.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const a = declared[i] ?? 0;
    const b = target[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
}

interface RiskyDep {
  name: string;
  range: string;
  reason: string;
}

function riskyDependencies(prodDeps: Record<string, string>, devDeps: Record<string, string>): RiskyDep[] {
  const out: RiskyDep[] = [];
  for (const [name, reason] of Object.entries(RISKY_DEP_REASONS)) {
    const isProd = name in prodDeps;
    const range = prodDeps[name] ?? devDeps[name];
    if (range === undefined || DEP_ADVISORY.has(name)) continue;
    if (DEP_DEV_ONLY.has(name) && !isProd) continue;
    const fixed = DEP_FIXED_IN[name];
    if (fixed) {
      const declared = declaredMinVersion(range);
      if (!declared || !versionBelow(declared, fixed)) continue;
    }
    out.push({ name, range, reason });
  }
  return out;
}

const COMMITTED_ENV_FILE = /(?:^|\/)\.env(?:\.(?:local|production|prod|development|dev|staging|test))?$/;
const COMMITTED_KEY_FILE = /(?:^|\/)id_(?:rsa|dsa|ecdsa|ed25519)$|\.(?:key|p12|pfx|jks|keystore|ppk)$/;

function toScanFinding(f: EngineFinding): RepoScanFinding {
  return {
    severity: f.severity,
    category: f.category,
    file: f.file,
    line: f.line,
    description: describeFinding(f),
    suggestion: f.suggestion,
    fix: f.fix,
  };
}

function capPerRule(findings: EngineFinding[], perRule: number): EngineFinding[] {
  const seen = new Map<string, number>();
  return findings.filter((f) => {
    const n = seen.get(f.ruleId) ?? 0;
    seen.set(f.ruleId, n + 1);
    return n < perRule;
  });
}

export function scanRepoWithInternalAI(input: InternalRepoScanInput): RepoScanResult {
  const { repo, fileTree, keyFileContents, contributors, meta } = input;

  // ── Package.json parsing ───────────────────────────────────────────────────
  let pkg: Record<string, unknown> = {};
  const rawPkg = keyFileContents["package.json"] ??
    keyFileContents[Object.keys(keyFileContents).find((k) => k.endsWith("/package.json")) ?? ""];
  if (rawPkg) { try { pkg = JSON.parse(rawPkg); } catch { /* ok */ } }

  const prodDeps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDepsObj = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...prodDeps, ...devDepsObj };
  const depCount = Object.keys(deps).length;
  const profileInput: ProfileInput = { fileTree, contents: keyFileContents, prodDeps, devDeps: devDepsObj, pkg };
  const profile = detectProfile(profileInput);

  // ── Evidence-based detection flags ────────────────────────────────────────
  const contentKeys = Object.keys(keyFileContents);

  const hasTypeScript = fileTree.some((f) => f.endsWith(".ts") || f.endsWith(".tsx")) || "typescript" in deps;
  const hasTests = fileTree.some((f) => fileRole(f) === "test" && CODE_FILE.test(f));
  const hasTestDir = fileTree.some((f) =>
    f.startsWith("test/") || f.startsWith("__tests__/") || f.startsWith("spec/") || f.startsWith("tests/") || f.startsWith("e2e/")
  );
  const hasDocker = fileTree.some((f) => f === "Dockerfile" || f.startsWith("docker-compose") || f === ".dockerignore");
  const hasKubernetes = fileTree.some((f) => /\.k8s\.|kubernetes\/|helm\/|k8s\//.test(f) || f === "k8s.yml" || f === "k8s.yaml");

  const hasCI = fileTree.some((f) =>
    /^\.github\/workflows\/.+\.ya?ml$/i.test(f) ||
    f === ".gitlab-ci.yml" ||
    /^\.circleci\/config\.ya?ml$/.test(f) ||
    f === "Jenkinsfile" || f === ".travis.yml" || f === "circle.yml" ||
    f === "bitbucket-pipelines.yml" || f === "azure-pipelines.yml" ||
    f === "Makefile"
  );

  const hasLinting =
    fileTree.some((f) =>
      /\.eslintrc\.(json|js|cjs|mjs|yml|yaml)$|^\.eslintrc$/.test(f) ||
      /^eslint\.config\.(js|mjs|cjs|ts)$/.test(f) ||
      f === "biome.json" || f === "biome.jsonc" || f === ".xo-config.js" ||
      f === "ruff.toml" || f === ".golangci.yml" || f === ".golangci.yaml" || f === ".rubocop.yml"
    ) ||
    contentKeys.some((k) => /eslint\.config|\.eslintrc/.test(k)) ||
    "eslint" in deps || "biome" in deps || "@biomejs/biome" in deps || "xo" in deps;

  const hasFormatting =
    fileTree.some((f) => f === ".prettierrc" || f === ".prettierrc.json" || f === "prettier.config.js" || f === ".editorconfig") ||
    "prettier" in deps;

  const hasPrisma = fileTree.some((f) => f.startsWith("prisma/")) || "prisma" in deps || "@prisma/client" in deps;
  const hasDrizzle = "drizzle-orm" in deps;
  const hasMongoose = "mongoose" in deps;
  const hasSequelize = "sequelize" in deps;
  const hasTypeORM = "typeorm" in deps;
  const hasAnyORM = hasPrisma || hasDrizzle || hasMongoose || hasSequelize || hasTypeORM;

  const hasNextJs = "next" in deps;
  const hasRemix = "@remix-run/react" in deps || "@remix-run/node" in deps;
  const hasAstro = "astro" in deps;
  const hasSvelte = "svelte" in deps || "@sveltejs/kit" in deps;
  const hasVue = "vue" in deps || "@vue/core" in deps;
  const hasAngular = "@angular/core" in deps;
  const hasReact = "react" in deps;
  const hasExpressOrFastify = "express" in deps || "fastify" in deps || "koa" in deps || "@hapi/hapi" in deps || "hapi" in deps;
  const hasTrpc = "@trpc/server" in deps || "@trpc/client" in deps;
  const hasGraphQL = "graphql" in deps || "@apollo/client" in deps || "apollo-server" in deps ||
    "apollo-server-express" in deps || "pothos" in deps ||
    fileTree.some((f) => f.endsWith(".graphql") || f.endsWith(".gql"));

  const hasAuth = "next-auth" in deps || "passport" in deps || "@auth/core" in deps ||
    "jose" in deps || "@clerk/nextjs" in deps || "lucia" in deps || "better-auth" in deps ||
    "auth0" in deps || "@auth0/nextjs-auth0" in deps;

  const hasStripe = "stripe" in deps;
  const hasRedis = "ioredis" in deps || "redis" in deps || "@upstash/redis" in deps;
  const hasQueue = "bull" in deps || "bullmq" in deps || "bee-queue" in deps;
  const hasEmail = "nodemailer" in deps || "resend" in deps || "@sendgrid/mail" in deps || "postmark" in deps;
  const hasMonitoring = "sentry" in deps || "@sentry/node" in deps || "@sentry/nextjs" in deps ||
    "datadog" in deps || "newrelic" in deps || "pino" in deps || "winston" in deps;

  const hasMigrations = fileTree.some((f) => /migration|migrate/i.test(f) && /\.(sql|ts|js)$/.test(f));
  const hasEnvExample = fileTree.some((f) => /(?:^|\/)\.env\.(?:example|sample|template)$/.test(f));
  const hasFeatureModules = fileTree.filter((f) => f.startsWith("src/features/")).length > 3;
  const hasApiRoutes = fileTree.filter((f) => /\/api\//.test(f)).length > 2;
  const hasSrcDir = fileTree.some((f) => f.startsWith("src/"));
  const hasAppDir = fileTree.some((f) => f.startsWith("app/") || f.startsWith("src/app/"));

  const hasMonorepo = fileTree.some((f) => f === "turbo.json" || f === "nx.json" || f === "lerna.json" || f === "pnpm-workspace.yaml");
  const hasWorkspaces = Array.isArray(pkg.workspaces);

  const hasJest = "jest" in deps;
  const hasVitest = "vitest" in deps;
  const hasMocha = "mocha" in deps;
  const hasCypress = "cypress" in deps;
  const hasPlaywright = "@playwright/test" in deps || "playwright" in deps;
  const hasTestingLibrary = "@testing-library/react" in deps || "@testing-library/vue" in deps;
  const hasAnyE2E = hasCypress || hasPlaywright;
  const hasAnyTestFramework = hasJest || hasVitest || hasMocha || "pytest" in deps || "jasmine" in deps;

  const hasServerless = fileTree.some((f) => f === "serverless.yml" || f === "vercel.json" || f === "netlify.toml" || f === ".vercel");

  const hasHelmet = "helmet" in deps;
  const hasCsrfProtection = "csrf" in deps || "csurf" in deps || "lusca" in deps;
  const hasRateLimit = "express-rate-limit" in deps || "rate-limiter-flexible" in deps || "@upstash/ratelimit" in deps;

  // ── LOC — prefer real data from GitHub file sizes, fall back to content-based estimate ──
  let estimatedLoc: string;
  if (input.realLoc && input.realLoc !== "Unknown") {
    estimatedLoc = input.realLoc;
  } else {
    let fetchedLines = 0;
    let fetchedFileCount = 0;
    for (const [fname, content] of Object.entries(keyFileContents)) {
      if (!content || fname === "package.json" || NON_CODE_EXTENSIONS.test(fname)) continue;
      fetchedLines += content.split("\n").length;
      fetchedFileCount++;
    }
    const avgLinesPerFile = fetchedFileCount > 0 ? fetchedLines / fetchedFileCount : 100;
    const codeFiles = fileTree.filter((f) => !NON_CODE_EXTENSIONS.test(f));
    const rawEstLoc = Math.round(avgLinesPerFile * codeFiles.length);
    estimatedLoc =
      rawEstLoc < 1_000 ? `${rawEstLoc} lines` :
      rawEstLoc < 10_000 ? `${(rawEstLoc / 1000).toFixed(1)}k lines` :
      `${Math.round(rawEstLoc / 1000)}k lines`;
  }

  const project = projectCtxFrom(profile, deps, keyFileContents);
  const perFileFindings: EngineFinding[] = [];
  const contexts: FileCtx[] = [];
  for (const [filename, content] of Object.entries(keyFileContents)) {
    if (!content || NON_CODE_EXTENSIONS.test(filename)) continue;
    const ctx = buildFileCtx({ filename, content, project });
    if (!ctx) continue;
    contexts.push(ctx);
    perFileFindings.push(...analyzeFileCtx(ctx, RULE_PACKS));
  }
  const graphSources = fileTree.filter((f) => /\.(?:[cm]?[jt]sx?|py)$/.test(f) && fileRole(f) === "source");
  const graphCoverage = graphSources.length > 0 ? graphSources.filter((f) => f in keyFileContents).length / graphSources.length : 0;
  const graph = analyzeProjectGraph({
    contexts,
    fileSet: new Set(fileTree),
    tsconfig: keyFileContents["tsconfig.json"],
    completeTree: input.completeTree ?? fileTree.length < 2000,
    fullCoverage: graphCoverage >= 0.97,
    truncated: new Set(input.truncatedFiles ?? []),
  });
  const engineFindings = calibrateFindings(applyGraph(perFileFindings, graph), profile).sort(compareFindings);
  const surface = buildSurface(contexts, graph, project);
  const securityEngine = engineFindings.filter((f) => f.category === "security");
  const qualityEngine = engineFindings.filter((f) => f.category === "quality");
  const performanceEngine = engineFindings.filter((f) => f.category === "performance");

  const codeSecurityFindings = capPerRule(securityEngine, 3).map(toScanFinding);
  const qualityFindings: RepoScanFinding[] = capPerRule(qualityEngine, 3).map(toScanFinding);
  const performanceFindings = capPerRule(performanceEngine, 2).map(toScanFinding);
  const taintFlows = securityEngine.filter((f) => /^(?:taint|xfile|interproc)-/.test(f.ruleId)).length;

  // ── Structure-based checks ─────────────────────────────────────────────────
  const structuralIssues: RepoScanFinding[] = [];
  const securityPositives: string[] = [];

  const committedEnv = fileTree.filter((f) => COMMITTED_ENV_FILE.test(f));
  if (committedEnv.length > 0) {
    structuralIssues.push({
      severity: "critical", category: "security", file: committedEnv[0],
      description: `Environment file${committedEnv.length > 1 ? "s" : ""} committed to the repository (${committedEnv.slice(0, 3).join(", ")}). Anything in ${committedEnv.length > 1 ? "them" : "it"} — database URLs, API keys, signing secrets — is readable by everyone with repository access and stays in git history.`,
      suggestion: "Rotate every secret the file contains, delete it from the repo (git rm --cached), add it to .gitignore, and commit a .env.example with placeholder values instead. Purge history with git filter-repo if the repo is public.",
    });
  }
  const committedKeys = fileTree.filter((f) => COMMITTED_KEY_FILE.test(f) && fileRole(f) === "source");
  if (committedKeys.length > 0) {
    structuralIssues.push({
      severity: committedKeys.some((f) => /id_(?:rsa|dsa|ecdsa|ed25519)$|\.(?:key|ppk)$/.test(f)) ? "critical" : "high",
      category: "security",
      file: committedKeys[0],
      description: `Private key or keystore file${committedKeys.length > 1 ? "s" : ""} committed (${committedKeys.slice(0, 3).join(", ")}).`,
      suggestion: "Revoke and regenerate the key, remove the file from the repository and history, and load keys from a secrets manager at runtime.",
    });
  }

  if (!hasEnvExample) {
    structuralIssues.push({
      severity: "medium", category: "security", file: "root",
      description: "No .env.example file — without a template, developers may share actual .env files leaking credentials.",
      suggestion: "Create .env.example listing all required variable names (no values). Commit it to document configuration.",
    });
  } else securityPositives.push("Environment template (.env.example) documents all required variables");

  const autoDeploy = profile.deployment.find((d) => ["Vercel", "Netlify", "Cloudflare Workers", "Render", "Railway"].includes(d));
  if (!hasCI) {
    const stakes = [
      profile.traits.includes("payments") && "payments",
      profile.traits.includes("authentication") && "authentication",
      profile.traits.includes("ai-powered") && "paid AI calls",
      profile.traits.includes("personal-data") && "personal data",
    ].filter(Boolean);
    structuralIssues.push(autoDeploy
      ? {
          severity: "medium", category: "config",
          description: `No test or lint gate before deploys. ${autoDeploy} builds and ships every push automatically, but nothing runs the test suite, linter or dependency audit first${stakes.length ? ` — risky for a project that handles ${stakes.join(", ")}` : ""}.`,
          suggestion: `Add a GitHub Actions workflow that runs typecheck, lint and tests on every push and PR, and make it a required status check on the branch ${autoDeploy} deploys from. It complements ${autoDeploy}'s deploys rather than replacing them.`,
        }
      : {
          severity: "medium", category: "config",
          description: `No CI/CD pipeline found. PRs can merge without automated tests, linting, or security checks${stakes.length ? ` — risky for a project that handles ${stakes.join(", ")}` : ""}.`,
          suggestion: "Add GitHub Actions (.github/workflows/ci.yml) with test, lint, and npm audit steps. Gate all PRs on it.",
        });
  } else securityPositives.push("CI/CD pipeline configured — every PR runs automated checks");

  if (!hasLinting) {
    structuralIssues.push({
      severity: "low", category: "quality",
      description: "No linter found (checked ESLint v8/v9, Biome, XO, Ruff, golangci-lint, RuboCop and devDependencies).",
      suggestion: "Add ESLint with @typescript-eslint/recommended + eslint-plugin-security. Consider Biome for all-in-one linting/formatting.",
    });
  } else securityPositives.push("Linting enforced — code style consistency automated");

  if (hasHelmet) securityPositives.push("Helmet.js configured — HTTP security headers enforced");
  if (hasRateLimit) securityPositives.push("Rate limiting in use — brute-force and abuse protection active");
  if (hasCsrfProtection) securityPositives.push("CSRF protection middleware present");
  if (hasAuth) securityPositives.push("Established auth library in use (reduces custom auth attack surface)");
  if (project.globalAuth) securityPositives.push("Proxy/middleware enforces authentication before route handlers");
  if (hasTypeScript) securityPositives.push("TypeScript reduces whole classes of runtime bugs at compile time");
  if (hasPrisma || hasDrizzle) securityPositives.push("Type-safe ORM in use — SQL injection prevented by default");
  if (hasMonitoring) securityPositives.push("Observability/monitoring configured — errors and anomalies are tracked");
  if (securityEngine.every((f) => f.cls !== "secret") && committedEnv.length === 0) securityPositives.push("No hardcoded secrets or committed env files found in scanned files");
  if (taintFlows === 0 && Object.keys(keyFileContents).length > 5) securityPositives.push("No user input reaches SQL, shell, filesystem, redirect or HTML sinks in scanned files");

  // ── Dependency risk analysis ───────────────────────────────────────────────
  const riskyDeps = riskyDependencies(prodDeps, devDepsObj);
  const vulnPackages = groupVulnerabilities(input.vulnerabilities ?? []);
  const runtimeVulns = vulnPackages.filter((p) => !p.dev);
  const seriousRuntimeVulns = runtimeVulns.filter((p) => p.severity === "critical" || p.severity === "high");
  const advisoryWord = (n: number) => `known vulnerabilit${n > 1 ? "ies" : "y"}`;
  const vulnLabel = (p: VulnerablePackage) =>
    `${p.name}@${p.version} — ${describeCounts(p.counts)} ${advisoryWord(p.ids.length)}${p.dev ? " (dev only)" : p.direct ? "" : " (transitive)"}`;
  const upgradeAdvice = (p: VulnerablePackage) => p.fixTarget
    ? `${p.direct ? `Upgrade ${p.name} to ${p.fixTarget} or later` : `Upgrade the package that pulls in ${p.name}, or force ${p.name}@${p.fixTarget}+ with ${p.ecosystem === "npm" ? "an \`overrides\` entry in package.json" : "a dependency constraint"}`}${p.unfixed > 0 ? `; ${p.unfixed} advisor${p.unfixed > 1 ? "ies have" : "y has"} no patched release yet, so check the advisory for mitigations` : ""}.`
    : `No patched release exists yet — check the advisories for mitigations, or replace ${p.name}.`;
  const vulnItems: PenaltyItem[] = vulnPackages.map((p) => ({
    ruleId: `vuln:${p.ecosystem}:${p.name}`,
    severity: p.dev ? (p.severity === "critical" ? "medium" : "low") : p.severity,
    confidence: (p.approximate ? 0.5 : 1) * (p.dev ? 0.3 : p.direct ? 1 : 0.4),
    label: vulnLabel(p),
    file: p.source,
  }));
  const dependencyIssues: RepoScanFinding[] = seriousRuntimeVulns.slice(0, 6).map((p) => ({
    severity: p.approximate && p.severity === "critical" ? "high" : p.severity,
    category: "deps",
    file: p.source,
    description: `${p.name}@${p.version}${p.direct ? "" : " (transitive dependency)"} has ${describeCounts(p.counts)} ${advisoryWord(p.ids.length)} (${[...new Set([...p.cves, ...p.ids])].slice(0, 3).join(", ")}${p.ids.length > 3 ? ", …" : ""}): ${p.summaries[0]}${p.approximate ? ". The version comes from the declared range in the manifest — the lockfile may already pin a patched release" : ""}.`,
    suggestion: upgradeAdvice(p),
  }));
  if (input.dependencyScan && input.dependencyScan.scanned > 0 && seriousRuntimeVulns.length === 0) {
    securityPositives.push(`No critical or high known vulnerabilities (OSV) in ${input.dependencyScan.scanned} ${input.dependencyScan.lockfiles.length > 0 ? "locked" : "declared"} runtime packages`);
  }

  // ── Architecture patterns ──────────────────────────────────────────────────
  const patterns: string[] = [];
  if (hasNextJs) patterns.push("Next.js");
  if (hasRemix) patterns.push("Remix");
  if (hasAstro) patterns.push("Astro");
  if (hasSvelte && !hasNextJs) patterns.push("SvelteKit");
  if (hasVue && !hasNextJs) patterns.push("Vue");
  if (hasAngular) patterns.push("Angular");
  if (hasReact && !hasNextJs && !hasRemix && !hasAstro) patterns.push("React SPA");
  if (hasExpressOrFastify) patterns.push("REST API Server");
  if (hasTrpc) patterns.push("tRPC");
  if (hasGraphQL) patterns.push("GraphQL");
  if (hasPrisma) patterns.push("Prisma ORM");
  if (hasDrizzle) patterns.push("Drizzle ORM");
  if (hasMongoose) patterns.push("Mongoose ODM");
  if (hasTypeORM) patterns.push("TypeORM");
  if (hasDocker) patterns.push("Docker");
  if (hasKubernetes) patterns.push("Kubernetes");
  if (hasServerless) patterns.push("Serverless/Edge");
  if (hasTypeScript) patterns.push("TypeScript");
  if (hasStripe) patterns.push("Stripe Payments");
  if (hasRedis) patterns.push("Redis Cache");
  if (hasQueue) patterns.push("Job Queue (Bull/BullMQ)");
  if (hasEmail) patterns.push("Email Service");
  if (hasFeatureModules) patterns.push("Feature-based Modules");
  if (hasApiRoutes) patterns.push("RESTful API Routes");
  if (hasAppDir && hasNextJs) patterns.push("Next.js App Router");
  if (hasMonorepo || hasWorkspaces) patterns.push("Monorepo");
  if (hasAnyE2E) patterns.push("E2E Testing");
  if (project.reactCompiler) patterns.push("React Compiler");

  // ── Architecture strengths & concerns ─────────────────────────────────────
  const archStrengths: string[] = [];
  const archConcerns: string[] = [];

  if (hasTypeScript) archStrengths.push("TypeScript provides compile-time safety across the codebase");
  if (hasCI) archStrengths.push("CI/CD pipeline gates every PR with automated checks");
  if (hasPrisma || hasDrizzle) archStrengths.push("Type-safe ORM prevents SQL injection by design");
  if (hasFeatureModules) archStrengths.push("Feature-based module structure promotes separation of concerns");
  if (hasDocker) archStrengths.push("Docker containerization ensures environment consistency");
  if (hasSrcDir) archStrengths.push("Source organized under src/ — clear project/library boundary");
  if (hasAuth) archStrengths.push("Battle-tested auth library reduces custom authentication risk");
  if (hasMonitoring) archStrengths.push("Observability stack configured — production issues are traceable");
  if (hasRedis) archStrengths.push("Redis caching reduces database load and improves latency");
  if (hasAnyE2E) archStrengths.push("E2E test framework present — user flows are regression-protected");
  if (hasRateLimit) archStrengths.push("Rate limiting protects against brute-force and abuse");

  if (!hasTests && !hasTestDir) archConcerns.push("No test infrastructure — high regression risk on every change");
  if (!hasCI) archConcerns.push(autoDeploy
    ? `Deploys are automated by ${autoDeploy}, but no tests or lint run before a push goes live`
    : "No CI/CD — releases are manual and unvalidated by automation");
  if (!hasAnyORM && hasExpressOrFastify) archConcerns.push("No ORM detected on an API server — SQL injection risk if raw queries are used");
  if (!hasMonitoring && fileTree.length > 50) archConcerns.push("No observability (Sentry/Pino/Winston) — production errors may be silent");
  if (!hasRateLimit && !project.globalRateLimit && (hasExpressOrFastify || hasNextJs) && hasAuth) archConcerns.push("No rate limiting detected on an authenticated API — brute-force risk");
  if (engineFindings.some((f) => f.ruleId === "client-imports-server-code")) archConcerns.push("Client components pull server-only modules into the browser bundle — add `server-only` guards to server modules");
  if (graph.insights.cycles.length > 0) archConcerns.push(`${graph.insights.cycles.length} circular import chain${graph.insights.cycles.length > 1 ? "s" : ""} (e.g. ${[...graph.insights.cycles[0], graph.insights.cycles[0][0]].map(shortPath).join(" → ")})`);
  for (const hub of graph.insights.hubs.filter((h) => !h.tested).slice(0, 2)) archConcerns.push(`${shortPath(hub.file)} is imported by ${hub.fanIn} modules but has no tests — changes there have a wide blast radius`);
  for (const god of graph.insights.godModules.slice(0, 2)) archConcerns.push(`${shortPath(god.file)} imports ${god.fanOut} local modules — likely doing too much`);
  if (graph.insights.modules >= 20 && graph.insights.cycles.length === 0) archStrengths.push(`Acyclic dependency graph across ${graph.insights.modules} analyzed modules (${graph.insights.edges} import edges)`);
  for (const hub of graph.insights.hubs.filter((h) => h.tested).slice(0, 1)) archStrengths.push(`Core module ${shortPath(hub.file)} (imported by ${hub.fanIn} modules) has dedicated tests`);
  const dup = graph.insights.duplicates;
  if (dup.lines >= 60) {
    const top = dup.top[0];
    archConcerns.push(`${dup.blocks} duplicated code block${dup.blocks > 1 ? "s" : ""} (${dup.lines} copied statements) — largest: ${shortPath(top.b.file)}:${top.b.line} ↔ ${shortPath(top.a.file)}:${top.a.line} (${top.lines} statements)`);
  }
  const worst = graph.insights.complexity[0];
  if (worst && worst.complexity >= 40) {
    archConcerns.push(`Complexity hotspot: \`${worst.name}\` in ${shortPath(worst.file)} has cyclomatic complexity ${worst.complexity} over ${worst.lines} lines`);
  }
  const deepNested = fileTree.filter((f) => f.split("/").length > 7).length;
  if (deepNested > 20) archConcerns.push(`${deepNested} files nested >7 directories deep — may indicate poor module organization`);
  if (depCount > 120) archConcerns.push(`${depCount} dependencies — very large tree increases maintenance burden and attack surface`);

  // ── Quality strengths ──────────────────────────────────────────────────────
  const qualityStrengths: string[] = [];
  if (hasTests || hasTestDir) qualityStrengths.push("Test infrastructure present");
  if (hasAnyTestFramework) qualityStrengths.push(`Testing framework configured (${hasJest ? "Jest" : hasVitest ? "Vitest" : hasMocha ? "Mocha" : "present"})`);
  if (hasLinting) qualityStrengths.push("Linting enforces consistent code style");
  if (hasFormatting) qualityStrengths.push("Formatting configured — no style debates in PRs");
  if (contributors > 3) qualityStrengths.push(`${contributors} contributors — healthy community engagement and code review`);
  else if (contributors > 1) qualityStrengths.push(`${contributors} contributors — code review practiced`);
  if (hasTypeScript) qualityStrengths.push("TypeScript enforces type correctness at compile time");

  const readmeContent =
    keyFileContents["README.md"] ??
    keyFileContents[Object.keys(keyFileContents).find((k) => k.toLowerCase() === "readme.md") ?? ""] ?? "";
  if (readmeContent.length > 500) {
    qualityStrengths.push("README is detailed and informative");
  } else if (readmeContent.length > 100) {
    qualityStrengths.push("README is present");
  } else {
    qualityFindings.push({
      severity: "low", category: "quality",
      description: `README.md is ${readmeContent.length > 0 ? "very short" : "missing"} — poor documentation increases onboarding friction.`,
      suggestion: "Add: project overview, installation steps, usage examples, environment setup, contributing guide.",
    });
  }

  const hasChangelog = fileTree.some((f) => /changelog\.md$/i.test(f));
  if (!hasChangelog && fileTree.length > 30) {
    qualityFindings.push({
      severity: "low", category: "quality",
      description: "No CHANGELOG.md found — release history is undocumented.",
      suggestion: "Add a CHANGELOG.md and update it with every release using conventional commit conventions.",
    });
  }

  // ── Score calculation ──────────────────────────────────────────────────────
  for (const issue of profileIssues(profile, profileInput)) {
    if (issue.category === "security") structuralIssues.push(issue);
    else qualityFindings.push(issue);
  }
  const allSecIssues = [...codeSecurityFindings, ...structuralIssues, ...dependencyIssues].sort(
    (a, b) => (SEVERITY_RANK[b.severity as Severity] ?? 0) - (SEVERITY_RANK[a.severity as Severity] ?? 0)
  );
  const extraQuality = qualityFindings.filter((f) => !f.file || f.file === "package.json" || !qualityEngine.some((e) => e.file === f.file));

  const secDeduction = deductionFactors(
    [
      ...securityEngine.map(engineItem),
      ...scanItems(structuralIssues.filter((f) => f.category === "security")),
      ...seriousRuntimeVulns.filter((p) => p.severity === "critical" || p.direct).map((p) => ({
        ruleId: `vuln:${p.ecosystem}:${p.name}`,
        severity: p.severity,
        confidence: (p.approximate ? 0.5 : 1) * (p.direct ? 0.4 : 0.15),
        label: `Vulnerable dependency ${p.name}@${p.version} (${describeCounts(p.counts)})`,
        file: p.source,
      })),
    ],
    98,
    110,
  );
  const secBonus = Math.min(6, securityPositives.length);
  const securityScore = clamp(secDeduction.remaining + secBonus, 5, 98);
  const securityFactors: ScoreFactor[] = [
    { label: "Starting score", points: 98 },
    ...secDeduction.factors,
    ...(secBonus > 0 ? [{ label: `Security strengths detected (${securityPositives.length})`, points: secBonus }] : []),
    ...capFactor(secDeduction.remaining + secBonus, securityScore),
  ];

  const perfDeduction = deductionFactors(performanceEngine.map(engineItem), 82, 60);
  const performanceScore = clamp(15 + perfDeduction.remaining, 15, 97);
  const performanceFactors: ScoreFactor[] = [{ label: "Starting score", points: 97 }, ...perfDeduction.factors, ...capFactor(15 + perfDeduction.remaining, performanceScore)];

  const qualityDeduction = deductionFactors([...qualityEngine.map(engineItem), ...scanItems(extraQuality)], 70, 70);
  const qualityBonuses: ScoreFactor[] = [
    ...(hasTypeScript ? [{ label: "TypeScript", points: 6 }] : []),
    ...(hasLinting ? [{ label: "Linter configured", points: 5 }] : []),
    ...(hasFormatting ? [{ label: "Formatter configured", points: 2 }] : []),
    hasTests || hasTestDir ? { label: "Tests present", points: 6 } : { label: "No tests", points: -10 },
  ];
  const qualityRaw = 15 + qualityDeduction.remaining + qualityBonuses.reduce((n, b) => n + b.points, 0);
  const qualityScore = clamp(qualityRaw, 15, 97);
  const qualityFactors: ScoreFactor[] = [{ label: "Starting score", points: 85 }, ...qualityDeduction.factors, ...qualityBonuses, ...capFactor(qualityRaw, qualityScore)];

  const testFileCount = fileTree.filter((f) => fileRole(f) === "test" && CODE_FILE.test(f)).length;
  const reach = graph.insights.testReach;
  const reachKnown = graphCoverage >= 0.9 && reach.sourceModules >= 10 && reach.testFiles > 0;
  const pct = (n: number) => `${Math.round((n / Math.max(1, reach.sourceModules)) * 100)}%`;
  const testabilityParts: ScoreFactor[] = [
    hasTests || hasTestDir ? { label: "Test files present", points: 45 } : { label: "No test files", points: 5 },
    ...(hasCI ? [{ label: "CI runs on every change", points: 18 }] : [{ label: "No CI — tests are never run automatically", points: 0 }]),
    ...(hasAnyTestFramework ? [{ label: "Test framework configured", points: 5 }] : []),
    ...(hasTestingLibrary ? [{ label: "Component testing library", points: 5 }] : []),
    ...(hasAnyE2E ? [{ label: "End-to-end test framework", points: 8 }] : []),
    ...(reachKnown
      ? [
          { label: `Tests import ${pct(reach.direct)} of ${reach.sourceModules} source modules directly and reach ${pct(reach.reachable)} through the import graph`, points: Math.round((10 * reach.direct + 14 * reach.reachable) / reach.sourceModules) },
          ...(reach.untestedCritical.length > 0 ? [{ label: `${reach.untestedCritical.length} widely-used or security-sensitive module${reach.untestedCritical.length > 1 ? "s" : ""} without tests`, points: -Math.min(10, reach.untestedCritical.length * 2) }] : []),
        ]
      : [
          ...(testFileCount > 5 ? [{ label: `More than 5 test files (${testFileCount})`, points: 8 }] : []),
          ...(testFileCount > 20 ? [{ label: "More than 20 test files", points: 8 }] : []),
        ]),
  ];
  const testabilityRaw = testabilityParts.reduce((n, p) => n + p.points, 0);
  const testabilityScore = clamp(testabilityRaw, 5, 97);
  const testabilityFactors = [...testabilityParts, ...capFactor(testabilityRaw, testabilityScore)];

  const sizePenalty = depCount > 150 ? 15 : depCount > 100 ? 8 : depCount > 60 ? 3 : 0;
  const depBase = clamp(88 - riskyDeps.length * 8 - sizePenalty, 15, 97);
  const vulnDeduction = deductionFactors(vulnItems, depBase, 140);
  const depRaw = vulnDeduction.remaining;
  const depScore = clamp(depRaw, 5, 97);
  const dependencyFactors: ScoreFactor[] = [
    { label: "Starting score", points: 88 },
    ...riskyDeps.map((d) => ({ label: `${d.name}@${d.range} — ${d.reason}`, points: -8 })),
    ...(sizePenalty > 0 ? [{ label: `${depCount} dependencies`, points: -sizePenalty }] : []),
    ...capFactor(88 - riskyDeps.length * 8 - sizePenalty, depBase),
    ...vulnDeduction.factors.slice(0, 15),
    ...(vulnDeduction.factors.length > 15
      ? [{ label: `${vulnDeduction.factors.length - 15} more vulnerable packages`, points: round1(vulnDeduction.factors.slice(15).reduce((n, f) => n + f.points, 0)) }]
      : []),
    ...capFactor(depRaw, depScore),
  ];

  const weights = healthWeights(profile);
  const healthScore = Math.round(
    securityScore * weights.security +
    qualityScore * weights.quality +
    testabilityScore * weights.testability +
    depScore * weights.dependencies +
    performanceScore * weights.performance
  );
  const healthFactors: ScoreFactor[] = [
    { label: `Security ${securityScore} × ${Math.round(weights.security * 100)}%`, points: round1(securityScore * weights.security) },
    { label: `Code quality ${qualityScore} × ${Math.round(weights.quality * 100)}%`, points: round1(qualityScore * weights.quality) },
    { label: `Testability ${testabilityScore} × ${Math.round(weights.testability * 100)}%`, points: round1(testabilityScore * weights.testability) },
    { label: `Dependencies ${depScore} × ${Math.round(weights.dependencies * 100)}%`, points: round1(depScore * weights.dependencies) },
    { label: `Performance ${performanceScore} × ${Math.round(weights.performance * 100)}%`, points: round1(performanceScore * weights.performance) },
  ];

  const grade = (s: number): "A" | "B" | "C" | "D" | "F" =>
    s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : s >= 40 ? "D" : "F";

  // ── Recommendations ────────────────────────────────────────────────────────
  const recommendations: RepoScanResult["recommendations"] = [];
  const critHigh = allSecIssues.filter((i) => (i.severity === "critical" || i.severity === "high") && i.category !== "deps");

  if (critHigh.length > 0) {
    recommendations.push({
      priority: "immediate",
      title: `Fix ${critHigh.length} critical/high security issue${critHigh.length > 1 ? "s" : ""}`,
      description: critHigh.slice(0, 3).map((i) => `${i.file ? `[${locationOf(i)}] ` : ""}${firstSentence(i.description)}`).join(" | "),
      effort: "medium",
    });
  }

  if (vulnPackages.length > 0) {
    const fixable = vulnPackages.filter((p) => p.fixTarget && !p.dev);
    const targets = (fixable.length > 0 ? fixable : vulnPackages.filter((p) => p.fixTarget)).slice(0, 4);
    recommendations.push({
      priority: seriousRuntimeVulns.length > 0 ? "immediate" : "short-term",
      title: `Patch ${runtimeVulns.length > 0 ? `${runtimeVulns.length} vulnerable runtime package${runtimeVulns.length > 1 ? "s" : ""}` : `${vulnPackages.length} vulnerable dev package${vulnPackages.length > 1 ? "s" : ""}`}`,
      description: targets.length > 0
        ? `${targets.map((p) => `${p.name} ${p.version} → ${p.fixTarget} (${describeCounts(p.counts)})`).join("; ")}${vulnPackages.length > targets.length ? `; ${vulnPackages.length - targets.length} more in the dependency report` : ""}. Re-run the scan after updating the lockfile.`
        : "None of the affected packages has a patched release yet — review the advisories for mitigations or replace the packages.",
      effort: seriousRuntimeVulns.some((p) => p.fixTarget && p.fixTarget.split(".")[0] !== p.version.split(".")[0]) ? "medium" : "low",
    });
  }

  if (!hasCI) {
    recommendations.push({
      priority: "immediate",
      title: autoDeploy ? `Gate ${autoDeploy} deploys on tests` : "Set up CI/CD pipeline",
      description: autoDeploy
        ? `${autoDeploy} already deploys automatically. Add a GitHub Actions workflow running typecheck, lint and tests, and make it a required check on the deploy branch so broken builds never ship.`
        : "Add GitHub Actions (.github/workflows/ci.yml) with automated testing, linting, and npm audit. Require all checks to pass before merging.",
      effort: "medium",
    });
  }

  if (!hasTests && !hasTestDir) {
    recommendations.push({
      priority: "immediate",
      title: "Establish test infrastructure",
      description: `Add ${hasNextJs || hasReact ? "Vitest + @testing-library/react" : hasTypeScript ? "Vitest" : "a testing framework"} and write tests for the most critical code paths. Target 60%+ coverage.`,
      effort: "high",
    });
  }

  if (riskyDeps.length > 0) {
    recommendations.push({
      priority: "short-term",
      title: `Modernize ${riskyDeps.length} risky/deprecated package${riskyDeps.length > 1 ? "s" : ""}`,
      description: riskyDeps.slice(0, 3).map((d) => `${d.name}@${d.range}: ${d.reason}`).join("; ") + (riskyDeps.length > 3 ? ` (+${riskyDeps.length - 3} more)` : "") + (input.dependencyScan ? "." : ". Run npm audit for CVEs."),
      effort: "medium",
    });
  }

  const perfHigh = performanceFindings.filter((f) => f.severity === "high");
  if (perfHigh.length > 0) {
    recommendations.push({
      priority: "short-term",
      title: `Resolve ${perfHigh.length} high-impact performance issue${perfHigh.length > 1 ? "s" : ""}`,
      description: perfHigh.slice(0, 2).map((f) => `[${locationOf(f)}] ${firstSentence(f.description)}`).join(" | "),
      effort: "medium",
    });
  }

  if (!hasEnvExample) {
    recommendations.push({
      priority: "short-term",
      title: "Add .env.example template",
      description: "Document all required environment variable names (no values) to prevent credential sharing and ease developer onboarding.",
      effort: "low",
    });
  }

  if (!hasLinting) {
    recommendations.push({
      priority: "short-term",
      title: "Configure code linting",
      description: `Add ${hasTypeScript ? "ESLint with @typescript-eslint/recommended + eslint-plugin-security" : "ESLint"}. Consider Biome for faster all-in-one linting and formatting.`,
      effort: "low",
    });
  }

  if (!hasMonitoring && fileTree.length > 40) {
    recommendations.push({
      priority: "short-term",
      title: "Add error monitoring and observability",
      description: "Integrate Sentry (free tier) for error tracking and a structured logger (pino/winston) for production logs. Blind apps are hard to operate.",
      effort: "low",
    });
  }

  if (!hasAnyE2E && (hasTests || hasTestDir)) {
    recommendations.push({
      priority: "long-term",
      title: "Add end-to-end testing",
      description: `Add ${hasNextJs || hasReact ? "Playwright or Cypress" : "an E2E framework"} to protect critical user flows (login, checkout, onboarding) from regressions.`,
      effort: "high",
    });
  }

  if (recommendations.length < 5) {
    recommendations.push({
      priority: "long-term",
      title: "Automate security scanning in CI",
      description: "Add CodeQL (free via GitHub Actions), Dependabot for automatic dependency PRs, and npm audit --audit-level=high as a CI gate.",
      effort: "medium",
    });
  }

  // ── Tech debt ──────────────────────────────────────────────────────────────
  const qualityMedium = qualityEngine.filter((f) => f.severity === "medium").length;
  const qualityLow = qualityEngine.filter((f) => f.severity === "low").length;
  const techDebtScore = clamp(
    80
    - (!hasTests && !hasTestDir ? 20 : 0)
    - (!hasCI ? 15 : 0)
    - (riskyDeps.length * 5)
    - Math.min(15, seriousRuntimeVulns.length * 3)
    - Math.min(25, qualityMedium * 3 + qualityLow),
    15, 90,
  );

  const techDebtLevel: RepoScanResult["techDebt"]["level"] =
    techDebtScore < 35 ? "severe" :
    techDebtScore < 50 ? "significant" :
    techDebtScore < 70 ? "manageable" : "minimal";

  const filesFor = (ruleId: string, n: number) =>
    [...new Set(qualityEngine.filter((f) => f.ruleId === ruleId).map((f) => f.file.split("/").pop()))].slice(0, n);

  const techDebtHotspots = [
    ...(!hasTests ? ["Test coverage — no test files detected"] : []),
    ...(!hasCI ? [autoDeploy ? `Test gate — ${autoDeploy} deploys without running tests` : "CI/CD pipeline — not configured"] : []),
    ...(seriousRuntimeVulns.length > 0 ? [`Vulnerable dependencies: ${seriousRuntimeVulns.slice(0, 4).map((p) => p.name).join(", ")}`] : []),
    ...(riskyDeps.length > 0 ? [`Outdated/risky dependencies: ${riskyDeps.slice(0, 4).map((d) => d.name).join(", ")}`] : []),
    ...graph.insights.complexity.slice(0, 2).map((c) => `Complexity: ${c.name} in ${shortPath(c.file)} (cyclomatic ${c.complexity}, ${c.lines} lines)`),
    ...(dup.blocks > 0 ? [`Duplication: ${dup.blocks} copy-pasted block${dup.blocks > 1 ? "s" : ""} (${dup.lines} statements)`] : []),
    ...filesFor("todo-fixme", 2).map((f) => `Unfinished work in ${f}`),
    ...filesFor("any-type", 1).map((f) => `Type safety gaps in ${f}`),
    ...filesFor("empty-catch", 1).map((f) => `Silent error swallowing in ${f}`),
    ...performanceFindings.filter((f) => f.severity === "high").slice(0, 2).map((f) => `Performance: ${firstSentence(f.description)} (${locationOf(f)})`),
  ];

  // ── Primary language ───────────────────────────────────────────────────────
  const tsCount = fileTree.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).length;
  const jsCount = fileTree.filter((f) => f.endsWith(".js") || f.endsWith(".jsx")).length;
  const pyCount = fileTree.filter((f) => f.endsWith(".py")).length;
  const goCount = fileTree.filter((f) => f.endsWith(".go")).length;
  const rustCount = fileTree.filter((f) => f.endsWith(".rs")).length;
  const primaryLanguage = (meta.language as string) ??
    (tsCount > 0 && tsCount >= jsCount && tsCount >= pyCount && tsCount >= goCount ? "TypeScript" :
     pyCount > jsCount && pyCount > goCount ? "Python" :
     goCount > jsCount ? "Go" :
     rustCount > jsCount ? "Rust" :
     jsCount > 0 ? "JavaScript" : "Unknown");

  // ── Repo age ───────────────────────────────────────────────────────────────
  const repoAge = meta.created_at
    ? `${Math.round((Date.now() - new Date(meta.created_at as string).getTime()) / (1000 * 60 * 60 * 24 * 30))} months`
    : "Unknown";

  const scannedFiles = Object.keys(keyFileContents).length;
  const criticalHighCount = critHigh.length;

  return {
    healthScore,
    summary: `${repo} scored ${healthScore}/100 — ${
      healthScore >= 85 ? "healthy codebase, minor improvements available" :
      healthScore >= 70 ? "generally healthy with some areas to improve" :
      healthScore >= 55 ? "moderate health — several meaningful improvements needed" :
      healthScore >= 40 ? "needs attention: significant risks and debt present" :
      "critical state: security issues and heavy technical debt"
    }. ${criticalHighCount > 0
      ? `${criticalHighCount} critical/high security issue${criticalHighCount > 1 ? "s" : ""} found across ${scannedFiles} scanned files${taintFlows > 0 ? `, including ${taintFlows} confirmed flow${taintFlows > 1 ? "s" : ""} of user input into dangerous sinks` : ""}.`
      : `No critical security issues in ${scannedFiles} scanned files.`
    } ${!hasTests && !hasTestDir ? "No test infrastructure — regression risk is high." : `Test infrastructure present${hasAnyE2E ? " (including E2E)" : ""}.`} ${estimatedLoc} of code across ${fileTree.length} files (${scannedFiles} read).`,

    architecture: {
      summary: `${profile.label} — ${fileTree.length} tracked files.${hasMigrations ? " Database migrations tracked." : ""}${hasDocker ? " Containerized." : ""}${hasMonorepo || hasWorkspaces ? " Monorepo structure." : ""}${graph.insights.modules > 0 ? ` Dependency graph: ${graph.insights.modules} modules, ${graph.insights.edges} import edges${graph.insights.cycles.length > 0 ? `, ${graph.insights.cycles.length} circular chain${graph.insights.cycles.length > 1 ? "s" : ""}` : ""}${graph.insights.crossFileFlows > 0 ? `, ${graph.insights.crossFileFlows} cross-file data flow${graph.insights.crossFileFlows > 1 ? "s" : ""} into dangerous sinks` : ""}.` : ""}`,
      patterns: patterns.length > 0 ? patterns : ["Standard project structure"],
      strengths: archStrengths.length > 0 ? archStrengths : ["Project is organized consistently"],
      concerns: archConcerns.length > 0 ? archConcerns : ["No major architectural concerns identified in scanned files"],
    },

    security: {
      score: securityScore,
      grade: grade(securityScore),
      issues: allSecIssues.slice(0, 20),
      positives: securityPositives.length > 0 ? securityPositives : ["No obvious hardcoded secrets found in scanned files"],
    },

    codeQuality: {
      score: qualityScore,
      grade: grade(qualityScore),
      issues: [...qualityFindings, ...performanceFindings].slice(0, 16),
      strengths: qualityStrengths.length > 0 ? qualityStrengths : ["Code is organized consistently"],
    },

    performance: {
      score: performanceScore,
      grade: grade(performanceScore),
      issues: performanceFindings.slice(0, 10),
      positives: performanceFindings.length === 0 ? ["No obvious performance anti-patterns detected in scanned files"] : [],
    },

    testability: {
      score: testabilityScore,
      grade: grade(testabilityScore),
      hasTestFramework: hasAnyTestFramework || hasTests || hasTestDir,
      coverageEstimate: reachKnown
        ? `${pct(reach.direct)} of source modules imported directly by tests; ${pct(reach.reachable)} reachable from tests (import graph — an upper bound on line coverage)`
        : hasTests
        ? testFileCount > 20 ? "~60-80% (estimated from test file density)"
        : testFileCount > 8 ? "~30-50% (estimated)"
        : "~10-25% (estimated)"
        : "None detected",
      gaps: [
        ...(reachKnown ? reach.untestedCritical.map((u) => `${u.file} (${u.reason}) has no tests importing it`) : []),
        ...(!hasTests && !hasTestDir ? ["No test files (.test.ts, .spec.ts, test_*.py, *_test.go) found in the codebase"] : []),
        ...(!hasCI ? ["No CI enforcement — tests can be bypassed before merge"] : []),
        ...(!hasAnyE2E ? ["No E2E test framework (Playwright/Cypress) detected — user flows unprotected"] : []),
        ...(!hasTestingLibrary && hasReact ? ["No component testing library (@testing-library/react) detected"] : []),
      ],
    },

    dependencies: {
      score: depScore,
      totalCount: depCount,
      risks: [
        ...vulnPackages.slice(0, 20).map((p) => `${vulnLabel(p)}${p.fixTarget ? ` — fixed in ${p.fixTarget}` : " — no patched release yet"}`),
        ...(vulnPackages.length > 20 ? [`${vulnPackages.length - 20} more packages with known vulnerabilities`] : []),
        ...riskyDeps.slice(0, 8).map((d) => `${d.name}@${d.range} — ${d.reason}`),
        ...(depCount > 100 ? [`Large dependency tree (${depCount} packages) — increases maintenance and attack surface`] : []),
        ...(!input.dependencyScan && depCount > 0 ? ["Run npm audit to check for known CVEs in the full dependency tree"] : []),
        ...(input.dependencyScan && !input.dependencyScan.complete ? ["Vulnerability lookup was partial (OSV timed out or the tree was too large) — run npm audit for the full picture"] : []),
      ],
      outdatedSignals: [
        ...("moment" in deps ? ["moment.js is deprecated — migrate to date-fns or dayjs"] : []),
        ...("request" in deps ? ["'request' is archived — migrate to native fetch or got"] : []),
        ...("jquery" in deps ? ["jQuery unnecessary in modern SPA — use native DOM or framework APIs"] : []),
        ...("aws-sdk" in deps ? ["aws-sdk v2 is end-of-support — migrate to modular @aws-sdk/* v3 clients"] : []),
        ...(depCount > 150 ? [`${depCount} dependencies — audit for unused packages with depcheck`] : []),
      ],
    },

    techDebt: {
      score: techDebtScore,
      level: techDebtLevel,
      hotspots: techDebtHotspots.length > 0 ? techDebtHotspots : ["No major hotspots identified in scanned files"],
      estimatedHours:
        techDebtLevel === "severe" ? "120+ hours" :
        techDebtLevel === "significant" ? "40-100 hours" :
        techDebtLevel === "manageable" ? "10-40 hours" : "< 10 hours",
    },

    recommendations: recommendations.slice(0, 7),

    metrics: {
      primaryLanguage,
      fileCount: fileTree.length,
      estimatedLoc,
      contributors,
      repoAge,
      openIssues: (meta.open_issues_count as number) ?? 0,
      stars: (meta.stargazers_count as number) ?? 0,
    },
    profile: { ...profile, surface },
    scoreBreakdown: {
      security: securityFactors,
      quality: qualityFactors,
      performance: performanceFactors,
      testability: testabilityFactors,
      dependencies: dependencyFactors,
      health: healthFactors,
      weightsRationale: weights.rationale,
    },
    model: "gitscope-internal-v4",
    isDemo: false,
  };
}
