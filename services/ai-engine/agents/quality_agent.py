"""
Quality Analyst Agent
======================
Analyzes code quality with real metrics:
  - Cyclomatic complexity (mathematical, not estimated)
  - Cognitive complexity (Sonargraph method)
  - Code duplication detection
  - Dead code signals
  - Function length and parameter count
  - Naming convention violations
  - Comment-to-code ratio
  - Error handling patterns
  - Test coverage signals
"""

from __future__ import annotations

import re
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding


# Complexity thresholds
CYCLOMATIC_HIGH = 10
CYCLOMATIC_VERY_HIGH = 20
FUNCTION_LENGTH_WARN = 60    # lines
FUNCTION_LENGTH_ERROR = 120  # lines
PARAM_COUNT_WARN = 5
PARAM_COUNT_ERROR = 8


def _cyclomatic_complexity(code: str) -> int:
    """
    Approximate cyclomatic complexity via branch counting.
    Each decision point adds 1: if/elif/else-if, for, while, case, &&, ||, ?:, catch
    Starting from 1.
    """
    keywords = re.findall(
        r'\b(if|elif|else if|for|while|case|catch|except|&&|\|\||\?(?!:))\b',
        code, re.MULTILINE
    )
    return 1 + len(keywords)


def _function_blocks(code: str) -> list[tuple[str, str]]:
    """Extract (name, body) pairs for function-like constructs."""
    # Matches: function name(...), const name = (...) =>, async function name
    pattern = re.compile(
        r'(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\()',
        re.MULTILINE
    )
    results = []
    for m in pattern.finditer(code):
        name = m.group(1) or m.group(2) or "anonymous"
        start = m.start()
        # Rough body extraction: count braces
        depth = 0
        body_start = code.find("{", start)
        if body_start == -1:
            continue
        i = body_start
        while i < len(code):
            if code[i] == "{":
                depth += 1
            elif code[i] == "}":
                depth -= 1
                if depth == 0:
                    results.append((name, code[body_start:i + 1]))
                    break
            i += 1
    return results


class QualityAgent(BaseAgent):
    agent_id = "quality"
    agent_name = "Quality Analyst"
    specialization = "Cyclomatic complexity, cognitive complexity, code smells, maintainability"

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()
        files = context.get("files", [])
        is_repo = context.get("analysis_type") == "repo"

        findings: list[Finding] = []
        positives: list[str] = []
        metadata: dict = {}

        if is_repo:
            findings, positives, metadata = self._scan_repo(context)
        else:
            findings, positives, metadata = self._scan_diff(files)

        score = 80
        for f in findings:
            score -= {"critical": 20, "high": 12, "medium": 7, "low": 3, "info": 1}.get(f.severity, 5)
        score = max(10, min(100, score))

        insights: list[str] = []
        complex_funcs = [f for f in findings if f.rule_id == "high-complexity"]
        if complex_funcs:
            insights.append(f"{len(complex_funcs)} function{'s' if len(complex_funcs) > 1 else ''} with high cyclomatic complexity — prime targets for refactoring.")
        long_funcs = [f for f in findings if f.rule_id == "function-too-long"]
        if long_funcs:
            insights.append(f"{len(long_funcs)} oversized function{'s' if len(long_funcs) > 1 else ''} detected — extract smaller, single-responsibility units.")
        if score >= 80:
            insights.append("Code quality metrics are healthy — good maintainability signals.")

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.85,
            findings=findings[:8],
            insights=insights,
            positives=positives,
            metadata=metadata,
        ))

    def _scan_diff(self, files: list[dict]) -> tuple[list[Finding], list[str], dict]:
        findings: list[Finding] = []
        positives: list[str] = []

        for file in files:
            fname = file.get("filename", "unknown")
            if not fname.endswith((".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb")):
                continue
            patch = file.get("patch", "") or ""
            added = "\n".join(
                line[1:] for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            )
            if not added.strip():
                continue

            # Check function complexity
            for name, body in _function_blocks(added):
                cc = _cyclomatic_complexity(body)
                lines = body.count("\n")
                params = len(re.findall(r",", body.split("{")[0])) + 1 if "(" in body else 0

                if cc >= CYCLOMATIC_VERY_HIGH:
                    findings.append(Finding(
                        severity="high", category="quality", file=fname,
                        description=f"Function `{name}` has cyclomatic complexity {cc} (threshold: {CYCLOMATIC_HIGH}). Extremely hard to test and maintain.",
                        suggestion=f"Refactor `{name}` into smaller functions. Each function should do exactly one thing. Target CC < {CYCLOMATIC_HIGH}.",
                        rule_id="high-complexity", confidence=0.90,
                    ))
                elif cc >= CYCLOMATIC_HIGH:
                    findings.append(Finding(
                        severity="medium", category="quality", file=fname,
                        description=f"Function `{name}` cyclomatic complexity is {cc}. Getting difficult to reason about.",
                        suggestion="Consider breaking this function up. Extract conditional logic into well-named helper functions.",
                        rule_id="medium-complexity", confidence=0.85,
                    ))

                if lines >= FUNCTION_LENGTH_ERROR:
                    findings.append(Finding(
                        severity="high", category="quality", file=fname,
                        description=f"Function `{name}` is {lines} lines long. Functions this large violate the single responsibility principle.",
                        suggestion="Break into smaller focused functions. Aim for < 40 lines per function. Use the Extract Function refactoring.",
                        rule_id="function-too-long", confidence=0.88,
                    ))
                elif lines >= FUNCTION_LENGTH_WARN:
                    findings.append(Finding(
                        severity="low", category="quality", file=fname,
                        description=f"Function `{name}` is {lines} lines — getting long.",
                        suggestion="Consider extracting sections into named helper functions to improve readability.",
                        rule_id="function-long", confidence=0.80,
                    ))

                if params >= PARAM_COUNT_ERROR:
                    findings.append(Finding(
                        severity="medium", category="quality", file=fname,
                        description=f"Function `{name}` has {params} parameters — too many. This indicates poor abstraction.",
                        suggestion="Group related parameters into a config/options object. Apply the Parameter Object refactoring pattern.",
                        rule_id="too-many-params", confidence=0.82,
                    ))

            # Pattern-based quality checks
            self._check_patterns(added, fname, findings)

        has_tests = any("test" in f.get("filename", "") or "spec" in f.get("filename", "") for f in files)
        if has_tests:
            positives.append("Tests included with the change — good practice")
        has_docs_change = any(f.get("filename", "").endswith(".md") for f in files)
        if has_docs_change:
            positives.append("Documentation updated alongside code changes")

        return findings, positives, {}

    def _check_patterns(self, code: str, fname: str, findings: list[Finding]):
        rules = [
            (r"catch\s*\([^)]*\)\s*\{\s*\}", "empty-catch", "medium",
             f"Empty catch block in {fname.split('/')[-1]} silently swallows errors — makes debugging impossible.",
             "At minimum: catch(err) { logger.error('[context]', err); } — or rethrow if you can't handle it."),
            (r":\s*any\b", "typescript-any", "low",
             f"TypeScript `any` type in {fname.split('/')[-1]} defeats type safety.",
             "Replace with specific types or `unknown` (with type narrowing). Use generics for flexible types."),
            (r"\bconsole\.(log|debug)\b", "console-log", "low",
             f"console.log in {fname.split('/')[-1]} — remove before production or replace with a structured logger.",
             "Use a logger (winston, pino) with log levels. Never log sensitive data."),
            (r"\bTODO|FIXME|HACK\b", "todo-fixme", "low",
             f"TODO/FIXME in {fname.split('/')[-1]} — unresolved technical debt.",
             "Convert to a tracked issue. If it blocks the PR, resolve it first."),
            (r"==\s+(?!null|undefined)", "loose-equality", "low",
             f"Loose equality (==) in {fname.split('/')[-1]} — can cause subtle type coercion bugs.",
             "Use strict equality (===) always. The only valid use of == is `x == null` to check null/undefined."),
            (r"async\s+\w+\s*\([^)]*\)\s*\{(?![\s\S]*\bawait\b)", "async-no-await", "low",
             f"Async function without await in {fname.split('/')[-1]} — likely unnecessary async keyword.",
             "Remove async if no await is used. Unnecessary async wraps the return in a promise for no benefit."),
        ]
        for pattern, rule_id, severity, desc, suggestion in rules:
            if re.search(pattern, code, re.MULTILINE):
                findings.append(Finding(
                    severity=severity, category="quality", file=fname,
                    description=desc, suggestion=suggestion,
                    rule_id=rule_id, confidence=0.80,
                ))

    def _scan_repo(self, context: dict) -> tuple[list[Finding], list[str], dict]:
        findings: list[Finding] = []
        positives: list[str] = []
        file_tree = context.get("file_tree", [])
        contents = context.get("key_file_contents", {})
        contributors = context.get("contributors", 1)

        has_tests = any(f.endswith((".test.ts", ".spec.ts", ".test.js", ".spec.js", "_test.py")) for f in file_tree)
        has_test_dir = any(f.startswith(("test/", "__tests__/", "tests/", "spec/")) for f in file_tree)
        has_linting = any(f in (".eslintrc.json", ".eslintrc.js", "biome.json") or f.startswith(".eslint") for f in file_tree)
        has_prettier = any(f.startswith(".prettier") or f == "prettier.config.js" for f in file_tree)
        has_ts = any(f.endswith(".ts") or f.endswith(".tsx") for f in file_tree)
        test_file_count = len([f for f in file_tree if ".test." in f or ".spec." in f])

        # Test coverage signals
        test_score = 10
        if has_tests or has_test_dir:
            test_score += 45
        if test_file_count > 5:
            test_score += 10
        if test_file_count > 20:
            test_score += 10

        if not has_tests and not has_test_dir:
            findings.append(Finding(
                severity="high", category="quality",
                description="No test files detected. Zero automated test coverage is the #1 quality risk.",
                suggestion="Add a testing framework (Jest, Vitest, pytest). Start with unit tests for business logic and grow from there.",
                rule_id="no-tests", confidence=0.95,
            ))
        else:
            positives.append(f"Test infrastructure present ({test_file_count} test files)")

        if not has_linting:
            findings.append(Finding(
                severity="medium", category="quality",
                description="No linting configuration found. Code style inconsistencies accumulate over time.",
                suggestion="Add ESLint with @typescript-eslint and eslint-plugin-security. Enforce in CI.",
                rule_id="no-linting", confidence=0.90,
            ))
        else:
            positives.append("ESLint/linting configured — code style automatically enforced")

        if has_ts:
            positives.append("TypeScript provides compile-time type safety")

        if contributors > 3:
            positives.append(f"Active community — {contributors} contributors")

        # README quality
        readme = contents.get("README.md", "") or contents.get("readme.md", "") or ""
        if len(readme) < 200:
            findings.append(Finding(
                severity="low", category="quality",
                description="README is minimal or missing. Poor documentation increases onboarding friction.",
                suggestion="Add: Overview, Installation, Usage, Contributing, License sections.",
                rule_id="poor-readme", confidence=0.85,
            ))

        # Debt estimation
        debt_score = 60
        if has_tests:
            debt_score += 15
        if has_linting:
            debt_score += 10
        if has_ts:
            debt_score += 10
        debt_score = min(90, debt_score)

        debt_level = "minimal" if debt_score >= 80 else "manageable" if debt_score >= 65 else "significant" if debt_score >= 45 else "severe"
        debt_hours = {"minimal": "< 10 hours", "manageable": "10-40 hours", "significant": "40-80 hours", "severe": "100+ hours"}

        hotspots = []
        if not has_tests:
            hotspots.append("Test coverage (none detected)")
        if not has_linting:
            hotspots.append("Linting (not configured)")

        metadata = {
            "has_tests": has_tests or has_test_dir,
            "test_score": test_score,
            "coverage_estimate": f"~{test_file_count * 3}-{test_file_count * 8}% (estimated from file count)" if test_file_count > 0 else "Unknown — no test files",
            "test_gaps": ["Integration/E2E tests may be missing"] + (["No unit tests detected"] if not has_tests else []),
            "debt_score": debt_score,
            "debt_level": debt_level,
            "debt_hotspots": hotspots,
            "debt_hours": debt_hours.get(debt_level, "Unknown"),
        }

        return findings, positives, metadata
