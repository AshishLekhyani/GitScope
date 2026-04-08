"""
BaseAgent — Foundation class for all GitScope analysis agents.

Every agent:
  • Has a unique ID, name, and specialization description
  • Can spawn child agents via the orchestrator back-reference
  • Returns structured AgentResult objects
  • Tracks its own confidence and reasoning chain
"""

from __future__ import annotations

import asyncio
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agents.orchestrator import Orchestrator


@dataclass
class Finding:
    severity: str          # critical | high | medium | low | info
    category: str          # security | quality | architecture | performance | dependency
    description: str
    suggestion: str
    file: str | None = None
    line: int | None = None
    code_snippet: str | None = None
    confidence: float = 0.85
    cve_id: str | None = None
    rule_id: str | None = None
    learned: bool = False  # True if this finding came from the knowledge base


@dataclass
class AgentResult:
    agent_id: str
    agent_name: str
    score: int                        # 0-100
    confidence: float                 # 0.0-1.0
    findings: list[Finding] = field(default_factory=list)
    insights: list[str] = field(default_factory=list)
    positives: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0
    spawned_agents: list[str] = field(default_factory=list)


class BaseAgent(ABC):
    """
    Base class for all GitScope neural agents.

    Subclasses implement `run()` which receives a context dict and
    returns an AgentResult. The orchestrator calls run() concurrently
    across all registered agents.
    """

    def __init__(self, orchestrator: "Orchestrator | None" = None):
        self.orchestrator = orchestrator
        self.instance_id = str(uuid.uuid4())[:8]

    @property
    @abstractmethod
    def agent_id(self) -> str:
        """Stable ID e.g. 'security', 'quality'."""
        ...

    @property
    @abstractmethod
    def agent_name(self) -> str:
        """Human-readable name."""
        ...

    @property
    @abstractmethod
    def specialization(self) -> str:
        """One-line description of what this agent analyzes."""
        ...

    @abstractmethod
    async def run(self, context: dict[str, Any]) -> AgentResult:
        """
        Perform analysis on the provided context.

        Context keys vary by analysis type:
          PR:   files, pr_meta, commit_meta, repo, analysis_type
          Repo: file_tree, key_file_contents, recent_commits, contributors, meta
        """
        ...

    async def spawn_agent(self, agent_class: type["BaseAgent"], context: dict[str, Any]) -> AgentResult | None:
        """
        Dynamically spawn a specialized child agent.
        Returns its result or None if orchestrator isn't available.
        """
        if self.orchestrator is None:
            return None
        child = agent_class(orchestrator=self.orchestrator)
        result = await child.run(context)
        return result

    def _timed_result(self, start: float, result: AgentResult) -> AgentResult:
        result.duration_ms = int((time.perf_counter() - start) * 1000)
        return result

    def _clamp(self, value: int, lo: int = 0, hi: int = 100) -> int:
        return max(lo, min(hi, value))

    def _added_lines(self, files: list[dict]) -> list[tuple[str, str]]:
        """Extract (filename, line) tuples for all added lines in the diff."""
        pairs = []
        for f in files:
            patch = f.get("patch") or ""
            for line in patch.splitlines():
                if line.startswith("+") and not line.startswith("+++"):
                    pairs.append((f.get("filename", "unknown"), line[1:]))
        return pairs

    def _safe_run_sync(self, fn, *args, fallback=None, **kwargs):
        """
        Execute a synchronous function safely, returning fallback on any error.
        Use for operations that should never crash an agent (pattern matching, etc.)
        """
        try:
            return fn(*args, **kwargs)
        except MemoryError:
            return fallback  # Don't crash on OOM
        except Exception:
            return fallback

    def _degraded_result(self, start: float, reason: str) -> AgentResult:
        """
        Return a minimal safe result when an agent hits an unrecoverable error.
        The agent stays alive and reports it degraded gracefully.
        """
        return self._timed_result(start, AgentResult(
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            score=50,  # Neutral — don't penalize or reward
            confidence=0.20,  # Very low — human should verify
            insights=[
                f"{self.agent_name} encountered an internal error and produced a partial result. "
                f"Manual review recommended. Error context: {reason[:120]}"
            ],
            metadata={"degraded": True, "reason": reason[:200]},
        ))
