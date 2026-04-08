FROM python:3.11-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ make git curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps — torch excluded for lean free-tier image
# The engine does full pattern analysis without torch.
# Semantic RAG (sentence-transformers) loads lazily if torch is available.
COPY requirements.prod.txt .
RUN pip install --no-cache-dir -r requirements.prod.txt

# Copy source
COPY . .

# Data directory (HuggingFace / fastembed model cache)
RUN mkdir -p /app/data/hf_cache

ENV PORT=8765
ENV WORKERS=1
ENV LOG_LEVEL=info
# Point HuggingFace cache to the persistent volume so model survives restarts
ENV TRANSFORMERS_CACHE=/app/data/hf_cache
ENV HF_HOME=/app/data/hf_cache

EXPOSE 8765

CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8765} --workers 1"
