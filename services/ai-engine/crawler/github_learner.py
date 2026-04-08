"""
GitHub Autonomous Learner
==========================
Crawls GitHub to teach GitScope real-world code patterns.

What it learns:
  • Top starred repositories per language (TypeScript, Python, Go, Rust, Java, etc.)
  • Best practice patterns from highly-starred code
  • Real vulnerability patterns from GitHub Security Advisories
  • Code review patterns from merged PRs in popular open-source repos
  • Dependency usage patterns

Storage: all patterns stored in ChromaDB via memory.vector_store
The knowledge compounds — more repos analyzed = smarter detection.

Usage:
  - Runs as a background asyncio task (triggered from main.py on startup)
  - Respects GitHub rate limits (60 req/hr unauthenticated, 5000 with token)
  - Stores GITHUB_TOKEN in .env for higher rate limits
  - Configurable: crawl depth, languages, topic filters
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import random
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_API = "https://api.github.com"

# ─────────────────────────────────────────────────────────────────────────────
# What the engine learns from GitHub
# Covers every major language and domain — runs every 6 hours.
# Each cycle picks 5 targets at random to stay within rate limits.
# ─────────────────────────────────────────────────────────────────────────────
LEARNING_TARGETS: list[dict] = [
    # ── TypeScript / JavaScript ───────────────────────────────────────────────
    {"q": "language:typescript stars:>5000 sort:stars", "label": "typescript-top"},
    {"q": "language:javascript stars:>10000 topic:nodejs sort:stars", "label": "nodejs-top"},
    {"q": "language:typescript topic:nextjs stars:>1000 sort:stars", "label": "nextjs-projects"},
    {"q": "language:typescript topic:react stars:>2000 sort:stars", "label": "react-ts"},
    {"q": "language:javascript topic:express stars:>2000 sort:stars", "label": "express-projects"},
    {"q": "language:typescript topic:nestjs stars:>500 sort:stars", "label": "nestjs-projects"},
    {"q": "language:typescript topic:graphql stars:>500 sort:stars", "label": "graphql-ts"},

    # ── Python ────────────────────────────────────────────────────────────────
    {"q": "language:python stars:>5000 sort:stars", "label": "python-top"},
    {"q": "language:python topic:fastapi stars:>500 sort:stars", "label": "fastapi-projects"},
    {"q": "language:python topic:django stars:>1000 sort:stars", "label": "django-projects"},
    {"q": "language:python topic:flask stars:>1000 sort:stars", "label": "flask-projects"},
    {"q": "language:python topic:machine-learning stars:>2000 sort:stars", "label": "ml-python"},
    {"q": "language:python topic:deep-learning stars:>2000 sort:stars", "label": "dl-python"},
    {"q": "language:python topic:data-science stars:>2000 sort:stars", "label": "datascience-python"},
    {"q": "language:python topic:security stars:>500 sort:stars", "label": "python-security"},

    # ── Go ────────────────────────────────────────────────────────────────────
    {"q": "language:go stars:>3000 sort:stars", "label": "go-top"},
    {"q": "language:go topic:microservices stars:>500 sort:stars", "label": "go-microservices"},
    {"q": "language:go topic:kubernetes stars:>500 sort:stars", "label": "go-k8s"},
    {"q": "language:go topic:cli stars:>500 sort:stars", "label": "go-cli"},
    {"q": "language:go topic:security stars:>200 sort:stars", "label": "go-security"},

    # ── Rust ─────────────────────────────────────────────────────────────────
    {"q": "language:rust stars:>2000 sort:stars", "label": "rust-top"},
    {"q": "language:rust topic:webassembly stars:>500 sort:stars", "label": "rust-wasm"},
    {"q": "language:rust topic:networking stars:>300 sort:stars", "label": "rust-networking"},
    {"q": "language:rust topic:cryptography stars:>200 sort:stars", "label": "rust-crypto"},

    # ── Java ──────────────────────────────────────────────────────────────────
    {"q": "language:java stars:>5000 topic:spring sort:stars", "label": "java-spring"},
    {"q": "language:java topic:spring-boot stars:>1000 sort:stars", "label": "spring-boot"},
    {"q": "language:java topic:security stars:>500 sort:stars", "label": "java-security"},
    {"q": "language:java topic:microservices stars:>500 sort:stars", "label": "java-microservices"},

    # ── C# / .NET ─────────────────────────────────────────────────────────────
    {"q": "language:csharp stars:>3000 sort:stars", "label": "csharp-top"},
    {"q": "language:csharp topic:aspnet stars:>500 sort:stars", "label": "aspnet-projects"},
    {"q": "language:csharp topic:blazor stars:>300 sort:stars", "label": "blazor-projects"},

    # ── Kotlin ────────────────────────────────────────────────────────────────
    {"q": "language:kotlin stars:>2000 sort:stars", "label": "kotlin-top"},
    {"q": "language:kotlin topic:android stars:>1000 sort:stars", "label": "kotlin-android"},
    {"q": "language:kotlin topic:ktor stars:>300 sort:stars", "label": "ktor-projects"},

    # ── Swift ─────────────────────────────────────────────────────────────────
    {"q": "language:swift stars:>2000 sort:stars", "label": "swift-top"},
    {"q": "language:swift topic:ios stars:>500 sort:stars", "label": "swift-ios"},

    # ── PHP ───────────────────────────────────────────────────────────────────
    {"q": "language:php stars:>3000 sort:stars", "label": "php-top"},
    {"q": "language:php topic:laravel stars:>1000 sort:stars", "label": "laravel-projects"},
    {"q": "language:php topic:symfony stars:>500 sort:stars", "label": "symfony-projects"},

    # ── Ruby ─────────────────────────────────────────────────────────────────
    {"q": "language:ruby stars:>3000 sort:stars", "label": "ruby-top"},
    {"q": "language:ruby topic:rails stars:>1000 sort:stars", "label": "rails-projects"},

    # ── Scala ─────────────────────────────────────────────────────────────────
    {"q": "language:scala stars:>1000 sort:stars", "label": "scala-top"},
    {"q": "language:scala topic:akka stars:>300 sort:stars", "label": "akka-projects"},

    # ── C / C++ ───────────────────────────────────────────────────────────────
    {"q": "language:c stars:>5000 sort:stars", "label": "c-top"},
    {"q": "language:cpp stars:>5000 sort:stars", "label": "cpp-top"},
    {"q": "language:cpp topic:cryptography stars:>200 sort:stars", "label": "cpp-crypto"},
    {"q": "language:cpp topic:networking stars:>300 sort:stars", "label": "cpp-networking"},

    # ── Infrastructure / DevOps ───────────────────────────────────────────────
    {"q": "topic:terraform stars:>500 sort:stars", "label": "terraform-projects"},
    {"q": "topic:kubernetes stars:>2000 sort:stars", "label": "k8s-projects"},
    {"q": "topic:docker stars:>2000 sort:stars", "label": "docker-projects"},
    {"q": "topic:ansible stars:>500 sort:stars", "label": "ansible-projects"},
    {"q": "topic:github-actions stars:>500 sort:stars", "label": "github-actions"},

    # ── Security-focused ─────────────────────────────────────────────────────
    {"q": "topic:security stars:>500 sort:stars", "label": "security-tools"},
    {"q": "topic:owasp stars:>100 sort:stars", "label": "owasp-tools"},
    {"q": "topic:penetration-testing stars:>500 sort:stars", "label": "pentest-tools"},
    {"q": "topic:cryptography stars:>500 sort:stars", "label": "crypto-tools"},
    {"q": "topic:ctf stars:>500 sort:stars", "label": "ctf-tools"},
    {"q": "topic:devsecops stars:>200 sort:stars", "label": "devsecops"},

    # ── ML / AI ───────────────────────────────────────────────────────────────
    {"q": "topic:llm stars:>1000 sort:stars", "label": "llm-projects"},
    {"q": "topic:mlops stars:>500 sort:stars", "label": "mlops-projects"},
    {"q": "topic:transformers stars:>2000 sort:stars", "label": "transformer-models"},
    {"q": "topic:vector-database stars:>300 sort:stars", "label": "vector-databases"},

    # ── Mobile ───────────────────────────────────────────────────────────────
    {"q": "topic:react-native stars:>2000 sort:stars", "label": "react-native"},
    {"q": "topic:flutter stars:>2000 sort:stars", "label": "flutter-projects"},
    {"q": "topic:android-security stars:>200 sort:stars", "label": "android-security"},
    {"q": "topic:ios-security stars:>200 sort:stars", "label": "ios-security"},

    # ── Elixir / Erlang ──────────────────────────────────────────────────────
    {"q": "language:elixir stars:>2000 sort:stars", "label": "elixir-top"},
    {"q": "language:elixir topic:phoenix stars:>500 sort:stars", "label": "phoenix-framework"},
    {"q": "language:erlang stars:>1000 topic:otp sort:stars", "label": "erlang-otp"},

    # ── Haskell / Functional ─────────────────────────────────────────────────
    {"q": "language:haskell stars:>1000 sort:stars", "label": "haskell-top"},
    {"q": "language:haskell topic:security stars:>100 sort:stars", "label": "haskell-security"},

    # ── Dart / Flutter ───────────────────────────────────────────────────────
    {"q": "language:dart topic:flutter stars:>2000 sort:stars", "label": "dart-flutter"},
    {"q": "language:dart topic:firebase stars:>500 sort:stars", "label": "dart-firebase"},

    # ── TypeScript Advanced Patterns ─────────────────────────────────────────
    {"q": "language:typescript topic:monorepo stars:>500 sort:stars", "label": "ts-monorepo"},
    {"q": "language:typescript topic:prisma stars:>500 sort:stars", "label": "ts-prisma"},
    {"q": "language:typescript topic:trpc stars:>500 sort:stars", "label": "ts-trpc"},
    {"q": "language:typescript topic:zod stars:>300 sort:stars", "label": "ts-zod-validation"},
    {"q": "language:typescript topic:drizzle stars:>200 sort:stars", "label": "ts-drizzle"},
    {"q": "language:typescript topic:vitest stars:>300 sort:stars", "label": "ts-vitest"},
    {"q": "language:typescript topic:bun stars:>500 sort:stars", "label": "bun-runtime"},
    {"q": "language:typescript topic:deno stars:>1000 sort:stars", "label": "deno-projects"},
    {"q": "language:typescript topic:hono stars:>300 sort:stars", "label": "hono-framework"},
    {"q": "language:typescript topic:astro stars:>500 sort:stars", "label": "astro-framework"},
    {"q": "language:typescript topic:remix stars:>500 sort:stars", "label": "remix-framework"},

    # ── Python Advanced ───────────────────────────────────────────────────────
    {"q": "language:python topic:pydantic stars:>1000 sort:stars", "label": "py-pydantic"},
    {"q": "language:python topic:sqlalchemy stars:>1000 sort:stars", "label": "py-sqlalchemy"},
    {"q": "language:python topic:celery stars:>500 sort:stars", "label": "py-celery"},
    {"q": "language:python topic:pytest stars:>500 sort:stars", "label": "py-pytest"},
    {"q": "language:python topic:langchain stars:>2000 sort:stars", "label": "py-langchain"},
    {"q": "language:python topic:airflow stars:>1000 sort:stars", "label": "py-airflow"},
    {"q": "language:python topic:scrapy stars:>500 sort:stars", "label": "py-scrapy"},
    {"q": "language:python topic:cryptography stars:>500 sort:stars", "label": "py-crypto"},
    {"q": "language:python topic:grpc stars:>500 sort:stars", "label": "py-grpc"},

    # ── Go Advanced ──────────────────────────────────────────────────────────
    {"q": "language:go topic:grpc stars:>500 sort:stars", "label": "go-grpc"},
    {"q": "language:go topic:cobra stars:>500 sort:stars", "label": "go-cobra-cli"},
    {"q": "language:go topic:prometheus stars:>500 sort:stars", "label": "go-prometheus"},
    {"q": "language:go topic:pgx stars:>300 sort:stars", "label": "go-pgx"},
    {"q": "language:go topic:zerolog stars:>200 sort:stars", "label": "go-zerolog"},
    {"q": "language:go topic:air stars:>300 sort:stars", "label": "go-air"},

    # ── Rust Advanced ────────────────────────────────────────────────────────
    {"q": "language:rust topic:axum stars:>1000 sort:stars", "label": "rust-axum"},
    {"q": "language:rust topic:tokio stars:>1000 sort:stars", "label": "rust-tokio"},
    {"q": "language:rust topic:actix-web stars:>1000 sort:stars", "label": "rust-actix"},
    {"q": "language:rust topic:sqlx stars:>500 sort:stars", "label": "rust-sqlx"},
    {"q": "language:rust topic:serde stars:>500 sort:stars", "label": "rust-serde"},
    {"q": "language:rust topic:clap stars:>500 sort:stars", "label": "rust-clap"},

    # ── Java Advanced ─────────────────────────────────────────────────────────
    {"q": "language:java topic:quarkus stars:>1000 sort:stars", "label": "java-quarkus"},
    {"q": "language:java topic:micronaut stars:>500 sort:stars", "label": "java-micronaut"},
    {"q": "language:java topic:vertx stars:>500 sort:stars", "label": "java-vertx"},
    {"q": "language:java topic:grpc stars:>300 sort:stars", "label": "java-grpc"},
    {"q": "language:java topic:jwt stars:>300 sort:stars", "label": "java-jwt"},
    {"q": "language:java topic:reactive stars:>500 sort:stars", "label": "java-reactive"},

    # ── Security Research & Tools ─────────────────────────────────────────────
    {"q": "topic:exploit stars:>500 sort:stars", "label": "exploit-research"},
    {"q": "topic:vulnerability-scanner stars:>300 sort:stars", "label": "vuln-scanners"},
    {"q": "topic:fuzzing stars:>300 sort:stars", "label": "fuzzing-tools"},
    {"q": "topic:static-analysis stars:>500 sort:stars", "label": "static-analysis-tools"},
    {"q": "topic:sast stars:>200 sort:stars", "label": "sast-tools"},
    {"q": "topic:dast stars:>200 sort:stars", "label": "dast-tools"},
    {"q": "topic:semgrep stars:>500 sort:stars", "label": "semgrep-rules"},
    {"q": "topic:codeql stars:>300 sort:stars", "label": "codeql-queries"},
    {"q": "topic:burp-suite stars:>200 sort:stars", "label": "burp-extensions"},
    {"q": "topic:jwt-attacks stars:>100 sort:stars", "label": "jwt-security"},
    {"q": "topic:supply-chain-attacks stars:>100 sort:stars", "label": "supply-chain-attacks"},
    {"q": "topic:typosquatting stars:>50 sort:stars", "label": "typosquatting"},

    # ── Cloud Native & Observability ──────────────────────────────────────────
    {"q": "topic:opentelemetry stars:>500 sort:stars", "label": "opentelemetry"},
    {"q": "topic:prometheus stars:>500 sort:stars", "label": "prometheus"},
    {"q": "topic:grafana stars:>500 sort:stars", "label": "grafana"},
    {"q": "topic:istio stars:>500 sort:stars", "label": "istio-service-mesh"},
    {"q": "topic:envoy stars:>500 sort:stars", "label": "envoy-proxy"},
    {"q": "topic:argocd stars:>500 sort:stars", "label": "argocd-gitops"},
    {"q": "topic:helm stars:>500 sort:stars", "label": "helm-charts"},
    {"q": "topic:kustomize stars:>300 sort:stars", "label": "kustomize"},
    {"q": "topic:crossplane stars:>300 sort:stars", "label": "crossplane"},
    {"q": "topic:vault stars:>500 sort:stars", "label": "hashicorp-vault"},
    {"q": "topic:consul stars:>300 sort:stars", "label": "hashicorp-consul"},

    # ── GraphQL / gRPC ────────────────────────────────────────────────────────
    {"q": "topic:graphql-security stars:>100 sort:stars", "label": "graphql-security"},
    {"q": "topic:graphql-api stars:>500 sort:stars", "label": "graphql-apis"},
    {"q": "topic:grpc stars:>500 sort:stars", "label": "grpc-projects"},
    {"q": "topic:protobuf stars:>500 sort:stars", "label": "protobuf-definitions"},

    # ── Zero Trust / Identity ─────────────────────────────────────────────────
    {"q": "topic:zero-trust stars:>200 sort:stars", "label": "zero-trust"},
    {"q": "topic:oidc stars:>300 sort:stars", "label": "oidc-implementations"},
    {"q": "topic:oauth2 stars:>500 sort:stars", "label": "oauth2-implementations"},
    {"q": "topic:passkeys stars:>200 sort:stars", "label": "passkeys-webauthn"},
    {"q": "topic:webauthn stars:>300 sort:stars", "label": "webauthn-fido2"},
    {"q": "topic:keycloak stars:>300 sort:stars", "label": "keycloak-iam"},

    # ── Data Engineering ─────────────────────────────────────────────────────
    {"q": "topic:apache-kafka stars:>1000 sort:stars", "label": "kafka-projects"},
    {"q": "topic:apache-spark stars:>1000 sort:stars", "label": "spark-projects"},
    {"q": "topic:dbt stars:>500 sort:stars", "label": "dbt-analytics"},
    {"q": "topic:databricks stars:>300 sort:stars", "label": "databricks-projects"},
    {"q": "topic:duckdb stars:>500 sort:stars", "label": "duckdb-analytics"},
    {"q": "topic:clickhouse stars:>500 sort:stars", "label": "clickhouse-olap"},
    {"q": "topic:snowflake stars:>300 sort:stars", "label": "snowflake-dw"},

    # ── AI / LLM Security ────────────────────────────────────────────────────
    {"q": "topic:prompt-injection stars:>200 sort:stars", "label": "prompt-injection"},
    {"q": "topic:llm-security stars:>200 sort:stars", "label": "llm-security"},
    {"q": "topic:ai-safety stars:>300 sort:stars", "label": "ai-safety"},
    {"q": "topic:guardrails stars:>200 sort:stars", "label": "llm-guardrails"},
    {"q": "topic:langchain stars:>1000 sort:stars", "label": "langchain-patterns"},
    {"q": "topic:llamaindex stars:>500 sort:stars", "label": "llamaindex-rag"},
    {"q": "topic:rag stars:>300 sort:stars", "label": "rag-patterns"},

    # ── WebAssembly ───────────────────────────────────────────────────────────
    {"q": "topic:webassembly stars:>500 sort:stars", "label": "wasm-projects"},
    {"q": "topic:wasmtime stars:>300 sort:stars", "label": "wasmtime-runtime"},
    {"q": "topic:wasi stars:>200 sort:stars", "label": "wasi-projects"},

    # ── Embedded / IoT ────────────────────────────────────────────────────────
    {"q": "topic:embedded stars:>500 sort:stars", "label": "embedded-systems"},
    {"q": "topic:iot-security stars:>200 sort:stars", "label": "iot-security"},
    {"q": "topic:firmware-security stars:>100 sort:stars", "label": "firmware-security"},

    # ── Privacy Engineering ───────────────────────────────────────────────────
    {"q": "topic:gdpr stars:>200 sort:stars", "label": "gdpr-tools"},
    {"q": "topic:differential-privacy stars:>200 sort:stars", "label": "differential-privacy"},
    {"q": "topic:privacy-engineering stars:>100 sort:stars", "label": "privacy-engineering"},
    {"q": "topic:data-anonymization stars:>100 sort:stars", "label": "data-anonymization"},

    # ── Game Development Security ─────────────────────────────────────────────
    {"q": "language:csharp topic:unity stars:>1000 sort:stars", "label": "unity-security"},
    {"q": "language:cpp topic:unreal stars:>500 sort:stars", "label": "unreal-security"},

    # ── Blockchain / Web3 ─────────────────────────────────────────────────────
    {"q": "topic:smart-contract-security stars:>300 sort:stars", "label": "smart-contract-security"},
    {"q": "topic:solidity-security stars:>200 sort:stars", "label": "solidity-security"},
    {"q": "topic:defi-security stars:>100 sort:stars", "label": "defi-security"},
]

# Files to extract patterns from — covers all supported languages
INTERESTING_FILES: dict[str, list[str]] = {
    "TypeScript": [
        "src/lib/auth.ts", "src/middleware.ts", "src/utils/security.ts",
        "middleware.ts", "src/auth/index.ts", "lib/auth.ts",
        "src/lib/crypto.ts", "src/lib/encryption.ts", "src/lib/jwt.ts",
        "src/server/auth.ts", "src/api/auth.ts",
    ],
    "JavaScript": [
        "lib/auth.js", "middleware.js", "utils/security.js",
        "auth/index.js", "lib/encryption.js", "lib/jwt.js",
        "server/auth.js", "helpers/security.js",
    ],
    "Python": [
        "auth.py", "security.py", "middleware.py", "utils.py",
        "authentication.py", "authorization.py", "permissions.py",
        "crypto.py", "encryption.py", "validators.py",
        "api/auth.py", "core/security.py", "app/auth.py",
    ],
    "Go": [
        "auth.go", "middleware.go", "security.go",
        "internal/auth/auth.go", "pkg/auth/auth.go",
        "internal/middleware/auth.go", "crypto.go",
        "internal/crypto/crypto.go", "handler/auth.go",
    ],
    "Rust": [
        "src/auth.rs", "src/security.rs", "src/middleware.rs",
        "src/crypto.rs", "src/encryption.rs", "src/jwt.rs",
        "src/auth/mod.rs", "auth/mod.rs",
    ],
    "Java": [
        "src/main/java/security/SecurityConfig.java",
        "src/main/java/auth/AuthController.java",
        "SecurityConfig.java", "AuthService.java",
        "JwtTokenProvider.java", "WebSecurityConfig.java",
    ],
    "C#": [
        "Security/AuthController.cs", "Auth/AuthService.cs",
        "Middleware/AuthMiddleware.cs", "Services/SecurityService.cs",
        "Controllers/AuthController.cs", "Helpers/JwtHelper.cs",
    ],
    "Kotlin": [
        "src/main/kotlin/security/SecurityConfig.kt",
        "auth/AuthService.kt", "middleware/AuthMiddleware.kt",
    ],
    "Swift": [
        "Sources/Security/AuthManager.swift",
        "Auth/AuthService.swift", "Security/Crypto.swift",
    ],
    "PHP": [
        "app/Http/Middleware/Authenticate.php",
        "app/Security/Auth.php", "includes/auth.php",
        "lib/Security.php", "app/Controllers/AuthController.php",
    ],
    "Ruby": [
        "app/controllers/sessions_controller.rb",
        "lib/auth.rb", "app/models/user.rb",
        "config/initializers/devise.rb", "lib/security.rb",
    ],
    "Scala": [
        "app/controllers/AuthController.scala",
        "app/security/SecurityModule.scala",
    ],
    "C": [
        "auth.c", "security.c", "crypto.c",
        "src/auth.c", "include/security.h",
    ],
    "C++": [
        "auth.cpp", "security.cpp", "crypto.cpp",
        "src/auth.cpp", "include/security.hpp",
    ],
    "HCL": [  # Terraform
        "main.tf", "security.tf", "iam.tf",
        "modules/security/main.tf", "variables.tf",
    ],
    "Dockerfile": ["Dockerfile", ".dockerfile"],
    "YAML": [
        ".github/workflows/ci.yml",
        ".github/workflows/security.yml",
        "k8s/deployment.yaml", "docker-compose.yml",
        ".gitlab-ci.yml", "kubernetes/pod.yaml",
    ],
}

# Security advisories to learn from
ADVISORY_SOURCES: list[str] = [
    f"{GITHUB_API}/advisories?type=reviewed&ecosystem=npm&per_page=100",
    f"{GITHUB_API}/advisories?type=reviewed&ecosystem=pip&per_page=100",
]


class GitHubLearner:
    """
    Crawls GitHub to continuously teach GitScope better analysis patterns.
    Respects rate limits. Saves everything to ChromaDB for permanent retention.
    """

    def __init__(self):
        self._headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if GITHUB_TOKEN:
            self._headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"
        self._rate_limit_reset: float = 0
        self._requests_made: int = 0

    async def run_learning_cycle(self):
        """
        Full learning cycle: search → fetch → embed → store.
        Designed to run periodically in the background (every 6 hours).
        """
        logger.info("Starting GitHub learning cycle...")
        start = time.time()
        total_patterns = 0

        async with httpx.AsyncClient(timeout=30, headers=self._headers) as client:
            self._client = client

            # 1. Learn from repos — pick 8 random targets each cycle
            # This ensures all languages get covered over time without hitting rate limits
            cycle_targets = random.sample(LEARNING_TARGETS, min(8, len(LEARNING_TARGETS)))
            for target in cycle_targets:
                try:
                    patterns = await self._learn_from_search(target)
                    total_patterns += patterns
                    await asyncio.sleep(2)  # Respect rate limits
                except Exception as e:
                    logger.warning(f"Learning from {target['label']} failed: {e}")

            # 2. Learn from GitHub Security Advisories
            try:
                advisory_patterns = await self._learn_from_advisories()
                total_patterns += advisory_patterns
            except Exception as e:
                logger.warning(f"Advisory learning failed: {e}")

        elapsed = time.time() - start
        logger.info(f"Learning cycle complete: {total_patterns} patterns in {elapsed:.1f}s")
        return total_patterns

    async def _learn_from_search(self, target: dict) -> int:
        """Search for repos matching criteria and learn from their code."""
        url = f"{GITHUB_API}/search/repositories?q={target['q']}&per_page=5"
        try:
            resp = await self._client.get(url)
            if resp.status_code == 403:
                logger.warning("GitHub rate limit hit — backing off")
                await asyncio.sleep(60)
                return 0
            if not resp.is_success:
                return 0

            data = resp.json()
            items = data.get("items", [])
            count = 0

            for repo in items[:3]:  # Top 3 repos per search
                try:
                    patterns = await self._learn_from_repo(
                        repo["full_name"],
                        repo.get("language", "unknown"),
                        repo.get("stargazers_count", 0),
                    )
                    count += patterns
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.debug(f"Failed to learn from {repo.get('full_name')}: {e}")

            return count
        except Exception as e:
            logger.debug(f"Search failed: {e}")
            return 0

    async def _learn_from_repo(self, full_name: str, language: str, stars: int) -> int:
        """Fetch and learn from a specific repository."""
        from memory.vector_store import store_code_pattern

        # Get file tree
        try:
            resp = await self._client.get(f"{GITHUB_API}/repos/{full_name}/git/trees/HEAD?recursive=1")
            if not resp.is_success:
                return 0
            tree = resp.json().get("tree", [])
        except Exception:
            return 0

        # Find interesting files
        interesting = self._find_interesting_files(tree, language)
        count = 0

        for file_path in interesting[:5]:  # Max 5 files per repo
            try:
                content = await self._fetch_file_content(full_name, file_path)
                if not content or len(content) < 50:
                    continue

                # Extract and store learning patterns
                patterns = self._extract_patterns(content, language, file_path)
                for chunk, meta in patterns:
                    doc_id = f"github:{full_name}:{hashlib.sha256(chunk.encode()).hexdigest()[:12]}"
                    success = store_code_pattern(
                        doc_id=doc_id,
                        code_text=chunk,
                        findings=[],  # High-quality code — no bad findings
                        metadata={
                            "repo": full_name,
                            "language": language,
                            "stars": stars,
                            "file": file_path,
                            "source": "github-crawler",
                            "quality_signal": "high-star-repo",
                            **meta,
                        },
                    )
                    if success:
                        count += 1

                await asyncio.sleep(0.5)
            except Exception as e:
                logger.debug(f"Failed to process {full_name}/{file_path}: {e}")

        return count

    async def _fetch_file_content(self, full_name: str, path: str) -> str | None:
        """Fetch raw file content from GitHub."""
        url = f"https://raw.githubusercontent.com/{full_name}/HEAD/{path}"
        try:
            resp = await self._client.get(url)
            if resp.is_success:
                return resp.text[:8000]  # Max 8KB per file
        except Exception:
            pass
        return None

    def _find_interesting_files(self, tree: list[dict], language: str) -> list[str]:
        """Find files worth learning from based on language and path."""
        interesting = []
        lang_files = INTERESTING_FILES.get(language, [])

        for item in tree:
            if item.get("type") != "blob":
                continue
            path = item.get("path", "")

            # Priority 1: Known interesting paths
            for target in lang_files:
                if path.endswith(target):
                    interesting.append(path)
                    break

            # Priority 2: Security/auth related files
            if any(kw in path.lower() for kw in ["security", "auth", "middleware", "validator", "sanitize"]):
                if path not in interesting:
                    interesting.append(path)

        return interesting[:10]

    def _extract_patterns(
        self,
        content: str,
        language: str,
        file_path: str,
    ) -> list[tuple[str, dict]]:
        """Extract meaningful code chunks with metadata."""
        chunks = []
        lines = content.splitlines()

        # Chunk by functions/classes (simple heuristic)
        current_chunk: list[str] = []
        for line in lines:
            current_chunk.append(line)
            if len(current_chunk) >= 30:
                chunk_text = "\n".join(current_chunk)
                if chunk_text.strip():
                    chunks.append((chunk_text, {
                        "language": language,
                        "file_path": file_path,
                        "chunk_type": "code",
                    }))
                current_chunk = []

        # Add remaining
        if current_chunk:
            chunk_text = "\n".join(current_chunk)
            if chunk_text.strip():
                chunks.append((chunk_text, {"language": language, "file_path": file_path}))

        return chunks

    async def _learn_from_advisories(self) -> int:
        """Learn vulnerability patterns from GitHub Security Advisories."""
        from memory.vector_store import store_code_pattern
        count = 0

        for url in ADVISORY_SOURCES:
            try:
                resp = await self._client.get(url)
                if not resp.is_success:
                    continue

                advisories = resp.json()
                for adv in (advisories if isinstance(advisories, list) else []):
                    description = adv.get("description", "")
                    summary = adv.get("summary", "")
                    severity = adv.get("severity", "medium")
                    cve_id = adv.get("cve_id") or (adv.get("identifiers") or [{}])[0].get("value", "")

                    if not description:
                        continue

                    # Store advisory as a "learned finding"
                    doc_id = f"advisory:{cve_id or hashlib.sha256(summary.encode()).hexdigest()[:12]}"
                    package = ""
                    if adv.get("vulnerabilities"):
                        package = adv["vulnerabilities"][0].get("package", {}).get("name", "")

                    store_code_pattern(
                        doc_id=doc_id,
                        code_text=f"Advisory: {summary}\n{description[:1000]}",
                        findings=[{
                            "severity": severity,
                            "category": "security",
                            "description": summary,
                            "suggestion": f"Upgrade affected package. See: {adv.get('html_url', '')}",
                            "rule_id": f"advisory-{package}" if package else "advisory",
                            "cve_id": cve_id,
                        }],
                        metadata={
                            "source": "github-advisory",
                            "package": package,
                            "cve_id": cve_id,
                            "severity": severity,
                        },
                    )
                    count += 1

            except Exception as e:
                logger.debug(f"Advisory fetch failed: {e}")

        return count
