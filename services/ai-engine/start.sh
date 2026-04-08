#!/usr/bin/env bash
# GitScope Neural AI Engine — Start Script
# Usage: ./start.sh [--auto-learn] [--port 8765]

set -e

PORT=${PORT:-8765}
WORKERS=${WORKERS:-1}

# Parse flags
for arg in "$@"; do
  case $arg in
    --auto-learn) export GITSCOPE_AUTO_LEARN=1 ;;
    --port=*) PORT="${arg#*=}" ;;
  esac
done

echo "╔══════════════════════════════════════════════════════╗"
echo "║     GitScope Neural Intelligence Engine v2.0        ║"
echo "║     Multi-agent · Self-learning · CVE-aware         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "→ Starting on http://localhost:${PORT}"
echo "→ Auto-learning: ${GITSCOPE_AUTO_LEARN:-disabled}"
echo ""

# Install deps if not installed
if [ ! -d ".venv" ] && [ ! -f "/.dockerenv" ]; then
  echo "→ Creating virtual environment..."
  python3 -m venv .venv
  source .venv/bin/activate
  echo "→ Installing dependencies (this may take a few minutes on first run)..."
  pip install --quiet torch --index-url https://download.pytorch.org/whl/cpu
  pip install --quiet -r requirements.txt
  echo "→ Pre-downloading embedding model (all-MiniLM-L6-v2, ~80MB)..."
  python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" 2>/dev/null || true
else
  source .venv/bin/activate 2>/dev/null || true
fi

exec uvicorn main:app \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --workers "${WORKERS}" \
  --log-level info \
  --no-access-log
