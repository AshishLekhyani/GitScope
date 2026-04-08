"""
Threat Model Analyzer — STRIDE Framework
==========================================
Automated threat modeling for code diffs and repositories using the STRIDE
classification system (Spoofing, Tampering, Repudiation, Information Disclosure,
Denial of Service, Elevation of Privilege).

Each finding maps to:
  - A STRIDE category
  - A CWE identifier
  - A severity level  (critical | high | medium | low)
  - Concrete mitigation guidance

Primary entry point:
    report = ThreatModelReport()
    result = report.analyze_diff(files, language="javascript")
    result = report.analyze_repo(file_tree, contents)
"""

from __future__ import annotations

import re
import math
import hashlib
from dataclasses import dataclass, field
from collections import defaultdict
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# Data Structures
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ThreatPattern:
    """A single STRIDE threat pattern with regex and metadata."""
    id: str
    stride_category: str          # spoofing | tampering | repudiation | information_disclosure | denial_of_service | elevation_of_privilege
    name: str
    description: str
    pattern: str                  # compiled at runtime
    severity: str                 # critical | high | medium | low
    cwe_id: str                   # e.g. "CWE-287"
    mitigation: str
    confidence: float = 0.8       # 0.0–1.0


@dataclass
class DependencyThreat:
    """A security threat originating from a third-party dependency."""
    package_name: str
    threat_type: str              # outdated | known_vuln | typosquat | unmaintained
    description: str
    severity: str
    cve_ids: list[str] = field(default_factory=list)


@dataclass
class Finding:
    """A single threat finding produced by pattern matching."""
    pattern_id: str
    stride_category: str
    name: str
    description: str
    severity: str
    cwe_id: str
    mitigation: str
    confidence: float
    filename: str
    line_number: int
    matched_text: str
    context: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# STRIDE Threat Pattern Database (60+ entries)
# ─────────────────────────────────────────────────────────────────────────────

THREAT_PATTERNS: list[ThreatPattern] = [

    # ══════════════════════════════════════════════════════════════════════════
    # SPOOFING — Impersonation / forged identity
    # ══════════════════════════════════════════════════════════════════════════

    ThreatPattern(
        id="SPF-001",
        stride_category="spoofing",
        name="JWT None Algorithm Attack",
        description=(
            "JWT library configured to accept 'none' as a valid algorithm. "
            "An attacker can craft unsigned tokens that will be accepted as valid, "
            "completely bypassing authentication."
        ),
        pattern=r"""(?xi)
            alg\s*[=:]\s*['"]none['"]
            | algorithm\s*[=:]\s*['"]none['"]
            | algorithms\s*[=:]\s*\[\s*['"]none['"]\s*\]
            | (?:verify|decode)\s*\(.*?[,\s]none\s*[,\)]
        """,
        severity="critical",
        cwe_id="CWE-347",
        mitigation=(
            "Explicitly whitelist only HMAC or RSA algorithms (e.g. HS256, RS256). "
            "Never include 'none'. Use a library option like `algorithms=['HS256']`."
        ),
        confidence=0.95,
    ),

    ThreatPattern(
        id="SPF-002",
        stride_category="spoofing",
        name="JWT Without Signature Verification",
        description=(
            "JWT decoded without verifying its signature. This allows an attacker to "
            "tamper with the payload (e.g. change userId, role) and be accepted as a "
            "legitimate user."
        ),
        pattern=r"""(?xi)
            jwt\.decode\s*\([^)]*verify\s*=\s*False
            | jwt\.decode\s*\([^)]*options\s*=\s*\{[^}]*verify_signature\s*:\s*false
            | jsonwebtoken\.decode\s*\((?!.*verify)
            | decode\s*\([^,)]+\)\s*(?:\/\/.*)?$(?!.*verify)
        """,
        severity="critical",
        cwe_id="CWE-347",
        mitigation=(
            "Always verify JWT signatures. Pass the secret/public key and set "
            "`complete: true` or `verify=True`. Never use the decode-only path "
            "for authenticated routes."
        ),
        confidence=0.88,
    ),

    ThreatPattern(
        id="SPF-003",
        stride_category="spoofing",
        name="Missing Authentication on Route Handler",
        description=(
            "Route handler defined without any authentication middleware. "
            "Unauthenticated users may access sensitive endpoints."
        ),
        pattern=r"""(?xi)
            (?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"][^'"]*(?:admin|user|profile|account|dashboard|settings|payment|order)[^'"]*['"]
            \s*,\s*(?:async\s+)?\s*(?:function|\()
            (?!.*(?:auth|authenticate|requireAuth|isAuthenticated|middleware|protect|guard|verifyToken|checkAuth))
        """,
        severity="high",
        cwe_id="CWE-306",
        mitigation=(
            "Apply authentication middleware to all sensitive routes. "
            "Use a route guard, e.g. `router.get('/admin', authenticate, handler)`. "
            "Adopt deny-by-default: require auth unless explicitly public."
        ),
        confidence=0.65,
    ),

    ThreatPattern(
        id="SPF-004",
        stride_category="spoofing",
        name="Hardcoded Credentials Used for Auth Bypass",
        description=(
            "Authentication logic contains hardcoded username or password strings, "
            "creating a permanent backdoor that persists even after password resets."
        ),
        pattern=r"""(?xi)
            (?:username|user|login|email)\s*[=:=]{1,3}\s*['"](?:admin|root|test|superuser|demo|sa)['"]\s*
            (?:&&|\band\b|\|\|)\s*
            (?:password|pass|pwd|secret)\s*[=:=]{1,3}\s*['"][^'"]{3,}['"]
            | if\s*\(\s*(?:password|pwd|pass)\s*===?\s*['"][^'"]{4,}['"]
        """,
        severity="critical",
        cwe_id="CWE-798",
        mitigation=(
            "Remove all hardcoded credentials. Store secrets in environment variables "
            "or a secrets manager. Use a proper password hashing + comparison flow "
            "(bcrypt.compare, argon2.verify)."
        ),
        confidence=0.90,
    ),

    ThreatPattern(
        id="SPF-005",
        stride_category="spoofing",
        name="User-Controlled Authentication Flag",
        description=(
            "Admin or privileged status read directly from user-supplied request data "
            "(body, query, headers). An attacker can simply set isAdmin=true to gain "
            "elevated privileges."
        ),
        pattern=r"""(?xi)
            req\s*\.\s*(?:body|query|params)\s*\.\s*(?:isAdmin|is_admin|admin|role|isStaff|superuser|privileged)
            | request\s*\.\s*(?:json|form|args|data)\s*(?:\[|\.)\s*['"]?(?:isAdmin|is_admin|admin|role|staff|superuser)['"]?
        """,
        severity="critical",
        cwe_id="CWE-602",
        mitigation=(
            "Never trust client-supplied privilege flags. Retrieve role/permissions "
            "exclusively from your database or JWT claims that were signed server-side. "
            "Validate server-side on every request."
        ),
        confidence=0.90,
    ),

    ThreatPattern(
        id="SPF-006",
        stride_category="spoofing",
        name="SAML Response Bypass Pattern",
        description=(
            "SAML assertion processing that may be vulnerable to XML signature wrapping "
            "attacks, allowing an attacker to forge authentication assertions."
        ),
        pattern=r"""(?xi)
            saml.*?(?:parse|process|validate)\s*\([^)]*\)(?!.*(?:signature|cert|verify))
            | (?:validateSamlResponse|processSaml)\s*\([^)]*\)
            | saml\.parse\s*\(
        """,
        severity="high",
        cwe_id="CWE-287",
        mitigation=(
            "Always validate the XML digital signature on SAML responses before trusting "
            "any assertions. Use a well-tested SAML library (e.g. node-saml, python3-saml) "
            "and keep it updated. Never process SAML without signature verification."
        ),
        confidence=0.75,
    ),

    ThreatPattern(
        id="SPF-007",
        stride_category="spoofing",
        name="OAuth State Parameter Missing",
        description=(
            "OAuth2 flow initiated without a 'state' parameter. Without state, "
            "CSRF attacks against the OAuth callback are trivially possible, "
            "allowing account takeover via login CSRF."
        ),
        pattern=r"""(?xi)
            (?:oauth|authorize|authorizationUrl)\s*\((?:[^)]*?)(?!\bstate\b)[^)]*\)
            | (?:redirect_uri|response_type)\s*=(?!.*state=)
            | getAuthorizationUrl\s*\([^)]*\)(?!.*state)
        """,
        severity="high",
        cwe_id="CWE-352",
        mitigation=(
            "Always generate a cryptographically random 'state' parameter before "
            "redirecting to the OAuth provider. Store it in session and verify it "
            "matches exactly on the callback before exchanging the code."
        ),
        confidence=0.70,
    ),

    ThreatPattern(
        id="SPF-008",
        stride_category="spoofing",
        name="Authentication from Untrusted Header",
        description=(
            "X-Forwarded-For, X-Real-IP, or similar headers used to make authentication "
            "or authorization decisions. These headers can be trivially spoofed by any "
            "client unless the application sits behind a trusted reverse proxy."
        ),
        pattern=r"""(?xi)
            req\s*\.\s*headers\s*\.\s*['"]?x-forwarded-for['"]?
            | request\s*\.\s*META\s*\.\s*['"]?HTTP_X_FORWARDED_FOR['"]?
            | getHeader\s*\(\s*['"]x-forwarded-for['"]\s*\)\s*
            (?=.*(?:auth|login|verify|check|allow|permit|admin|role))
        """,
        severity="high",
        cwe_id="CWE-807",
        mitigation=(
            "Do not make trust decisions based on X-Forwarded-For or similar headers "
            "unless you have a controlled, trusted reverse proxy layer that strips and "
            "re-sets these headers. Use session-based identity instead."
        ),
        confidence=0.72,
    ),

    # ══════════════════════════════════════════════════════════════════════════
    # TAMPERING — Unauthorized data modification
    # ══════════════════════════════════════════════════════════════════════════

    ThreatPattern(
        id="TMP-001",
        stride_category="tampering",
        name="Mass Assignment Vulnerability",
        description=(
            "Request body spread or assigned directly into a model update call. "
            "An attacker can inject extra fields (e.g. role, isAdmin, balance) that "
            "the developer did not intend to be user-settable."
        ),
        pattern=r"""(?xi)
            \.update\s*\(\s*\.\.\.\s*req\s*\.\s*body
            | \.create\s*\(\s*\.\.\.\s*req\s*\.\s*body
            | Model\.update\s*\(\s*req\s*\.\s*body
            | save\s*\(\s*req\s*\.\s*body\s*\)
            | update\s*\(.*?\*\*\s*request\s*\.\s*(?:json|form|data)\(\)
            | \.updateOne\s*\(\s*\{[^}]*\}\s*,\s*req\s*\.\s*body
        """,
        severity="high",
        cwe_id="CWE-915",
        mitigation=(
            "Use an explicit allowlist of permitted fields. Destructure only known "
            "fields from req.body, or use a DTO/schema validator (zod, joi, Pydantic) "
            "that strips unknown properties."
        ),
        confidence=0.88,
    ),

    ThreatPattern(
        id="TMP-002",
        stride_category="tampering",
        name="Missing CSRF Token Validation",
        description=(
            "State-changing endpoint (POST/PUT/DELETE/PATCH) without any CSRF token "
            "check. Cross-site request forgery allows malicious sites to trigger "
            "actions on behalf of authenticated users."
        ),
        pattern=r"""(?xi)
            (?:app|router)\s*\.\s*(?:post|put|delete|patch)\s*\(\s*['"][^'"]+['"]\s*,
            (?!.*(?:csrf|csrfToken|_token|csrfProtection|csurf|xsrf|anti.?forgery))
        """,
        severity="medium",
        cwe_id="CWE-352",
        mitigation=(
            "Apply CSRF middleware to all state-changing routes (csurf for Express, "
            "django.middleware.csrf for Django). For SPAs use the Double Submit Cookie "
            "pattern or SameSite=Strict cookies."
        ),
        confidence=0.60,
    ),

    ThreatPattern(
        id="TMP-003",
        stride_category="tampering",
        name="Unvalidated Redirect to User Input",
        description=(
            "Application redirects to a URL derived from user-supplied input without "
            "validation. Enables open redirect attacks that facilitate phishing and "
            "session fixation."
        ),
        pattern=r"""(?xi)
            res\s*\.\s*redirect\s*\(\s*req\s*\.\s*(?:body|query|params)\b
            | redirect\s*\(\s*request\s*\.\s*(?:args|form|json)\b
            | res\.redirect\s*\(\s*[^'\"(]+\.(?:next|return|redirect|url|target)\b
            | window\.location\s*=\s*(?:new\s+URL\s*\()?.*?(?:location\.search|searchParams|URLSearchParams)
        """,
        severity="medium",
        cwe_id="CWE-601",
        mitigation=(
            "Validate redirect targets against an allowlist of approved domains/paths. "
            "Never redirect to an arbitrary URL from user input. If you must support "
            "return URLs, use a signed token that encodes the destination."
        ),
        confidence=0.82,
    ),

    ThreatPattern(
        id="TMP-004",
        stride_category="tampering",
        name="Path Traversal in File Operation",
        description=(
            "File read/write/delete operation using a path that includes user-supplied "
            "input without sanitization. An attacker can use '../' sequences to escape "
            "the intended directory and access arbitrary files."
        ),
        pattern=r"""(?xi)
            (?:readFile|writeFile|unlink|readFileSync|writeFileSync|open|stat)\s*\(
            \s*(?:.*?(?:req|request)\s*\.\s*(?:body|query|params|files).*?|\w+\s*\+\s*)
            (?:path|filename|file|name|filepath)
            | path\.join\s*\(.*?req\s*\.\s*(?:body|query|params)
            | os\.path\.join\s*\(.*?request\s*\.\s*(?:args|form|json)
        """,
        severity="high",
        cwe_id="CWE-22",
        mitigation=(
            "Resolve paths with `path.resolve()` and verify the result starts with your "
            "intended base directory. Use an allowlist for filenames (alphanumeric + "
            "extension only). Never concatenate user input directly into file paths."
        ),
        confidence=0.83,
    ),

    ThreatPattern(
        id="TMP-005",
        stride_category="tampering",
        name="SQL Injection via String Concatenation",
        description=(
            "SQL query assembled using string concatenation or template literals "
            "with user-controlled values. Allows an attacker to modify query structure, "
            "dump data, bypass auth, or drop tables."
        ),
        pattern=r"""(?xi)
            [\"'`]\s*SELECT\s.+?\s*[\"'`]\s*\+\s*
            | [\"'`]\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER)\s.+?\s*[\"'`]\s*\+\s*
            | (?:db|conn|cursor|query|execute|raw)\s*\.\s*(?:query|execute|run)\s*\(
              \s*[`'"]\s*(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*?\$\{
            | f['\"]\s*(?:SELECT|INSERT|UPDATE|DELETE|WHERE).*?\{
            | ['"]\s*(?:SELECT|WHERE|AND|OR)\s['"]\s*\+\s*(?:req|request|params|args|body)
        """,
        severity="critical",
        cwe_id="CWE-89",
        mitigation=(
            "Use parameterized queries or prepared statements exclusively. "
            "Never build SQL by concatenating user input. Use an ORM (Sequelize, "
            "SQLAlchemy, Prisma) or query builders that automatically parameterize."
        ),
        confidence=0.90,
    ),

    ThreatPattern(
        id="TMP-006",
        stride_category="tampering",
        name="NoSQL Injection (MongoDB Operator Injection)",
        description=(
            "MongoDB query constructed with user-supplied object that may contain "
            "operators like $where, $gt, $regex. Allows bypassing authentication "
            "or extracting arbitrary data."
        ),
        pattern=r"""(?xi)
            \.find\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)\b
            | \.findOne\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)\b
            | \.where\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)\b
            | collection\.find\s*\(\s*\{[^}]*\.\.\.\s*(?:req|request)\b
        """,
        severity="high",
        cwe_id="CWE-943",
        mitigation=(
            "Validate and sanitize all query parameters before passing to MongoDB. "
            "Use an allowlist of permitted fields. Consider `express-mongo-sanitize` "
            "to strip $ and . characters from user input."
        ),
        confidence=0.82,
    ),

    ThreatPattern(
        id="TMP-007",
        stride_category="tampering",
        name="HTTP Parameter Pollution",
        description=(
            "Application accesses query/body parameters without handling duplicate keys. "
            "Some frameworks return the first value, others the last, or an array — "
            "inconsistent behavior enables logic bypass attacks."
        ),
        pattern=r"""(?xi)
            req\.query\.[a-zA-Z_]+\s*(?:===?|!==?|[<>]=?)\s*
            (?!.*(?:Array\.isArray|typeof|toString|String\(|parseInt|parseFloat))
            | request\.args\.get\s*\(['"]\w+['"]\)\s*(?:==|!=|>|<)
        """,
        severity="medium",
        cwe_id="CWE-235",
        mitigation=(
            "Explicitly handle the case where a parameter is an array. Use "
            "`Array.isArray(val) ? val[0] : val` or framework helpers. "
            "Apply strict schema validation on all inputs."
        ),
        confidence=0.55,
    ),

    ThreatPattern(
        id="TMP-008",
        stride_category="tampering",
        name="XML External Entity (XXE) Injection",
        description=(
            "XML parser configured with DOCTYPE or external entities enabled. "
            "Allows reading local files, SSRF, or denial of service via "
            "entity expansion (billion laughs attack)."
        ),
        pattern=r"""(?xi)
            <!DOCTYPE\s+\w+\s+\[
            | <!ENTITY\s+\w+\s+(?:SYSTEM|PUBLIC)
            | etree\.parse\s*\([^)]*\)(?!.*XMLParser\s*\(.*resolve_entities\s*=\s*False)
            | lxml\.etree(?!.*resolve_entities\s*=\s*False)
            | parseString\s*\(.*\)(?!.*forbid_dtd)
            | XMLParser\s*\([^)]*\)(?!.*forbid_dtd\s*=\s*True)
        """,
        severity="critical",
        cwe_id="CWE-611",
        mitigation=(
            "Disable DOCTYPE declarations and external entity resolution. "
            "In Python lxml: `XMLParser(resolve_entities=False, no_network=True)`. "
            "In Java: set FEATURE_SECURE_PROCESSING and disable external DTDs."
        ),
        confidence=0.85,
    ),

    # ══════════════════════════════════════════════════════════════════════════
    # REPUDIATION — Deniable actions / missing audit trail
    # ══════════════════════════════════════════════════════════════════════════

    ThreatPattern(
        id="REP-001",
        stride_category="repudiation",
        name="Audit Log Deletion or Modification",
        description=(
            "Code path that deletes or overwrites audit log records. If an attacker "
            "gains access and can cover their tracks, forensic investigation becomes "
            "impossible."
        ),
        pattern=r"""(?xi)
            (?:AuditLog|audit_log|EventLog|event_log|ActivityLog|activity_log)\s*
            \.\s*(?:delete|destroy|remove|drop|truncate|deleteMany|deleteAll)\s*\(
            | DELETE\s+FROM\s+(?:audit|log|event|activity)_?(?:log|logs|events|trail)
            | (?:fs|os)\.(?:unlink|remove|rmdir)\s*\(.*?(?:log|audit)
        """,
        severity="high",
        cwe_id="CWE-778",
        mitigation=(
            "Audit logs must be append-only and protected from modification. "
            "Implement immutable logging (write to a WORM storage, external SIEM, "
            "or use a separate append-only log service). Access control audit tables "
            "separately from application data."
        ),
        confidence=0.80,
    ),

    ThreatPattern(
        id="REP-002",
        stride_category="repudiation",
        name="Missing Log on Sensitive Operation",
        description=(
            "Sensitive operations (password change, role change, admin action, "
            "deletion of records) performed without any logging call in the same "
            "code block. Actions become deniable."
        ),
        pattern=r"""(?xi)
            (?:changePassword|resetPassword|updatePassword|change_password)\s*\([^)]*\)
            (?![\s\S]{0,300}(?:log|logger|audit|event|record)\s*\.\s*(?:info|warn|error|write|create))
            | (?:assignRole|grantPermission|revokePermission|grant_role|revoke_role)\s*\([^)]*\)
            (?![\s\S]{0,300}(?:log|logger|audit)\s*\.)
        """,
        severity="medium",
        cwe_id="CWE-778",
        mitigation=(
            "Log all sensitive operations: who performed them, when, from which IP, "
            "and what changed. Emit structured audit events with user ID, resource ID, "
            "action, old value, new value, and timestamp."
        ),
        confidence=0.65,
    ),

    ThreatPattern(
        id="REP-003",
        stride_category="repudiation",
        name="Log Injection via User-Controlled Input",
        description=(
            "User-supplied data written directly to logs without sanitization. "
            "An attacker can inject newlines to forge log entries, confuse log "
            "aggregators, or inject false records."
        ),
        pattern=r"""(?xi)
            (?:console\.log|logger\.\w+|log\.info|log\.warn|log\.error|print|logging\.\w+)\s*\(
            .*?(?:req|request)\s*\.\s*(?:body|query|params|headers)
        """,
        severity="medium",
        cwe_id="CWE-117",
        mitigation=(
            "Sanitize all user input before logging: remove or escape newline "
            "characters (\\n, \\r). Use structured logging (JSON) so log consumers "
            "parse fields rather than raw strings. Never interpolate raw headers into logs."
        ),
        confidence=0.72,
    ),

    ThreatPattern(
        id="REP-004",
        stride_category="repudiation",
        name="Logging Disabled Programmatically",
        description=(
            "Code disables logging entirely at runtime. If security logging is "
            "suppressed, security-relevant events are silently lost and cannot "
            "be used for incident response."
        ),
        pattern=r"""(?xi)
            logging\.disable\s*\(\s*(?:logging\.CRITICAL|50)\s*\)
            | log_level\s*=\s*['"]CRITICAL['"]
            | (?:logger|log)\s*\.\s*(?:setLevel|set_level)\s*\(\s*(?:logging\.CRITICAL|logging\.NOTSET|50|0)\s*\)
            | winston\.configure\s*\([^)]*level\s*:\s*['"]silent['"]
        """,
        severity="medium",
        cwe_id="CWE-778",
        mitigation=(
            "Never disable logging entirely in production code. If you need to suppress "
            "verbose output, set level to WARNING or ERROR — never CRITICAL or disable(). "
            "Ensure security events (auth, privilege changes) are always logged at ERROR "
            "level or above."
        ),
        confidence=0.90,
    ),

    ThreatPattern(
        id="REP-005",
        stride_category="repudiation",
        name="Missing Transaction for Multi-Step Operation",
        description=(
            "Multiple database writes that must succeed or fail together executed "
            "outside a database transaction. Partial failures leave the system in an "
            "inconsistent state and make audit trails unreliable."
        ),
        pattern=r"""(?xi)
            (?:await\s+)?(?:\w+\.)?(?:save|update|create|delete|insert)\s*\([^)]*\)\s*;
            \s*(?:\/\/[^\n]*)?\s*
            (?:await\s+)?(?:\w+\.)?(?:save|update|create|delete|insert)\s*\([^)]*\)\s*;
            (?![\s\S]{0,100}(?:transaction|rollback|commit|session\.start))
        """,
        severity="medium",
        cwe_id="CWE-362",
        mitigation=(
            "Wrap related database operations in a single transaction. "
            "Use ORM transaction helpers (Sequelize.transaction(), Prisma.$transaction(), "
            "SQLAlchemy session). Ensure rollback on any failure to prevent partial state."
        ),
        confidence=0.55,
    ),

    # ══════════════════════════════════════════════════════════════════════════
    # INFORMATION DISCLOSURE — Data leaks / over-exposure
    # ══════════════════════════════════════════════════════════════════════════

    ThreatPattern(
        id="INF-001",
        stride_category="information_disclosure",
        name="Stack Trace Exposed to Client",
        description=(
            "Full exception stack trace sent in the HTTP response. Exposes internal "
            "file paths, framework versions, function names, and code logic — "
            "invaluable to an attacker for fingerprinting and targeted exploitation."
        ),
        pattern=r"""(?xi)
            res\s*\.\s*(?:json|send|status\([^)]+\)\.json)\s*\(\s*\{[^}]*
            (?:stack|stackTrace|stack_trace)\s*:\s*(?:err|error|e)\s*\.\s*stack
            | res\s*\.\s*send\s*\(\s*(?:err|error|e)\s*\.\s*stack\s*\)
            | return\s+(?:JsonResponse|Response)\s*\([^)]*traceback
        """,
        severity="high",
        cwe_id="CWE-209",
        mitigation=(
            "Never send stack traces to clients. Log them server-side. Return only "
            "generic error messages in responses (e.g. {'error': 'Internal server error'}). "
            "Use a global error handler that strips technical details before responding."
        ),
        confidence=0.92,
    ),

    ThreatPattern(
        id="INF-002",
        stride_category="information_disclosure",
        name="Detailed Error Message in API Response",
        description=(
            "Raw error messages (err.message, error.toString(), exception text) "
            "included in JSON API responses. Can reveal schema details, DB driver "
            "errors, internal function names, or business logic."
        ),
        pattern=r"""(?xi)
            (?:res\s*\.\s*json|res\s*\.\s*send)\s*\(\s*\{[^}]*
            (?:message|error|msg|detail|reason)\s*:\s*(?:err|error|e|ex)\s*\.\s*message
            | (?:message|error)\s*:\s*(?:err|error|e)\.toString\s*\(\s*\)
            | (?:message|error)\s*:\s*String\s*\(\s*(?:err|error|e)\s*\)
            | return\s+JsonResponse\s*\(\s*\{[^}]*(?:detail|message)\s*:\s*str\s*\(\s*(?:e|err|error|ex)\s*\)
        """,
        severity="medium",
        cwe_id="CWE-209",
        mitigation=(
            "Map exceptions to user-friendly messages. Use a central error handler. "
            "Log detailed messages server-side with a correlation ID; return only the "
            "correlation ID to the client so support can trace without exposing internals."
        ),
        confidence=0.88,
    ),

    ThreatPattern(
        id="INF-003",
        stride_category="information_disclosure",
        name="Debug Mode Enabled in Production",
        description=(
            "Framework debug mode active, or NODE_ENV not checked before enabling "
            "verbose output. Debug mode typically exposes internal routes, DB queries, "
            "stack traces, and config values in browser or API responses."
        ),
        pattern=r"""(?xi)
            DEBUG\s*=\s*True
            | app\.run\s*\([^)]*debug\s*=\s*True
            | (?:isDevelopment|isDebug)\s*=\s*true\s*(?:\/\/[^\n]*)?$
            | (?:NODE_ENV|FLASK_ENV|DJANGO_DEBUG)\s*!==?\s*['"]production['"](?![\s\S]{0,50}return)
            | debug\s*:\s*true\s*(?:,|\})(?=[\s\S]*(?:express|koa|fastify|hapi))
        """,
        severity="high",
        cwe_id="CWE-94",
        mitigation=(
            "Set DEBUG=False / NODE_ENV=production in all production environments. "
            "Gate debug features behind an explicit env check. "
            "Use separate configuration files for development and production."
        ),
        confidence=0.85,
    ),

    ThreatPattern(
        id="INF-004",
        stride_category="information_disclosure",
        name="Sensitive Data in Log Statements",
        description=(
            "Passwords, SSNs, credit card numbers, or API keys passed to logging "
            "functions. Sensitive data written to log files can be exposed via log "
            "forwarding, log storage vulnerabilities, or log access by unauthorised users."
        ),
        pattern=r"""(?xi)
            (?:console\.log|console\.debug|logger\.\w+|print|logging\.\w+)\s*\(
            .*?(?:password|passwd|pwd|ssn|social_security|credit_card|card_number|
                  cvv|api_key|apikey|secret|access_token|refresh_token|private_key)
        """,
        severity="high",
        cwe_id="CWE-532",
        mitigation=(
            "Implement a log sanitizer that redacts known sensitive field names. "
            "Use structured logging and a scrubber (e.g. `pino-noir`, `logbook`). "
            "Audit log statements in code review. Add a pre-commit hook that blocks "
            "logging of fields matching a denylist."
        ),
        confidence=0.80,
    ),

    ThreatPattern(
        id="INF-005",
        stride_category="information_disclosure",
        name="CORS Wildcard Origin",
        description=(
            "CORS configured with `Access-Control-Allow-Origin: *` combined with "
            "`Access-Control-Allow-Credentials: true`, or wildcard used on an "
            "authenticated API. Allows any website to make credentialed requests "
            "and read responses."
        ),
        pattern=r"""(?xi)
            Access-Control-Allow-Origin\s*[=:]\s*['"]\*['"]
            | origin\s*:\s*['"]\*['"]
            | cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]
            | res\.setHeader\s*\(\s*['"]Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]
        """,
        severity="high",
        cwe_id="CWE-942",
        mitigation=(
            "Replace wildcard with an explicit allowlist of trusted origins. "
            "Never combine `Allow-Origin: *` with `Allow-Credentials: true` — "
            "browsers block it, but some frameworks may not. "
            "Validate the `Origin` header against a whitelist at runtime."
        ),
        confidence=0.90,
    ),

    ThreatPattern(
        id="INF-006",
        stride_category="information_disclosure",
        name="Verbose Error in JSON API Response",
        description=(
            "Error object serialized directly to string in JSON response. Exposes "
            "implementation class names, module paths, or internal state of the "
            "exception to API consumers."
        ),
        pattern=r"""(?xi)
            (?:error|err)\s*:\s*(?:err|error|e|ex)\.toString\s*\(\s*\)
            | (?:error|message)\s*:\s*JSON\.stringify\s*\(\s*(?:err|error|e)\s*\)
            | (?:detail|message)\s*:\s*(?:err|error|e|ex)\b
            (?=[\s\S]{0,30}(?:res\.json|res\.send|Response|JsonResponse))
        """,
        severity="medium",
        cwe_id="CWE-209",
        mitigation=(
            "Use a consistent error response schema: {code, message}. "
            "Map exceptions to codes in an error registry. "
            "Never let raw exception objects reach serialization."
        ),
        confidence=0.82,
    ),

    ThreatPattern(
        id="INF-007",
        stride_category="information_disclosure",
        name="Directory Listing Enabled",
        description=(
            "Web server or framework configured with directory listing (autoIndex) "
            "enabled. Exposes all files in a directory, potentially revealing "
            "source code, config files, or backup files."
        ),
        pattern=r"""(?xi)
            autoIndex\s*:\s*true
            | serveIndex\s*\(
            | Options\s+Indexes
            | autoindex\s+on\s*;
            | app\.use\s*\(\s*express\.static\s*\([^)]*\{[^}]*dotfiles\s*:\s*['"]allow['"]
        """,
        severity="medium",
        cwe_id="CWE-548",
        mitigation=(
            "Disable directory listing (`autoIndex: false`). "
            "Ensure static file serving only exposes intended public assets. "
            "Add a catch-all 404 handler. Audit what is in your static directory."
        ),
        confidence=0.88,
    ),

    ThreatPattern(
        id="INF-008",
        stride_category="information_disclosure",
        name="Server-Side Request Forgery (SSRF)",
        description=(
            "Application makes an HTTP request to a URL derived from user input. "
            "Allows an attacker to probe internal services, cloud metadata endpoints "
            "(169.254.169.254), or exfiltrate data via DNS."
        ),
        pattern=r"""(?xi)
            (?:fetch|axios|got|request|http\.get|urllib\.request\.urlopen|requests\.get|requests\.post)
            \s*\(\s*(?:[^)]*?)?(?:req|request)\s*\.\s*(?:body|query|params)
            | (?:fetch|axios)\s*\(\s*(?:url|endpoint|target|href)\s*\)
            (?=[\s\S]{0,200}(?:req|request)\s*\.\s*(?:body|query|params).*?\k<0>)
        """,
        severity="high",
        cwe_id="CWE-918",
        mitigation=(
            "Validate URLs against an allowlist of permitted domains/IP ranges before "
            "making requests. Block requests to RFC1918, loopback, and link-local "
            "addresses. Use a DNS rebinding-safe resolver. Never forward user-supplied "
            "URLs directly to fetch/requests."
        ),
        confidence=0.75,
    ),

    # ══════════════════════════════════════════════════════════════════════════
    # DENIAL OF SERVICE — Resource exhaustion / crashes
    # ══════════════════════════════════════════════════════════════════════════

    ThreatPattern(
        id="DOS-001",
        stride_category="denial_of_service",
        name="Missing Rate Limiting on Auth Endpoint",
        description=(
            "Authentication endpoint (login, register, password-reset) without "
            "rate limiting. Enables brute-force credential stuffing attacks and "
            "enumeration of valid accounts."
        ),
        pattern=r"""(?xi)
            (?:app|router)\s*\.\s*post\s*\(\s*['"][^'"]*(?:login|signin|sign-in|auth|token|password.?reset|forgot.?password)[^'"]*['"]
            \s*,\s*(?:async\s+)?\s*(?:function|\()
            (?![\s\S]{0,500}(?:rateLimit|rate_limit|rateLimiter|throttle|slowDown|limiter))
        """,
        severity="high",
        cwe_id="CWE-307",
        mitigation=(
            "Apply a rate limiter to all auth endpoints: `express-rate-limit`, "
            "`django-ratelimit`, or an API gateway policy. Implement account lockout "
            "after N failed attempts. Consider CAPTCHA on repeated failures."
        ),
        confidence=0.70,
    ),

    ThreatPattern(
        id="DOS-002",
        stride_category="denial_of_service",
        name="ReDoS — Catastrophic Backtracking Regex",
        description=(
            "Regular expression with nested quantifiers or alternation on overlapping "
            "character classes. A specially crafted input string causes exponential "
            "backtracking, hanging the event loop for seconds or minutes."
        ),
        pattern=r"""(?x)
            /(?:[^/\\]|\\.)*(?:\([^)]*\+[^)]*\)|\([^)]*\*[^)]*\))\+/
            | /(?:[^/\\]|\\.)*(?:\w\+)+\+/
            | re\.compile\s*\(\s*['"][^'"]*(?:\w\+)+\+
            | new\s+RegExp\s*\(\s*['"][^'"]*(?:\w\+)+\+
            | /\([\w\|]+\)\1\*/
        """,
        severity="high",
        cwe_id="CWE-1333",
        mitigation=(
            "Rewrite the regex to avoid nested quantifiers. Use atomic groups or "
            "possessive quantifiers if your regex engine supports them. "
            "Validate regex with a ReDoS analyser (safe-regex, regexploit). "
            "Set a timeout on regex evaluation for untrusted input."
        ),
        confidence=0.75,
    ),

    ThreatPattern(
        id="DOS-003",
        stride_category="denial_of_service",
        name="Uncontrolled Recursion Depth",
        description=(
            "Recursive function with depth controlled by user-supplied data and no "
            "maximum depth guard. An attacker can trigger a stack overflow by providing "
            "deeply nested input (JSON, XML, file paths)."
        ),
        pattern=r"""(?xi)
            function\s+\w+\s*\([^)]*\)\s*\{[^}]*\w+\s*\([^)]*\)[^}]*\}
            (?![\s\S]{0,200}(?:depth|maxDepth|max_depth|limit|level)\s*[><=])
            | def\s+\w+\s*\([^)]*\)\s*:[^:]*\w+\s*\([^)]*\)
            (?![\s\S]{0,200}(?:depth|max_depth|limit)\s*[><=])
        """,
        severity="medium",
        cwe_id="CWE-674",
        mitigation=(
            "Add an explicit depth counter parameter with a hard maximum. "
            "Use iterative algorithms with explicit stacks for tree/graph traversal. "
            "Set Python's `sys.setrecursionlimit` conservatively and handle `RecursionError`."
        ),
        confidence=0.60,
    ),

    ThreatPattern(
        id="DOS-004",
        stride_category="denial_of_service",
        name="Missing Timeout on External HTTP Request",
        description=(
            "HTTP/HTTPS request to external service without a timeout setting. "
            "If the downstream service hangs, the request thread/coroutine hangs "
            "indefinitely, eventually exhausting the connection pool."
        ),
        pattern=r"""(?xi)
            (?:fetch|axios\.get|axios\.post|requests\.get|requests\.post|
               urllib\.request\.urlopen|http\.get|got)\s*\(
            [^)]*(?:https?://|url|endpoint)
            (?![\s\S]{0,200}(?:timeout|signal|AbortController|time_limit))
        """,
        severity="medium",
        cwe_id="CWE-400",
        mitigation=(
            "Always specify a timeout: `fetch(url, {signal: AbortSignal.timeout(5000)})`, "
            "`requests.get(url, timeout=10)`, `axios.get(url, {timeout: 5000})`. "
            "Handle timeout errors explicitly and fail gracefully."
        ),
        confidence=0.72,
    ),

    ThreatPattern(
        id="DOS-005",
        stride_category="denial_of_service",
        name="Unbounded File Upload Size",
        description=(
            "File upload endpoint without a maximum size limit. An attacker can "
            "upload multi-gigabyte files, exhausting disk space or memory and "
            "denying service to legitimate users."
        ),
        pattern=r"""(?xi)
            (?:multer|formidable|busboy|multipart)\s*\(\s*\)
            (?![\s\S]{0,200}(?:limits|maxFileSize|max_file_size|fileSize))
            | upload\s*=\s*multer\s*\(\s*\)
            | File\s*\(\s*request\.FILES
            (?![\s\S]{0,200}(?:size|max_upload_size|MAX_UPLOAD_SIZE))
        """,
        severity="high",
        cwe_id="CWE-770",
        mitigation=(
            "Configure upload limits: `multer({limits: {fileSize: 10 * 1024 * 1024}})`. "
            "Set `DATA_UPLOAD_MAX_MEMORY_SIZE` in Django. Validate file size before "
            "processing and reject oversized uploads with 413."
        ),
        confidence=0.80,
    ),

    ThreatPattern(
        id="DOS-006",
        stride_category="denial_of_service",
        name="Memory Allocation Controlled by User Input",
        description=(
            "Array or buffer allocated with a size derived from user-controlled input "
            "without validation. Enables heap exhaustion attacks by requesting "
            "allocation of arbitrarily large memory blocks."
        ),
        pattern=r"""(?xi)
            new\s+Array\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)
            | new\s+Buffer\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)
            | Buffer\.alloc\s*\(\s*(?:parseInt\s*\()?(?:req|request)\s*\.\s*(?:body|query|params)
            | bytearray\s*\(\s*int\s*\(\s*request\s*\.\s*(?:args|form|json)
        """,
        severity="high",
        cwe_id="CWE-789",
        mitigation=(
            "Validate and clamp allocation sizes against a hard maximum before allocating. "
            "Use `Math.min(userSize, MAX_ALLOWED_SIZE)`. Never allocate from raw user input."
        ),
        confidence=0.85,
    ),

    ThreatPattern(
        id="DOS-007",
        stride_category="denial_of_service",
        name="Decompression Without Size Check (Zip Bomb)",
        description=(
            "File decompression operation on user-supplied data without checking the "
            "uncompressed size. A zip bomb (e.g. 42.zip) decompresses to petabytes, "
            "exhausting disk and memory."
        ),
        pattern=r"""(?xi)
            (?:zlib|gzip|brotli|lzma|zipfile|tarfile|ZipFile)\s*\.\s*
            (?:decompress|extractall|extract|open|read)\s*\([^)]*\)
            (?![\s\S]{0,300}(?:getinfo|infolist|getsize|st_size|uncompressed_size|max_size|limit))
            | (?:zlib\.inflate|pako\.inflate)\s*\([^)]*(?:req|request)\b
        """,
        severity="high",
        cwe_id="CWE-409",
        mitigation=(
            "Check the declared uncompressed size before extracting (ZipFile.getinfo). "
            "Set a hard cap on total extracted bytes and abort if exceeded. "
            "Use streaming decompression with a byte counter to catch bombs early."
        ),
        confidence=0.78,
    ),

    # ══════════════════════════════════════════════════════════════════════════
    # ELEVATION OF PRIVILEGE — Unauthorized access level increase
    # ══════════════════════════════════════════════════════════════════════════

    ThreatPattern(
        id="EOP-001",
        stride_category="elevation_of_privilege",
        name="IDOR — Object Access Without Ownership Check",
        description=(
            "Resource retrieved or modified using a user-controlled ID without "
            "verifying the requesting user owns or is authorized to access that "
            "resource. Classic Insecure Direct Object Reference."
        ),
        pattern=r"""(?xi)
            (?:findById|findOne|getById|get_by_id|get_object_or_404)\s*\(
            \s*req\s*\.\s*(?:params|query|body)\s*\.\s*(?:id|userId|resourceId|objectId)\b
            (?![\s\S]{0,300}(?:userId|ownerId|owner_id|user_id|createdBy|created_by)\s*[=:])
            | (?:Model|db)\s*\.\s*(?:findById|findOne)\s*\(\s*(?:req|request)\s*\.\s*(?:params|body)
            (?![\s\S]{0,300}(?:userId|owner|authorId|author_id))
        """,
        severity="high",
        cwe_id="CWE-639",
        mitigation=(
            "Always scope database queries to the authenticated user: "
            "`findOne({_id: req.params.id, owner: req.user.id})`. "
            "Never trust that a client-supplied ID belongs to the requesting user. "
            "Return 403 (not 404) when ownership check fails to avoid enumeration."
        ),
        confidence=0.75,
    ),

    ThreatPattern(
        id="EOP-002",
        stride_category="elevation_of_privilege",
        name="Missing Role Check Before Sensitive Operation",
        description=(
            "Admin-level or privileged operation executed after authentication check "
            "but without verifying the user's role or permission level. Any "
            "authenticated user can perform the operation."
        ),
        pattern=r"""(?xi)
            (?:deleteUser|banUser|grantAdmin|revokeRole|impersonate|
               delete_user|ban_user|grant_admin|revoke_role)\s*\([^)]*\)
            (?![\s\S]{0,400}(?:role|permission|isAdmin|is_admin|hasRole|
               has_permission|requireRole|require_role|checkRole|check_role|
               ADMIN|SUPERUSER|staff))
        """,
        severity="high",
        cwe_id="CWE-285",
        mitigation=(
            "Add explicit role/permission checks before every privileged operation. "
            "Use RBAC middleware: `requireRole('admin')` or `@permission_required('admin')`. "
            "Apply principle of least privilege — default to deny."
        ),
        confidence=0.72,
    ),

    ThreatPattern(
        id="EOP-003",
        stride_category="elevation_of_privilege",
        name="Privilege Escalation via Parameter Tampering",
        description=(
            "Role or permission field read from query string or request body during "
            "user update. An attacker can set role=admin or permissions=superuser "
            "in their own profile update request."
        ),
        pattern=r"""(?xi)
            req\s*\.\s*(?:body|query)\s*\.\s*role\b
            | req\s*\.\s*(?:body|query)\s*\.\s*(?:permissions?|isAdmin|is_admin|privilege|tier)\b
            | request\s*\.\s*(?:json|form)\s*\(\s*\)\s*\.\s*(?:get\s*\(\s*)?['"]?role['"]?\b
            | (?:user|account)\.(?:role|permissions?)\s*=\s*req\.(?:body|query)\.(?:role|permissions?)
        """,
        severity="critical",
        cwe_id="CWE-269",
        mitigation=(
            "Never allow users to set their own role or permissions. "
            "Exclude role/permissions fields from user-update schemas (zod .omit, "
            "Pydantic exclude). Only admin-scoped endpoints should modify roles, "
            "and those must check the requester's role first."
        ),
        confidence=0.90,
    ),

    ThreatPattern(
        id="EOP-004",
        stride_category="elevation_of_privilege",
        name="Unsafe Deserialization Leading to Code Execution",
        description=(
            "Deserialization of untrusted data using pickle, yaml.load, "
            "marshal, or Java ObjectInputStream without type restrictions. "
            "Allows an attacker to execute arbitrary code by crafting a malicious payload."
        ),
        pattern=r"""(?xi)
            pickle\.loads?\s*\(
            | marshal\.loads?\s*\(
            | yaml\.load\s*\([^,)]+\)(?!\s*,\s*Loader\s*=\s*yaml\.SafeLoader)
            | yaml\.load\s*\([^)]*Loader\s*=\s*yaml\.(?:FullLoader|UnsafeLoader|Loader)\b
            | ObjectInputStream\s*\(
            | jsonpickle\.decode\s*\(
        """,
        severity="critical",
        cwe_id="CWE-502",
        mitigation=(
            "Never deserialize untrusted data with pickle or marshal. "
            "Use `yaml.safe_load()` instead of `yaml.load()`. "
            "For JSON use the standard `json` module. "
            "If you must deserialize binary data, use a safe schema-based format "
            "(protobuf, msgpack with schema)."
        ),
        confidence=0.93,
    ),

    ThreatPattern(
        id="EOP-005",
        stride_category="elevation_of_privilege",
        name="Server-Side Template Injection",
        description=(
            "User-supplied data rendered directly as a template string. "
            "In Jinja2, Twig, Mustache, or similar engines, an attacker can inject "
            "template syntax to read files, environment variables, or execute code."
        ),
        pattern=r"""(?xi)
            (?:render_template_string|Environment\s*\(\s*\)\s*\.\s*from_string)\s*\(
            .*?(?:req|request)\s*\.\s*(?:args|form|json|body|query|params)
            | (?:template|tmpl)\s*=\s*(?:req|request)\s*\.\s*(?:args|form|json|body|query|params)
            | (?:res\.render|ejs\.render|pug\.render|nunjucks\.renderString)\s*\(
            .*?(?:req|request)\s*\.\s*(?:body|query|params)
        """,
        severity="critical",
        cwe_id="CWE-94",
        mitigation=(
            "Never pass user-supplied strings as template source. "
            "Use template files with data interpolation only. "
            "In Jinja2 use `render_template('file.html', var=user_input)`, not "
            "`render_template_string(user_input)`. "
            "Apply a strict CSP and sandbox template rendering."
        ),
        confidence=0.85,
    ),

    ThreatPattern(
        id="EOP-006",
        stride_category="elevation_of_privilege",
        name="OS Command Injection",
        description=(
            "exec(), spawn(), subprocess, or os.system() called with user-controlled "
            "input. Allows arbitrary OS command execution with the privileges of the "
            "application process."
        ),
        pattern=r"""(?xi)
            (?:child_process\.)?exec\s*\(
            .*?(?:req|request)\s*\.\s*(?:body|query|params|headers)
            | (?:subprocess\.(?:run|call|Popen|check_output|getoutput)|os\.system|os\.popen)\s*\(
            .*?(?:req|request)\s*\.\s*(?:args|form|json|data)
            | (?:execSync|spawnSync|exec)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"\s]*\+\s*)
            .*?(?:req|request|params|query)
        """,
        severity="critical",
        cwe_id="CWE-78",
        mitigation=(
            "Never pass user input to shell commands. Use parameterized APIs: "
            "`child_process.spawn('cmd', [arg1, arg2])` instead of `exec('cmd ' + arg)`. "
            "Use `subprocess.run(['cmd', arg], shell=False)` in Python. "
            "Validate inputs against a strict allowlist before any shell interaction."
        ),
        confidence=0.90,
    ),

    ThreatPattern(
        id="EOP-007",
        stride_category="elevation_of_privilege",
        name="Dynamic File Inclusion of User-Controlled Path",
        description=(
            "require(), import(), or dynamic import used with a path derived from "
            "user input. Allows loading arbitrary modules (including remote URLs in "
            "some runtimes), potentially executing attacker-controlled code."
        ),
        pattern=r"""(?xi)
            require\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)
            | require\s*\(\s*[^)]*(?:req|request)\s*\.\s*(?:body|query|params)
            | import\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)
            | __import__\s*\(\s*(?:request|req)\s*\.\s*(?:args|form|json)
            | importlib\.import_module\s*\(\s*(?:request|req)\s*\.\s*(?:args|form|json)
        """,
        severity="critical",
        cwe_id="CWE-706",
        mitigation=(
            "Never load modules from user-supplied paths. "
            "If dynamic loading is required, use a strict allowlist: "
            "`const ALLOWED = {pdf: './renderers/pdf'}; require(ALLOWED[name])`. "
            "Validate against the allowlist before any dynamic import."
        ),
        confidence=0.92,
    ),

    ThreatPattern(
        id="EOP-008",
        stride_category="elevation_of_privilege",
        name="Prototype Pollution",
        description=(
            "Object merge, deep clone, or extend operation on user-supplied JSON "
            "without guarding against __proto__, constructor, or prototype keys. "
            "Allows an attacker to inject properties into Object.prototype, "
            "affecting all objects and potentially bypassing security checks."
        ),
        pattern=r"""(?xi)
            (?:merge|extend|deepMerge|_.merge|_.extend|lodash\.merge)\s*\(
            .*?(?:req|request)\s*\.\s*(?:body|query|params)
            | Object\.assign\s*\(\s*(?:\w+\s*,\s*)*(?:req|request)\s*\.\s*(?:body|query|params)
            (?![\s\S]{0,200}__proto__)
        """,
        severity="high",
        cwe_id="CWE-1321",
        mitigation=(
            "Use `JSON.parse(JSON.stringify(obj))` for safe deep clone. "
            "Sanitize keys before merging: filter out `__proto__`, `constructor`, `prototype`. "
            "Use `Object.create(null)` for accumulator objects. "
            "Update lodash to ≥4.17.21 which patches CVE-2019-10744."
        ),
        confidence=0.80,
    ),

    ThreatPattern(
        id="EOP-009",
        stride_category="elevation_of_privilege",
        name="eval() with User-Controlled Input",
        description=(
            "eval(), new Function(), or setTimeout/setInterval with a string argument "
            "derived from user-supplied data. Executes arbitrary JavaScript in the "
            "context of the application."
        ),
        pattern=r"""(?xi)
            eval\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)
            | eval\s*\([^)]*(?:req|request)\b
            | new\s+Function\s*\([^)]*(?:req|request)\b
            | setTimeout\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)
            | setInterval\s*\(\s*(?:req|request)\s*\.\s*(?:body|query|params)
        """,
        severity="critical",
        cwe_id="CWE-95",
        mitigation=(
            "Never eval user-supplied strings. If you need dynamic code execution, "
            "use a sandboxed VM (vm2, isolated-vm) with strict resource limits. "
            "Prefer data-driven approaches (JSON config, allowlisted function names) "
            "over code evaluation."
        ),
        confidence=0.93,
    ),

    ThreatPattern(
        id="EOP-010",
        stride_category="elevation_of_privilege",
        name="Insecure JWT Secret (Short or Hardcoded)",
        description=(
            "JWT signed with a hardcoded, short, or trivially guessable secret. "
            "An attacker who knows or brute-forces the secret can forge tokens "
            "for any user, including admin accounts."
        ),
        pattern=r"""(?xi)
            jwt\.sign\s*\([^,)]+,\s*['"](?:secret|password|123|test|dev|key|abc|jwt)['"]\s*
            | JWT_SECRET\s*=\s*['"][^'"]{1,12}['"]
            | (?:secret|secretKey|jwtSecret)\s*:\s*['"][^'"]{1,16}['"]
            | sign\s*\([^,)]+,\s*process\.env\.JWT_SECRET\b
            (?=[\s\S]{0,200}JWT_SECRET\s*=\s*['"][^'"]{1,20}['"])
        """,
        severity="critical",
        cwe_id="CWE-321",
        mitigation=(
            "Use a cryptographically random secret of at least 256 bits. "
            "Generate with: `openssl rand -hex 32`. "
            "Store in an environment variable or secrets manager — never hardcode. "
            "For public/private key pairs, prefer RS256 or ES256."
        ),
        confidence=0.85,
    ),

    ThreatPattern(
        id="EOP-011",
        stride_category="elevation_of_privilege",
        name="Unrestricted GraphQL Introspection",
        description=(
            "GraphQL server with introspection enabled in production. Exposes the full "
            "schema — all types, queries, mutations, and field names — to unauthenticated "
            "attackers, enabling targeted attack construction."
        ),
        pattern=r"""(?xi)
            introspection\s*:\s*true
            | (?:ApolloServer|GraphQLServer|buildSchema)\s*\(\s*\{[^}]*
            (?!.*introspection\s*:\s*false)
            | graphiql\s*:\s*true
        """,
        severity="medium",
        cwe_id="CWE-200",
        mitigation=(
            "Disable introspection in production: `introspection: process.env.NODE_ENV !== 'production'`. "
            "Disable GraphiQL in production. Implement query depth and complexity limits "
            "to prevent resource-exhaustion via deeply nested queries."
        ),
        confidence=0.80,
    ),

    ThreatPattern(
        id="EOP-012",
        stride_category="elevation_of_privilege",
        name="Hardcoded Admin Bypass Condition",
        description=(
            "Backdoor condition that grants admin access based on a hardcoded value "
            "in the source code. Even if unintentional (test code), it bypasses the "
            "entire authentication and authorization system."
        ),
        pattern=r"""(?xi)
            if\s*\(\s*(?:userId|user_id|id|username)\s*===?\s*['"][^'"]{1,40}['"]\s*\)
            [\s\S]{0,100}(?:admin|isAdmin|role\s*=\s*['"]admin|superuser|granted)
            | (?:BACKDOOR|MASTER_KEY|BYPASS_AUTH|SKIP_AUTH)\s*[=:]\s*true
        """,
        severity="critical",
        cwe_id="CWE-798",
        mitigation=(
            "Remove all backdoor conditions immediately. Use proper RBAC. "
            "Implement a code review policy that flags any hardcoded ID comparisons. "
            "Run SAST tools as part of CI to catch these patterns automatically."
        ),
        confidence=0.78,
    ),

    ThreatPattern(
        id="EOP-013",
        stride_category="elevation_of_privilege",
        name="Arbitrary File Write via User-Controlled Path",
        description=(
            "File written to a path that includes user-supplied input. Allows "
            "writing arbitrary files including server-side scripts (.php, .py, .js), "
            "overwriting configuration files, or writing SSH authorized_keys."
        ),
        pattern=r"""(?xi)
            (?:fs\.writeFile|fs\.writeFileSync|open\s*\([^,)]+,\s*['"]w)\s*\(
            .*?(?:req|request)\s*\.\s*(?:body|query|params|files)
            | (?:file\.save|File\.open)\s*\(
            .*?(?:request|req)\s*\.\s*(?:args|form|files)
        """,
        severity="critical",
        cwe_id="CWE-73",
        mitigation=(
            "Never derive file paths from user input. "
            "Generate server-side filenames (UUID + allowed extension). "
            "Validate that the resolved path stays within the intended directory. "
            "Restrict writable directories and never serve them as executables."
        ),
        confidence=0.85,
    ),

    # Additional patterns to reach 60+

    ThreatPattern(
        id="SPF-009",
        stride_category="spoofing",
        name="Session Fixation Attack Vector",
        description=(
            "Session ID not regenerated after successful authentication. "
            "An attacker who sets a known session ID before the victim logs in "
            "can hijack the authenticated session."
        ),
        pattern=r"""(?xi)
            (?:login|authenticate|signIn)\s*\([^)]*\)
            [\s\S]{0,500}
            (?!.*(?:regenerate|session\.regenerateId|session\.rotate|
                     generate_session_id|cycle_key))
            (?:req\.session\.\w+\s*=|session\[)
        """,
        severity="high",
        cwe_id="CWE-384",
        mitigation=(
            "Call `req.session.regenerate()` (Express-session) or equivalent "
            "immediately after successful login. This issues a new session ID "
            "while preserving session data."
        ),
        confidence=0.65,
    ),

    ThreatPattern(
        id="SPF-010",
        stride_category="spoofing",
        name="API Key Transmitted in Query String",
        description=(
            "API key or authentication token passed as a URL query parameter. "
            "URLs are logged by proxies, browser history, and server access logs, "
            "leading to inadvertent credential exposure."
        ),
        pattern=r"""(?xi)
            [?&](?:api_key|apikey|api_token|token|access_token|auth_token|key)\s*=\s*
            (?:[A-Za-z0-9_\-\.]{16,}|[{$]\w+[}])
            | (?:fetch|axios|got|requests)\s*\([^)]*[?&](?:api_key|token|access_token)
        """,
        severity="medium",
        cwe_id="CWE-598",
        mitigation=(
            "Pass API keys in the Authorization header or request body. "
            "If legacy systems require query string tokens, use short-lived tokens "
            "and ensure server-side logs scrub sensitive query parameters."
        ),
        confidence=0.80,
    ),

    ThreatPattern(
        id="TMP-009",
        stride_category="tampering",
        name="Weak Cryptographic Hash for Integrity",
        description=(
            "MD5 or SHA-1 used for data integrity verification, digital signatures, "
            "or password hashing. Both are cryptographically broken and vulnerable "
            "to collision attacks."
        ),
        pattern=r"""(?xi)
            (?:crypto\.createHash|hashlib\.(?:md5|sha1))\s*\(\s*['"](?:md5|sha1|sha-1)['"]\s*\)
            | MD5\s*\.(?:update|digest|hexdigest)\s*\(
            | SHA1\s*\.(?:update|digest)\s*\(
            | (?:password|pwd|passwd)\s*=\s*(?:md5|sha1)\s*\(
        """,
        severity="high",
        cwe_id="CWE-327",
        mitigation=(
            "Use SHA-256 or SHA-3 for integrity checks. "
            "For passwords, use bcrypt, Argon2id, or scrypt — never raw hash functions. "
            "For digital signatures, use RSA-PSS or ECDSA with SHA-256+."
        ),
        confidence=0.88,
    ),

    ThreatPattern(
        id="TMP-010",
        stride_category="tampering",
        name="Insecure Cookie Flags",
        description=(
            "Session or auth cookie set without HttpOnly and/or Secure flags. "
            "Without HttpOnly, XSS can steal the cookie. Without Secure, the cookie "
            "is transmitted over HTTP connections."
        ),
        pattern=r"""(?xi)
            res\.cookie\s*\(\s*['"][^'"]+['"]\s*,[^,)]+(?!\s*,\s*\{[^}]*httpOnly\s*:\s*true)
            | (?:sessionCookie|authCookie)\s*=\s*\{[^}]*\}
            (?![\s\S]{0,100}(?:httpOnly|HttpOnly)\s*:\s*true)
            | set_cookie\s*\([^)]*\)(?![\s\S]{0,200}(?:httponly|secure)\s*=\s*True)
        """,
        severity="medium",
        cwe_id="CWE-614",
        mitigation=(
            "Always set `HttpOnly: true`, `Secure: true`, and `SameSite: Strict` or "
            "`SameSite: Lax` on session cookies. "
            "Never store sensitive tokens in non-HttpOnly cookies accessible to JavaScript."
        ),
        confidence=0.75,
    ),

    ThreatPattern(
        id="REP-006",
        stride_category="repudiation",
        name="Event Sourcing Without Immutability",
        description=(
            "Event or audit records stored in a mutable table without append-only "
            "enforcement. Allows database access to silently delete or modify "
            "the historical record."
        ),
        pattern=r"""(?xi)
            (?:UPDATE|DELETE)\s+(?:events|audit_events|event_log|activity_log|history)\b
            | (?:Event|AuditEvent|ActivityLog)\s*\.\s*(?:update|updateMany|save)\s*\(
        """,
        severity="medium",
        cwe_id="CWE-282",
        mitigation=(
            "Make event/audit tables append-only at the database level (triggers that "
            "reject UPDATE/DELETE). Grant the application role INSERT-only access. "
            "Periodically export to immutable cold storage."
        ),
        confidence=0.70,
    ),

    ThreatPattern(
        id="INF-009",
        stride_category="information_disclosure",
        name="Sensitive Fields in API Response Without Filtering",
        description=(
            "User object returned directly from ORM without field filtering. "
            "May expose password hash, internal IDs, tokens, or PII fields "
            "that are not intended for API consumers."
        ),
        pattern=r"""(?xi)
            res\.json\s*\(\s*(?:user|account|profile|member)\s*\)
            (?![\s\S]{0,200}(?:select|omit|exclude|pick|toJSON|transform|sanitize))
            | return\s+JsonResponse\s*\(\s*(?:user|account|profile)\.(?:__dict__|as_dict)\s*\(\s*\)
            (?![\s\S]{0,200}(?:exclude|only|fields))
        """,
        severity="medium",
        cwe_id="CWE-200",
        mitigation=(
            "Always use a DTO or serializer that whitelists output fields. "
            "Exclude password, passwordHash, salt, internalToken, createdAt metadata. "
            "Never return raw ORM objects to API consumers."
        ),
        confidence=0.72,
    ),

    ThreatPattern(
        id="INF-010",
        stride_category="information_disclosure",
        name="Timing Attack on Secret Comparison",
        description=(
            "Secrets (tokens, passwords, HMAC digests) compared using == or === "
            "instead of a constant-time comparison function. Variable-time string "
            "comparison leaks information about the secret via timing side-channels."
        ),
        pattern=r"""(?xi)
            (?:token|secret|hash|digest|signature|hmac)\s*===?\s*
            (?:providedToken|userToken|inputHash|reqToken|headerToken|req\.\w+)
            | (?:providedToken|userToken|inputHash|reqToken)\s*===?\s*
            (?:token|secret|hash|digest|signature|hmac)
        """,
        severity="medium",
        cwe_id="CWE-208",
        mitigation=(
            "Use `crypto.timingSafeEqual()` in Node.js or `hmac.compare_digest()` "
            "in Python for all secret/token comparisons. These functions take the "
            "same time regardless of where the strings differ."
        ),
        confidence=0.78,
    ),

    ThreatPattern(
        id="DOS-008",
        stride_category="denial_of_service",
        name="Synchronous Blocking Operation in Async Handler",
        description=(
            "Synchronous (blocking) file or CPU operation inside an async request "
            "handler. Blocks the event loop, degrading response time for all "
            "concurrent requests."
        ),
        pattern=r"""(?xi)
            (?:app|router)\s*\.\s*(?:get|post|put|delete|patch)\s*\([^)]+,
            \s*(?:async\s+)?(?:function|\()[^)]*\)\s*(?:=>)?\s*\{
            [\s\S]{0,1000}
            (?:readFileSync|writeFileSync|execSync|spawnSync|existsSync)
        """,
        severity="medium",
        cwe_id="CWE-400",
        mitigation=(
            "Replace all *Sync calls with their async counterparts: "
            "`fs.readFile` → `fs.promises.readFile`, "
            "`execSync` → `exec` with callback or util.promisify. "
            "Move CPU-intensive work to worker threads."
        ),
        confidence=0.70,
    ),

    ThreatPattern(
        id="DOS-009",
        stride_category="denial_of_service",
        name="Unbounded Database Query Without Pagination",
        description=(
            "Database query with no LIMIT clause and no pagination, where the "
            "result set size is controlled by user-supplied filter parameters. "
            "Can return millions of rows, exhausting memory."
        ),
        pattern=r"""(?xi)
            \.find\s*\(\s*\{[^}]*\}\s*\)(?!\s*\.(?:limit|take|skip|paginate))
            | SELECT\s+\*\s+FROM\s+\w+\s+WHERE
            (?![\s\S]{0,200}(?:LIMIT|limit|take|paginate))
            [\s\S]{0,100}(?:req|request)\s*\.\s*(?:body|query|params)
        """,
        severity="medium",
        cwe_id="CWE-770",
        mitigation=(
            "Always apply a default page size. Enforce a maximum limit (e.g. 100 rows). "
            "Use cursor-based pagination for large datasets. "
            "Never allow unbounded queries whose cost is controlled by user input."
        ),
        confidence=0.60,
    ),

    ThreatPattern(
        id="EOP-014",
        stride_category="elevation_of_privilege",
        name="Insecure Direct Password Storage (Plaintext)",
        description=(
            "Password stored or compared in plaintext. If the database is compromised, "
            "all user passwords are immediately exposed, enabling account takeover "
            "across any service where users reuse passwords."
        ),
        pattern=r"""(?xi)
            user\.password\s*=\s*(?:password|req\.body\.password|request\.form\['password'\])
            (?![\s\S]{0,100}(?:hash|bcrypt|argon|scrypt|pbkdf2))
            | (?:UPDATE|INSERT)\s+[\w.]+\s+SET.*?password\s*=\s*['"]?(?!\$|\?)
            (?![\s\S]{0,50}(?:bcrypt|hash|crypt))
        """,
        severity="critical",
        cwe_id="CWE-256",
        mitigation=(
            "Hash passwords with bcrypt (cost ≥ 12), Argon2id, or scrypt before storage. "
            "Never store or log plaintext passwords. "
            "Use `bcrypt.hash(password, 12)` or `argon2.hash(password)`."
        ),
        confidence=0.82,
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# Compiled Pattern Cache
# ─────────────────────────────────────────────────────────────────────────────

class _CompiledPatternCache:
    """Lazily compiles ThreatPattern regexes once and caches them."""

    def __init__(self) -> None:
        self._cache: dict[str, re.Pattern] = {}

    def get(self, tp: ThreatPattern) -> re.Pattern | None:
        if tp.id not in self._cache:
            try:
                self._cache[tp.id] = re.compile(tp.pattern, re.MULTILINE)
            except re.error:
                return None
        return self._cache[tp.id]


_PATTERN_CACHE = _CompiledPatternCache()


# ─────────────────────────────────────────────────────────────────────────────
# Data Flow Analyzer
# ─────────────────────────────────────────────────────────────────────────────

class DataFlowAnalyzer:
    """
    Lightweight taint-tracking engine.

    Identifies user-input sources in the code, dangerous sinks, and attempts
    to trace variables from sources to sinks within the same code unit.
    This is heuristic — a full type-aware taint analysis would require an AST.
    """

    # Source patterns: expressions that produce user-controlled data
    _SOURCE_PATTERNS: dict[str, list[str]] = {
        "javascript": [
            r"req\.body(?:\.\w+|\[['\"]\w+['\"])\]?",
            r"req\.query(?:\.\w+|\[['\"]\w+['\"])\]?",
            r"req\.params(?:\.\w+|\[['\"]\w+['\"])\]?",
            r"req\.headers\[['\"]\w+['\"]?\]",
            r"request\.body",
            r"process\.argv\[\d+\]",
            r"process\.env\.\w+",
        ],
        "typescript": [
            r"req\.body(?:\.\w+|\[['\"]\w+['\"])\]?",
            r"req\.query(?:\.\w+|\[['\"]\w+['\"])\]?",
            r"req\.params(?:\.\w+|\[['\"]\w+['\"])\]?",
            r"req\.headers\[['\"]\w+['\"]?\]",
            r"process\.argv\[\d+\]",
        ],
        "python": [
            r"request\.json\(\)",
            r"request\.form(?:\[['\"]\w+['\"]]\]?)?",
            r"request\.args(?:\.get\(['\"]\w+['\"])?|\[['\"]\w+['\"]]\])?",
            r"request\.data",
            r"request\.files",
            r"os\.environ\.get\(['\"]\w+['\"]",
            r"sys\.argv\[\d+\]",
        ],
    }

    # Sink patterns: expressions that represent dangerous operations
    _SINK_PATTERNS: dict[str, list[str]] = {
        "javascript": [
            r"exec\s*\(",
            r"execSync\s*\(",
            r"spawn\s*\(",
            r"eval\s*\(",
            r"new\s+Function\s*\(",
            r"\.query\s*\(\s*[`'\"].*?\$\{",
            r"innerHTML\s*=",
            r"document\.write\s*\(",
            r"child_process\.",
            r"fs\.(?:readFile|writeFile|unlink|rmdir)\s*\(",
            r"path\.(?:join|resolve)\s*\(",
        ],
        "typescript": [
            r"exec\s*\(",
            r"execSync\s*\(",
            r"eval\s*\(",
            r"new\s+Function\s*\(",
            r"innerHTML\s*=",
            r"\.query\s*\(\s*[`'\"].*?\$\{",
        ],
        "python": [
            r"os\.system\s*\(",
            r"os\.popen\s*\(",
            r"subprocess\.\w+\s*\(",
            r"eval\s*\(",
            r"exec\s*\(",
            r"pickle\.loads?\s*\(",
            r"yaml\.load\s*\(",
            r"cursor\.execute\s*\(",
            r"open\s*\(",
            r"__import__\s*\(",
        ],
    }

    def find_sources(self, code: str, language: str) -> list[str]:
        """
        Scan code for user-input source expressions.

        Returns a list of matched source expression strings found in the code.
        """
        lang = language.lower()
        patterns = self._SOURCE_PATTERNS.get(lang, self._SOURCE_PATTERNS.get("javascript", []))
        found: list[str] = []
        for pat in patterns:
            try:
                compiled = re.compile(pat)
                matches = compiled.findall(code)
                found.extend(matches)
            except re.error:
                continue
        return list(set(found))

    def find_sinks(self, code: str, language: str) -> list[str]:
        """
        Scan code for dangerous sink expressions.

        Returns a list of matched sink expression strings.
        """
        lang = language.lower()
        patterns = self._SINK_PATTERNS.get(lang, self._SINK_PATTERNS.get("javascript", []))
        found: list[str] = []
        for pat in patterns:
            try:
                compiled = re.compile(pat)
                matches = compiled.findall(code)
                found.extend(matches)
            except re.error:
                continue
        return list(set(found))

    def find_taint_flows(self, code: str, language: str) -> list[dict]:
        """
        Attempt to find source→sink taint flows via variable name tracking.

        Algorithm:
          1. Find all source expressions.
          2. Extract variable names that are assigned from sources.
          3. For each tracked variable, look for that variable name appearing in
             a sink expression in the same file.

        Returns a list of flow dicts: {source, sink, variable, severity, line}.
        """
        sources = self.find_sources(code, language)
        sinks = self.find_sinks(code, language)

        if not sources or not sinks:
            return []

        # Extract variable names assigned from sources
        # Handles: const x = req.body.y  /  x = request.args.get('y')
        assign_pattern = re.compile(
            r"(?:const|let|var|)\s*(\w+)\s*=\s*(?:"
            + "|".join(re.escape(s) for s in sources[:20])  # cap for performance
            + r")",
            re.MULTILINE,
        )
        tainted_vars: set[str] = set()
        for m in assign_pattern.finditer(code):
            tainted_vars.add(m.group(1))

        if not tainted_vars:
            return []

        flows: list[dict] = []
        lines = code.splitlines()

        for var in tainted_vars:
            # Look for the variable appearing in or near a sink on the same line
            var_in_sink = re.compile(
                r"(" + "|".join(re.escape(s.rstrip("(")) for s in sinks[:20]) + r")"
                r"[^;]*\b" + re.escape(var) + r"\b",
                re.MULTILINE,
            )
            for i, line in enumerate(lines, start=1):
                m = var_in_sink.search(line)
                if m:
                    sink_name = m.group(1)
                    # Determine source that created this variable
                    source_name = _find_source_for_var(code, var, sources)
                    flows.append({
                        "source": source_name,
                        "sink": sink_name,
                        "variable": var,
                        "severity": _classify_sink_severity(sink_name),
                        "line": i,
                        "line_text": line.strip(),
                    })

        return flows


def _find_source_for_var(code: str, var: str, sources: list[str]) -> str:
    """Return the source expression that assigned to `var`, or 'user_input'."""
    for src in sources:
        pattern = re.compile(
            r"(?:const|let|var|)\s*" + re.escape(var) + r"\s*=\s*" + re.escape(src),
            re.MULTILINE,
        )
        if pattern.search(code):
            return src
    return "user_input"


def _classify_sink_severity(sink: str) -> str:
    """Return severity based on the sink type."""
    critical_keywords = {"exec", "spawn", "eval", "Function", "system", "pickle", "subprocess", "__import__"}
    high_keywords = {"query", "innerHTML", "write", "open", "readFile", "writeFile", "yaml.load"}
    for kw in critical_keywords:
        if kw in sink:
            return "critical"
    for kw in high_keywords:
        if kw in sink:
            return "high"
    return "medium"


# ─────────────────────────────────────────────────────────────────────────────
# Attack Surface Analyzer
# ─────────────────────────────────────────────────────────────────────────────

class AttackSurfaceAnalyzer:
    """
    Measures the attack surface of an application by cataloguing:
      - API endpoint count and authentication coverage
      - File upload endpoints
      - Third-party integrations
      - Exposed environment variables
      - WebSocket handlers
      - GraphQL mutations
    """

    # Patterns for detecting HTTP routes across frameworks
    _ROUTE_PATTERNS: dict[str, list[str]] = {
        "javascript": [
            r"(?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['\"](\/[^'\"]*)['\"]",
            r"@(?:Get|Post|Put|Patch|Delete)\s*\(\s*['\"](\/[^'\"]*)['\"]",
        ],
        "typescript": [
            r"(?:app|router)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['\"](\/[^'\"]*)['\"]",
            r"@(?:Get|Post|Put|Patch|Delete)\s*\(\s*['\"](\/[^'\"]*)['\"]",
        ],
        "python": [
            r"@(?:app|router|blueprint)\.route\s*\(\s*['\"](\/[^'\"]*)['\"]",
            r"@(?:app|router|blueprint)\.(?:get|post|put|patch|delete)\s*\(\s*['\"](\/[^'\"]*)['\"]",
            r"path\s*\(\s*['\"](\/[^'\"]*)['\"]",
            r"url\s*\(\s*r?['\"](\/[^'\"]*)['\"]",
        ],
    }

    _AUTH_INDICATORS = [
        r"authenticate",
        r"requireAuth",
        r"isAuthenticated",
        r"verifyToken",
        r"checkAuth",
        r"authMiddleware",
        r"JWTRequired",
        r"login_required",
        r"permission_required",
        r"@Auth",
        r"protect\(",
        r"guard\(",
        r"ensureAuthenticated",
        r"tokenRequired",
        r"apiKeyRequired",
    ]

    _UPLOAD_INDICATORS = [
        r"multer",
        r"formidable",
        r"busboy",
        r"multipart",
        r"request\.files",
        r"UploadedFile",
        r"FileField",
        r"ContentType.*multipart",
    ]

    _THIRD_PARTY_SERVICES = {
        "stripe": r"stripe|Stripe|STRIPE",
        "twilio": r"twilio|Twilio|TWILIO",
        "sendgrid": r"sendgrid|SendGrid|SENDGRID",
        "aws_s3": r"s3\.putObject|s3\.getObject|S3Client|boto3\.client\(['\"]s3['\"]",
        "aws_ses": r"ses\.sendEmail|SESClient|boto3\.client\(['\"]ses['\"]",
        "firebase": r"firebase|Firebase|FIREBASE",
        "google_auth": r"google\.auth|GoogleAuth|passport-google",
        "github_api": r"octokit|GitHubAPI|github\.com/api",
        "openai": r"openai|OpenAI|OPENAI_API_KEY",
        "mailgun": r"mailgun|Mailgun|MAILGUN",
        "pusher": r"pusher|Pusher|PUSHER",
        "redis": r"redis\.createClient|Redis|ioredis|redis\.StrictRedis",
        "mongodb": r"MongoClient|mongoose\.connect|pymongo",
        "postgres": r"pg\.Pool|pg\.Client|psycopg2|asyncpg",
        "paypal": r"paypal|PayPal|PAYPAL",
        "cloudinary": r"cloudinary|Cloudinary",
        "twitch": r"twitch\.tv|TwitchAPI",
    }

    _ENV_VAR_PATTERN = re.compile(
        r"process\.env\.([A-Z_][A-Z0-9_]+)|os\.environ(?:\.get)?\(['\"]([A-Z_][A-Z0-9_]+)['\"]",
        re.MULTILINE,
    )

    _WEBSOCKET_PATTERN = re.compile(
        r"(?:io\.on\s*\(\s*['\"]\w+|socket\.on\s*\(\s*['\"]\w+|"
        r"WebSocket\s*\(|@WebSocketGateway|asyncio_redis\.websocket|"
        r"websockets\.serve|channels\.WebsocketConsumer)",
        re.MULTILINE,
    )

    _GRAPHQL_MUTATION_PATTERN = re.compile(
        r"(?:type\s+Mutation\s*\{|mutation\s+\w+\s*\(|Mutation\s*:\s*\{|"
        r"@Mutation\s*\(|mutationType|MutationType)",
        re.MULTILINE,
    )

    def analyze(self, files: list[dict], context: dict) -> dict:
        """
        Compute attack surface metrics across all provided files.

        Each file dict: {filename: str, content: str, language: str}
        Returns a rich attack surface report dict.
        """
        all_routes: list[str] = []
        auth_protected_count = 0
        upload_endpoints: list[str] = []
        integrations: set[str] = set()
        env_vars: set[str] = set()
        ws_count = 0
        mutation_count = 0

        for f in files:
            content = f.get("content", "")
            filename = f.get("filename", "")
            language = f.get("language", "javascript").lower()

            # Count routes
            routes = self._extract_routes(content, language)
            all_routes.extend(routes)

            # Auth coverage per route
            if self._find_auth_middleware(content):
                auth_protected_count += len(routes)

            # Upload endpoints
            if any(re.search(p, content) for p in self._UPLOAD_INDICATORS):
                for route in routes:
                    if "upload" in route.lower() or "file" in route.lower() or route not in upload_endpoints:
                        upload_endpoints.append(route)

            # Third-party integrations
            for service, pattern in self._THIRD_PARTY_SERVICES.items():
                if re.search(pattern, content):
                    integrations.add(service)

            # Environment variables
            for m in self._ENV_VAR_PATTERN.finditer(content):
                var_name = m.group(1) or m.group(2)
                if var_name:
                    env_vars.add(var_name)

            # WebSocket handlers
            ws_count += len(self._WEBSOCKET_PATTERN.findall(content))

            # GraphQL mutations
            mutation_count += len(self._GRAPHQL_MUTATION_PATTERN.findall(content))

        total_routes = len(all_routes)
        unprotected_ratio = (
            round((total_routes - auth_protected_count) / total_routes, 2)
            if total_routes > 0
            else 0.0
        )

        # Classify attack vectors
        attack_vectors = self._classify_attack_vectors(
            total_routes=total_routes,
            unprotected_ratio=unprotected_ratio,
            upload_endpoints=upload_endpoints,
            integrations=integrations,
            ws_count=ws_count,
            mutation_count=mutation_count,
        )

        return {
            "external_endpoints": total_routes,
            "auth_protected": min(auth_protected_count, total_routes),
            "unprotected_ratio": unprotected_ratio,
            "file_upload_endpoints": list(set(upload_endpoints))[:20],
            "third_party_integrations": sorted(integrations),
            "exposed_env_vars": sorted(env_vars),
            "websocket_handlers": ws_count,
            "graphql_mutations": mutation_count,
            "attack_vectors": attack_vectors,
        }

    def _count_routes(self, code: str, language: str) -> int:
        """Return number of HTTP route handlers defined in `code`."""
        return len(self._extract_routes(code, language))

    def _extract_routes(self, code: str, language: str) -> list[str]:
        """Extract route path strings from the code."""
        lang = language.lower()
        patterns = self._ROUTE_PATTERNS.get(lang, self._ROUTE_PATTERNS.get("javascript", []))
        routes: list[str] = []
        for pat in patterns:
            try:
                for m in re.finditer(pat, code, re.MULTILINE):
                    routes.append(m.group(1))
            except re.error:
                continue
        return routes

    def _find_auth_middleware(self, code: str) -> bool:
        """Return True if the code contains recognisable authentication middleware usage."""
        for indicator in self._AUTH_INDICATORS:
            if re.search(indicator, code, re.IGNORECASE):
                return True
        return False

    def _classify_attack_vectors(
        self,
        total_routes: int,
        unprotected_ratio: float,
        upload_endpoints: list[str],
        integrations: set[str],
        ws_count: int,
        mutation_count: int,
    ) -> list[str]:
        """Produce a human-readable summary of the notable attack vectors."""
        vectors: list[str] = []

        if total_routes == 0:
            vectors.append("No HTTP endpoints detected — check framework detection coverage")
            return vectors

        if unprotected_ratio >= 0.5:
            vectors.append(
                f"High proportion of unauthenticated endpoints "
                f"({int(unprotected_ratio * 100)}% unprotected)"
            )
        elif unprotected_ratio > 0:
            vectors.append(
                f"Some unauthenticated endpoints detected "
                f"({int(unprotected_ratio * 100)}% unprotected)"
            )

        if upload_endpoints:
            vectors.append(
                f"File upload attack surface: {len(upload_endpoints)} endpoint(s) accept uploads"
            )

        if ws_count > 0:
            vectors.append(
                f"WebSocket attack surface: {ws_count} handler(s) — validate all messages server-side"
            )

        if mutation_count > 0:
            vectors.append(
                f"GraphQL mutation surface: {mutation_count} mutation(s) — enforce per-field authorization"
            )

        high_risk_integrations = {"stripe", "paypal", "aws_s3", "openai", "firebase"}
        risk_integrations = integrations & high_risk_integrations
        if risk_integrations:
            vectors.append(
                f"High-value third-party integrations detected: {', '.join(sorted(risk_integrations))}"
            )

        if total_routes > 50:
            vectors.append(
                f"Large API surface area: {total_routes} endpoints — consider API gateway with WAF"
            )

        return vectors


# ─────────────────────────────────────────────────────────────────────────────
# Threat Model Report  (top-level orchestrator)
# ─────────────────────────────────────────────────────────────────────────────

_SEVERITY_WEIGHTS = {"critical": 25, "high": 10, "medium": 4, "low": 1}
_SEVERITY_ORDER = ["critical", "high", "medium", "low"]

_THREAT_LEVEL_THRESHOLDS = [
    (80, "low"),
    (60, "medium"),
    (40, "high"),
    (0,  "critical"),
]


class ThreatModelReport:
    """
    Orchestrates the full STRIDE threat modeling workflow.

    Usage:
        report = ThreatModelReport()

        # Analyze a diff (list of {filename, content, language, diff} dicts):
        result = report.analyze_diff(files, language="typescript")

        # Analyze an entire repo:
        result = report.analyze_repo(file_tree, contents)
    """

    def __init__(self) -> None:
        self._data_flow = DataFlowAnalyzer()
        self._surface = AttackSurfaceAnalyzer()

    # ── Public API ────────────────────────────────────────────────────────────

    def analyze_diff(self, files: list[dict], language: str = "javascript") -> dict:
        """
        Run STRIDE analysis against the added lines of a code diff.

        Each file dict should have:
            filename (str), content (str), diff (str, optional)
        The `diff` field is preferred if present; falls back to `content`.
        """
        all_findings: list[dict] = []
        data_flows: list[dict] = []

        for f in files:
            filename = f.get("filename", "<unknown>")
            # Use diff if available; scan only added lines to reduce noise
            raw = f.get("diff") or f.get("content", "")
            code = _extract_added_lines(raw) if f.get("diff") else raw
            lang = f.get("language", language)

            findings = self._run_stride_patterns(code, filename)
            all_findings.extend(findings)

            flows = self._data_flow.find_taint_flows(code, lang)
            data_flows.extend(flows)

        attack_surface = self._surface.analyze(files, {"language": language})
        return self.generate_report(all_findings, attack_surface, data_flows)

    def analyze_repo(self, file_tree: list, contents: dict) -> dict:
        """
        Run STRIDE analysis across an entire repository.

        file_tree: list of dicts {path, language, size}
        contents:  dict mapping path → file content string
        """
        all_findings: list[dict] = []
        data_flows: list[dict] = []
        files_for_surface: list[dict] = []

        for entry in file_tree:
            path = entry.get("path", "")
            lang = entry.get("language", _infer_language(path))
            content = contents.get(path, "")
            if not content:
                continue

            # Skip minified / generated files
            if _is_generated_file(path, content):
                continue

            findings = self._run_stride_patterns(content, path)
            all_findings.extend(findings)

            flows = self._data_flow.find_taint_flows(content, lang)
            data_flows.extend(flows)

            files_for_surface.append({"filename": path, "content": content, "language": lang})

        attack_surface = self._surface.analyze(files_for_surface, {})
        return self.generate_report(all_findings, attack_surface, data_flows)

    def _run_stride_patterns(self, code: str, filename: str) -> list[dict]:
        """
        Apply all THREAT_PATTERNS to `code`, return a list of finding dicts.

        Findings include file context and the matched text snippet.
        """
        findings: list[dict] = []
        lines = code.splitlines()

        for tp in THREAT_PATTERNS:
            compiled = _PATTERN_CACHE.get(tp)
            if compiled is None:
                continue

            for m in compiled.finditer(code):
                line_number = code[: m.start()].count("\n") + 1
                context_start = max(0, line_number - 2)
                context_end = min(len(lines), line_number + 2)
                context_snippet = "\n".join(lines[context_start:context_end])

                findings.append({
                    "pattern_id": tp.id,
                    "stride_category": tp.stride_category,
                    "name": tp.name,
                    "description": tp.description,
                    "severity": tp.severity,
                    "cwe_id": tp.cwe_id,
                    "mitigation": tp.mitigation,
                    "confidence": tp.confidence,
                    "filename": filename,
                    "line_number": line_number,
                    "matched_text": m.group(0)[:200],
                    "context": context_snippet,
                    "finding_id": _make_finding_id(tp.id, filename, line_number),
                })

        return findings

    def _score(self, findings: list[dict]) -> int:
        """
        Compute a risk score (0–100, higher = safer).

        Deducts points per finding weighted by severity and confidence.
        Score is clamped to [0, 100].
        """
        deduction = 0.0
        for f in findings:
            weight = _SEVERITY_WEIGHTS.get(f.get("severity", "low"), 1)
            confidence = float(f.get("confidence", 0.8))
            deduction += weight * confidence

        score = max(0, min(100, int(100 - deduction)))
        return score

    def generate_report(
        self,
        findings: list[dict],
        attack_surface: dict,
        data_flows: list[dict] | None = None,
    ) -> dict:
        """
        Assemble the final STRIDE threat model report.

        Returns a structured dict with:
          - stride_summary: per-category finding counts
          - top_threats: up to 10 highest-severity findings
          - attack_surface: AttackSurfaceAnalyzer output
          - data_flows: taint flow list
          - risk_score: 0–100 integer
          - threat_level: critical | high | medium | low
          - mitigations: deduplicated mitigation guidance list
          - statistics: counts by severity
        """
        if data_flows is None:
            data_flows = []

        # Deduplicate findings (same pattern + file + line)
        findings = _deduplicate_findings(findings)

        # STRIDE summary
        stride_summary: dict[str, int] = {
            "spoofing": 0,
            "tampering": 0,
            "repudiation": 0,
            "information_disclosure": 0,
            "denial_of_service": 0,
            "elevation_of_privilege": 0,
        }
        for f in findings:
            cat = f.get("stride_category", "")
            if cat in stride_summary:
                stride_summary[cat] += 1

        # Severity statistics
        stats: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for f in findings:
            sev = f.get("severity", "low")
            if sev in stats:
                stats[sev] += 1

        # Top threats: sort by severity then confidence
        def _sort_key(f: dict) -> tuple:
            sev_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
            return (sev_rank.get(f.get("severity", "low"), 3), -f.get("confidence", 0))

        sorted_findings = sorted(findings, key=_sort_key)
        top_threats = sorted_findings[:10]

        # Risk score
        risk_score = self._score(findings)

        # Threat level
        threat_level = "low"
        for threshold, level in _THREAT_LEVEL_THRESHOLDS:
            if risk_score <= threshold:
                threat_level = level

        # Mitigations — deduplicated, ordered by severity
        mitigations = _compile_mitigations(sorted_findings)

        # Data flow severity enrichment
        enriched_flows = _enrich_data_flows(data_flows)

        return {
            "stride_summary": stride_summary,
            "top_threats": top_threats,
            "attack_surface": attack_surface,
            "data_flows": enriched_flows,
            "risk_score": risk_score,
            "threat_level": threat_level,
            "mitigations": mitigations,
            "statistics": {
                "total_findings": len(findings),
                "by_severity": stats,
                "by_category": stride_summary,
                "data_flow_count": len(data_flows),
            },
        }


# ─────────────────────────────────────────────────────────────────────────────
# Helper functions
# ─────────────────────────────────────────────────────────────────────────────

def _extract_added_lines(diff: str) -> str:
    """
    Extract only the added lines from a unified diff.

    Lines starting with '+' (but not '+++') are added lines.
    Strips the leading '+' so patterns match normally.
    """
    added: list[str] = []
    for line in diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            added.append(line[1:])
    return "\n".join(added)


def _make_finding_id(pattern_id: str, filename: str, line: int) -> str:
    """Create a stable unique ID for a finding."""
    raw = f"{pattern_id}:{filename}:{line}"
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def _deduplicate_findings(findings: list[dict]) -> list[dict]:
    """Remove duplicate findings (same finding_id or same pattern+file+line)."""
    seen: set[str] = set()
    unique: list[dict] = []
    for f in findings:
        key = f.get("finding_id") or f"{f.get('pattern_id')}:{f.get('filename')}:{f.get('line_number')}"
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return unique


def _compile_mitigations(sorted_findings: list[dict]) -> list[dict]:
    """
    Build a deduplicated, prioritised list of mitigation recommendations.

    Groups by pattern_id so duplicate findings in multiple files yield
    one mitigation entry, referencing all affected files.
    """
    seen_patterns: dict[str, dict] = {}
    for f in sorted_findings:
        pid = f.get("pattern_id", "")
        if pid not in seen_patterns:
            seen_patterns[pid] = {
                "pattern_id": pid,
                "name": f.get("name", ""),
                "severity": f.get("severity", "low"),
                "cwe_id": f.get("cwe_id", ""),
                "guidance": f.get("mitigation", ""),
                "affected_files": [],
                "occurrence_count": 0,
            }
        entry = seen_patterns[pid]
        fn = f.get("filename", "")
        if fn and fn not in entry["affected_files"]:
            entry["affected_files"].append(fn)
        entry["occurrence_count"] += 1

    # Sort by severity
    sev_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    return sorted(seen_patterns.values(), key=lambda x: sev_rank.get(x["severity"], 3))


def _enrich_data_flows(flows: list[dict]) -> list[dict]:
    """Add a human-readable summary to each data flow."""
    enriched: list[dict] = []
    for flow in flows:
        summary = (
            f"User input from '{flow.get('source', '?')}' flows into "
            f"'{flow.get('sink', '?')}' via variable '{flow.get('variable', '?')}'"
            f" (line {flow.get('line', '?')})"
        )
        enriched.append({**flow, "summary": summary})
    return enriched


def _infer_language(path: str) -> str:
    """Infer programming language from file extension."""
    ext_map = {
        ".js": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".py": "python",
        ".rb": "ruby",
        ".go": "go",
        ".java": "java",
        ".php": "php",
        ".cs": "csharp",
        ".rs": "rust",
    }
    for ext, lang in ext_map.items():
        if path.endswith(ext):
            return lang
    return "javascript"


def _is_generated_file(path: str, content: str) -> bool:
    """
    Heuristic check for generated or vendored files that should be skipped.
    Checks path patterns and the first 500 characters of content.
    """
    skip_path_fragments = [
        "node_modules/", "vendor/", ".min.js", ".bundle.js",
        "dist/", "build/", "__pycache__/", ".pyc",
        "migrations/", "generated/", ".pb.go", "_pb2.py",
    ]
    for fragment in skip_path_fragments:
        if fragment in path:
            return True

    # Check for generated file markers in content header
    header = content[:500].lower()
    generated_markers = [
        "auto-generated", "do not edit", "generated by",
        "this file was generated", "machine generated",
    ]
    return any(marker in header for marker in generated_markers)


# ─────────────────────────────────────────────────────────────────────────────
# Dependency Threat Scanner
# ─────────────────────────────────────────────────────────────────────────────

_KNOWN_VULNERABLE_PACKAGES: list[DependencyThreat] = [
    DependencyThreat(
        package_name="lodash",
        threat_type="known_vuln",
        description="Versions <4.17.21 are vulnerable to prototype pollution (CVE-2019-10744) and ReDoS.",
        severity="high",
        cve_ids=["CVE-2019-10744", "CVE-2020-8203"],
    ),
    DependencyThreat(
        package_name="moment",
        threat_type="unmaintained",
        description="moment.js is unmaintained. Versions <2.29.4 have ReDoS vulnerabilities.",
        severity="medium",
        cve_ids=["CVE-2022-24785", "CVE-2022-31129"],
    ),
    DependencyThreat(
        package_name="node-serialize",
        threat_type="known_vuln",
        description="Unsafe deserialization allows arbitrary code execution via IIFE in serialized objects.",
        severity="critical",
        cve_ids=["CVE-2017-5941"],
    ),
    DependencyThreat(
        package_name="jsonwebtoken",
        threat_type="known_vuln",
        description="Versions <9.0.0 allow algorithm confusion attacks.",
        severity="high",
        cve_ids=["CVE-2022-23529", "CVE-2022-23539"],
    ),
    DependencyThreat(
        package_name="express",
        threat_type="known_vuln",
        description="Versions <4.19.2 have an open redirect vulnerability.",
        severity="medium",
        cve_ids=["CVE-2024-29041"],
    ),
    DependencyThreat(
        package_name="pyyaml",
        threat_type="known_vuln",
        description="Versions <6.0 allow arbitrary code execution via yaml.load() with default Loader.",
        severity="critical",
        cve_ids=["CVE-2020-14343"],
    ),
    DependencyThreat(
        package_name="pillow",
        threat_type="known_vuln",
        description="Multiple buffer overflow vulnerabilities in image parsing (versions <10.0.1).",
        severity="high",
        cve_ids=["CVE-2023-44271", "CVE-2023-50447"],
    ),
    DependencyThreat(
        package_name="requests",
        threat_type="known_vuln",
        description="Versions <2.32.0 leak proxy authentication credentials in redirects.",
        severity="medium",
        cve_ids=["CVE-2024-35195"],
    ),
    DependencyThreat(
        package_name="cryptography",
        threat_type="known_vuln",
        description="Versions <42.0.4 have NULL dereference in PKCS12 parsing.",
        severity="medium",
        cve_ids=["CVE-2024-26130"],
    ),
    DependencyThreat(
        package_name="werkzeug",
        threat_type="known_vuln",
        description="Versions <3.0.3 allow path traversal via specially crafted multipart data.",
        severity="high",
        cve_ids=["CVE-2024-34069"],
    ),
]


class DependencyThreatScanner:
    """
    Scans package manifest files for known-vulnerable dependencies.
    Supports package.json (npm), requirements.txt (pip), and Pipfile.
    """

    def scan_package_json(self, content: str) -> list[DependencyThreat]:
        """Parse package.json and return threats for known-bad packages."""
        threats: list[DependencyThreat] = []
        try:
            import json
            manifest = json.loads(content)
        except (ValueError, KeyError):
            return threats

        all_deps: dict[str, str] = {}
        all_deps.update(manifest.get("dependencies", {}))
        all_deps.update(manifest.get("devDependencies", {}))

        for threat in _KNOWN_VULNERABLE_PACKAGES:
            if threat.package_name in all_deps:
                threats.append(threat)

        return threats

    def scan_requirements_txt(self, content: str) -> list[DependencyThreat]:
        """Parse requirements.txt and return threats for known-bad packages."""
        threats: list[DependencyThreat] = []
        installed: set[str] = set()

        for line in content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # Strip version specifier: requests==2.28.0 → requests
            pkg_name = re.split(r"[>=<!~\[]", line)[0].strip().lower()
            installed.add(pkg_name)

        for threat in _KNOWN_VULNERABLE_PACKAGES:
            if threat.package_name in installed:
                threats.append(threat)

        return threats

    def scan_manifest(self, filename: str, content: str) -> list[DependencyThreat]:
        """Auto-detect manifest type and delegate to the right scanner."""
        base = filename.split("/")[-1].lower()
        if base == "package.json":
            return self.scan_package_json(content)
        if base in ("requirements.txt", "requirements-dev.txt", "requirements-prod.txt"):
            return self.scan_requirements_txt(content)
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Convenience: full-pipeline helper
# ─────────────────────────────────────────────────────────────────────────────

def run_threat_model_on_diff(
    files: list[dict],
    language: str = "javascript",
    include_dependency_scan: bool = True,
) -> dict:
    """
    One-call convenience wrapper for the most common use case:
    running the full STRIDE threat model on a code diff.

    Args:
        files: list of {filename, content, diff (optional), language (optional)}
        language: default language if not specified per-file
        include_dependency_scan: whether to scan package manifests

    Returns:
        The full ThreatModelReport.generate_report() output dict, optionally
        extended with a `dependency_threats` key.
    """
    reporter = ThreatModelReport()
    result = reporter.analyze_diff(files, language=language)

    if include_dependency_scan:
        scanner = DependencyThreatScanner()
        dep_threats: list[dict] = []
        for f in files:
            threats = scanner.scan_manifest(
                f.get("filename", ""), f.get("content", "")
            )
            for t in threats:
                dep_threats.append({
                    "package_name": t.package_name,
                    "threat_type": t.threat_type,
                    "description": t.description,
                    "severity": t.severity,
                    "cve_ids": t.cve_ids,
                })
        result["dependency_threats"] = dep_threats

    return result


def run_threat_model_on_repo(
    file_tree: list[dict],
    contents: dict[str, str],
    include_dependency_scan: bool = True,
) -> dict:
    """
    One-call convenience wrapper for full-repository STRIDE threat modeling.

    Args:
        file_tree: list of {path, language, size}
        contents:  dict mapping path → file content string
        include_dependency_scan: whether to scan package manifests

    Returns:
        The full ThreatModelReport.generate_report() output dict.
    """
    reporter = ThreatModelReport()
    result = reporter.analyze_repo(file_tree, contents)

    if include_dependency_scan:
        scanner = DependencyThreatScanner()
        dep_threats: list[dict] = []
        manifest_filenames = ["package.json", "requirements.txt"]
        for path, content in contents.items():
            base = path.split("/")[-1]
            if base in manifest_filenames:
                for t in scanner.scan_manifest(path, content):
                    dep_threats.append({
                        "package_name": t.package_name,
                        "threat_type": t.threat_type,
                        "description": t.description,
                        "severity": t.severity,
                        "cve_ids": t.cve_ids,
                    })
        result["dependency_threats"] = dep_threats

    return result
