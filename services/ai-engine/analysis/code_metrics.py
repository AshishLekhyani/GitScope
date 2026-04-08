"""
code_metrics.py — GitScope Neural AI Engine
Software quality metrics computed from raw source code strings.

Exports:
    CyclomaticComplexity, HalsteadMetrics, MaintainabilityIndex,
    CodeDuplication, CommentDensity, NamingConventions,
    FunctionLength, DeepNesting, CodeMetricsReport
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any


# ---------------------------------------------------------------------------
# Language helpers
# ---------------------------------------------------------------------------

SUPPORTED_LANGUAGES = {
    "python", "javascript", "typescript", "go", "java", "rust",
    "ruby", "php", "c", "cpp", "c++",
}

def _normalise_lang(language: str) -> str:
    return language.strip().lower()


# ---------------------------------------------------------------------------
# 1. CyclomaticComplexity
# ---------------------------------------------------------------------------

class CyclomaticComplexity:
    """
    Computes McCabe cyclomatic complexity for a broad set of languages.

    Complexity = 1 + number of decision points.
    Decision points: if, else if / elif, for, while, case/when,
    &&/and, ||/or, ternary (?:), try/except/catch, match arms.
    """

    # Per-language regex decision-point patterns
    _PATTERNS: dict[str, list[str]] = {
        "python": [
            r"\bif\b",
            r"\belif\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bexcept\b",
            r"\band\b",
            r"\bor\b",
            r"\bcase\b",           # Python 3.10 match/case
            r"(?<!\w)\?(?!\s*:)",  # ternary-like in comprehensions is rare but keep
        ],
        "javascript": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?(?!\?)",           # ternary (exclude nullish coalescing ??)
            r"\bcatch\b",
        ],
        "typescript": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?(?!\?)",
            r"\bcatch\b",
        ],
        "go": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?(?!\?)",
            r"\bselect\b",
        ],
        "java": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?",
            r"\bcatch\b",
        ],
        "rust": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bmatch\b",
            r"&&",
            r"\|\|",
            r"\bcatch\b",
            r"=>",                 # match arms
        ],
        "ruby": [
            r"\bif\b",
            r"\belif\b",
            r"\bunless\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"\bwhen\b",
            r"&&",
            r"\|\|",
            r"\band\b",
            r"\bor\b",
            r"\brescue\b",
        ],
        "php": [
            r"\bif\b",
            r"\belseif\b",
            r"\bfor\b",
            r"\bforeach\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?(?!\?)",
            r"\bcatch\b",
        ],
        "c": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?",
            r"\bgoto\b",
        ],
        "cpp": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?",
            r"\bcatch\b",
            r"\bgoto\b",
        ],
        "c++": [
            r"\bif\b",
            r"\belse\s+if\b",
            r"\bfor\b",
            r"\bwhile\b",
            r"\bcase\b",
            r"&&",
            r"\|\|",
            r"\?",
            r"\bcatch\b",
            r"\bgoto\b",
        ],
    }

    def compute(self, code: str, language: str) -> int:
        """
        Return the cyclomatic complexity integer for *code* written in
        *language*.  Starts at 1 and adds 1 for every decision point.
        """
        lang = _normalise_lang(language)
        patterns = self._PATTERNS.get(lang, self._PATTERNS["javascript"])
        decision_points = self._count_decision_points(code, patterns)
        return 1 + decision_points

    def rating(self, complexity: int) -> str:
        """
        Map an integer complexity to a qualitative label.

        1–5   → "low"
        6–10  → "moderate"
        11–20 → "high"
        21+   → "very_high"
        """
        if complexity <= 5:
            return "low"
        if complexity <= 10:
            return "moderate"
        if complexity <= 20:
            return "high"
        return "very_high"

    def _count_decision_points(self, code: str, patterns: list[str]) -> int:
        """
        Count all non-overlapping regex matches for every pattern in
        *patterns* across *code*.  Comments and string literals are not
        stripped — this is intentional for speed and simplicity at the
        cost of very minor over-counting in pathological inputs.
        """
        total = 0
        for pattern in patterns:
            total += len(re.findall(pattern, code))
        return total


# ---------------------------------------------------------------------------
# 2. HalsteadMetrics
# ---------------------------------------------------------------------------

class HalsteadMetrics:
    """
    Computes Halstead software science metrics from source code.

    Definitions
    -----------
    n1  = number of distinct operators
    n2  = number of distinct operands
    N1  = total occurrences of operators
    N2  = total occurrences of operands
    n   = n1 + n2          (vocabulary)
    N   = N1 + N2          (length)
    V   = N * log2(n)      (volume)
    D   = (n1/2) * (N2/n2) (difficulty)
    E   = D * V            (effort)
    T   = E / 18           (time to program, seconds)
    B   = V / 3000         (estimated bugs)
    """

    # Operator token sets per language family
    _OPERATORS_BY_LANG: dict[str, list[str]] = {
        "python": [
            r"\+\+", r"--", r"\+=", r"-=", r"\*=", r"/=", r"%=", r"\*\*=",
            r"//=", r"&=", r"\|=", r"\^=", r">>=", r"<<=",
            r"\*\*", r"//",
            r"==", r"!=", r"<=", r">=", r"<", r">",
            r"=", r"\+", r"-", r"\*", r"/", r"%",
            r"&", r"\|", r"\^", r"~", r"<<", r">>",
            r"\band\b", r"\bor\b", r"\bnot\b",
            r"\bin\b", r"\bnot\s+in\b", r"\bis\b", r"\bis\s+not\b",
            r"\bif\b", r"\belse\b", r"\bfor\b", r"\bwhile\b",
            r"\breturn\b", r"\byield\b", r"\bimport\b",
            r"\(", r"\)", r"\[", r"\]", r"\{", r"\}",
            r":", r",", r"\.",
        ],
        "javascript": [
            r"\+\+", r"--", r"\+=", r"-=", r"\*=", r"/=", r"%=",
            r"\*\*=", r"&&=", r"\|\|=", r"\?\?=",
            r"===", r"!==", r"==", r"!=", r"<=", r">=", r"<", r">",
            r"&&", r"\|\|", r"\?\?", r"!",
            r"=>", r"\?", r":",
            r"=", r"\+", r"-", r"\*", r"/", r"%", r"\*\*",
            r"&", r"\|", r"\^", r"~", r"<<", r">>", r">>>",
            r"\btyeof\b", r"\binstanceof\b", r"\bin\b",
            r"\breturn\b", r"\bthrow\b", r"\bnew\b",
            r"\(", r"\)", r"\[", r"\]", r"\{", r"\}",
            r",", r"\.", r";",
        ],
        "go": [
            r"\+\+", r"--", r"\+=", r"-=", r"\*=", r"/=", r"%=",
            r"&=", r"\|=", r"\^=", r"<<=", r">>=",
            r"==", r"!=", r"<=", r">=", r"<", r">",
            r"&&", r"\|\|", r"!",
            r"=", r":=", r"\+", r"-", r"\*", r"/", r"%",
            r"&", r"\|", r"\^", r"<<", r">>",
            r"\breturn\b", r"\bgo\b", r"\bdefer\b",
            r"\(", r"\)", r"\[", r"\]", r"\{", r"\}",
            r",", r"\.", r";",
        ],
        "rust": [
            r"\+=", r"-=", r"\*=", r"/=", r"%=",
            r"&=", r"\|=", r"\^=", r"<<=", r">>=",
            r"==", r"!=", r"<=", r">=", r"<", r">",
            r"&&", r"\|\|", r"!",
            r"=>", r"->", r"::",
            r"=", r"\+", r"-", r"\*", r"/", r"%",
            r"&", r"\|", r"\^", r"<<", r">>",
            r"\breturn\b", r"\bmatch\b",
            r"\(", r"\)", r"\[", r"\]", r"\{", r"\}",
            r",", r"\.", r";",
        ],
    }

    # Operand patterns: identifiers, numeric literals, string literals
    _OPERAND_PATTERNS: dict[str, list[str]] = {
        "python": [
            r'"""[\s\S]*?"""',
            r"'''[\s\S]*?'''",
            r'"[^"\\]*(?:\\.[^"\\]*)*"',
            r"'[^'\\]*(?:\\.[^'\\]*)*'",
            r"\b0[xX][0-9a-fA-F]+\b",
            r"\b0[bB][01]+\b",
            r"\b0[oO][0-7]+\b",
            r"\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b",
            r"\b[A-Za-z_][A-Za-z0-9_]*\b",
        ],
        "default": [
            r'"[^"\\]*(?:\\.[^"\\]*)*"',
            r"'[^'\\]*(?:\\.[^'\\]*)*'",
            r"`[^`]*`",
            r"\b0[xX][0-9a-fA-F]+\b",
            r"\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b",
            r"\b[A-Za-z_$][A-Za-z0-9_$]*\b",
        ],
    }

    # Keywords to exclude from operand counts (they are operators)
    _KEYWORD_OPERATORS: set[str] = {
        "if", "else", "elif", "for", "while", "return", "yield", "import",
        "from", "class", "def", "function", "var", "let", "const", "new",
        "delete", "typeof", "instanceof", "in", "of", "try", "catch",
        "finally", "throw", "switch", "case", "break", "continue", "pass",
        "and", "or", "not", "is", "as", "with", "lambda", "async", "await",
        "go", "defer", "select", "chan", "map", "range", "type", "struct",
        "interface", "func", "package", "import", "pub", "fn", "let", "mut",
        "use", "mod", "impl", "trait", "enum", "match", "where",
        "true", "false", "null", "nil", "None", "True", "False",
        "void", "int", "float", "string", "bool", "byte", "char",
    }

    def compute(self, code: str, language: str) -> dict[str, Any]:
        """
        Compute all Halstead metrics for *code* and return them as a dict.
        """
        lang = _normalise_lang(language)

        unique_operators, all_operators = self._extract_operators(code, lang)
        unique_operands, all_operands = self._extract_operands(code, lang)

        n1 = len(unique_operators)
        n2 = len(unique_operands)
        N1 = len(all_operators)
        N2 = len(all_operands)

        # Guard against degenerate inputs
        vocabulary = max(n1 + n2, 1)
        length = N1 + N2
        volume = length * math.log2(vocabulary) if vocabulary > 1 else 0.0
        difficulty = (n1 / 2) * (N2 / max(n2, 1))
        effort = difficulty * volume
        time_to_program = effort / 18.0
        bugs_delivered = volume / 3000.0

        return {
            "n1": n1,
            "n2": n2,
            "N1": N1,
            "N2": N2,
            "vocabulary": vocabulary,
            "length": length,
            "volume": round(volume, 4),
            "difficulty": round(difficulty, 4),
            "effort": round(effort, 4),
            "time_to_program": round(time_to_program, 4),
            "bugs_delivered": round(bugs_delivered, 4),
        }

    def _extract_operators(self, code: str, language: str) -> tuple[list[str], list[str]]:
        """
        Return (unique_operators, all_operator_occurrences) for *code*.
        """
        patterns = self._OPERATORS_BY_LANG.get(
            language,
            self._OPERATORS_BY_LANG["javascript"],
        )
        all_ops: list[str] = []
        # Iterate patterns in order; strip string/comment noise first
        clean = self._strip_strings_and_comments(code, language)
        for pat in patterns:
            matches = re.findall(pat, clean)
            all_ops.extend(matches)
        unique_ops = list(dict.fromkeys(all_ops))  # preserve insertion order, dedupe
        return unique_ops, all_ops

    def _extract_operands(self, code: str, language: str) -> tuple[list[str], list[str]]:
        """
        Return (unique_operands, all_operand_occurrences) for *code*.
        """
        patterns = self._OPERAND_PATTERNS.get(
            language,
            self._OPERAND_PATTERNS["default"],
        )
        all_ops: list[str] = []
        for pat in patterns:
            for match in re.finditer(pat, code):
                token = match.group(0)
                if token not in self._KEYWORD_OPERATORS:
                    all_ops.append(token)
        unique_ops = list(dict.fromkeys(all_ops))
        return unique_ops, all_ops

    def _strip_strings_and_comments(self, code: str, language: str) -> str:
        """
        Remove string literals and line comments so operators are not
        confused with text inside strings.
        """
        # Remove triple-quoted strings (Python)
        code = re.sub(r'"""[\s\S]*?"""', '""', code)
        code = re.sub(r"'''[\s\S]*?'''", "''", code)
        # Remove double-quoted strings
        code = re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', '""', code)
        # Remove single-quoted strings
        code = re.sub(r"'[^'\\]*(?:\\.[^'\\]*)*'", "''", code)
        # Remove backtick template literals
        code = re.sub(r"`[^`\\]*(?:\\.[^`\\]*)*`", "``", code)
        # Remove line comments
        if language in ("python", "ruby"):
            code = re.sub(r"#.*$", "", code, flags=re.MULTILINE)
        else:
            code = re.sub(r"//.*$", "", code, flags=re.MULTILINE)
            code = re.sub(r"/\*[\s\S]*?\*/", "", code)
        return code


# ---------------------------------------------------------------------------
# 3. MaintainabilityIndex
# ---------------------------------------------------------------------------

class MaintainabilityIndex:
    """
    Computes the Microsoft Visual Studio variant of the Maintainability Index.

    Formula
    -------
    MI = 171 - 5.2*ln(HV) - 0.23*CC - 16.2*ln(LOC)
         + 50*sin(sqrt(2.4 * pct_comments))

    The result is clamped to [0, 100].
    """

    def compute(
        self,
        halstead_volume: float,
        cyclomatic_complexity: int,
        lines_of_code: int,
        percent_comments: float,
    ) -> float:
        """
        Compute and return the Maintainability Index (float in [0, 100]).

        Parameters
        ----------
        halstead_volume     : Halstead volume V
        cyclomatic_complexity : McCabe CC integer
        lines_of_code       : logical LOC (non-blank, non-comment lines)
        percent_comments    : fraction 0.0–1.0 of comment lines
        """
        hv = max(halstead_volume, 1.0)
        loc = max(lines_of_code, 1)
        pct = max(min(percent_comments, 1.0), 0.0)

        mi = (
            171.0
            - 5.2 * math.log(hv)
            - 0.23 * cyclomatic_complexity
            - 16.2 * math.log(loc)
            + 50.0 * math.sin(math.sqrt(2.4 * pct))
        )

        # Normalise to [0, 100]
        mi_normalised = max(0.0, min(100.0, mi * 100.0 / 171.0))
        return round(mi_normalised, 2)

    def rating(self, mi: float) -> str:
        """
        Map MI score to qualitative label.

        85–100 → "highly_maintainable"
        65–84  → "maintainable"
        40–64  → "difficult"
        <40    → "unmaintainable"
        """
        if mi >= 85.0:
            return "highly_maintainable"
        if mi >= 65.0:
            return "maintainable"
        if mi >= 40.0:
            return "difficult"
        return "unmaintainable"


# ---------------------------------------------------------------------------
# 4. CodeDuplication
# ---------------------------------------------------------------------------

class CodeDuplication:
    """
    Detects copy-pasted code blocks using a Rabin-Karp rolling hash over
    windows of normalised source lines.
    """

    _BASE = 31
    _MOD = (1 << 61) - 1  # Mersenne prime

    def find_duplicates(self, code: str, min_lines: int = 4) -> list[dict[str, Any]]:
        """
        Scan *code* for duplicate blocks of at least *min_lines* lines.

        Returns a list of dicts:
        {
            "start_line": int,   # 1-based
            "end_line": int,     # inclusive
            "duplicate_count": int,
            "sample": str,       # first line of the block
        }
        """
        lines = [ln.strip() for ln in code.splitlines()]
        non_empty_indices = [i for i, ln in enumerate(lines) if ln]
        if len(non_empty_indices) < min_lines:
            return []

        normalised = [self._normalise_line(lines[i]) for i in range(len(lines))]

        # Pre-compute per-line hashes
        line_hashes = [hash(normalised[i]) % self._MOD for i in range(len(normalised))]

        # Build window hashes with rolling computation
        window_hash_map: dict[int, list[int]] = defaultdict(list)
        win = len(non_empty_indices)

        # Only hash over non-empty line index windows
        effective_lines = [i for i, ln in enumerate(lines) if ln.strip()]
        if len(effective_lines) < min_lines:
            return []

        for start_idx in range(len(effective_lines) - min_lines + 1):
            window_indices = effective_lines[start_idx: start_idx + min_lines]
            wh = self._window_hash(line_hashes, window_indices)
            window_hash_map[wh].append(start_idx)

        results: list[dict[str, Any]] = []
        seen_starts: set[int] = set()

        for wh, positions in window_hash_map.items():
            if len(positions) < 2:
                continue
            # Verify matches are real (hash collision guard)
            groups: list[list[int]] = []
            for pos in positions:
                placed = False
                window_indices = effective_lines[pos: pos + min_lines]
                if not window_indices:
                    continue
                block = tuple(normalised[i] for i in window_indices)
                for group in groups:
                    ref_indices = effective_lines[group[0]: group[0] + min_lines]
                    ref_block = tuple(normalised[i] for i in ref_indices)
                    if block == ref_block:
                        group.append(pos)
                        placed = True
                        break
                if not placed:
                    groups.append([pos])

            for group in groups:
                if len(group) < 2:
                    continue
                first_pos = group[0]
                if first_pos in seen_starts:
                    continue
                seen_starts.add(first_pos)
                real_start = effective_lines[first_pos]
                real_end = effective_lines[
                    min(first_pos + min_lines - 1, len(effective_lines) - 1)
                ]
                sample_line = lines[real_start] if real_start < len(lines) else ""
                results.append({
                    "start_line": real_start + 1,
                    "end_line": real_end + 1,
                    "duplicate_count": len(group),
                    "sample": sample_line[:120],
                })

        return results

    def duplication_percentage(self, code: str, total_lines: int) -> float:
        """
        Estimate the fraction (0–100) of lines involved in duplication.
        """
        if total_lines == 0:
            return 0.0
        duplicates = self.find_duplicates(code)
        duplicated_line_count = sum(
            (d["end_line"] - d["start_line"] + 1) * (d["duplicate_count"] - 1)
            for d in duplicates
        )
        pct = (duplicated_line_count / total_lines) * 100.0
        return round(min(pct, 100.0), 2)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _normalise_line(self, line: str) -> str:
        """
        Strip leading/trailing whitespace and collapse internal whitespace
        so minor formatting differences do not defeat duplicate detection.
        """
        return re.sub(r"\s+", " ", line.strip())

    def _window_hash(self, line_hashes: list[int], indices: list[int]) -> int:
        """
        Compute a polynomial rolling hash for a window of line hashes.
        """
        h = 0
        for i, idx in enumerate(indices):
            h = (h + line_hashes[idx] * pow(self._BASE, i, self._MOD)) % self._MOD
        return h


# ---------------------------------------------------------------------------
# 5. CommentDensity
# ---------------------------------------------------------------------------

class CommentDensity:
    """
    Analyses comment coverage and documentation quality in source files.
    """

    # Patterns that identify the start of a line comment for each language
    _LINE_COMMENT_PREFIXES: dict[str, list[str]] = {
        "python": [r"^\s*#"],
        "ruby": [r"^\s*#"],
        "javascript": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
        "typescript": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
        "go": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
        "java": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
        "rust": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
        "php": [r"^\s*//", r"^\s*#", r"^\s*/\*", r"^\s*\*"],
        "c": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
        "cpp": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
        "c++": [r"^\s*//", r"^\s*/\*", r"^\s*\*"],
    }

    _JSDOC_PATTERN = re.compile(r"/\*\*[\s\S]*?\*/", re.MULTILINE)
    _TRIPLE_DOUBLE_PATTERN = re.compile(r'"""[\s\S]*?"""', re.MULTILINE)
    _TRIPLE_SINGLE_PATTERN = re.compile(r"'''[\s\S]*?'''", re.MULTILINE)

    _HEADER_INDICATORS = re.compile(
        r"copyright|license|author|module|package|\bfile\b|description",
        re.IGNORECASE,
    )

    def compute(self, code: str, language: str) -> dict[str, Any]:
        """
        Return a dict describing comment density metrics for *code*.
        """
        lang = _normalise_lang(language)
        raw_lines = code.splitlines()
        total_lines = len(raw_lines)

        comment_prefixes = self._LINE_COMMENT_PREFIXES.get(
            lang, self._LINE_COMMENT_PREFIXES["javascript"]
        )
        comment_pattern = re.compile("|".join(comment_prefixes))

        comment_lines = 0
        blank_lines = 0
        code_lines = 0

        for line in raw_lines:
            stripped = line.strip()
            if not stripped:
                blank_lines += 1
            elif comment_pattern.search(line):
                comment_lines += 1
            else:
                code_lines += 1

        comment_ratio = (
            comment_lines / max(total_lines - blank_lines, 1)
        )

        # Docstring / JSDoc counts
        docstring_count = 0
        if lang == "python":
            docstring_count += len(self._TRIPLE_DOUBLE_PATTERN.findall(code))
            docstring_count += len(self._TRIPLE_SINGLE_PATTERN.findall(code))
        elif lang in ("javascript", "typescript", "java", "php"):
            docstring_count += len(self._JSDOC_PATTERN.findall(code))

        # File header check — inspect first 5 non-blank lines
        header_lines = []
        for ln in raw_lines:
            if ln.strip():
                header_lines.append(ln)
            if len(header_lines) >= 5:
                break
        header_text = " ".join(header_lines)
        has_file_header = bool(self._HEADER_INDICATORS.search(header_text))

        return {
            "total_lines": total_lines,
            "code_lines": code_lines,
            "comment_lines": comment_lines,
            "blank_lines": blank_lines,
            "comment_ratio": round(comment_ratio, 4),
            "docstring_count": docstring_count,
            "has_file_header": has_file_header,
        }


# ---------------------------------------------------------------------------
# 6. NamingConventions
# ---------------------------------------------------------------------------

class NamingConventions:
    """
    Checks identifier naming convention adherence.

    Convention rules
    ----------------
    Python  : functions/variables → snake_case
               classes            → PascalCase
               module constants   → UPPER_SNAKE_CASE

    JS/TS   : variables/functions → camelCase
               classes/components → PascalCase
               constants          → UPPER_SNAKE_CASE

    Go      : unexported          → camelCase
               exported           → PascalCase
    """

    # Compiled regex helpers
    _SNAKE_CASE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
    _PASCAL_CASE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
    _CAMEL_CASE = re.compile(r"^[a-z][A-Za-z0-9]*$")
    _UPPER_SNAKE = re.compile(r"^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$")

    # Python patterns
    _PY_FUNC = re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)
    _PY_CLASS = re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:(]", re.MULTILINE)
    _PY_CONST = re.compile(r"^([A-Z_][A-Z0-9_]{2,})\s*=", re.MULTILINE)
    _PY_VAR = re.compile(r"^\s{4}([a-z_][A-Za-z0-9_]*)\s*=(?!=)", re.MULTILINE)

    # JS/TS patterns
    _JS_FUNC = re.compile(
        r"(?:function\s+([A-Za-z_$][A-Za-z0-9_$]*)|"
        r"(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?(?:function|\(.*?\)\s*=>))",
        re.MULTILINE,
    )
    _JS_CLASS = re.compile(r"^\s*(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)", re.MULTILINE)
    _JS_CONST = re.compile(r"\bconst\s+([A-Z_][A-Z0-9_]{2,})\s*=", re.MULTILINE)
    _JS_VAR = re.compile(r"\b(?:let|var)\s+([a-z_$][A-Za-z0-9_$]*)\s*=", re.MULTILINE)
    _JS_ARROW_FUNC = re.compile(
        r"\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(", re.MULTILINE
    )

    # Go patterns
    _GO_FUNC = re.compile(r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)
    _GO_VAR = re.compile(r"\b(?:var|:=)\s*([A-Za-z_][A-Za-z0-9_]*)", re.MULTILINE)

    def analyze(self, code: str, language: str) -> dict[str, Any]:
        """
        Scan *code* for naming convention violations and return a report.
        """
        lang = _normalise_lang(language)
        violations: list[dict[str, Any]] = []

        if lang == "python":
            violations.extend(self._check_python(code))
        elif lang in ("javascript", "typescript"):
            violations.extend(self._check_js(code))
        elif lang == "go":
            violations.extend(self._check_go(code))
        else:
            # Fallback: JS-style conventions
            violations.extend(self._check_js(code))

        # Score: starts at 100, deduct 5 per violation (floor 0)
        score = max(0, 100 - len(violations) * 5)
        return {
            "violations": violations,
            "convention_score": score,
        }

    # ------------------------------------------------------------------
    # Per-language checkers
    # ------------------------------------------------------------------

    def _check_python(self, code: str) -> list[dict[str, Any]]:
        violations: list[dict[str, Any]] = []

        # Functions should be snake_case
        for m in self._PY_FUNC.finditer(code):
            name = m.group(1)
            if name.startswith("__") and name.endswith("__"):
                continue  # dunder methods are exempt
            if not self._SNAKE_CASE.match(name):
                violations.append({
                    "type": "function",
                    "name": name,
                    "expected_convention": "snake_case",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        # Classes should be PascalCase
        for m in self._PY_CLASS.finditer(code):
            name = m.group(1)
            if not self._PASCAL_CASE.match(name):
                violations.append({
                    "type": "class",
                    "name": name,
                    "expected_convention": "PascalCase",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        # Module-level constants should be UPPER_SNAKE
        for m in self._PY_CONST.finditer(code):
            name = m.group(1)
            if not self._UPPER_SNAKE.match(name):
                violations.append({
                    "type": "constant",
                    "name": name,
                    "expected_convention": "UPPER_SNAKE_CASE",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        # Variables inside functions should be snake_case
        for m in self._PY_VAR.finditer(code):
            name = m.group(1)
            if self._UPPER_SNAKE.match(name):
                continue  # looks like a constant, skip
            if not self._SNAKE_CASE.match(name):
                violations.append({
                    "type": "variable",
                    "name": name,
                    "expected_convention": "snake_case",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        return violations

    def _check_js(self, code: str) -> list[dict[str, Any]]:
        violations: list[dict[str, Any]] = []

        # Class names — PascalCase
        for m in self._JS_CLASS.finditer(code):
            name = m.group(1)
            if not self._PASCAL_CASE.match(name):
                violations.append({
                    "type": "class",
                    "name": name,
                    "expected_convention": "PascalCase",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        # Standalone function declarations — camelCase
        for m in self._JS_FUNC.finditer(code):
            name = m.group(1) or m.group(2)
            if not name:
                continue
            if self._PASCAL_CASE.match(name):
                # Could be a component or constructor — not a violation
                continue
            if not self._CAMEL_CASE.match(name):
                violations.append({
                    "type": "function",
                    "name": name,
                    "expected_convention": "camelCase",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        # Arrow functions — camelCase
        for m in self._JS_ARROW_FUNC.finditer(code):
            name = m.group(1)
            if self._PASCAL_CASE.match(name):
                continue
            if not self._CAMEL_CASE.match(name):
                violations.append({
                    "type": "arrow_function",
                    "name": name,
                    "expected_convention": "camelCase",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        # let/var variables — camelCase
        for m in self._JS_VAR.finditer(code):
            name = m.group(1)
            if self._UPPER_SNAKE.match(name):
                continue  # looks like a constant
            if not self._CAMEL_CASE.match(name):
                violations.append({
                    "type": "variable",
                    "name": name,
                    "expected_convention": "camelCase",
                    "line_hint": code[: m.start()].count("\n") + 1,
                })

        return violations

    def _check_go(self, code: str) -> list[dict[str, Any]]:
        violations: list[dict[str, Any]] = []

        for m in self._GO_FUNC.finditer(code):
            name = m.group(1)
            # Exported (starts uppercase) → PascalCase
            # Unexported → camelCase
            if name[0].isupper():
                if not self._PASCAL_CASE.match(name):
                    violations.append({
                        "type": "exported_function",
                        "name": name,
                        "expected_convention": "PascalCase",
                        "line_hint": code[: m.start()].count("\n") + 1,
                    })
            else:
                if not self._CAMEL_CASE.match(name) and not self._SNAKE_CASE.match(name):
                    violations.append({
                        "type": "unexported_function",
                        "name": name,
                        "expected_convention": "camelCase",
                        "line_hint": code[: m.start()].count("\n") + 1,
                    })

        return violations


# ---------------------------------------------------------------------------
# 7. FunctionLength
# ---------------------------------------------------------------------------

class FunctionLength:
    """
    Analyses function/method lengths throughout a source file.
    """

    # Patterns to find function definitions per language
    _FUNC_PATTERNS: dict[str, re.Pattern[str]] = {
        "python": re.compile(
            r"^(?P<indent>\s*)(?:async\s+)?def\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(",
            re.MULTILINE,
        ),
        "javascript": re.compile(
            r"(?:^|\n)(?P<indent>\s*)(?:async\s+)?function\s*\*?\s*(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*\(",
            re.MULTILINE,
        ),
        "typescript": re.compile(
            r"(?:^|\n)(?P<indent>\s*)(?:async\s+)?function\s*\*?\s*(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)\s*\(",
            re.MULTILINE,
        ),
        "go": re.compile(
            r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(",
            re.MULTILINE,
        ),
        "java": re.compile(
            r"^\s+(?:public|private|protected|static|\s)+\s+\w[\w<>\[\]]*\s+"
            r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(",
            re.MULTILINE,
        ),
        "rust": re.compile(
            r"^\s*(?:pub\s+)?(?:async\s+)?fn\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*",
            re.MULTILINE,
        ),
        "ruby": re.compile(
            r"^\s*def\s+(?:self\.)?(?P<name>[A-Za-z_][A-Za-z0-9_?!]*)\s*",
            re.MULTILINE,
        ),
        "php": re.compile(
            r"^\s*(?:public|private|protected|static|\s)*function\s+"
            r"(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(",
            re.MULTILINE,
        ),
        "c": re.compile(
            r"^(?P<indent>)\w[\w\s\*]+\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*\)\s*\{",
            re.MULTILINE,
        ),
        "cpp": re.compile(
            r"^(?P<indent>)\w[\w\s\*:<>]+\s+(?P<name>[A-Za-z_][A-Za-z0-9_:~]*)\s*\([^;]*\)\s*(?:const\s*)?\{",
            re.MULTILINE,
        ),
        "c++": re.compile(
            r"^(?P<indent>)\w[\w\s\*:<>]+\s+(?P<name>[A-Za-z_][A-Za-z0-9_:~]*)\s*\([^;]*\)\s*(?:const\s*)?\{",
            re.MULTILINE,
        ),
    }

    OVERSIZED_THRESHOLD = 50

    def analyze(self, code: str, language: str) -> dict[str, Any]:
        """
        Scan *code* for function definitions and return length statistics.
        """
        lang = _normalise_lang(language)
        pattern = self._FUNC_PATTERNS.get(lang, self._FUNC_PATTERNS["javascript"])
        lines = code.splitlines()
        total_lines = len(lines)

        functions: list[dict[str, Any]] = []

        matches = list(pattern.finditer(code))
        for idx, m in enumerate(matches):
            try:
                name = m.group("name")
            except IndexError:
                continue

            start_line = code[: m.start()].count("\n") + 1

            # Estimate end of function body
            if idx + 1 < len(matches):
                next_start = code[: matches[idx + 1].start()].count("\n")
            else:
                next_start = total_lines

            if lang in ("python", "ruby"):
                end_line = self._find_python_func_end(
                    lines, start_line - 1, next_start
                )
            else:
                end_line = self._find_brace_func_end(
                    lines, start_line - 1, next_start
                )

            line_count = max(end_line - start_line + 1, 1)
            functions.append({
                "name": name,
                "line_start": start_line,
                "line_count": line_count,
            })

        oversized = [
            {"name": f["name"], "line_count": f["line_count"]}
            for f in functions
            if f["line_count"] > self.OVERSIZED_THRESHOLD
        ]
        lengths = [f["line_count"] for f in functions]
        avg_length = round(sum(lengths) / len(lengths), 2) if lengths else 0.0
        max_length = max(lengths) if lengths else 0

        return {
            "functions": functions,
            "oversized": oversized,
            "average_length": avg_length,
            "max_length": max_length,
        }

    # ------------------------------------------------------------------
    # Body-end estimators
    # ------------------------------------------------------------------

    def _find_python_func_end(
        self, lines: list[str], start: int, upper_bound: int
    ) -> int:
        """
        For Python: find the last line that is indented more than the
        function definition line, within *upper_bound*.
        """
        if start >= len(lines):
            return start + 1
        def_indent = len(lines[start]) - len(lines[start].lstrip())
        end = start
        for i in range(start + 1, min(upper_bound, len(lines))):
            stripped = lines[i].strip()
            if not stripped:
                continue
            current_indent = len(lines[i]) - len(lines[i].lstrip())
            if current_indent > def_indent:
                end = i
            else:
                break
        return end + 1

    def _find_brace_func_end(
        self, lines: list[str], start: int, upper_bound: int
    ) -> int:
        """
        For C-style languages: count braces to find the matching closing }.
        """
        depth = 0
        found_open = False
        for i in range(start, min(upper_bound, len(lines))):
            for ch in lines[i]:
                if ch == "{":
                    depth += 1
                    found_open = True
                elif ch == "}":
                    depth -= 1
                    if found_open and depth <= 0:
                        return i + 1
        return min(upper_bound, len(lines))


# ---------------------------------------------------------------------------
# 8. DeepNesting
# ---------------------------------------------------------------------------

class DeepNesting:
    """
    Detects deeply nested code by tracking syntactic depth.

    For brace-delimited languages depth is tracked via { }.
    For Python/Ruby it is tracked via indentation level (4-space baseline).
    """

    DEEP_THRESHOLD = 4

    def analyze(self, code: str) -> dict[str, Any]:
        """
        Analyse nesting depth across all lines of *code*.

        Returns
        -------
        {
            "max_depth": int,
            "average_depth": float,
            "deeply_nested_lines": list[int],   # 1-based line numbers
        }
        """
        lines = code.splitlines()
        if not lines:
            return {"max_depth": 0, "average_depth": 0.0, "deeply_nested_lines": []}

        # Decide strategy: if braces are present use brace counting,
        # otherwise use indentation.
        brace_count = code.count("{") + code.count("}")
        indent_count = sum(1 for ln in lines if ln and ln[0] == " ")

        if brace_count > indent_count:
            depths = self._brace_depths(lines)
        else:
            depths = self._indent_depths(lines)

        max_depth = max(depths) if depths else 0
        non_blank_depths = [d for ln, d in zip(lines, depths) if ln.strip()]
        avg_depth = (
            round(sum(non_blank_depths) / len(non_blank_depths), 2)
            if non_blank_depths
            else 0.0
        )
        deeply_nested = [
            i + 1 for i, d in enumerate(depths)
            if d > self.DEEP_THRESHOLD and lines[i].strip()
        ]

        return {
            "max_depth": max_depth,
            "average_depth": avg_depth,
            "deeply_nested_lines": deeply_nested,
        }

    def _brace_depths(self, lines: list[str]) -> list[int]:
        """
        Track depth by incrementing on { and decrementing on }.
        The depth reported for a line is the depth at its end.
        """
        depth = 0
        depths: list[int] = []
        for line in lines:
            for ch in line:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth = max(depth - 1, 0)
            depths.append(depth)
        return depths

    def _indent_depths(self, lines: list[str]) -> list[int]:
        """
        Track depth by measuring indentation level, assuming 4 spaces per
        level (or tabs as 1 level each).
        """
        depths: list[int] = []
        for line in lines:
            if not line.strip():
                depths.append(depths[-1] if depths else 0)
                continue
            # Count leading spaces / tabs
            leading = len(line) - len(line.lstrip())
            tab_count = line[:leading].count("\t")
            space_count = line[:leading].count(" ")
            depth = tab_count + space_count // 4
            depths.append(depth)
        return depths


# ---------------------------------------------------------------------------
# 9. CodeMetricsReport  (orchestrator)
# ---------------------------------------------------------------------------

class CodeMetricsReport:
    """
    Top-level orchestrator that runs every sub-analyser and assembles
    a single comprehensive quality report for a source file.
    """

    def __init__(self) -> None:
        self._cc = CyclomaticComplexity()
        self._halstead = HalsteadMetrics()
        self._mi = MaintainabilityIndex()
        self._dup = CodeDuplication()
        self._comments = CommentDensity()
        self._naming = NamingConventions()
        self._funcs = FunctionLength()
        self._nesting = DeepNesting()

    def analyze(self, code: str, language: str, filename: str) -> dict[str, Any]:
        """
        Run all analysers against *code* and return a unified quality report.

        Parameters
        ----------
        code      : raw source code string
        language  : human-readable language name (case-insensitive)
        filename  : original file name (informational only)

        Returns
        -------
        Comprehensive dict — see class docstring for shape.
        """
        lang = _normalise_lang(language)
        lang_display = language.title()

        # --- Line counts ---------------------------------------------------
        comment_data = self._comments.compute(code, lang)
        total_lines = comment_data["total_lines"]
        code_lines = comment_data["code_lines"]
        comment_lines = comment_data["comment_lines"]
        blank_lines = comment_data["blank_lines"]
        comment_ratio = comment_data["comment_ratio"]

        # --- Cyclomatic complexity -----------------------------------------
        cc_value = self._cc.compute(code, lang)
        cc_rating = self._cc.rating(cc_value)

        # --- Halstead metrics ----------------------------------------------
        halstead_data = self._halstead.compute(code, lang)

        # --- Maintainability index -----------------------------------------
        mi_value = self._mi.compute(
            halstead_volume=halstead_data["volume"],
            cyclomatic_complexity=cc_value,
            lines_of_code=max(code_lines, 1),
            percent_comments=comment_ratio,
        )
        mi_rating = self._mi.rating(mi_value)

        # --- Code duplication ----------------------------------------------
        dup_blocks = self._dup.find_duplicates(code)
        dup_pct = self._dup.duplication_percentage(code, total_lines)

        # --- Naming conventions --------------------------------------------
        naming_data = self._naming.analyze(code, lang)

        # --- Function lengths ----------------------------------------------
        func_data = self._funcs.analyze(code, lang)
        func_count = len(func_data["functions"])

        # --- Deep nesting --------------------------------------------------
        nesting_data = self._nesting.analyze(code)

        # --- Assemble report -----------------------------------------------
        report: dict[str, Any] = {
            "file": filename,
            "language": lang_display,
            "lines": {
                "total": total_lines,
                "code": code_lines,
                "comment": comment_lines,
                "blank": blank_lines,
            },
            "complexity": {
                "cyclomatic": cc_value,
                "rating": cc_rating,
            },
            "halstead": halstead_data,
            "maintainability": {
                "index": mi_value,
                "rating": mi_rating,
            },
            "duplication": {
                "percentage": dup_pct,
                "blocks": dup_blocks,
            },
            "naming": {
                "score": naming_data["convention_score"],
                "violations": naming_data["violations"],
            },
            "functions": {
                "count": func_count,
                "oversized": func_data["oversized"],
                "avg_length": func_data["average_length"],
                "max_length": func_data["max_length"],
                "details": func_data["functions"],
            },
            "nesting": {
                "max_depth": nesting_data["max_depth"],
                "average_depth": nesting_data["average_depth"],
                "deeply_nested_lines": nesting_data["deeply_nested_lines"],
            },
            "comments": {
                "ratio": comment_ratio,
                "docstring_count": comment_data["docstring_count"],
                "has_file_header": comment_data["has_file_header"],
            },
        }

        report["overall_quality_score"] = self._compute_overall_score(report)
        return report

    # ------------------------------------------------------------------
    # Score computation
    # ------------------------------------------------------------------

    def _compute_overall_score(self, metrics: dict[str, Any]) -> int:
        """
        Weighted combination of all sub-scores.

        Weights
        -------
        Maintainability index   30 %
        Cyclomatic complexity   20 %
        Naming conventions      15 %
        Duplication             15 %
        Function length         10 %
        Nesting depth           10 %
        """
        scores: dict[str, float] = {}

        # 1. Maintainability index (already 0-100)
        scores["maintainability"] = metrics["maintainability"]["index"]

        # 2. Cyclomatic complexity → invert to a 0-100 score
        cc = metrics["complexity"]["cyclomatic"]
        # Perfect score at CC=1, score decays to 0 at CC=50+
        cc_score = max(0.0, 100.0 - (cc - 1) * (100.0 / 49.0))
        scores["complexity"] = cc_score

        # 3. Naming conventions score (already 0-100)
        scores["naming"] = float(metrics["naming"]["score"])

        # 4. Duplication — 100 at 0%, 0 at 50%+
        dup_pct = metrics["duplication"]["percentage"]
        dup_score = max(0.0, 100.0 - dup_pct * 2.0)
        scores["duplication"] = dup_score

        # 5. Function length — penalise based on oversized functions
        total_funcs = metrics["functions"]["count"] or 1
        oversized_count = len(metrics["functions"]["oversized"])
        func_score = max(0.0, 100.0 - (oversized_count / total_funcs) * 100.0)
        scores["function_length"] = func_score

        # 6. Nesting — 100 at depth ≤ 3, decays to 0 at depth ≥ 10
        max_depth = metrics["nesting"]["max_depth"]
        nesting_score = max(0.0, 100.0 - max(0, max_depth - 3) * (100.0 / 7.0))
        scores["nesting"] = nesting_score

        weights = {
            "maintainability": 0.30,
            "complexity": 0.20,
            "naming": 0.15,
            "duplication": 0.15,
            "function_length": 0.10,
            "nesting": 0.10,
        }

        weighted_sum = sum(scores[k] * weights[k] for k in weights)
        return max(0, min(100, round(weighted_sum)))


# ---------------------------------------------------------------------------
# Convenience wrapper
# ---------------------------------------------------------------------------

def analyze_file(code: str, language: str, filename: str = "<unknown>") -> dict[str, Any]:
    """
    Module-level convenience function.  Creates a :class:`CodeMetricsReport`
    instance and runs a full analysis in a single call.

    Parameters
    ----------
    code     : Raw source code text.
    language : Language string, e.g. ``"python"``, ``"typescript"``.
    filename : Optional filename for inclusion in the report metadata.

    Returns
    -------
    dict
        Full quality report identical to
        :meth:`CodeMetricsReport.analyze`.
    """
    reporter = CodeMetricsReport()
    return reporter.analyze(code, language, filename)


# ---------------------------------------------------------------------------
# Quick self-test when executed directly
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _SAMPLE_PYTHON = '''
"""
sample_module.py — Demo module for metrics testing.
Copyright (c) 2026 GitScope
"""

import os
import sys
from typing import Optional


MAX_RETRIES = 3
DEFAULT_TIMEOUT = 30


def fetch_data(url: str, retries: int = MAX_RETRIES) -> Optional[dict]:
    """Fetch JSON data from a remote URL with retry logic."""
    for attempt in range(retries):
        try:
            if attempt > 0:
                pass
            response = _make_request(url)
            if response and response.get("status") == 200:
                return response["data"]
            elif response is None:
                continue
        except Exception as exc:
            if attempt == retries - 1:
                raise RuntimeError(f"Failed after {retries} attempts") from exc
    return None


def _make_request(url: str) -> Optional[dict]:
    """Internal helper — simulates an HTTP call."""
    if not url or not url.startswith("http"):
        return None
    return {"status": 200, "data": {"ok": True}}


class DataProcessor:
    """Processes raw API payloads into structured records."""

    def __init__(self, schema: dict) -> None:
        self.schema = schema
        self._cache: dict = {}

    def process(self, payload: dict) -> dict:
        """Transform *payload* according to the schema."""
        result = {}
        for key, expected_type in self.schema.items():
            value = payload.get(key)
            if value is None:
                result[key] = None
            elif expected_type == "int":
                result[key] = int(value)
            elif expected_type == "str":
                result[key] = str(value)
            else:
                result[key] = value
        return result

    def cache_result(self, key: str, data: dict) -> None:
        self._cache[key] = data

    def get_cached(self, key: str) -> Optional[dict]:
        return self._cache.get(key)


def compute_stats(values: list) -> dict:
    """Return basic statistics for a list of numeric values."""
    if not values:
        return {"count": 0, "mean": 0.0, "min": None, "max": None}
    count = len(values)
    total = sum(values)
    mean = total / count
    return {
        "count": count,
        "mean": round(mean, 4),
        "min": min(values),
        "max": max(values),
    }
'''

    import json

    report = analyze_file(_SAMPLE_PYTHON, "python", "sample_module.py")
    print(json.dumps(report, indent=2))
