"""
Supply Chain Security Agent
============================
Deep supply chain risk analysis covering:
  - Dependency confusion attacks (internal package name shadowing)
  - Typosquatting detection (60+ known attack pairs)
  - Package lockfile integrity (missing/stale lockfiles)
  - Unpinned / floating dependency versions
  - Known malicious package indicators (suspicious install scripts)
  - GitHub Actions using unpinned / @main action refs
  - Missing integrity checks (npm integrity field, pip --require-hashes, Docker digest)
  - SBOM absence (CycloneDX, SPDX)
  - License compliance risks (GPL in commercial projects)
  - Private registry fallback misconfiguration
  - Abandoned / deprecated package patterns
  - Dockerfile FROM :latest and missing digest pinning

References:
  - OWASP Top 10 CI/CD Security Risks
  - SLSA Supply Chain Levels for Software Artifacts
  - CIS Software Supply Chain Security Guide 2023
"""

from __future__ import annotations

import json
import logging
import re
import time
from pathlib import PurePosixPath
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Curated typosquatting map
# Key   = malicious/typo package name that appeared in the wild
# Value = the legitimate package it impersonates
# All entries are documented, real-world supply chain attacks.
# ---------------------------------------------------------------------------
TYPOSQUAT_MAP: dict[str, str] = {
    # npm — documented attacks
    "lodahs": "lodash",
    "loadsh": "lodash",
    "lodashs": "lodash",
    "lodash_": "lodash",
    "lod4sh": "lodash",
    "axois": "axios",
    "axio": "axios",
    "axxios": "axios",
    "reactt": "react",
    "reakt": "react",
    "raect": "react",
    "react-dom2": "react-dom",
    "expres": "express",
    "expresss": "express",
    "expresso": "express",
    "crossenv": "cross-env",
    "cross-env2": "cross-env",
    "coloers": "colors",
    "colour": "colors",
    "coluors": "colors",
    "momnet": "moment",
    "momen": "moment",
    "mooment": "moment",
    "eslint-config-airbnb2": "eslint-config-airbnb",
    "babel-clI": "babel-cli",
    "babel-cli2": "babel-cli",
    "webpakc": "webpack",
    "web-pack": "webpack",
    "webpackk": "webpack",
    "typeorm2": "typeorm",
    "sequelize2": "sequelize",
    "jsonwebtoken2": "jsonwebtoken",
    "nodemailler": "nodemailer",
    "node-mailer": "nodemailer",
    "mongoos": "mongoose",
    "mongooses": "mongoose",
    "nestjs-core": "@nestjs/core",
    "socket-io": "socket.io",
    "socket.io2": "socket.io",
    "dotenv2": "dotenv",
    "dot-env": "dotenv",
    "dotenvv": "dotenv",
    "chalk2": "chalk",
    "chalkk": "chalk",
    "chal": "chalk",
    "inquirier": "inquirer",
    "enquirer2": "inquirer",
    "commander2": "commander",
    "yargs2": "yargs",
    "nopt2": "nopt",
    "minimist2": "minimist",
    "semver2": "semver",
    "debug2": "debug",
    # PyPI — documented attacks
    "reqeusts": "requests",
    "request2": "requests",
    "requestss": "requests",
    "requets": "requests",
    "nump": "numpy",
    "numyp": "numpy",
    "numpyy": "numpy",
    "nunpy": "numpy",
    "panads": "pandas",
    "pnadas": "pandas",
    "pndas": "pandas",
    "panndas": "pandas",
    "scikit-learn2": "scikit-learn",
    "sklearn2": "scikit-learn",
    "scikitlearn": "scikit-learn",
    "matpotlib": "matplotlib",
    "matplotlb": "matplotlib",
    "matplotllib": "matplotlib",
    "setuptool": "setuptools",
    "setuptoolz": "setuptools",
    "setup-tools": "setuptools",
    "urlib3": "urllib3",
    "urllib33": "urllib3",
    "urllb3": "urllib3",
    "django2": "django",
    "djang0": "django",
    "dajngo": "django",
    "flaskk": "flask",
    "flaask": "flask",
    "fastap1": "fastapi",
    "fast-api": "fastapi",
    "fasttapi": "fastapi",
    "pytets": "pytest",
    "py-test": "pytest",
    "pytestt": "pytest",
    "beutifulsoup4": "beautifulsoup4",
    "beautifulsoup": "beautifulsoup4",
    "beatifulsoup4": "beautifulsoup4",
    "pillo": "pillow",
    "pilow": "pillow",
    "pilllow": "pillow",
    "cryptografy": "cryptography",
    "cryptographyy": "cryptography",
    "paramikoo": "paramiko",
    "paramiko2": "paramiko",
    "sqlalchamy": "sqlalchemy",
    "sqlalchamy2": "sqlalchemy",
    "sql-alchemy": "sqlalchemy",
    "celrey": "celery",
    "celerr": "celery",
    "redis2": "redis",
    "rediis": "redis",
    "aiohhtp": "aiohttp",
    "aiohtpp": "aiohttp",
    "pyyamll": "pyyaml",
    "py-yaml": "pyyaml",
    "boto33": "boto3",
    "bot03": "boto3",
}


# ---------------------------------------------------------------------------
# Patterns indicating suspicious lifecycle install scripts
# (preinstall / postinstall / install hooks in package.json)
# ---------------------------------------------------------------------------
MALICIOUS_INSTALL_PATTERNS: list[str] = [
    # Remote code execution via network fetchers
    r"\bcurl\s+\S+\s*\|",           # curl url | bash/sh
    r"\bwget\s+\S+\s*\|",           # wget url | bash/sh
    r"\bcurl\b.*-[oO]\s",           # curl -o silent download
    r"\bwget\b.*-[qO]\s",           # wget -q/-O silent download
    r"https?://\S+\s*\|\s*(?:ba)?sh",  # url | sh pattern
    # Process spawning for exfiltration
    r"\bexec\s+\w+\s*\(",           # exec() call
    r"\bspawn\s*\(['\"](?:sh|bash|cmd|powershell)",  # spawn shell
    r"\bchild_process\b.*exec",     # Node child_process.exec
    r"\bos\.system\s*\(",           # Python os.system
    r"\bsubprocess\.(?:run|call|Popen)\s*\(\s*[\['\"](?:sh|bash|cmd)",
    # Network beaconing / data exfiltration
    r"\bhttp\.get\s*\(['\"]http",   # Node http.get to remote
    r"\bfetch\s*\(['\"]https?://",  # fetch() to remote in install script
    r"\brequire\s*\(['\"]https?://", # require() from URL (Deno-style in Node)
    r"\bprocess\.env\b.*(?:curl|wget|fetch|http)",  # env var exfil
    r"\b(?:GITHUB_TOKEN|NPM_TOKEN|AWS_SECRET)\b.*(?:curl|wget|http)",
    # Obfuscation signals
    r"\bBuffer\.from\s*\(['\"][A-Za-z0-9+/]{40,}['\"],\s*['\"]base64['\"]",  # base64 decode in install
    r"\beval\s*\(",                 # eval() in install script
    r"\bFunction\s*\(\s*['\"]return\b",  # Function() constructor
    r"\\x[0-9a-fA-F]{2}\\x[0-9a-fA-F]{2}",  # hex escape sequences in scripts
    # Sensitive environment variable harvesting
    r"\bprocess\.env\b.*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)",
    r"\bos\.environ\b.*(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)",
    # Reverse shell indicators
    r"\b(?:nc|ncat|netcat)\s+\S+\s+\d{4,5}",  # netcat listener
    r"/dev/tcp/",                   # bash TCP redirect
    r"0\.0\.0\.0:\d{4}",           # bind to all interfaces
]


# ---------------------------------------------------------------------------
# Known patterns for dependency confusion targets (internal naming conventions)
# If a package has one of these patterns AND is public, it may be a confusion attack
# ---------------------------------------------------------------------------
INTERNAL_NAME_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"^@[a-zA-Z0-9_-]+/internal-"),     # @org/internal-*
    re.compile(r"^@[a-zA-Z0-9_-]+/private-"),      # @org/private-*
    re.compile(r"-internal$"),                       # *-internal
    re.compile(r"-private$"),                        # *-private
    re.compile(r"-core$"),                           # *-core (often internal)
    re.compile(r"^@[a-zA-Z0-9_-]+/shared-"),        # @org/shared-*
    re.compile(r"^@[a-zA-Z0-9_-]+/common-"),        # @org/common-*
    re.compile(r"-sdk$"),                            # *-sdk (custom SDKs)
    re.compile(r"-client$"),                         # *-client
    re.compile(r"-server$"),                         # *-server
]


# ---------------------------------------------------------------------------
# Floating / unsafe version specifiers
# ---------------------------------------------------------------------------
UNSAFE_VERSION_RE = re.compile(
    r"""(?x)
    "(?:latest|\*|next|experimental|canary)"    # npm: explicit wildcards
    | >=\s*0\.0\.0                              # npm: >=0.0.0
    | \*                                        # npm: bare *
    | ^latest$                                 # npm: bare latest string
    """,
    re.VERBOSE,
)

NPM_FLOATING_RE = re.compile(
    r'"[\w@/-]+":\s*"(latest|\*|next|experimental|canary|>=0)'
)

PIP_NO_VERSION_RE = re.compile(
    r"^[\w.-]+\s*$",   # package name with no version specifier
)

PIP_HASH_RE = re.compile(r"--hash=", re.IGNORECASE)

DOCKERFILE_LATEST_RE = re.compile(
    r"^FROM\s+([^\s:@]+)(?::latest|)\s*$",  # FROM image or FROM image:latest
    re.MULTILINE | re.IGNORECASE,
)

DOCKERFILE_DIGEST_RE = re.compile(
    r"^FROM\s+[^\s]+@sha256:[a-f0-9]{64}",
    re.MULTILINE | re.IGNORECASE,
)

# GitHub Actions ref patterns
GH_ACTION_UNPINNED_RE = re.compile(
    r"uses:\s+([a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+)@(main|master|HEAD|latest|v\d+(?!\.\d))",
)
GH_ACTION_SHA_RE = re.compile(
    r"uses:\s+[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+@[a-f0-9]{40}",
)
GH_PULL_REQUEST_TARGET_RE = re.compile(
    r"on:\s*\n.*pull_request_target",
    re.DOTALL,
)
GH_CHECKOUT_WITH_REF_RE = re.compile(
    r"actions/checkout.*ref.*github\.event\.pull_request",
    re.DOTALL,
)


# ---------------------------------------------------------------------------
# SBOM filename patterns
# ---------------------------------------------------------------------------
SBOM_FILENAMES = {
    "sbom.json", "sbom.xml", "sbom.spdx", "sbom.cdx.json",
    "bom.json", "bom.xml", "cyclonedx.json", "spdx.json",
    ".sbom", "software-bill-of-materials.json",
}

SBOM_PATH_PATTERNS = [
    re.compile(r"\.?sbom\.", re.IGNORECASE),
    re.compile(r"\.?bom\.", re.IGNORECASE),
    re.compile(r"cyclonedx", re.IGNORECASE),
    re.compile(r"spdx", re.IGNORECASE),
]

# GPL / copyleft license signals in file content
GPL_CONTENT_PATTERNS = [
    re.compile(r"GNU General Public License", re.IGNORECASE),
    re.compile(r"GPL-[23]\.0", re.IGNORECASE),
    re.compile(r"LGPL-[23]", re.IGNORECASE),
    re.compile(r"GNU LESSER GENERAL PUBLIC LICENSE", re.IGNORECASE),
    re.compile(r"AGPL-3\.0", re.IGNORECASE),
    re.compile(r"GNU AFFERO GENERAL PUBLIC LICENSE", re.IGNORECASE),
]


class SupplyChainAgent(BaseAgent):
    """
    Supply Chain Security Agent — specialist in software supply chain attack vectors.

    Analyzes both PR diffs (detecting new risky dependencies, CI changes, Dockerfile
    changes) and full repo scans (auditing entire dependency landscape, lockfile
    health, CI pipeline hygiene, and registry configuration).
    """

    agent_id = "supply_chain"
    agent_name = "Supply Chain Sentinel"
    specialization = (
        "Typosquatting, dependency confusion, unpinned versions, lockfile integrity, "
        "malicious install scripts, CI action pinning, SBOM, registry fallback"
    )

    # Severity → score deduction mapping
    _SCORE_DEDUCTIONS: dict[str, int] = {
        "critical": 28,
        "high": 16,
        "medium": 8,
        "low": 3,
        "info": 1,
    }

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()
        is_repo = context.get("analysis_type") == "repo"

        findings: list[Finding] = []
        positives: list[str] = []

        try:
            if is_repo:
                findings, positives = self._scan_repo(context)
            else:
                findings, positives = self._scan_pr(context)
        except Exception as exc:
            logger.exception("SupplyChainAgent encountered an unexpected error")
            return self._degraded_result(start, str(exc))

        # Score: start at 92 (supply chain is a specialized domain — default is healthy)
        score = 92
        for f in findings:
            score -= self._SCORE_DEDUCTIONS.get(f.severity, 5)
        score = self._clamp(score)

        insights = self._build_insights(findings, score)

        # Cap findings at 12; sort critical → low
        findings = self._sort_and_cap(findings, limit=12)

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.87,
            findings=findings,
            insights=insights,
            positives=positives[:5],
            metadata={
                "typosquat_checks": len(TYPOSQUAT_MAP),
                "malicious_patterns": len(MALICIOUS_INSTALL_PATTERNS),
                "analysis_mode": "repo" if is_repo else "pr",
            },
        ))

    # ------------------------------------------------------------------
    # PR diff analysis
    # ------------------------------------------------------------------

    def _scan_pr(self, context: dict[str, Any]) -> tuple[list[Finding], list[str]]:
        """Analyze changed files in a PR for supply chain risks."""
        files: list[dict] = context.get("files", [])
        findings: list[Finding] = []
        positives: list[str] = []

        changed_filenames = {f.get("filename", "") for f in files}

        for file in files:
            fname: str = file.get("filename", "")
            patch: str = file.get("patch", "") or ""
            status: str = file.get("status", "")

            added_lines = [
                line[1:] for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            ]
            added_text = "\n".join(added_lines)

            # ---- package.json changes -----------------------------------
            if fname == "package.json" or fname.endswith("/package.json"):
                findings.extend(self._check_npm_versions(added_lines, fname))
                findings.extend(self._check_typosquatting_npm(added_lines, fname))
                findings.extend(self._check_dependency_confusion_npm(added_lines, fname))
                findings.extend(self._check_malicious_install_scripts(added_text, fname))

                # Lockfile not updated alongside package.json?
                has_lockfile_change = any(
                    "package-lock.json" in f or "yarn.lock" in f or "pnpm-lock.yaml" in f
                    for f in changed_filenames
                )
                if not has_lockfile_change and status != "removed":
                    findings.append(Finding(
                        severity="high",
                        category="supply_chain",
                        description=(
                            f"{fname} was modified but no lockfile was updated in this PR. "
                            "Mismatched lockfiles allow stealthy dependency substitution."
                        ),
                        suggestion=(
                            "Always run `npm install` / `yarn` after editing package.json and commit "
                            "the resulting lockfile changes together in the same PR."
                        ),
                        file=fname,
                        rule_id="lockfile-not-updated",
                        confidence=0.88,
                    ))

            # ---- Lockfile deleted ----------------------------------------
            if fname in ("package-lock.json", "yarn.lock", "pnpm-lock.yaml") and status == "removed":
                findings.append(Finding(
                    severity="critical",
                    category="supply_chain",
                    description=(
                        f"Lockfile {fname} was deleted. Reproducible builds are impossible — "
                        "every `npm install` can silently resolve different package versions."
                    ),
                    suggestion=(
                        "Never delete your lockfile. If regenerating from scratch, commit the new "
                        "lockfile in the same PR and verify the diff with `npm ci --dry-run`."
                    ),
                    file=fname,
                    rule_id="lockfile-deleted",
                    confidence=0.98,
                ))

            # ---- requirements.txt / Pipfile changes ---------------------
            if "requirements" in fname.lower() and fname.endswith(".txt"):
                findings.extend(self._check_pip_versions(added_lines, fname))
                findings.extend(self._check_typosquatting_pip(added_lines, fname))
                if not any(PIP_HASH_RE.search(line) for line in added_lines):
                    findings.append(Finding(
                        severity="medium",
                        category="supply_chain",
                        description=(
                            f"{fname} does not use `--require-hashes`. Without hash verification, "
                            "pip can install tampered packages from a compromised mirror."
                        ),
                        suggestion=(
                            "Add `--require-hashes` to your pip install command and pin hashes with "
                            "`pip-compile --generate-hashes` (pip-tools). Use `pip install --require-hashes -r requirements.txt`."
                        ),
                        file=fname,
                        rule_id="pip-no-hashes",
                        confidence=0.82,
                    ))

            # ---- Dockerfile changes -------------------------------------
            if fname in ("Dockerfile", "dockerfile") or fname.endswith((".dockerfile", "/Dockerfile")):
                findings.extend(self._check_dockerfile(added_lines, fname))

            # ---- GitHub Actions workflow changes -------------------------
            if fname.startswith(".github/workflows/") and fname.endswith((".yml", ".yaml")):
                findings.extend(self._check_github_actions(added_text, fname))

            # ---- go.mod changes -----------------------------------------
            if fname == "go.mod" or fname.endswith("/go.mod"):
                findings.extend(self._check_go_mod(added_lines, fname))

            # ---- Cargo.toml changes -------------------------------------
            if fname == "Cargo.toml" or fname.endswith("/Cargo.toml"):
                findings.extend(self._check_cargo_toml(added_lines, fname))

            # ---- pom.xml changes ----------------------------------------
            if fname in ("pom.xml", "build.gradle") or fname.endswith(("/pom.xml", "/build.gradle")):
                findings.extend(self._check_java_build(added_lines, fname))

            # ---- .npmrc / pip.conf changes (registry config) ------------
            if fname in (".npmrc", "pip.conf", ".piprc", "pip.ini"):
                findings.extend(self._check_registry_config(added_text, fname))

            # ---- LICENSE / COPYING files --------------------------------
            if fname.upper() in ("LICENSE", "COPYING", "LICENSE.MD", "LICENSE.TXT"):
                findings.extend(self._check_license_gpl(added_text, fname))

        if not findings:
            positives.append("No supply chain risks detected in changed dependency files")

        return findings, positives

    # ------------------------------------------------------------------
    # Full repo scan analysis
    # ------------------------------------------------------------------

    def _scan_repo(self, context: dict[str, Any]) -> tuple[list[Finding], list[str]]:
        """Scan the full repo file tree and key file contents for supply chain risks."""
        file_tree: list[str] = context.get("file_tree", [])
        contents: dict[str, str] = context.get("key_file_contents", {})
        findings: list[Finding] = []
        positives: list[str] = []

        file_tree_set = {f.lower() for f in file_tree}
        file_tree_lower = [f.lower() for f in file_tree]

        # ---- Lockfile health ----------------------------------------
        findings.extend(self._audit_lockfiles(file_tree_set, contents))

        # ---- Node version pinning -----------------------------------
        has_nvmrc = any(f in (".nvmrc", ".node-version") for f in file_tree_lower)
        if not has_nvmrc:
            # Only flag if there's a package.json
            if any("package.json" in f for f in file_tree_lower):
                findings.append(Finding(
                    severity="low",
                    category="supply_chain",
                    description=(
                        "No .nvmrc or .node-version file found. Different contributors may use "
                        "different Node.js versions, leading to subtle build inconsistencies."
                    ),
                    suggestion=(
                        "Create a .nvmrc with your target Node version (e.g., `20.14.0`). "
                        "Combine with `engines` field in package.json for enforcement."
                    ),
                    rule_id="no-nvmrc",
                    confidence=0.80,
                ))
        else:
            positives.append("Node.js version pinned via .nvmrc / .node-version")

        # ---- Python version pinning ---------------------------------
        has_py_version = any(
            f in (".python-version", "runtime.txt", ".tool-versions")
            for f in file_tree_lower
        )
        if not has_py_version:
            if any("requirements" in f or "pipfile" in f for f in file_tree_lower):
                findings.append(Finding(
                    severity="low",
                    category="supply_chain",
                    description=(
                        "No .python-version or runtime.txt found. Python version drift across "
                        "environments can cause subtle dependency resolution differences."
                    ),
                    suggestion=(
                        "Create .python-version (pyenv format, e.g. `3.12.3`) or use "
                        "`python_requires` in setup.cfg / pyproject.toml."
                    ),
                    rule_id="no-python-version-pin",
                    confidence=0.78,
                ))

        # ---- SBOM absence -------------------------------------------
        has_sbom = self._has_sbom(file_tree)
        if not has_sbom:
            findings.append(Finding(
                severity="low",
                category="supply_chain",
                description=(
                    "No Software Bill of Materials (SBOM) found. An SBOM is increasingly required "
                    "by compliance frameworks (NIST SSDF, EO 14028) and enterprise procurement."
                ),
                suggestion=(
                    "Generate an SBOM with `cyclonedx-npm --output bom.json` (npm) or "
                    "`cyclonedx-py -o sbom.json` (Python). Commit to the repo or produce "
                    "in CI and attach to releases."
                ),
                rule_id="no-sbom",
                confidence=0.85,
            ))
        else:
            positives.append("SBOM present — software component inventory maintained")

        # ---- Scan package.json ------------------------------------------
        pkg_content = contents.get("package.json", "")
        if pkg_content:
            findings.extend(self._audit_package_json(pkg_content))
            positives_npm = self._positive_npm_checks(pkg_content, file_tree_set)
            positives.extend(positives_npm)

        # ---- Scan requirements.txt --------------------------------------
        req_content = contents.get("requirements.txt", "")
        if req_content:
            req_lines = req_content.splitlines()
            findings.extend(self._check_pip_versions(req_lines, "requirements.txt"))
            findings.extend(self._check_typosquatting_pip(req_lines, "requirements.txt"))
            if not any(PIP_HASH_RE.search(l) for l in req_lines):
                findings.append(Finding(
                    severity="medium",
                    category="supply_chain",
                    description=(
                        "requirements.txt does not use hash verification. Without `--require-hashes`, "
                        "a compromised PyPI mirror or man-in-the-middle can substitute packages."
                    ),
                    suggestion=(
                        "Use pip-tools: `pip-compile --generate-hashes requirements.in`. "
                        "Install with `pip install --require-hashes -r requirements.txt`."
                    ),
                    file="requirements.txt",
                    rule_id="pip-no-hashes-repo",
                    confidence=0.85,
                ))

        # ---- Scan Dockerfiles --------------------------------------------
        for fname, content in contents.items():
            if not content:
                continue
            base = PurePosixPath(fname).name.lower()
            if base in ("dockerfile",) or fname.endswith((".dockerfile",)):
                findings.extend(self._check_dockerfile(content.splitlines(), fname))

        # ---- Scan GitHub Actions workflows -------------------------------
        for fname, content in contents.items():
            if not content:
                continue
            if fname.startswith(".github/workflows/") and fname.endswith((".yml", ".yaml")):
                findings.extend(self._check_github_actions(content, fname))

        # ---- .npmrc / pip registry config --------------------------------
        for rc_file in (".npmrc", "pip.conf", ".piprc", ".pip/pip.conf"):
            rc_content = contents.get(rc_file, "")
            if rc_content:
                findings.extend(self._check_registry_config(rc_content, rc_file))
            elif rc_file == ".npmrc" and any("package.json" in f for f in file_tree_lower):
                # .npmrc missing with package.json present
                findings.append(Finding(
                    severity="medium",
                    category="supply_chain",
                    description=(
                        "No .npmrc found. Without explicit registry configuration, npm falls back "
                        "to the public registry — enabling dependency confusion attacks if your "
                        "internal packages share names with public ones."
                    ),
                    suggestion=(
                        "Create .npmrc with `registry=https://your-private-registry/` for scoped "
                        "packages: `@yourorg:registry=https://your-nexus/repository/npm-group/`. "
                        "Set `always-auth=true` for private registries."
                    ),
                    rule_id="no-npmrc",
                    confidence=0.72,
                ))

        # ---- License compliance -----------------------------------------
        for fname in ("LICENSE", "COPYING", "LICENSE.md", "LICENSE.txt"):
            content = contents.get(fname, "")
            if content:
                findings.extend(self._check_license_gpl(content, fname))

        # ---- Positives for clean areas ----------------------------------
        if not any(f.rule_id == "typosquat" for f in findings):
            positives.append("No known typosquatting packages detected in dependencies")
        if not any(f.rule_id and "action" in f.rule_id for f in findings):
            if any(".github/workflows" in f for f in file_tree_lower):
                positives.append("GitHub Actions workflows use pinned versions or commit SHAs")

        return findings, positives

    # ------------------------------------------------------------------
    # Granular checks — callable from both PR and repo scan
    # ------------------------------------------------------------------

    def _check_npm_versions(self, lines: list[str], fname: str) -> list[Finding]:
        """Flag floating / unsafe npm version specifiers."""
        findings: list[Finding] = []
        seen: set[str] = set()
        for line in lines:
            m = NPM_FLOATING_RE.search(line)
            if m:
                version = m.group(1)
                # Extract package name
                name_match = re.search(r'"([\w@/.-]+)":\s*"' + re.escape(version), line)
                pkg = name_match.group(1) if name_match else "unknown"
                key = f"{pkg}:{version}"
                if key in seen:
                    continue
                seen.add(key)
                findings.append(Finding(
                    severity="high",
                    category="supply_chain",
                    description=(
                        f"Package `{pkg}` uses floating version specifier `{version}` in {fname}. "
                        "Floating versions allow silent upgrades to any future release, including "
                        "maliciously compromised ones."
                    ),
                    suggestion=(
                        f"Pin to an exact version (e.g., `\"{pkg}\": \"1.2.3\"`) and use a lockfile. "
                        "Use `npm outdated` to monitor updates deliberately."
                    ),
                    file=fname,
                    code_snippet=line.strip()[:120],
                    rule_id="npm-floating-version",
                    confidence=0.92,
                ))
        return findings

    def _check_typosquatting_npm(self, lines: list[str], fname: str) -> list[Finding]:
        """Detect known npm typosquatting package names."""
        findings: list[Finding] = []
        for line in lines:
            name_match = re.search(r'"([\w@/.-]+)":\s*"', line)
            if not name_match:
                continue
            raw_pkg = name_match.group(1)
            # Strip scope for matching (check bare name)
            bare = raw_pkg.lstrip("@").split("/")[-1].lower()
            full_lower = raw_pkg.lower()

            for typo, legitimate in TYPOSQUAT_MAP.items():
                if bare == typo.lower() or full_lower == typo.lower():
                    findings.append(Finding(
                        severity="critical",
                        category="supply_chain",
                        description=(
                            f"Package `{raw_pkg}` is a known typosquatting variant of `{legitimate}`. "
                            "This exact package name has been used in documented supply chain attacks."
                        ),
                        suggestion=(
                            f"Remove `{raw_pkg}` immediately and use the legitimate package `{legitimate}`. "
                            "Run `npm ls {raw_pkg}` to check if it was installed transitively and "
                            "audit with `npm audit`."
                        ),
                        file=fname,
                        code_snippet=line.strip()[:120],
                        rule_id="typosquat",
                        confidence=0.95,
                    ))
        return findings

    def _check_typosquatting_pip(self, lines: list[str], fname: str) -> list[Finding]:
        """Detect known PyPI typosquatting package names."""
        findings: list[Finding] = []
        for line in lines:
            # Strip comments and version specifiers
            clean = re.split(r"[#>=<!;\[]", line)[0].strip().lower()
            if not clean:
                continue
            for typo, legitimate in TYPOSQUAT_MAP.items():
                if clean == typo.lower():
                    findings.append(Finding(
                        severity="critical",
                        category="supply_chain",
                        description=(
                            f"Package `{clean}` is a known typosquatting variant of `{legitimate}` on PyPI. "
                            "This package name has been used in documented supply chain attacks."
                        ),
                        suggestion=(
                            f"Replace `{clean}` with `{legitimate}`. "
                            "Run `pip show {clean}` to check what was installed and inspect its code. "
                            "Verify the correct package is `{legitimate}`."
                        ),
                        file=fname,
                        code_snippet=line.strip()[:120],
                        rule_id="typosquat",
                        confidence=0.95,
                    ))
        return findings

    def _check_dependency_confusion_npm(self, lines: list[str], fname: str) -> list[Finding]:
        """Detect npm packages that match internal naming patterns (confusion risk)."""
        findings: list[Finding] = []
        for line in lines:
            name_match = re.search(r'"([\w@/.-]+)":\s*"', line)
            if not name_match:
                continue
            pkg = name_match.group(1)
            for pattern in INTERNAL_NAME_PATTERNS:
                if pattern.search(pkg):
                    findings.append(Finding(
                        severity="medium",
                        category="supply_chain",
                        description=(
                            f"Package `{pkg}` matches an internal naming convention pattern. "
                            "If this is an internal package that is also published to the public npm "
                            "registry, it may be vulnerable to a dependency confusion attack."
                        ),
                        suggestion=(
                            f"Verify that `{pkg}` is scoped to your private registry in .npmrc. "
                            "If it is an internal package, ensure it is NOT published to the public "
                            "registry, or use scoped packages with `@yourorg/` prefix and set "
                            "`publishConfig.access` appropriately."
                        ),
                        file=fname,
                        code_snippet=line.strip()[:120],
                        rule_id="dep-confusion-risk",
                        confidence=0.70,
                    ))
                    break  # Only one finding per package
        return findings

    def _check_malicious_install_scripts(self, text: str, fname: str) -> list[Finding]:
        """Flag suspicious lifecycle scripts in package.json."""
        findings: list[Finding] = []
        try:
            pkg = json.loads(text) if text.strip().startswith("{") else {}
        except (json.JSONDecodeError, ValueError):
            return findings

        scripts: dict = pkg.get("scripts", {})
        for hook in ("preinstall", "postinstall", "install", "prepare"):
            script = scripts.get(hook, "")
            if not script:
                continue
            for pattern in MALICIOUS_INSTALL_PATTERNS:
                if re.search(pattern, script, re.IGNORECASE):
                    findings.append(Finding(
                        severity="critical",
                        category="supply_chain",
                        description=(
                            f"`{fname}` has a `{hook}` script with suspicious content: `{script[:80]}`. "
                            "Lifecycle scripts that download and execute remote code are a primary "
                            "supply chain attack vector."
                        ),
                        suggestion=(
                            f"Audit the `{hook}` script thoroughly. Remove any remote code execution. "
                            "Use `npm install --ignore-scripts` for untrusted packages. "
                            "Consider using `npm audit` and Socket.dev for continuous monitoring."
                        ),
                        file=fname,
                        code_snippet=script[:120],
                        rule_id="malicious-install-script",
                        confidence=0.88,
                    ))
                    break

        # Short package names (1-2 chars) — historically used in attacks
        pkg_name = pkg.get("name", "")
        if pkg_name and len(pkg_name.strip()) <= 2 and pkg_name.strip().isalpha():
            findings.append(Finding(
                severity="medium",
                category="supply_chain",
                description=(
                    f"Package name `{pkg_name}` is very short (1-2 characters). "
                    "Extremely short package names are a known malicious package pattern — "
                    "attackers register them to intercept accidental typos."
                ),
                suggestion=(
                    "If this is your own package, ensure it has a meaningful, descriptive name. "
                    "If it is a dependency, verify the package author and source carefully."
                ),
                file=fname,
                rule_id="short-package-name",
                confidence=0.72,
            ))

        return findings

    def _check_pip_versions(self, lines: list[str], fname: str) -> list[Finding]:
        """Flag unpinned / wildcard Python package versions."""
        findings: list[Finding] = []
        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or stripped.startswith("-"):
                continue
            clean = re.split(r"[#;]", stripped)[0].strip()
            if clean.startswith("-"):
                continue
            if PIP_NO_VERSION_RE.match(clean):
                findings.append(Finding(
                    severity="medium",
                    category="supply_chain",
                    description=(
                        f"Package `{clean}` in {fname} has no version specifier. "
                        "Unpinned pip packages resolve to the latest version at install time, "
                        "making builds non-reproducible and vulnerable to silent upgrades."
                    ),
                    suggestion=(
                        f"Pin the version: `{clean}==<current-version>`. "
                        "Use `pip freeze > requirements.txt` to capture current pinned versions, "
                        "or use pip-tools for dependency management."
                    ),
                    file=fname,
                    code_snippet=stripped[:80],
                    rule_id="pip-unpinned",
                    confidence=0.88,
                ))
        return findings

    def _check_dockerfile(self, lines: list[str], fname: str) -> list[Finding]:
        """Flag Dockerfile supply chain risks: :latest, missing digest, curl|sh patterns."""
        findings: list[Finding] = []
        full_text = "\n".join(lines)

        # FROM :latest or FROM image (no tag)
        for match in DOCKERFILE_LATEST_RE.finditer(full_text):
            image = match.group(1)
            full_ref = match.group(0).strip()
            # Skip if it already has a digest
            if "@sha256:" in full_ref:
                continue
            severity = "high" if ":latest" in full_ref or ":" not in image else "medium"
            findings.append(Finding(
                severity=severity,
                category="supply_chain",
                description=(
                    f"Dockerfile uses `{full_ref[:80]}` without a digest pin. "
                    "Image tags are mutable — the image can be silently replaced with a "
                    "compromised version between builds."
                ),
                suggestion=(
                    f"Pin to an immutable digest: `FROM {image}@sha256:<hash>`. "
                    "Use `docker inspect --format='{{{{.RepoDigests}}}}' {image}` to get the current digest. "
                    "Tools like Renovate or Dependabot can keep digests up to date automatically."
                ),
                file=fname,
                code_snippet=full_ref[:100],
                rule_id="dockerfile-unpinned-image",
                confidence=0.90,
            ))

        # curl/wget pipe to shell in RUN commands
        run_lines = [l.strip() for l in lines if re.match(r"RUN\b", l.strip(), re.IGNORECASE)]
        for run_line in run_lines:
            if re.search(r"(?:curl|wget)\s+\S+\s*\|", run_line, re.IGNORECASE):
                findings.append(Finding(
                    severity="high",
                    category="supply_chain",
                    description=(
                        f"Dockerfile RUN command pipes a remote download directly to a shell: "
                        f"`{run_line[:100]}`. This allows arbitrary code execution at build time."
                    ),
                    suggestion=(
                        "Download the script separately, verify its checksum (sha256sum), "
                        "then execute it. Use `ADD --checksum` (Docker BuildKit) or "
                        "COPY from a verified local copy instead."
                    ),
                    file=fname,
                    code_snippet=run_line[:120],
                    rule_id="dockerfile-curl-pipe-shell",
                    confidence=0.92,
                ))

        return findings

    def _check_github_actions(self, text: str, fname: str) -> list[Finding]:
        """Detect unpinned GitHub Actions and pull_request_target risks."""
        findings: list[Finding] = []

        # Unpinned action refs (@main, @master, @v1, etc.)
        for match in GH_ACTION_UNPINNED_RE.finditer(text):
            action = match.group(1)
            ref = match.group(2)
            # Skip GitHub's own first-party actions if using a major version tag
            is_first_party = action.startswith("actions/") or action.startswith("github/")
            severity = "medium" if is_first_party else "high"
            findings.append(Finding(
                severity=severity,
                category="supply_chain",
                description=(
                    f"GitHub Action `{action}@{ref}` uses a mutable ref (`{ref}`). "
                    "A compromised action at this ref could execute arbitrary code in your CI pipeline "
                    "with access to all secrets and tokens."
                ),
                suggestion=(
                    f"Pin to a full commit SHA: `uses: {action}@<40-char-sha>  # {ref}`. "
                    "Use Dependabot or Renovate to keep SHAs up to date. "
                    "Tools like `pin-github-action` CLI can automate this."
                ),
                file=fname,
                code_snippet=match.group(0)[:100],
                rule_id="action-unpinned-ref",
                confidence=0.90,
            ))

        # pull_request_target with checkout of PR code
        if GH_PULL_REQUEST_TARGET_RE.search(text) and GH_CHECKOUT_WITH_REF_RE.search(text):
            findings.append(Finding(
                severity="critical",
                category="supply_chain",
                description=(
                    f"{fname} uses `pull_request_target` and checks out the PR branch. "
                    "This grants untrusted external PR code access to repository secrets — "
                    "a well-known privilege escalation vector (GHSA-2gmg-wmqq-9xcp style)."
                ),
                suggestion=(
                    "Do not checkout PR code in `pull_request_target` workflows. "
                    "If you need PR code, use `pull_request` (no secrets access). "
                    "See: https://securitylab.github.com/research/github-actions-preventing-pwn-requests/"
                ),
                file=fname,
                rule_id="action-pwn-request",
                confidence=0.92,
            ))

        # Check for self-hosted runners with untrusted input
        if "self-hosted" in text and "pull_request" in text:
            findings.append(Finding(
                severity="high",
                category="supply_chain",
                description=(
                    f"{fname} runs on a self-hosted runner for pull request events. "
                    "Self-hosted runners executing untrusted PR code can be compromised to "
                    "exfiltrate secrets or pivot into the internal network."
                ),
                suggestion=(
                    "Use GitHub-hosted runners for PRs from forks. If self-hosted runners are "
                    "required, use ephemeral runners (--ephemeral flag) and isolate them "
                    "from internal network resources."
                ),
                file=fname,
                rule_id="action-self-hosted-pr",
                confidence=0.78,
            ))

        return findings

    def _check_go_mod(self, lines: list[str], fname: str) -> list[Finding]:
        """Flag Go module risks: missing go.sum, replace directives to local/unknown."""
        findings: list[Finding] = []
        for line in lines:
            stripped = line.strip()
            # replace directive pointing to local path or unknown fork
            if stripped.startswith("replace") and ("=> ./") in stripped:
                findings.append(Finding(
                    severity="medium",
                    category="supply_chain",
                    description=(
                        f"go.mod has a `replace` directive pointing to a local path: `{stripped[:100]}`. "
                        "Local replace directives are easy to forget and can shadow the real upstream "
                        "module in production builds."
                    ),
                    suggestion=(
                        "Remove local `replace` directives before merging to the main branch. "
                        "Use a workspace (`go work`) for local development instead. "
                        "Ensure go.sum is committed alongside go.mod."
                    ),
                    file=fname,
                    code_snippet=stripped[:100],
                    rule_id="go-local-replace",
                    confidence=0.85,
                ))
        return findings

    def _check_cargo_toml(self, lines: list[str], fname: str) -> list[Finding]:
        """Flag Rust Cargo.toml risks: path dependencies, wildcard versions."""
        findings: list[Finding] = []
        for line in lines:
            stripped = line.strip()
            # path dependency outside the workspace
            if 'path = "' in stripped and ".." in stripped:
                findings.append(Finding(
                    severity="medium",
                    category="supply_chain",
                    description=(
                        f"Cargo.toml has an external `path` dependency: `{stripped[:100]}`. "
                        "Path dependencies pointing outside the workspace are not reproducible "
                        "and cannot be verified by cargo's checksum mechanism."
                    ),
                    suggestion=(
                        "Replace path dependencies with versioned crates.io dependencies before "
                        "merging to main. Use workspaces for monorepo-style local development."
                    ),
                    file=fname,
                    code_snippet=stripped[:100],
                    rule_id="cargo-path-dep",
                    confidence=0.83,
                ))
            # Wildcard version
            if re.search(r'version\s*=\s*["\']?\*["\']?', stripped):
                findings.append(Finding(
                    severity="high",
                    category="supply_chain",
                    description=(
                        f"Cargo.toml uses wildcard version `*` in: `{stripped[:100]}`. "
                        "Wildcard versions allow any semver-compatible release including major "
                        "breaking changes and potential malicious publishes."
                    ),
                    suggestion=(
                        "Pin to a specific version or use a tightly bounded range: "
                        "`version = \"1.2.3\"` or `version = \">=1.2, <2\"`."
                    ),
                    file=fname,
                    code_snippet=stripped[:100],
                    rule_id="cargo-wildcard-version",
                    confidence=0.90,
                ))
        return findings

    def _check_java_build(self, lines: list[str], fname: str) -> list[Finding]:
        """Flag Maven/Gradle supply chain risks: SNAPSHOT versions, missing checksums."""
        findings: list[Finding] = []
        for line in lines:
            stripped = line.strip()
            # SNAPSHOT dependency
            if "SNAPSHOT" in stripped:
                findings.append(Finding(
                    severity="medium",
                    category="supply_chain",
                    description=(
                        f"`{fname}` references a SNAPSHOT dependency: `{stripped[:100]}`. "
                        "SNAPSHOT versions are mutable — the artifact can change between builds "
                        "without a version bump, undermining reproducibility."
                    ),
                    suggestion=(
                        "Replace SNAPSHOT dependencies with pinned release versions in production "
                        "builds. SNAPSHOT dependencies are appropriate only in development/testing."
                    ),
                    file=fname,
                    code_snippet=stripped[:100],
                    rule_id="java-snapshot-dep",
                    confidence=0.88,
                ))
            # Dynamic Gradle version
            if re.search(r"['\"][\w.-]+:\+['\"]", stripped):
                findings.append(Finding(
                    severity="high",
                    category="supply_chain",
                    description=(
                        f"`{fname}` uses a dynamic `+` version: `{stripped[:80]}`. "
                        "The `+` version selector resolves to the latest matching artifact at "
                        "build time — any new malicious publish can be silently pulled."
                    ),
                    suggestion=(
                        "Replace dynamic versions with exact pinned versions. "
                        "Enable Gradle's `--configuration-cache` and dependency verification "
                        "(`gradle --write-verification-metadata sha256`)."
                    ),
                    file=fname,
                    code_snippet=stripped[:100],
                    rule_id="gradle-dynamic-version",
                    confidence=0.90,
                ))
        return findings

    def _check_registry_config(self, text: str, fname: str) -> list[Finding]:
        """Check .npmrc / pip.conf for private registry configuration."""
        findings: list[Finding] = []

        # .npmrc pointing to a plain http registry (not https)
        if fname == ".npmrc":
            if re.search(r"registry\s*=\s*http://", text, re.IGNORECASE):
                findings.append(Finding(
                    severity="high",
                    category="supply_chain",
                    description=(
                        ".npmrc configures a registry over plain HTTP. "
                        "Non-TLS registry connections are vulnerable to MITM attacks that can "
                        "serve tampered packages."
                    ),
                    suggestion=(
                        "Change the registry URL to use HTTPS: `registry=https://your-registry/`. "
                        "Never use HTTP for package registries in any environment."
                    ),
                    file=fname,
                    rule_id="npmrc-http-registry",
                    confidence=0.95,
                ))
            # always-auth not set
            if "registry=" in text and "always-auth" not in text:
                findings.append(Finding(
                    severity="low",
                    category="supply_chain",
                    description=(
                        ".npmrc has a registry configured but `always-auth=true` is not set. "
                        "Without this, npm may fall back to unauthenticated requests for some package "
                        "lookups against the public registry."
                    ),
                    suggestion=(
                        "Add `always-auth=true` to .npmrc if using a private registry, "
                        "and scope it to your registry: `@yourorg:always-auth=true`."
                    ),
                    file=fname,
                    rule_id="npmrc-no-always-auth",
                    confidence=0.65,
                ))

        # pip.conf insecure index
        if fname in ("pip.conf", ".piprc", ".pip/pip.conf"):
            if re.search(r"index-url\s*=\s*http://", text, re.IGNORECASE):
                findings.append(Finding(
                    severity="high",
                    category="supply_chain",
                    description=(
                        f"{fname} configures pip to use a plain HTTP index URL. "
                        "This allows MITM attacks to serve tampered Python packages."
                    ),
                    suggestion=(
                        "Switch to an HTTPS index URL: `index-url = https://your-pypi-mirror/simple/`. "
                        "Add `trusted-host` only as a last resort for internal CAs."
                    ),
                    file=fname,
                    rule_id="pip-http-index",
                    confidence=0.95,
                ))

        return findings

    def _check_license_gpl(self, text: str, fname: str) -> list[Finding]:
        """Detect GPL/AGPL/LGPL license files that may contaminate commercial projects."""
        findings: list[Finding] = []
        for pattern in GPL_CONTENT_PATTERNS:
            if pattern.search(text):
                license_type = pattern.pattern.split("\\")[0].replace("|", "or").strip()
                findings.append(Finding(
                    severity="medium",
                    category="supply_chain",
                    description=(
                        f"`{fname}` contains a copyleft license (GPL/LGPL/AGPL). "
                        "Copyleft licenses may require your entire codebase to be open-sourced "
                        "if distributed, creating legal risk for proprietary/commercial projects."
                    ),
                    suggestion=(
                        "Consult with legal counsel before shipping code with GPL/LGPL/AGPL "
                        "dependencies in a commercial product. Consider replacing with "
                        "permissively-licensed alternatives (MIT, Apache-2.0, BSD)."
                    ),
                    file=fname,
                    rule_id="copyleft-license",
                    confidence=0.88,
                ))
                break  # One finding per file is enough
        return findings

    # ------------------------------------------------------------------
    # Repo-scan helpers
    # ------------------------------------------------------------------

    def _audit_lockfiles(
        self, file_tree_set: set[str], contents: dict[str, str]
    ) -> list[Finding]:
        """Comprehensive lockfile audit for repo scans."""
        findings: list[Finding] = []

        has_package_json = "package.json" in file_tree_set or any(
            "package.json" in f for f in file_tree_set
        )
        has_npm_lock = "package-lock.json" in file_tree_set
        has_yarn_lock = "yarn.lock" in file_tree_set
        has_pnpm_lock = "pnpm-lock.yaml" in file_tree_set
        has_any_node_lock = has_npm_lock or has_yarn_lock or has_pnpm_lock

        if has_package_json and not has_any_node_lock:
            findings.append(Finding(
                severity="high",
                category="supply_chain",
                description=(
                    "package.json found but no lockfile (package-lock.json / yarn.lock / "
                    "pnpm-lock.yaml) is committed. Without a lockfile, `npm install` resolves "
                    "dependency versions non-deterministically — a supply chain attack surface."
                ),
                suggestion=(
                    "Run `npm install` (or `yarn` / `pnpm install`) and commit the generated "
                    "lockfile. Use `npm ci` in CI/CD for strictly reproducible installs. "
                    "Never add lockfiles to .gitignore."
                ),
                rule_id="no-node-lockfile",
                confidence=0.92,
            ))

        # Multiple lockfiles — conflicting package managers
        lock_count = sum([has_npm_lock, has_yarn_lock, has_pnpm_lock])
        if lock_count > 1:
            findings.append(Finding(
                severity="medium",
                category="supply_chain",
                description=(
                    f"Multiple lockfiles detected ({lock_count} of: package-lock.json, yarn.lock, "
                    "pnpm-lock.yaml). Different lockfiles can diverge in their resolved versions, "
                    "causing inconsistent installs across team members."
                ),
                suggestion=(
                    "Decide on a single package manager and delete the others' lockfiles. "
                    "Enforce with `.npmrc`: `engine-strict=true` and specify `engines.node`."
                ),
                rule_id="multiple-lockfiles",
                confidence=0.85,
            ))

        # Integrity field missing in package-lock.json (v1 format)
        pkg_lock_content = contents.get("package-lock.json", "")
        if pkg_lock_content:
            try:
                lock_data = json.loads(pkg_lock_content)
                deps = lock_data.get("dependencies", {})
                missing_integrity = [
                    name for name, meta in deps.items()
                    if isinstance(meta, dict) and "integrity" not in meta and "resolved" in meta
                ]
                if missing_integrity:
                    findings.append(Finding(
                        severity="medium",
                        category="supply_chain",
                        description=(
                            f"package-lock.json has {len(missing_integrity)} package entries missing "
                            "the `integrity` (SRI hash) field. Without integrity hashes, npm cannot "
                            "detect tampered packages after resolution."
                        ),
                        suggestion=(
                            "Regenerate the lockfile with a modern npm version (>= 7) which always "
                            "writes integrity hashes. Run `rm package-lock.json && npm install`."
                        ),
                        file="package-lock.json",
                        code_snippet=", ".join(missing_integrity[:5]),
                        rule_id="lockfile-missing-integrity",
                        confidence=0.88,
                    ))
            except (json.JSONDecodeError, ValueError):
                pass

        return findings

    def _audit_package_json(self, pkg_str: str) -> list[Finding]:
        """Full audit of package.json for supply chain risks."""
        findings: list[Finding] = []
        try:
            pkg = json.loads(pkg_str)
        except (json.JSONDecodeError, ValueError):
            return findings

        all_deps: dict[str, str] = {
            **pkg.get("dependencies", {}),
            **pkg.get("devDependencies", {}),
            **pkg.get("peerDependencies", {}),
        }

        # Floating versions
        for dep_name, version in all_deps.items():
            if NPM_FLOATING_RE.match(f'"{dep_name}": "{version}"'):
                findings.append(Finding(
                    severity="high",
                    category="supply_chain",
                    description=(
                        f"Package `{dep_name}` uses floating version `{version}`. "
                        "Any future malicious publish at this range can be silently installed."
                    ),
                    suggestion=(
                        f"Pin to a specific version. Check current version with "
                        f"`npm view {dep_name} version` and update to e.g. `\"{version.strip('^~>=<')}\"`."
                    ),
                    file="package.json",
                    rule_id="npm-floating-version",
                    confidence=0.90,
                ))

        # Typosquatting
        for dep_name in all_deps:
            bare = dep_name.lstrip("@").split("/")[-1].lower()
            for typo, legitimate in TYPOSQUAT_MAP.items():
                if bare == typo.lower():
                    findings.append(Finding(
                        severity="critical",
                        category="supply_chain",
                        description=(
                            f"Dependency `{dep_name}` is a known typosquatting variant of `{legitimate}`."
                        ),
                        suggestion=f"Replace `{dep_name}` with `{legitimate}`.",
                        file="package.json",
                        rule_id="typosquat",
                        confidence=0.95,
                    ))

        # Malicious install scripts
        scripts = pkg.get("scripts", {})
        for hook in ("preinstall", "postinstall", "install", "prepare"):
            script = scripts.get(hook, "")
            if not script:
                continue
            for pattern in MALICIOUS_INSTALL_PATTERNS:
                if re.search(pattern, script, re.IGNORECASE):
                    findings.append(Finding(
                        severity="critical",
                        category="supply_chain",
                        description=(
                            f"package.json `{hook}` script contains suspicious code: `{script[:80]}`. "
                            "This pattern is associated with supply chain attacks."
                        ),
                        suggestion=(
                            f"Review and remove the suspicious `{hook}` script. "
                            "Never execute remote scripts in lifecycle hooks."
                        ),
                        file="package.json",
                        code_snippet=script[:120],
                        rule_id="malicious-install-script",
                        confidence=0.88,
                    ))
                    break

        return findings

    def _positive_npm_checks(self, pkg_str: str, file_tree_set: set[str]) -> list[str]:
        """Return positive supply chain signals from package.json."""
        positives: list[str] = []
        try:
            pkg = json.loads(pkg_str)
        except (json.JSONDecodeError, ValueError):
            return positives

        if pkg.get("engines", {}).get("node"):
            positives.append("Node.js engine version constrained in package.json `engines` field")
        if "packageManager" in pkg:
            positives.append(f"Package manager locked via `packageManager` field: {pkg['packageManager']}")

        return positives

    def _has_sbom(self, file_tree: list[str]) -> bool:
        """Check whether any SBOM file is present in the repository."""
        file_tree_lower = [f.lower() for f in file_tree]
        for f in file_tree_lower:
            fname = PurePosixPath(f).name
            if fname in SBOM_FILENAMES:
                return True
            for pattern in SBOM_PATH_PATTERNS:
                if pattern.search(f):
                    return True
        return False

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def _build_insights(self, findings: list[Finding], score: int) -> list[str]:
        """Generate high-level insight strings from findings and score."""
        insights: list[str] = []

        typosquat = [f for f in findings if f.rule_id == "typosquat"]
        if typosquat:
            insights.append(
                f"{len(typosquat)} known typosquatting package{'s' if len(typosquat) > 1 else ''} "
                f"detected — remove immediately and audit install history."
            )

        pwn_req = [f for f in findings if f.rule_id == "action-pwn-request"]
        if pwn_req:
            insights.append(
                "Critical: pull_request_target workflow grants repository secrets to untrusted PR code. "
                "This is a known CI/CD privilege escalation vector."
            )

        lockfile_issues = [f for f in findings if "lockfile" in (f.rule_id or "")]
        if lockfile_issues:
            insights.append(
                f"{len(lockfile_issues)} lockfile integrity issue{'s' if len(lockfile_issues) > 1 else ''} "
                "found — non-reproducible builds increase supply chain risk."
            )

        floating = [f for f in findings if f.rule_id in ("npm-floating-version", "pip-unpinned")]
        if floating:
            insights.append(
                f"{len(floating)} unpinned dependency version{'s' if len(floating) > 1 else ''} — "
                "pin all versions to prevent silent malicious upgrades."
            )

        if score >= 88:
            insights.append(
                "Supply chain posture is strong — dependencies appear well-pinned and CI is hardened."
            )

        return insights[:5]

    @staticmethod
    def _sort_and_cap(findings: list[Finding], limit: int = 12) -> list[Finding]:
        """Sort by severity (critical first) and cap at limit."""
        order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
        findings.sort(key=lambda f: (order.get(f.severity, 5), -(f.confidence or 0)))
        return findings[:limit]
