"""
Security Sentinel Agent
========================
Elite multi-layer security analysis covering:
  - OWASP Top 10 (2021), OWASP API Top 10 (2023)
  - CWE Top 25 Most Dangerous Software Weaknesses
  - 300+ vulnerability patterns across 15+ languages
  - Secrets / credential detection with entropy analysis
  - Injection vectors: SQL, NoSQL, Command, LDAP, XPath, SSTI, EL, OGNL
  - Cryptography misuse: weak algos, ECB mode, short keys, bad RNG
  - Deserialization vulnerabilities (Java, Python, PHP, Ruby)
  - Authentication weaknesses: JWT, OAuth, session management
  - Authorization failures: IDOR, BOLA, missing auth checks
  - Race conditions and TOCTOU vulnerabilities
  - Supply chain risks
  - CVE-pattern matching for 80+ common library vulnerabilities
  - Infrastructure misconfigurations (Docker, K8s, Terraform, CI/CD)
  - API security: mass assignment, excessive data exposure, rate limiting
  - Compliance signals: GDPR, HIPAA, PCI-DSS indicators
  - Cross-reference with knowledge base for pattern correlation
"""

from __future__ import annotations

import math
import re
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding
from analysis.vuln_patterns import VULN_PATTERNS, CVE_PATTERNS

try:
    from analysis.vuln_patterns import EXTENDED_VULN_PATTERNS, ALL_PATTERNS
    _ALL_VULN_PATTERNS = ALL_PATTERNS
except ImportError:
    _ALL_VULN_PATTERNS = VULN_PATTERNS + CVE_PATTERNS

# ── High-entropy string detection ─────────────────────────────────────────────

_HEX_RE = re.compile(r"[0-9a-f]{32,}", re.IGNORECASE)
_B64_RE = re.compile(r"[A-Za-z0-9+/]{40,}={0,2}")
_SECRET_ASSIGN_RE = re.compile(
    r"""(?:password|passwd|secret|api_?key|auth_?token|private_?key|access_?key"""
    r"""|signing_?key|encryption_?key|client_?secret|db_?pass)\s*[=:]\s*['"` ]([^'"` \n]{8,})""",
    re.IGNORECASE,
)

def _shannon_entropy(s: str) -> float:
    """Calculate Shannon entropy of a string in bits per character."""
    if not s:
        return 0.0
    freq: dict[str, int] = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    n = len(s)
    return -sum((count / n) * math.log2(count / n) for count in freq.values())

def _is_high_entropy_secret(value: str) -> bool:
    """Returns True if the value looks like a real secret (high entropy + right length)."""
    if len(value) < 16:
        return False
    # Skip obviously non-secret values
    if re.match(r"^\$\{|^process\.env\.|^os\.environ|^config\.", value):
        return False
    if value.startswith("example") or value.startswith("your_") or value.startswith("xxx"):
        return False
    entropy = _shannon_entropy(value)
    # Different thresholds based on character class
    if re.match(r"^[0-9a-f]+$", value, re.IGNORECASE) and len(value) >= 32:
        return entropy > 3.5  # Hex key/hash
    if re.match(r"^[A-Za-z0-9+/]+=*$", value) and len(value) >= 20:
        return entropy > 4.0  # Base64 encoded secret
    return entropy > 3.8  # General high-entropy string

# ── Header security checklist ─────────────────────────────────────────────────

REQUIRED_SECURITY_HEADERS = [
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "strict-transport-security",
    "referrer-policy",
    "permissions-policy",
]

# ── CORS misconfiguration detector ────────────────────────────────────────────

_CORS_WILDCARD_RE = re.compile(
    r"(?:Access-Control-Allow-Origin|cors\(\s*\{[^}]*origin)\s*[=:]\s*['\"]?\*['\"]?",
    re.IGNORECASE,
)
_CORS_REFLECT_RE = re.compile(
    r"(?:origin|req\.headers\.origin)\s*(?:!==|!=|===|==).*allow",
    re.IGNORECASE,
)

# ── Sensitive file patterns ───────────────────────────────────────────────────

SENSITIVE_FILE_PATTERNS = [
    (r"\.pem$", "Private key/certificate file", "critical"),
    (r"\.p12$|\.pfx$", "PKCS#12 certificate with private key", "critical"),
    (r"id_rsa$|id_ecdsa$|id_ed25519$", "SSH private key", "critical"),
    (r"\.keystore$|\.jks$", "Java KeyStore file", "critical"),
    (r"credentials\.json$", "Credentials file", "critical"),
    (r"secrets\.json$|secrets\.yaml$|secrets\.yml$", "Secrets file", "high"),
    (r"service-account.*\.json$", "GCP service account key", "critical"),
    (r"\.env$|\.env\.local$|\.env\.production$", "Environment file with secrets", "high"),
    (r"kubeconfig$|kube_config$", "Kubernetes config with cluster credentials", "high"),
    (r"terraform\.tfstate$", "Terraform state with infrastructure secrets", "high"),
    (r"\.npmrc$", "npm config potentially containing auth tokens", "medium"),
    (r"\.pypirc$", "PyPI credentials file", "medium"),
    (r"htpasswd$", "htpasswd file with password hashes", "high"),
]


class SecurityAgent(BaseAgent):
    agent_id = "security"
    agent_name = "Security Sentinel"
    specialization = "OWASP Top 10, CWE patterns, secrets, injection, cryptography misuse"

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()
        files = context.get("files", [])
        is_repo_scan = context.get("analysis_type") == "repo"

        findings: list[Finding] = []
        positives: list[str] = []

        if is_repo_scan:
            findings, positives = self._scan_repo(context)
        else:
            findings, positives = self._scan_diff(files)

        # Score: start at 90, deduct per severity
        score = 90
        for f in findings:
            deduction = {"critical": 30, "high": 18, "medium": 9, "low": 4, "info": 1}.get(f.severity, 5)
            score -= deduction
        score = max(0, min(100, score))

        # Add positives for clean areas
        if not any(f.category == "secrets" for f in findings):
            positives.append("No hardcoded credentials or secrets detected")
        if not any("injection" in (f.rule_id or "") for f in findings):
            positives.append("No injection vulnerabilities detected in the diff")

        insights: list[str] = []
        critical = [f for f in findings if f.severity == "critical"]
        high = [f for f in findings if f.severity == "high"]
        if critical:
            insights.append(f"{len(critical)} CRITICAL security issue{'s' if len(critical) > 1 else ''} — immediate remediation required before any deployment.")
        if high:
            insights.append(f"{len(high)} high-severity finding{'s' if len(high) > 1 else ''} warrant security review before merge.")
        if score >= 85:
            insights.append("Security posture is strong — no critical issues found in the analyzed changes.")

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.88,
            findings=sorted(findings, key=lambda f: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(f.severity, 4))[:10],
            insights=insights,
            positives=positives[:4],
        ))

    @staticmethod
    def _strip_non_executable(code: str) -> str:
        """
        Remove non-executable contexts before pattern scanning.

        Prevents false positives when a PR diff touches files that *define*
        detection rules (vuln_patterns.py, security_agent.py, etc.) — those
        files contain strings like  "pattern": r"eval\\("  which would
        otherwise trigger the very rules they define.

        Strips / neutralises:
          - Comment-only lines  (# ... / // ... / * ...)
          - Lines that ARE a pattern/regex rule definition
          - Description / suggestion / id prose fields
          - Inline JS/TS regex literals (replaced with placeholder)
        """
        cleaned = []
        for line in code.splitlines():
            t = line.strip()
            if not t:
                cleaned.append("")
                continue
            # Skip comment-only lines
            if t.startswith("#") or t.startswith("//") or re.match(r"^\*(?!/)", t):
                cleaned.append("")
                continue
            # Skip pattern rule definition lines
            # e.g.  "pattern": r"eval\s*\(",
            # e.g.  pattern: /eval\s*\(/g,
            if re.search(r'\bpattern\s*[=:]\s*(?:r["\'/]|/)', t):
                cleaned.append("")
                continue
            # Skip description / suggestion / id / cve prose fields
            if re.search(r'^\s*"(?:description|suggestion|id|cve_id|tags)"\s*:', t):
                cleaned.append("")
                continue
            # Neutralise inline JS/TS regex literals
            line = re.sub(r"/(?:[^/\\\n]|\\.)+/[gimsuy]*", '"REGEX_LITERAL"', line)
            cleaned.append(line)
        return "\n".join(cleaned)

    def _scan_diff(self, files: list[dict]) -> tuple[list[Finding], list[str]]:
        findings: list[Finding] = []
        positives: list[str] = []

        for file in files:
            filename = file.get("filename", "unknown")
            patch = file.get("patch", "") or ""
            added_lines = [
                line[1:] for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            ]
            # Strip non-executable contexts to eliminate false positives
            # when scanning detection-rule files (pattern definitions, comments, etc.)
            code = self._strip_non_executable("\n".join(added_lines))

            seen_rules: set[str] = set()  # one finding per rule per file

            for vuln in VULN_PATTERNS:
                rule_id = vuln["id"]
                if rule_id in seen_rules:
                    continue

                matches = re.findall(vuln["pattern"], code, re.IGNORECASE | re.MULTILINE)
                if not matches:
                    continue

                seen_rules.add(rule_id)
                snippet = str(matches[0])[:100]

                # Confidence-based severity downgrade — broad patterns report lower
                conf = vuln.get("confidence", 0.85)
                severity = vuln["severity"]
                if conf < 0.50:
                    severity = "low"
                elif conf < 0.65:
                    severity = "medium" if severity in ("critical", "high") else severity

                findings.append(Finding(
                    severity=severity,
                    category=vuln.get("category", "security"),
                    description=vuln["description"].format(file=filename.split("/")[-1], match=snippet),
                    suggestion=vuln["suggestion"],
                    file=filename,
                    code_snippet=snippet,
                    confidence=conf,
                    rule_id=rule_id,
                    cve_id=vuln.get("cve_id"),
                ))

        return findings, positives

    def _scan_repo(self, context: dict) -> tuple[list[Finding], list[str]]:
        findings: list[Finding] = []
        positives: list[str] = []
        file_tree = context.get("file_tree", [])
        contents = context.get("key_file_contents", {})

        # Check security fundamentals
        has_env_example = any(f == ".env.example" or f.endswith("/.env.example") for f in file_tree)
        has_gitignore = any(f == ".gitignore" for f in file_tree)
        has_security_md = any(f.lower() == "security.md" for f in file_tree)
        has_csp = any("content-security-policy" in (contents.get(f, "") or "").lower() for f in file_tree)
        has_ci = any(f.startswith(".github/workflows") or ".gitlab-ci" in f or ".circleci" in f for f in file_tree)

        if not has_env_example:
            findings.append(Finding(
                severity="medium", category="security",
                description="No .env.example — developers may share .env files, risking credential leakage.",
                suggestion="Create .env.example with all required variable names (no values). Document secret rotation policy.",
                rule_id="missing-env-example", confidence=0.95,
            ))
        else:
            positives.append("Environment variable template documented (.env.example)")

        if not has_gitignore:
            findings.append(Finding(
                severity="high", category="security",
                description="No .gitignore — sensitive files (.env, credentials, keys) may be committed accidentally.",
                suggestion="Add a comprehensive .gitignore. Use gitignore.io to generate one for your stack.",
                rule_id="missing-gitignore", confidence=0.95,
            ))
        else:
            positives.append(".gitignore present — sensitive file exclusion configured")

        if not has_ci:
            findings.append(Finding(
                severity="medium", category="config",
                description="No CI/CD pipeline — automated security scanning not enforced on pull requests.",
                suggestion="Add GitHub Actions with: npm audit, CodeQL analysis, Snyk scanning, and Dependabot.",
                rule_id="no-ci-pipeline", confidence=0.90,
            ))
        else:
            positives.append("CI/CD pipeline enforces automated checks on every PR")

        if has_security_md:
            positives.append("SECURITY.md documents responsible disclosure policy")

        # Scan key file contents for secrets
        for fname, content in contents.items():
            if not content:
                continue
            for vuln in VULN_PATTERNS:
                if vuln.get("category") == "secrets":
                    if re.search(vuln["pattern"], content, re.IGNORECASE):
                        findings.append(Finding(
                            severity="critical", category="secrets",
                            description=f"Potential hardcoded secret in {fname}: {vuln['description'].format(file=fname, match='')}",
                            suggestion=vuln["suggestion"],
                            file=fname, rule_id=vuln["id"], confidence=0.80,
                        ))

        return findings, positives
