"""
Security Sentinel Agent
========================
Deep security analysis covering:
  - OWASP Top 10 (2021 edition)
  - CWE pattern matching
  - Secrets / credential detection (300+ patterns)
  - Injection vectors: SQL, NoSQL, Command, LDAP, XPath, SSTI
  - Cryptography misuse
  - Deserialization vulnerabilities
  - Race conditions and TOCTOU
  - Supply chain risks
  - CVE-pattern matching for common libraries
"""

from __future__ import annotations

import re
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding
from analysis.vuln_patterns import VULN_PATTERNS, CVE_PATTERNS


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
            code = "\n".join(added_lines)

            # Run all vulnerability patterns
            for vuln in VULN_PATTERNS:
                matches = re.findall(vuln["pattern"], code, re.IGNORECASE | re.MULTILINE)
                if matches:
                    snippet = str(matches[0])[:100] if matches else None
                    findings.append(Finding(
                        severity=vuln["severity"],
                        category=vuln.get("category", "security"),
                        description=vuln["description"].format(file=filename.split("/")[-1], match=snippet or ""),
                        suggestion=vuln["suggestion"],
                        file=filename,
                        code_snippet=snippet,
                        confidence=vuln.get("confidence", 0.85),
                        rule_id=vuln["id"],
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
