"""
Orchestrator — The brain of the GitScope Neural Engine.

Responsibilities:
  • Registers and manages all agent types
  • Detects code context (languages, frameworks) from incoming analysis
  • Dynamically spawns specialized agents based on what it finds
  • Runs all agents concurrently via asyncio.gather()
  • Merges results into a unified final report with consensus scoring
  • Streams partial results as each agent completes
  • Feeds finished analyses back to the LearnerAgent for self-improvement
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncGenerator, TYPE_CHECKING

from agents.base import AgentResult, BaseAgent, Finding

if TYPE_CHECKING:
    from memory.knowledge_base import KnowledgeBase


class Orchestrator:
    def __init__(self, knowledge_base: "KnowledgeBase"):
        self.kb = knowledge_base
        self._agent_classes: list[type[BaseAgent]] = []
        self._register_defaults()

    def _register_defaults(self):
        from agents.security_agent import SecurityAgent
        from agents.quality_agent import QualityAgent
        from agents.architecture_agent import ArchitectureAgent
        from agents.performance_agent import PerformanceAgent
        from agents.dependency_agent import DependencyAgent
        from agents.learner_agent import LearnerAgent
        from agents.compliance_agent import ComplianceAgent
        from agents.supply_chain_agent import SupplyChainAgent
        from agents.secrets_agent import SecretsAgent
        from agents.documentation_agent import DocumentationAgent
        # Phase 1 agents — run concurrently
        self._agent_classes = [
            SecurityAgent,
            SecretsAgent,
            QualityAgent,
            ArchitectureAgent,
            PerformanceAgent,
            DependencyAgent,
            LearnerAgent,
            ComplianceAgent,
            SupplyChainAgent,
            DocumentationAgent,
        ]
        # Phase 2 — runs after Phase 1 with all results as context
        from agents.debate_agent import DebateAgent
        self._debate_agent_class = DebateAgent

    def _detect_context(self, files: list[dict]) -> dict[str, Any]:
        """Detect languages and frameworks from file list."""
        extensions: dict[str, int] = {}
        for f in files:
            name = f.get("filename", "")
            if "." in name:
                ext = name.rsplit(".", 1)[-1].lower()
                extensions[ext] = extensions.get(ext, 0) + 1

        languages = []
        if extensions.get("ts", 0) + extensions.get("tsx", 0) > 0:
            languages.append("TypeScript")
        if extensions.get("js", 0) + extensions.get("jsx", 0) > 0:
            languages.append("JavaScript")
        if extensions.get("py", 0) > 0:
            languages.append("Python")
        if extensions.get("go", 0) > 0:
            languages.append("Go")
        if extensions.get("rs", 0) > 0:
            languages.append("Rust")
        if extensions.get("java", 0) > 0:
            languages.append("Java")
        if extensions.get("rb", 0) > 0:
            languages.append("Ruby")
        if extensions.get("php", 0) > 0:
            languages.append("PHP")
        if extensions.get("sol", 0) > 0:
            languages.append("Solidity")

        patches = " ".join(f.get("patch", "") or "" for f in files)
        frameworks = []
        if "from react" in patches.lower() or "import react" in patches.lower():
            frameworks.append("React")
        if "next/" in patches.lower() or "next.config" in patches.lower():
            frameworks.append("Next.js")
        if "from django" in patches.lower():
            frameworks.append("Django")
        if "from flask" in patches.lower():
            frameworks.append("Flask")
        if "from fastapi" in patches.lower():
            frameworks.append("FastAPI")
        if "express(" in patches.lower():
            frameworks.append("Express")
        if "prisma" in patches.lower():
            frameworks.append("Prisma")
        if "graphql" in patches.lower():
            frameworks.append("GraphQL")

        return {"languages": languages, "frameworks": frameworks, "extensions": extensions}

    async def _run_agent_safe(
        self,
        agent_class: type[BaseAgent],
        context: dict[str, Any],
        results_queue: asyncio.Queue,
        timeout_seconds: int = 25,
    ):
        """
        Run a single agent and push result to queue.

        Guarantees:
        - Never raises — any error produces a graceful degraded result
        - Times out after timeout_seconds (default 25s) to prevent hangs
        - Handles: exceptions, timeouts, MemoryError, ChromaDB failures
        - Agent always produces a result, even if degraded
        """
        agent = agent_class(orchestrator=self)
        start = time.perf_counter()
        try:
            result = await asyncio.wait_for(
                agent.run(context),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            result = AgentResult(
                agent_id=agent.agent_id,
                agent_name=agent.agent_name,
                score=50,
                confidence=0.25,
                insights=[
                    f"{agent.agent_name} timed out after {timeout_seconds}s — "
                    f"likely analyzing a very large diff. Partial analysis only."
                ],
                metadata={"degraded": True, "reason": "timeout"},
                duration_ms=int((time.perf_counter() - start) * 1000),
            )
        except MemoryError:
            result = AgentResult(
                agent_id=agent.agent_id,
                agent_name=agent.agent_name,
                score=50,
                confidence=0.20,
                insights=[f"{agent.agent_name} ran out of memory — diff may be too large."],
                metadata={"degraded": True, "reason": "OOM"},
                duration_ms=int((time.perf_counter() - start) * 1000),
            )
        except Exception as e:
            error_type = type(e).__name__
            result = AgentResult(
                agent_id=agent.agent_id,
                agent_name=agent.agent_name,
                score=50,
                confidence=0.30,
                insights=[f"{agent.agent_name} encountered {error_type}: {str(e)[:150]}"],
                metadata={"degraded": True, "reason": f"{error_type}: {str(e)[:200]}"},
                duration_ms=int((time.perf_counter() - start) * 1000),
            )
        await results_queue.put(result)

    async def analyze_pr(self, request: Any) -> AsyncGenerator[dict, None]:
        """Run all agents on a PR/commit and stream partial + final results."""
        files = [f.model_dump() for f in request.files]
        context_meta = self._detect_context(files)

        context: dict[str, Any] = {
            "repo": request.repo,
            "analysis_type": request.analysis_type,
            "files": files,
            "pr_meta": request.pr_meta.model_dump() if request.pr_meta else {},
            "commit_meta": request.commit_meta.model_dump() if request.commit_meta else {},
            "pr_number": request.pr_number,
            "sha": request.sha,
            "detected_languages": context_meta["languages"],
            "detected_frameworks": context_meta["frameworks"],
            "knowledge_base": self.kb,
        }

        yield {"event": "start", "repo": request.repo, "agents": len(self._agent_classes), "context": context_meta}

        queue: asyncio.Queue[AgentResult] = asyncio.Queue()
        tasks = [
            asyncio.create_task(self._run_agent_safe(cls, context, queue))
            for cls in self._agent_classes
        ]

        agent_results: list[AgentResult] = []
        completed = 0
        start = time.perf_counter()

        while completed < len(tasks):
            result = await queue.get()
            agent_results.append(result)
            completed += 1

            # Stream partial result as each agent finishes
            yield {
                "event": "agent_complete",
                "agent_id": result.agent_id,
                "agent_name": result.agent_name,
                "score": result.score,
                "confidence": result.confidence,
                "finding_count": len(result.findings),
                "duration_ms": result.duration_ms,
            }

        await asyncio.gather(*tasks, return_exceptions=True)

        # ── Phase 2: Debate round ────────────────────────────────────────────
        # The DebateAgent cross-examines all Phase 1 findings
        debate_context: dict[str, Any] = {
            **context,
            "peer_results": agent_results,
        }
        debate_result = await self._run_debate(debate_context)
        if debate_result:
            agent_results.append(debate_result)
            yield {
                "event": "agent_complete",
                "agent_id": debate_result.agent_id,
                "agent_name": debate_result.agent_name,
                "score": debate_result.score,
                "confidence": debate_result.confidence,
                "finding_count": len(debate_result.findings),
                "duration_ms": debate_result.duration_ms,
                "phase": "debate",
            }

        # Merge into final result (debate metadata enriches the findings)
        final = self._merge_pr_results(request, files, agent_results, context_meta)
        final["event"] = "complete"
        final["total_ms"] = int((time.perf_counter() - start) * 1000)

        # Feed back to learner for self-improvement
        asyncio.create_task(self._learn_from_analysis(request.repo, files, agent_results))

        yield final

    async def analyze_repo(self, request: Any) -> AsyncGenerator[dict, None]:
        """Run all agents on a full repo scan and stream results."""
        context: dict[str, Any] = {
            "repo": request.repo,
            "file_tree": request.file_tree,
            "key_file_contents": request.key_file_contents,
            "recent_commits": request.recent_commits,
            "contributors": request.contributors,
            "meta": request.meta,
            "scan_mode": request.scan_mode,
            "analysis_type": "repo",
            "files": [],
            "knowledge_base": self.kb,
        }

        yield {"event": "start", "repo": request.repo, "agents": len(self._agent_classes)}

        queue: asyncio.Queue[AgentResult] = asyncio.Queue()
        tasks = [
            asyncio.create_task(self._run_agent_safe(cls, context, queue))
            for cls in self._agent_classes
        ]

        agent_results: list[AgentResult] = []
        completed = 0

        while completed < len(tasks):
            result = await queue.get()
            agent_results.append(result)
            completed += 1
            yield {
                "event": "agent_complete",
                "agent_id": result.agent_id,
                "agent_name": result.agent_name,
                "score": result.score,
                "duration_ms": result.duration_ms,
            }

        await asyncio.gather(*tasks, return_exceptions=True)

        # ── Phase 2: Debate round ────────────────────────────────────────────
        debate_context: dict[str, Any] = {
            **context,
            "peer_results": agent_results,
        }
        debate_result = await self._run_debate(debate_context)
        if debate_result:
            agent_results.append(debate_result)
            yield {
                "event": "agent_complete",
                "agent_id": debate_result.agent_id,
                "agent_name": debate_result.agent_name,
                "score": debate_result.score,
                "duration_ms": debate_result.duration_ms,
                "phase": "debate",
            }

        final = self._merge_repo_results(request, agent_results)
        final["event"] = "complete"
        yield final

    async def _run_debate(self, context: dict[str, Any]) -> AgentResult | None:
        """Run the Debate Agent (Phase 2) — cross-examines all Phase 1 findings."""
        try:
            debate_agent = self._debate_agent_class(orchestrator=self)
            return await debate_agent.run(context)
        except Exception as e:
            return None  # Debate failures must never affect the primary result

    def _merge_pr_results(
        self,
        request: Any,
        files: list[dict],
        results: list[AgentResult],
        context: dict,
    ) -> dict:
        # Check if debate agent produced adjusted findings
        debate_result = next((r for r in results if r.agent_id == "debate"), None)
        debate_meta = debate_result.metadata if debate_result else {}
        adjusted_findings_dicts: list[dict] = debate_meta.get("adjusted_findings", [])
        consensus_score: int = debate_meta.get("consensus_score", 70)
        coverage_gaps: list[str] = debate_meta.get("coverage_gaps", [])
        contradictions: list[str] = debate_meta.get("contradictions", [])

        if adjusted_findings_dicts:
            # Use debate-adjusted findings — sorted by severity then confidence
            sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
            adjusted_findings_dicts.sort(
                key=lambda f: (sev_order.get(f.get("severity", "info"), 5), -f.get("confidence", 0))
            )
            # Deduplicate
            seen: set[str] = set()
            unique_finding_dicts: list[dict] = []
            for f in adjusted_findings_dicts:
                key = f"{f.get('file')}:{f.get('rule_id')}:{f.get('description','')[:40]}"
                if key not in seen:
                    seen.add(key)
                    unique_finding_dicts.append(f)
            # Convert back to Finding objects for the rest of the method
            all_findings = [
                Finding(
                    severity=fd.get("severity", "info"),
                    category=fd.get("category", "quality"),
                    description=fd.get("description", ""),
                    suggestion=fd.get("suggestion", ""),
                    file=fd.get("file"),
                    line=fd.get("line"),
                    code_snippet=fd.get("code_snippet"),
                    confidence=fd.get("confidence", 0.7),
                    cve_id=fd.get("cve_id"),
                    rule_id=fd.get("rule_id"),
                    learned=fd.get("learned", False),
                )
                for fd in unique_finding_dicts
            ]
            unique_findings = all_findings
        else:
            # Fallback: collect and deduplicate raw findings
            all_findings = []
            for r in results:
                if r.agent_id != "debate":
                    all_findings.extend(r.findings)

            sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
            all_findings.sort(key=lambda f: sev_order.get(f.severity, 5))
            seen: set[str] = set()
            unique_findings: list[Finding] = []
            for f in all_findings:
                key = f"{f.file}:{f.rule_id}:{f.description[:40]}"
                if key not in seen:
                    seen.add(key)
                    unique_findings.append(f)

        # Weighted consensus score (debate agent excluded from scoring — it's a meta-layer)
        weights = {"security": 0.18, "secrets": 0.11, "quality": 0.14, "architecture": 0.10, "performance": 0.09, "dependency": 0.08, "learner": 0.06, "compliance": 0.08, "supply_chain": 0.07, "documentation": 0.09}
        total_weight = 0.0
        weighted_score = 0.0
        for r in results:
            if r.agent_id == "debate":
                continue
            w = weights.get(r.agent_id, 0.10)
            weighted_score += r.score * w
            total_weight += w

        overall_score = int(weighted_score / total_weight) if total_weight > 0 else 60

        critical = sum(1 for f in unique_findings if f.severity == "critical")
        high = sum(1 for f in unique_findings if f.severity == "high")

        if critical > 0 or overall_score < 35:
            verdict = "REQUEST_CHANGES"
            merge_risk = "critical" if critical > 0 else "high"
        elif high > 1 or overall_score < 55:
            verdict = "COMMENT"
            merge_risk = "medium"
        elif overall_score >= 75:
            verdict = "APPROVE"
            merge_risk = "low"
        else:
            verdict = "COMMENT"
            merge_risk = "medium"

        sec_result = next((r for r in results if r.agent_id == "security"), None)
        qual_result = next((r for r in results if r.agent_id == "quality"), None)
        arch_result = next((r for r in results if r.agent_id == "architecture"), None)
        perf_result = next((r for r in results if r.agent_id == "performance"), None)
        dep_result = next((r for r in results if r.agent_id == "dependency"), None)

        all_insights = []
        all_positives = []
        for r in results:
            all_insights.extend(r.insights[:2])
            all_positives.extend(r.positives[:2])

        # Prepend debate insights (coverage gaps / contradictions) at the top
        debate_insights = []
        if debate_result:
            debate_insights.extend(debate_result.insights[:3])
        all_insights = debate_insights + all_insights

        total_add = sum(f.get("additions", 0) for f in files)
        total_del = sum(f.get("deletions", 0) for f in files)

        return {
            "model": "gitscope-neural-v2",
            "is_demo": False,
            "verdict": verdict,
            "merge_risk": merge_risk,
            "confidence": min(95, int(sum(r.confidence for r in results) / len(results) * 100)) if results else 70,
            "scores": {
                "overall": overall_score,
                "security": sec_result.score if sec_result else 70,
                "quality": qual_result.score if qual_result else 70,
                "architecture": arch_result.score if arch_result else 70,
                "performance": perf_result.score if perf_result else 70,
                "dependency": dep_result.score if dep_result else 70,
                "value": self._score_value(files, request),
                "test_coverage": self._estimate_tests(files),
                "breaking_risk": min(95, critical * 30 + high * 10),
            },
            "findings": [self._finding_to_dict(f) for f in unique_findings[:12]],
            "insights": all_insights[:8],
            "positives": all_positives[:5],
            "flags": self._compute_flags(files, unique_findings),
            "breaking_changes": self._detect_breaking(files),
            "security_issues": [f.description[:100] for f in unique_findings if f.category == "security"][:5],
            "recommendation": self._recommend(verdict, critical, high, unique_findings),
            "review_checklist": self._checklist(files, unique_findings),
            "estimated_review_time": self._review_time(files, unique_findings),
            "suggested_reviewers": min(5, 1 + len(files) // 5 + (1 if critical > 0 else 0)),
            "impact_areas": self._impact_areas(files),
            "affected_systems": self._affected_systems(files),
            "diff_stats": {
                "file_count": len(files),
                "additions": total_add,
                "deletions": total_del,
                "hot_files": sorted(files, key=lambda f: f.get("additions", 0) + f.get("deletions", 0), reverse=True)[:5],
            },
            "agents": [
                {"id": r.agent_id, "name": r.agent_name, "score": r.score,
                 "confidence": r.confidence, "duration_ms": r.duration_ms,
                 "phase": 2 if r.agent_id == "debate" else 1}
                for r in results
            ],
            "detected_languages": context.get("languages", []),
            "detected_frameworks": context.get("frameworks", []),
            "consensus_score": consensus_score,
            "coverage_gaps": coverage_gaps,
            "contradictions": contradictions,
        }

    def _merge_repo_results(self, request: Any, results: list[AgentResult]) -> dict:
        all_findings: list[Finding] = []
        for r in results:
            all_findings.extend(r.findings)

        weights = {"security": 0.25, "quality": 0.18, "architecture": 0.13, "performance": 0.10, "dependency": 0.12, "learner": 0.08, "compliance": 0.08, "supply_chain": 0.06}
        weighted_score = sum(r.score * weights.get(r.agent_id, 0.10) for r in results)
        total_weight = sum(weights.get(r.agent_id, 0.10) for r in results)
        health_score = int(weighted_score / total_weight) if total_weight > 0 else 60

        sec = next((r for r in results if r.agent_id == "security"), None)
        qual = next((r for r in results if r.agent_id == "quality"), None)
        arch = next((r for r in results if r.agent_id == "architecture"), None)
        perf = next((r for r in results if r.agent_id == "performance"), None)
        dep = next((r for r in results if r.agent_id == "dependency"), None)

        def grade(s: int) -> str:
            return "A" if s >= 85 else "B" if s >= 70 else "C" if s >= 55 else "D" if s >= 40 else "F"

        all_insights = []
        for r in results:
            all_insights.extend(r.insights[:3])

        return {
            "model": "gitscope-neural-v2",
            "is_demo": False,
            "health_score": health_score,
            "summary": self._repo_summary(request, health_score, results),
            "architecture": {
                "summary": arch.insights[0] if arch and arch.insights else "Architecture analyzed.",
                "patterns": arch.metadata.get("patterns", []) if arch else [],
                "strengths": arch.positives if arch else [],
                "concerns": [f.description for f in (arch.findings if arch else []) if f.severity in ("high", "medium")][:4],
            },
            "security": {
                "score": sec.score if sec else 70,
                "grade": grade(sec.score if sec else 70),
                "issues": [self._finding_to_dict(f) for f in (sec.findings if sec else [])],
                "positives": sec.positives if sec else [],
            },
            "code_quality": {
                "score": qual.score if qual else 70,
                "grade": grade(qual.score if qual else 70),
                "issues": [self._finding_to_dict(f) for f in (qual.findings if qual else [])],
                "strengths": qual.positives if qual else [],
            },
            "testability": {
                "score": qual.metadata.get("test_score", 50) if qual else 50,
                "grade": grade(qual.metadata.get("test_score", 50) if qual else 50),
                "has_test_framework": qual.metadata.get("has_tests", False) if qual else False,
                "coverage_estimate": qual.metadata.get("coverage_estimate", "Unknown") if qual else "Unknown",
                "gaps": qual.metadata.get("test_gaps", []) if qual else [],
            },
            "performance": {
                "score": perf.score if perf else 70,
                "grade": grade(perf.score if perf else 70),
                "issues": [self._finding_to_dict(f) for f in (perf.findings if perf else [])],
                "positives": perf.positives if perf else [],
            },
            "dependencies": {
                "score": dep.score if dep else 70,
                "total_count": dep.metadata.get("dep_count", 0) if dep else 0,
                "risks": [f.description for f in (dep.findings if dep else []) if f.severity in ("critical", "high")][:5],
                "outdated_signals": dep.metadata.get("outdated_signals", []) if dep else [],
                "licenses": dep.metadata.get("license_summary", {}) if dep else {},
            },
            "tech_debt": {
                "score": qual.metadata.get("debt_score", 60) if qual else 60,
                "level": qual.metadata.get("debt_level", "manageable") if qual else "manageable",
                "hotspots": qual.metadata.get("debt_hotspots", []) if qual else [],
                "estimated_hours": qual.metadata.get("debt_hours", "Unknown") if qual else "Unknown",
            },
            "recommendations": self._repo_recommendations(results),
            "insights": all_insights[:10],
            "metrics": {
                "primary_language": request.meta.get("language", "Unknown"),
                "file_count": len(request.file_tree),
                "contributors": request.contributors,
                "open_issues": request.meta.get("open_issues_count", 0),
                "stars": request.meta.get("stargazers_count", 0),
            },
            "agents": [{"id": r.agent_id, "score": r.score, "duration_ms": r.duration_ms} for r in results],
        }

    def _finding_to_dict(self, f: Finding) -> dict:
        return {
            "severity": f.severity,
            "category": f.category,
            "description": f.description,
            "suggestion": f.suggestion,
            "file": f.file,
            "line": f.line,
            "code_snippet": f.code_snippet,
            "confidence": f.confidence,
            "cve_id": f.cve_id,
            "rule_id": f.rule_id,
            "learned": f.learned,
        }

    def _score_value(self, files: list[dict], request: Any) -> int:
        score = 60
        has_tests = any(f.get("filename", "").find("test") != -1 or f.get("filename", "").find("spec") != -1 for f in files)
        title = ""
        if request.pr_meta:
            title = request.pr_meta.title or ""
        if has_tests:
            score += 15
        if title.startswith(("feat", "fix", "refactor", "perf", "security")):
            score += 5
        total = sum(f.get("additions", 0) + f.get("deletions", 0) for f in files)
        if total > 2000:
            score -= 10
        return max(10, min(98, score))

    def _estimate_tests(self, files: list[dict]) -> int:
        test_files = [f for f in files if "test" in f.get("filename", "") or "spec" in f.get("filename", "")]
        src_files = [f for f in files if not ("test" in f.get("filename", "") or "spec" in f.get("filename", "")) and f.get("filename", "").endswith((".ts", ".tsx", ".js", ".py"))]
        if not src_files:
            return 70
        if not test_files:
            return 15
        return min(90, int(len(test_files) / (len(test_files) + len(src_files)) * 120))

    def _compute_flags(self, files: list[dict], findings: list[Finding]) -> list[str]:
        flags = set()
        if any(f.category == "security" and f.severity == "critical" for f in findings):
            flags.add("security")
        if any("auth" in f.get("filename", "").lower() for f in files):
            flags.add("auth")
        if any("migration" in f.get("filename", "").lower() or ".sql" in f.get("filename", "") for f in files):
            flags.add("database")
        if any(f.get("filename", "") in ("package.json", "requirements.txt", "go.mod") for f in files):
            flags.add("deps")
        if any("api/" in f.get("filename", "") for f in files):
            flags.add("api-contract")
        return list(flags)

    def _detect_breaking(self, files: list[dict]) -> list[str]:
        changes = []
        for f in files:
            patch = f.get("patch", "") or ""
            name = f.get("filename", "")
            if ("migration" in name or ".sql" in name) and ("DROP TABLE" in patch or "DROP COLUMN" in patch):
                changes.append(f"Destructive DB migration in {name.split('/')[-1]}")
            if ("api/" in name or "route" in name) and f.get("status") == "removed":
                changes.append(f"API endpoint deleted: {name}")
            if name == "package.json" and '"version":' in patch:
                changes.append("Package version bumped — update CHANGELOG")
        return list(set(changes))[:6]

    def _recommend(self, verdict: str, critical: int, high: int, findings: list[Finding]) -> str:
        if verdict == "REQUEST_CHANGES":
            return f"Fix the {critical} critical issue{'s' if critical != 1 else ''} before merging. Run a full security audit and address all blockers."
        if verdict == "COMMENT":
            return f"Review the {high} concern{'s' if high != 1 else ''} raised. Confirm they are acceptable or addressed, then this can be merged."
        return "Analysis found no critical issues. Confirm tests pass and do a final human logic review before merging."

    def _checklist(self, files: list[dict], findings: list[Finding]) -> list[str]:
        items = [f"Review {len(files)} changed file{'s' if len(files) != 1 else ''} for logical correctness"]
        if any(f.category == "security" for f in findings):
            items.append("Address all security findings before merge")
        if not any("test" in f.get("filename", "") for f in files):
            items.append("Add tests for new/changed code paths")
        items.append("Verify CI/CD pipeline passes all checks")
        if any("migration" in f.get("filename", "") for f in files):
            items.append("Test database migration against a production data copy")
        return items[:7]

    def _review_time(self, files: list[dict], findings: list[Finding]) -> str:
        total = sum(f.get("additions", 0) + f.get("deletions", 0) for f in files)
        mins = max(10, min(120, 15 + len(files) * 3 + total // 50))
        return f"{mins} min" if mins < 60 else f"{round(mins / 60 * 10) / 10}h"

    def _impact_areas(self, files: list[dict]) -> list[str]:
        areas = []
        names = " ".join(f.get("filename", "") for f in files).lower()
        if "auth" in names or "login" in names or "session" in names:
            areas.append("authentication")
        if "api/" in names:
            areas.append("API")
        if "prisma" in names or "migration" in names or ".sql" in names:
            areas.append("database")
        if "component" in names or "page" in names or ".tsx" in names:
            areas.append("frontend")
        if "lib/" in names or "util" in names:
            areas.append("shared-utilities")
        return areas

    def _affected_systems(self, files: list[dict]) -> list[str]:
        mapping = {"authentication": "Auth Service", "API": "Backend API", "database": "Database",
                   "frontend": "Frontend UI", "shared-utilities": "Shared Libraries"}
        return [mapping.get(a, a) for a in self._impact_areas(files)]

    def _repo_summary(self, request: Any, health: int, results: list[AgentResult]) -> str:
        lang = request.meta.get("language", "code")
        health_desc = "solid foundation" if health >= 75 else "moderate health with areas to improve" if health >= 55 else "significant improvements needed"
        sec = next((r for r in results if r.agent_id == "security"), None)
        note = ""
        if sec and sec.score < 60:
            note = " Security posture needs attention."
        return f"{request.repo} ({lang} project). Overall health {health}/100 — {health_desc}.{note} {request.contributors} contributor{'s' if request.contributors != 1 else ''}, {len(request.file_tree)} tracked files."

    def _repo_recommendations(self, results: list[AgentResult]) -> list[dict]:
        recs = []
        for r in results:
            for finding in r.findings[:2]:
                if finding.severity in ("critical", "high"):
                    recs.append({
                        "priority": "immediate" if finding.severity == "critical" else "short-term",
                        "title": finding.description[:60],
                        "description": finding.suggestion,
                        "effort": "medium",
                        "source_agent": r.agent_id,
                    })
        return recs[:6]

    async def _learn_from_analysis(self, repo: str, files: list[dict], results: list[AgentResult]):
        """Background task: store findings in knowledge base for future learning."""
        try:
            from agents.learner_agent import LearnerAgent
            learner = LearnerAgent(orchestrator=self)
            await learner.store_analysis(repo, files, results)
        except Exception:
            pass  # Learning failures must never affect primary analysis
