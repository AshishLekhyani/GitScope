"""
Documentation Auditor Agent
============================
Analyzes documentation quality across multiple dimensions:
  - API documentation coverage (JSDoc, docstrings, godoc)
  - README quality and completeness
  - CHANGELOG presence and Keep-a-Changelog format compliance
  - Code comment quality (ratio, TODOs, dead code in comments)
  - Type documentation (interfaces, TypedDicts, dataclasses)
  - OpenAPI/Swagger specification coverage
  - Inline example coverage (@example, Examples: section)
"""

from __future__ import annotations

import re
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

README_NAMES = {"README.md", "README.rst", "README.txt", "readme.md", "Readme.md"}
CHANGELOG_NAMES = {"CHANGELOG.md", "CHANGES.md", "HISTORY.md", "changelog.md", "changes.md", "CHANGELOG"}
OPENAPI_NAMES = {
    "openapi.yaml", "openapi.yml", "openapi.json",
    "swagger.yaml", "swagger.yml", "swagger.json",
    "api-docs.yaml", "api-docs.json", "api.yaml", "api.json",
}

README_SECTIONS = {
    "installation": [r"#+\s*install", r"#+\s*getting.started", r"#+\s*setup", r"#+\s*prerequisites"],
    "usage": [r"#+\s*usage", r"#+\s*how.to.use", r"#+\s*quick.start", r"#+\s*examples"],
    "api": [r"#+\s*api", r"#+\s*reference", r"#+\s*documentation"],
    "contributing": [r"#+\s*contributing", r"#+\s*contribution", r"#+\s*development"],
    "license": [r"#+\s*licen[sc]e", r"#+\s*licensing"],
    "examples": [r"#+\s*example", r"#+\s*demo", r"#+\s*sample"],
    "configuration": [r"#+\s*config", r"#+\s*environment", r"#+\s*env.var", r"#+\s*\.env"],
}

KEEP_A_CHANGELOG_UNRELEASED = re.compile(r"##\s*\[Unreleased\]", re.IGNORECASE)
KEEP_A_CHANGELOG_VERSION = re.compile(r"##\s*\[(\d+\.\d+\.\d+)\]\s*-\s*\d{4}-\d{2}-\d{2}")
SEMVER_PATTERN = re.compile(r"\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[\w.]+)?")
BADGE_PATTERN = re.compile(r"!\[.*?\]\(https?://.*?(?:shields\.io|badge|github\.com.*?/badge|actions/workflows).*?\)")
FENCED_CODE_BLOCK = re.compile(r"```[\w]*\n[\s\S]*?```", re.MULTILINE)
TOC_PATTERN = re.compile(r"#+\s*(?:table.of.contents|contents|toc)\b", re.IGNORECASE)

# TypeScript export + JSDoc detection
TS_EXPORT_FUNC = re.compile(
    r"(?:^|\n)[ \t]*export\s+(?:async\s+)?function\s+(\w+)",
    re.MULTILINE,
)
TS_EXPORT_ARROW = re.compile(
    r"(?:^|\n)[ \t]*export\s+(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(",
    re.MULTILINE,
)
TS_EXPORT_CLASS = re.compile(
    r"(?:^|\n)[ \t]*export\s+(?:abstract\s+)?class\s+(\w+)",
    re.MULTILINE,
)
JSDOC_BLOCK = re.compile(r"/\*\*[\s\S]*?\*/", re.MULTILINE)
JSDOC_BEFORE_EXPORT = re.compile(
    r"/\*\*[\s\S]*?\*/\s*(?:export\s+(?:async\s+)?function\s+(\w+)|export\s+(?:const|let)\s+(\w+)|export\s+(?:abstract\s+)?class\s+(\w+))",
    re.MULTILINE,
)

# Python docstring detection
PY_DEF = re.compile(r"^([ \t]*)def\s+(\w+)\s*\(", re.MULTILINE)
PY_CLASS = re.compile(r"^([ \t]*)class\s+(\w+)\s*[\(:]", re.MULTILINE)
PY_DOCSTRING = re.compile(r'^\s*(?:"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\')', re.MULTILINE)
PY_GOOGLE_EXAMPLES = re.compile(r"Examples?:\s*\n(?:[ \t]+.*\n)*", re.IGNORECASE)
PY_NUMPY_EXAMPLES = re.compile(r"Examples?\s*\n\s*-{3,}\s*\n", re.IGNORECASE)

# Go godoc detection
GO_EXPORTED_FUNC = re.compile(r"^func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)\s*\(", re.MULTILINE)
GO_GODOC = re.compile(r"//\s+[A-Z]\w+", re.MULTILINE)
GO_STRUCT = re.compile(r"^type\s+([A-Z]\w+)\s+struct\s*\{", re.MULTILINE)

# Comment patterns
COMMENT_LINE_TS = re.compile(r"^\s*//", re.MULTILINE)
COMMENT_BLOCK_TS = re.compile(r"/\*[\s\S]*?\*/", re.MULTILINE)
COMMENT_LINE_PY = re.compile(r"^\s*#", re.MULTILINE)
TODO_PATTERN = re.compile(r"\b(?:TODO|FIXME|HACK|XXX|TEMP|BUG|NOTE)\b\s*[:!]?\s*(.{0,80})", re.IGNORECASE)
COMMENTED_CODE_TS = re.compile(
    r"^\s*//\s*(?:const|let|var|function|class|return|if|for|while|import|export)\b",
    re.MULTILINE | re.IGNORECASE,
)
COMMENTED_CODE_PY = re.compile(
    r"^\s*#\s*(?:def |class |return |import |from |if |for |while |print\(|assert )",
    re.MULTILINE,
)
EMPTY_JSDOC = re.compile(r"/\*\*\s*\*/|/\*\*\s*\n\s*\*/", re.MULTILINE)
EMPTY_PYTHON_DOCSTRING = re.compile(r'"""[ \t]*"""|\'\'\'[ \t]*\'\'\'', re.MULTILINE)

# Stale comment signals
STALE_API_REFS = re.compile(
    r"//.*?(?:v\d+\.\d+|deprecated|old api|legacy|unused|no longer|was replaced|old method)\b",
    re.IGNORECASE,
)

# Type documentation
TS_INTERFACE = re.compile(r"(?:^|\n)[ \t]*(?:export\s+)?interface\s+(\w+)", re.MULTILINE)
TS_TYPE_ALIAS = re.compile(r"(?:^|\n)[ \t]*(?:export\s+)?type\s+(\w+)\s*=", re.MULTILINE)
TS_ENUM = re.compile(r"(?:^|\n)[ \t]*(?:export\s+)?enum\s+(\w+)", re.MULTILINE)
TS_COMPLEX_UNION = re.compile(r"type\s+\w+\s*=\s*(?:[^;|]+\|){2,}", re.MULTILINE)
PY_DATACLASS = re.compile(r"@dataclass\s*\n\s*class\s+(\w+)", re.MULTILINE)
PY_TYPEDDICT = re.compile(r"class\s+(\w+)\s*\(TypedDict\)", re.MULTILINE)
PY_PYDANTIC = re.compile(r"class\s+(\w+)\s*\((?:Base)?Model\)", re.MULTILINE)

# OpenAPI field checks
OPENAPI_OPERATION_ID = re.compile(r"operationId\s*:", re.IGNORECASE)
OPENAPI_DESCRIPTION = re.compile(r"description\s*:", re.IGNORECASE)
OPENAPI_TAGS = re.compile(r"tags\s*:", re.IGNORECASE)
OPENAPI_REQUEST_BODY = re.compile(r"requestBody\s*:", re.IGNORECASE)
OPENAPI_SCHEMA = re.compile(r"schema\s*:", re.IGNORECASE)

# Example detection
JSDOC_EXAMPLE = re.compile(r"@example\b", re.IGNORECASE)
EXAMPLE_USAGE_COMMENT = re.compile(r"//\s*[Ee]xample\s+usage\s*:", re.MULTILINE)

# New exported function patterns for diff scanning
TS_NEW_EXPORT_FUNC_PATTERN = re.compile(
    r"^export\s+(?:async\s+)?function\s+(\w+)",
    re.MULTILINE,
)
TS_NEW_EXPORT_CONST_FN = re.compile(
    r"^export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(",
    re.MULTILINE,
)
PY_NEW_PUBLIC_DEF = re.compile(
    r"^def\s+([a-zA-Z]\w*)\s*\(",
    re.MULTILINE,
)
PY_DOCSTRING_IMMEDIATELY = re.compile(
    r"def\s+\w+\s*\([^)]*\)(?:\s*->[^:]+)?:\s*\n\s*(?:\"\"\"|\'\'\')[\s\S]*?(?:\"\"\"|\'\'\')"
)


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _code_line_count(code: str) -> int:
    """Count non-empty, non-comment lines in code."""
    count = 0
    for line in code.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("//") and not stripped.startswith("#") and stripped != "*/":
            count += 1
    return max(count, 1)


def _extract_jsdoc_documented_names(code: str) -> set[str]:
    """Return set of function/class names that have a JSDoc block immediately above them."""
    documented: set[str] = set()
    for m in JSDOC_BEFORE_EXPORT.finditer(code):
        name = m.group(1) or m.group(2) or m.group(3)
        if name:
            documented.add(name)
    return documented


def _find_python_public_undocumented(code: str) -> list[str]:
    """
    Return names of public Python functions/methods that lack a docstring.
    A function is 'public' if its name does not start with an underscore.
    """
    undocumented: list[str] = []
    for m in PY_DEF.finditer(code):
        indent = m.group(1)
        name = m.group(2)
        if name.startswith("_"):
            continue  # skip private/dunder
        func_start = m.end()
        # Find the next non-blank line after the function signature
        rest = code[func_start:]
        # Skip to end of signature (handle multiline signatures)
        paren_depth = 0
        i = 0
        # fast forward past param list
        while i < len(rest) and (paren_depth > 0 or rest[i] != ":"):
            if rest[i] == "(":
                paren_depth += 1
            elif rest[i] == ")":
                paren_depth -= 1
            i += 1
        body_rest = rest[i + 1:] if i < len(rest) else ""
        # Find first non-whitespace content in body
        body_stripped = body_rest.lstrip()
        if body_stripped.startswith('"""') or body_stripped.startswith("'''"):
            pass  # has docstring
        else:
            undocumented.append(name)
    return undocumented


def _find_go_undocumented_exports(code: str) -> list[str]:
    """Return exported Go function names without a preceding godoc comment."""
    undocumented: list[str] = []
    lines = code.splitlines()
    for i, line in enumerate(lines):
        m = GO_EXPORTED_FUNC.match(line)
        if not m:
            continue
        name = m.group(1)
        # Look at the line immediately before
        prev_line = lines[i - 1].strip() if i > 0 else ""
        if not prev_line.startswith("//"):
            undocumented.append(name)
    return undocumented


def _language_from_filename(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    mapping = {
        "ts": "typescript", "tsx": "typescript",
        "js": "javascript", "jsx": "javascript",
        "mjs": "javascript", "cjs": "javascript",
        "py": "python",
        "go": "go",
        "java": "java",
        "rb": "ruby",
        "rs": "rust",
    }
    return mapping.get(ext, "unknown")


# ---------------------------------------------------------------------------
# Main Agent
# ---------------------------------------------------------------------------

class DocumentationAgent(BaseAgent):
    """
    Audits documentation completeness and quality for a repository or PR diff.

    Scoring baseline is 75.  Deductions and bonuses are applied based on the
    presence and quality of:  README, CHANGELOG, JSDoc/docstrings, OpenAPI specs,
    type documentation, inline examples, and comment hygiene.
    """

    agent_id = "documentation"
    agent_name = "Documentation Auditor"
    specialization = "API docs, JSDoc/docstrings, README quality, changelog, inline comments"

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()
        is_repo = context.get("analysis_type") == "repo"
        files = context.get("files", [])

        findings: list[Finding] = []
        positives: list[str] = []
        metadata: dict[str, Any] = {}

        if is_repo:
            findings, positives, metadata = self._scan_repo(context)
        else:
            findings, positives, metadata = self._scan_diff(files)

        # --- Score computation ---
        score = 75
        severity_weight = {"critical": 18, "high": 12, "medium": 7, "low": 3, "info": 1}
        for f in findings:
            score -= severity_weight.get(f.severity, 5)

        # Bonus from metadata signals
        score += metadata.get("score_bonus", 0)
        score = self._clamp(score)

        # --- Narrative insights ---
        insights: list[str] = []
        missing_jsdoc = [f for f in findings if f.rule_id in ("missing-jsdoc", "missing-docstring", "missing-godoc")]
        if missing_jsdoc:
            insights.append(
                f"{len(missing_jsdoc)} exported symbol{'s' if len(missing_jsdoc) > 1 else ''} lack "
                "documentation — public API consumers have no contract to rely on."
            )
        todo_findings = [f for f in findings if f.rule_id == "todo-comments"]
        if todo_findings:
            total_todos = sum(f.metadata.get("count", 1) if hasattr(f, "metadata") else 1 for f in todo_findings)
            insights.append(
                f"TODO/FIXME comments detected across files — unresolved technical debt markers "
                "should be tracked in an issue tracker, not buried in code."
            )
        if metadata.get("readme_score", 0) >= 60:
            insights.append("README quality is strong — covers key onboarding sections.")
        elif metadata.get("has_readme"):
            insights.append("README exists but could be expanded with more sections and examples.")
        if metadata.get("openapi_found"):
            insights.append("OpenAPI specification detected — great for API consumers and tooling integration.")
        if score >= 80:
            insights.append("Documentation quality is healthy — keep the standard high as the codebase grows.")
        elif score < 50:
            insights.append(
                "Documentation quality needs significant investment — "
                "consider a documentation sprint before the next major release."
            )

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.82,
            findings=findings[:12],
            insights=insights,
            positives=positives,
            metadata=metadata,
        ))

    # ------------------------------------------------------------------
    # Diff scanning (PR review mode)
    # ------------------------------------------------------------------

    def _scan_diff(self, files: list[dict]) -> tuple[list[Finding], list[str], dict]:
        findings: list[Finding] = []
        positives: list[str] = []
        score_bonus = 0
        total_added_funcs = 0
        documented_added_funcs = 0

        for file in files:
            fname = file.get("filename", "unknown")
            patch = file.get("patch", "") or ""
            added_lines = "\n".join(
                line[1:] for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            )
            if not added_lines.strip():
                continue

            lang = _language_from_filename(fname)

            if lang in ("typescript", "javascript"):
                findings_f, total, documented = self._diff_check_ts(added_lines, fname)
                findings.extend(findings_f)
                total_added_funcs += total
                documented_added_funcs += documented

            elif lang == "python":
                findings_f, total, documented = self._diff_check_python(added_lines, fname)
                findings.extend(findings_f)
                total_added_funcs += total
                documented_added_funcs += documented

            elif lang == "go":
                findings_f, total, documented = self._diff_check_go(added_lines, fname)
                findings.extend(findings_f)
                total_added_funcs += total
                documented_added_funcs += documented

            # Generic: check for TODO/FIXME in added lines
            todo_matches = TODO_PATTERN.findall(added_lines)
            if todo_matches:
                findings.append(Finding(
                    severity="low",
                    category="quality",
                    file=fname,
                    description=f"{len(todo_matches)} TODO/FIXME comment{'s' if len(todo_matches) > 1 else ''} added in `{fname}` — unresolved work markers committed to the branch.",
                    suggestion="Track these as GitHub issues and remove the inline comments. If the work is incomplete, consider a stash or draft PR.",
                    rule_id="todo-comments",
                    confidence=0.95,
                ))

            # Check for commented-out code in added lines
            if lang in ("typescript", "javascript"):
                cc_matches = COMMENTED_CODE_TS.findall(added_lines)
                if len(cc_matches) >= 2:
                    findings.append(Finding(
                        severity="low",
                        category="quality",
                        file=fname,
                        description=f"Possible commented-out code detected in `{fname}` ({len(cc_matches)} suspicious comment lines). Dead code in comments adds noise.",
                        suggestion="Remove commented-out code — version control preserves history. If it's temporarily disabled, add a clear explanation.",
                        rule_id="commented-dead-code",
                        confidence=0.75,
                    ))
            elif lang == "python":
                cc_matches = COMMENTED_CODE_PY.findall(added_lines)
                if len(cc_matches) >= 2:
                    findings.append(Finding(
                        severity="low",
                        category="quality",
                        file=fname,
                        description=f"Possible commented-out code detected in `{fname}` ({len(cc_matches)} suspicious comment lines).",
                        suggestion="Remove dead commented code. Use `git stash` or branches to preserve experimental work instead.",
                        rule_id="commented-dead-code",
                        confidence=0.72,
                    ))

        # Positive signals from diff
        if total_added_funcs > 0:
            doc_ratio = documented_added_funcs / total_added_funcs
            if doc_ratio >= 0.8:
                positives.append(
                    f"New exported functions are well-documented ({documented_added_funcs}/{total_added_funcs} have JSDoc/docstrings)"
                )
                score_bonus += 5
            elif doc_ratio >= 0.5:
                positives.append(
                    f"Partial documentation on new exports ({documented_added_funcs}/{total_added_funcs} documented)"
                )

        has_doc_file_change = any(
            file.get("filename", "").endswith((".md", ".rst", ".txt"))
            for file in files
        )
        if has_doc_file_change:
            positives.append("Documentation files updated alongside code changes — good discipline")
            score_bonus += 3

        return findings, positives, {"score_bonus": score_bonus}

    def _diff_check_ts(self, added: str, fname: str) -> tuple[list[Finding], int, int]:
        """Check TypeScript/JavaScript added lines for undocumented exports."""
        findings: list[Finding] = []
        # Collect all exported function/class names in added lines
        exported_names: list[str] = []
        for m in TS_NEW_EXPORT_FUNC_PATTERN.finditer(added):
            exported_names.append(m.group(1))
        for m in TS_NEW_EXPORT_CONST_FN.finditer(added):
            exported_names.append(m.group(1))

        documented = _extract_jsdoc_documented_names(added)
        undocumented = [n for n in exported_names if n not in documented]

        for name in undocumented:
            is_private_convention = name.startswith("_") or name[0].islower()
            severity = "medium" if not is_private_convention else "low"
            findings.append(Finding(
                severity=severity,
                category="quality",
                file=fname,
                description=f"New exported function `{name}` in `{fname}` lacks JSDoc documentation.",
                suggestion=(
                    f"Add a JSDoc block above `{name}` with @param, @returns, and @throws tags. "
                    "Public API functions without docs create friction for consumers and break IDE IntelliSense."
                ),
                rule_id="missing-jsdoc",
                confidence=0.88,
            ))

        return findings, len(exported_names), len(exported_names) - len(undocumented)

    def _diff_check_python(self, added: str, fname: str) -> tuple[list[Finding], int, int]:
        """Check Python added lines for public functions without docstrings."""
        findings: list[Finding] = []
        undocumented = _find_python_public_undocumented(added)
        total = len(PY_DEF.findall(added))
        public_count = len([m for m in PY_DEF.finditer(added) if not m.group(2).startswith("_")])

        for name in undocumented:
            findings.append(Finding(
                severity="medium",
                category="quality",
                file=fname,
                description=f"New public function `{name}` in `{fname}` lacks a docstring.",
                suggestion=(
                    f"Add a Google or NumPy-style docstring to `{name}` describing its purpose, "
                    "Args, Returns, and Raises. Tools like Sphinx and mkdocstrings rely on these."
                ),
                rule_id="missing-docstring",
                confidence=0.87,
            ))

        documented_count = public_count - len(undocumented)
        return findings, public_count, max(0, documented_count)

    def _diff_check_go(self, added: str, fname: str) -> tuple[list[Finding], int, int]:
        """Check Go added lines for exported functions without godoc comments."""
        findings: list[Finding] = []
        undocumented = _find_go_undocumented_exports(added)
        total_exports = len(GO_EXPORTED_FUNC.findall(added))

        for name in undocumented:
            findings.append(Finding(
                severity="medium",
                category="quality",
                file=fname,
                description=f"Exported Go function `{name}` in `{fname}` lacks a godoc comment.",
                suggestion=(
                    f"Add `// {name} <description starting with the function name>` immediately above the func declaration. "
                    "godoc generates package documentation from these comments — they are part of the public API contract."
                ),
                rule_id="missing-godoc",
                confidence=0.85,
            ))

        return findings, total_exports, total_exports - len(undocumented)

    # ------------------------------------------------------------------
    # Repository scanning (full-repo mode)
    # ------------------------------------------------------------------

    def _scan_repo(self, context: dict) -> tuple[list[Finding], list[str], dict]:
        findings: list[Finding] = []
        positives: list[str] = []
        score_bonus = 0

        file_tree: list[str] = context.get("file_tree", [])
        contents: dict[str, str] = context.get("key_file_contents", {})

        # 1. README analysis
        readme_result = self._find_and_analyze_readme(file_tree, contents)
        findings.extend(readme_result["findings"])
        positives.extend(readme_result["positives"])
        score_bonus += readme_result["score_delta"]

        # 2. CHANGELOG analysis
        changelog_result = self._analyze_changelog(file_tree, contents)
        findings.extend(changelog_result["findings"])
        positives.extend(changelog_result["positives"])
        score_bonus += changelog_result["score_delta"]

        # 3. OpenAPI/Swagger analysis
        openapi_result = self._analyze_openapi(file_tree, contents)
        findings.extend(openapi_result["findings"])
        positives.extend(openapi_result["positives"])
        score_bonus += openapi_result["score_delta"]

        # 4. Source file documentation ratio
        src_result = self._analyze_source_doc_coverage(file_tree, contents)
        findings.extend(src_result["findings"])
        positives.extend(src_result["positives"])
        score_bonus += src_result["score_delta"]

        # 5. Comment quality across key files
        comment_results = self._analyze_repo_comments(file_tree, contents)
        findings.extend(comment_results["findings"])
        positives.extend(comment_results["positives"])

        # 6. Type documentation
        type_results = self._analyze_repo_types(file_tree, contents)
        findings.extend(type_results["findings"])
        positives.extend(type_results["positives"])
        score_bonus += type_results["score_delta"]

        metadata = {
            "score_bonus": score_bonus,
            "has_readme": readme_result.get("has_readme", False),
            "readme_score": readme_result.get("readme_score", 0),
            "has_changelog": changelog_result.get("has_changelog", False),
            "changelog_format": changelog_result.get("format", "unknown"),
            "openapi_found": openapi_result.get("found", False),
            "doc_coverage_ratio": src_result.get("coverage_ratio", 0.0),
            "readme_sections_found": readme_result.get("sections_found", []),
        }
        return findings, positives, metadata

    # ------------------------------------------------------------------
    # README analysis
    # ------------------------------------------------------------------

    def _find_and_analyze_readme(self, file_tree: list[str], contents: dict) -> dict:
        """Find and analyze the repository README, returning findings and score delta."""
        readme_content = ""
        readme_file = None
        for name in README_NAMES:
            if name in file_tree or name in contents:
                readme_file = name
                readme_content = contents.get(name, "")
                break
        # Fallback: search by prefix
        if not readme_file:
            for f in file_tree:
                if f.lower().startswith("readme"):
                    readme_file = f
                    readme_content = contents.get(f, "")
                    break

        findings: list[Finding] = []
        positives: list[str] = []
        score_delta = 0

        if not readme_file or not readme_content.strip():
            findings.append(Finding(
                severity="high",
                category="quality",
                description="No README file found. README is the front door of any project — without it, contributors and users have no starting point.",
                suggestion="Create a README.md with at minimum: project name, brief description, installation, and usage sections. Aim for 500+ characters.",
                rule_id="no-readme",
                confidence=0.97,
            ))
            score_delta -= 20
            return {"findings": findings, "positives": positives, "score_delta": score_delta,
                    "has_readme": False, "readme_score": 0, "sections_found": []}

        analysis = self._analyze_readme(readme_content)
        readme_score = analysis["score"]
        sections_found = analysis["sections_found"]
        has_badge = analysis["has_badges"]
        has_code = analysis["has_code_examples"]
        has_toc = analysis["has_toc"]
        length = analysis["length"]

        if length < 200:
            findings.append(Finding(
                severity="high",
                category="quality",
                file=readme_file,
                description=f"README is extremely sparse ({length} characters). It provides almost no value to readers.",
                suggestion="Expand the README to cover: description, installation steps, usage examples, configuration options, and contributing guidelines.",
                rule_id="readme-too-short",
                confidence=0.95,
            ))
            score_delta -= 15
        elif length < 500:
            findings.append(Finding(
                severity="medium",
                category="quality",
                file=readme_file,
                description=f"README is minimal ({length} characters). Key sections appear to be missing.",
                suggestion="A good README should be at least 500 characters. Add usage examples, configuration, and contribution instructions.",
                rule_id="readme-minimal",
                confidence=0.88,
            ))
            score_delta -= 5

        if "installation" not in sections_found and "usage" not in sections_found:
            findings.append(Finding(
                severity="medium",
                category="quality",
                file=readme_file,
                description="README is missing Installation and Usage sections — the two most critical onboarding sections.",
                suggestion="Add `## Installation` with copy-paste commands and `## Usage` with working code examples.",
                rule_id="readme-missing-core-sections",
                confidence=0.90,
            ))
        elif "installation" not in sections_found:
            findings.append(Finding(
                severity="low",
                category="quality",
                file=readme_file,
                description="README is missing an Installation section.",
                suggestion="Add `## Installation` with step-by-step commands (npm install, pip install, etc.).",
                rule_id="readme-no-install",
                confidence=0.85,
            ))
        elif "usage" not in sections_found:
            findings.append(Finding(
                severity="low",
                category="quality",
                file=readme_file,
                description="README is missing a Usage section.",
                suggestion="Add `## Usage` with real, working code examples that demonstrate the primary use case.",
                rule_id="readme-no-usage",
                confidence=0.85,
            ))

        if "contributing" not in sections_found:
            findings.append(Finding(
                severity="low",
                category="quality",
                file=readme_file,
                description="README has no Contributing section — potential contributors don't know the workflow.",
                suggestion="Add `## Contributing` explaining how to fork, branch, make changes, and submit PRs. Link to a CONTRIBUTING.md if one exists.",
                rule_id="readme-no-contributing",
                confidence=0.80,
            ))

        if "license" not in sections_found:
            findings.append(Finding(
                severity="low",
                category="quality",
                file=readme_file,
                description="README doesn't mention the license — users don't know the legal terms for usage.",
                suggestion="Add a `## License` section. Even a single line like `MIT License — see LICENSE file.` is sufficient.",
                rule_id="readme-no-license",
                confidence=0.82,
            ))

        if not has_code:
            findings.append(Finding(
                severity="low",
                category="quality",
                file=readme_file,
                description="README has no fenced code examples. Docs without examples are far less useful.",
                suggestion="Add fenced code blocks (` ```language ... ``` `) demonstrating key usage patterns.",
                rule_id="readme-no-code-examples",
                confidence=0.85,
            ))

        # Positives
        if readme_score >= 60:
            positives.append("README covers installation, usage, and contributing")
            score_delta += 10
        if has_badge:
            positives.append("README includes status badges — quick project health overview")
        if has_code:
            positives.append("README includes code examples — lowers the barrier to entry")
        if has_toc:
            positives.append("README has table of contents — easy navigation for long docs")
        if length >= 2000:
            positives.append(f"README is comprehensive ({length} characters)")

        return {
            "findings": findings, "positives": positives, "score_delta": score_delta,
            "has_readme": True, "readme_score": readme_score, "sections_found": sections_found,
        }

    def _analyze_readme(self, content: str) -> dict:
        """
        Perform detailed quality analysis on README content.

        Scores based on:
        - Section presence (+10 per section)
        - Code examples (+15)
        - Badges (+5)
        - Table of contents (+5 for long docs)
        - Overall length
        """
        score = 0
        sections_found: list[str] = []
        content_lower = content.lower()

        for section_key, patterns in README_SECTIONS.items():
            for p in patterns:
                if re.search(p, content_lower):
                    sections_found.append(section_key)
                    score += 10
                    break

        has_code_examples = bool(FENCED_CODE_BLOCK.search(content))
        if has_code_examples:
            score += 15

        has_badges = bool(BADGE_PATTERN.search(content))
        if has_badges:
            score += 5

        has_toc = bool(TOC_PATTERN.search(content))
        if has_toc:
            score += 5

        length = len(content)
        if length >= 2000:
            score += 10
        elif length >= 500:
            score += 5

        return {
            "score": score,
            "sections_found": sections_found,
            "has_code_examples": has_code_examples,
            "has_badges": has_badges,
            "has_toc": has_toc,
            "length": length,
        }

    # ------------------------------------------------------------------
    # CHANGELOG analysis
    # ------------------------------------------------------------------

    def _analyze_changelog(self, file_tree: list[str], contents: dict) -> dict:
        """
        Detect and quality-check the project CHANGELOG.

        Returns structured dict with findings, positives, score_delta, has_changelog, format.
        """
        findings: list[Finding] = []
        positives: list[str] = []
        score_delta = 0
        changelog_content = ""
        changelog_file = None

        for name in CHANGELOG_NAMES:
            if name in file_tree or name in contents:
                changelog_file = name
                changelog_content = contents.get(name, "")
                break

        # Also check for GitHub Releases page reference in README
        readme_content = contents.get("README.md", "") or contents.get("readme.md", "")
        has_releases_link = bool(re.search(r"github\.com/.+/releases", readme_content, re.IGNORECASE))

        if not changelog_file:
            if has_releases_link:
                positives.append("Project uses GitHub Releases for changelog tracking")
                # Partial credit — GitHub Releases is acceptable but not ideal for offline review
                score_delta -= 3
            else:
                findings.append(Finding(
                    severity="medium",
                    category="quality",
                    description="No CHANGELOG file found. Without a changelog, users can't determine what changed between versions.",
                    suggestion=(
                        "Create CHANGELOG.md following the Keep a Changelog format (https://keepachangelog.com). "
                        "Use sections: [Unreleased], [x.y.z] - YYYY-MM-DD with Added/Changed/Deprecated/Removed/Fixed/Security."
                    ),
                    rule_id="no-changelog",
                    confidence=0.93,
                ))
                score_delta -= 10
            return {
                "findings": findings, "positives": positives, "score_delta": score_delta,
                "has_changelog": False, "format": "none",
            }

        # Changelog found — analyze quality
        has_unreleased = bool(KEEP_A_CHANGELOG_UNRELEASED.search(changelog_content))
        version_entries = KEEP_A_CHANGELOG_VERSION.findall(changelog_content)
        has_semver_entries = len(version_entries) > 0
        num_versions = len(version_entries)

        changelog_format = "unknown"
        if has_unreleased and has_semver_entries:
            changelog_format = "keep-a-changelog"
        elif has_semver_entries:
            changelog_format = "semver-dated"
        elif SEMVER_PATTERN.search(changelog_content):
            changelog_format = "semver-unstructured"
        else:
            changelog_format = "freeform"

        if changelog_format == "keep-a-changelog":
            positives.append("CHANGELOG follows Keep a Changelog format with semantic versioning")
            score_delta += 10
        elif changelog_format == "semver-dated":
            positives.append(f"CHANGELOG uses semantic versioning with {num_versions} tagged versions")
            score_delta += 5
            findings.append(Finding(
                severity="info",
                category="quality",
                file=changelog_file,
                description="CHANGELOG uses semantic versioning but is missing the `## [Unreleased]` section.",
                suggestion="Add `## [Unreleased]` at the top to capture in-progress changes before the next release.",
                rule_id="changelog-no-unreleased",
                confidence=0.80,
            ))
        else:
            findings.append(Finding(
                severity="low",
                category="quality",
                file=changelog_file,
                description="CHANGELOG doesn't follow the Keep a Changelog format — inconsistent structure makes it harder to scan.",
                suggestion="Restructure using: `## [Unreleased]` + `## [x.y.z] - YYYY-MM-DD` with subsections: Added, Changed, Fixed, Removed, Security.",
                rule_id="changelog-bad-format",
                confidence=0.78,
            ))

        if len(changelog_content.strip()) < 200:
            findings.append(Finding(
                severity="low",
                category="quality",
                file=changelog_file,
                description="CHANGELOG is nearly empty — it exists but contains almost no history.",
                suggestion="Start populating the CHANGELOG with entries for past releases. Even 2–3 bullet points per version helps users understand the evolution.",
                rule_id="changelog-empty",
                confidence=0.88,
            ))

        if num_versions > 0 and changelog_format == "unknown":
            positives.append(f"CHANGELOG is present with {num_versions} version entries")
        elif num_versions > 5:
            positives.append(f"CHANGELOG documents {num_versions} release versions — comprehensive history")

        return {
            "findings": findings, "positives": positives, "score_delta": score_delta,
            "has_changelog": True, "format": changelog_format,
        }

    # ------------------------------------------------------------------
    # Code comment quality
    # ------------------------------------------------------------------

    def _analyze_comments(self, code: str, language: str) -> dict:
        """
        Compute comment quality metrics for a block of source code.

        Returns:
            ratio: float — comment lines / total lines
            todo_count: int
            dead_code_count: int — suspicious commented-out code lines
            empty_docstring_count: int
            stale_ref_count: int
            quality: str — 'good' | 'sparse' | 'overdone'
        """
        lines = code.splitlines()
        total_lines = max(len(lines), 1)

        comment_lines = 0
        todo_count = 0
        dead_code_count = 0
        empty_docstring_count = 0
        stale_ref_count = 0

        if language in ("typescript", "javascript"):
            # Single-line comments
            single = COMMENT_LINE_TS.findall(code)
            comment_lines += len(single)
            # Block comments
            for block in COMMENT_BLOCK_TS.finditer(code):
                comment_lines += block.group().count("\n") + 1
            # Dead code in comments
            dead_code_count = len(COMMENTED_CODE_TS.findall(code))
            # Empty JSDoc
            empty_docstring_count = len(EMPTY_JSDOC.findall(code))
            # Stale refs
            stale_ref_count = len(STALE_API_REFS.findall(code))

        elif language == "python":
            comment_lines = len(COMMENT_LINE_PY.findall(code))
            dead_code_count = len(COMMENTED_CODE_PY.findall(code))
            empty_docstring_count = len(EMPTY_PYTHON_DOCSTRING.findall(code))
            stale_ref_count = len(STALE_API_REFS.findall(code))

        else:
            # Generic: count lines starting with common comment markers
            for line in lines:
                stripped = line.strip()
                if stripped.startswith(("//", "#", "--", "/*", "*")):
                    comment_lines += 1

        todo_count = len(TODO_PATTERN.findall(code))
        ratio = comment_lines / total_lines

        if ratio < 0.05:
            quality = "sparse"
        elif ratio > 0.5:
            quality = "overdone"
        elif 0.1 <= ratio <= 0.3:
            quality = "good"
        else:
            quality = "acceptable"

        return {
            "ratio": round(ratio, 3),
            "todo_count": todo_count,
            "dead_code_count": dead_code_count,
            "empty_docstring_count": empty_docstring_count,
            "stale_ref_count": stale_ref_count,
            "quality": quality,
            "comment_lines": comment_lines,
            "total_lines": total_lines,
        }

    def _analyze_repo_comments(self, file_tree: list[str], contents: dict) -> dict:
        """Aggregate comment quality analysis across all available source files."""
        findings: list[Finding] = []
        positives: list[str] = []
        all_ratios: list[float] = []
        total_todos = 0
        total_dead = 0
        total_empty_docs = 0
        files_analyzed = 0

        source_exts = (".ts", ".tsx", ".js", ".jsx", ".py", ".go")

        for filepath, code in contents.items():
            if not any(filepath.endswith(ext) for ext in source_exts):
                continue
            if not code or not code.strip():
                continue

            lang = _language_from_filename(filepath)
            metrics = self._analyze_comments(code, lang)
            all_ratios.append(metrics["ratio"])
            total_todos += metrics["todo_count"]
            total_dead += metrics["dead_code_count"]
            total_empty_docs += metrics["empty_docstring_count"]
            files_analyzed += 1

            if metrics["quality"] == "sparse" and len(code.splitlines()) > 50:
                findings.append(Finding(
                    severity="low",
                    category="quality",
                    file=filepath,
                    description=f"`{filepath}` has a very low comment ratio ({metrics['ratio']:.1%}). Complex logic without explanation is a future maintenance burden.",
                    suggestion="Aim for 10–30% comment coverage. Add explanatory comments above non-obvious logic, not above obvious statements.",
                    rule_id="sparse-comments",
                    confidence=0.75,
                ))

            if metrics["empty_docstring_count"] > 0:
                findings.append(Finding(
                    severity="low",
                    category="quality",
                    file=filepath,
                    description=f"`{filepath}` has {metrics['empty_docstring_count']} empty docstring(s)/JSDoc block(s). Empty docs are worse than no docs — they set false expectations.",
                    suggestion="Either fill in the documentation or remove the empty block. Stub docs like `\"\"\"TODO\"\"\"` are acceptable during development but should be resolved before merge.",
                    rule_id="empty-docstrings",
                    confidence=0.92,
                ))

            if metrics["stale_ref_count"] > 0:
                findings.append(Finding(
                    severity="info",
                    category="quality",
                    file=filepath,
                    description=f"`{filepath}` may contain stale comments referencing deprecated APIs or old versions.",
                    suggestion="Review comments mentioning version numbers, 'deprecated', or 'old API' to ensure they are still accurate.",
                    rule_id="stale-comments",
                    confidence=0.65,
                ))

        if total_todos > 10:
            findings.append(Finding(
                severity="medium",
                category="quality",
                description=f"Repository contains {total_todos} TODO/FIXME/HACK comments across source files — significant untracked technical debt.",
                suggestion="Audit all TODOs and convert them to GitHub issues with priority labels. Set a policy: no new TODOs without a linked issue.",
                rule_id="excessive-todos",
                confidence=0.90,
            ))
        elif total_todos > 3:
            findings.append(Finding(
                severity="low",
                category="quality",
                description=f"{total_todos} TODO/FIXME comments present in the codebase — track these in your issue tracker.",
                suggestion="Link each TODO to a GitHub issue or convert it to a task in your project board.",
                rule_id="todo-backlog",
                confidence=0.88,
            ))

        if total_dead >= 10:
            findings.append(Finding(
                severity="low",
                category="quality",
                description=f"Significant amount of commented-out code detected across files (~{total_dead} lines). Commented code creates confusion and inflates file size.",
                suggestion="Remove dead code — version control history preserves it. Use branches or feature flags for work-in-progress code.",
                rule_id="commented-code-repo",
                confidence=0.70,
            ))

        if files_analyzed > 0:
            avg_ratio = sum(all_ratios) / len(all_ratios)
            if 0.1 <= avg_ratio <= 0.3:
                positives.append(f"Average comment density is healthy ({avg_ratio:.1%}) — good balance of code and explanation")
            elif avg_ratio > 0.3:
                positives.append(f"Well-commented codebase ({avg_ratio:.1%} comment density)")

        return {"findings": findings, "positives": positives}

    # ------------------------------------------------------------------
    # Type documentation analysis
    # ------------------------------------------------------------------

    def _analyze_types(self, code: str, language: str) -> dict:
        """
        Analyze documentation coverage for type definitions.

        Returns:
            total: int — total type definitions found
            documented: int — type definitions with JSDoc/docstrings above them
            undocumented_names: list[str]
            complex_union_count: int — complex union types without comments
        """
        total = 0
        documented = 0
        undocumented_names: list[str] = []
        complex_union_count = 0

        if language in ("typescript", "javascript"):
            interfaces = TS_INTERFACE.findall(code)
            type_aliases = TS_TYPE_ALIAS.findall(code)
            enums = TS_ENUM.findall(code)
            all_types = interfaces + type_aliases + enums
            total = len(all_types)

            # Check each for a JSDoc block immediately above it
            for pattern in (TS_INTERFACE, TS_TYPE_ALIAS, TS_ENUM):
                for m in pattern.finditer(code):
                    name = m.group(1)
                    # Check if there's a JSDoc block ending right before this match
                    preceding = code[:m.start()].rstrip()
                    if preceding.endswith("*/"):
                        documented += 1
                    else:
                        undocumented_names.append(name)

            # Complex unions
            complex_union_count = len(TS_COMPLEX_UNION.findall(code))

        elif language == "python":
            dataclasses = PY_DATACLASS.findall(code)
            typeddicts = PY_TYPEDDICT.findall(code)
            pydantic = PY_PYDANTIC.findall(code)
            all_types = dataclasses + typeddicts + pydantic
            total = len(all_types)

            # For Python types, check if the class body starts with a docstring
            for pattern in (PY_DATACLASS, PY_TYPEDDICT, PY_PYDANTIC):
                for m in pattern.finditer(code):
                    name = m.group(1)
                    class_start = m.start()
                    # Find the class body
                    body_start = code.find(":", class_start)
                    if body_start == -1:
                        undocumented_names.append(name)
                        continue
                    body_rest = code[body_start + 1:].lstrip()
                    if body_rest.startswith('"""') or body_rest.startswith("'''"):
                        documented += 1
                    else:
                        undocumented_names.append(name)

        elif language == "go":
            structs = GO_STRUCT.findall(code)
            total = len(structs)
            lines = code.splitlines()
            for i, line in enumerate(lines):
                m = GO_STRUCT.match(line)
                if not m:
                    continue
                name = m.group(1)
                prev_line = lines[i - 1].strip() if i > 0 else ""
                if prev_line.startswith("//"):
                    documented += 1
                else:
                    undocumented_names.append(name)

        return {
            "total": total,
            "documented": documented,
            "undocumented_names": undocumented_names,
            "complex_union_count": complex_union_count,
        }

    def _analyze_repo_types(self, file_tree: list[str], contents: dict) -> dict:
        """Run type documentation analysis across all source files in the repo."""
        findings: list[Finding] = []
        positives: list[str] = []
        score_delta = 0

        grand_total = 0
        grand_documented = 0
        total_complex_unions = 0

        source_exts = (".ts", ".tsx", ".js", ".py", ".go")
        for filepath, code in contents.items():
            if not any(filepath.endswith(ext) for ext in source_exts):
                continue
            if not code or not code.strip():
                continue

            lang = _language_from_filename(filepath)
            type_info = self._analyze_types(code, lang)
            grand_total += type_info["total"]
            grand_documented += type_info["documented"]
            total_complex_unions += type_info.get("complex_union_count", 0)

            if type_info["undocumented_names"] and type_info["total"] > 0:
                # Only report files with more than a couple of undocumented types
                if len(type_info["undocumented_names"]) >= 2:
                    sample = ", ".join(f"`{n}`" for n in type_info["undocumented_names"][:4])
                    more = f" (+{len(type_info['undocumented_names']) - 4} more)" if len(type_info["undocumented_names"]) > 4 else ""
                    findings.append(Finding(
                        severity="low",
                        category="quality",
                        file=filepath,
                        description=f"`{filepath}` has {len(type_info['undocumented_names'])} undocumented type definitions: {sample}{more}.",
                        suggestion="Add JSDoc blocks (TypeScript) or docstrings (Python) above each exported type. Document: purpose, usage context, and any constraints on fields.",
                        rule_id="undocumented-types",
                        confidence=0.80,
                    ))

        if grand_total > 0:
            doc_ratio = grand_documented / grand_total
            if doc_ratio < 0.4:
                findings.append(Finding(
                    severity="medium",
                    category="quality",
                    description=f"Only {doc_ratio:.0%} of type definitions ({grand_documented}/{grand_total}) have documentation. Types are the primary API contract — they should be self-documenting.",
                    suggestion="Prioritize documenting exported interfaces, type aliases, and enums. Add JSDoc above each with `@description`, `@example`, and field-level `/** ... */` comments.",
                    rule_id="low-type-doc-coverage",
                    confidence=0.82,
                ))
                score_delta -= 10
            elif doc_ratio >= 0.8:
                positives.append(f"Strong type documentation coverage ({doc_ratio:.0%}) — types serve as living API contracts")
                score_delta += 5
        else:
            # No type definitions found — could be a JS project or scripts
            pass

        if total_complex_unions >= 3:
            findings.append(Finding(
                severity="low",
                category="quality",
                description=f"{total_complex_unions} complex union types detected without descriptive comments. Complex types without explanation are hard to consume correctly.",
                suggestion="Add a JSDoc block above complex union types explaining the meaning of each variant and when each should be used.",
                rule_id="undocumented-complex-types",
                confidence=0.75,
            ))

        return {"findings": findings, "positives": positives, "score_delta": score_delta}

    # ------------------------------------------------------------------
    # OpenAPI / Swagger analysis
    # ------------------------------------------------------------------

    def _analyze_openapi(self, file_tree: list[str], contents: dict) -> dict:
        """
        Detect OpenAPI/Swagger spec files and evaluate their completeness.

        Returns dict with: found, findings, positives, score_delta.
        """
        findings: list[Finding] = []
        positives: list[str] = []
        score_delta = 0
        found = False
        spec_file = None
        spec_content = ""

        for name in OPENAPI_NAMES:
            if name in file_tree or name in contents:
                found = True
                spec_file = name
                spec_content = contents.get(name, "")
                break
        # Also check nested paths
        if not found:
            for f in file_tree:
                fname = f.rsplit("/", 1)[-1].lower()
                if fname in {n.lower() for n in OPENAPI_NAMES}:
                    found = True
                    spec_file = f
                    spec_content = contents.get(f, "")
                    break

        # Check for FastAPI/Express route definitions in source files
        has_fastapi = any("@app.get" in (contents.get(f, "") or "") or "@router." in (contents.get(f, "") or "")
                          for f in file_tree if f.endswith(".py"))
        has_express = any("app.get(" in (contents.get(f, "") or "") or "router.get(" in (contents.get(f, "") or "")
                          for f in file_tree if f.endswith((".js", ".ts")))

        if not found:
            if has_fastapi or has_express:
                findings.append(Finding(
                    severity="medium",
                    category="quality",
                    description="API routes detected but no OpenAPI/Swagger specification found. Without an OpenAPI spec, API consumers lack a machine-readable contract.",
                    suggestion=(
                        "Generate an OpenAPI spec: FastAPI does this automatically at `/docs` and `/openapi.json`. "
                        "For Express, use `swagger-jsdoc` + `swagger-ui-express`. "
                        "Commit the spec file as `openapi.yaml` for version tracking."
                    ),
                    rule_id="missing-openapi",
                    confidence=0.85,
                ))
                score_delta -= 5
            # No API routes — not applicable
            return {"found": False, "findings": findings, "positives": positives, "score_delta": score_delta}

        # Spec found — quality check
        score_delta += 15
        positives.append("OpenAPI/Swagger specification documents all API endpoints")

        if spec_content:
            missing_operation_ids = not bool(OPENAPI_OPERATION_ID.search(spec_content))
            missing_descriptions = not bool(OPENAPI_DESCRIPTION.search(spec_content))
            missing_tags = not bool(OPENAPI_TAGS.search(spec_content))
            missing_request_schema = bool(OPENAPI_REQUEST_BODY.search(spec_content)) and not bool(OPENAPI_SCHEMA.search(spec_content))

            if missing_operation_ids:
                findings.append(Finding(
                    severity="low",
                    category="quality",
                    file=spec_file,
                    description="OpenAPI spec has no `operationId` fields. Without operationIds, SDK generators produce generic method names.",
                    suggestion="Add a unique `operationId` to every path operation. Convention: `{verb}{Resource}` e.g. `listUsers`, `createOrder`.",
                    rule_id="openapi-no-operation-id",
                    confidence=0.88,
                ))

            if missing_descriptions:
                findings.append(Finding(
                    severity="low",
                    category="quality",
                    file=spec_file,
                    description="OpenAPI spec has no `description` fields. API consumers rely on descriptions to understand endpoint behavior.",
                    suggestion="Add `description` to each path operation, parameter, and schema field. Descriptions appear in Swagger UI and generated SDK docs.",
                    rule_id="openapi-no-descriptions",
                    confidence=0.85,
                ))

            if missing_tags:
                findings.append(Finding(
                    severity="info",
                    category="quality",
                    file=spec_file,
                    description="OpenAPI spec has no `tags` grouping. Tags organize operations in Swagger UI into logical sections.",
                    suggestion="Add `tags: [ResourceName]` to each operation. Use the top-level `tags` array to provide tag descriptions.",
                    rule_id="openapi-no-tags",
                    confidence=0.80,
                ))

            if missing_request_schema:
                findings.append(Finding(
                    severity="medium",
                    category="quality",
                    file=spec_file,
                    description="OpenAPI spec has `requestBody` definitions but missing schema documentation — request payloads are undocumented.",
                    suggestion="Add `schema: $ref: '#/components/schemas/YourModel'` inside each `requestBody.content` section.",
                    rule_id="openapi-missing-request-schema",
                    confidence=0.80,
                ))

            # Count path operations as a rough completeness check
            path_count = len(re.findall(r"^\s+/([\w{}/-]+):", spec_content, re.MULTILINE))
            if path_count > 0:
                positives.append(f"OpenAPI spec covers {path_count} API path{'s' if path_count > 1 else ''}")

        return {"found": True, "findings": findings, "positives": positives, "score_delta": score_delta}

    # ------------------------------------------------------------------
    # Inline example coverage
    # ------------------------------------------------------------------

    def _check_examples(self, code: str) -> dict:
        """
        Detect inline usage examples embedded in documentation.

        Counts:
        - @example tags in JSDoc blocks
        - Python docstrings with Examples section (Google or NumPy style)
        - "Example usage:" inline comments
        - Test files used as living documentation
        """
        jsdoc_examples = len(JSDOC_EXAMPLE.findall(code))
        google_examples = len(PY_GOOGLE_EXAMPLES.findall(code))
        numpy_examples = len(PY_NUMPY_EXAMPLES.findall(code))
        example_comments = len(EXAMPLE_USAGE_COMMENT.findall(code))

        total = jsdoc_examples + google_examples + numpy_examples + example_comments
        return {
            "total": total,
            "jsdoc_examples": jsdoc_examples,
            "google_style_examples": google_examples,
            "numpy_style_examples": numpy_examples,
            "example_comments": example_comments,
        }

    # ------------------------------------------------------------------
    # Source file documentation ratio (overall)
    # ------------------------------------------------------------------

    def _analyze_source_doc_coverage(self, file_tree: list[str], contents: dict) -> dict:
        """
        Compute the ratio of documented exported symbols to total exported symbols
        across all source files in the repository.
        """
        findings: list[Finding] = []
        positives: list[str] = []
        score_delta = 0

        total_exports = 0
        documented_exports = 0
        total_examples = 0
        files_with_examples = 0

        source_exts = (".ts", ".tsx", ".js", ".jsx", ".py", ".go")
        for filepath, code in contents.items():
            if not any(filepath.endswith(ext) for ext in source_exts):
                continue
            if not code or not code.strip():
                continue
            if "test" in filepath or "spec" in filepath or "__tests__" in filepath:
                continue  # skip test files

            lang = _language_from_filename(filepath)

            if lang in ("typescript", "javascript"):
                exports = TS_EXPORT_FUNC.findall(code) + TS_EXPORT_ARROW.findall(code) + TS_EXPORT_CLASS.findall(code)
                total_exports += len(exports)
                documented_names = _extract_jsdoc_documented_names(code)
                documented_exports += sum(1 for name in exports if name in documented_names)

            elif lang == "python":
                public_defs = [m.group(2) for m in PY_DEF.finditer(code) if not m.group(2).startswith("_")]
                total_exports += len(public_defs)
                undoc = _find_python_public_undocumented(code)
                documented_exports += len(public_defs) - len(undoc)

            elif lang == "go":
                exports = GO_EXPORTED_FUNC.findall(code) + GO_STRUCT.findall(code)
                total_exports += len(exports)
                undoc = _find_go_undocumented_exports(code)
                documented_exports += len(exports) - len(undoc)

            # Example coverage
            example_data = self._check_examples(code)
            if example_data["total"] > 0:
                files_with_examples += 1
                total_examples += example_data["total"]

        coverage_ratio = (documented_exports / total_exports) if total_exports > 0 else 1.0
        api_coverage_score = coverage_ratio * 100

        if total_exports > 0:
            if coverage_ratio < 0.30:
                findings.append(Finding(
                    severity="high",
                    category="quality",
                    description=f"Only {coverage_ratio:.0%} of exported public API ({documented_exports}/{total_exports} symbols) has documentation. This makes the library nearly unusable without reading source code.",
                    suggestion=(
                        "Prioritize adding JSDoc/docstrings to all exported functions and classes. "
                        "Start with the most-used public APIs. Tools like `typedoc` (TS) and `sphinx` (Python) generate docs from these."
                    ),
                    rule_id="critical-doc-gap",
                    confidence=0.90,
                ))
                score_delta -= 15
            elif coverage_ratio < 0.60:
                findings.append(Finding(
                    severity="medium",
                    category="quality",
                    description=f"Documentation coverage is {coverage_ratio:.0%} ({documented_exports}/{total_exports} exported symbols documented). Below the recommended 80% threshold.",
                    suggestion="Allocate documentation debt as regular backlog items. Aim to document at least all exported functions in the core module.",
                    rule_id="low-doc-coverage",
                    confidence=0.88,
                ))
                score_delta -= 8
            elif coverage_ratio >= 0.85:
                positives.append(f"JSDoc/docstrings present on {coverage_ratio:.0%} of exported public API")
                score_delta += 8
            elif coverage_ratio >= 0.70:
                positives.append(f"Good documentation coverage — {coverage_ratio:.0%} of exported symbols documented")
                score_delta += 3

        if total_examples > 0:
            positives.append(f"Codebase includes {total_examples} inline usage examples across {files_with_examples} files")
        elif total_exports > 10:
            findings.append(Finding(
                severity="info",
                category="quality",
                description="No inline usage examples (@example, Examples: section) found in the codebase. Examples dramatically improve API usability.",
                suggestion=(
                    "Add @example blocks to JSDoc for TypeScript, or Examples sections (Google/NumPy style) to Python docstrings. "
                    "Runnable examples in docs reduce support burden."
                ),
                rule_id="no-inline-examples",
                confidence=0.80,
            ))

        return {
            "findings": findings,
            "positives": positives,
            "score_delta": score_delta,
            "coverage_ratio": round(coverage_ratio, 3),
            "api_coverage_score": round(api_coverage_score, 1),
            "total_exports": total_exports,
            "documented_exports": documented_exports,
        }
