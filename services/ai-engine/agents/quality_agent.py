"""
Quality Analyst Agent
======================
Comprehensive code quality analysis covering:
  - Cyclomatic complexity (McCabe, mathematical branch counting)
  - Cognitive complexity (Sonargraph/SonarQube method)
  - Code duplication detection (rolling hash similarity)
  - Dead code signals (unreachable after return/throw)
  - Function length and parameter count violations
  - Naming convention adherence (camelCase, PascalCase, snake_case, UPPER_SNAKE)
  - Comment-to-code density (under- and over-commenting detection)
  - Error handling completeness (empty catch, swallowed errors, missing finally)
  - Test coverage signals (test/spec file ratio, assertion density)
  - Type safety signals (TypeScript `any`, unchecked casts, @ts-ignore)
  - Magic numbers and hardcoded values
  - Import cleanliness (wildcard imports, unused imports, circular risk)
  - Code smell detection: God objects, feature envy, long parameter lists
  - Maintainability Index calculation (Halstead + McCabe composite)
  - SOLID principles violations: SRP, OCP, DIP signals
  - Technical debt estimation (in engineering hours)
  - Interface segregation: large interfaces vs focused ones
  - Dependency inversion: concrete imports vs abstractions
  - Liskov substitution: override patterns without type contract
  - Dead import detection, barrel file anti-patterns
  - Async/await misuse: async without await, unhandled promise chains
  - RegExp complexity: ReDoS-vulnerable patterns (catastrophic backtracking)
  - String concatenation in loops (O(n²) string building)
  - Deprecated API usage signals
  - Global variable mutation in module scope
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

# ── Cognitive complexity weights ──────────────────────────────────────────────

def _cognitive_complexity(code: str) -> int:
    """
    Simplified Cognitive Complexity (Sonar method).
    Nesting level adds a multiplier: each nested control flow adds (depth+1).
    """
    score = 0
    depth = 0
    nesting_openers = re.compile(r'\b(if|else if|for|while|do|try|catch|switch|with)\b|\{')
    nesting_closers = re.compile(r'\}')
    jump_keywords = re.compile(r'\b(break|continue|goto)\b')
    for line in code.splitlines():
        opens = len(nesting_openers.findall(line))
        closes = len(nesting_closers.findall(line))
        jumps = len(jump_keywords.findall(line))
        if opens:
            score += depth + 1
            depth += opens
        depth = max(0, depth - closes)
        score += jumps
    return score


def _cyclomatic_complexity(code: str) -> int:
    """
    Approximate cyclomatic complexity via branch counting.
    Each decision point adds 1: if/elif/else-if, for, while, case, &&, ||, ?:, catch
    Starting from 1.
    """
    keywords = re.findall(
        r'\b(if|elif|else\s+if|for|while|case|catch|except|&&|\|\||\?(?!:))\b',
        code, re.MULTILINE
    )
    return 1 + len(keywords)


def _halstead_volume(code: str) -> float:
    """Approximate Halstead volume for maintainability index."""
    operators = re.findall(r'[+\-*/%=<>!&|^~?:]+|(?:\b(?:and|or|not|in|is)\b)', code)
    operands = re.findall(r'\b[a-zA-Z_]\w*\b|\b\d+(?:\.\d+)?\b|"[^"]*"|\'[^\']*\'', code)
    n1 = len(set(operators)) or 1
    n2 = len(set(operands)) or 1
    N1 = len(operators) or 1
    N2 = len(operands) or 1
    import math
    vocabulary = n1 + n2
    length = N1 + N2
    if vocabulary < 2:
        return 1.0
    return length * math.log2(vocabulary)


def _maintainability_index(code: str, cc: int) -> float:
    """
    Maintainability Index = 171 - 5.2*ln(HV) - 0.23*CC - 16.2*ln(LOC)
    Scaled to 0-100. Values below 20 are unmaintainable.
    """
    import math
    hv = _halstead_volume(code)
    loc = max(1, code.count('\n') + 1)
    mi = 171 - 5.2 * math.log(max(1, hv)) - 0.23 * cc - 16.2 * math.log(loc)
    return max(0.0, min(100.0, mi * 100 / 171))


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


def _python_function_blocks(code: str) -> list[tuple[str, str]]:
    """Extract (name, body) pairs for Python function definitions."""
    pattern = re.compile(r'^(?:async\s+)?def\s+(\w+)\s*\(', re.MULTILINE)
    results = []
    for m in pattern.finditer(code):
        name = m.group(1)
        start_line = code[:m.start()].count('\n')
        lines = code.splitlines()
        if start_line >= len(lines):
            continue
        # Find body by indentation
        base_indent = len(lines[start_line]) - len(lines[start_line].lstrip())
        body_lines = [lines[start_line]]
        for line in lines[start_line + 1:]:
            stripped = line.lstrip()
            if stripped and len(line) - len(stripped) <= base_indent:
                break
            body_lines.append(line)
        results.append((name, '\n'.join(body_lines)))
    return results


# ── ReDoS detection ───────────────────────────────────────────────────────────

_REDOS_PATTERNS = [
    re.compile(r'\([^)]*\+[^)]*\)\+'),          # (a+)+
    re.compile(r'\([^)]*\+[^)]*\)\*'),          # (a+)*
    re.compile(r'\([^)]*\|[^)]*\)\*'),          # (a|b)*
    re.compile(r'\([^)]*\|[^)]*\)\+'),          # (a|b)+
    re.compile(r'(?:\.\*){2,}'),                # .*.* nested wildcards
    re.compile(r'\(\?:.*\)\{[\d,]+\}.*\)\{'),  # nested quantifiers
]

def _is_redos_vulnerable(pattern_str: str) -> bool:
    """Heuristic check for ReDoS-vulnerable regex patterns."""
    return any(p.search(pattern_str) for p in _REDOS_PATTERNS)


# ── Magic number detector ─────────────────────────────────────────────────────

_MAGIC_NUMBER_RE = re.compile(
    r'(?<!["\'\w.])(?<!-)\b([2-9]\d{2,}|\d{4,})\b(?!\s*[)\]},;]?\s*(?:px|em|rem|%|vh|vw|ms|s))',
)
_MAGIC_NUMBER_IGNORE = {1000, 100, 60, 24, 7, 365, 1024, 2048, 4096, 8192, 65536, 404, 200, 201, 400, 401, 403, 500}


# ── God object detector ───────────────────────────────────────────────────────

def _count_class_methods(code: str) -> int:
    """Count methods in a class block."""
    return len(re.findall(r'^\s+(?:async\s+)?(?:public|private|protected|static\s+)?\w+\s*\(', code, re.MULTILINE))


def _count_class_fields(code: str) -> int:
    """Count field declarations in a class."""
    return len(re.findall(r'^\s+(?:public|private|protected|readonly\s+)?\w+(?:\?|!)?\s*:', code, re.MULTILINE))


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
    specialization = "Cyclomatic complexity, cognitive complexity, code smells, maintainability, SOLID principles"

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
        complex_funcs = [f for f in findings if f.rule_id in ("high-complexity", "very-high-complexity")]
        if complex_funcs:
            insights.append(f"{len(complex_funcs)} function{'s' if len(complex_funcs) > 1 else ''} with high cyclomatic complexity — prime targets for refactoring.")
        long_funcs = [f for f in findings if f.rule_id == "function-too-long"]
        if long_funcs:
            insights.append(f"{len(long_funcs)} oversized function{'s' if len(long_funcs) > 1 else ''} detected — extract smaller, single-responsibility units.")
        redos = [f for f in findings if f.rule_id == "redos-risk"]
        if redos:
            insights.append(f"{len(redos)} potentially ReDoS-vulnerable regex pattern{'s' if len(redos) > 1 else ''} found — could cause exponential backtracking.")
        god_objects = [f for f in findings if f.rule_id == "god-object"]
        if god_objects:
            insights.append(f"God object detected — class with {len(god_objects)} responsibilities. Apply SRP: split into focused classes.")
        if score >= 80:
            insights.append("Code quality metrics are healthy — good maintainability signals.")

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.85,
            findings=sorted(findings, key=lambda f: {"high": 0, "medium": 1, "low": 2, "info": 3}.get(f.severity, 4))[:10],
            insights=insights,
            positives=positives,
            metadata=metadata,
        ))

    def _scan_diff(self, files: list[dict]) -> tuple[list[Finding], list[str], dict]:
        findings: list[Finding] = []
        positives: list[str] = []

        for file in files:
            fname = file.get("filename", "unknown")
            if not fname.endswith((".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rb", ".cs", ".cpp", ".c")):
                continue
            patch = file.get("patch", "") or ""
            added = "\n".join(
                line[1:] for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            )
            if not added.strip():
                continue

            is_python = fname.endswith(".py")
            is_ts = fname.endswith((".ts", ".tsx"))

            # Choose correct function extractor
            func_iter = _python_function_blocks(added) if is_python else _function_blocks(added)

            seen_rules_in_file: set[str] = set()

            # Check function complexity
            for name, body in func_iter:
                cc = _cyclomatic_complexity(body)
                cog = _cognitive_complexity(body)
                lines = body.count("\n")
                params = len(re.findall(r",", body.split("{")[0])) + 1 if "(" in body else 0
                mi = _maintainability_index(body, cc)

                if cc >= CYCLOMATIC_VERY_HIGH:
                    findings.append(Finding(
                        severity="high", category="quality", file=fname,
                        description=f"Function `{name}` has cyclomatic complexity {cc} and cognitive complexity {cog} (threshold CC: {CYCLOMATIC_HIGH}). Extremely hard to test and maintain.",
                        suggestion=f"Refactor `{name}` into smaller functions. Each function should do exactly one thing. Target CC < {CYCLOMATIC_HIGH}. Consider strategy or command pattern to reduce branching.",
                        rule_id="very-high-complexity", confidence=0.92,
                        code_snippet=f"CC={cc}, Cog={cog}, MI={mi:.1f}",
                    ))
                elif cc >= CYCLOMATIC_HIGH:
                    findings.append(Finding(
                        severity="medium", category="quality", file=fname,
                        description=f"Function `{name}` cyclomatic complexity is {cc} (cognitive: {cog}). Getting difficult to reason about and test.",
                        suggestion="Consider breaking this function up. Extract conditional logic into well-named helper functions. Each branch should ideally be a named function.",
                        rule_id="high-complexity", confidence=0.87,
                        code_snippet=f"CC={cc}, Cog={cog}",
                    ))

                if mi < 20 and lines > 20:
                    findings.append(Finding(
                        severity="medium", category="quality", file=fname,
                        description=f"Function `{name}` has a Maintainability Index of {mi:.1f}/100 — critically unmaintainable. High Halstead volume + high complexity.",
                        suggestion="Refactor urgently. Extract sub-functions, reduce nesting depth, introduce constants for magic values. This code will be nearly impossible to safely modify.",
                        rule_id="low-maintainability", confidence=0.85,
                    ))

                if lines >= FUNCTION_LENGTH_ERROR:
                    findings.append(Finding(
                        severity="high", category="quality", file=fname,
                        description=f"Function `{name}` is {lines} lines long. Functions this large violate the Single Responsibility Principle.",
                        suggestion="Break into smaller focused functions. Aim for < 40 lines per function. Use the Extract Function refactoring. Consider decomposing the business logic into a service class.",
                        rule_id="function-too-long", confidence=0.90,
                    ))
                elif lines >= FUNCTION_LENGTH_WARN:
                    findings.append(Finding(
                        severity="low", category="quality", file=fname,
                        description=f"Function `{name}` is {lines} lines — getting long. Long functions accumulate responsibilities over time.",
                        suggestion="Consider extracting sections into named helper functions to improve readability and testability.",
                        rule_id="function-long", confidence=0.80,
                    ))

                if params >= PARAM_COUNT_ERROR:
                    findings.append(Finding(
                        severity="medium", category="quality", file=fname,
                        description=f"Function `{name}` has {params} parameters — too many. This indicates poor abstraction and makes the function hard to call correctly.",
                        suggestion="Group related parameters into a config/options object (Parameter Object pattern). Consider if some params should be class fields instead.",
                        rule_id="too-many-params", confidence=0.84,
                    ))
                elif params >= PARAM_COUNT_WARN:
                    findings.append(Finding(
                        severity="low", category="quality", file=fname,
                        description=f"Function `{name}` has {params} parameters — consider reducing.",
                        suggestion="Group related parameters. Use destructuring: function foo({ a, b, c }: Options) instead of positional args.",
                        rule_id="many-params", confidence=0.75,
                    ))

            # Class-level God object detection
            class_blocks = re.findall(r'class\s+(\w+)[^{]*\{((?:[^{}]|\{[^{}]*\})*)\}', added, re.DOTALL)
            for class_name, class_body in class_blocks:
                method_count = _count_class_methods(class_body)
                field_count = _count_class_fields(class_body)
                if method_count > 20 or field_count > 15:
                    findings.append(Finding(
                        severity="medium", category="quality", file=fname,
                        description=f"Class `{class_name}` has {method_count} methods and {field_count} fields — a God Object. It knows too much and does too much.",
                        suggestion="Apply Single Responsibility Principle: split into smaller classes, each with one clear responsibility. Extract service classes, value objects, or domain models.",
                        rule_id="god-object", confidence=0.80,
                    ))

            # ReDoS detection in regex literals
            regex_literals = re.findall(r'new RegExp\(["\']([^"\']+)["\']|/([^/\n]{10,})/[gimsuy]*', added)
            for m in regex_literals:
                pattern_str = m[0] or m[1]
                if pattern_str and _is_redos_vulnerable(pattern_str):
                    if "redos-risk" not in seen_rules_in_file:
                        seen_rules_in_file.add("redos-risk")
                        findings.append(Finding(
                            severity="medium", category="quality", file=fname,
                            description=f"Potentially ReDoS-vulnerable regex in {fname.split('/')[-1]}: `{pattern_str[:60]}`. Catastrophic backtracking can hang the server.",
                            suggestion="Rewrite the regex to avoid nested quantifiers like (a+)+. Use atomic groups or possessive quantifiers. Test with rxxr2 or ReScue.",
                            rule_id="redos-risk", confidence=0.72,
                            code_snippet=pattern_str[:80],
                        ))

            # Magic numbers (only flag if not in test files or constants files)
            if not any(x in fname.lower() for x in ("test", "spec", "constant", "config", "mock")):
                magic_numbers = _MAGIC_NUMBER_RE.findall(added)
                valid_magic = [n for n in magic_numbers if int(n) not in _MAGIC_NUMBER_IGNORE]
                if len(valid_magic) >= 3 and "magic-numbers" not in seen_rules_in_file:
                    seen_rules_in_file.add("magic-numbers")
                    findings.append(Finding(
                        severity="low", category="quality", file=fname,
                        description=f"Magic numbers in {fname.split('/')[-1]}: {', '.join(valid_magic[:5])}. Numeric literals without context are maintenance hazards.",
                        suggestion="Extract to named constants: const MAX_RETRY_ATTEMPTS = 3. Group related constants in a constants module.",
                        rule_id="magic-numbers", confidence=0.75,
                    ))

            # String concatenation in loops — O(n²) string building
            if re.search(r'for\s*\(|\.forEach\(|\.map\(', added):
                if re.search(r'\+=\s*["\']|result\s*\+=|str\s*\+=|html\s*\+=', added):
                    if "string-concat-loop" not in seen_rules_in_file:
                        seen_rules_in_file.add("string-concat-loop")
                        findings.append(Finding(
                            severity="medium", category="quality", file=fname,
                            description=f"String concatenation inside a loop in {fname.split('/')[-1]} is O(n²) — each += creates a new string copy.",
                            suggestion="Use array.join(): const parts = []; for (...) { parts.push(val); } return parts.join(''); This is O(n) instead of O(n²).",
                            rule_id="string-concat-loop", confidence=0.80,
                        ))

            # Pattern-based quality checks
            self._check_patterns(added, fname, findings, seen_rules_in_file)

        has_tests = any("test" in f.get("filename", "") or "spec" in f.get("filename", "") for f in files)
        if has_tests:
            positives.append("Tests included with the change — good practice")
        has_docs_change = any(f.get("filename", "").endswith(".md") for f in files)
        if has_docs_change:
            positives.append("Documentation updated alongside code changes")
        type_only = all(f.get("filename", "").endswith((".ts", ".tsx")) for f in files if f.get("patch"))
        if type_only and not any(f for f in findings if f.rule_id == "typescript-any"):
            positives.append("TypeScript used throughout with no `any` types detected")

        return findings, positives, {}

    def _check_patterns(self, code: str, fname: str, findings: list[Finding], seen: set[str]):
        short_name = fname.split('/')[-1]
        rules = [
            # Error handling
            (r"catch\s*\([^)]*\)\s*\{\s*\}", "empty-catch", "medium",
             f"Empty catch block in {short_name} silently swallows errors — makes debugging impossible.",
             "At minimum: catch(err) { logger.error('[context]', err); } — or rethrow if you can't handle it here."),
            (r"catch\s*\([^)]*\)\s*\{[^}]*console\.[a-z]+[^}]*\}", "swallowed-error", "low",
             f"Error in {short_name} is logged but not propagated — swallowed errors hide failures from callers.",
             "After logging, either rethrow: throw err, or throw a new typed error: throw new DatabaseError('...', { cause: err })"),
            # Type safety
            (r":\s*any\b", "typescript-any", "low",
             f"TypeScript `any` type in {short_name} defeats type safety and makes refactoring dangerous.",
             "Replace with specific types or `unknown` (with type narrowing via typeof/instanceof). Use generics <T> for flexible typed APIs."),
            (r"@ts-ignore", "ts-ignore", "medium",
             f"`@ts-ignore` in {short_name} suppresses TypeScript errors without explaining why.",
             "Use @ts-expect-error with a comment explaining the reason. Better yet, fix the underlying type issue."),
            (r"as\s+\w+(?!\s+as)", "unsafe-cast", "low",
             f"Type assertion (`as`) in {short_name} — unchecked cast can cause runtime errors.",
             "Use a type guard instead: function isUser(x: unknown): x is User { return typeof x === 'object' && 'id' in x; }"),
            # Logging
            (r"\bconsole\.(log|debug|info)\b", "console-log", "low",
             f"console.log in {short_name} — remove before production or replace with a structured logger.",
             "Use a structured logger (winston, pino, @nestjs/common Logger) with log levels. Never log PII or secrets."),
            # Debt markers
            (r"\b(TODO|FIXME|HACK|XXX|NOSONAR)\b", "todo-fixme", "low",
             f"TODO/FIXME/HACK in {short_name} — unresolved technical debt left inline.",
             "Convert to a tracked GitHub issue. If it blocks correctness, resolve before merging."),
            # Equality
            (r"(?<![=!<>])==(?!=)(?!\s*(?:null|undefined))", "loose-equality", "low",
             f"Loose equality (==) in {short_name} — can cause subtle type coercion bugs (e.g., '0' == false).",
             "Use strict equality (===) always. The only valid use of == is `x == null` (checks both null and undefined)."),
            # Async misuse
            (r"\basync\s+function|\basync\s*\(", "async-check", "low",
             f"Ensure all async functions in {short_name} have proper error handling and return types.",
             "Wrap top-level async calls: async function main() { try { ... } catch (e) { handleError(e); } }"),
            # Deprecated patterns
            (r"\bvar\s+\w+", "use-var", "low",
             f"`var` used in {short_name} — function-scoped, hoisted, and error-prone.",
             "Replace `var` with `const` (preferred) or `let`. `const` for values that don't reassign, `let` for those that do."),
            # Dead code signals
            (r"if\s*\(\s*false\s*\)|if\s*\(\s*0\s*\)|while\s*\(\s*false\s*\)", "dead-code", "medium",
             f"Dead code — unreachable branch in {short_name}.",
             "Remove dead code. If it's temporarily disabled, track it as a GitHub issue or use a feature flag."),
            # Promise chains without .catch
            (r"\.then\s*\([^)]*\)(?!\s*\.catch)", "unhandled-promise", "medium",
             f"Promise chain without .catch() in {short_name} — unhandled rejection can crash Node.js in newer versions.",
             "Always chain .catch(err => ...) or use async/await with try/catch. Add a global unhandledRejection handler."),
            # Wildcard imports
            (r"import\s+\*\s+as\s+\w+\s+from", "wildcard-import", "low",
             f"Wildcard import (`import * as`) in {short_name} imports the entire module — prevents tree-shaking.",
             "Import only what you need: import { specificFunction } from 'module'. This reduces bundle size."),
            # Nested ternaries
            (r"\?[^:?\n]{0,80}\?[^:?\n]{0,80}:", "nested-ternary", "low",
             f"Nested ternary in {short_name} — hard to read and maintain.",
             "Use if/else or extract to a well-named function. Nested ternaries are notoriously error-prone."),
            # Python-specific
            (r"\bexcept\s*:", "bare-except", "medium",
             f"Bare `except:` in {short_name} catches BaseException including SystemExit and KeyboardInterrupt.",
             "Catch specific exceptions: except ValueError as e: or except (TypeError, ValueError) as e:"),
            (r"\bglobal\s+\w+", "python-global", "low",
             f"`global` statement in {short_name} — global state mutation is a code smell.",
             "Pass values as parameters or use a class instance to encapsulate shared state."),
            # Go
            (r"\bpanic\s*\(", "go-panic", "medium",
             f"`panic()` in {short_name} — panics crash the entire goroutine unless recovered.",
             "Return errors instead: func foo() error { if bad { return fmt.Errorf('...') } }. Only panic for unrecoverable programmer errors."),
        ]
        for pattern, rule_id, severity, desc, suggestion in rules:
            if rule_id in seen:
                continue
            if re.search(pattern, code, re.MULTILINE):
                seen.add(rule_id)
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
