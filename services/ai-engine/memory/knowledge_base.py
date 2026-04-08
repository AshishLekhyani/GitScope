"""
Knowledge Base — The Self-Learning Brain
==========================================
Manages what GitScope has learned across all analyzed codebases.

Each analysis feeds into the knowledge base:
  1. Code chunks are embedded and stored with their findings
  2. Future analyses query the KB for similar code
  3. If the same issue appears in 2+ similar codebases, confidence rises
  4. Over time, GitScope develops intuition for YOUR codebase's patterns

The knowledge base also tracks:
  - Most common issue types per language
  - Hotspot files (files that consistently have issues)
  - Improvement trajectories (is code getting better over time?)
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any

from memory.vector_store import (
    query_similar_patterns,
    store_code_pattern,
    store_repo_profile,
    get_stats,
)

logger = logging.getLogger(__name__)


class KnowledgeBase:
    """
    Thread-safe knowledge base backed by PostgreSQL + pgvector (Neon).
    Designed as a singleton — all agents share the same instance.
    """

    def __init__(self):
        self._stats_cache: dict[str, Any] = {}
        self._stats_ts: float = 0

    def store(
        self,
        repo: str,
        code_text: str,
        findings: list[dict],
        metadata: dict[str, Any] | None = None,
        skip_dedup_check: bool = False,
    ) -> int:
        """
        Store a code analysis result. Returns count of patterns stored.

        Cross-reference check: if near-identical content (similarity > 0.93)
        already exists in the knowledge base, we skip storage to avoid polluting
        the RAG index with duplicates. This keeps retrieval quality high.
        """
        if not code_text.strip():
            return 0

        # ── Cross-reference dedup check ─────────────────────────────────────
        if not skip_dedup_check and len(code_text) > 100:
            try:
                similar = query_similar_patterns(code_text[:800], n_results=1)
                if similar and similar[0].get("similarity", 0) > 0.93:
                    logger.debug(
                        f"Skipping near-duplicate for {repo} "
                        f"(similarity {similar[0]['similarity']:.2f} vs existing)"
                    )
                    return 0  # Already know this — don't add noise
            except Exception:
                pass  # Dedup failure must never block storage

        meta = {
            "repo": repo,
            "timestamp": int(time.time()),
            "finding_count": len(findings),
            "severity_critical": sum(1 for f in findings if f.get("severity") == "critical"),
            "severity_high": sum(1 for f in findings if f.get("severity") == "high"),
            **(metadata or {}),
        }

        # Generate stable ID from content hash
        doc_id = f"{repo}:{hashlib.sha256(code_text[:500].encode()).hexdigest()[:16]}"

        success = store_code_pattern(
            doc_id=doc_id,
            code_text=code_text,
            findings=findings,
            metadata=meta,
        )

        return 1 if success else 0

    def query_similar(
        self,
        query_text: str,
        n_results: int = 5,
        repo_filter: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Retrieve the most semantically similar past analyses.
        Returns list of { repo, findings, similarity, metadata } dicts.
        """
        where = {"repo": repo_filter} if repo_filter else None
        results = query_similar_patterns(query_text, n_results=n_results, where=where)
        return results

    def store_patterns(self, request: Any) -> int:
        """Handle POST /learn requests from the API."""
        count = 0
        for chunk in request.code_chunks[:20]:
            n = self.store(
                repo=request.repo,
                code_text=chunk,
                findings=request.findings,
                metadata={"language": request.language, **request.context},
            )
            count += n
        return count

    def get_stats(self) -> dict[str, Any]:
        """Return knowledge base statistics (cached for 60s)."""
        now = time.time()
        if now - self._stats_ts < 60:
            return self._stats_cache

        raw = get_stats()
        self._stats_cache = {
            "total_patterns": raw.get("code_patterns", 0),
            "total_repos": raw.get("repo_profiles", 0),
            "vector_store_available": raw.get("code_patterns", -1) != -1,
        }
        self._stats_ts = now
        return self._stats_cache

    def update_repo_profile(self, repo: str, analysis_result: dict[str, Any]):
        """Update the stored profile for a repository after analysis."""
        profile = {
            "repo": repo,
            "language": analysis_result.get("metrics", {}).get("primary_language", "unknown"),
            "health_score": analysis_result.get("health_score", 0),
            "patterns": analysis_result.get("architecture", {}).get("patterns", []),
            "last_analyzed": int(time.time()),
        }
        store_repo_profile(repo, profile)
