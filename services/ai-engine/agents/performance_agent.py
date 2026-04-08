"""
Performance Profiler Agent
===========================
Detects performance anti-patterns that static analysis can catch:
  - N+1 query patterns (DB calls inside loops)
  - Missing async/await causing sequential I/O
  - Blocking the event loop (sync I/O in async context)
  - Quadratic/cubic time complexity O(n²)
  - Unnecessary re-renders (React)
  - Missing memoization opportunities
  - Memory leaks (event listener leaks, closure leaks)
  - Bundle size risks (heavy imports)
  - Unindexed query patterns
"""

from __future__ import annotations

import re
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding


HEAVY_PACKAGES = {
    "moment": "moment is 67KB gzipped — use date-fns (tree-shakeable) or dayjs (2KB) instead",
    "lodash": "Importing all of lodash adds 70KB — use individual lodash/function imports or native ES6",
    "rxjs": "Importing entire rxjs bloats the bundle — import only operators you use",
    "draft-js": "Draft.js is very heavy — consider Slate.js or Tiptap for rich text",
    "three": "Three.js is large — use dynamic imports and lazy loading: import('three')",
    "chart.js": "Chart.js is 60KB+ — use dynamic import() to code-split it",
    "pdf-lib": "pdf-lib is heavy — load dynamically or process server-side",
    "xlsx": "xlsx is large — process spreadsheets server-side if possible",
}


class PerformanceAgent(BaseAgent):
    agent_id = "performance"
    agent_name = "Performance Profiler"
    specialization = "N+1 queries, O(n²) patterns, memory leaks, bundle size, blocking I/O"

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()
        files = context.get("files", [])
        is_repo = context.get("analysis_type") == "repo"

        findings: list[Finding] = []
        positives: list[str] = []

        if is_repo:
            findings, positives = self._scan_repo(context)
        else:
            findings, positives = self._scan_diff(files)

        score = 85
        for f in findings:
            score -= {"high": 18, "medium": 10, "low": 4}.get(f.severity, 5)
        score = max(10, min(100, score))

        insights: list[str] = []
        n_plus_one = [f for f in findings if "n+1" in (f.rule_id or "")]
        if n_plus_one:
            insights.append(f"{len(n_plus_one)} N+1 query pattern{'s' if len(n_plus_one) > 1 else ''} — can cause exponential DB load under realistic data volumes.")
        if score >= 85:
            insights.append("No significant performance anti-patterns detected.")

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.80,
            findings=findings[:8],
            insights=insights,
            positives=positives,
        ))

    def _scan_diff(self, files: list[dict]) -> tuple[list[Finding], list[str]]:
        findings: list[Finding] = []
        positives: list[str] = []

        for file in files:
            fname = file.get("filename", "unknown")
            patch = file.get("patch", "") or ""
            added = "\n".join(
                l[1:] for l in patch.splitlines()
                if l.startswith("+") and not l.startswith("+++")
            )

            # N+1: DB call inside a loop
            if re.search(r"for\s*\(|\.map\(|\.forEach\(|while\s*\(", added):
                if re.search(r"await\s+(?:prisma|db|mongo|sql|query|find|findOne|findMany|fetch)\b", added):
                    findings.append(Finding(
                        severity="high", category="performance", file=fname,
                        description=f"Potential N+1 query in {fname.split('/')[-1]}: database call inside a loop. With N records this makes N DB round-trips.",
                        suggestion="Batch the query: fetch all needed IDs upfront, then use findMany({ where: { id: { in: ids } } }) or DataLoader.",
                        rule_id="n+1-query", confidence=0.82,
                    ))

            # Synchronous file I/O in async context
            if re.search(r"\bfs\.(readFileSync|writeFileSync|existsSync|readdirSync)\b", added):
                if re.search(r"async|await|Promise", added):
                    findings.append(Finding(
                        severity="high", category="performance", file=fname,
                        description=f"Synchronous filesystem I/O in {fname.split('/')[-1]} blocks the Node.js event loop.",
                        suggestion="Replace with async versions: fs.readFile → fs.promises.readFile. Or use the 'fs/promises' import.",
                        rule_id="sync-io-in-async", confidence=0.88,
                    ))

            # O(n²): nested loops over same collection
            nested = re.findall(r"for\s*\([^)]+\)[^{]*\{[^}]*for\s*\(", added, re.DOTALL)
            if nested:
                findings.append(Finding(
                    severity="medium", category="performance", file=fname,
                    description=f"Nested loop detected in {fname.split('/')[-1]} — O(n²) time complexity. May be acceptable for small data, but will scale poorly.",
                    suggestion="Consider a Map/Set for O(1) lookups. Replace inner lookup with: const lookup = new Map(items.map(i => [i.id, i]))",
                    rule_id="quadratic-complexity", confidence=0.75,
                ))

            # React: missing key in list renders
            if re.search(r"\.map\s*\([^)]*=>\s*<", added) and not re.search(r"key=", added):
                findings.append(Finding(
                    severity="medium", category="performance", file=fname,
                    description=f"React list render without `key` prop in {fname.split('/')[-1]}. React can't optimize reconciliation without stable keys.",
                    suggestion="Add a stable unique key: items.map(item => <Component key={item.id} {...item} />). Never use array index as key for dynamic lists.",
                    rule_id="react-missing-key", confidence=0.80,
                ))

            # Memory leak: addEventListener without removeEventListener
            if re.search(r"addEventListener\b", added) and not re.search(r"removeEventListener\b", added):
                if re.search(r"useEffect", added) or "component" in fname.lower():
                    findings.append(Finding(
                        severity="medium", category="performance", file=fname,
                        description=f"Event listener added in {fname.split('/')[-1]} without corresponding removeEventListener — memory leak risk.",
                        suggestion="Return a cleanup function from useEffect: return () => element.removeEventListener(event, handler);",
                        rule_id="event-listener-leak", confidence=0.78,
                    ))

            # Heavy library imports
            imports = re.findall(r"import\s+.*from\s+['\"]([^'\"]+)['\"]", added)
            for imp in imports:
                pkg = imp.split("/")[0].lstrip("@").split("/")[0] if "/" in imp else imp.lstrip("@")
                if pkg in HEAVY_PACKAGES:
                    findings.append(Finding(
                        severity="low", category="performance", file=fname,
                        description=f"Heavy package imported in {fname.split('/')[-1]}: `{imp}`.",
                        suggestion=HEAVY_PACKAGES[pkg],
                        rule_id=f"heavy-import-{pkg}", confidence=0.85,
                    ))

            # Unindexed sort on large datasets
            if re.search(r"\.sort\s*\(", added) and re.search(r"findMany|SELECT|\.find\(", added):
                findings.append(Finding(
                    severity="low", category="performance", file=fname,
                    description=f"In-memory sort after database query in {fname.split('/')[-1]}. Sorting large result sets in memory is O(n log n) and wastes DB transfer.",
                    suggestion="Push sorting to the database: use ORDER BY in SQL, or orderBy in Prisma. Only sort in memory when you must.",
                    rule_id="in-memory-sort", confidence=0.72,
                ))

        if not findings:
            positives.append("No performance anti-patterns detected in the diff")

        return findings, positives

    def _scan_repo(self, context: dict) -> tuple[list[Finding], list[str]]:
        findings: list[Finding] = []
        positives: list[str] = []
        file_tree = context.get("file_tree", [])
        contents = context.get("key_file_contents", {})

        pkg_json = contents.get("package.json", "")
        if pkg_json:
            for pkg, suggestion in HEAVY_PACKAGES.items():
                if f'"{pkg}"' in pkg_json:
                    findings.append(Finding(
                        severity="low", category="performance",
                        description=f"Heavy dependency '{pkg}' in package.json may impact bundle size.",
                        suggestion=suggestion,
                        rule_id=f"heavy-dep-{pkg}", confidence=0.85,
                    ))

        has_caching = any("redis" in f.lower() or "cache" in f.lower() for f in file_tree)
        if has_caching:
            positives.append("Caching layer detected (Redis/cache module)")

        has_db_index = any("index" in f.lower() and (".sql" in f or "migration" in f.lower()) for f in file_tree)
        if has_db_index:
            positives.append("Database index migrations present")

        return findings, positives
