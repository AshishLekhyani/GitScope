"""
CVE Database
============
Curated package-level CVE data and code-pattern CVE signatures for the
GitScope Neural AI Engine dependency and vulnerability analysis pipeline.

Provides:
  PACKAGE_VULNERABILITIES  — mapping of package → vulnerable version ranges + CVE details
  CVE_PATTERNS             — code-pattern-based CVE detection rules (augments vuln_patterns.py)
  ZERO_DAY_INDICATORS      — heuristics for emerging vulnerability classes
  detect_vulnerable_packages()  — parse a dependency file and cross-reference CVEs
  is_version_vulnerable()       — semver range comparison helper

Usage:
    from analysis.cve_database import detect_vulnerable_packages

    findings = detect_vulnerable_packages(requirements_txt, ecosystem="pypi")
    for hit in findings:
        print(hit["cve_id"], hit["package"], hit["severity"])
"""

from __future__ import annotations

import re
from typing import Optional

# ---------------------------------------------------------------------------
# Version comparison helpers
# ---------------------------------------------------------------------------

def _parse_version(version_str: str) -> tuple[int, ...]:
    """Parse a semver-like string into a comparable integer tuple.

    Strips leading non-digit characters (``^``, ``~``, ``>=``, ``v``, etc.)
    and ignores pre-release suffixes after ``-``.

    Parameters
    ----------
    version_str:
        A version string such as ``"1.2.3"``, ``"^4.17.21"``, ``">=2.31.0"``.

    Returns
    -------
    tuple[int, ...]
        Integer tuple suitable for comparison, e.g. ``(1, 2, 3)``.
    """
    cleaned = re.sub(r"^[^0-9]*", "", version_str)
    cleaned = cleaned.split("-")[0].split("+")[0]
    parts = cleaned.split(".")
    result: list[int] = []
    for p in parts:
        try:
            result.append(int(p))
        except ValueError:
            break
    return tuple(result) if result else (0,)


def is_version_vulnerable(version: str, vulnerable_range: str) -> bool:
    """Return True if *version* falls within *vulnerable_range*.

    Supports the following range syntaxes:
      - ``<X.Y.Z``       — strictly less than
      - ``<=X.Y.Z``      — less than or equal
      - ``>X.Y.Z``       — strictly greater than
      - ``>=X.Y.Z``      — greater than or equal
      - ``=X.Y.Z``       — exact match
      - ``X.Y.Z``        — exact match (no operator)
      - ``>=A,<B``       — compound AND range
      - ``>=A,<=B``      — compound AND range (inclusive upper bound)

    Parameters
    ----------
    version:
        The installed or declared package version.
    vulnerable_range:
        A range string as described above.

    Returns
    -------
    bool
        True when the version is within the vulnerable range.
    """
    if not version or not vulnerable_range:
        return False

    try:
        v = _parse_version(version)
    except Exception:
        return False

    # Compound range: split on comma
    if "," in vulnerable_range:
        parts = [p.strip() for p in vulnerable_range.split(",")]
        return all(is_version_vulnerable(version, part) for part in parts)

    vr = vulnerable_range.strip()

    try:
        if vr.startswith("<="):
            return v <= _parse_version(vr[2:])
        if vr.startswith(">="):
            return v >= _parse_version(vr[2:])
        if vr.startswith("<"):
            return v < _parse_version(vr[1:])
        if vr.startswith(">"):
            return v > _parse_version(vr[1:])
        if vr.startswith("="):
            return v == _parse_version(vr[1:])
        # Plain version — exact match
        return v == _parse_version(vr)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Package vulnerability database
# ---------------------------------------------------------------------------

#: Schema per entry:
#:   package      — canonical lowercase package name
#:   ecosystem    — npm | pypi | maven | go | rubygems
#:   vulnerable_range — semver constraint string
#:   cve_id       — CVE identifier
#:   severity     — critical | high | medium | low
#:   cvss_score   — CVSS v3 base score (float, 0.0–10.0)
#:   description  — short human-readable description
#:   fix_version  — first safe version
#:   references   — list of URLs for further reading
PACKAGE_VULNERABILITIES: list[dict] = [

    # ── npm ──────────────────────────────────────────────────────────────────

    {
        "package": "lodash", "ecosystem": "npm",
        "vulnerable_range": "<4.17.21",
        "cve_id": "CVE-2021-23337", "severity": "high", "cvss_score": 7.2,
        "description": "Prototype pollution via 'set' and 'setWith' methods allowing arbitrary code execution.",
        "fix_version": "4.17.21",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-23337"],
    },
    {
        "package": "lodash", "ecosystem": "npm",
        "vulnerable_range": "<4.17.19",
        "cve_id": "CVE-2020-8203", "severity": "high", "cvss_score": 7.4,
        "description": "Prototype pollution via zipObjectDeep.",
        "fix_version": "4.17.19",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2020-8203"],
    },
    {
        "package": "axios", "ecosystem": "npm",
        "vulnerable_range": "<1.6.0",
        "cve_id": "CVE-2023-45857", "severity": "medium", "cvss_score": 6.5,
        "description": "XSRF-TOKEN header leakage to third-party origins when using withCredentials.",
        "fix_version": "1.6.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-45857"],
    },
    {
        "package": "node-fetch", "ecosystem": "npm",
        "vulnerable_range": "<3.3.2",
        "cve_id": "CVE-2022-0235", "severity": "high", "cvss_score": 8.8,
        "description": "Exposure of sensitive information to an unauthorised actor via redirect.",
        "fix_version": "3.3.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-0235"],
    },
    {
        "package": "express", "ecosystem": "npm",
        "vulnerable_range": "<4.18.3",
        "cve_id": "CVE-2024-29041", "severity": "medium", "cvss_score": 6.1,
        "description": "Open redirect vulnerability in Express.js allows redirect to non-localhost URLs.",
        "fix_version": "4.18.3",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-29041"],
    },
    {
        "package": "jsonwebtoken", "ecosystem": "npm",
        "vulnerable_range": "<9.0.0",
        "cve_id": "CVE-2022-23529", "severity": "high", "cvss_score": 7.6,
        "description": "Insecure default algorithm and secretOrPublicKey injection via crafted token.",
        "fix_version": "9.0.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-23529"],
    },
    {
        "package": "minimist", "ecosystem": "npm",
        "vulnerable_range": "<1.2.6",
        "cve_id": "CVE-2021-44906", "severity": "critical", "cvss_score": 9.8,
        "description": "Prototype pollution via constructor or __proto__ keys.",
        "fix_version": "1.2.6",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-44906"],
    },
    {
        "package": "moment", "ecosystem": "npm",
        "vulnerable_range": "<2.29.4",
        "cve_id": "CVE-2022-31129", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted date string in pathological cases.",
        "fix_version": "2.29.4",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-31129"],
    },
    {
        "package": "serialize-javascript", "ecosystem": "npm",
        "vulnerable_range": "<3.1.0",
        "cve_id": "CVE-2020-7660", "severity": "high", "cvss_score": 8.1,
        "description": "XSS via regex literals serialised without proper escaping.",
        "fix_version": "3.1.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2020-7660"],
    },
    {
        "package": "handlebars", "ecosystem": "npm",
        "vulnerable_range": "<4.7.7",
        "cve_id": "CVE-2021-23369", "severity": "critical", "cvss_score": 9.8,
        "description": "Remote code execution via prototype pollution and template compilation.",
        "fix_version": "4.7.7",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-23369"],
    },
    {
        "package": "marked", "ecosystem": "npm",
        "vulnerable_range": "<4.0.10",
        "cve_id": "CVE-2022-21681", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via malformed inline code sequences.",
        "fix_version": "4.0.10",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-21681"],
    },
    {
        "package": "shelljs", "ecosystem": "npm",
        "vulnerable_range": "<0.8.5",
        "cve_id": "CVE-2022-0144", "severity": "high", "cvss_score": 7.5,
        "description": "Improper privilege management via shell command injection.",
        "fix_version": "0.8.5",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-0144"],
    },
    {
        "package": "node-serialize", "ecosystem": "npm",
        "vulnerable_range": "=0.0.4",
        "cve_id": "CVE-2017-5941", "severity": "critical", "cvss_score": 9.8,
        "description": "Arbitrary code execution via deserialising untrusted data with IIFEs.",
        "fix_version": "N/A — do not use",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2017-5941"],
    },
    {
        "package": "vm2", "ecosystem": "npm",
        "vulnerable_range": "<3.9.19",
        "cve_id": "CVE-2023-29199", "severity": "critical", "cvss_score": 9.8,
        "description": "Sandbox escape via Exception.prepareStackTrace allows arbitrary code execution.",
        "fix_version": "N/A — package abandoned",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-29199"],
    },
    {
        "package": "tar", "ecosystem": "npm",
        "vulnerable_range": "<6.1.9",
        "cve_id": "CVE-2021-37713", "severity": "high", "cvss_score": 8.6,
        "description": "Arbitrary file creation/overwrite and arbitrary code execution via path traversal.",
        "fix_version": "6.1.9",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-37713"],
    },
    {
        "package": "path-parse", "ecosystem": "npm",
        "vulnerable_range": "<1.0.7",
        "cve_id": "CVE-2021-23343", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted path strings.",
        "fix_version": "1.0.7",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-23343"],
    },
    {
        "package": "semver", "ecosystem": "npm",
        "vulnerable_range": "<7.5.2",
        "cve_id": "CVE-2022-25883", "severity": "medium", "cvss_score": 5.3,
        "description": "ReDoS via overly-complex version range strings.",
        "fix_version": "7.5.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-25883"],
    },
    {
        "package": "tough-cookie", "ecosystem": "npm",
        "vulnerable_range": "<4.1.3",
        "cve_id": "CVE-2023-26136", "severity": "critical", "cvss_score": 9.8,
        "description": "Prototype pollution via Cookie.parse leading to RCE in some environments.",
        "fix_version": "4.1.3",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-26136"],
    },
    {
        "package": "word-wrap", "ecosystem": "npm",
        "vulnerable_range": "<1.2.4",
        "cve_id": "CVE-2023-26115", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted string.",
        "fix_version": "1.2.4",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-26115"],
    },
    {
        "package": "fast-xml-parser", "ecosystem": "npm",
        "vulnerable_range": "<4.2.5",
        "cve_id": "CVE-2023-34104", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted XML input.",
        "fix_version": "4.2.5",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-34104"],
    },
    {
        "package": "json5", "ecosystem": "npm",
        "vulnerable_range": "<2.2.2",
        "cve_id": "CVE-2022-46175", "severity": "high", "cvss_score": 8.8,
        "description": "Prototype pollution via Parse method.",
        "fix_version": "2.2.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-46175"],
    },
    {
        "package": "qs", "ecosystem": "npm",
        "vulnerable_range": "<6.10.3",
        "cve_id": "CVE-2022-24999", "severity": "high", "cvss_score": 7.5,
        "description": "Prototype pollution via URL-encoded data.",
        "fix_version": "6.10.3",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-24999"],
    },
    {
        "package": "got", "ecosystem": "npm",
        "vulnerable_range": "<12.1.0",
        "cve_id": "CVE-2022-33987", "severity": "medium", "cvss_score": 5.3,
        "description": "Open redirect via crafted URL in redirects.",
        "fix_version": "12.1.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-33987"],
    },
    {
        "package": "glob-parent", "ecosystem": "npm",
        "vulnerable_range": "<5.1.2",
        "cve_id": "CVE-2020-28469", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted glob strings.",
        "fix_version": "5.1.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2020-28469"],
    },
    {
        "package": "nth-check", "ecosystem": "npm",
        "vulnerable_range": "<2.0.1",
        "cve_id": "CVE-2021-3803", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted CSS nth-check expressions.",
        "fix_version": "2.0.1",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-3803"],
    },
    {
        "package": "postcss", "ecosystem": "npm",
        "vulnerable_range": "<8.4.31",
        "cve_id": "CVE-2023-44270", "severity": "medium", "cvss_score": 5.3,
        "description": "Parsing error leads to incorrect CSS output when using custom properties.",
        "fix_version": "8.4.31",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-44270"],
    },
    {
        "package": "acorn", "ecosystem": "npm",
        "vulnerable_range": "<7.4.0",
        "cve_id": "CVE-2020-7598", "severity": "medium", "cvss_score": 5.6,
        "description": "ReDoS via deeply nested templates.",
        "fix_version": "7.4.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2020-7598"],
    },
    {
        "package": "electron", "ecosystem": "npm",
        "vulnerable_range": "<22.3.25",
        "cve_id": "CVE-2023-44402", "severity": "high", "cvss_score": 8.8,
        "description": "Improper handling of protocol handler allows context isolation bypass.",
        "fix_version": "22.3.25",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-44402"],
    },
    {
        "package": "socket.io-parser", "ecosystem": "npm",
        "vulnerable_range": "<4.2.3",
        "cve_id": "CVE-2023-32695", "severity": "high", "cvss_score": 7.5,
        "description": "Insufficient validation of socket.io packets allows denial-of-service.",
        "fix_version": "4.2.3",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-32695"],
    },
    {
        "package": "engine.io", "ecosystem": "npm",
        "vulnerable_range": "<6.4.2",
        "cve_id": "CVE-2023-31125", "severity": "high", "cvss_score": 7.5,
        "description": "Uncaught exception via crafted WebSocket upgrade request causes DoS.",
        "fix_version": "6.4.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-31125"],
    },
    {
        "package": "ua-parser-js", "ecosystem": "npm",
        "vulnerable_range": "<0.7.33",
        "cve_id": "CVE-2022-25927", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted user-agent strings.",
        "fix_version": "0.7.33",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-25927"],
    },
    {
        "package": "next", "ecosystem": "npm",
        "vulnerable_range": "<14.1.1",
        "cve_id": "CVE-2024-34351", "severity": "high", "cvss_score": 7.5,
        "description": "Server-Side Request Forgery via Host header manipulation in server actions.",
        "fix_version": "14.1.1",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-34351"],
    },
    {
        "package": "next", "ecosystem": "npm",
        "vulnerable_range": "<14.2.25",
        "cve_id": "CVE-2025-29927", "severity": "critical", "cvss_score": 9.1,
        "description": "Middleware auth bypass via crafted x-middleware-subrequest header.",
        "fix_version": "14.2.25",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2025-29927"],
    },
    {
        "package": "cross-spawn", "ecosystem": "npm",
        "vulnerable_range": "<7.0.5",
        "cve_id": "CVE-2024-21538", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS via crafted arguments string in Windows shell escaping.",
        "fix_version": "7.0.5",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-21538"],
    },
    {
        "package": "braces", "ecosystem": "npm",
        "vulnerable_range": "<3.0.3",
        "cve_id": "CVE-2024-4068", "severity": "high", "cvss_score": 7.5,
        "description": "Uncontrolled resource consumption via deeply-nested brace expansion.",
        "fix_version": "3.0.3",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-4068"],
    },

    # ── PyPI ─────────────────────────────────────────────────────────────────

    {
        "package": "django", "ecosystem": "pypi",
        "vulnerable_range": "<4.2.1",
        "cve_id": "CVE-2023-24580", "severity": "high", "cvss_score": 7.5,
        "description": "Potential DoS via multipart form data with large numbers of parts.",
        "fix_version": "4.2.1",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-24580"],
    },
    {
        "package": "django", "ecosystem": "pypi",
        "vulnerable_range": "<3.2.19",
        "cve_id": "CVE-2023-31047", "severity": "critical", "cvss_score": 9.8,
        "description": "File upload bypass validation allows arbitrary file write.",
        "fix_version": "3.2.19",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-31047"],
    },
    {
        "package": "pillow", "ecosystem": "pypi",
        "vulnerable_range": "<10.0.0",
        "cve_id": "CVE-2023-44271", "severity": "high", "cvss_score": 7.5,
        "description": "Uncontrolled resource consumption when parsing crafted fonts.",
        "fix_version": "10.0.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-44271"],
    },
    {
        "package": "pillow", "ecosystem": "pypi",
        "vulnerable_range": "<9.3.0",
        "cve_id": "CVE-2022-45198", "severity": "high", "cvss_score": 7.5,
        "description": "Heap buffer overflow in PIL ImagePath module.",
        "fix_version": "9.3.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-45198"],
    },
    {
        "package": "requests", "ecosystem": "pypi",
        "vulnerable_range": "<2.31.0",
        "cve_id": "CVE-2023-32681", "severity": "medium", "cvss_score": 6.1,
        "description": "Proxy-Authorization header leaked to destination after redirect.",
        "fix_version": "2.31.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-32681"],
    },
    {
        "package": "cryptography", "ecosystem": "pypi",
        "vulnerable_range": "<41.0.0",
        "cve_id": "CVE-2023-38325", "severity": "high", "cvss_score": 7.5,
        "description": "NULL pointer dereference in PKCS12 parsing leading to DoS.",
        "fix_version": "41.0.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-38325"],
    },
    {
        "package": "paramiko", "ecosystem": "pypi",
        "vulnerable_range": "<3.4.0",
        "cve_id": "CVE-2023-48795", "severity": "medium", "cvss_score": 5.9,
        "description": "Terrapin attack — SSH prefix truncation weakens transport security.",
        "fix_version": "3.4.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-48795"],
    },
    {
        "package": "pyyaml", "ecosystem": "pypi",
        "vulnerable_range": "<6.0.1",
        "cve_id": "CVE-2020-1747", "severity": "critical", "cvss_score": 9.8,
        "description": "Remote code execution via yaml.load() with untrusted input and default Loader.",
        "fix_version": "6.0.1",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2020-1747"],
    },
    {
        "package": "lxml", "ecosystem": "pypi",
        "vulnerable_range": "<4.9.3",
        "cve_id": "CVE-2022-2309", "severity": "high", "cvss_score": 7.5,
        "description": "NULL pointer dereference in lxml.etree.clean_html() leads to DoS.",
        "fix_version": "4.9.3",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-2309"],
    },
    {
        "package": "aiohttp", "ecosystem": "pypi",
        "vulnerable_range": "<3.9.2",
        "cve_id": "CVE-2024-23334", "severity": "high", "cvss_score": 7.5,
        "description": "Path traversal via FollowSymlinks in static file serving.",
        "fix_version": "3.9.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-23334"],
    },
    {
        "package": "werkzeug", "ecosystem": "pypi",
        "vulnerable_range": "<3.0.1",
        "cve_id": "CVE-2023-46136", "severity": "high", "cvss_score": 7.5,
        "description": "DoS via crafted multipart/form-data boundary in request parsing.",
        "fix_version": "3.0.1",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-46136"],
    },
    {
        "package": "jinja2", "ecosystem": "pypi",
        "vulnerable_range": "<3.1.3",
        "cve_id": "CVE-2024-22195", "severity": "medium", "cvss_score": 5.4,
        "description": "XSS via xmlattr filter — keys not escaped in HTML attributes.",
        "fix_version": "3.1.3",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-22195"],
    },
    {
        "package": "flask", "ecosystem": "pypi",
        "vulnerable_range": "<3.0.2",
        "cve_id": "CVE-2023-30861", "severity": "high", "cvss_score": 7.5,
        "description": "Session cookie accessible to sub-domains when SESSION_COOKIE_DOMAIN is not set.",
        "fix_version": "3.0.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-30861"],
    },
    {
        "package": "sqlalchemy", "ecosystem": "pypi",
        "vulnerable_range": "<2.0.21",
        "cve_id": "CVE-2023-30608", "severity": "medium", "cvss_score": 5.5,
        "description": "SQL injection risk in aiosqlite dialect via crafted column names.",
        "fix_version": "2.0.21",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-30608"],
    },
    {
        "package": "twisted", "ecosystem": "pypi",
        "vulnerable_range": "<23.10.0",
        "cve_id": "CVE-2023-46137", "severity": "medium", "cvss_score": 5.3,
        "description": "HTTP/1.1 header injection via crafted persistence responses.",
        "fix_version": "23.10.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-46137"],
    },
    {
        "package": "numpy", "ecosystem": "pypi",
        "vulnerable_range": "<1.24.0",
        "cve_id": "CVE-2021-41495", "severity": "medium", "cvss_score": 5.5,
        "description": "NULL pointer dereference in numpy.sort via crafted arrays.",
        "fix_version": "1.24.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-41495"],
    },
    {
        "package": "scipy", "ecosystem": "pypi",
        "vulnerable_range": "<1.9.2",
        "cve_id": "CVE-2023-25399", "severity": "medium", "cvss_score": 5.5,
        "description": "Use-after-free in MMI_data_set via scipy.spatial.KDTree.",
        "fix_version": "1.9.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-25399"],
    },

    # ── Maven (Java) ─────────────────────────────────────────────────────────

    {
        "package": "log4j-core", "ecosystem": "maven",
        "vulnerable_range": ">=2.0.0,<2.17.1",
        "cve_id": "CVE-2021-44228", "severity": "critical", "cvss_score": 10.0,
        "description": "Log4Shell: JNDI injection via user-controlled log messages enables RCE.",
        "fix_version": "2.17.1",
        "references": [
            "https://nvd.nist.gov/vuln/detail/CVE-2021-44228",
            "https://logging.apache.org/log4j/2.x/security.html",
        ],
    },
    {
        "package": "log4j-core", "ecosystem": "maven",
        "vulnerable_range": ">=2.0.0,<2.12.2",
        "cve_id": "CVE-2021-45046", "severity": "critical", "cvss_score": 9.0,
        "description": "Incomplete fix for CVE-2021-44228; JNDI injection still possible in non-default configs.",
        "fix_version": "2.12.2",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-45046"],
    },
    {
        "package": "spring-core", "ecosystem": "maven",
        "vulnerable_range": ">=5.3.0,<5.3.18",
        "cve_id": "CVE-2022-22965", "severity": "critical", "cvss_score": 9.8,
        "description": "Spring4Shell: RCE via data binding on JDK 9+ with ClassLoader access.",
        "fix_version": "5.3.18",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-22965"],
    },
    {
        "package": "jackson-databind", "ecosystem": "maven",
        "vulnerable_range": "<2.14.0",
        "cve_id": "CVE-2022-42004", "severity": "high", "cvss_score": 7.5,
        "description": "DoS via deeply nested JSON with UNWRAP_SINGLE_VALUE_ARRAYS.",
        "fix_version": "2.14.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-42004"],
    },
    {
        "package": "xstream", "ecosystem": "maven",
        "vulnerable_range": "<1.4.20",
        "cve_id": "CVE-2022-40151", "severity": "high", "cvss_score": 7.5,
        "description": "DoS via stack overflow from crafted XML with deeply nested elements.",
        "fix_version": "1.4.20",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-40151"],
    },
    {
        "package": "commons-text", "ecosystem": "maven",
        "vulnerable_range": ">=1.5,<1.10.0",
        "cve_id": "CVE-2022-42889", "severity": "critical", "cvss_score": 9.8,
        "description": "Text4Shell: RCE via script/dns/url variable interpolation in StringSubstitutor.",
        "fix_version": "1.10.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2022-42889"],
    },
    {
        "package": "struts2-core", "ecosystem": "maven",
        "vulnerable_range": ">=2.0.0,<2.5.33",
        "cve_id": "CVE-2023-50164", "severity": "critical", "cvss_score": 9.8,
        "description": "File upload path traversal leads to RCE via Action parameter manipulation.",
        "fix_version": "2.5.33",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-50164"],
    },

    # ── Go ───────────────────────────────────────────────────────────────────

    {
        "package": "github.com/gin-gonic/gin", "ecosystem": "go",
        "vulnerable_range": "<1.9.1",
        "cve_id": "CVE-2023-29401", "severity": "medium", "cvss_score": 4.3,
        "description": "Filename sanitisation bypass in Multipart allows path traversal.",
        "fix_version": "1.9.1",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-29401"],
    },
    {
        "package": "github.com/labstack/echo/v4", "ecosystem": "go",
        "vulnerable_range": "<4.11.4",
        "cve_id": "CVE-2024-28122", "severity": "high", "cvss_score": 8.1,
        "description": "Open redirect via crafted JWT claims when using WithRedirect middleware.",
        "fix_version": "4.11.4",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-28122"],
    },
    {
        "package": "github.com/gofiber/fiber/v2", "ecosystem": "go",
        "vulnerable_range": "<2.52.1",
        "cve_id": "CVE-2024-25124", "severity": "high", "cvss_score": 7.4,
        "description": "CORS wildcard origin with AllowCredentials leads to cross-site data exposure.",
        "fix_version": "2.52.1",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-25124"],
    },
    {
        "package": "golang.org/x/net", "ecosystem": "go",
        "vulnerable_range": "<0.17.0",
        "cve_id": "CVE-2023-44487", "severity": "high", "cvss_score": 7.5,
        "description": "HTTP/2 Rapid Reset Attack enabling large-scale DDoS.",
        "fix_version": "0.17.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-44487"],
    },
    {
        "package": "golang.org/x/crypto", "ecosystem": "go",
        "vulnerable_range": "<0.17.0",
        "cve_id": "CVE-2023-48795", "severity": "medium", "cvss_score": 5.9,
        "description": "Terrapin attack — SSH prefix truncation in golang.org/x/crypto/ssh.",
        "fix_version": "0.17.0",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-48795"],
    },

    # ── RubyGems ─────────────────────────────────────────────────────────────

    {
        "package": "rails", "ecosystem": "rubygems",
        "vulnerable_range": "<7.0.8",
        "cve_id": "CVE-2023-38037", "severity": "medium", "cvss_score": 5.9,
        "description": "File disclosure via specially crafted ActiveStorage signed IDs.",
        "fix_version": "7.0.8",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-38037"],
    },
    {
        "package": "rails", "ecosystem": "rubygems",
        "vulnerable_range": "<6.1.7.6",
        "cve_id": "CVE-2023-22792", "severity": "high", "cvss_score": 7.5,
        "description": "ReDoS in Action Dispatch header parsing.",
        "fix_version": "6.1.7.6",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-22792"],
    },
    {
        "package": "nokogiri", "ecosystem": "rubygems",
        "vulnerable_range": "<1.15.4",
        "cve_id": "CVE-2023-35783", "severity": "high", "cvss_score": 7.5,
        "description": "Integer overflow via crafted XML document leading to DoS or RCE.",
        "fix_version": "1.15.4",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2023-35783"],
    },
]


# ---------------------------------------------------------------------------
# Dependency-file parsers
# ---------------------------------------------------------------------------

#: Patterns for parsing common dependency file formats.
#: Each entry: (ecosystem, regex capturing (package, version))
_DEP_FILE_PARSERS: dict[str, list[re.Pattern[str]]] = {
    "npm": [
        # package.json: "package": "^1.2.3"
        re.compile(r'"([a-zA-Z0-9@/_.-]+)"\s*:\s*"([~^>=<*| a-zA-Z0-9._-]+)"'),
        # package-lock.json / npm-shrinkwrap: "version": "1.2.3"
        re.compile(r'"version"\s*:\s*"([0-9][0-9._-]*)"'),
    ],
    "pypi": [
        # requirements.txt: package==1.2.3 / package>=1.0,<2.0
        re.compile(r"^([A-Za-z0-9_.-]+)\s*([><=!~^]{1,2}[0-9][^;\s#]*)?", re.MULTILINE),
    ],
    "maven": [
        # pom.xml: <artifactId>log4j-core</artifactId> ... <version>2.14.0</version>
        re.compile(r"<artifactId>([^<]+)</artifactId>", re.MULTILINE),
    ],
    "go": [
        # go.mod: require github.com/gin-gonic/gin v1.9.0
        re.compile(r"^\s*([a-zA-Z0-9./_-]+)\s+v([0-9][0-9._-]*)", re.MULTILINE),
    ],
    "rubygems": [
        # Gemfile: gem 'rails', '~> 7.0'
        re.compile(r"""gem\s+['"]([A-Za-z0-9_-]+)['"]\s*,?\s*['"]?([~><=!]{0,2}\s*[0-9][^'"#\n]*)?['"]?"""),
    ],
}


def _parse_dependencies(dependency_text: str, ecosystem: str) -> list[tuple[str, str]]:
    """Extract (package_name, version_string) tuples from *dependency_text*.

    Parameters
    ----------
    dependency_text:
        Raw contents of a dependency file (package.json, requirements.txt, etc.).
    ecosystem:
        One of: npm, pypi, maven, go, rubygems.

    Returns
    -------
    list[tuple[str, str]]
        List of (name, version) pairs. Version may be empty string if not found.
    """
    parsers = _DEP_FILE_PARSERS.get(ecosystem, [])
    results: list[tuple[str, str]] = []
    for pattern in parsers:
        for m in pattern.finditer(dependency_text):
            groups = m.groups()
            if len(groups) >= 2 and groups[0] and groups[1]:
                name = groups[0].strip().lower()
                version = groups[1].strip().strip("^~>=<! ")
                results.append((name, version))
            elif len(groups) >= 1 and groups[0]:
                results.append((groups[0].strip().lower(), ""))
    return results


def detect_vulnerable_packages(dependency_text: str, ecosystem: str) -> list[dict]:
    """Parse *dependency_text* and cross-reference against :data:`PACKAGE_VULNERABILITIES`.

    Parameters
    ----------
    dependency_text:
        Raw contents of a dependency manifest (package.json, requirements.txt,
        pom.xml, go.mod, Gemfile, etc.).
    ecosystem:
        Package ecosystem identifier: ``npm``, ``pypi``, ``maven``, ``go``, or
        ``rubygems``.

    Returns
    -------
    list[dict]
        Each dict: package, version_spec, cve_id, severity, cvss_score,
        description, fix_version, references.
        Sorted by cvss_score descending.
    """
    declared = _parse_dependencies(dependency_text, ecosystem)
    if not declared:
        return []

    # Build a fast lookup: package_name → [(vuln_entry, ...)]
    vuln_index: dict[str, list[dict]] = {}
    for entry in PACKAGE_VULNERABILITIES:
        if entry["ecosystem"] != ecosystem:
            continue
        key = entry["package"].lower()
        vuln_index.setdefault(key, []).append(entry)

    findings: list[dict] = []

    for package_name, version_spec in declared:
        vulns = vuln_index.get(package_name, [])
        for vuln in vulns:
            if not version_spec:
                # Version unknown — report as informational
                findings.append({
                    "package":       package_name,
                    "version_spec":  "unknown",
                    "cve_id":        vuln["cve_id"],
                    "severity":      vuln["severity"],
                    "cvss_score":    vuln["cvss_score"],
                    "description":   vuln["description"],
                    "fix_version":   vuln["fix_version"],
                    "references":    vuln["references"],
                    "version_confirmed": False,
                })
                continue

            if is_version_vulnerable(version_spec, vuln["vulnerable_range"]):
                findings.append({
                    "package":       package_name,
                    "version_spec":  version_spec,
                    "cve_id":        vuln["cve_id"],
                    "severity":      vuln["severity"],
                    "cvss_score":    vuln["cvss_score"],
                    "description":   vuln["description"],
                    "fix_version":   vuln["fix_version"],
                    "references":    vuln["references"],
                    "version_confirmed": True,
                })

    findings.sort(key=lambda x: x["cvss_score"], reverse=True)
    return findings


# ---------------------------------------------------------------------------
# Code-pattern CVE signatures (augments vuln_patterns.py)
# ---------------------------------------------------------------------------

#: Code-pattern-based rules tied to specific CVEs.
#: Schema mirrors VULN_PATTERNS in vuln_patterns.py for drop-in use.
CVE_PATTERNS: list[dict] = [

    # Log4Shell (CVE-2021-44228) indicator — usage of PatternLayout with user data
    {
        "id": "cve-2021-44228-log4shell-sink",
        "pattern": r"(?i)logger\.(info|warn|error|debug|fatal|trace)\s*\(\s*.*request\.",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2021-44228",
        "description": "Log4Shell sink: user-controlled data passed to Log4j logger in {file}. Upgrade log4j-core to >=2.17.1.",
        "suggestion": "Upgrade log4j-core to 2.17.1+. Set log4j2.formatMsgNoLookups=true as a stopgap.",
        "confidence": 0.70,
        "tags": ["OWASP:A03", "CWE-20"],
    },
    # Spring4Shell (CVE-2022-22965) — @RequestMapping with non-primitive model binding
    {
        "id": "cve-2022-22965-spring4shell",
        "pattern": r"@RequestMapping.+\n.{0,200}(@ModelAttribute|Model\s+model)",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2022-22965",
        "description": "Spring4Shell pattern: data binding may expose ClassLoader on JDK 9+. Upgrade spring-core >=5.3.18.",
        "suggestion": "Upgrade Spring Framework to 5.3.18+ or 5.2.20+. Apply WAF rule blocking 'class.classLoader' param.",
        "confidence": 0.65,
        "tags": ["OWASP:A03", "CWE-94"],
    },
    # PyYAML unsafe load (CVE-2020-1747)
    {
        "id": "cve-2020-1747-pyyaml-load",
        "pattern": r"yaml\.load\s*\([^)]*\)",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2020-1747",
        "description": "yaml.load() called without safe Loader in {file}. Arbitrary code execution on untrusted YAML.",
        "suggestion": "Replace with yaml.safe_load() or yaml.load(data, Loader=yaml.SafeLoader).",
        "confidence": 0.92,
        "tags": ["OWASP:A03", "CWE-502"],
    },
    # node-serialize deserialise (CVE-2017-5941)
    {
        "id": "cve-2017-5941-node-serialize",
        "pattern": r"(?:require\(['\"]node-serialize['\"]|serialize\.unserialize)\s*\(",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2017-5941",
        "description": "node-serialize.unserialize() with untrusted input allows RCE via IIFEs.",
        "suggestion": "Stop using node-serialize. Use JSON.parse() with schema validation instead.",
        "confidence": 0.95,
        "tags": ["OWASP:A08", "CWE-502"],
    },
    # vm2 sandbox escape (CVE-2023-29199)
    {
        "id": "cve-2023-29199-vm2",
        "pattern": r"(?:require\(['\"]vm2['\"]|new\s+VM\s*\(|new\s+NodeVM\s*\()",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2023-29199",
        "description": "vm2 usage detected in {file}. vm2 has unpatched sandbox escapes; package is abandoned.",
        "suggestion": "Replace vm2 with isolated-vm or run untrusted code in a separate process/container.",
        "confidence": 0.88,
        "tags": ["OWASP:A03", "CWE-94"],
    },
    # handlebars template injection (CVE-2021-23369)
    {
        "id": "cve-2021-23369-handlebars-compile",
        "pattern": r"(?:Handlebars\.compile|hbs\.compile)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.)",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2021-23369",
        "description": "Handlebars template compiled from user input in {file} — RCE via prototype pollution.",
        "suggestion": "Never compile user-supplied strings as Handlebars templates. Upgrade to >=4.7.7.",
        "confidence": 0.90,
        "tags": ["OWASP:A03", "CWE-94"],
    },
    # jsonwebtoken algorithm confusion (CVE-2022-23529)
    {
        "id": "cve-2022-23529-jwt-none-alg",
        "pattern": r"jwt\.verify\s*\([^)]*algorithms\s*:\s*\[[^\]]*['\"]none['\"]",
        "severity": "critical", "category": "auth",
        "cve_id": "CVE-2022-23529",
        "description": "JWT verified with 'none' algorithm allowed in {file}. Tokens can be forged.",
        "suggestion": "Remove 'none' from the algorithms list. Upgrade jsonwebtoken to >=9.0.0.",
        "confidence": 0.97,
        "tags": ["OWASP:A02", "CWE-347"],
    },
    # Next.js middleware bypass (CVE-2025-29927)
    {
        "id": "cve-2025-29927-nextjs-middleware-bypass",
        "pattern": r"x-middleware-subrequest",
        "severity": "critical", "category": "auth",
        "cve_id": "CVE-2025-29927",
        "description": "x-middleware-subrequest header reference in {file}. May indicate or test for Next.js auth bypass.",
        "suggestion": "Upgrade Next.js to >=14.2.25. Strip this header at your edge/load balancer.",
        "confidence": 0.80,
        "tags": ["OWASP:A01", "CWE-288"],
    },
    # XStream deserialisation (CVE-2022-40151)
    {
        "id": "cve-2022-40151-xstream-fromxml",
        "pattern": r"xstream\.fromXML\s*\(",
        "severity": "high", "category": "injection",
        "cve_id": "CVE-2022-40151",
        "description": "XStream.fromXML() with untrusted input in {file} is vulnerable to DoS / code execution.",
        "suggestion": "Enable XStream security framework: xstream.addPermission(...). Upgrade to >=1.4.20.",
        "confidence": 0.85,
        "tags": ["OWASP:A08", "CWE-502"],
    },
    # commons-text interpolation (CVE-2022-42889 / Text4Shell)
    {
        "id": "cve-2022-42889-text4shell",
        "pattern": r"StringSubstitutor\.replace\s*\(",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2022-42889",
        "description": "Text4Shell: StringSubstitutor.replace() with user data in {file} enables RCE via ${script:...}.",
        "suggestion": "Upgrade commons-text to >=1.10.0. Disable interpolation: new StringSubstitutor(map, '', '', (char)0).",
        "confidence": 0.88,
        "tags": ["OWASP:A03", "CWE-94"],
    },
    # CVE-2023-26136 tough-cookie prototype pollution
    {
        "id": "cve-2023-26136-tough-cookie",
        "pattern": r"(?:CookieJar|Cookie\.parse)\s*\(.+__proto__",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2023-26136",
        "description": "Possible tough-cookie prototype pollution vector in {file}.",
        "suggestion": "Upgrade tough-cookie to >=4.1.3.",
        "confidence": 0.72,
        "tags": ["OWASP:A03", "CWE-1321"],
    },
    # CVE-2022-46175 json5 prototype pollution
    {
        "id": "cve-2022-46175-json5-parse",
        "pattern": r"JSON5\.parse\s*\(",
        "severity": "high", "category": "injection",
        "cve_id": "CVE-2022-46175",
        "description": "JSON5.parse() usage in {file}. Versions <2.2.2 are vulnerable to prototype pollution.",
        "suggestion": "Upgrade json5 to >=2.2.2.",
        "confidence": 0.70,
        "tags": ["OWASP:A03", "CWE-1321"],
    },
    # CVE-2021-44906 minimist prototype pollution
    {
        "id": "cve-2021-44906-minimist",
        "pattern": r"require\(['\"]minimist['\"]\)",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2021-44906",
        "description": "minimist usage in {file}. Versions <1.2.6 allow prototype pollution via constructor/__proto__.",
        "suggestion": "Upgrade minimist to >=1.2.6 or replace with yargs-parser.",
        "confidence": 0.75,
        "tags": ["OWASP:A03", "CWE-1321"],
    },
    # CVE-2023-48795 Terrapin SSH
    {
        "id": "cve-2023-48795-terrapin-ssh",
        "pattern": r"(?i)ssh\.(?:connect|exec|shell)\s*\(",
        "severity": "medium", "category": "crypto",
        "cve_id": "CVE-2023-48795",
        "description": "SSH connection in {file}. If using paramiko <3.4.0 or golang.org/x/crypto <0.17.0, Terrapin attack applies.",
        "suggestion": "Upgrade SSH libraries to patched versions. Disable ChaCha20-Poly1305 and CBC+HMAC-ETM if necessary.",
        "confidence": 0.60,
        "tags": ["OWASP:A02", "CWE-354"],
    },
    # CVE-2024-34351 Next.js SSRF via Host header
    {
        "id": "cve-2024-34351-nextjs-host-ssrf",
        "pattern": r"headers\(\)\s*\.get\s*\(['\"]host['\"]",
        "severity": "high", "category": "ssrf",
        "cve_id": "CVE-2024-34351",
        "description": "Host header read in a Server Action in {file}. Next.js <14.1.1 is vulnerable to SSRF.",
        "suggestion": "Upgrade Next.js to >=14.1.1. Validate Host header against an allowlist.",
        "confidence": 0.75,
        "tags": ["OWASP:A10", "CWE-918"],
    },
    # CVE-2023-32681 requests header leak
    {
        "id": "cve-2023-32681-requests-redirect-header-leak",
        "pattern": r"requests\.(get|post|put|patch|delete)\s*\(.+allow_redirects\s*=\s*True",
        "severity": "medium", "category": "secrets",
        "cve_id": "CVE-2023-32681",
        "description": "requests with allow_redirects=True in {file}. Versions <2.31.0 leak Proxy-Authorization on redirects.",
        "suggestion": "Upgrade requests to >=2.31.0.",
        "confidence": 0.65,
        "tags": ["OWASP:A02", "CWE-200"],
    },
    # CVE-2024-23334 aiohttp path traversal
    {
        "id": "cve-2024-23334-aiohttp-static",
        "pattern": r"(?:app\.router\.add_static|web\.static)\s*\(.+follow_symlinks\s*=\s*True",
        "severity": "high", "category": "path-traversal",
        "cve_id": "CVE-2024-23334",
        "description": "aiohttp static file serving with follow_symlinks=True in {file}. Versions <3.9.2 allow path traversal.",
        "suggestion": "Upgrade aiohttp to >=3.9.2 and remove follow_symlinks=True.",
        "confidence": 0.88,
        "tags": ["OWASP:A01", "CWE-22"],
    },
    # CVE-2023-30861 Flask session cookie sub-domain leak
    {
        "id": "cve-2023-30861-flask-session-domain",
        "pattern": r"(?i)SESSION_COOKIE_DOMAIN\s*=\s*None",
        "severity": "high", "category": "auth",
        "cve_id": "CVE-2023-30861",
        "description": "Flask SESSION_COOKIE_DOMAIN=None in {file}. Versions <3.0.2 allow sub-domain cookie theft.",
        "suggestion": "Upgrade Flask to >=3.0.2 and explicitly set SESSION_COOKIE_DOMAIN.",
        "confidence": 0.82,
        "tags": ["OWASP:A07", "CWE-614"],
    },
    # CVE-2024-22195 Jinja2 xmlattr XSS
    {
        "id": "cve-2024-22195-jinja2-xmlattr-xss",
        "pattern": r"\|\s*xmlattr\b",
        "severity": "medium", "category": "xss",
        "cve_id": "CVE-2024-22195",
        "description": "Jinja2 xmlattr filter used in {file}. Versions <3.1.3 do not escape attribute keys — XSS risk.",
        "suggestion": "Upgrade Jinja2 to >=3.1.3.",
        "confidence": 0.80,
        "tags": ["OWASP:A03", "CWE-80"],
    },
    # CVE-2023-44487 HTTP/2 Rapid Reset — Go net/http
    {
        "id": "cve-2023-44487-http2-rapid-reset",
        "pattern": r"(?i)http2\.(?:ConfigureServer|ListenAndServeTLS|Serve)",
        "severity": "high", "category": "dos",
        "cve_id": "CVE-2023-44487",
        "description": "HTTP/2 server setup in {file}. Go <1.21.3 is vulnerable to HTTP/2 Rapid Reset DoS.",
        "suggestion": "Upgrade Go to >=1.21.3 and golang.org/x/net to >=0.17.0.",
        "confidence": 0.68,
        "tags": ["OWASP:A05", "CWE-400"],
    },
    # CVE-2025-29927 duplicate check — x-middleware-subrequest in headers config
    {
        "id": "cve-2025-29927-header-strip-missing",
        "pattern": r"(?i)(?:headers|middleware).{0,60}x-middleware-subrequest",
        "severity": "critical", "category": "auth",
        "cve_id": "CVE-2025-29927",
        "description": "x-middleware-subrequest handling in {file}. Ensure this header is stripped before it reaches Next.js middleware.",
        "suggestion": "Add header stripping at the reverse proxy level and upgrade Next.js to >=14.2.25.",
        "confidence": 0.78,
        "tags": ["OWASP:A01", "CWE-288"],
    },
    # CVE-2022-22965 Spring — ClassLoader access in request mapping
    {
        "id": "cve-2022-22965-classloader-param",
        "pattern": r"(?i)class\.classLoader|class\[classLoader\]|class\.module\.classLoader",
        "severity": "critical", "category": "injection",
        "cve_id": "CVE-2022-22965",
        "description": "ClassLoader access via HTTP parameter string in {file} — classic Spring4Shell indicator.",
        "suggestion": "Block this parameter at WAF. Upgrade Spring Framework to >=5.3.18.",
        "confidence": 0.95,
        "tags": ["OWASP:A03", "CWE-94"],
    },
]


# ---------------------------------------------------------------------------
# Zero-day / emerging vulnerability class indicators
# ---------------------------------------------------------------------------

#: Heuristic patterns suggesting code that may be vulnerable to newly-discovered
#: vulnerability classes, even before specific CVEs exist.
ZERO_DAY_INDICATORS: list[dict] = [

    # ── Prototype Pollution ───────────────────────────────────────────────────
    {
        "id": "zdai-prototype-pollution-assign",
        "pattern": r"Object\.assign\s*\(\s*(?:target|obj|dest|config|options|{})\s*,\s*(?:req\.|request\.|params\.|query\.|body\.|user\.)",
        "category": "prototype-pollution",
        "description": "Object.assign() merges user-controlled data — prototype pollution if input contains __proto__ or constructor.",
        "suggestion": "Sanitise input before merging. Use structuredClone() or deep-clone with prototype stripping.",
        "severity": "high", "confidence": 0.75,
        "tags": ["CWE-1321"],
    },
    {
        "id": "zdai-prototype-pollution-spread",
        "pattern": r"\.\.\.\s*(?:req\.|request\.|params\.|query\.|body\.)\w+",
        "category": "prototype-pollution",
        "description": "Object spread from request data may introduce prototype pollution.",
        "suggestion": "Validate and sanitise request data before spreading into objects.",
        "severity": "medium", "confidence": 0.60,
        "tags": ["CWE-1321"],
    },
    {
        "id": "zdai-prototype-pollution-deep-merge",
        "pattern": r"(?:merge|deepMerge|deepAssign|extend|defaults)\s*\(\s*(?:{}|target),",
        "category": "prototype-pollution",
        "description": "Deep-merge utility with potentially user-controlled source. Vulnerable if not hardened.",
        "suggestion": "Ensure the merge library used filters __proto__ and constructor keys.",
        "severity": "medium", "confidence": 0.58,
        "tags": ["CWE-1321"],
    },

    # ── SSRF ─────────────────────────────────────────────────────────────────
    {
        "id": "zdai-ssrf-fetch-user-url",
        "pattern": r"(?:fetch|axios\.get|axios\.post|http\.get|https\.get|requests\.get)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.)\w+",
        "category": "ssrf",
        "description": "HTTP request made to a user-supplied URL — Server-Side Request Forgery risk.",
        "suggestion": "Validate the URL against an allowlist. Block private IP ranges (169.254.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x, ::1).",
        "severity": "high", "confidence": 0.80,
        "tags": ["OWASP:A10", "CWE-918"],
    },
    {
        "id": "zdai-ssrf-dns-lookup",
        "pattern": r"dns\.(?:lookup|resolve)\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.)",
        "category": "ssrf",
        "description": "DNS lookup on user-controlled hostname — DNS rebinding or SSRF via DNS.",
        "suggestion": "Validate hostnames before DNS resolution. Avoid resolving user-supplied FQDNs server-side.",
        "severity": "high", "confidence": 0.78,
        "tags": ["OWASP:A10", "CWE-918"],
    },

    # ── Deserialisation ───────────────────────────────────────────────────────
    {
        "id": "zdai-deserialise-pickle",
        "pattern": r"pickle\.loads?\s*\(",
        "category": "deserialisation",
        "description": "pickle.load/loads() is inherently unsafe on untrusted data — arbitrary code execution.",
        "suggestion": "Never deserialise untrusted data with pickle. Use JSON, msgpack, or protobuf with schema validation.",
        "severity": "critical", "confidence": 0.90,
        "tags": ["OWASP:A08", "CWE-502"],
    },
    {
        "id": "zdai-deserialise-java-objectinputstream",
        "pattern": r"new ObjectInputStream\s*\(",
        "category": "deserialisation",
        "description": "Java ObjectInputStream deserialisation — unsafe on untrusted data, leads to RCE.",
        "suggestion": "Use a serialisation filter (JEP 290). Consider replacing with JSON or Protobuf.",
        "severity": "critical", "confidence": 0.85,
        "tags": ["OWASP:A08", "CWE-502"],
    },
    {
        "id": "zdai-deserialise-php-unserialize",
        "pattern": r"\bunserialize\s*\(",
        "category": "deserialisation",
        "description": "PHP unserialize() with untrusted data leads to object injection / RCE.",
        "suggestion": "Use json_decode() instead. If unserialize() is required, use allowed_classes option.",
        "severity": "critical", "confidence": 0.88,
        "tags": ["OWASP:A08", "CWE-502"],
    },
    {
        "id": "zdai-deserialise-ruby-marshal-load",
        "pattern": r"Marshal\.load\s*\(",
        "category": "deserialisation",
        "description": "Ruby Marshal.load() on untrusted data allows arbitrary code execution.",
        "suggestion": "Replace with JSON.parse or a safe serialisation library.",
        "severity": "critical", "confidence": 0.88,
        "tags": ["OWASP:A08", "CWE-502"],
    },

    # ── Template Injection ────────────────────────────────────────────────────
    {
        "id": "zdai-ssti-jinja2-from-string",
        "pattern": r"(?:Environment\(\)|jinja2\.Template)\s*\(\s*(?:request\.|req\.|user_input|template_str)",
        "category": "ssti",
        "description": "Jinja2 Template() instantiated from user-controlled string — Server-Side Template Injection.",
        "suggestion": "Never compile user input as a template. Use Jinja2's sandboxed environment if dynamic templates are required.",
        "severity": "critical", "confidence": 0.88,
        "tags": ["OWASP:A03", "CWE-94"],
    },
    {
        "id": "zdai-ssti-pebble-eval",
        "pattern": r"PebbleTemplate.*evaluate\s*\(",
        "category": "ssti",
        "description": "Pebble template evaluation — may be vulnerable to SSTI if template is user-controlled.",
        "suggestion": "Ensure template source is not user-controlled. Use static template files only.",
        "severity": "high", "confidence": 0.70,
        "tags": ["OWASP:A03", "CWE-94"],
    },

    # ── Supply-Chain ─────────────────────────────────────────────────────────
    {
        "id": "zdai-supply-chain-postinstall",
        "pattern": r'"postinstall"\s*:\s*"(?!.*node\s+scripts/)[^"]{10,}"',
        "category": "supply-chain",
        "description": "Non-standard postinstall script in package.json may execute arbitrary commands during npm install.",
        "suggestion": "Audit postinstall scripts carefully. Run npm install with --ignore-scripts in CI.",
        "severity": "high", "confidence": 0.72,
        "tags": ["OWASP:A08", "CWE-829"],
    },
    {
        "id": "zdai-supply-chain-curl-pipe-sh",
        "pattern": r"curl.+\|\s*(?:bash|sh|zsh|fish)",
        "category": "supply-chain",
        "description": "curl | shell pattern detected — downloads and executes remote code without integrity check.",
        "suggestion": "Download the script first, verify its checksum, then execute. Use package managers instead.",
        "severity": "high", "confidence": 0.85,
        "tags": ["OWASP:A08", "CWE-494"],
    },
    {
        "id": "zdai-supply-chain-dynamic-require",
        "pattern": r"require\s*\(\s*(?:req\.|request\.|params\.|query\.|body\.)\w+",
        "category": "supply-chain",
        "description": "Dynamic require() with user-controlled module name — allows arbitrary module loading.",
        "suggestion": "Validate the module name against a strict allowlist before require().",
        "severity": "critical", "confidence": 0.88,
        "tags": ["OWASP:A08", "CWE-829"],
    },

    # ── ReDoS ─────────────────────────────────────────────────────────────────
    {
        "id": "zdai-redos-catastrophic-backtrack",
        "pattern": r"(?:new RegExp|re\.compile)\s*\([^)]*(?:\.\*|\.\+){2,}",
        "category": "redos",
        "description": "Dynamically constructed regex with nested quantifiers — potential ReDoS.",
        "suggestion": "Use a linear-time regex engine or bound quantifiers. Validate regex complexity statically.",
        "severity": "medium", "confidence": 0.65,
        "tags": ["OWASP:A05", "CWE-1333"],
    },

    # ── Crypto Weaknesses ─────────────────────────────────────────────────────
    {
        "id": "zdai-weak-rng-math-random",
        "pattern": r"Math\.random\s*\(\s*\).*(?:token|secret|key|password|nonce|salt|otp|csrf)",
        "category": "crypto",
        "description": "Math.random() used for security-sensitive value — not cryptographically secure.",
        "suggestion": "Use crypto.randomBytes() (Node.js) or crypto.getRandomValues() (browser).",
        "severity": "high", "confidence": 0.82,
        "tags": ["OWASP:A02", "CWE-338"],
    },
    {
        "id": "zdai-weak-hash-md5-sha1",
        "pattern": r"(?i)(?:createHash|hashlib\.new|MessageDigest\.getInstance)\s*\(['\"](?:md5|sha1|sha-1)['\"]",
        "category": "crypto",
        "description": "Weak hash algorithm (MD5/SHA-1) used in {file}. Collision attacks are practical.",
        "suggestion": "Replace with SHA-256 or SHA-3. For passwords, use bcrypt/argon2/scrypt.",
        "severity": "medium", "confidence": 0.88,
        "tags": ["OWASP:A02", "CWE-327"],
    },
    {
        "id": "zdai-ecb-mode",
        "pattern": r"(?i)(?:AES|DES|Cipher).*ECB|createCipheriv\s*\(['\"](?:aes-\d+-ecb|des-ecb)['\"]",
        "category": "crypto",
        "description": "ECB cipher mode detected in {file}. ECB is deterministic and leaks patterns.",
        "suggestion": "Use AES-GCM (authenticated) or AES-CBC with a random IV. Never use ECB for sensitive data.",
        "severity": "high", "confidence": 0.87,
        "tags": ["OWASP:A02", "CWE-327"],
    },
]
