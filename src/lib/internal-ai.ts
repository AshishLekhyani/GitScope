/**
 * GitScope Internal Static Analysis Engine — v3
 *
 * Performs evidence-based static analysis on actual fetched file contents:
 *   • 27 security rules (secrets, injection, XSS, SSRF, crypto, CORS, cookies…)
 *   • 16 quality rules (unified for both PR review and repo scan)
 *   • Expanded dependency risk table (35+ packages with specific remediation)
 *   • 30+ architecture pattern detectors
 *   • Breaking change detection (10 categories)
 *   • LOC estimation filtered to code-only files
 *   • Weighted scoring: security 30%, quality 25%, testability 25%, deps 20%
 *
 * Used as the static pre-pass before calling the LLM (ai-providers.ts).
 * All findings are evidence-based — only flagged if actually found in code.
 */

import type { CodeReviewResult, CodeReviewFinding } from "@/app/api/ai/code-review/route";
import type { RepoScanResult, RepoScanFinding } from "@/app/api/ai/repo-scan/route";

// ── Security rule patterns ────────────────────────────────────────────────────

interface RuleFix {
  before: string;
  after: string;
  language?: string;
}

interface SecurityRule {
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
  // ── Secrets & credentials ──────────────────────────────────────────────────
  {
    id: "hardcoded-secret-aws",
    pattern: /AKIA[0-9A-Z]{16}/g,
    severity: "critical",
    description: (_, file) =>
      `AWS Access Key ID found hardcoded in ${file}. This credential is exposed in version control.`,
    suggestion:
      "Remove immediately. Rotate the key in AWS IAM. Store credentials in environment variables or AWS Secrets Manager.",
    category: "security",
    confidence: 0.98,
    fix: {
      before: `const client = new S3Client({\n  accessKeyId: "AKIAIOSFODNN7EXAMPLE",\n  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",\n});`,
      after: `const client = new S3Client({\n  accessKeyId: process.env.AWS_ACCESS_KEY_ID,\n  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,\n});`,
      language: "typescript",
    },
  },
  {
    id: "hardcoded-secret-generic",
    // ^\s* anchored only via [^\s"'] in the value: real credentials (API keys, tokens,
    // passwords) never contain spaces. Error messages, JSX labels and UI strings always do.
    // This eliminates the most common false-positive class: token: "The link is missing a token."
    pattern:
      /(?:password|passwd|secret|api_key|apikey|token|private_key|client_secret)\s*[:=]\s*["'][^\s"']{8,}["']/gi,
    severity: "critical",
    description: (match, file) =>
      `Potential hardcoded credential in ${file}: \`${match.slice(0, 50)}\`. Secrets in source code are a critical risk.`,
    suggestion:
      "Use environment variables (process.env.SECRET_NAME) or a secrets manager. Never commit credentials.",
    category: "security",
    confidence: 0.82,
    fix: {
      before: `const config = {\n  apiKey: "sk-live-abc123secretkey",\n  dbPassword: "myP@ssw0rd!",\n};`,
      after: `const config = {\n  apiKey: process.env.API_KEY,\n  dbPassword: process.env.DB_PASSWORD,\n};\n// Add to .env.example: API_KEY=\n// Add to .env.example: DB_PASSWORD=`,
      language: "typescript",
    },
  },
  {
    id: "hardcoded-pem-key",
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    severity: "critical",
    description: (_, file) =>
      `PEM-encoded private key found in ${file}. Private keys in source code are immediately exploitable.`,
    suggestion:
      "Remove the key immediately. Revoke and regenerate it. Store private keys only in environment variables or a dedicated secrets manager.",
    category: "security",
    confidence: 0.99,
    fix: {
      before: `const privateKey = \`-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\`;`,
      after: `const privateKey = process.env.PRIVATE_KEY?.replace(/\\\\n/g, "\\n");\n// Store the key as a single-line base64 or escaped string in your secrets manager`,
      language: "typescript",
    },
  },
  // ── Injection ──────────────────────────────────────────────────────────────
  {
    id: "sql-injection",
    pattern: /(?:query|sql|execute|db\.run|db\.query)\s*\(\s*[`"'].*\$\{.*\}.*[`"']/gi,
    severity: "critical",
    description: (_, file) =>
      `SQL query with string interpolation in ${file}. Template literal SQL is vulnerable to injection.`,
    suggestion:
      "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [userId]). Never interpolate user input into SQL.",
    category: "security",
    confidence: 0.90,
    fix: {
      before: `// VULNERABLE — SQL injection via string interpolation\nconst result = await db.query(\n  \`SELECT * FROM users WHERE email = '\${req.body.email}'\`\n);`,
      after: `// SAFE — parameterized query\nconst result = await db.query(\n  "SELECT * FROM users WHERE email = $1",\n  [req.body.email]\n);`,
      language: "typescript",
    },
  },
  {
    id: "command-injection",
    pattern: /(?:exec|execSync|spawn|spawnSync|execFile)\s*\([^)]*(?:req\.|params\.|query\.|body\.|args\[)/g,
    severity: "critical",
    description: (_, file) =>
      `Command injection risk in ${file}: user-controlled input passed to a shell execution function.`,
    suggestion:
      "Never pass user input to exec/spawn. Use an allowlist of safe commands. Prefer child_process.execFile() with argument arrays.",
    category: "security",
    confidence: 0.88,
    fix: {
      before: `// VULNERABLE — user input injected into shell command\nimport { exec } from "child_process";\nexec(\`git clone \${req.body.repoUrl}\`, callback);`,
      after: `// SAFE — use execFile with argument array, validate input\nimport { execFile } from "child_process";\nconst ALLOWED_HOSTS = ["github.com", "gitlab.com"];\nconst url = new URL(req.body.repoUrl);\nif (!ALLOWED_HOSTS.includes(url.hostname)) throw new Error("Disallowed host");\nexecFile("git", ["clone", "--", url.href], callback);`,
      language: "typescript",
    },
  },
  {
    id: "eval-usage",
    pattern: /\beval\s*\(/g,
    severity: "high",
    description: (_, file) =>
      `\`eval()\` used in ${file}. Executing arbitrary code strings enables remote code execution.`,
    suggestion:
      "Replace eval() with safer alternatives: JSON.parse() for data, a proper AST/template engine for logic.",
    category: "security",
    confidence: 0.90,
    fix: {
      before: `// DANGEROUS — arbitrary code execution\nconst result = eval(userInput);\nconst data = eval("(" + jsonString + ")");`,
      after: `// SAFE — use purpose-built parsers\nconst data = JSON.parse(jsonString); // for JSON\n// For math expressions: use mathjs or expr-eval\nimport { evaluate } from "mathjs";\nconst result = evaluate(sanitizedExpression);`,
      language: "typescript",
    },
  },
  // ── XSS ───────────────────────────────────────────────────────────────────
  {
    id: "dangerous-innerhtml",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{/g,
    severity: "high",
    description: (_, file) =>
      `\`dangerouslySetInnerHTML\` found in ${file}. Injecting unescaped HTML enables XSS attacks.`,
    suggestion:
      "Sanitize with DOMPurify: { __html: DOMPurify.sanitize(content) }. Or use a safe markdown renderer.",
    category: "security",
    confidence: 0.88,
    fix: {
      before: `// VULNERABLE — raw HTML from user/API injected directly\n<div dangerouslySetInnerHTML={{ __html: userComment }} />`,
      after: `// SAFE — sanitize before rendering\nimport DOMPurify from "dompurify";\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userComment) }} />\n// Or use a safe markdown renderer:\nimport ReactMarkdown from "react-markdown";\n<ReactMarkdown>{userComment}</ReactMarkdown>`,
      language: "tsx",
    },
  },
  {
    id: "innerhtml-assignment",
    pattern: /\.innerHTML\s*=(?!=)/g,
    severity: "high",
    description: (_, file) =>
      `Direct innerHTML assignment in ${file}. Assigning unescaped HTML to innerHTML creates XSS vulnerabilities.`,
    suggestion:
      "Use textContent for plain text. For HTML, sanitize with DOMPurify before assigning to innerHTML.",
    category: "security",
    confidence: 0.82,
    fix: {
      before: `// VULNERABLE\ndocument.getElementById("output").innerHTML = apiResponse.html;`,
      after: `// SAFE — plain text\ndocument.getElementById("output").textContent = apiResponse.text;\n// Or for HTML with sanitization:\nimport DOMPurify from "dompurify";\ndocument.getElementById("output").innerHTML = DOMPurify.sanitize(apiResponse.html);`,
      language: "typescript",
    },
  },
  // ── SSRF ──────────────────────────────────────────────────────────────────
  {
    id: "ssrf-risk",
    pattern: /(?:fetch|axios\.get|axios\.post|http\.get|https\.get|request)\s*\([^)]*(?:req\.|params\.|query\.|body\.)/g,
    severity: "high",
    description: (_, file) =>
      `Potential SSRF in ${file}: user-controlled input used in an outbound HTTP request URL.`,
    suggestion:
      "Validate request URLs against an allowlist of trusted domains. Never forward raw user-supplied URLs.",
    category: "security",
    confidence: 0.80,
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
      "Use SHA-256 or SHA-512: crypto.createHash('sha256'). For passwords specifically, use bcrypt, argon2, or scrypt.",
    category: "security",
    confidence: 0.95,
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
      `Math.random() in ${file}. Not cryptographically secure — unsuitable for tokens, IDs, or security-critical values.`,
    suggestion:
      "Use crypto.randomUUID() for IDs or crypto.getRandomValues() for raw bytes.",
    category: "security",
    confidence: 0.55,
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
    confidence: 0.92,
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
    severity: "high",
    description: (_, file) =>
      `CORS wildcard origin in ${file}. Allowing all origins enables cross-site request forgery from any domain.`,
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
    pattern: /[?&](?:token|password|secret|api_key|apikey|key)=[^&"'\s]/gi,
    severity: "high",
    description: (_, file) =>
      `Sensitive data in URL query parameter in ${file}. URL parameters appear in logs, history, and Referer headers.`,
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
    pattern: /new RegExp\s*\([^)]*(?:req\.|params\.|query\.|body\.)/g,
    severity: "high",
    description: (_, file) =>
      `User-controlled RegExp construction in ${file}. Attacker-supplied patterns can cause catastrophic backtracking (ReDoS).`,
    suggestion:
      "Never construct RegExp from user input. Use a fixed pattern with user input as a literal string match.",
    category: "security",
    confidence: 0.85,
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
    fix: {
      before: `// VULNERABLE — attacker sends "../../../etc/passwd"\nconst filePath = path.join(__dirname, "uploads", req.params.filename);\nconst data = fs.readFileSync(filePath);`,
      after: `import path from "path";\nconst UPLOADS_DIR = path.resolve(__dirname, "uploads");\nconst requested = path.resolve(UPLOADS_DIR, req.params.filename);\n// Ensure resolved path is within the allowed directory\nif (!requested.startsWith(UPLOADS_DIR + path.sep)) {\n  return res.status(400).json({ error: "Invalid file path" });\n}\nconst data = fs.readFileSync(requested);`,
      language: "typescript",
    },
  },
  // ── Info disclosure ────────────────────────────────────────────────────────
  {
    id: "console-log-secret",
    // Matches console.log calls where a credential-named identifier appears — but this
    // can also match on string message content ("No token provided"), so confidence is
    // kept below 0.70 to auto-downgrade severity from high → medium for ambiguous hits.
    pattern: /console\.(log|debug|info|warn)\s*\([^)]*(?:password|token|secret|key|auth|credential)/gi,
    severity: "high",
    description: (_, file) =>
      `Sensitive value potentially logged to console in ${file}. Credentials in logs are exposed in log aggregators and stdout.`,
    suggestion: "Remove sensitive values from logs. Use a structured logger with field masking for any secrets.",
    category: "security",
    confidence: 0.65,
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
    fix: {
      before: `// VULNERABLE — attacker crafts: /redirect?to=https://evil.com\napp.get("/redirect", (req, res) => {\n  res.redirect(req.query.to);\n});`,
      after: `const ALLOWED_REDIRECT_PATHS = ["/dashboard", "/profile", "/settings"];\napp.get("/redirect", (req, res) => {\n  const to = req.query.to as string;\n  // Only allow relative paths we control\n  if (!ALLOWED_REDIRECT_PATHS.includes(to)) {\n    return res.redirect("/dashboard");\n  }\n  res.redirect(to);\n});`,
      language: "typescript",
    },
  },
  // ── XML ────────────────────────────────────────────────────────────────────
  {
    id: "xxe-injection",
    pattern: /libxmljs|xml2js|DOMParser|parseFromString/g,
    severity: "medium",
    description: (_, file) =>
      `XML parsing in ${file}. Ensure external entity processing (XXE) is disabled.`,
    suggestion: "Disable XXE: for xml2js set { ignoreAttrs: false }. For DOMParser, avoid parsing untrusted XML.",
    category: "security",
    confidence: 0.60,
    fix: {
      before: `import xml2js from "xml2js";\nconst result = await xml2js.parseStringPromise(req.body); // XXE possible`,
      after: `import xml2js from "xml2js";\n// Disable entity expansion to prevent XXE\nconst result = await xml2js.parseStringPromise(req.body, {\n  explicitArray: false,\n  ignoreAttrs: false,\n  // xml2js strips DOCTYPE by default — ensure you're on a recent version\n});\n// For untrusted XML, consider using a dedicated XXE-safe library like fast-xml-parser`,
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
    fix: {
      before: `# Dockerfile\nRUN npm install --unsafe-perm`,
      after: `# Dockerfile — run as non-root user instead\nRUN addgroup -S appgroup && adduser -S appuser -G appgroup\nUSER appuser\nRUN npm install`,
      language: "bash",
    },
  },
  // ── NoSQL Injection ────────────────────────────────────────────────────────
  {
    id: "nosql-injection",
    pattern: /(?:find|findOne|findMany|updateOne|deleteOne)\s*\(\s*\{[^}]*(?:req\.|params\.|query\.|body\.)[^}]*\}/g,
    severity: "high",
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
    severity: "high",
    description: (_, file) =>
      `HTTP header injection risk in ${file}: user-controlled input set directly in a response header. CRLF sequences (\\r\\n) split headers, enabling response splitting attacks.`,
    suggestion:
      "Sanitize header values: strip \\r, \\n, and null bytes before calling setHeader. Validate against an allowlist where possible.",
    category: "security",
    confidence: 0.80,
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
    fix: {
      before: `// CRITICAL RCE — attacker sends: <%= process.mainModule.require('child_process').execSync('id') %>\nconst html = ejs.render(req.body.template, { user });`,
      after: `// SAFE — user data as variables, not as the template itself\nconst TEMPLATE = "<h1>Hello <%= name %></h1><p><%= message %></p>";\nconst html = ejs.render(TEMPLATE, {\n  name: req.body.name,    // data only\n  message: req.body.message, // data only\n});`,
      language: "typescript",
    },
  },
  // ── Deserialization ────────────────────────────────────────────────────────
  {
    id: "unsafe-deserialize",
    pattern: /(?:serialize\.unserialize|node-serialize|unserialize|pickle\.loads|yaml\.load\b|yaml\.unsafe_load)/g,
    severity: "critical",
    description: (_, file) =>
      `Unsafe deserialization in ${file}. Deserializing untrusted data can lead to remote code execution (RCE).`,
    suggestion:
      "Use JSON.parse() for data interchange. For YAML, use yaml.safeLoad() / yaml.load() with { schema: FAILSAFE_SCHEMA }. Never deserialize untrusted binary/pickle data.",
    category: "security",
    confidence: 0.88,
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
    pattern: /(?:ApolloServer|createSchema|buildSchema)\s*\(\s*\{(?:[^}]|\{[^}]*\})*\}\s*\)(?![^]*depthLimit|[^]*queryComplexity)/g,
    severity: "medium",
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
  // ── Missing Auth Guards ────────────────────────────────────────────────────
  {
    id: "api-route-no-auth",
    pattern: /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\s*\([^)]*\)\s*\{(?![^}]*(?:getServerSession|getSession|currentUser|verifyToken|requireAuth|authenticate|session\s*\())/g,
    severity: "medium",
    description: (_, file) =>
      `Mutating API handler (POST/PUT/PATCH/DELETE) in ${file} may lack authentication guard. The function doesn't visibly call getServerSession, verifyToken, or equivalent.`,
    suggestion:
      "Add an auth check at the top: const session = await getServerSession(authOptions); if (!session?.user) return new Response('Unauthorized', { status: 401 });",
    category: "security",
    confidence: 0.58,
    fix: {
      before: `export async function POST(req: Request) {\n  const body = await req.json();\n  await db.update(body); // no auth check!\n}`,
      after: `import { getServerSession } from "next-auth";\nimport { authOptions } from "@/lib/auth";\n\nexport async function POST(req: Request) {\n  const session = await getServerSession(authOptions);\n  if (!session?.user) {\n    return Response.json({ error: "Unauthorized" }, { status: 401 });\n  }\n  const body = await req.json();\n  await db.update({ ...body, userId: session.user.id }); // scoped to user\n}`,
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
    pattern: /(?:create|update|upsert)\s*\(\s*\{[^}]*data\s*:\s*(?:req\.body|body|params)\s*(?:,|\})/g,
    severity: "high",
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
  // ── Environment Variables in Client Code ──────────────────────────────────
  {
    id: "server-env-in-client",
    pattern: /process\.env\.(?!NEXT_PUBLIC_)[A-Z_]{4,}\b(?=[^]*["']use client["']|export default function\s+\w+\s*\(\s*\)\s*\{[^}]*return\s*\()/g,
    severity: "high",
    description: (_, file) =>
      `Server-only environment variable may be exposed in a client component in ${file}. Non-NEXT_PUBLIC_ variables should never reach the browser bundle.`,
    suggestion:
      "Move the env access to a server component, API route, or server action. Only variables prefixed NEXT_PUBLIC_ are safe in client bundles.",
    category: "security",
    confidence: 0.65,
    fix: {
      before: `"use client";\n// DANGEROUS — DATABASE_URL bundled into client JS and visible in browser\nconst dbUrl = process.env.DATABASE_URL;\nconst apiKey = process.env.STRIPE_SECRET_KEY;`,
      after: `// SAFE — access server-only env vars in Server Components or API routes\n// In a Server Component (no "use client" directive):\nconst dbUrl = process.env.DATABASE_URL;\n\n// To expose config to the client, use NEXT_PUBLIC_ prefix:\nconst publicKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY; // safe`,
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
    fix: {
      before: `const isDev = true; // hardcoded — this reaches production\nif (isDev) showDetailedErrors();`,
      after: `const isDev = process.env.NODE_ENV === "development";\nif (isDev) showDetailedErrors(); // automatically false in production`,
      language: "typescript",
    },
  },
  // ── TLS verification disabled ─────────────────────────────────────────────
  {
    id: "tls-reject-unauthorized",
    pattern: /rejectUnauthorized\s*:\s*false/gi,
    severity: "critical",
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
    pattern: /["'](?:https?|mongodb(?:\+srv)?|postgresql|mysql|redis):\/\/[^:/"'\s]+:[^@/"'\s]+@[^"'\s]/gi,
    severity: "critical",
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
    severity: "medium",
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
];

// ── Unified quality rules ─────────────────────────────────────────────────────
// Used by both the PR reviewer and the repo scanner (no duplication).

interface QualityRule {
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
    pattern: /\/\/\s*(?:TODO|FIXME|HACK|XXX|BUG)\b/gi,
    severity: "low",
    description: (file, count) =>
      `${count} TODO/FIXME comment${count > 1 ? "s" : ""} in ${file}. Unresolved notes signal pending technical work.`,
    suggestion: "Convert TODOs to tracked GitHub issues. If blocking, resolve before merging.",
    scanLabel: "TODO/FIXME comments indicate incomplete or deferred work",
  },
  {
    id: "any-type",
    pattern: /:\s*any[\s,;)>\]]/g,
    severity: "low",
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
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    severity: "medium",
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
    description: (file, count) =>
      `${count} TypeScript suppression${count > 1 ? "s" : ""} in ${file}. @ts-ignore hides real type errors.`,
    suggestion: "Fix the underlying type error rather than suppressing it. Use @ts-expect-error with a comment if unavoidable.",
    scanLabel: "TypeScript suppression comments hide type errors",
  },
  {
    id: "nested-ternary",
    pattern: /\?[^:?\n]{0,80}\?[^:?\n]{0,80}:/g,
    severity: "low",
    description: (file) =>
      `Nested ternary operators in ${file}. Hard to read and easy to get wrong.`,
    suggestion: "Refactor into a clear if/else block or a named function.",
    scanLabel: "Nested ternary operators reduce readability",
  },
  {
    id: "no-await-in-loop",
    pattern: /for\s*(?:await\s*)?\s*\([^)]*\)[^{]*\{[^}]*\bawait\b/g,
    severity: "medium",
    description: (file) =>
      `await inside a loop in ${file}. Each iteration waits for the previous — serial instead of parallel.`,
    suggestion: "Collect promises in an array and resolve with Promise.all() for concurrent execution.",
    scanLabel: "await inside loops causes unnecessary serial execution",
    fix: {
      before: `// SLOW — sequential, each waits for previous\nfor (const userId of userIds) {\n  const user = await fetchUser(userId);\n  results.push(user);\n}`,
      after: `// FAST — all run concurrently\nconst results = await Promise.all(userIds.map(id => fetchUser(id)));`,
      language: "typescript",
    },
  },
  {
    id: "console-log-debug",
    pattern: /\bconsole\.(log|debug)\s*\(/g,
    severity: "low",
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
    id: "async-no-await",
    pattern: /\basync\s+function\s+\w+\s*\([^)]*\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g,
    severity: "low",
    description: (file) =>
      `Async function without await detected in ${file}. May be an unintentional async declaration.`,
    suggestion: "Remove async if no await is used, or add proper await and error handling with try/catch.",
    scanLabel: "Async functions without await — possibly unnecessary async",
  },
  {
    id: "magic-numbers",
    pattern: /(?<!=)\b(?:(?!0|1|-1|2|10|100|1000)\d{3,})\b(?!\s*[:;,)])/g,
    severity: "low",
    description: (file, count) =>
      `${count} unexplained numeric literal${count > 1 ? "s" : ""} in ${file}. Magic numbers reduce readability.`,
    suggestion: "Extract as named constants: const MAX_RETRY_COUNT = 5; const TIMEOUT_MS = 30_000;",
    scanLabel: "Magic numbers with no named constant",
    fix: {
      before: `setTimeout(callback, 86400000);\nif (retries > 3) throw new Error("max retries");\nconst buffer = Buffer.alloc(4096);`,
      after: `const ONE_DAY_MS = 24 * 60 * 60 * 1000; // 86_400_000\nconst MAX_RETRIES = 3;\nconst BUFFER_SIZE = 4_096;\n\nsetTimeout(callback, ONE_DAY_MS);\nif (retries > MAX_RETRIES) throw new Error("max retries");\nconst buffer = Buffer.alloc(BUFFER_SIZE);`,
      language: "typescript",
    },
  },
  {
    id: "promise-no-catch",
    pattern: /\.then\s*\([^)]*\)(?!\s*\.catch|\s*\.finally|\s*;?\s*\}?\s*return)/g,
    severity: "medium",
    description: (file, count) =>
      `${count} unhandled promise${count > 1 ? "s" : ""} in ${file}. .then() without .catch() silently swallows rejections.`,
    suggestion: "Add .catch(err => ...) or convert to async/await with try/catch.",
    scanLabel: "Unhandled promise rejections — .then() without .catch()",
    fix: {
      before: `fetchUser(id).then(user => setUser(user)); // rejection silently ignored`,
      after: `// Option 1 — .catch() chain\nfetchUser(id)\n  .then(user => setUser(user))\n  .catch(err => console.error("fetchUser failed:", err));\n\n// Option 2 — async/await (preferred)\ntry {\n  const user = await fetchUser(id);\n  setUser(user);\n} catch (err) {\n  console.error("fetchUser failed:", err);\n}`,
      language: "typescript",
    },
  },
  {
    id: "callback-hell",
    pattern: /function[^{]*\{[^}]*function[^{]*\{[^}]*function[^{]*\{/g,
    severity: "low",
    description: (file) =>
      `Deeply nested callback functions in ${file}. Callback nesting makes code hard to read and error-prone.`,
    suggestion: "Refactor to async/await or Promise chains. Extract inner callbacks to named functions.",
    scanLabel: "Callback nesting (callback hell) in function definitions",
  },
  {
    id: "commented-code",
    pattern: /(?:\/\/\s*(?:const|let|var|function|return|if|for|class|import|export)\s+\w+|\/\*\s*(?:const|let|var|function)\s)/g,
    severity: "low",
    description: (file, count) =>
      `${count} block${count > 1 ? "s" : ""} of commented-out code in ${file}. Dead code clutters the codebase.`,
    suggestion: "Delete commented-out code. Version control (git) preserves history — you can always recover it.",
    scanLabel: "Commented-out code blocks cluttering the codebase",
  },
  {
    id: "no-explicit-return-type",
    pattern: /export\s+(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{/g,
    severity: "low",
    description: (file, count) =>
      `${count} exported function${count > 1 ? "s" : ""} in ${file} without an explicit return type annotation.`,
    suggestion: "Add explicit return types to exported functions: export function foo(): ReturnType { ... }",
    scanLabel: "Exported functions missing explicit return type annotations",
  },
  {
    id: "long-parameter-list",
    pattern: /function\s+\w+\s*\((?:[^,)]+,){5,}[^)]*\)/g,
    severity: "low",
    description: (file) =>
      `Function with 6+ parameters detected in ${file}. Long parameter lists indicate a design smell.`,
    suggestion: "Group related parameters into an options object: function foo({ a, b, c, d, e }: FooOptions) {}",
    scanLabel: "Functions with too many parameters (6+) — design smell",
  },
  {
    id: "hardcoded-localhost",
    pattern: /["']https?:\/\/localhost:\d{4,5}\/[^"']{5,}["']/g,
    severity: "low",
    description: (file) =>
      `Hardcoded localhost URL in ${file}. Development URLs committed to source code will break in production.`,
    suggestion: "Use environment variables: process.env.API_BASE_URL. Never hardcode localhost in non-test code.",
    scanLabel: "Hardcoded localhost URLs that will break in production",
  },
  // ── React-specific ─────────────────────────────────────────────────────────
  {
    id: "missing-key-prop",
    pattern: /\.map\s*\(\s*(?:\([^)]*\)|[^=>\s]+)\s*=>\s*(?:<(?!\s*\w[^>]*\s+key=)[A-Z]|\(?\s*<(?!\s*\w[^>]*\s+key=))/g,
    severity: "medium",
    description: (file) =>
      `React list render without a 'key' prop in ${file}. Missing keys cause incorrect DOM reconciliation and performance issues.`,
    suggestion: "Add a stable unique key: items.map(item => <Item key={item.id} ... />). Never use array index as key for dynamic lists.",
    scanLabel: "React list renders without stable key props",
    fix: {
      before: `// React warns: Each child in a list should have a unique "key" prop\n{items.map(item => <ListItem name={item.name} />)}`,
      after: `// CORRECT — stable unique key from data\n{items.map(item => <ListItem key={item.id} name={item.name} />)}\n// Never use index as key for dynamic/sortable lists:\n// {items.map((item, i) => <ListItem key={i} />)} // ← wrong, causes subtle bugs`,
      language: "tsx",
    },
  },
  {
    id: "useeffect-missing-deps",
    pattern: /useEffect\s*\(\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{[^}]{50,}\},\s*\[\s*\]\s*\)/g,
    severity: "low",
    description: (file) =>
      `useEffect with empty dependency array and complex body in ${file}. Missing dependencies cause stale closures and subtle bugs.`,
    suggestion: "Audit the dependency array. Add all variables used inside the effect. Use eslint-plugin-react-hooks to catch this automatically.",
    scanLabel: "useEffect with empty deps array may have stale closure bugs",
  },
  {
    id: "inline-function-in-jsx",
    pattern: /(?:onClick|onChange|onSubmit|onKeyDown)\s*=\s*\{\s*(?:\([^)]*\)|_)\s*=>/g,
    severity: "low",
    description: (file, count) =>
      `${count} inline arrow function${count > 1 ? "s" : ""} in JSX event handlers in ${file}. Creates a new function reference on every render — may cause unnecessary child re-renders.`,
    suggestion: "Extract handlers to useCallback: const handleClick = useCallback(() => { ... }, [deps]). Matters most on frequently re-rendering components.",
    scanLabel: "Inline arrow functions in JSX event handlers cause re-renders",
  },
  // ── Error handling ─────────────────────────────────────────────────────────
  {
    id: "untyped-catch",
    pattern: /catch\s*\(\s*(e|err|error|ex)\s*\)\s*\{[^}]*\1\./g,
    severity: "low",
    description: (file) =>
      `Catch variable accessed without type narrowing in ${file}. In TypeScript, caught values are 'unknown' — accessing properties without instanceof checks crashes at runtime.`,
    suggestion: "Narrow the type: if (err instanceof Error) { console.error(err.message); }. Or use a utility: const msg = err instanceof Error ? err.message : String(err);",
    scanLabel: "Caught exceptions accessed without type narrowing (TypeScript)",
  },
  {
    id: "floating-promise",
    pattern: /(?:^|[^=])\b(?:fetch|prisma\.\w+|db\.\w+|sendEmail|sendSMS)\s*\([^)]*\)\s*(?:;|\n)(?!\s*\.(?:then|catch|finally)|\s*await)/gm,
    severity: "medium",
    description: (file) =>
      `Floating promise (not awaited, not .then'd) in ${file}. Errors from floating promises are silently swallowed and the operation may not complete.`,
    suggestion: "Add await or .catch(): await sendEmail(...).catch(err => console.error('email failed', err));",
    scanLabel: "Floating promises — async operations not awaited or chained",
    fix: {
      before: `sendEmail(user.email, "Welcome!"); // fire-and-forget — errors invisible\nprisma.log.create({ data: { event } }); // may not complete before function exits`,
      after: `// For background ops — explicitly fire-and-forget with error handling:\nvoid sendEmail(user.email, "Welcome!").catch(err =>\n  console.error("[sendEmail] failed:", err)\n);\n// For ops that must complete:\nawait prisma.log.create({ data: { event } });`,
      language: "typescript",
    },
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
    id: "switch-fallthrough",
    pattern: /case\s+[^:]+:\s*(?!(?:\s*\/\/\s*falls?\s*through|\s*return|\s*break|\s*throw|\s*continue))[\s\S]{1,100}case\s+/g,
    severity: "medium",
    description: (file) =>
      `Implicit switch fallthrough in ${file}. Accidental fallthrough executes unintended case bodies.`,
    suggestion: "Add explicit break, return, or throw in every case. If fallthrough is intentional, add a comment: // falls through.",
    scanLabel: "Switch statement fallthrough without explicit break",
  },
  {
    id: "double-negation",
    pattern: /!!\s*(?:\w+\.?\w*)\s*(?:[=!<>]|&&|\|\|)/g,
    severity: "low",
    description: (file, count) =>
      `${count} double negation (!!value) in ${file}. Usually indicates a type coercion smell; prefer Boolean(value) or explicit truthiness check.`,
    suggestion: "Replace !!value with Boolean(value) or a specific check: value !== null && value !== undefined.",
    scanLabel: "Double negation (!!value) for boolean coercion",
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
    pattern: /(?:express|fastify|app)\.\w+\s*\(['"][^'"]+['"]\s*,\s*(?:async\s*)?\([^)]*req[^)]*\)\s*=>\s*\{(?:[^}]|\{[^}]*\}){0,200}(?:req\.body|req\.params|req\.query)(?![^}]*(?:z\.|joi\.|yup\.|validate|sanitize|schema\.parse|safeParse))/g,
    severity: "medium",
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
    pattern: /(?<![=!<>])==(?![=>])/g,
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
];

// ── Performance rules ─────────────────────────────────────────────────────────
// Detects patterns that cause measurable runtime performance problems.

interface PerformanceRule {
  id: string;
  pattern: RegExp;
  severity: CodeReviewFinding["severity"];
  description: (file: string, count: number) => string;
  suggestion: string;
  scanLabel: string;
  fix?: RuleFix;
}

const PERFORMANCE_RULES: PerformanceRule[] = [
  // ── Database ───────────────────────────────────────────────────────────────
  {
    id: "n-plus-one-query",
    pattern: /(?:for|forEach|map)\s*\([^)]+\)\s*\{[^}]*(?:await\s+)?(?:prisma\.|db\.|mongoose\.|Model\.)\w+\./g,
    severity: "high",
    description: (file) =>
      `N+1 query pattern in ${file}: a database query executed inside a loop. For N items this issues N+1 round-trips, causing exponential latency growth.`,
    suggestion:
      "Batch the query outside the loop: use Prisma's include/select, SQL IN clauses, or DataLoader. Example: const users = await prisma.user.findMany({ where: { id: { in: ids } } });",
    scanLabel: "N+1 query: database call inside a loop (exponential latency)",
    fix: {
      before: `// N+1 — 1 query to get posts, then N queries for each author\nconst posts = await prisma.post.findMany();\nfor (const post of posts) {\n  post.author = await prisma.user.findUnique({ where: { id: post.authorId } });\n}`,
      after: `// 1 query total — Prisma joins automatically\nconst posts = await prisma.post.findMany({\n  include: { author: true },\n});\n// Or for custom batching:\nconst authorIds = posts.map(p => p.authorId);\nconst authors = await prisma.user.findMany({ where: { id: { in: authorIds } } });\nconst authorMap = Object.fromEntries(authors.map(a => [a.id, a]));\nposts.forEach(p => { p.author = authorMap[p.authorId]; });`,
      language: "typescript",
    },
  },
  {
    id: "select-star",
    pattern: /(?:db\.query|pool\.query|connection\.query)\s*\(\s*['"`]SELECT\s+\*/gi,
    severity: "medium",
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
  {
    id: "missing-pagination",
    pattern: /(?:findMany|find\s*\(\s*\{|getAll|fetchAll|list)\s*\([^)]*\)(?![^;]*(?:take|limit|per_page|pageSize|slice|\.slice))/g,
    severity: "medium",
    description: (file) =>
      `Unbounded list query in ${file} without visible pagination (take/limit/pageSize). Returns all rows — will OOM or timeout on large datasets.`,
    suggestion:
      "Add pagination: prisma.post.findMany({ take: 50, skip: page * 50, cursor: { id: lastId } }). Never return unbounded lists.",
    scanLabel: "List queries without pagination — OOM risk on large datasets",
    fix: {
      before: `const posts = await prisma.post.findMany(); // returns ALL rows — will OOM at scale`,
      after: `// Cursor-based pagination (fast, stable)\nconst posts = await prisma.post.findMany({\n  take: 50,\n  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),\n  orderBy: { id: "asc" },\n});\nconst nextCursor = posts.length === 50 ? posts[49].id : null;\nreturn { posts, nextCursor };`,
      language: "typescript",
    },
  },
  // ── I/O ────────────────────────────────────────────────────────────────────
  {
    id: "sync-file-io",
    pattern: /\b(?:readFileSync|writeFileSync|appendFileSync|existsSync|readdirSync|mkdirSync|unlinkSync|statSync|copyFileSync)\s*\(/g,
    severity: "high",
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
    id: "missing-memo",
    pattern: /(?:export\s+(?:default\s+)?function|const\s+\w+\s*=\s*(?:React\.)?forwardRef|const\s+\w+\s*:\s*(?:React\.)?FC)\s*\w*\s*\([^)]*\)\s*\{[^}]{200,}/g,
    severity: "low",
    description: (file) =>
      `Large React component in ${file} without visible React.memo wrapping. Components re-render on every parent render — wrap expensive ones.`,
    suggestion:
      "Wrap with React.memo: export default React.memo(MyComponent). Add useCallback for callbacks passed as props and useMemo for expensive computations.",
    scanLabel: "Large React components without memoization",
  },
  {
    id: "new-object-in-render",
    pattern: /(?:style|className|sx|tw)\s*=\s*\{\s*\{/g,
    severity: "low",
    description: (file, count) =>
      `${count} inline object literal${count > 1 ? "s" : ""} in JSX props in ${file}. New object reference on every render breaks React.memo and causes unnecessary re-renders.`,
    suggestion:
      "Move static objects outside the component or use useMemo: const style = useMemo(() => ({ color: theme.primary }), [theme.primary])",
    scanLabel: "Inline object literals in JSX props break memoization",
  },
  {
    id: "missing-lazy-load",
    pattern: /import\s+\w+\s+from\s+['"](?:react-pdf|@monaco-editor|recharts|chart\.js|three|@three|@lottiefiles|react-quill)/gi,
    severity: "medium",
    description: (file) =>
      `Heavy library imported at top-level in ${file}. Synchronous imports of large libraries increase initial bundle size and Time to Interactive.`,
    suggestion:
      "Lazy-load heavy components: const Chart = React.lazy(() => import('./Chart')). Wrap in <Suspense fallback={<Spinner/>}>.",
    scanLabel: "Heavy library imported without code-splitting — large initial bundle",
  },
  // ── Memory ─────────────────────────────────────────────────────────────────
  {
    id: "event-listener-leak",
    pattern: /addEventListener\s*\([^)]+\)(?![^;]*removeEventListener)(?![^}]*return\s*\(\s*\)\s*=>\s*(?:\w+\.)?removeEventListener)/g,
    severity: "medium",
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
    pattern: /setInterval\s*\([^)]+\)(?![^}]*clearInterval)/g,
    severity: "medium",
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
    id: "no-caching-header",
    pattern: /(?:res\.json|NextResponse\.json)\s*\([^)]+\)(?![^;]*(?:Cache-Control|stale-while-revalidate|max-age|s-maxage))/g,
    severity: "low",
    description: (file) =>
      `API response in ${file} without Cache-Control header. Public or semi-static data should set appropriate cache headers to reduce server load.`,
    suggestion:
      "Add caching where safe: return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } })",
    scanLabel: "API responses without Cache-Control — unnecessary server load",
  },
  {
    id: "sequential-awaits",
    pattern: /(?:const|let)\s+\w+\s*=\s*await\s+[\w.]+\([^;]*\);\s*(?:const|let)\s+\w+\s*=\s*await\s+[\w.]+\([^;]*\);\s*(?:const|let)\s+\w+\s*=\s*await\s+[\w.]+\([^;]*\);/g,
    severity: "medium",
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
];

// ── False-positive suppressor ─────────────────────────────────────────────────

/**
 * Removes comment-only lines, regex pattern definitions, rule prose fields, and
 * fix.before/fix.after example-code strings before scanning — prevents false positives
 * when a PR touches files that *define* detection rules (e.g., internal-ai.ts itself,
 * vuln_patterns.py). The `before`/`after` blocks contain intentionally bad code that
 * would otherwise trigger the very rules they demonstrate.
 */
function stripNonExecutable(code: string): string {
  let inTemplateLiteralFix = false;
  return code
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      // Track entry into fix.before / fix.after multi-line template literals
      if (/^\s*(?:"?(?:before|after)"?)\s*[:=]\s*`/.test(t)) {
        // If it doesn't close on the same line, mark as in-template
        const backtickCount = (t.match(/`/g) ?? []).length;
        if (backtickCount < 2) inTemplateLiteralFix = true;
        return "";
      }
      if (inTemplateLiteralFix) {
        if (t.includes("`")) inTemplateLiteralFix = false;
        return "";
      }
      // Strip pure comment lines
      if (/^(?:\/\/|\/\*|\*(?!\/)|#)/.test(t)) return "";
      // Strip regex pattern definition lines
      if (/\bpattern\s*[=:]\s*(?:r['"\/]|\/)/.test(t)) return "";
      // Strip rule prose and example-code fields (including fix.before / fix.after)
      if (/^\s*(?:"?(?:description|suggestion|scanLabel|id|cve_id|before|after|fix|language)"?)\s*[:(]/.test(t)) return "";
      // Strip JSDoc / TypeDoc lines
      if (/^@\w+/.test(t)) return "";
      // Replace inline regex literals with a safe placeholder
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
    const base = f.split("/").pop() ?? f;

    // Database migrations
    if (/migration|migrate/i.test(f) && /\.(sql|ts|js)$/.test(f)) {
      if (patch.includes("DROP TABLE") || patch.includes("DROP COLUMN")) {
        changes.push(`Destructive DB migration in ${base} — DROP operation detected. Data loss risk.`);
      } else if (/ADD COLUMN.+NOT NULL/i.test(patch) && !/DEFAULT/i.test(patch)) {
        changes.push(`Non-nullable column added in ${base} without DEFAULT — will fail on existing rows.`);
      } else if (patch.includes("ALTER TABLE") || patch.includes("CREATE TABLE")) {
        changes.push(`Database schema migration in ${base} — verify backward compatibility with running instances.`);
      }
    }

    // API route deletion or signature removal
    if (/app\/api\/|pages\/api\//.test(f)) {
      if (file.status === "deleted") {
        changes.push(`API endpoint removed: ${f} — existing consumers will receive 404 errors.`);
      } else if (/^-\s*export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/m.test(patch)) {
        changes.push(`HTTP method export removed in ${base} — API consumers calling that method will break.`);
      }
    }

    // TypeScript type/interface changes
    if (/\.d\.ts$|\/types\//.test(f)) {
      if (/^-\s+\w/m.test(patch)) {
        changes.push(`Type definitions modified in ${base} — TypeScript consumers may see compile errors.`);
      }
    }

    // Package.json — dependency removals or version change
    if (f === "package.json") {
      if (/"version":\s*"/.test(patch)) {
        changes.push("Package version bumped — ensure CHANGELOG.md is updated with semver-correct notes.");
      }
      const removedDeps = (patch.match(/^-\s+"[^"]+"/gm) ?? []).filter((l) => l.includes('": "'));
      if (removedDeps.length > 0) {
        changes.push(`${removedDeps.length} package(s) removed from package.json — verify no consumers depend on them.`);
      }
    }

    // Lock file changes (new packages or major version bumps)
    if (f === "package-lock.json" || f === "yarn.lock" || f === "pnpm-lock.yaml") {
      const addedPkgs = (patch.match(/^\+\s+"[^"]+"/gm) ?? []).length;
      if (addedPkgs > 20) {
        changes.push(`Lock file has ${addedPkgs} new entries — verify no unexpected transitive dependency was introduced.`);
      }
    }

    // Framework / build config
    if (/next\.config|tsconfig\.json|vite\.config|webpack\.config/.test(f)) {
      changes.push(`Build config changed in ${base} — verify CI/CD pipeline and all environments remain compatible.`);
    }

    // Environment variable additions (new required vars)
    if (f === ".env.example" || f === ".env.sample") {
      const newVars = (patch.match(/^\+[A-Z_]+=$/gm) ?? []).length;
      if (newVars > 0) {
        changes.push(`${newVars} new environment variable${newVars > 1 ? "s" : ""} added to .env.example — update all deployment environments.`);
      }
    }

    // Auth / middleware changes
    if (/middleware\.|auth\./i.test(f)) {
      changes.push(`Auth/middleware changed in ${base} — existing sessions or request pipelines may be affected.`);
    }

    // Test file deletions (regression risk)
    if (file.status === "deleted" && /\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(f)) {
      changes.push(`Test file deleted: ${base} — regression coverage reduced, ensure the feature is tested elsewhere.`);
    }

    // Barrel/index export removals
    if (/index\.(ts|tsx|js)$/.test(f) && /^-\s*export\s+/m.test(patch)) {
      changes.push(`Public export removed from ${base} — downstream imports of this module may break.`);
    }
  }

  return [...new Set(changes)].slice(0, 8);
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

// ── Performance scorer (PR diff) ─────────────────────────────────────────────

function scorePerformance(
  files: Array<{ filename: string; patch?: string }>
): { findings: CodeReviewFinding[] } {
  const findings: CodeReviewFinding[] = [];
  const linesAdded = files.flatMap((f) =>
    (f.patch ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  );
  const patchText = stripNonExecutable(linesAdded.join("\n"));

  for (const rule of PERFORMANCE_RULES) {
    const matches = patchText.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    const affectedFile =
      files.find((f) => (f.patch ?? "").match(rule.pattern))?.filename ?? "unknown file";
    if (findings.length < 5) {
      findings.push({
        severity: rule.severity,
        category: "performance",
        file: affectedFile,
        description: rule.description(affectedFile.split("/").slice(-2).join("/"), matches.length),
        suggestion: rule.suggestion,
        fix: rule.fix,
      });
    }
  }

  return { findings };
}

// ── Quality scorer (PR diff) ──────────────────────────────────────────────────

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
    if (!matches || matches.length === 0) continue;
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
        fix: rule.fix,
      });
    }
  }

  if (findings.length === 0) score = Math.min(score + 5, 95);
  return { score: Math.max(20, Math.min(95, score)), findings };
}

// ── Security scorer (PR diff) ─────────────────────────────────────────────────

function scoreSecurity(
  files: Array<{ filename: string; patch?: string }>
): { score: number; findings: CodeReviewFinding[]; issues: string[] } {
  let score = 88;
  const findings: CodeReviewFinding[] = [];
  const issues: string[] = [];

  for (const file of files) {
    const addedLines = stripNonExecutable(
      (file.patch ?? "")
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .join("\n")
    );
    const seenRules = new Set<string>();

    for (const rule of SECURITY_RULES) {
      if (seenRules.has(rule.id)) continue;
      const matches = addedLines.match(rule.pattern);
      if (!matches) continue;

      seenRules.add(rule.id);
      const firstMatch = matches[0].slice(0, 80);

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

      if (findings.length < 10) {
        findings.push({
          severity: effectiveSeverity,
          category: "security",
          file: file.filename,
          description: rule.description(firstMatch, file.filename.split("/").slice(-2).join("/")),
          suggestion: rule.suggestion,
          codeSnippet: firstMatch.slice(0, 120),
          fix: rule.fix,
        });
      }
      issues.push(rule.description(firstMatch, file.filename.split("/").slice(-1)[0]).split(".")[0]);
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    findings,
    issues: [...new Set(issues)].slice(0, 6),
  };
}

// ── Test coverage estimator ───────────────────────────────────────────────────

function estimateTestCoverage(files: Array<{ filename: string; additions: number; deletions: number }>): number {
  const testFiles = files.filter((f) => /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/.test(f.filename));
  const sourceFiles = files.filter(
    (f) => !/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/.test(f.filename) &&
           /\.(ts|tsx|js|jsx|py|go|rs)$/.test(f.filename)
  );

  if (sourceFiles.length === 0) return 70;
  if (testFiles.length === 0) return 15;

  const testRatio = testFiles.length / (sourceFiles.length + testFiles.length);
  return Math.round(Math.min(90, testRatio * 130));
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
  const totalAdditions = prMeta?.additions ?? commitMeta?.stats?.additions ?? files.reduce((a, f) => a + f.additions, 0);
  const totalDeletions = prMeta?.deletions ?? commitMeta?.stats?.deletions ?? files.reduce((a, f) => a + f.deletions, 0);

  // Run all analyzers in sequence
  const security = scoreSecurity(files);
  const quality = scoreQuality(files);
  const performance = scorePerformance(files);
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
  const allFindings = [...security.findings, ...quality.findings, ...performance.findings].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );

  const flags = [...new Set([
    ...valueFlags,
    ...(breakingChanges.length > 0 ? ["breaking-change"] : []),
    ...(security.score < 60 ? ["security"] : []),
    ...(allFindings.some((f) => f.category === "security" && (f.severity === "critical" || f.severity === "high")) ? ["security"] : []),
    ...(files.some((f) => /auth|login|session|oauth/i.test(f.filename)) ? ["auth"] : []),
    ...(files.some((f) => /migration|\.sql/i.test(f.filename)) ? ["database"] : []),
    ...(files.some((f) => /package\.json|requirements\.txt|Gemfile/.test(f.filename)) ? ["deps"] : []),
    ...(files.some((f) => /api\//.test(f.filename)) ? ["api-contract"] : []),
    ...(files.some((f) => /\.(test|spec)\./.test(f.filename)) ? ["tests"] : []),
  ])];

  const criticalCount = allFindings.filter((f) => f.severity === "critical").length;
  const highCount = allFindings.filter((f) => f.severity === "high").length;
  const mediumCount = allFindings.filter((f) => f.severity === "medium").length;

  let verdict: CodeReviewResult["verdict"];
  let mergeRisk: CodeReviewResult["mergeRisk"];

  if (criticalCount > 0 || breakingChanges.length > 3 || security.score < 40) {
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

  // Confidence — higher when we have actual patch data to scan
  const confidence = Math.min(85, 50 +
    (files.length > 0 ? 10 : 0) +
    (files.some((f) => f.patch) ? 15 : 0) +
    (allFindings.length > 0 ? 5 : 0) +
    (breakingChanges.length > 0 ? 5 : 0)
  );

  // Summary generation
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
    summaryParts.push("No significant issues detected. The change looks clean.");
  }

  if (breakingChanges.length > 0) {
    summaryParts.push("Breaking changes detected — coordinate with downstream consumers before deploying.");
  }

  // Positives
  const positives: string[] = [];
  if (security.score >= 85) positives.push("No security vulnerabilities detected in the diff");
  else if (security.score >= 70) positives.push("Minor security notes only — no critical or high severity issues");
  if (testCoverage >= 60) positives.push("Good test coverage accompanying the changes");
  else if (testCoverage >= 40) positives.push("Some test coverage included with the changes");
  if (files.some((f) => /\.md$/.test(f.filename))) positives.push("Documentation updated alongside the code");
  if (/^(feat|fix|refactor|perf|security|chore|docs|test)\(/.test(title)) positives.push("Conventional commit message format — great for changelog generation");
  if (totalAdditions < 150 && files.length > 1) positives.push("Focused, well-scoped change — easy to review");
  if (files.some((f) => /\.(test|spec)\./.test(f.filename)) && testCoverage >= 40) positives.push("Tests included with implementation changes");
  if (positives.length === 0) positives.push("Change is syntactically valid and follows basic code structure");

  // Hot files (most changed)
  const hotFiles = [...files]
    .sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions))
    .slice(0, 5)
    .map((f) => f.filename);

  // Impact areas
  const impactAreas: string[] = [];
  if (files.some((f) => /auth|login|session|oauth/i.test(f.filename))) impactAreas.push("authentication");
  if (files.some((f) => /api\//.test(f.filename))) impactAreas.push("API");
  if (files.some((f) => /prisma|migration|\.sql/i.test(f.filename))) impactAreas.push("database");
  if (files.some((f) => /components?\/|pages?\/|app\//.test(f.filename))) impactAreas.push("frontend");
  if (files.some((f) => /lib\/|utils?\/|helpers?\//.test(f.filename))) impactAreas.push("shared-utilities");
  if (files.some((f) => /\.(test|spec)\./.test(f.filename))) impactAreas.push("test-suite");
  if (files.some((f) => /middleware\.|\.middleware\./.test(f.filename))) impactAreas.push("middleware");
  if (files.some((f) => /package\.json|package-lock\.json|yarn\.lock/.test(f.filename))) impactAreas.push("dependencies");

  // Recommendation
  let recommendation = "";
  if (verdict === "REQUEST_CHANGES") {
    recommendation = `Fix the ${criticalCount > 0 ? `${criticalCount} critical security issue${criticalCount > 1 ? "s" : ""}` : "identified high-severity issues"} before merging.${breakingChanges.length > 0 ? " Coordinate breaking changes with all consumers." : ""} Run a targeted security audit on the affected files.`;
  } else if (verdict === "COMMENT") {
    recommendation = `Review the ${highCount > 0 ? `${highCount} high` : `${mediumCount} medium`}-severity concern${highCount + mediumCount > 1 ? "s" : ""} and confirm they are acceptable or addressed.${breakingChanges.length > 0 ? " Document breaking changes in the PR description." : ""} The change is mergeable once reviewed.`;
  } else {
    recommendation = "Static analysis is clean. Confirm CI passes and do a final human review of the logic, then merge.";
  }

  // Review checklist
  const reviewChecklist = [
    `Review all ${files.length} changed file${files.length !== 1 ? "s" : ""} for logical correctness`,
    ...(security.findings.length > 0 ? [`Address ${security.findings.length} security finding${security.findings.length > 1 ? "s" : ""} before merge`] : []),
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
      breakingRisk: Math.min(95, breakingChanges.length * 18 + (mergeRisk === "critical" ? 45 : mergeRisk === "high" ? 28 : 12)),
    },
    flags,
    findings: allFindings.slice(0, 12),
    breakingChanges,
    securityIssues: security.issues,
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
      "Dependency Tree"
    ),
    diffStats: {
      fileCount: files.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      hotFiles,
    },
    model: "gitscope-internal-v3",
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

export function scanRepoWithInternalAI(input: InternalRepoScanInput): RepoScanResult {
  const { repo, fileTree, keyFileContents, contributors, meta, importGraph = {} } = input;

  // ── Package.json parsing ───────────────────────────────────────────────────
  let pkg: Record<string, unknown> = {};
  const rawPkg = keyFileContents["package.json"] ??
    keyFileContents[Object.keys(keyFileContents).find((k) => k.endsWith("/package.json")) ?? ""];
  if (rawPkg) { try { pkg = JSON.parse(rawPkg); } catch { /* ok */ } }

  const prodDeps = (pkg.dependencies ?? {}) as Record<string, string>;
  const devDepsObj = (pkg.devDependencies ?? {}) as Record<string, string>;
  const deps: Record<string, string> = { ...prodDeps, ...devDepsObj };
  const depCount = Object.keys(deps).length;

  // ── Evidence-based detection flags ────────────────────────────────────────
  const contentKeys = Object.keys(keyFileContents);

  const hasTypeScript = fileTree.some((f) => f.endsWith(".ts") || f.endsWith(".tsx")) || "typescript" in deps;
  const hasTests = fileTree.some((f) => /\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/.test(f));
  const hasTestDir = fileTree.some((f) =>
    f.startsWith("test/") || f.startsWith("__tests__/") || f.startsWith("spec/") || f.startsWith("tests/") || f.startsWith("e2e/")
  );
  const hasDocker = fileTree.some((f) => f === "Dockerfile" || f.startsWith("docker-compose") || f === ".dockerignore");
  const hasKubernetes = fileTree.some((f) => /\.k8s\.|kubernetes\/|helm\/|k8s\//.test(f) || f === "k8s.yml" || f === "k8s.yaml");

  // CI: must find actual workflow .yml files, not just the directory
  const hasCI = fileTree.some((f) =>
    /^\.github\/workflows\/.+\.ya?ml$/i.test(f) ||
    f === ".gitlab-ci.yml" ||
    /^\.circleci\/config\.ya?ml$/.test(f) ||
    f === "Jenkinsfile" || f === ".travis.yml" || f === "circle.yml" ||
    f === "bitbucket-pipelines.yml" || f === "azure-pipelines.yml" ||
    f === "Makefile"
  );

  // Linting: ESLint v8/v9, Biome, XO, Prettier — or devDep
  const hasLinting =
    fileTree.some((f) =>
      /\.eslintrc\.(json|js|cjs|mjs|yml|yaml)$|^\.eslintrc$/.test(f) ||
      /^eslint\.config\.(js|mjs|cjs|ts)$/.test(f) ||
      f === "biome.json" || f === "biome.jsonc" || f === ".xo-config.js"
    ) ||
    contentKeys.some((k) => /eslint\.config|\.eslintrc/.test(k)) ||
    "eslint" in deps || "biome" in deps || "@biomejs/biome" in deps || "xo" in deps;

  const hasFormatting =
    fileTree.some((f) => f === ".prettierrc" || f === ".prettierrc.json" || f === "prettier.config.js" || f === ".editorconfig") ||
    "prettier" in deps;

  // Database / ORM
  const hasPrisma = fileTree.some((f) => f.startsWith("prisma/")) || "prisma" in deps || "@prisma/client" in deps;
  const hasDrizzle = "drizzle-orm" in deps;
  const hasMongoose = "mongoose" in deps;
  const hasSequelize = "sequelize" in deps;
  const hasTypeORM = "typeorm" in deps;
  const hasAnyORM = hasPrisma || hasDrizzle || hasMongoose || hasSequelize || hasTypeORM;

  // Frameworks
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

  // Auth
  const hasAuth = "next-auth" in deps || "passport" in deps || "@auth/core" in deps ||
    "jose" in deps || "@clerk/nextjs" in deps || "lucia" in deps || "better-auth" in deps ||
    "auth0" in deps || "@auth0/nextjs-auth0" in deps;

  // Payments & services
  const hasStripe = "stripe" in deps;
  const hasRedis = "ioredis" in deps || "redis" in deps || "upstash__redis" in deps || "@upstash/redis" in deps;
  const hasQueue = "bull" in deps || "bullmq" in deps || "bee-queue" in deps;
  const hasEmail = "nodemailer" in deps || "resend" in deps || "@sendgrid/mail" in deps || "postmark" in deps;
  const hasMonitoring = "sentry" in deps || "@sentry/node" in deps || "@sentry/nextjs" in deps ||
    "datadog" in deps || "newrelic" in deps || "pino" in deps || "winston" in deps;

  // Structure
  const hasMigrations = fileTree.some((f) => /migration|migrate/i.test(f) && /\.(sql|ts|js)$/.test(f));
  const hasEnvExample = fileTree.some((f) => f === ".env.example" || f === ".env.sample" || f === ".env.template");
  const hasFeatureModules = fileTree.filter((f) => f.startsWith("src/features/")).length > 3;
  const hasApiRoutes = fileTree.filter((f) => /\/api\//.test(f)).length > 2;
  const hasSrcDir = fileTree.some((f) => f.startsWith("src/"));
  const hasAppDir = fileTree.some((f) => f.startsWith("app/") || f.startsWith("src/app/"));

  // Monorepo
  const hasMonorepo = fileTree.some((f) => f === "turbo.json" || f === "nx.json" || f === "lerna.json" || f === "pnpm-workspace.yaml");
  const hasWorkspaces = Array.isArray(pkg.workspaces);

  // Testing frameworks (specific ones)
  const hasJest = "jest" in deps;
  const hasVitest = "vitest" in deps;
  const hasMocha = "mocha" in deps;
  const hasCypress = "cypress" in deps;
  const hasPlaywright = "@playwright/test" in deps || "playwright" in deps;
  const hasTestingLibrary = "@testing-library/react" in deps || "@testing-library/vue" in deps;
  const hasAnyE2E = hasCypress || hasPlaywright;
  const hasAnyTestFramework = hasJest || hasVitest || hasMocha || "pytest" in deps;

  // Containerization / Infrastructure
  const hasServerless = fileTree.some((f) => f === "serverless.yml" || f === "vercel.json" || f === "netlify.toml" || f === ".vercel");

  // Security headers / middleware
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
      rawEstLoc < 500 ? `${rawEstLoc} lines` :
      rawEstLoc < 1_000 ? `${rawEstLoc} lines` :
      rawEstLoc < 10_000 ? `${(rawEstLoc / 1000).toFixed(1)}k lines` :
      `${Math.round(rawEstLoc / 1000)}k lines`;
  }

  // ── Security scanning of fetched file contents ────────────────────────────
  const codeSecurityFindings: RepoScanFinding[] = [];
  const ruleHits = new Map<string, number>();

  for (const [filename, content] of Object.entries(keyFileContents)) {
    if (!content || NON_CODE_EXTENSIONS.test(filename)) continue;
    // Skip files that define security/analysis rules — scanning them would flag their own
    // example code (intentionally bad patterns) and regex pattern strings as real issues.
    if (/(?:internal-ai|security-rules?|vuln[_-]patterns?|rule[_-]definitions?|static[_-]analysis)\.(ts|js|py)$/.test(filename)) continue;
    // Skip test/spec files — intentional mocks, hardcoded fixtures, and test credentials
    // are normal in test code and should not be flagged as production security issues.
    if (/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/.test(filename)) continue;
    const stripped = stripNonExecutable(content);

    for (const rule of SECURITY_RULES) {
      const hitCount = ruleHits.get(rule.id) ?? 0;
      if (hitCount >= 3) continue;

      const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
      const matches = stripped.match(regex);
      if (!matches) continue;

      ruleHits.set(rule.id, hitCount + 1);

      const effectiveSev: RepoScanFinding["severity"] =
        (rule.confidence ?? 1) < 0.55 ? "low" :
        (rule.confidence ?? 1) < 0.70 && rule.severity === "critical" ? "high" :
        rule.severity as RepoScanFinding["severity"];

      codeSecurityFindings.push({
        severity: effectiveSev,
        category: rule.category as RepoScanFinding["category"],
        file: filename,
        description: rule.description(matches[0].slice(0, 80), filename),
        suggestion: rule.suggestion,
        fix: rule.fix,
      });
    }
  }

  // ── Quality scanning of fetched file contents ─────────────────────────────
  const qualityFindings: RepoScanFinding[] = [];
  const qRuleFiles = new Map<string, Set<string>>();

  for (const [filename, content] of Object.entries(keyFileContents)) {
    if (!content || !/\.(ts|tsx|js|jsx|py|go|rs|java|cs|rb|php)$/.test(filename)) continue;
    // Skip rule-definition and test files from quality scanning too
    if (/(?:internal-ai|security-rules?|vuln[_-]patterns?)\.(ts|js|py)$/.test(filename)) continue;
    if (/\.(test|spec)\.(ts|tsx|js|jsx|py|go|rs)$/.test(filename)) continue;
    const stripped = stripNonExecutable(content);

    for (const rule of QUALITY_RULES) {
      const files = qRuleFiles.get(rule.id) ?? new Set<string>();
      if (files.size >= 3) continue;

      const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
      const matches = stripped.match(regex);
      if (!matches) continue;

      files.add(filename);
      qRuleFiles.set(rule.id, files);

      qualityFindings.push({
        severity: rule.severity,
        category: "quality",
        file: filename,
        description: `${rule.scanLabel} — ${matches.length} occurrence${matches.length !== 1 ? "s" : ""} in ${filename.split("/").slice(-2).join("/")}`,
        suggestion: rule.suggestion,
        fix: rule.fix,
      });
    }
  }

  // ── Performance scanning of fetched file contents ────────────────────────
  const performanceFindings: RepoScanFinding[] = [];
  const perfRuleFiles = new Map<string, Set<string>>();

  for (const [filename, content] of Object.entries(keyFileContents)) {
    if (!content || !/\.(ts|tsx|js|jsx|py)$/.test(filename)) continue;
    const stripped = stripNonExecutable(content);

    for (const rule of PERFORMANCE_RULES) {
      const files = perfRuleFiles.get(rule.id) ?? new Set<string>();
      if (files.size >= 2) continue;

      const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
      const matches = stripped.match(regex);
      if (!matches) continue;

      files.add(filename);
      perfRuleFiles.set(rule.id, files);

      performanceFindings.push({
        severity: rule.severity,
        category: "performance",
        file: filename,
        description: `${rule.scanLabel} — ${matches.length} occurrence${matches.length !== 1 ? "s" : ""} in ${filename.split("/").slice(-2).join("/")}`,
        suggestion: rule.suggestion,
        fix: rule.fix,
      });
    }
  }

  // ── Cross-file analysis using import graph ────────────────────────────────
  // Detects issues that only appear when tracing data flow across file boundaries.
  const crossFileFindings: RepoScanFinding[] = [];

  if (Object.keys(importGraph).length > 0) {
    // Resolve a specifier to an actual file path in keyFileContents
    const resolveImport = (fromFile: string, specifier: string): string | null => {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !specifier.startsWith("~/")) return null;
      const base = fromFile.split("/").slice(0, -1).join("/");
      const candidates = [
        specifier,
        `${specifier}.ts`, `${specifier}.tsx`, `${specifier}.js`, `${specifier}.jsx`,
        `${specifier}/index.ts`, `${specifier}/index.tsx`, `${specifier}/index.js`,
      ].map((s) => {
        if (s.startsWith("@/") || s.startsWith("~/")) return s.slice(2);
        if (s.startsWith("./") || s.startsWith("../")) {
          const parts = `${base}/${s}`.split("/");
          const resolved: string[] = [];
          for (const p of parts) {
            if (p === "..") resolved.pop();
            else if (p !== ".") resolved.push(p);
          }
          return resolved.join("/");
        }
        return s;
      });
      return Object.keys(keyFileContents).find((f) => candidates.some((c) => f === c || f.endsWith(`/${c}`))) ?? null;
    };

    // Build a map of which files have which security properties
    const fileHasAuth = new Map<string, boolean>();
    const fileHasValidation = new Map<string, boolean>();
    const fileHasDbOp = new Map<string, boolean>();
    const fileIsClientComponent = new Map<string, boolean>();
    const fileHasServerEnv = new Map<string, boolean>();
    const fileHasRawInput = new Map<string, boolean>();

    for (const [file, content] of Object.entries(keyFileContents)) {
      fileHasAuth.set(file, /getServerSession|getSession|verifyToken|requireAuth|currentUser|session\.user|authenticate\(/i.test(content));
      fileHasValidation.set(file, /z\.object|z\.string|joi\.|yup\.|safeParse|schema\.parse|validate\(/i.test(content));
      fileHasDbOp.set(file, /prisma\.\w+\.(find|create|update|delete|upsert)|db\.query|mongoose\.\w+\.(find|save|update|delete)|\.execute\(/i.test(content));
      fileIsClientComponent.set(file, /^["']use client["']/m.test(content));
      fileHasServerEnv.set(file, /process\.env\.(?!NEXT_PUBLIC_)[A-Z_]{4,}/g.test(content));
      fileHasRawInput.set(file, /req\.body|req\.params|req\.query|request\.body|ctx\.body/i.test(content));
    }

    // ── Pattern 1: Unvalidated input flows into a file that does DB operations ──
    // Route/handler with raw req.body → imported into (or imports) a DB file without validation
    for (const [file, content] of Object.entries(keyFileContents)) {
      if (!fileHasRawInput.get(file)) continue;
      if (fileHasValidation.get(file)) continue; // validated at source ✓

      const specifiers = importGraph[file] ?? [];
      for (const spec of specifiers) {
        const target = resolveImport(file, spec);
        if (!target) continue;
        if (fileHasDbOp.get(target) && !fileHasValidation.get(target)) {
          crossFileFindings.push({
            severity: "high",
            category: "security",
            file,
            description: `Unvalidated input flow: \`${file.split("/").slice(-2).join("/")}\` reads \`req.body/params/query\` without schema validation and passes data into \`${target.split("/").slice(-2).join("/")}\` which performs database operations. Attacker-controlled values reach the DB layer unchecked.`,
            suggestion: `Add Zod validation in ${file.split("/").pop()} before passing data downstream:\nconst body = z.object({ id: z.string(), name: z.string().max(100) }).parse(req.body);\nThen pass only the typed \`body\` — not raw \`req.body\` — to ${target.split("/").pop()}.`,
            fix: {
              before: `// ${file.split("/").pop()} — no validation\nexport async function POST(req) {\n  const data = await req.json(); // unvalidated\n  await createRecord(data);      // flows into DB layer\n}`,
              after: `// ${file.split("/").pop()} — validated at the boundary\nimport { z } from "zod";\nconst Schema = z.object({ name: z.string().min(1).max(100) });\nexport async function POST(req) {\n  const data = Schema.parse(await req.json());\n  await createRecord(data); // typed, safe\n}`,
              language: "typescript",
            },
          });
          break; // one finding per source file
        }
      }
    }

    // ── Pattern 2: Mutating API route with no auth delegates to a handler ──────
    // Route file has no auth check → imports a handler file that does privileged ops
    for (const [file, content] of Object.entries(keyFileContents)) {
      const isApiRoute = /app\/api\/|pages\/api\/|routes\//.test(file) &&
        /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)|router\.(post|put|patch|delete)/i.test(content);
      if (!isApiRoute) continue;
      if (fileHasAuth.get(file)) continue; // auth at route level ✓

      for (const spec of (importGraph[file] ?? [])) {
        const target = resolveImport(file, spec);
        if (!target) continue;
        const targetContent = keyFileContents[target] ?? "";
        if (fileHasDbOp.get(target) || /delete|remove|drop|truncate|destroy|admin/i.test(targetContent)) {
          crossFileFindings.push({
            severity: "high",
            category: "security",
            file,
            description: `Auth bypass chain: \`${file.split("/").slice(-2).join("/")}\` is a mutating API route with no visible authentication check, yet it delegates to \`${target.split("/").slice(-2).join("/")}\` which performs privileged/database operations. Any unauthenticated caller can trigger these operations.`,
            suggestion: `Add an auth guard at the top of ${file.split("/").pop()} before calling into ${target.split("/").pop()}:\nconst session = await getServerSession(authOptions);\nif (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });`,
            fix: {
              before: `// ${file.split("/").pop()} — no auth\nexport async function DELETE(req) {\n  return deleteResource(req); // anyone can call this\n}`,
              after: `// ${file.split("/").pop()} — auth gated\nexport async function DELETE(req) {\n  const session = await getServerSession(authOptions);\n  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });\n  return deleteResource(req);\n}`,
              language: "typescript",
            },
          });
          break;
        }
      }
    }

    // ── Pattern 3: Server-only env var in a file imported by a client component ─
    for (const [file] of Object.entries(keyFileContents)) {
      if (!fileHasServerEnv.get(file)) continue;
      // Check if any client component imports this file
      for (const [clientFile, specifiers] of Object.entries(importGraph)) {
        if (!fileIsClientComponent.get(clientFile)) continue;
        const resolved = specifiers.map((s) => resolveImport(clientFile, s)).filter(Boolean);
        if (resolved.includes(file)) {
          crossFileFindings.push({
            severity: "high",
            category: "security",
            file,
            description: `Secret exposure risk: \`${file.split("/").slice(-2).join("/")}\` accesses server-only environment variables (non-NEXT_PUBLIC_) and is imported by the client component \`${clientFile.split("/").slice(-2).join("/")}\`. These secrets will be included in the browser bundle.`,
            suggestion: `Move the env-accessing code out of \`${file.split("/").pop()}\` into a Server Component, API route, or server action. If the client needs a value, expose only a NEXT_PUBLIC_ prefixed variable.`,
            fix: {
              before: `// ${file.split("/").pop()} — accessed from client component\nexport const stripeKey = process.env.STRIPE_SECRET_KEY; // leaked to browser`,
              after: `// Move to an API route or server action:\n// src/app/api/create-payment/route.ts\nconst stripeKey = process.env.STRIPE_SECRET_KEY; // server-only, never exported\n// Client only receives the result, never the key`,
              language: "typescript",
            },
          });
          break;
        }
      }
    }

    // ── Pattern 4: Error swallowed in utility, propagated silently to callers ──
    const EMPTY_CATCH = /catch\s*\([^)]*\)\s*\{\s*\}/;
    for (const [file, content] of Object.entries(keyFileContents)) {
      if (!EMPTY_CATCH.test(content)) continue;
      // Find files that import this file — they'll inherit silent failures
      const callers = Object.entries(importGraph)
        .filter(([, specs]) => specs.some((s) => resolveImport(file, s) === file ||
          Object.keys(keyFileContents).some((k) => k === file && specs.some((sp) => {
            const r = resolveImport(file, sp);
            return r && Object.keys(keyFileContents).includes(r);
          }))))
        .map(([f]) => f)
        .slice(0, 3);

      if (callers.length > 0) {
        crossFileFindings.push({
          severity: "medium",
          category: "quality",
          file,
          description: `Silent failure propagation: \`${file.split("/").slice(-2).join("/")}\` has empty catch blocks that swallow errors silently. Files that import it (${callers.map((c) => c.split("/").pop()).join(", ")}) will receive undefined/null returns with no indication that an error occurred, making debugging and monitoring impossible.`,
          suggestion: `Replace empty catch blocks with explicit error handling. At minimum:\ncatch (err) { console.error("[${file.split("/").pop()}]", err); throw err; }\nOr return a typed Result: return { ok: false, error: err instanceof Error ? err.message : String(err) };`,
          fix: {
            before: `async function fetchData() {\n  try { return await db.query(); }\n  catch (err) {} // callers get 'undefined', no idea why\n}`,
            after: `async function fetchData() {\n  try { return await db.query(); }\n  catch (err) {\n    console.error("[fetchData] DB error:", err);\n    throw new Error(\`Database fetch failed: \${err instanceof Error ? err.message : String(err)}\`);\n  }\n}`,
            language: "typescript",
          },
        });
      }
    }

    // ── Pattern 5: Shared mutable state exported and mutated from multiple files ─
    const MUTABLE_EXPORT = /^export\s+(?:let\s+\w+|const\s+\w+\s*=\s*\{|\s*\{)/m;
    const MUTATION_PATTERN = /\.(push|pop|splice|delete|set|clear)\s*\(|=\s*(?!>)/;
    for (const [file, content] of Object.entries(keyFileContents)) {
      if (!MUTABLE_EXPORT.test(content)) continue;
      const importers = Object.entries(importGraph)
        .filter(([importer, specs]) =>
          importer !== file &&
          specs.some((s) => resolveImport(importer, s) === file) &&
          MUTATION_PATTERN.test(keyFileContents[importer] ?? "")
        )
        .map(([f]) => f);

      if (importers.length >= 2) {
        crossFileFindings.push({
          severity: "medium",
          category: "quality",
          file,
          description: `Shared mutable state: \`${file.split("/").slice(-2).join("/")}\` exports mutable data that is imported and mutated by ${importers.length} files (${importers.slice(0, 3).map((f) => f.split("/").pop()).join(", ")}). In Node.js, module-level objects are singletons — mutations from one request bleed into others, causing race conditions and subtle data corruption bugs.`,
          suggestion: `Replace mutable module-level state with factory functions or request-scoped state:\n// Instead of: export const cache = {};\n// Use: export function createCache() { return {}; }\nOr use a proper store (Redis, DB) for shared state in a multi-instance deployment.`,
        });
      }
    }
  }

  // ── Structure-based checks ─────────────────────────────────────────────────
  const structuralIssues: RepoScanFinding[] = [];
  const securityPositives: string[] = [];

  if (!hasEnvExample) {
    structuralIssues.push({
      severity: "medium", category: "security", file: "root",
      description: "No .env.example file — without a template, developers may share actual .env files leaking credentials.",
      suggestion: "Create .env.example listing all required variable names (no values). Commit it to document configuration.",
    });
  } else securityPositives.push("Environment template (.env.example) documents all required variables");

  if (!hasCI) {
    structuralIssues.push({
      severity: "medium", category: "config",
      description: "No CI/CD pipeline found. PRs can merge without automated tests, linting, or security checks.",
      suggestion: "Add GitHub Actions (.github/workflows/ci.yml) with test, lint, and npm audit steps. Gate all PRs on it.",
    });
  } else securityPositives.push("CI/CD pipeline configured — every PR runs automated checks");

  if (!hasLinting) {
    structuralIssues.push({
      severity: "low", category: "quality",
      description: "No linter found (checked ESLint v8/v9, Biome, XO, and devDependencies).",
      suggestion: "Add ESLint with @typescript-eslint/recommended + eslint-plugin-security. Consider Biome for all-in-one linting/formatting.",
    });
  } else securityPositives.push("Linting enforced — code style consistency automated");

  if (hasHelmet) securityPositives.push("Helmet.js configured — HTTP security headers enforced");
  if (hasRateLimit) securityPositives.push("Rate limiting in use — brute-force and abuse protection active");
  if (hasCsrfProtection) securityPositives.push("CSRF protection middleware present");
  if (hasAuth) securityPositives.push("Established auth library in use (reduces custom auth attack surface)");
  if (hasTypeScript) securityPositives.push("TypeScript reduces whole classes of runtime bugs at compile time");
  if (hasPrisma || hasDrizzle) securityPositives.push("Type-safe ORM in use — SQL injection prevented by default");
  if (hasMonitoring) securityPositives.push("Observability/monitoring configured — errors and anomalies are tracked");
  if (hasFormatting) securityPositives.push("Code formatting configured — consistent style enforced");

  // ── Dependency risk analysis ───────────────────────────────────────────────
  const riskyDeps = Object.keys(RISKY_DEP_REASONS).filter((d) => d in deps);

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
  if (!hasCI) archConcerns.push("No CI/CD — releases are manual and unvalidated by automation");
  if (!hasAnyORM && hasExpressOrFastify) archConcerns.push("No ORM detected on an API server — SQL injection risk if raw queries are used");
  if (!hasMonitoring && fileTree.length > 50) archConcerns.push("No observability (Sentry/Pino/Winston) — production errors may be silent");
  if (!hasRateLimit && (hasExpressOrFastify || hasNextJs) && hasAuth) archConcerns.push("No rate limiting detected on an authenticated API — brute-force risk");
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

  // Check for CHANGELOG
  const hasChangelog = fileTree.some((f) => /changelog\.md$/i.test(f));
  if (!hasChangelog && fileTree.length > 30) {
    qualityFindings.push({
      severity: "low", category: "quality",
      description: "No CHANGELOG.md found — release history is undocumented.",
      suggestion: "Add a CHANGELOG.md and update it with every release using conventional commit conventions.",
    });
  }

  // ── Score calculation ──────────────────────────────────────────────────────
  const crossFileSecFindings = crossFileFindings.filter((f) => f.category === "security");
  const crossFileQualityFindings = crossFileFindings.filter((f) => f.category !== "security");
  const allSecIssues = [...codeSecurityFindings, ...crossFileSecFindings, ...structuralIssues];

  let securityScore = 84;
  securityScore -= allSecIssues.filter((i) => i.severity === "critical").length * 22;
  securityScore -= allSecIssues.filter((i) => i.severity === "high").length * 14;
  securityScore -= allSecIssues.filter((i) => i.severity === "medium").length * 6;
  securityScore -= allSecIssues.filter((i) => i.severity === "low").length * 2;
  securityScore += Math.min(10, securityPositives.length * 2);
  securityScore = Math.max(5, Math.min(98, securityScore));

  const performanceScore = Math.max(15, Math.min(97,
    85
    - performanceFindings.filter((f) => f.severity === "high").length * 12
    - performanceFindings.filter((f) => f.severity === "medium").length * 6
    - performanceFindings.filter((f) => f.severity === "low").length * 2
  ));

  const qualityScore = Math.max(15, Math.min(97,
    68 +
    (hasTypeScript ? 8 : 0) +
    (hasLinting ? 6 : 0) +
    (hasFormatting ? 3 : 0) +
    (hasTests || hasTestDir ? 8 : -15) +
    (qualityFindings.filter((f) => f.severity === "medium").length * -5) +
    (qualityFindings.filter((f) => f.severity === "low").length * -2)
  ));

  const testFileCount = fileTree.filter((f) => /\.(test|spec)\./.test(f)).length;
  const testabilityScore = Math.max(5, Math.min(97,
    (hasTests || hasTestDir ? 45 : 5) +
    (hasCI ? 18 : 0) +
    (hasAnyTestFramework ? 5 : 0) +
    (hasTestingLibrary ? 5 : 0) +
    (hasAnyE2E ? 8 : 0) +
    (testFileCount > 5 ? 8 : 0) +
    (testFileCount > 20 ? 8 : 0)
  ));

  const depScore = Math.max(15, Math.min(97,
    88
    - (riskyDeps.length * 8)
    - (depCount > 150 ? 15 : depCount > 100 ? 8 : depCount > 60 ? 3 : 0)
  ));

  const healthScore = Math.round(
    securityScore * 0.28 +
    qualityScore * 0.22 +
    testabilityScore * 0.22 +
    depScore * 0.18 +
    performanceScore * 0.10
  );

  const grade = (s: number): "A" | "B" | "C" | "D" | "F" =>
    s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : s >= 40 ? "D" : "F";

  // ── Recommendations ────────────────────────────────────────────────────────
  const recommendations: RepoScanResult["recommendations"] = [];
  const critHigh = allSecIssues.filter((i) => i.severity === "critical" || i.severity === "high");

  if (critHigh.length > 0) {
    recommendations.push({
      priority: "immediate",
      title: `Fix ${critHigh.length} critical/high security issue${critHigh.length > 1 ? "s" : ""}`,
      description: critHigh.slice(0, 2).map((i) => `${i.file ? `[${i.file.split("/").slice(-1)[0]}] ` : ""}${i.description.split(".")[0]}`).join(" | "),
      effort: "medium",
    });
  }

  if (!hasCI) {
    recommendations.push({
      priority: "immediate",
      title: "Set up CI/CD pipeline",
      description: "Add GitHub Actions (.github/workflows/ci.yml) with automated testing, linting, and npm audit. Require all checks to pass before merging.",
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
      description: riskyDeps.slice(0, 3).map((d) => `${d}: ${RISKY_DEP_REASONS[d]}`).join("; ") + (riskyDeps.length > 3 ? ` (+${riskyDeps.length - 3} more)` : "") + ". Run npm audit for CVEs.",
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
  const techDebtScore = Math.max(15, Math.min(90,
    80
    - (!hasTests && !hasTestDir ? 20 : 0)
    - (!hasCI ? 15 : 0)
    - (riskyDeps.length * 5)
    - (qualityFindings.filter((f) => f.severity === "medium").length * 4)
    - (qualityFindings.filter((f) => f.severity === "low").length * 1)
  ));

  const techDebtLevel: RepoScanResult["techDebt"]["level"] =
    techDebtScore < 35 ? "severe" :
    techDebtScore < 50 ? "significant" :
    techDebtScore < 70 ? "manageable" : "minimal";

  const techDebtHotspots = [
    ...(!hasTests ? ["Test coverage — no test files detected"] : []),
    ...(!hasCI ? ["CI/CD pipeline — not configured"] : []),
    ...(riskyDeps.length > 0 ? [`Outdated/risky dependencies: ${riskyDeps.slice(0, 4).join(", ")}`] : []),
    ...Array.from(qRuleFiles.get("todo-fixme") ?? []).slice(0, 2).map((f) => `Unfinished work in ${f.split("/").slice(-1)[0]}`),
    ...Array.from(qRuleFiles.get("any-type") ?? []).slice(0, 1).map((f) => `Type safety gaps in ${f.split("/").slice(-1)[0]}`),
    ...Array.from(qRuleFiles.get("empty-catch") ?? []).slice(0, 1).map((f) => `Silent error swallowing in ${f.split("/").slice(-1)[0]}`),
    ...performanceFindings.filter((f) => f.severity === "high").slice(0, 2).map((f) => `Performance: ${f.description.split("—")[0].trim()}`),
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
  const criticalHighCount = allSecIssues.filter((i) => i.severity === "critical" || i.severity === "high").length;

  return {
    healthScore,
    summary: `${repo} scored ${healthScore}/100 — ${
      healthScore >= 85 ? "healthy codebase, minor improvements available" :
      healthScore >= 70 ? "generally healthy with some areas to improve" :
      healthScore >= 55 ? "moderate health — several meaningful improvements needed" :
      healthScore >= 40 ? "needs attention: significant risks and debt present" :
      "critical state: security issues and heavy technical debt"
    }. ${criticalHighCount > 0
      ? `${criticalHighCount} critical/high security issue${criticalHighCount > 1 ? "s" : ""} found across ${scannedFiles} scanned files.`
      : `No critical security issues in ${scannedFiles} scanned files.`
    } ${!hasTests && !hasTestDir ? "No test infrastructure — regression risk is high." : `Test infrastructure present${hasAnyE2E ? " (including E2E)" : ""}.`} ${estimatedLoc} of code across ${fileTree.length} files (${scannedFiles} read).`,

    architecture: {
      summary: `${patterns.filter((p) => !["TypeScript", "Docker", "Serverless/Edge"].includes(p)).slice(0, 4).join(" + ") || primaryLanguage} project with ${fileTree.length} tracked files.${hasMigrations ? " Database migrations tracked." : ""}${hasDocker ? " Containerized." : ""}${hasMonorepo || hasWorkspaces ? " Monorepo structure." : ""}`,
      patterns: patterns.length > 0 ? patterns : ["Standard project structure"],
      strengths: archStrengths.length > 0 ? archStrengths : ["Project is organized consistently"],
      concerns: archConcerns.length > 0 ? archConcerns : ["No major architectural concerns identified in scanned files"],
    },

    security: {
      score: securityScore,
      grade: grade(securityScore),
      issues: allSecIssues.slice(0, 14),
      positives: securityPositives.length > 0 ? securityPositives : ["No obvious hardcoded secrets found in scanned files"],
    },

    codeQuality: {
      score: qualityScore,
      grade: grade(qualityScore),
      issues: [...crossFileQualityFindings, ...qualityFindings, ...performanceFindings].slice(0, 14),
      strengths: qualityStrengths.length > 0 ? qualityStrengths : ["Code is organized consistently"],
    },

    performance: {
      score: performanceScore,
      grade: grade(performanceScore),
      issues: performanceFindings.slice(0, 8),
      positives: performanceFindings.length === 0 ? ["No obvious performance anti-patterns detected in scanned files"] : [],
    },

    testability: {
      score: testabilityScore,
      grade: grade(testabilityScore),
      hasTestFramework: hasAnyTestFramework || hasTests || hasTestDir,
      coverageEstimate: hasTests
        ? testFileCount > 20 ? "~60-80% (estimated from test file density)"
        : testFileCount > 8 ? "~30-50% (estimated)"
        : "~10-25% (estimated)"
        : "None detected",
      gaps: [
        ...(!hasTests && !hasTestDir ? ["No test files (.test.ts, .spec.ts) found in the codebase"] : []),
        ...(!hasCI ? ["No CI enforcement — tests can be bypassed before merge"] : []),
        ...(!hasAnyE2E ? ["No E2E test framework (Playwright/Cypress) detected — user flows unprotected"] : []),
        ...(!hasTestingLibrary && hasReact ? ["No component testing library (@testing-library/react) detected"] : []),
      ].filter(Boolean),
    },

    dependencies: {
      score: depScore,
      totalCount: depCount,
      risks: [
        ...(riskyDeps.length > 0 ? [`Risky/deprecated packages: ${riskyDeps.join(", ")}`] : []),
        ...(depCount > 100 ? [`Large dependency tree (${depCount} packages) — increases maintenance and attack surface`] : []),
        ...(depCount > 0 ? ["Run npm audit to check for known CVEs in the full dependency tree"] : []),
      ],
      outdatedSignals: [
        ...("moment" in deps ? ["moment.js is deprecated — migrate to date-fns or dayjs"] : []),
        ...("request" in deps ? ["'request' is archived — migrate to native fetch or got"] : []),
        ...("jquery" in deps ? ["jQuery unnecessary in modern SPA — use native DOM or framework APIs"] : []),
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
    model: "gitscope-internal-v3",
    isDemo: false,
  };
}
