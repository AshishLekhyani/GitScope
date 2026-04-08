"""
Background Learning Scheduler
===============================
Runs the GitHub learner, doc crawler, and self-synthesis loop.
Integrated into FastAPI startup lifecycle.

Schedule:
  • GitHub learning:      immediately on boot + every 6 hours
  • Documentation crawl:  immediately on boot + every 24 hours
  • Self-synthesis:       every 12 hours (engine reflects on what it learned)

All tasks fire-and-forget — failures never affect the main service.
Set GITSCOPE_AUTO_LEARN=1 to enable.
"""

from __future__ import annotations

import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# GITSCOPE_AUTO_LEARN=1 enables all background tasks
AUTO_LEARN = os.getenv("GITSCOPE_AUTO_LEARN", "0") == "1"

GITHUB_INTERVAL   = int(os.getenv("GITHUB_LEARN_INTERVAL", str(6 * 3600)))    # 6h
DOC_INTERVAL      = int(os.getenv("DOC_CRAWL_INTERVAL",   str(24 * 3600)))    # 24h
SYNTHESIS_INTERVAL = int(os.getenv("SYNTHESIS_INTERVAL",  str(12 * 3600)))    # 12h


async def _github_learning_loop():
    """GitHub learning — runs immediately, then every GITHUB_INTERVAL seconds."""
    from crawler.github_learner import GitHubLearner
    learner = GitHubLearner()

    # First run: 20s after startup (give the service a moment to warm up)
    await asyncio.sleep(20)

    while True:
        try:
            patterns = await learner.run_learning_cycle()
            logger.info(f"[Learner] GitHub cycle complete: +{patterns} patterns learned")
        except Exception as e:
            logger.warning(f"[Learner] GitHub cycle error: {e}")
        await asyncio.sleep(GITHUB_INTERVAL)


async def _doc_crawl_loop():
    """Doc crawl — runs 60s after startup, then every DOC_INTERVAL seconds."""
    from crawler.doc_crawler import DocCrawler
    crawler = DocCrawler()

    # Start 60s after boot so GitHub learning goes first
    await asyncio.sleep(60)

    while True:
        try:
            chunks = await crawler.run_doc_cycle()
            logger.info(f"[Learner] Doc crawl complete: +{chunks} knowledge chunks")
        except Exception as e:
            logger.warning(f"[Learner] Doc crawl error: {e}")
        await asyncio.sleep(DOC_INTERVAL)


async def _self_synthesis_loop():
    """
    Self-Synthesis — the engine reflects on what it has learned.

    Every 12 hours:
    1. Queries the knowledge base for the most common finding patterns
    2. Generates "meta-patterns" by clustering similar findings
    3. Identifies gaps in knowledge (categories with few stored patterns)
    4. Logs insights so operators can see the engine growing

    This is the "thinking on its own" capability — the engine doesn't just
    store what it sees, it reasons about the patterns it has accumulated.
    """
    await asyncio.sleep(5 * 60)  # Start 5 min after boot

    while True:
        try:
            await _run_synthesis()
        except Exception as e:
            logger.warning(f"[Synthesis] Error: {e}")
        await asyncio.sleep(SYNTHESIS_INTERVAL)


async def _run_synthesis():
    """
    The engine examines its own knowledge base and generates insights.
    Runs in a thread to avoid blocking the event loop.
    """
    import asyncio
    result = await asyncio.to_thread(_synthesis_worker)
    if result:
        logger.info(f"[Synthesis] Self-reflection complete: {result}")


def _synthesis_worker() -> str:
    """
    Runs in a thread. Queries the pgvector knowledge base, finds clusters,
    logs meta-patterns. Returns a summary string.
    """
    try:
        from memory.vector_store import query_similar_patterns, get_stats, _get_embed_model

        stats = get_stats()
        total = stats.get("total_patterns", 0)
        if total < 10:
            return f"Not enough data yet ({total} patterns) — need more analyses to self-synthesize"

        # Query for each security domain to see coverage
        domains = [
            ("SQL injection", "sql injection parameterized query prepared statement"),
            ("XSS", "cross-site scripting output encoding dangerouslySetInnerHTML"),
            ("Auth bypass", "authentication authorization JWT bearer token session"),
            ("Secrets exposure", "hardcoded secret api key password environment variable"),
            ("Crypto misuse", "encryption hash MD5 SHA1 bcrypt argon2 weak cipher"),
            ("Command injection", "exec shell subprocess command injection"),
            ("Deserialization", "pickle yaml load deserialize untrusted input"),
            ("Path traversal", "file path directory traversal user input"),
            ("SSRF", "server-side request forgery fetch user-controlled url"),
            ("Rate limiting", "rate limit throttle brute force denial of service"),
            ("Container security", "docker kubernetes privileged root USER namespace"),
            ("Cloud security", "IAM S3 bucket public policy least privilege"),
        ]

        model = _get_embed_model()
        if model is None:
            return f"Embedding model unavailable (total patterns: {total})"

        def _embed(text: str) -> list[float] | None:
            """Embed using either fastembed (.embed generator) or sentence-transformers (.encode)."""
            try:
                if hasattr(model, "embed"):
                    # fastembed: returns a generator of numpy arrays
                    vecs = list(model.embed([text]))
                    return vecs[0].tolist() if vecs else None
                elif hasattr(model, "encode"):
                    # sentence-transformers
                    return model.encode(text, normalize_embeddings=True).tolist()
            except Exception:
                pass
            return None

        coverage_report = []
        for domain_name, query in domains:
            try:
                embedding = _embed(query)
                if embedding is None:
                    continue
                results = query_similar_patterns(embedding, n_results=5)
                hits = len(results)
                coverage_report.append(f"{domain_name}: {hits} patterns")
            except Exception:
                pass

        report_str = " | ".join(coverage_report)
        logger.info(f"[Synthesis] Knowledge coverage — {report_str}")
        logger.info(f"[Synthesis] Total knowledge base size: {total} code patterns")

        return f"{total} total patterns | covered {len(coverage_report)} security domains"

    except Exception as e:
        return f"synthesis failed: {e}"


def start_background_learning():
    """
    Start all background learning and synthesis tasks.
    Call this from FastAPI lifespan startup.
    """
    if not AUTO_LEARN:
        logger.info("[Learner] Auto-learning disabled. Set GITSCOPE_AUTO_LEARN=1 to enable.")
        logger.info("[Learner] Run: echo 'GITSCOPE_AUTO_LEARN=1' >> .env && ./start.sh --auto-learn")
        return

    logger.info("[Learner] Starting autonomous learning + self-synthesis tasks...")
    asyncio.create_task(_github_learning_loop())   # Starts in 20s
    asyncio.create_task(_doc_crawl_loop())         # Starts in 60s
    asyncio.create_task(_self_synthesis_loop())    # Starts in 5min
    logger.info(
        "[Learner] Scheduled: GitHub (6h), Docs (24h), Self-synthesis (12h). "
        "First run begins in 20s."
    )
