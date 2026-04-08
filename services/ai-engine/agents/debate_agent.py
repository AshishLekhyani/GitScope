"""
Debate Agent — Cross-Questioning Peer Reviewer
================================================
This is the "second opinion" layer that makes GitScope trustworthy.

After all specialist agents (Security, Quality, Architecture, Performance,
Dependency, Learner) complete, the Debate Agent runs as Phase 2:

1. CONSENSUS BOOST
   If 2+ agents independently flag the same file/category/area, boost that
   finding's confidence by 0.15 (independent corroboration is strong signal).

2. LONE WOLF SCRUTINY
   If only 1 agent flags something with confidence < 0.65, downgrade severity
   by one level (false-positive protection). Still surfaces it but with lower
   weight so humans know to verify.

3. CONTRADICTION DETECTION
   Detects when agents disagree about the same dimension:
   - SecurityAgent scores 88 but has 2 high-severity findings → flag discrepancy
   - LearnerAgent says "seen this pattern 5 times" but other agents missed it
   Contradictions are surfaced as explicit insights.

4. COVERAGE GAP DISCOVERY
   Checks if the full set of findings covers expected concerns:
   - No test findings despite a large diff with no test files?
   - Authentication changes but no auth security findings?
   - Dependencies changed but no dependency findings?
   Gaps are surfaced as "the agents didn't flag this — you should check manually"

5. LEARNED PATTERN VALIDATION
   Findings marked learned=True are cross-checked for language/framework
   relevance. A Python vulnerability pattern applied to Go code gets demoted.

6. CONSENSUS SCORE
   Reports overall inter-agent agreement (0-100). High agreement = trustworthy.
   Low agreement = manual review recommended.

Context expected:
  peer_results: list[AgentResult]  — all Phase 1 agent results
  files:        list[dict]         — changed files (for context)
  analysis_type: str               — "pr" | "commit" | "repo"
  detected_languages: list[str]   — from Phase 1 context detection

Output:
  findings: New meta-findings discovered only through cross-examination
  metadata['adjusted_findings']: All findings with adjusted confidence/severity
  metadata['consensus_score']: 0-100 inter-agent agreement score
  metadata['corroborated']:    list of findings that had multi-agent support
  metadata['demoted']:         list of findings that were lone/weak
  metadata['contradictions']:  list of detected contradictions
  metadata['coverage_gaps']:   list of unchecked concern areas
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding


_SEVERITY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}
_RANK_SEVERITY = {4: "critical", 3: "high", 2: "medium", 1: "low", 0: "info"}


def _downgrade(severity: str) -> str:
    rank = _SEVERITY_RANK.get(severity, 1)
    return _RANK_SEVERITY.get(max(0, rank - 1), "info")


def _upgrade(severity: str) -> str:
    rank = _SEVERITY_RANK.get(severity, 1)
    return _RANK_SEVERITY.get(min(4, rank + 1), "critical")


class DebateAgent(BaseAgent):
    agent_id = "debate"
    agent_name = "Debate Peer Reviewer"
    specialization = "Cross-questions all agent findings, boosts consensus, demotes false positives, surfaces contradictions"

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()

        peer_results: list[AgentResult] = context.get("peer_results", [])
        files: list[dict] = context.get("files", [])
        detected_languages: list[str] = context.get("detected_languages", [])
        analysis_type: str = context.get("analysis_type", "pr")

        if not peer_results:
            return self._timed_result(start, AgentResult(
                agent_id=self.agent_id,
                agent_name=self.agent_name,
                score=70,
                confidence=0.50,
                insights=["No peer results available for cross-examination."],
            ))

        # ── Phase 1: Collect all findings ──────────────────────────────────────
        # Build map: (file, category) → list of (agent_id, Finding)
        coverage_map: dict[tuple[str, str], list[tuple[str, Finding]]] = defaultdict(list)
        all_findings: list[tuple[str, Finding]] = []

        for result in peer_results:
            for finding in result.findings:
                key = (finding.file or "global", finding.category)
                coverage_map[key].append((result.agent_id, finding))
                all_findings.append((result.agent_id, finding))

        # ── Phase 2: Consensus boost ──────────────────────────────────────────
        corroborated: list[str] = []
        demoted: list[str] = []
        adjusted_findings: list[dict] = []

        for (file_name, category), agent_findings in coverage_map.items():
            unique_agents = set(agent_id for agent_id, _ in agent_findings)
            corroboration_count = len(unique_agents)

            for agent_id, finding in agent_findings:
                adj_confidence = finding.confidence
                adj_severity = finding.severity

                if corroboration_count >= 2:
                    # Multiple agents independently flagged same area → boost
                    adj_confidence = min(0.97, finding.confidence + 0.15 * (corroboration_count - 1))
                    if corroboration_count >= 3 and finding.severity not in ("critical",):
                        adj_severity = _upgrade(finding.severity)
                    corroborated.append(
                        f"{finding.description[:60]} ({corroboration_count} agents agreed)"
                    )
                elif corroboration_count == 1 and finding.confidence < 0.65:
                    # Lone weak finding → downgrade
                    adj_confidence = max(0.30, finding.confidence - 0.10)
                    adj_severity = _downgrade(finding.severity)
                    demoted.append(
                        f"{finding.description[:60]} (single-agent, confidence {finding.confidence:.0%} → verify manually)"
                    )

                # ── Learned pattern language relevance check ──────────────────
                if finding.learned and detected_languages:
                    # If the learned finding references a specific language and
                    # we're not using that language, demote confidence
                    desc_lower = finding.description.lower()
                    foreign_lang_signals = {
                        "python": ["def ", "import ", "::", "__init__", "django", "flask"],
                        "go": ["func ", "goroutine", "chan ", "go func"],
                        "rust": ["fn ", "let mut", "impl ", "unwrap()", "cargo"],
                        "java": ["public class", "implements", "extends", "@Override"],
                        "php": ["<?php", "$_GET", "$_POST", "echo $"],
                    }
                    detected_lower = [l.lower() for l in detected_languages]
                    for lang, signals in foreign_lang_signals.items():
                        if lang not in detected_lower:
                            if any(sig in desc_lower for sig in signals):
                                adj_confidence = max(0.25, adj_confidence - 0.20)
                                break

                adjusted_findings.append({
                    **self._finding_to_dict(finding),
                    "confidence": round(adj_confidence, 3),
                    "severity": adj_severity,
                    "corroboration_count": corroboration_count,
                    "debate_adjusted": adj_confidence != finding.confidence or adj_severity != finding.severity,
                })

        # ── Phase 3: Contradiction detection ─────────────────────────────────
        contradictions: list[str] = []
        agent_scores = {r.agent_id: r.score for r in peer_results}
        agent_finding_counts = {r.agent_id: len(r.findings) for r in peer_results}

        sec_score = agent_scores.get("security", 100)
        sec_critical = sum(
            1 for _, f in all_findings
            if f.category == "security" and f.severity in ("critical", "high")
        )
        if sec_score > 80 and sec_critical >= 2:
            contradictions.append(
                f"SecurityAgent scored {sec_score}/100 but {sec_critical} critical/high "
                f"security findings were surfaced — score may be optimistic."
            )

        qual_score = agent_scores.get("quality", 100)
        arch_score = agent_scores.get("architecture", 100)
        if abs(qual_score - arch_score) > 30:
            contradictions.append(
                f"Quality ({qual_score}/100) and Architecture ({arch_score}/100) scores "
                f"diverge by {abs(qual_score - arch_score)} points — inspect both before deciding."
            )

        learner = next((r for r in peer_results if r.agent_id == "learner"), None)
        if learner and learner.findings:
            # Learner found patterns but other agents missed them
            learner_categories = set(f.category for f in learner.findings)
            other_categories = set(
                f.category for agent_id, f in all_findings if agent_id != "learner"
            )
            missed = learner_categories - other_categories
            if missed:
                contradictions.append(
                    f"Learned patterns suggest issues in {', '.join(missed)} that specialist agents didn't flag — "
                    f"these may be subtle or repo-specific patterns worth manual review."
                )

        # ── Phase 4: Coverage gap discovery ──────────────────────────────────
        coverage_gaps: list[str] = []
        file_names = " ".join(f.get("filename", "") for f in files).lower()
        all_categories = set(f.category for _, f in all_findings)

        if analysis_type in ("pr", "commit") and files:
            # Auth changes but no auth security finding?
            if any(k in file_names for k in ("auth", "login", "session", "token", "jwt")):
                if "security" not in all_categories and sec_critical == 0:
                    coverage_gaps.append(
                        "Authentication-related files changed but no security findings raised — "
                        "manually verify: session handling, token expiry, and input validation."
                    )

            # No test files in the diff?
            has_tests = any(
                "test" in f.get("filename", "").lower() or "spec" in f.get("filename", "").lower()
                for f in files
            )
            if not has_tests and len(files) > 2:
                coverage_gaps.append(
                    f"{len(files)} files changed but no test files included — "
                    f"verify that existing tests cover the changed paths."
                )

            # DB migrations not flagged?
            if any(k in file_names for k in ("migration", ".sql", "schema")):
                dep_findings = [f for _, f in all_findings if f.category == "dependency"]
                if not dep_findings:
                    coverage_gaps.append(
                        "Database schema or migration files changed — verify the migration is "
                        "backward-compatible and tested against a production data copy."
                    )

        # ── Phase 5: Consensus score ──────────────────────────────────────────
        # Agreement = how often agents agree on severity (within 1 level)
        if len(peer_results) >= 2:
            scores = [r.score for r in peer_results if r.agent_id != "learner"]
            score_spread = max(scores) - min(scores) if scores else 0
            # Low spread = high consensus
            consensus_score = max(20, min(98, 95 - score_spread))
        else:
            consensus_score = 70

        # ── Phase 6: Compose own findings (meta-level) ───────────────────────
        meta_findings: list[Finding] = []

        # Surface strong contradictions as high-priority findings
        for contradiction in contradictions[:2]:
            meta_findings.append(Finding(
                severity="medium",
                category="analysis-quality",
                description=f"[Agent Disagreement] {contradiction}",
                suggestion="Cross-verify the flagged areas with an additional human review pass.",
                confidence=0.75,
                rule_id="debate-contradiction",
            ))

        # Surface validated corroborations as positive signals (don't add to findings — just insights)

        # ── Compose result ────────────────────────────────────────────────────
        insights: list[str] = []
        positives: list[str] = []

        if corroborated:
            deduplicated = list(dict.fromkeys(corroborated))[:3]
            insights.append(
                f"Multi-agent consensus on {len(corroborated)} concern{'s' if len(corroborated) != 1 else ''}: "
                + "; ".join(deduplicated[:2])
                + ("..." if len(deduplicated) > 2 else "")
            )

        if contradictions:
            insights.append(f"Detected {len(contradictions)} inter-agent discrepancy — see debate findings for details.")

        if coverage_gaps:
            insights.extend(coverage_gaps[:2])

        if demoted:
            positives.append(
                f"Filtered {len(demoted)} low-confidence single-agent signal{'s' if len(demoted) != 1 else ''} to reduce noise."
            )

        if not contradictions and not coverage_gaps:
            positives.append(f"All {len(peer_results)} agents reached consistent conclusions — high result confidence.")

        if consensus_score >= 80:
            positives.append(f"Agent consensus score {consensus_score}/100 — findings are reliable.")

        # Score this agent based on how useful the debate was
        debate_value = len(corroborated) * 5 + len(contradictions) * 10 - len(demoted) * 2
        score = max(40, min(92, 70 + debate_value))

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=score,
            confidence=0.80,
            findings=meta_findings[:3],
            insights=insights,
            positives=positives,
            metadata={
                "adjusted_findings": adjusted_findings,
                "consensus_score": consensus_score,
                "corroborated": corroborated[:5],
                "demoted": demoted[:5],
                "contradictions": contradictions,
                "coverage_gaps": coverage_gaps,
            },
        ))

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
