"""
Entropy Scanner
===============
Shannon entropy-based secret detector for GitScope Neural AI Engine.

Identifies high-entropy strings that are likely cryptographic secrets,
API keys, tokens, or passwords embedded in source code or diffs.

Algorithm:
  - Compute Shannon entropy (base-2 bits/char) for candidate strings.
  - Apply per-character-class thresholds (hex, base64, alphanum, printable).
  - Filter false-positives with a rich whitelist of known-safe patterns.
  - Classify survivors into specific secret types (AWS, GitHub, JWT, etc.).
  - Context-aware: lower thresholds for sensitive filenames (config/.env).

Usage:
    from analysis.entropy_scanner import scan_for_secrets, scan_diff_for_secrets

    findings = scan_for_secrets(source_code, "config/settings.py")
    diff_findings = scan_diff_for_secrets(patch_text, "src/auth.js")
"""

from __future__ import annotations

import math
import re
import string
from dataclasses import dataclass, field
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

#: Entropy thresholds per character class.
#: Strings below these values are considered non-secret.
ENTROPY_THRESHOLDS: dict[str, float] = {
    "hex":          3.5,   # 40+ char hex → likely SHA/key
    "base64":       4.5,   # 20+ chars base64
    "alphanumeric": 3.8,   # mixed upper/lower/digit
    "printable":    4.0,   # arbitrary printable ASCII
}

#: Minimum string lengths per character class to even bother evaluating.
MIN_LENGTHS: dict[str, int] = {
    "hex":          20,
    "base64":       20,
    "alphanumeric": 16,
    "printable":    12,
}

#: Files/directories that warrant *lower* thresholds (higher sensitivity).
#: Keys are glob-style substrings matched against the filename.
HIGH_ENTROPY_CONTEXTS: dict[str, float] = {
    ".env":            0.4,   # subtract 0.4 from all thresholds
    ".env.example":    0.3,
    ".env.sample":     0.3,
    "config/":         0.25,
    "secrets/":        0.5,
    "credentials":     0.45,
    "settings.py":     0.3,
    "settings.js":     0.3,
    "settings.ts":     0.3,
    "config.py":       0.25,
    "config.js":       0.25,
    "config.ts":       0.25,
    "docker-compose":  0.3,
    "Dockerfile":      0.2,
    "terraform":       0.35,
    ".tfvars":         0.45,
    "helm/":           0.3,
    "k8s/":            0.3,
    "manifests/":      0.3,
    "ansible/":        0.3,
    "vault/":          0.5,
}

#: Patterns for strings that look high-entropy but are safe to ignore.
SAFE_PATTERNS: list[re.Pattern[str]] = [
    # UUIDs
    re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
    # CSS colours (#rrggbb / #rrggbbaa)
    re.compile(r"^#[0-9a-fA-F]{3,8}$"),
    # SHA-1 / SHA-256 hex (exact length with only hex chars)
    re.compile(r"^[0-9a-f]{40}$"),   # SHA-1
    re.compile(r"^[0-9a-f]{64}$"),   # SHA-256
    re.compile(r"^[0-9a-f]{32}$"),   # MD5
    re.compile(r"^[0-9a-f]{56}$"),   # SHA-224
    re.compile(r"^[0-9a-f]{96}$"),   # SHA-384
    re.compile(r"^[0-9a-f]{128}$"),  # SHA-512
    # Base64-encoded images
    re.compile(r"^data:image/[a-z+]+;base64,"),
    # Version strings
    re.compile(r"^\d+\.\d+(\.\d+){0,3}(-[a-zA-Z0-9.]+)?$"),
    # Semantic version ranges
    re.compile(r"^[~^>=<]{1,2}\d+\.\d+"),
    # Timestamps / ISO 8601
    re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}"),
    # Base-64 encoded short nonces that are intentionally included (< 24 chars)
    re.compile(r"^[A-Za-z0-9+/]{1,23}={0,2}$"),
    # Hex colour strings without hash (6 or 8 hex digits after stripping)
    re.compile(r"^[0-9a-fA-F]{6}$"),
    re.compile(r"^[0-9a-fA-F]{8}$"),
    # Common test / placeholder strings
    re.compile(r"(?i)^(test|example|sample|placeholder|dummy|fake|mock|your[-_]?key|your[-_]?secret|changeme|replace[-_]?me|<.*?>)"),
    # font-src / src URL blobs
    re.compile(r"^(https?|ftp|data|blob)://"),
    # Minified CSS/JS selector-like (contains { } ; en masse)
    re.compile(r"[{};]{3,}"),
    # Long repeated characters (not random)
    re.compile(r"(.)\1{4,}"),
    # Numeric-only
    re.compile(r"^\d+$"),
    # All same case hex that could be a colour palette list
    re.compile(r"^([0-9a-f]{6},?){2,}$"),
]

# ─────────────────────────────────────────────────────────────────────────────
# Regex helpers for extraction
# ─────────────────────────────────────────────────────────────────────────────

#: Matches any quoted string (single or double quotes, no escaped handling needed for entropy)
_QUOTED_STRING_RE = re.compile(r"""["']([^"'\n]{8,300})["']""")

#: Matches assignment patterns: VAR = "value" / VAR: "value" / VAR=value
_ASSIGNMENT_RE = re.compile(
    r"""(?i)(?:password|passwd|secret|token|key|api|auth|credential|private|seed|salt|hash|cert|iv|cipher|hmac|bearer|access|refresh|client_secret|client_id)\s*[:=]\s*["']?([A-Za-z0-9+/=_\-\.]{8,300})["']?"""
)

#: Identifies comment lines (Python/JS/TS/Ruby/Shell style)
_COMMENT_LINE_RE = re.compile(r"^\s*(?:#|//|/\*|\*)")

#: Identifies minified files by name
_MINIFIED_FILE_RE = re.compile(r"\.(min\.js|min\.css|bundle\.js|chunk\.js|vendor\.js)$")

# ─────────────────────────────────────────────────────────────────────────────
# Character-class detectors
# ─────────────────────────────────────────────────────────────────────────────

_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/]+=*$")
_ALPHANUM_RE = re.compile(r"^[A-Za-z0-9]+$")
_PRINTABLE_SET = set(string.printable) - set(string.whitespace)


def _classify_charset(value: str) -> str:
    """Return the character class of *value* for threshold selection."""
    if _HEX_RE.match(value):
        return "hex"
    if _BASE64_RE.match(value) and len(value) % 4 == 0:
        return "base64"
    if _ALPHANUM_RE.match(value):
        return "alphanumeric"
    return "printable"


# ─────────────────────────────────────────────────────────────────────────────
# Core entropy computation
# ─────────────────────────────────────────────────────────────────────────────

def shannon_entropy(data: str) -> float:
    """Compute the Shannon entropy of *data* in bits per character (base-2).

    A random, uniformly distributed string over N symbols has entropy log2(N).
    For ASCII printable (95 symbols) the theoretical max is ~6.57 bits/char.
    In practice:
      - English text:   ~3.5 bits/char
      - Hex secrets:    ~3.9–4.0 bits/char
      - Base64 secrets: ~5.0–5.5 bits/char
      - Random bytes:   ~6.0+ bits/char

    Parameters
    ----------
    data:
        The string to measure.

    Returns
    -------
    float
        Entropy in bits per character.  Returns 0.0 for empty strings.
    """
    if not data:
        return 0.0

    freq: dict[str, int] = {}
    for ch in data:
        freq[ch] = freq.get(ch, 0) + 1

    length = len(data)
    entropy = 0.0
    for count in freq.values():
        probability = count / length
        entropy -= probability * math.log2(probability)

    return entropy


# ─────────────────────────────────────────────────────────────────────────────
# Secret-type classifier
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SecretClassification:
    secret_type: str
    confidence: float
    description: str


#: Order matters — more specific patterns first.
_CLASSIFIER_RULES: list[tuple[re.Pattern[str], str, float, str]] = [
    (re.compile(r"^AKIA[0-9A-Z]{16}$"),
     "aws_access_key_id", 0.99, "AWS Access Key ID (AKIA prefix)"),
    (re.compile(r"^ASIA[0-9A-Z]{16}$"),
     "aws_temp_access_key", 0.98, "AWS Temporary Access Key (ASIA prefix, STS)"),
    (re.compile(r"^AROA[0-9A-Z]{16}$"),
     "aws_role_id", 0.97, "AWS Role ID"),
    (re.compile(r"^AIDA[0-9A-Z]{16}$"),
     "aws_user_id", 0.97, "AWS IAM User ID"),
    (re.compile(r"^ghp_[A-Za-z0-9_]{36,}$"),
     "github_personal_access_token", 0.99, "GitHub Personal Access Token"),
    (re.compile(r"^gho_[A-Za-z0-9_]{36,}$"),
     "github_oauth_token", 0.99, "GitHub OAuth Token"),
    (re.compile(r"^ghu_[A-Za-z0-9_]{36,}$"),
     "github_user_to_server_token", 0.99, "GitHub User-to-Server Token"),
    (re.compile(r"^ghs_[A-Za-z0-9_]{36,}$"),
     "github_server_to_server_token", 0.99, "GitHub Server-to-Server Token"),
    (re.compile(r"^ghr_[A-Za-z0-9_]{36,}$"),
     "github_refresh_token", 0.99, "GitHub Refresh Token"),
    (re.compile(r"^xox[baprs]-[0-9]{10,12}-"),
     "slack_token", 0.98, "Slack API Token"),
    (re.compile(r"^sk-[A-Za-z0-9]{48}$"),
     "openai_api_key", 0.97, "OpenAI API Key"),
    (re.compile(r"^sk-proj-[A-Za-z0-9_\-]{40,}$"),
     "openai_project_key", 0.97, "OpenAI Project Key"),
    (re.compile(r"^AIza[0-9A-Za-z\-_]{35}$"),
     "google_api_key", 0.97, "Google API Key"),
    (re.compile(r"^ya29\.[A-Za-z0-9_\-]+$"),
     "google_oauth_token", 0.95, "Google OAuth2 Access Token"),
    (re.compile(r"^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$"),
     "jwt", 0.85, "JSON Web Token (3-segment dot-separated base64url)"),
    (re.compile(r"^-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY"),
     "ssh_private_key", 0.99, "SSH / PEM Private Key material"),
    (re.compile(r"^-----BEGIN CERTIFICATE"),
     "x509_certificate", 0.90, "X.509 Certificate (may contain private material)"),
    (re.compile(r"(?i)^(mongodb(\+srv)?://|postgres://|postgresql://|mysql://|redis://)"),
     "database_connection_string", 0.97, "Database connection string with embedded credentials"),
    (re.compile(r"(?i)(password|passwd|pwd)\s*[:=]\s*.+"),
     "database_password", 0.80, "Probable database / application password"),
    (re.compile(r"^[0-9a-fA-F]{32}$"),
     "encryption_key_or_iv_128bit", 0.75, "128-bit hex key or IV"),
    (re.compile(r"^[0-9a-fA-F]{48}$"),
     "encryption_key_192bit", 0.75, "192-bit hex key"),
    (re.compile(r"^[0-9a-fA-F]{64}$"),
     "encryption_key_256bit", 0.78, "256-bit hex key or SHA-256 hash"),
    (re.compile(r"^[A-Za-z0-9+/]{88}==$"),
     "encryption_key_512bit_b64", 0.78, "512-bit base64-encoded key"),
    (re.compile(r"(?i)stripe.{0,10}(sk|pk)_(live|test)_[A-Za-z0-9]{24,}"),
     "stripe_key", 0.99, "Stripe API Key"),
    (re.compile(r"^AC[a-z0-9]{32}$"),
     "twilio_account_sid", 0.90, "Twilio Account SID"),
    (re.compile(r"^SK[a-z0-9]{32}$"),
     "twilio_api_key", 0.90, "Twilio API Key"),
    (re.compile(r"^SG\.[A-Za-z0-9_\-]{22}\.[A-Za-z0-9_\-]{43}$"),
     "sendgrid_api_key", 0.99, "SendGrid API Key"),
    (re.compile(r"^npm_[A-Za-z0-9]{36}$"),
     "npm_token", 0.98, "npm Access Token"),
    (re.compile(r"^[A-Za-z0-9]{32,}$"),
     "generic_api_key", 0.60, "Generic high-entropy API key or token"),
]


def classify_secret(value: str) -> SecretClassification:
    """Classify a high-entropy string into a specific secret type.

    Walks *_CLASSIFIER_RULES* in order (most-specific first) and returns
    the first match.  Falls back to ``generic_api_key``.

    Parameters
    ----------
    value:
        The candidate secret string.

    Returns
    -------
    SecretClassification
        Named tuple with ``secret_type``, ``confidence``, ``description``.
    """
    for pattern, stype, conf, desc in _CLASSIFIER_RULES:
        if pattern.search(value):
            return SecretClassification(secret_type=stype, confidence=conf, description=desc)
    return SecretClassification(
        secret_type="generic_high_entropy",
        confidence=0.55,
        description="Unclassified high-entropy string — probable secret or key material",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _effective_threshold(charset: str, filename: str) -> float:
    """Return the entropy threshold for *charset*, adjusted for *filename* context."""
    base = ENTROPY_THRESHOLDS.get(charset, ENTROPY_THRESHOLDS["printable"])
    reduction = 0.0
    for pattern, delta in HIGH_ENTROPY_CONTEXTS.items():
        if pattern in filename:
            reduction = max(reduction, delta)
    return max(base - reduction, 1.5)


def _is_safe(value: str) -> bool:
    """Return True if *value* matches any known-safe pattern."""
    for pattern in SAFE_PATTERNS:
        if pattern.search(value):
            return True
    return False


def _is_comment_line(line: str) -> bool:
    """Return True if *line* appears to be a comment."""
    return bool(_COMMENT_LINE_RE.match(line))


def _extract_candidates(line: str) -> list[str]:
    """Extract candidate secret strings from a single source *line*.

    Pulls both quoted string literals and bare assignment values.
    """
    candidates: list[str] = []
    for m in _QUOTED_STRING_RE.finditer(line):
        candidates.append(m.group(1))
    for m in _ASSIGNMENT_RE.finditer(line):
        candidates.append(m.group(1).strip("'\""))
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    return unique


def _build_finding(
    *,
    line_number: int,
    value: str,
    entropy: float,
    charset: str,
    filename: str,
    threshold: float,
) -> Optional[dict]:
    """Build a finding dict or return None if the value should be skipped."""
    if len(value) < MIN_LENGTHS.get(charset, 8):
        return None
    if _is_safe(value):
        return None

    classification = classify_secret(value)

    # Composite confidence: blends entropy signal with classifier confidence.
    # Entropy surplus over threshold scaled to [0, 0.3] added to base.
    entropy_surplus = entropy - threshold
    entropy_bonus = min(entropy_surplus / 3.0, 0.3)
    composite_confidence = round(
        min(classification.confidence + entropy_bonus, 1.0), 3
    )

    preview = value[:60] + ("…" if len(value) > 60 else "")

    return {
        "line_number":     line_number,
        "value_preview":   preview,
        "entropy":         round(entropy, 4),
        "threshold":       round(threshold, 4),
        "charset":         charset,
        "suspected_type":  classification.secret_type,
        "type_description": classification.description,
        "confidence":      composite_confidence,
        "filename":        filename,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def scan_for_secrets(code: str, filename: str) -> list[dict]:
    """Scan *code* for high-entropy strings that are likely secrets.

    Parameters
    ----------
    code:
        Full source code text.
    filename:
        Path or name of the file (used for threshold adjustment and context
        filtering).  Minified files are skipped entirely.

    Returns
    -------
    list[dict]
        Each dict has keys: line_number, value_preview, entropy, threshold,
        charset, suspected_type, type_description, confidence, filename.
        Sorted by confidence descending.
    """
    if _MINIFIED_FILE_RE.search(filename):
        return []

    findings: list[dict] = []

    for line_number, line in enumerate(code.splitlines(), start=1):
        # Skip blank and pure-comment lines
        stripped = line.strip()
        if not stripped or _is_comment_line(stripped):
            continue

        for candidate in _extract_candidates(line):
            charset = _classify_charset(candidate)
            threshold = _effective_threshold(charset, filename)

            if len(candidate) < MIN_LENGTHS.get(charset, 8):
                continue

            entropy = shannon_entropy(candidate)
            if entropy < threshold:
                continue

            finding = _build_finding(
                line_number=line_number,
                value=candidate,
                entropy=entropy,
                charset=charset,
                filename=filename,
                threshold=threshold,
            )
            if finding is not None:
                findings.append(finding)

    # Deduplicate by (line_number, value_preview) and sort by confidence
    seen_keys: set[tuple] = set()
    unique: list[dict] = []
    for f in findings:
        key = (f["line_number"], f["value_preview"])
        if key not in seen_keys:
            seen_keys.add(key)
            unique.append(f)

    unique.sort(key=lambda x: x["confidence"], reverse=True)
    return unique


def scan_diff_for_secrets(patch: str, filename: str) -> list[dict]:
    """Scan only *added* lines in a unified diff *patch* for secrets.

    Lines that start with ``+`` (but not ``+++``) are treated as added lines.
    Line numbers are approximated from the diff hunk headers.

    Parameters
    ----------
    patch:
        Unified diff text (output of ``git diff`` or GitHub patch field).
    filename:
        Filename associated with the patch.

    Returns
    -------
    list[dict]
        Same structure as :func:`scan_for_secrets`.
    """
    if _MINIFIED_FILE_RE.search(filename):
        return []

    findings: list[dict] = []
    current_new_line = 0

    # Parse hunk headers to track line numbers: @@ -old +new,count @@
    _hunk_header_re = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")

    for line in patch.splitlines():
        hunk_match = _hunk_header_re.match(line)
        if hunk_match:
            current_new_line = int(hunk_match.group(1)) - 1
            continue

        if line.startswith("+++"):
            continue

        if line.startswith("+"):
            current_new_line += 1
            added_content = line[1:]  # Strip the leading '+'

            if not added_content.strip() or _is_comment_line(added_content.strip()):
                continue

            for candidate in _extract_candidates(added_content):
                charset = _classify_charset(candidate)
                threshold = _effective_threshold(charset, filename)

                if len(candidate) < MIN_LENGTHS.get(charset, 8):
                    continue

                entropy = shannon_entropy(candidate)
                if entropy < threshold:
                    continue

                finding = _build_finding(
                    line_number=current_new_line,
                    value=candidate,
                    entropy=entropy,
                    charset=charset,
                    filename=filename,
                    threshold=threshold,
                )
                if finding is not None:
                    findings.append(finding)
        elif not line.startswith("-"):
            # Context line
            current_new_line += 1

    seen_keys: set[tuple] = set()
    unique: list[dict] = []
    for f in findings:
        key = (f["line_number"], f["value_preview"])
        if key not in seen_keys:
            seen_keys.add(key)
            unique.append(f)

    unique.sort(key=lambda x: x["confidence"], reverse=True)
    return unique


def summarise_findings(findings: list[dict]) -> dict:
    """Produce a concise summary dict from a list of secret findings.

    Parameters
    ----------
    findings:
        Output of :func:`scan_for_secrets` or :func:`scan_diff_for_secrets`.

    Returns
    -------
    dict
        Keys: total, critical_count, high_confidence_count, types_found,
        highest_entropy, top_finding.
    """
    if not findings:
        return {
            "total": 0,
            "critical_count": 0,
            "high_confidence_count": 0,
            "types_found": [],
            "highest_entropy": 0.0,
            "top_finding": None,
        }

    critical_types = {
        "aws_access_key_id", "aws_temp_access_key",
        "github_personal_access_token", "github_oauth_token",
        "github_user_to_server_token", "github_server_to_server_token",
        "ssh_private_key", "stripe_key", "openai_api_key",
        "database_connection_string",
    }

    critical_count = sum(1 for f in findings if f["suspected_type"] in critical_types)
    high_conf = sum(1 for f in findings if f["confidence"] >= 0.85)
    types_found = list({f["suspected_type"] for f in findings})
    highest_entropy = max(f["entropy"] for f in findings)
    top = max(findings, key=lambda x: x["confidence"])

    return {
        "total":                findings.__len__(),
        "critical_count":       critical_count,
        "high_confidence_count": high_conf,
        "types_found":          types_found,
        "highest_entropy":      round(highest_entropy, 4),
        "top_finding":          top,
    }
