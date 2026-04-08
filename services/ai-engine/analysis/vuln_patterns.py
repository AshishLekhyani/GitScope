"""
Vulnerability Pattern Database
================================
A curated, constantly-updatable library of vulnerability signatures.
These are static patterns — the ML model learns NEW ones from the web crawler.

Pattern structure:
  id:          unique rule ID
  pattern:     regex (applied to added diff lines)
  severity:    critical | high | medium | low
  category:    secrets | injection | crypto | xss | auth | config | deps | ...
  description: message template ({file}, {match} interpolated)
  suggestion:  fix guidance
  cve_id:      linked CVE if applicable
  confidence:  0.0-1.0 (how sure we are — low for broad patterns)
  tags:        OWASP A-categories, CWE IDs

Covers OWASP Top 10 (2021):
  A01 Broken Access Control
  A02 Cryptographic Failures
  A03 Injection
  A04 Insecure Design
  A05 Security Misconfiguration
  A06 Vulnerable and Outdated Components  (handled by DependencyAgent)
  A07 Identification and Authentication Failures
  A08 Software and Data Integrity Failures
  A09 Security Logging and Monitoring Failures
  A10 Server-Side Request Forgery (SSRF)
"""

from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
# Main vulnerability pattern list
# ─────────────────────────────────────────────────────────────────────────────

VULN_PATTERNS: list[dict] = [

    # ── Secrets / Credentials ─────────────────────────────────────────────────
    {
        "id": "secret-aws-key",
        "pattern": r"AKIA[0-9A-Z]{16}",
        "severity": "critical", "category": "secrets",
        "description": "AWS Access Key ID in {file}. This credential exposed in VCS will be auto-harvested by bots within minutes.",
        "suggestion": "Rotate the key immediately in AWS IAM. Store in AWS Secrets Manager or environment variables. Add to .gitignore.",
        "cve_id": None, "confidence": 0.98,
        "tags": ["OWASP:A02", "CWE-312"],
    },
    {
        "id": "secret-aws-secret",
        "pattern": r"(?i)aws.{0,20}secret.{0,20}=.{0,5}['\"][A-Za-z0-9/+]{40}['\"]",
        "severity": "critical", "category": "secrets",
        "description": "AWS Secret Access Key pattern in {file}. Exposed keys enable full account compromise.",
        "suggestion": "Rotate immediately. Use IAM roles instead of static credentials. Never hardcode cloud credentials.",
        "confidence": 0.92, "tags": ["OWASP:A02", "CWE-312"],
    },
    {
        "id": "secret-generic",
        "pattern": r"(?i)(?:password|passwd|secret|api_key|apikey|auth_token|private_key|client_secret)\s*[:=]\s*['\"][^'\"]{8,}['\"]",
        "severity": "critical", "category": "secrets",
        "description": "Potential hardcoded credential in {file}: `{match}`. Secrets in source code are immediately compromised.",
        "suggestion": "Use environment variables: process.env.SECRET_NAME. For production, use a secrets manager (Vault, AWS SM, Doppler).",
        "confidence": 0.85, "tags": ["OWASP:A02", "CWE-798"],
    },
    {
        "id": "secret-github-token",
        "pattern": r"gh[pousr]_[A-Za-z0-9_]{36,255}",
        "severity": "critical", "category": "secrets",
        "description": "GitHub Personal Access Token in {file}. This provides full GitHub API access as the token owner.",
        "suggestion": "Revoke at github.com/settings/tokens immediately. Use GitHub Secrets for CI/CD and GITHUB_TOKEN for actions.",
        "confidence": 0.97, "tags": ["OWASP:A02", "CWE-312"],
    },
    {
        "id": "secret-slack-token",
        "pattern": r"xox[baprs]-[0-9]{10,12}-[0-9]{10,12}-[a-zA-Z0-9]{24,32}",
        "severity": "critical", "category": "secrets",
        "description": "Slack API token in {file}. Exposed tokens allow reading all Slack messages.",
        "suggestion": "Revoke at api.slack.com/apps immediately. Store in environment variables, never in code.",
        "confidence": 0.96, "tags": ["OWASP:A02", "CWE-312"],
    },
    {
        "id": "secret-stripe-key",
        "pattern": r"(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}",
        "severity": "critical", "category": "secrets",
        "description": "Stripe API secret key in {file}. Live keys enable unauthorized charges.",
        "suggestion": "Rotate at dashboard.stripe.com/apikeys. Use restricted keys with minimal permissions.",
        "confidence": 0.97, "tags": ["OWASP:A02", "CWE-312"],
    },
    {
        "id": "secret-jwt-hardcoded",
        "pattern": r"(?i)(?:jwt.?secret|token.?secret|signing.?key)\s*[:=]\s*['\"][^'\"]{8,}['\"]",
        "severity": "critical", "category": "secrets",
        "description": "JWT signing secret hardcoded in {file}. Anyone with source access can forge any JWT.",
        "suggestion": "Generate a random 256-bit secret: openssl rand -base64 32. Store in environment variable JWT_SECRET.",
        "confidence": 0.90, "tags": ["OWASP:A02", "CWE-321"],
    },
    {
        "id": "secret-connection-string",
        "pattern": r"(?i)(?:mongodb|postgres|mysql|redis|amqp|mssql)://[^:]+:[^@]+@[^\s\"']+",
        "severity": "critical", "category": "secrets",
        "description": "Database connection string with credentials in {file}. Full database access exposed.",
        "suggestion": "Move to environment variable: DATABASE_URL=... in .env. Add .env to .gitignore.",
        "confidence": 0.92, "tags": ["OWASP:A02", "CWE-312"],
    },

    # ── Injection ─────────────────────────────────────────────────────────────
    {
        "id": "injection-sql-template",
        "pattern": r"(?i)(?:query|execute|db\.run|knex\.raw)\s*\(\s*[`\"'].*\$\{",
        "severity": "critical", "category": "injection",
        "description": "SQL injection vulnerability in {file}: user-controlled template literal in SQL query.",
        "suggestion": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [id]). Or use an ORM (Prisma, Drizzle).",
        "confidence": 0.88, "tags": ["OWASP:A03", "CWE-89"],
    },
    {
        "id": "injection-nosql",
        "pattern": r"(?i)(?:find|findOne|where)\s*\(\s*\{\s*[^}]*\$(?:where|regex|gt|lt|ne|in)\s*:",
        "severity": "high", "category": "injection",
        "description": "MongoDB query operator in {file} — potential NoSQL injection if user-controlled.",
        "suggestion": "Validate and sanitize user input before using in MongoDB queries. Use a whitelist of allowed operators.",
        "confidence": 0.75, "tags": ["OWASP:A03", "CWE-943"],
    },
    {
        "id": "injection-command",
        "pattern": r"(?:exec|execSync|spawn|spawnSync|shell\.exec)\s*\([^)]*(?:req\.|params\.|query\.|body\.|\$\{)",
        "severity": "critical", "category": "injection",
        "description": "Command injection in {file}: user-controlled input passed to shell execution.",
        "suggestion": "Never pass user input to shell commands. If unavoidable, use execFile() with arguments array (no shell interpolation).",
        "confidence": 0.85, "tags": ["OWASP:A03", "CWE-78"],
    },
    {
        "id": "injection-xss-dangeroushtml",
        "pattern": r"dangerouslySetInnerHTML\s*=\s*\{\s*\{",
        "severity": "high", "category": "injection",
        "description": "dangerouslySetInnerHTML in {file} — XSS risk if content is not sanitized.",
        "suggestion": "Sanitize with DOMPurify: { __html: DOMPurify.sanitize(content) }. Or use a safe rendering component.",
        "confidence": 0.90, "tags": ["OWASP:A03", "CWE-79"],
    },
    {
        "id": "injection-eval",
        "pattern": r"\beval\s*\(",
        "severity": "critical", "category": "injection",
        "description": "`eval()` in {file} — executes arbitrary code, enabling code injection attacks.",
        "suggestion": "Replace eval(): for JSON use JSON.parse(), for expressions use a proper expression parser (mathjs, expr-eval).",
        "confidence": 0.92, "tags": ["OWASP:A03", "CWE-95"],
    },
    {
        "id": "injection-new-function",
        "pattern": r"new\s+Function\s*\(",
        "severity": "high", "category": "injection",
        "description": "`new Function()` in {file} — similar to eval, executes arbitrary strings as code.",
        "suggestion": "Avoid dynamic code generation. Use a safe template engine or pre-compiled functions.",
        "confidence": 0.88, "tags": ["OWASP:A03", "CWE-95"],
    },
    {
        "id": "injection-ldap",
        "pattern": r"(?i)ldap(?:search|bind|modify)\s*\([^)]*(?:req\.|params\.|query\.|body\.)",
        "severity": "high", "category": "injection",
        "description": "LDAP injection risk in {file}: user input in LDAP operation.",
        "suggestion": "Escape LDAP special characters: \\, *, (, ), NUL. Use an LDAP escaping library.",
        "confidence": 0.80, "tags": ["OWASP:A03", "CWE-90"],
    },
    {
        "id": "injection-xpath",
        "pattern": r"(?i)xpath\s*\([^)]*(?:req\.|params\.|query\.|body\.|\+)",
        "severity": "high", "category": "injection",
        "description": "XPath injection risk in {file}: user input in XPath expression.",
        "suggestion": "Use parameterized XPath queries or escape user input before including in XPath.",
        "confidence": 0.78, "tags": ["OWASP:A03", "CWE-643"],
    },
    {
        "id": "injection-ssti",
        "pattern": r"(?i)(?:render|template|compile)\s*\([^)]*(?:req\.|params\.|query\.|body\.|\$\{)",
        "severity": "high", "category": "injection",
        "description": "Potential Server-Side Template Injection (SSTI) in {file}: user data in template rendering.",
        "suggestion": "Never render user-controlled data as template code. Always pass user data as template variables, not template strings.",
        "confidence": 0.72, "tags": ["OWASP:A03", "CWE-1336"],
    },

    # ── Broken Access Control ─────────────────────────────────────────────────
    {
        "id": "auth-missing-check",
        "pattern": r"(?i)req\.user\s*=|token\s*==|session\s*\[",
        "severity": "medium", "category": "auth",
        "description": "Auth-related assignment in {file} — verify access control logic is correct.",
        "suggestion": "Use a proven auth middleware. Never trust client-provided role/user data without server-side verification.",
        "confidence": 0.65, "tags": ["OWASP:A01", "CWE-862"],
    },
    {
        "id": "auth-open-redirect",
        "pattern": r"res\.redirect\s*\(\s*req\.(?:query|body|params)",
        "severity": "high", "category": "auth",
        "description": "Open redirect in {file}: redirecting to user-controlled URL enables phishing.",
        "suggestion": "Validate redirect target against an allowlist of trusted paths/domains before redirecting.",
        "confidence": 0.88, "tags": ["OWASP:A01", "CWE-601"],
    },
    {
        "id": "auth-idor",
        "pattern": r"(?i)(?:findById|findOne|getById)\s*\(\s*req\.(?:params|query|body)",
        "severity": "high", "category": "auth",
        "description": "Potential IDOR in {file}: fetching resource by user-controlled ID without ownership check.",
        "suggestion": "Always verify: `AND userId = currentUser.id` in the query. Never trust client-provided IDs alone.",
        "confidence": 0.78, "tags": ["OWASP:A01", "CWE-639"],
    },
    {
        "id": "auth-jwt-no-verify",
        "pattern": r"jwt\.decode\s*\(",
        "severity": "high", "category": "auth",
        "description": "`jwt.decode()` in {file} does NOT verify the signature — any forged JWT will be accepted.",
        "suggestion": "Use `jwt.verify(token, secret, options)`. Always verify before trusting JWT claims.",
        "confidence": 0.95, "tags": ["OWASP:A07", "CWE-347"],
    },
    {
        "id": "auth-weak-password-hash",
        "pattern": r"(?i)(?:md5|sha1|sha256)\s*\([^)]*password",
        "severity": "high", "category": "crypto",
        "description": "Weak password hashing in {file}: MD5/SHA1/SHA256 are not password hash functions.",
        "suggestion": "Use bcrypt, argon2, or scrypt: bcrypt.hash(password, 12). These are specifically designed to be slow.",
        "confidence": 0.85, "tags": ["OWASP:A02", "CWE-916"],
    },

    # ── Cryptography Failures ─────────────────────────────────────────────────
    {
        "id": "crypto-insecure-random",
        "pattern": r"\bMath\.random\s*\(",
        "severity": "medium", "category": "crypto",
        "description": "Math.random() in {file} is not cryptographically secure — predictable for security purposes.",
        "suggestion": "Use crypto.randomUUID() for IDs, crypto.randomBytes(n) for tokens, crypto.getRandomValues() in browsers.",
        "confidence": 0.90, "tags": ["OWASP:A02", "CWE-330"],
    },
    {
        "id": "crypto-hardcoded-iv",
        "pattern": r"(?i)(?:iv|initialization_vector)\s*[:=]\s*['\"][0-9a-f]{16,32}['\"]",
        "severity": "high", "category": "crypto",
        "description": "Hardcoded initialization vector in {file}. Reusing IVs completely breaks cipher security.",
        "suggestion": "Generate a random IV for each encryption: const iv = crypto.randomBytes(16). Store IV alongside the ciphertext.",
        "confidence": 0.82, "tags": ["OWASP:A02", "CWE-329"],
    },
    {
        "id": "crypto-ecb-mode",
        "pattern": r"(?i)aes.{0,10}ecb|createCipher\s*\(\s*['\"]aes",
        "severity": "high", "category": "crypto",
        "description": "ECB cipher mode or deprecated createCipher in {file}. ECB doesn't hide data patterns.",
        "suggestion": "Use AES-256-GCM (authenticated encryption): createCipheriv('aes-256-gcm', key, iv). Never use ECB.",
        "confidence": 0.85, "tags": ["OWASP:A02", "CWE-327"],
    },
    {
        "id": "crypto-weak-tls",
        "pattern": r"(?i)ssl_v[23]|tls_v1_[01]|rejectUnauthorized\s*:\s*false",
        "severity": "critical", "category": "crypto",
        "description": "Weak TLS configuration in {file}: deprecated protocol or certificate validation disabled.",
        "suggestion": "Use TLS 1.2+ only. Never set rejectUnauthorized: false in production — it completely disables certificate validation.",
        "confidence": 0.88, "tags": ["OWASP:A02", "CWE-295"],
    },

    # ── Security Misconfiguration ─────────────────────────────────────────────
    {
        "id": "config-debug-true",
        "pattern": r"(?i)(?:debug|debugMode)\s*[:=]\s*true",
        "severity": "medium", "category": "config",
        "description": "Debug mode enabled in {file} — may expose stack traces, verbose errors, or internal state in production.",
        "suggestion": "Gate debug mode on NODE_ENV: debug: process.env.NODE_ENV !== 'production'. Never enable in production.",
        "confidence": 0.80, "tags": ["OWASP:A05", "CWE-489"],
    },
    {
        "id": "config-cors-wildcard",
        "pattern": r"(?i)(?:cors|Access-Control-Allow-Origin)\s*[:=].*['\*'\"]\s*['\"]?\*['\"]?",
        "severity": "medium", "category": "config",
        "description": "CORS wildcard (*) in {file} allows any origin to make cross-origin requests.",
        "suggestion": "Specify exact allowed origins: cors({ origin: ['https://app.yourdomain.com'] }). Use env var for flexibility.",
        "confidence": 0.80, "tags": ["OWASP:A05", "CWE-942"],
    },
    {
        "id": "config-sensitive-log",
        "pattern": r"(?i)console\.(?:log|info|debug)\s*\([^)]*(?:password|token|secret|key|auth|credential)",
        "severity": "high", "category": "config",
        "description": "Sensitive data logged to console in {file}. Log aggregators often collect this.",
        "suggestion": "Redact before logging: logger.info({ user: user.id }). Never log passwords, tokens, or secrets.",
        "confidence": 0.85, "tags": ["OWASP:A09", "CWE-532"],
    },

    # ── Path Traversal / SSRF ─────────────────────────────────────────────────
    {
        "id": "path-traversal",
        "pattern": r"(?:readFile|writeFile|createReadStream|join)\s*\([^)]*(?:req\.|params\.|query\.|body\.)",
        "severity": "high", "category": "security",
        "description": "Potential path traversal in {file}: user-controlled input in file system operation.",
        "suggestion": "Validate path: const safe = path.resolve(baseDir, userPath); if (!safe.startsWith(baseDir)) throw new Error('...').",
        "confidence": 0.78, "tags": ["OWASP:A01", "CWE-22"],
    },
    {
        "id": "ssrf",
        "pattern": r"(?:fetch|axios\.get|http\.get|https\.get|got)\s*\(\s*(?:req\.|params\.|query\.|body\.|url\b)",
        "severity": "high", "category": "security",
        "description": "SSRF risk in {file}: user-controlled URL in outbound HTTP request.",
        "suggestion": "Validate URL against allowlist of trusted domains. Block internal IPs (169.254.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x).",
        "confidence": 0.72, "tags": ["OWASP:A10", "CWE-918"],
    },

    # ── Prototype / Supply Chain ──────────────────────────────────────────────
    {
        "id": "prototype-pollution",
        "pattern": r"\.__proto__\s*=|Object\.prototype\[|constructor\.prototype\s*=",
        "severity": "high", "category": "security",
        "description": "Prototype mutation in {file}. Modifying Object.prototype enables prototype pollution attacks.",
        "suggestion": "Use Object.create(null) for pure data stores. Validate input keys: if (key === '__proto__') return.",
        "confidence": 0.88, "tags": ["OWASP:A08", "CWE-1321"],
    },
    {
        "id": "deserialization",
        "pattern": r"(?i)(?:unserialize|pickle\.loads|yaml\.load\b|eval\(JSON)",
        "severity": "high", "category": "security",
        "description": "Unsafe deserialization in {file}. Deserializing untrusted data can execute arbitrary code.",
        "suggestion": "Use safe deserializers: yaml.safeLoad() (deprecated) → yaml.load(str, { schema: SAFE_SCHEMA }). Validate schema before deserialization.",
        "confidence": 0.82, "tags": ["OWASP:A08", "CWE-502"],
    },
    {
        "id": "xxe",
        "pattern": r"(?:libxmljs|DOMParser|parseFromString|xml2js\.parse|XMLParser)",
        "severity": "medium", "category": "security",
        "description": "XML parsing in {file} — verify XXE protection is enabled.",
        "suggestion": "Disable external entity processing. For xml2js: { explicitArray: false }. For DOMParser always validate input.",
        "confidence": 0.70, "tags": ["OWASP:A05", "CWE-611"],
    },
    {
        "id": "regex-dos",
        "pattern": r"new\s+RegExp\s*\(\s*(?:req\.|params\.|query\.|body\.|\$\{)",
        "severity": "high", "category": "security",
        "description": "ReDoS risk in {file}: user-controlled RegExp. Crafted input can freeze the event loop for minutes.",
        "suggestion": "Never construct RegExp from user input. If needed, use a safe regex library with timeout support.",
        "confidence": 0.82, "tags": ["OWASP:A05", "CWE-1333"],
    },

    # ── Race Conditions ───────────────────────────────────────────────────────
    {
        "id": "toctou",
        "pattern": r"(?:existsSync|access\b|stat\b)\s*\([^)]+\)[^;]*(?:readFile|writeFile|unlink)",
        "severity": "medium", "category": "security",
        "description": "TOCTOU race condition in {file}: check-then-use file access pattern.",
        "suggestion": "Use atomic operations. Open the file directly and handle ENOENT/EACCES exceptions rather than checking first.",
        "confidence": 0.72, "tags": ["CWE-362"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # PYTHON-SPECIFIC PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "py-pickle-unsafe",
        "pattern": r"pickle\.loads?\s*\(",
        "severity": "critical", "category": "deserialization",
        "description": "pickle.load/loads in {file} deserializes arbitrary Python objects — code execution if input is untrusted.",
        "suggestion": "Never unpickle untrusted data. Use json, msgpack, or protobuf. If you must, use hmac to sign payloads.",
        "confidence": 0.92, "tags": ["CWE-502", "OWASP:A08"],
    },
    {
        "id": "py-yaml-unsafe",
        "pattern": r"yaml\.load\s*\(",
        "severity": "high", "category": "deserialization",
        "description": "yaml.load() in {file} executes arbitrary Python via !!python/object. Use yaml.safe_load().",
        "suggestion": "Replace: yaml.safe_load(data). Never use yaml.load() with untrusted input (CWE-502).",
        "confidence": 0.93, "tags": ["CWE-502", "OWASP:A08"],
    },
    {
        "id": "py-subprocess-shell",
        "pattern": r"subprocess\.\w+\s*\([^)]*shell\s*=\s*True",
        "severity": "critical", "category": "injection",
        "description": "subprocess with shell=True in {file}: enables shell injection if any argument is user-controlled.",
        "suggestion": "Use shell=False (default) and pass args as a list: subprocess.run(['cmd', arg1, arg2]). Never interpolate user input.",
        "confidence": 0.88, "tags": ["CWE-78", "OWASP:A03"],
    },
    {
        "id": "py-os-system",
        "pattern": r"os\.(?:system|popen)\s*\(",
        "severity": "high", "category": "injection",
        "description": "os.system/popen in {file} — shell injection risk if any user data is included.",
        "suggestion": "Use subprocess.run(['cmd', arg]) with shell=False. os.system/popen both invoke a shell.",
        "confidence": 0.82, "tags": ["CWE-78", "OWASP:A03"],
    },
    {
        "id": "py-eval",
        "pattern": r"\beval\s*\(",
        "severity": "critical", "category": "injection",
        "description": "eval() in {file} executes arbitrary Python code — code injection if input is user-controlled.",
        "suggestion": "Remove eval(). For math: use ast.literal_eval() or the `numexpr` library. For config: use json/yaml.",
        "confidence": 0.90, "tags": ["CWE-95", "OWASP:A03"],
    },
    {
        "id": "py-exec",
        "pattern": r"\bexec\s*\(",
        "severity": "critical", "category": "injection",
        "description": "exec() in {file} executes arbitrary Python — same risk profile as eval().",
        "suggestion": "Remove exec(). If code generation is needed, use restricted AST evaluation or a sandboxed subprocess.",
        "confidence": 0.88, "tags": ["CWE-95", "OWASP:A03"],
    },
    {
        "id": "py-assert-security",
        "pattern": r"assert\s+.{0,60}(?:auth|permission|role|admin|user|token)",
        "severity": "high", "category": "auth",
        "description": "Security check via assert() in {file}. Python assert is disabled with -O flag — authorization bypassed in optimized mode.",
        "suggestion": "Use explicit: if not condition: raise PermissionError('Access denied'). Never use assert for security checks.",
        "confidence": 0.80, "tags": ["CWE-617", "OWASP:A01"],
    },
    {
        "id": "py-jinja2-autoescape-off",
        "pattern": r"jinja2\.Environment\s*\([^)]*autoescape\s*=\s*False",
        "severity": "high", "category": "injection",
        "description": "Jinja2 autoescape=False in {file} — XSS vulnerability if user data rendered in templates.",
        "suggestion": "Use autoescape=True (default for HTML templates). Use | e filter or select_autoescape(['html', 'xml']).",
        "confidence": 0.90, "tags": ["CWE-79", "OWASP:A03"],
    },
    {
        "id": "py-sql-concat",
        "pattern": r"(?:execute|cursor\.execute)\s*\([^)]*(?:\+|%\s*[^']|\.format\s*\(|f['\"])",
        "severity": "critical", "category": "injection",
        "description": "SQL injection in {file}: string concatenation or f-string in SQL query.",
        "suggestion": "Use parameterized queries: cursor.execute('SELECT * FROM t WHERE id = %s', (user_id,)). Never interpolate user data.",
        "confidence": 0.85, "tags": ["CWE-89", "OWASP:A03"],
    },
    {
        "id": "py-tempfile-insecure",
        "pattern": r"(?:tempfile\.mktemp|open\s*\(['\"]\/tmp\/)",
        "severity": "medium", "category": "security",
        "description": "Insecure temp file in {file}: tempfile.mktemp() or /tmp/ with predictable names is vulnerable to symlink attacks.",
        "suggestion": "Use tempfile.mkstemp() or tempfile.TemporaryFile() — these create files atomically with random names.",
        "confidence": 0.80, "tags": ["CWE-377"],
    },
    {
        "id": "py-hash-md5-sha1-password",
        "pattern": r"hashlib\.(?:md5|sha1)\s*\([^)]*(?:password|passwd|pwd|secret)",
        "severity": "high", "category": "crypto",
        "description": "Weak password hash (MD5/SHA1) in {file}. These are fast hashes, not password hash functions.",
        "suggestion": "Use bcrypt, argon2-cffi, or hashlib.scrypt(): bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).",
        "confidence": 0.90, "tags": ["CWE-916", "OWASP:A02"],
    },
    {
        "id": "py-flask-debug",
        "pattern": r"app\.run\s*\([^)]*debug\s*=\s*True",
        "severity": "critical", "category": "config",
        "description": "Flask debug=True in {file}. The interactive debugger allows arbitrary code execution via the browser.",
        "suggestion": "Remove debug=True from production. Use: app.run(debug=os.environ.get('FLASK_DEBUG') == '1').",
        "confidence": 0.95, "tags": ["CWE-94", "OWASP:A05"],
    },
    {
        "id": "py-django-secret-key",
        "pattern": r"SECRET_KEY\s*=\s*['\"][^$][^'\"]{10,}['\"]",
        "severity": "critical", "category": "secrets",
        "description": "Django SECRET_KEY hardcoded in {file}. Used for signing sessions, CSRF tokens, and cookies.",
        "suggestion": "Use: SECRET_KEY = os.environ['DJANGO_SECRET_KEY']. Generate with: python -c 'from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())'",
        "confidence": 0.88, "tags": ["CWE-312", "OWASP:A02"],
    },
    {
        "id": "py-django-debug-true",
        "pattern": r"DEBUG\s*=\s*True",
        "severity": "high", "category": "config",
        "description": "Django DEBUG=True in {file} exposes full stack traces, SQL queries, and settings in error pages.",
        "suggestion": "Set DEBUG = os.getenv('DEBUG', 'False') == 'True'. Never deploy with DEBUG=True.",
        "confidence": 0.85, "tags": ["CWE-215", "OWASP:A05"],
    },
    {
        "id": "py-requests-no-verify",
        "pattern": r"requests\.\w+\s*\([^)]*verify\s*=\s*False",
        "severity": "high", "category": "crypto",
        "description": "requests verify=False in {file} disables TLS certificate validation — MITM attacks possible.",
        "suggestion": "Remove verify=False. If using self-signed certs, use verify='/path/to/ca-bundle.pem' instead.",
        "confidence": 0.92, "tags": ["CWE-295", "OWASP:A02"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # GO-SPECIFIC PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "go-sql-sprintf",
        "pattern": r"fmt\.Sprintf\s*\([^)]*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)",
        "severity": "critical", "category": "injection",
        "description": "SQL injection via fmt.Sprintf in {file}: string-formatted SQL query.",
        "suggestion": "Use parameterized queries: db.Query('SELECT * FROM users WHERE id = $1', userID). Never fmt.Sprintf into SQL.",
        "confidence": 0.87, "tags": ["CWE-89", "OWASP:A03"],
    },
    {
        "id": "go-exec-user-input",
        "pattern": r"exec\.Command\s*\([^)]*(?:r\.|req\.|query\.|body\.)",
        "severity": "critical", "category": "injection",
        "description": "Command injection in {file}: user-controlled input in exec.Command().",
        "suggestion": "Validate all inputs strictly. Use exec.CommandContext with a timeout. Never pass user data as command arguments.",
        "confidence": 0.82, "tags": ["CWE-78", "OWASP:A03"],
    },
    {
        "id": "go-tls-skip-verify",
        "pattern": r"InsecureSkipVerify\s*:\s*true",
        "severity": "critical", "category": "crypto",
        "description": "TLS InsecureSkipVerify=true in {file} — certificate validation disabled, MITM attacks possible.",
        "suggestion": "Remove InsecureSkipVerify. For custom CAs: load the cert pool with x509.NewCertPool() and tls.Config{RootCAs: pool}.",
        "confidence": 0.97, "tags": ["CWE-295", "OWASP:A02"],
    },
    {
        "id": "go-rand-not-crypto",
        "pattern": r"math/rand|rand\.(?:Int|Float|Seed)\b",
        "severity": "medium", "category": "crypto",
        "description": "math/rand in {file} is not cryptographically secure — predictable for security contexts.",
        "suggestion": "Use crypto/rand for security-sensitive randomness: rand.Read(b). For UUIDs: github.com/google/uuid.",
        "confidence": 0.80, "tags": ["CWE-330", "OWASP:A02"],
    },
    {
        "id": "go-path-traversal",
        "pattern": r"filepath\.Join\s*\([^)]*(?:r\.|req\.|query\.|Param|Query)\s*\(",
        "severity": "high", "category": "security",
        "description": "Path traversal risk in {file}: user input in filepath.Join().",
        "suggestion": "Use filepath.Clean() and verify result starts with the expected base: filepath.Abs + strings.HasPrefix.",
        "confidence": 0.78, "tags": ["CWE-22", "OWASP:A01"],
    },
    {
        "id": "go-goroutine-leak",
        "pattern": r"go\s+func\s*\(",
        "severity": "low", "category": "performance",
        "description": "Goroutine launched in {file} — verify it has a shutdown path (context.Done, channel close) to prevent leaks.",
        "suggestion": "Always provide a cancellation mechanism: select { case <-ctx.Done(): return }. Use errgroup or sync.WaitGroup.",
        "confidence": 0.60, "tags": ["CWE-400"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # JAVA / SPRING-SPECIFIC PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "java-sql-concat",
        "pattern": r"(?:createQuery|createNativeQuery|executeQuery|prepareStatement)\s*\([^)]*\+",
        "severity": "critical", "category": "injection",
        "description": "SQL injection via string concatenation in {file}.",
        "suggestion": "Use PreparedStatement with ? placeholders, or Spring Data JPA with @Query('... WHERE id = :id') parameters.",
        "confidence": 0.85, "tags": ["CWE-89", "OWASP:A03"],
    },
    {
        "id": "java-log4j-jndi",
        "pattern": r"\$\{jndi:",
        "severity": "critical", "category": "injection",
        "description": "Log4Shell payload pattern in {file} (CVE-2021-44228). If logged via Log4j < 2.15, enables RCE.",
        "suggestion": "Upgrade Log4j >= 2.17.1. Set: log4j2.formatMsgNoLookups=true. Filter JNDI lookup strings from all user inputs.",
        "confidence": 0.98, "cve_id": "CVE-2021-44228", "tags": ["CWE-502", "OWASP:A08"],
    },
    {
        "id": "java-spring-actuator-open",
        "pattern": r"management\.endpoints\.web\.exposure\.include\s*=\s*\*",
        "severity": "high", "category": "config",
        "description": "Spring Boot Actuator exposes ALL endpoints in {file} — /actuator/env, /actuator/shutdown publicly accessible.",
        "suggestion": "Expose only: management.endpoints.web.exposure.include=health,info. Require auth: management.endpoint.health.show-details=when-authorized.",
        "confidence": 0.92, "tags": ["CWE-200", "OWASP:A05"],
    },
    {
        "id": "java-deserialize-readobject",
        "pattern": r"(?:ObjectInputStream|readObject)\s*\(",
        "severity": "high", "category": "deserialization",
        "description": "Java deserialization in {file} via ObjectInputStream. Gadget chains can achieve RCE with crafted payloads.",
        "suggestion": "Use JSON (Jackson with type polymorphism disabled), Protobuf, or Avro instead. If you must deserialize: use a filtering ObjectInputStream.",
        "confidence": 0.82, "tags": ["CWE-502", "OWASP:A08"],
    },
    {
        "id": "java-xxe",
        "pattern": r"DocumentBuilderFactory\.newInstance\s*\(",
        "severity": "high", "category": "security",
        "description": "XML parsing in {file} — verify XXE protection: DocumentBuilderFactory must disable external entities.",
        "suggestion": "factory.setFeature('http://apache.org/xml/features/disallow-doctype-decl', true). Always harden XML parsers.",
        "confidence": 0.75, "tags": ["CWE-611", "OWASP:A05"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # PHP-SPECIFIC PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "php-sql-concat",
        "pattern": r"(?:mysql_query|mysqli_query|pg_query)\s*\([^)]*(?:\$_GET|\$_POST|\$_REQUEST|\$_COOKIE)",
        "severity": "critical", "category": "injection",
        "description": "SQL injection in {file}: user superglobal directly in SQL query.",
        "suggestion": "Use PDO with prepared statements: $stmt = $pdo->prepare('SELECT * FROM t WHERE id = ?'); $stmt->execute([$id]);",
        "confidence": 0.90, "tags": ["CWE-89", "OWASP:A03"],
    },
    {
        "id": "php-eval",
        "pattern": r"\beval\s*\(",
        "severity": "critical", "category": "injection",
        "description": "eval() in {file} — executes arbitrary PHP. Attackers who control input achieve full code execution.",
        "suggestion": "Remove eval(). For templating use Twig/Blade. For dynamic config use JSON.",
        "confidence": 0.92, "tags": ["CWE-95", "OWASP:A03"],
    },
    {
        "id": "php-file-include",
        "pattern": r"(?:include|require)(?:_once)?\s*\(\s*\$(?:_GET|_POST|_REQUEST|_COOKIE)",
        "severity": "critical", "category": "injection",
        "description": "Remote/local file inclusion in {file}: user input controls include path.",
        "suggestion": "Never use user input for file paths. Use an allowlist: $allowed = ['home', 'about']; include($allowed[$page] ?? 'home') . '.php';",
        "confidence": 0.95, "tags": ["CWE-98", "OWASP:A01"],
    },
    {
        "id": "php-xss-echo",
        "pattern": r"echo\s+\$_(?:GET|POST|REQUEST|COOKIE)",
        "severity": "high", "category": "injection",
        "description": "Reflected XSS in {file}: unescaped user input echoed directly to output.",
        "suggestion": "Always escape: echo htmlspecialchars($_GET['q'], ENT_QUOTES, 'UTF-8');",
        "confidence": 0.92, "tags": ["CWE-79", "OWASP:A03"],
    },
    {
        "id": "php-md5-password",
        "pattern": r"md5\s*\([^)]*(?:password|passwd|pwd)",
        "severity": "high", "category": "crypto",
        "description": "MD5 password hashing in {file} — completely insecure, crackable in seconds.",
        "suggestion": "Use PHP's built-in: password_hash($password, PASSWORD_ARGON2ID). Verify with password_verify().",
        "confidence": 0.93, "tags": ["CWE-916", "OWASP:A02"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # RUBY / RAILS-SPECIFIC PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "ruby-sql-where-string",
        "pattern": r"\.where\s*\(\s*['\"].*#\{",
        "severity": "critical", "category": "injection",
        "description": "SQL injection in {file}: string interpolation in ActiveRecord .where().",
        "suggestion": "Use parameterized form: .where('column = ?', user_input) or .where(column: user_input). Never interpolate.",
        "confidence": 0.90, "tags": ["CWE-89", "OWASP:A03"],
    },
    {
        "id": "ruby-eval",
        "pattern": r"\beval\s*\(",
        "severity": "critical", "category": "injection",
        "description": "eval() in {file} — executes arbitrary Ruby code.",
        "suggestion": "Remove eval(). Use Ripper for parsing, Binding#eval only with fully-trusted inputs.",
        "confidence": 0.88, "tags": ["CWE-95", "OWASP:A03"],
    },
    {
        "id": "ruby-send-user-input",
        "pattern": r"\.send\s*\(\s*params",
        "severity": "high", "category": "auth",
        "description": "Ruby Object#send with user params in {file} — can call any method including private ones.",
        "suggestion": "Use an allowlist: ALLOWED = %w[activate deactivate]; obj.send(ALLOWED.find { |m| m == params[:action] })",
        "confidence": 0.85, "tags": ["CWE-284", "OWASP:A01"],
    },
    {
        "id": "ruby-mass-assignment",
        "pattern": r"update_attributes\s*\(\s*params|create\s*\(\s*params(?!\[)",
        "severity": "high", "category": "auth",
        "description": "Rails mass assignment with unfiltered params in {file} — IDOR and privilege escalation risk.",
        "suggestion": "Always use strong parameters: params.require(:user).permit(:name, :email). Never pass params directly.",
        "confidence": 0.82, "tags": ["CWE-915", "OWASP:A01"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # C / C++ PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "c-strcpy-unsafe",
        "pattern": r"\bstrcpy\s*\(",
        "severity": "high", "category": "security",
        "description": "strcpy() in {file} has no bounds checking — buffer overflow if source > destination.",
        "suggestion": "Use strncpy(dest, src, sizeof(dest) - 1) or strlcpy(). Better: use C++ std::string or snprintf.",
        "confidence": 0.88, "tags": ["CWE-120", "CWE-787"],
    },
    {
        "id": "c-gets-unsafe",
        "pattern": r"\bgets\s*\(",
        "severity": "critical", "category": "security",
        "description": "gets() in {file} — always unsafe (removed in C11). Allows unlimited buffer overflow.",
        "suggestion": "Replace with fgets(buf, sizeof(buf), stdin). gets() has no buffer size argument and cannot be made safe.",
        "confidence": 0.97, "tags": ["CWE-120", "CWE-242"],
    },
    {
        "id": "c-sprintf-unsafe",
        "pattern": r"\bsprintf\s*\(",
        "severity": "medium", "category": "security",
        "description": "sprintf() in {file} — unbounded output can overflow the destination buffer.",
        "suggestion": "Use snprintf(buf, sizeof(buf), fmt, args) — always specify the maximum size.",
        "confidence": 0.82, "tags": ["CWE-120"],
    },
    {
        "id": "c-printf-format-string",
        "pattern": r"printf\s*\(\s*(?:argv|getenv|user_input|buf)\b",
        "severity": "critical", "category": "injection",
        "description": "Format string injection in {file}: user-controlled first argument to printf().",
        "suggestion": "Always use a format string literal: printf('%s', user_input). Never printf(user_input).",
        "confidence": 0.90, "tags": ["CWE-134"],
    },
    {
        "id": "c-malloc-no-check",
        "pattern": r"(?:malloc|calloc|realloc)\s*\([^;]+;\s*[^i]",
        "severity": "low", "category": "quality",
        "description": "malloc/calloc/realloc result unchecked in {file} — NULL dereference on allocation failure.",
        "suggestion": "Always check: ptr = malloc(n); if (!ptr) { /* handle OOM */ }. Or use a wrapper that aborts on failure.",
        "confidence": 0.65, "tags": ["CWE-476"],
    },
    {
        "id": "c-integer-overflow",
        "pattern": r"(?:malloc|calloc)\s*\(\s*(?:\w+\s*\*\s*\w+|\w+\s*\+\s*\w+)",
        "severity": "high", "category": "security",
        "description": "Integer arithmetic in allocation size in {file} — integer overflow can lead to under-allocation and heap overflow.",
        "suggestion": "Use checked arithmetic: if (n > SIZE_MAX / sizeof(T)) abort(); Or use calloc(count, sizeof(T)) which handles overflow.",
        "confidence": 0.72, "tags": ["CWE-190", "CWE-787"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # DOCKER / CONTAINER / INFRASTRUCTURE PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "docker-root-user",
        "pattern": r"USER\s+root",
        "severity": "high", "category": "config",
        "description": "Container runs as root in {file}. Container escape gives full host access.",
        "suggestion": "Add: RUN adduser --disabled-password appuser && chown -R appuser:appuser /app\nUSER appuser",
        "confidence": 0.88, "tags": ["CWE-250", "OWASP:A05"],
    },
    {
        "id": "docker-no-user",
        "pattern": r"^FROM\b(?!.*USER\s+\w)",
        "severity": "medium", "category": "config",
        "description": "Dockerfile in {file} may not set a non-root USER — container defaults to root.",
        "suggestion": "Always add USER nonroot before the final CMD/ENTRYPOINT.",
        "confidence": 0.60, "tags": ["CWE-250"],
    },
    {
        "id": "docker-secret-build-arg",
        "pattern": r"ARG\s+(?:password|secret|token|key|api)",
        "severity": "high", "category": "secrets",
        "description": "Secret passed as Docker build ARG in {file} — ARGs are stored in image layers and history.",
        "suggestion": "Use Docker secrets (--secret mount) or multi-stage builds. Never bake secrets into image layers.",
        "confidence": 0.85, "tags": ["CWE-312", "OWASP:A02"],
    },
    {
        "id": "terraform-public-s3",
        "pattern": r"acl\s*=\s*['\"]public-read",
        "severity": "high", "category": "config",
        "description": "S3 bucket public-read ACL in {file} — bucket contents publicly accessible to anyone.",
        "suggestion": "Use private ACL and CloudFront + OAI for public content distribution. Enable S3 Block Public Access at account level.",
        "confidence": 0.90, "tags": ["CWE-200", "OWASP:A05"],
    },
    {
        "id": "terraform-sg-open-world",
        "pattern": r"cidr_blocks\s*=\s*\[\"0\.0\.0\.0/0\"\]",
        "severity": "high", "category": "config",
        "description": "Security group open to 0.0.0.0/0 in {file} — port exposed to entire internet.",
        "suggestion": "Restrict to: known IP ranges, VPC CIDR, or use a load balancer. Never expose databases (3306, 5432, 6379) to 0.0.0.0/0.",
        "confidence": 0.88, "tags": ["CWE-732", "OWASP:A05"],
    },
    {
        "id": "k8s-privileged-container",
        "pattern": r"privileged\s*:\s*true",
        "severity": "critical", "category": "config",
        "description": "Kubernetes privileged container in {file} — equivalent to root on the host node.",
        "suggestion": "Remove privileged: true. Use specific capabilities: capabilities.add: [NET_BIND_SERVICE]. Apply PodSecurityPolicy or OPA.",
        "confidence": 0.92, "tags": ["CWE-250", "OWASP:A05"],
    },
    {
        "id": "k8s-host-network",
        "pattern": r"hostNetwork\s*:\s*true",
        "severity": "high", "category": "config",
        "description": "hostNetwork: true in {file} — container shares the host network namespace, bypassing network isolation.",
        "suggestion": "Remove hostNetwork: true unless absolutely required (e.g., node-level monitoring). Use proper service meshes instead.",
        "confidence": 0.88, "tags": ["CWE-284", "OWASP:A05"],
    },
    {
        "id": "k8s-latest-image",
        "pattern": r"image:\s+\w[^:]+:latest",
        "severity": "medium", "category": "deps",
        "description": "Container image tagged :latest in {file} — non-deterministic builds, may pull insecure images.",
        "suggestion": "Pin to specific digest: image: nginx@sha256:abc123... Or a specific version tag: nginx:1.25.3",
        "confidence": 0.85, "tags": ["CWE-1104", "OWASP:A06"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # API SECURITY PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "api-no-rate-limit",
        "pattern": r"(?:router\.\w+|app\.(?:get|post|put|delete|patch))\s*\([^)]*['\"]\/api\/",
        "severity": "low", "category": "config",
        "description": "API route in {file} — verify rate limiting is applied to prevent brute-force and DoS.",
        "suggestion": "Apply rate limiting: express-rate-limit, or throttle at API gateway level. Login/auth endpoints need strict limits.",
        "confidence": 0.55, "tags": ["CWE-400", "OWASP:A05"],
    },
    {
        "id": "api-mass-return",
        "pattern": r"res\.json\s*\(\s*(?:users|accounts|customers|employees|passwords)\b",
        "severity": "high", "category": "auth",
        "description": "Potential bulk data exposure in {file}: entire user/account collection may be returned.",
        "suggestion": "Paginate results. Filter sensitive fields: users.map(({ id, name }) => ({ id, name })). Never return passwords/tokens.",
        "confidence": 0.70, "tags": ["CWE-213", "OWASP:A01"],
    },
    {
        "id": "api-auth-bearer-log",
        "pattern": r"(?:console\.|log\.|logger\.)\w+\s*\([^)]*(?:authorization|bearer|token)",
        "severity": "high", "category": "config",
        "description": "Authorization token logged in {file}. Tokens in logs enable session hijacking.",
        "suggestion": "Redact: logger.info({ auth: '[REDACTED]' }). Use structured logging that masks sensitive headers automatically.",
        "confidence": 0.82, "tags": ["CWE-532", "OWASP:A09"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # NETWORK / PROTOCOL PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "net-http-not-https",
        "pattern": r"['\"]http://(?!localhost|127\.0\.0\.1|0\.0\.0\.0)",
        "severity": "medium", "category": "crypto",
        "description": "Cleartext HTTP URL in {file} — data transmitted without encryption, vulnerable to MITM.",
        "suggestion": "Use https:// for all production endpoints. Set up HSTS: Strict-Transport-Security: max-age=31536000; includeSubDomains.",
        "confidence": 0.72, "tags": ["CWE-319", "OWASP:A02"],
    },
    {
        "id": "net-bind-all-interfaces",
        "pattern": r"(?:listen|bind)\s*\(['\"]0\.0\.0\.0['\"]",
        "severity": "medium", "category": "config",
        "description": "Service binds to 0.0.0.0 in {file} — accessible on ALL network interfaces including public ones.",
        "suggestion": "Bind to 127.0.0.1 for local services. Use a reverse proxy (nginx/caddy) to expose externally with proper security.",
        "confidence": 0.72, "tags": ["CWE-605", "OWASP:A05"],
    },
    {
        "id": "net-websocket-origin",
        "pattern": r"WebSocket|ws(?:s)?://",
        "severity": "low", "category": "config",
        "description": "WebSocket in {file} — verify Origin header validation to prevent cross-site WebSocket hijacking (CSWSH).",
        "suggestion": "Validate Origin header on WebSocket upgrade: if (req.headers.origin !== ALLOWED_ORIGIN) socket.destroy().",
        "confidence": 0.55, "tags": ["CWE-346", "OWASP:A01"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # DATABASE PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "db-prisma-raw-query",
        "pattern": r"prisma\.\$queryRaw(?:Unsafe)?\s*\(`[^`]*\$\{",
        "severity": "high", "category": "injection",
        "description": "SQL injection risk in {file}: template literal in Prisma $queryRaw.",
        "suggestion": "Use $queryRaw with tagged template literal (Prisma escapes automatically), or $queryRawUnsafe only with fully-trusted inputs.",
        "confidence": 0.85, "tags": ["CWE-89", "OWASP:A03"],
    },
    {
        "id": "db-mongoose-where-string",
        "pattern": r"\.find\s*\(\s*\{[^}]*\$where",
        "severity": "critical", "category": "injection",
        "description": "MongoDB $where operator in {file} — executes JavaScript engine, enables code injection.",
        "suggestion": "Never use $where. Rewrite using comparison operators ($eq, $gt, $in). $where is deprecated in MongoDB 4.4+.",
        "confidence": 0.92, "tags": ["CWE-943", "OWASP:A03"],
    },
    {
        "id": "db-redis-no-auth",
        "pattern": r"redis\.createClient\s*\(\s*\{[^}]*port[^}]*\}",
        "severity": "medium", "category": "config",
        "description": "Redis client without explicit auth in {file} — verify requirepass is set in redis.conf.",
        "suggestion": "Use: redis.createClient({ url: 'redis://:password@host:6379' }). Always enable Redis AUTH in production.",
        "confidence": 0.65, "tags": ["CWE-306", "OWASP:A07"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # REACT / NEXT.JS SPECIFIC
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "react-next-env-client",
        "pattern": r"NEXT_PUBLIC_(?:SECRET|KEY|TOKEN|PASSWORD|PRIVATE)",
        "severity": "critical", "category": "secrets",
        "description": "Secret exposed to client in {file}: NEXT_PUBLIC_ env vars are bundled into client JavaScript.",
        "suggestion": "Remove NEXT_PUBLIC_ prefix — only expose non-secret public data. Access secrets in server-only code (API routes, Server Components).",
        "confidence": 0.92, "tags": ["CWE-312", "OWASP:A02"],
    },
    {
        "id": "react-href-javascript",
        "pattern": r"href\s*=\s*\{?['\"]javascript:",
        "severity": "high", "category": "injection",
        "description": "javascript: protocol in href in {file} — XSS if user-controlled.",
        "suggestion": "Never use href='javascript:'. Use onClick handlers instead. Validate URLs before use: only allow http/https.",
        "confidence": 0.90, "tags": ["CWE-79", "OWASP:A03"],
    },
    {
        "id": "next-api-no-method-check",
        "pattern": r"export\s+(?:default\s+)?(?:async\s+)?function\s+handler\s*\(\s*req",
        "severity": "low", "category": "config",
        "description": "Next.js API handler in {file} — verify HTTP method is checked to prevent unwanted mutations.",
        "suggestion": "Always check: if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
        "confidence": 0.55, "tags": ["CWE-436", "OWASP:A05"],
    },
    {
        "id": "next-server-action-unvalidated",
        "pattern": r"['\"]use server['\"]",
        "severity": "low", "category": "auth",
        "description": "Server Action in {file} — verify input is validated and user is authenticated before execution.",
        "suggestion": "Always validate: const session = await getServerSession(); if (!session) throw new Error('Unauthorized'). Validate all inputs with Zod.",
        "confidence": 0.55, "tags": ["CWE-862", "OWASP:A01"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # CLOUD / AWS / GCP / AZURE PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "cloud-iam-star-action",
        "pattern": r"(?:\"Action\"|'Action')\s*:\s*['\"]?\*['\"]?",
        "severity": "high", "category": "config",
        "description": "IAM policy allows ALL actions (*) in {file} — violates least-privilege principle.",
        "suggestion": "Enumerate only required actions: 's3:GetObject', 's3:PutObject'. Never use Action: '*' in production.",
        "confidence": 0.85, "tags": ["CWE-732", "OWASP:A01"],
    },
    {
        "id": "cloud-iam-star-resource",
        "pattern": r"(?:\"Resource\"|'Resource')\s*:\s*['\"]?\*['\"]?",
        "severity": "high", "category": "config",
        "description": "IAM policy targets ALL resources (*) in {file} — grants access to every resource in the account.",
        "suggestion": "Specify exact ARNs: 'arn:aws:s3:::my-bucket/*'. Never use Resource: '*' for sensitive actions.",
        "confidence": 0.82, "tags": ["CWE-732", "OWASP:A01"],
    },
    {
        "id": "cloud-gcp-service-account-key",
        "pattern": r"\"type\":\s*\"service_account\"",
        "severity": "critical", "category": "secrets",
        "description": "GCP service account key file in {file}. These long-lived credentials provide full API access.",
        "suggestion": "Use Workload Identity Federation instead of service account key files. If needed, store in Secret Manager, never in code or VCS.",
        "confidence": 0.93, "tags": ["CWE-312", "OWASP:A02"],
    },
    {
        "id": "cloud-azure-connection-string",
        "pattern": r"DefaultEndpointsProtocol=https;AccountName=",
        "severity": "critical", "category": "secrets",
        "description": "Azure Storage connection string in {file} — full storage account access exposed.",
        "suggestion": "Store in Azure Key Vault or environment variables. Use Managed Identity instead of connection strings where possible.",
        "confidence": 0.97, "tags": ["CWE-312", "OWASP:A02"],
    },

    # ══════════════════════════════════════════════════════════════════════════
    # MOBILE (REACT NATIVE / FLUTTER) PATTERNS
    # ══════════════════════════════════════════════════════════════════════════
    {
        "id": "mobile-asyncstorage-secret",
        "pattern": r"AsyncStorage\.setItem\s*\([^,]+(?:token|secret|password|key)",
        "severity": "high", "category": "secrets",
        "description": "Sensitive data in AsyncStorage in {file} — not encrypted, readable by root/jailbroken devices.",
        "suggestion": "Use react-native-keychain or expo-secure-store for secrets. AsyncStorage is plain-text SQLite.",
        "confidence": 0.85, "tags": ["CWE-312", "OWASP:A02"],
    },
    {
        "id": "mobile-http-cleartext",
        "pattern": r"android:usesCleartextTraffic\s*=\s*['\"]true['\"]",
        "severity": "high", "category": "crypto",
        "description": "Cleartext HTTP allowed in Android manifest in {file} — traffic readable by MITM attackers.",
        "suggestion": "Remove usesCleartextTraffic=true. Use HTTPS everywhere. For local dev, use a proper dev certificate.",
        "confidence": 0.90, "tags": ["CWE-319", "OWASP:A02"],
    },
    {
        "id": "mobile-deeplink-unvalidated",
        "pattern": r"Linking\.getInitialURL\s*\(\s*\)",
        "severity": "medium", "category": "auth",
        "description": "Deep link URL in {file} — validate URL scheme and parameters to prevent deep link hijacking.",
        "suggestion": "Validate scheme and host: if (!url.startsWith('myapp://auth')) return. Use universal links (https://) over custom schemes.",
        "confidence": 0.72, "tags": ["CWE-601", "OWASP:A01"],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# CVE-specific patterns for known library exploits
# These are more specific and higher confidence
# ─────────────────────────────────────────────────────────────────────────────

CVE_PATTERNS: list[dict] = [
    {
        "id": "cve-2021-23337-lodash",
        "pattern": r"(?:_.template|lodash\.template)\s*\(",
        "severity": "high", "cve_id": "CVE-2021-23337",
        "category": "injection",
        "description": "lodash.template() in {file} is vulnerable to code injection (CVE-2021-23337) in versions < 4.17.21.",
        "suggestion": "Upgrade lodash >= 4.17.21. Consider replacing template literals with a dedicated safe template engine.",
        "confidence": 0.80,
    },
    {
        "id": "cve-2022-23529-jsonwebtoken",
        "pattern": r"jwt\.verify\s*\([^,]+,\s*(?:req\.|params\.|body\.)",
        "severity": "critical", "cve_id": "CVE-2022-23529",
        "category": "auth",
        "description": "jsonwebtoken.verify() called with user-controlled secret in {file} (related to CVE-2022-23529).",
        "suggestion": "The JWT secret must be a server-side constant. Never use user-provided data as the signing secret.",
        "confidence": 0.85,
    },
]
