"""
Vector Store — PostgreSQL + pgvector (Neon)
============================================
Replaces local ChromaDB with the existing Neon PostgreSQL database.

Knowledge persists forever — survives Render restarts, redeploys, and
sleep cycles. No persistent disk needed on the hosting provider.

Tables (auto-created on first run):
  code_patterns  — code chunks + embeddings + findings
  repo_profiles  — high-level repo health profiles

Embeddings:
  Uses fastembed (BAAI/bge-small-en-v1.5, 384 dims, ~33MB)
  Much lighter than torch/sentence-transformers — fits in 512MB free tier.
  Falls back gracefully when unavailable (pattern analysis still works).

Requires: DATABASE_URL environment variable (your Neon connection string)
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "")

# ── Singletons ────────────────────────────────────────────────────────────────
_pool = None
_embed_model = None
_schema_ready = False
VECTOR_DIM = 384  # bge-small-en-v1.5 and all-MiniLM-L6-v2 both output 384 dims


# ── Clean the Neon URL for psycopg2 ──────────────────────────────────────────

def _clean_dsn(url: str) -> str:
    """
    psycopg2 doesn't understand channel_binding= parameter.
    Strip it so the connection works on Neon.
    """
    return re.sub(r"[&?]channel_binding=[^&]*", "", url)


# ── Connection pool ───────────────────────────────────────────────────────────

def _get_pool():
    global _pool
    if _pool is not None:
        return _pool
    if not DATABASE_URL:
        logger.warning("DATABASE_URL not set — vector store disabled")
        return None
    try:
        import psycopg2.pool
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=5,
            dsn=_clean_dsn(DATABASE_URL),
        )
        logger.info("PostgreSQL (Neon) connection pool ready")
        _ensure_schema()
    except Exception as e:
        logger.error(f"PostgreSQL connection failed: {e}")
        _pool = None
    return _pool


def _conn():
    """Borrow a connection from the pool."""
    pool = _get_pool()
    if pool is None:
        return None
    try:
        return pool.getconn()
    except Exception as e:
        logger.error(f"Failed to get DB connection: {e}")
        return None


def _release(pool, conn):
    """Return connection to pool safely."""
    try:
        pool.putconn(conn)
    except Exception:
        pass


# ── Schema bootstrap ──────────────────────────────────────────────────────────

def _ensure_schema():
    """Create pgvector extension and tables on first run. Idempotent."""
    global _schema_ready
    if _schema_ready:
        return
    pool = _get_pool()
    if pool is None:
        return
    conn = None
    try:
        conn = pool.getconn()
        with conn.cursor() as cur:
            # Enable pgvector
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")

            # Code patterns table
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS gitscope_code_patterns (
                    id           TEXT PRIMARY KEY,
                    embedding    vector({VECTOR_DIM}),
                    document     TEXT,
                    findings_json TEXT DEFAULT '[]',
                    code_preview TEXT DEFAULT '',
                    meta         JSONB DEFAULT '{{}}',
                    created_at   TIMESTAMPTZ DEFAULT NOW()
                )
            """)

            # HNSW index — works on empty tables (unlike ivfflat)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS gitscope_patterns_hnsw
                ON gitscope_code_patterns
                USING hnsw (embedding vector_cosine_ops)
                WITH (m = 16, ef_construction = 64)
            """)

            # Repo profiles table
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS gitscope_repo_profiles (
                    repo         TEXT PRIMARY KEY,
                    embedding    vector({VECTOR_DIM}),
                    profile_text TEXT,
                    meta         JSONB DEFAULT '{{}}',
                    updated_at   TIMESTAMPTZ DEFAULT NOW()
                )
            """)

            conn.commit()
            _schema_ready = True
            logger.info("pgvector schema ready (gitscope_code_patterns, gitscope_repo_profiles)")
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Schema setup failed: {e}")
    finally:
        if conn:
            _release(pool, conn)


# ── Embedding model ───────────────────────────────────────────────────────────

def _get_embed_model():
    """
    Load fastembed model (BAAI/bge-small-en-v1.5).
    ~33MB, onnxruntime backend — no torch needed, fits in 512MB free tier.
    Falls back to sentence-transformers if fastembed isn't installed.
    Returns None if neither is available (pattern analysis still works).
    """
    global _embed_model
    if _embed_model is not None:
        return _embed_model

    # Try fastembed first (lightweight, onnxruntime-based)
    try:
        from fastembed import TextEmbedding
        _embed_model = TextEmbedding("BAAI/bge-small-en-v1.5")
        logger.info("Embedding model loaded: fastembed/bge-small-en-v1.5 (384 dims, onnxruntime)")
        return _embed_model
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"fastembed load failed: {e}")

    # Try sentence-transformers fallback
    try:
        from sentence_transformers import SentenceTransformer
        _embed_model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded: sentence-transformers/all-MiniLM-L6-v2")
        return _embed_model
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"sentence-transformers load failed: {e}")

    logger.warning("No embedding model available — semantic search disabled, pattern analysis unaffected")
    return None


def embed(text: str) -> list[float] | None:
    """Embed text into a 384-dim vector. Returns None if model unavailable."""
    model = _get_embed_model()
    if model is None:
        return None
    try:
        # fastembed uses a generator interface
        if hasattr(model, "embed"):
            vecs = list(model.embed([text[:2000]]))
            return vecs[0].tolist() if vecs else None
        # sentence-transformers interface
        vec = model.encode(text[:2000], normalize_embeddings=True)
        return vec.tolist()
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        return None


# ── Public API (same interface as original ChromaDB vector_store) ─────────────

def store_code_pattern(
    doc_id: str,
    code_text: str,
    findings: list[dict],
    metadata: dict[str, Any],
) -> bool:
    """Store a code snippet with its findings and embedding."""
    pool = _get_pool()
    if pool is None:
        return False

    embedding = embed(code_text[:2000])
    conn = None
    try:
        conn = pool.getconn()

        safe_meta = {
            k: (str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v)
            for k, v in metadata.items()
        }

        with conn.cursor() as cur:
            if embedding:
                cur.execute("""
                    INSERT INTO gitscope_code_patterns
                        (id, embedding, document, findings_json, code_preview, meta)
                    VALUES (%s, %s::vector, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        embedding     = EXCLUDED.embedding,
                        document      = EXCLUDED.document,
                        findings_json = EXCLUDED.findings_json,
                        code_preview  = EXCLUDED.code_preview,
                        meta          = EXCLUDED.meta,
                        created_at    = NOW()
                """, (
                    doc_id,
                    "[" + ",".join(str(x) for x in embedding) + "]",
                    code_text[:3000],
                    json.dumps(findings[:10]),
                    code_text[:200],
                    json.dumps(safe_meta),
                ))
            else:
                # Store without embedding — still useful for pattern counting
                cur.execute("""
                    INSERT INTO gitscope_code_patterns
                        (id, document, findings_json, code_preview, meta)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                """, (
                    doc_id,
                    code_text[:3000],
                    json.dumps(findings[:10]),
                    code_text[:200],
                    json.dumps(safe_meta),
                ))
            conn.commit()
        return True
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"store_code_pattern failed for {doc_id}: {e}")
        return False
    finally:
        if conn:
            _release(pool, conn)


def query_similar_patterns(
    query_text: str,
    n_results: int = 5,
    where: dict | None = None,
) -> list[dict[str, Any]]:
    """Find semantically similar past code patterns using cosine similarity."""
    pool = _get_pool()
    if pool is None:
        return []

    embedding = embed(query_text[:2000])
    if embedding is None:
        return []

    conn = None
    try:
        conn = pool.getconn()
        vec_str = "[" + ",".join(str(x) for x in embedding) + "]"

        with conn.cursor() as cur:
            # Cosine similarity: 1 - cosine_distance
            cur.execute(f"""
                SELECT
                    id,
                    document,
                    findings_json,
                    meta,
                    1 - (embedding <=> %s::vector) AS similarity
                FROM gitscope_code_patterns
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """, (vec_str, vec_str, n_results * 2))

            rows = cur.fetchall()

        output = []
        for _id, doc, findings_json, meta, similarity in rows:
            if similarity < 0.30:
                continue
            try:
                findings = json.loads(findings_json or "[]")
                meta_dict = meta if isinstance(meta, dict) else {}
                output.append({
                    "repo": meta_dict.get("repo", "unknown"),
                    "code_preview": doc[:200] if doc else "",
                    "findings": findings,
                    "similarity": round(float(similarity), 3),
                    "metadata": meta_dict,
                })
            except Exception:
                continue
            if len(output) >= n_results:
                break

        return output
    except Exception as e:
        logger.error(f"query_similar_patterns failed: {e}")
        return []
    finally:
        if conn:
            _release(pool, conn)


def store_repo_profile(repo: str, profile: dict[str, Any]) -> bool:
    """Store or update a repo health profile."""
    pool = _get_pool()
    if pool is None:
        return False

    profile_text = (
        f"repo:{repo} language:{profile.get('language','')} "
        f"health:{profile.get('health_score',0)} "
        f"patterns:{','.join(profile.get('patterns',[]))}"
    )
    embedding = embed(profile_text)

    conn = None
    try:
        conn = pool.getconn()
        vec_str = "[" + ",".join(str(x) for x in embedding) + "]" if embedding else None
        safe_profile = {
            k: (json.dumps(v) if isinstance(v, (list, dict)) else v)
            for k, v in profile.items()
        }

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO gitscope_repo_profiles (repo, embedding, profile_text, meta)
                VALUES (%s, %s::vector, %s, %s)
                ON CONFLICT (repo) DO UPDATE SET
                    embedding    = EXCLUDED.embedding,
                    profile_text = EXCLUDED.profile_text,
                    meta         = EXCLUDED.meta,
                    updated_at   = NOW()
            """, (repo, vec_str, profile_text, json.dumps(safe_profile)))
            conn.commit()
        return True
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"store_repo_profile failed for {repo}: {e}")
        return False
    finally:
        if conn:
            _release(pool, conn)


def get_stats() -> dict[str, int]:
    """Return counts for monitoring."""
    pool = _get_pool()
    if pool is None:
        return {"code_patterns": -1, "repo_profiles": -1}

    conn = None
    try:
        conn = pool.getconn()
        stats = {}
        with conn.cursor() as cur:
            for table, key in [
                ("gitscope_code_patterns", "code_patterns"),
                ("gitscope_repo_profiles", "repo_profiles"),
            ]:
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {table}")
                    stats[key] = cur.fetchone()[0]
                except Exception:
                    stats[key] = -1
        return stats
    except Exception as e:
        logger.error(f"get_stats failed: {e}")
        return {"code_patterns": -1, "repo_profiles": -1}
    finally:
        if conn:
            _release(pool, conn)
