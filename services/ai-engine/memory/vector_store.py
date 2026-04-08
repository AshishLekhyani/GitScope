"""
Vector Store — ChromaDB Wrapper
================================
Persistent vector store for code embeddings and learned patterns.
Uses all-MiniLM-L6-v2 for fast, high-quality sentence embeddings.

The embedding model runs fully on CPU — no GPU required.
First run: model downloads ~80MB. Subsequent runs: instant load from cache.

Storage: ./data/chromadb/ (relative to service root)
Collections:
  - code_patterns: code chunks + their findings
  - repo_profiles: high-level repo characteristics
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Lazy-loaded singletons — don't import at module level to avoid slow startup
_chroma_client = None
_embed_model = None
_collections: dict[str, Any] = {}

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "chromadb")


def _get_client():
    global _chroma_client
    if _chroma_client is None:
        try:
            import chromadb
            os.makedirs(DATA_DIR, exist_ok=True)
            _chroma_client = chromadb.PersistentClient(path=DATA_DIR)
            logger.info(f"ChromaDB initialized at {DATA_DIR}")
        except ImportError:
            logger.warning("chromadb not installed — vector store disabled")
            _chroma_client = None
    return _chroma_client


def _get_embed_model():
    global _embed_model
    if _embed_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            # Try primary model, fall back to smaller if download fails
            for model_name in ("all-MiniLM-L6-v2", "paraphrase-MiniLM-L3-v2"):
                try:
                    _embed_model = SentenceTransformer(model_name)
                    logger.info(f"Embedding model loaded: {model_name}")
                    break
                except Exception as model_err:
                    logger.warning(f"Model {model_name} failed to load: {model_err}. Trying fallback...")
            if _embed_model is None:
                logger.error("All embedding models failed to load — semantic search disabled")
        except ImportError:
            logger.warning("sentence-transformers not installed — semantic embeddings disabled")
            _embed_model = None
    return _embed_model


def _get_collection(name: str):
    if name in _collections:
        return _collections[name]
    client = _get_client()
    if client is None:
        return None
    try:
        col = client.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )
        _collections[name] = col
        return col
    except Exception as e:
        logger.error(f"Failed to get collection {name}: {e}")
        # Self-heal: if collection is corrupted, try deleting and recreating
        try:
            logger.warning(f"Attempting self-heal: recreating collection {name}")
            client.delete_collection(name)
            col = client.create_collection(name=name, metadata={"hnsw:space": "cosine"})
            _collections[name] = col
            logger.info(f"Self-heal successful: collection {name} recreated")
            return col
        except Exception as heal_err:
            logger.error(f"Self-heal failed for {name}: {heal_err}")
            return None


def embed(text: str) -> list[float] | None:
    """Embed a text string into a vector. Returns None if model unavailable."""
    model = _get_embed_model()
    if model is None:
        return None
    try:
        vec = model.encode(text, normalize_embeddings=True)
        return vec.tolist()
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        return None


def store_code_pattern(
    doc_id: str,
    code_text: str,
    findings: list[dict],
    metadata: dict[str, Any],
) -> bool:
    """
    Store a code snippet and its associated findings.
    Returns True if stored successfully.
    """
    col = _get_collection("code_patterns")
    if col is None:
        return False

    embedding = embed(code_text[:2000])
    if embedding is None:
        # Fall back to storing without embedding (ChromaDB will use its default)
        return False

    import json
    safe_meta = {k: (str(v) if not isinstance(v, (str, int, float, bool)) else v)
                 for k, v in metadata.items()}
    safe_meta["findings_json"] = json.dumps(findings[:10])
    safe_meta["code_preview"] = code_text[:200]

    try:
        col.upsert(
            ids=[doc_id],
            embeddings=[embedding],
            documents=[code_text[:2000]],
            metadatas=[safe_meta],
        )
        return True
    except Exception as e:
        logger.error(f"Failed to store pattern {doc_id}: {e}")
        return False


def query_similar_patterns(
    query_text: str,
    n_results: int = 5,
    where: dict | None = None,
) -> list[dict[str, Any]]:
    """
    Find semantically similar past code patterns.
    Returns list of { repo, findings, metadata, similarity } dicts.
    """
    col = _get_collection("code_patterns")
    if col is None:
        return []

    embedding = embed(query_text[:2000])
    if embedding is None:
        return []

    try:
        import json
        kwargs: dict[str, Any] = {
            "query_embeddings": [embedding],
            "n_results": min(n_results, max(1, col.count())),
            "include": ["documents", "metadatas", "distances"],
        }
        if where:
            kwargs["where"] = where

        results = col.query(**kwargs)

        output = []
        for i, (doc, meta, dist) in enumerate(zip(
            results.get("documents", [[]])[0],
            results.get("metadatas", [[]])[0],
            results.get("distances", [[]])[0],
        )):
            similarity = 1.0 - dist  # cosine distance → similarity
            if similarity < 0.3:    # Skip low-relevance results
                continue
            findings = json.loads(meta.get("findings_json", "[]"))
            output.append({
                "repo": meta.get("repo", "unknown"),
                "code_preview": meta.get("code_preview", ""),
                "findings": findings,
                "similarity": round(similarity, 3),
                "metadata": {k: v for k, v in meta.items() if k not in ("findings_json", "code_preview")},
            })

        return output
    except Exception as e:
        logger.error(f"Query failed: {e}")
        return []


def store_repo_profile(
    repo: str,
    profile: dict[str, Any],
) -> bool:
    """Store a high-level repo health profile."""
    col = _get_collection("repo_profiles")
    if col is None:
        return False

    profile_text = f"repo:{repo} language:{profile.get('language','')} health:{profile.get('health_score',0)} patterns:{','.join(profile.get('patterns',[]))}"
    embedding = embed(profile_text)
    if embedding is None:
        return False

    import json
    try:
        col.upsert(
            ids=[repo],
            embeddings=[embedding],
            documents=[profile_text],
            metadatas=[{k: (json.dumps(v) if isinstance(v, (list, dict)) else v) for k, v in profile.items()}],
        )
        return True
    except Exception as e:
        logger.error(f"Failed to store repo profile {repo}: {e}")
        return False


def get_stats() -> dict[str, int]:
    """Return collection sizes."""
    stats: dict[str, int] = {}
    for name in ("code_patterns", "repo_profiles"):
        col = _get_collection(name)
        if col:
            try:
                stats[name] = col.count()
            except Exception:
                stats[name] = -1
    return stats
