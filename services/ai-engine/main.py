"""
GitScope Neural Intelligence Engine
====================================
Multi-agent, self-learning code analysis service.
Runs alongside Next.js as a local sidecar (default: http://localhost:8765).

Endpoints:
  POST /analyze/pr       — PR / commit diff analysis (streaming NDJSON)
  POST /analyze/repo     — Full repo deep scan (streaming NDJSON)
  POST /learn            — Feed new code patterns into the knowledge base
  GET  /agents           — List registered agent types
  GET  /health           — Liveness probe
"""

import asyncio
import json
import logging
import os
import time
import traceback
from typing import AsyncGenerator

logger = logging.getLogger(__name__)

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.exception_handlers import http_exception_handler
from pydantic import BaseModel, Field

load_dotenv()

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    # Startup: kick off heavy init in the background so the health probe
    # can respond immediately.  Render marks the service healthy as soon as
    # /health returns 200; we don't need the model to be loaded by then.
    async def _deferred_init():
        import asyncio
        await asyncio.sleep(2)          # let the server bind its port first
        try:
            get_orchestrator()           # initialises KB + loads agents
        except Exception:
            pass
        try:
            from crawler.scheduler import start_background_learning
            start_background_learning()
        except Exception:
            pass
        try:
            # Pre-download the embedding model in the background
            from memory.vector_store import _get_embed_model
            await asyncio.to_thread(_get_embed_model)
        except Exception:
            pass

    asyncio.create_task(_deferred_init())
    yield
    # Shutdown: nothing to clean up (Neon persists automatically)

app = FastAPI(
    lifespan=lifespan,
    title="GitScope Neural Intelligence Engine",
    version="2.0.0",
    description="Self-learning multi-agent code analysis service",
)

# Build the allowed origins list from env vars so this works in any environment.
# In production, set APP_URL=https://your-app.vercel.app
# Multiple origins: APP_URL=https://app.example.com,https://www.example.com
_raw_origins = os.getenv("APP_URL", "")
_extra_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

ALLOWED_ORIGINS = list({
    "http://localhost:3000",
    "http://localhost:3001",
    os.getenv("NEXTJS_ORIGIN", "http://localhost:3000"),
    *_extra_origins,
} - {""})

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Lazy singletons ────────────────────────────────────────────────────────────

_orchestrator = None
_knowledge_base = None


def get_orchestrator():
    global _orchestrator
    if _orchestrator is None:
        from agents.orchestrator import Orchestrator
        from memory.knowledge_base import KnowledgeBase
        kb = get_knowledge_base()
        _orchestrator = Orchestrator(knowledge_base=kb)
    return _orchestrator


def get_knowledge_base():
    global _knowledge_base
    if _knowledge_base is None:
        from memory.knowledge_base import KnowledgeBase
        _knowledge_base = KnowledgeBase()
    return _knowledge_base


# ── Request / Response models ──────────────────────────────────────────────────

class FileChange(BaseModel):
    filename: str
    status: str = "modified"
    additions: int = 0
    deletions: int = 0
    patch: str | None = None


class PRMeta(BaseModel):
    title: str = ""
    body: str | None = None
    user: dict = Field(default_factory=dict)
    additions: int = 0
    deletions: int = 0
    changed_files: int = 0
    draft: bool = False
    labels: list = Field(default_factory=list)


class CommitMeta(BaseModel):
    commit: dict = Field(default_factory=dict)
    stats: dict | None = None


class AnalyzePRRequest(BaseModel):
    repo: str
    analysis_type: str = "pr"   # "pr" | "commit"
    files: list[FileChange] = Field(default_factory=list)
    pr_meta: PRMeta | None = None
    commit_meta: CommitMeta | None = None
    pr_number: int | None = None
    sha: str | None = None


class AnalyzeRepoRequest(BaseModel):
    repo: str
    file_tree: list[str] = Field(default_factory=list)
    key_file_contents: dict[str, str] = Field(default_factory=dict)
    recent_commits: list[str] = Field(default_factory=list)
    contributors: int = 1
    meta: dict = Field(default_factory=dict)
    scan_mode: str = "standard"  # "standard" | "deep"


class LearnRequest(BaseModel):
    repo: str
    language: str = "unknown"
    code_chunks: list[str] = Field(default_factory=list)
    findings: list[dict] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)


# ── Streaming NDJSON helpers ───────────────────────────────────────────────────

async def stream_event(event: str, data: dict) -> str:
    return json.dumps({"event": event, "data": data}) + "\n"


async def stream_analysis(
    generator: AsyncGenerator[dict, None],
) -> AsyncGenerator[bytes, None]:
    async for chunk in generator:
        yield (json.dumps(chunk) + "\n").encode()


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Global fallback — catches any unhandled exception so the server never crashes.
    Returns a structured error response instead of a 500 traceback.
    """
    error_type = type(exc).__name__
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {error_type}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_engine_error",
            "error_type": error_type,
            "message": str(exc)[:300],
            "path": str(request.url.path),
            "note": "The engine recovered from this error. Please retry the request.",
        },
    )


@app.get("/health")
async def health():
    """
    Liveness probe — always returns 200 quickly so Render marks the service
    healthy while heavy init (DB, embedding model) finishes in the background.

    For a detailed subsystem check, use GET /health/deep.
    """
    # Report whether the heavy singletons have already initialised,
    # but never block waiting for them.
    orch_ready = _orchestrator is not None
    kb_ready = _knowledge_base is not None

    return {
        "status": "ok",
        "version": "2.0.0",
        "engine": "gitscope-neural-v2",
        "ready": orch_ready,
        "orchestrator": "ready" if orch_ready else "initialising",
        "knowledge_base": "ready" if kb_ready else "initialising",
        "capabilities": [
            "multi-agent-orchestration",
            "debate-peer-review",
            "self-learning",
            "semantic-embeddings",
            "cve-pattern-matching",
            "cross-language-analysis",
        ],
        "learning_enabled": os.getenv("GITSCOPE_AUTO_LEARN", "0") == "1",
    }


@app.get("/health/deep")
async def health_deep():
    """
    Deep health check — verifies all subsystems are operational.
    May take a few seconds. Do not use as the Render health probe.
    """
    checks: dict[str, str] = {}
    overall_ok = True

    try:
        orch = get_orchestrator()
        checks["orchestrator"] = f"ok ({len(orch._agent_classes)} agents)"
    except Exception as e:
        checks["orchestrator"] = f"error: {str(e)[:80]}"
        overall_ok = False

    try:
        kb = get_knowledge_base()
        stats = kb.get_stats()
        checks["knowledge_base"] = f"ok ({stats.get('total_patterns', 0)} patterns)"
    except Exception as e:
        checks["knowledge_base"] = f"degraded: {str(e)[:80]}"

    try:
        from memory.vector_store import _embed_model
        checks["embeddings"] = "ok" if _embed_model else "loading (first request may be slower)"
    except Exception as e:
        checks["embeddings"] = f"degraded: {str(e)[:80]}"

    return {
        "status": "ok" if overall_ok else "degraded",
        "version": "2.0.0",
        "engine": "gitscope-neural-v2",
        "checks": checks,
        "knowledge": checks.get("knowledge_base", "unknown"),
        "learning_enabled": os.getenv("GITSCOPE_AUTO_LEARN", "0") == "1",
    }


@app.get("/agents")
async def list_agents():
    return {
        "agents": [
            {"id": "security", "name": "Security Sentinel", "specialization": "OWASP Top 10, CVE patterns, secrets, injection"},
            {"id": "quality", "name": "Quality Analyst", "specialization": "Complexity, maintainability, dead code, smells"},
            {"id": "architecture", "name": "Architecture Advisor", "specialization": "SOLID, coupling, cohesion, design patterns"},
            {"id": "performance", "name": "Performance Profiler", "specialization": "N+1, memory leaks, O(n²), blocking I/O"},
            {"id": "dependency", "name": "Dependency Inspector", "specialization": "CVE advisories, licenses, version drift"},
            {"id": "learner", "name": "Pattern Learner", "specialization": "RAG knowledge retrieval, self-improvement"},
        ]
    }


@app.post("/analyze/pr")
async def analyze_pr(request: AnalyzePRRequest):
    """Stream PR/commit analysis as NDJSON. Each line is a JSON object."""
    async def generate():
        try:
            orch = get_orchestrator()
            async for chunk in orch.analyze_pr(request):
                yield (json.dumps(chunk) + "\n").encode()
        except Exception as e:
            err = {"event": "error", "message": str(e), "trace": traceback.format_exc()[:500]}
            yield (json.dumps(err) + "\n").encode()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.post("/analyze/repo")
async def analyze_repo(request: AnalyzeRepoRequest):
    """Stream repo scan as NDJSON."""
    async def generate():
        try:
            orch = get_orchestrator()
            async for chunk in orch.analyze_repo(request):
                yield (json.dumps(chunk) + "\n").encode()
        except Exception as e:
            err = {"event": "error", "message": str(e)}
            yield (json.dumps(err) + "\n").encode()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.post("/learn")
async def learn(request: LearnRequest):
    """Feed new patterns into the knowledge base for future analysis."""
    kb = get_knowledge_base()
    count = await asyncio.to_thread(kb.store_patterns, request)
    return {"status": "learned", "patterns_stored": count}


@app.get("/knowledge/stats")
async def knowledge_stats():
    """Return what the engine has learned so far."""
    kb = get_knowledge_base()
    stats = await asyncio.to_thread(kb.get_stats)
    return {
        "status": "ok",
        "knowledge_base": stats,
        "learning_enabled": os.getenv("GITSCOPE_AUTO_LEARN", "0") == "1",
    }


@app.post("/knowledge/trigger-learn")
async def trigger_learn(background_tasks=None):
    """Manually trigger a learning cycle (GitHub + docs)."""
    async def _run():
        from crawler.github_learner import GitHubLearner
        from crawler.doc_crawler import DocCrawler
        g = await GitHubLearner().run_learning_cycle()
        d = await DocCrawler().run_doc_cycle()
        return g + d

    asyncio.create_task(_run())
    return {"status": "learning_cycle_started", "note": "Running in background — check /knowledge/stats"}
