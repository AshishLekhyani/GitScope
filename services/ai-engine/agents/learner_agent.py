"""
Pattern Learner Agent (Self-Learning Core)
==========================================
This is what makes GitScope different from all other tools.

The learner agent:
  1. Stores every analysis as vector embeddings in ChromaDB
  2. On each new analysis, retrieves semantically similar past code
  3. Uses retrieved findings to augment current analysis with learned patterns
  4. Continuously builds a "code knowledge base" specific to your repos
  5. Gets smarter with every codebase it analyzes

The model is: all-MiniLM-L6-v2 (lightweight, fast, ~80MB)
Vector store: ChromaDB (persistent, local, no cloud required)

Learning loop:
  analyze → store embedding + findings → next analysis retrieves similar → better results
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding


class LearnerAgent(BaseAgent):
    agent_id = "learner"
    agent_name = "Pattern Learner"
    specialization = "RAG retrieval of learned code patterns, self-improvement over time"

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()
        kb = context.get("knowledge_base")
        files = context.get("files", [])

        if kb is None or not files:
            return self._timed_result(start, AgentResult(
                agent_id=self.agent_id,
                agent_name=self.agent_name,
                score=75,
                confidence=0.50,
                insights=["Knowledge base not available — learning mode inactive."],
            ))

        # Build query from the current diff
        query_text = self._build_query(files)
        if not query_text.strip():
            return self._timed_result(start, AgentResult(
                agent_id=self.agent_id, agent_name=self.agent_name,
                score=75, confidence=0.50,
                insights=["Insufficient code content to retrieve learned patterns."],
            ))

        # Retrieve similar past findings
        similar = await asyncio.to_thread(kb.query_similar, query_text, n_results=5)

        findings: list[Finding] = []
        insights: list[str] = []
        positives: list[str] = []

        pattern_counts: dict[str, int] = {}

        for item in similar:
            item_findings = item.get("findings", [])
            for f_dict in item_findings:
                pattern = f_dict.get("rule_id") or f_dict.get("category", "unknown")
                pattern_counts[pattern] = pattern_counts.get(pattern, 0) + 1

            # If same pattern seen 2+ times across similar code, it's a learned signal
            for pattern, count in pattern_counts.items():
                if count >= 2:
                    # Find the finding template
                    for f_dict in item_findings:
                        if (f_dict.get("rule_id") or f_dict.get("category")) == pattern:
                            findings.append(Finding(
                                severity=f_dict.get("severity", "medium"),
                                category=f_dict.get("category", "quality"),
                                description=f"[Learned pattern from {count} similar codebases] {f_dict.get('description', '')}",
                                suggestion=f_dict.get("suggestion", ""),
                                rule_id=f_dict.get("rule_id"),
                                confidence=min(0.75, 0.50 + count * 0.10),
                                learned=True,
                            ))
                            break

        # Insights from learned patterns
        if similar:
            repos_seen = len(set(s.get("repo", "?") for s in similar))
            insights.append(f"Learned patterns from {len(similar)} similar code samples across {repos_seen} repo{'s' if repos_seen > 1 else ''}.")

        if len(similar) == 0:
            insights.append("First time analyzing this type of code — patterns will be stored for future improvement.")
            positives.append("Adding this analysis to the knowledge base for future reference")
        else:
            positives.append(f"Knowledge base has {len(similar)} relevant learned examples to inform this analysis")

        # Dedup with existing findings from other agents
        unique: list[Finding] = []
        seen_rules: set[str] = set()
        for f in findings:
            key = f.rule_id or f.description[:40]
            if key not in seen_rules:
                seen_rules.add(key)
                unique.append(f)

        # Score: high if we have good learned context
        score = 75 + min(20, len(similar) * 4)

        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=min(95, score),
            confidence=0.70 if similar else 0.40,
            findings=unique[:4],
            insights=insights,
            positives=positives,
        ))

    def _build_query(self, files: list[dict]) -> str:
        """Build a semantic query from the diff content."""
        parts: list[str] = []
        for f in files[:5]:  # Limit to first 5 files for query
            fname = f.get("filename", "")
            patch = f.get("patch", "") or ""
            added = " ".join(
                l[1:] for l in patch.splitlines()[:50]
                if l.startswith("+") and not l.startswith("+++")
            )
            if added.strip():
                parts.append(f"// {fname}\n{added[:500]}")
        return "\n---\n".join(parts)[:2000]

    async def store_analysis(self, repo: str, files: list[dict], results: list["AgentResult"]):
        """Store the current analysis in the knowledge base for future retrieval."""
        try:
            from memory.knowledge_base import KnowledgeBase
            # This is called by the orchestrator after analysis completes
            # The KB is a singleton so we get the same instance
            kb = KnowledgeBase()
            code_text = self._build_query(files)
            all_findings = []
            for r in results:
                for f in r.findings:
                    all_findings.append({
                        "severity": f.severity,
                        "category": f.category,
                        "description": f.description,
                        "suggestion": f.suggestion,
                        "rule_id": f.rule_id,
                    })
            await asyncio.to_thread(
                kb.store,
                repo=repo,
                code_text=code_text,
                findings=all_findings,
                metadata={"file_count": len(files)},
            )
        except Exception:
            pass  # Learning failures must never surface to users
