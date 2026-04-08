"""
Documentation Crawler
======================
Crawls official technical documentation to give GitScope deep knowledge
of software engineering best practices, APIs, and patterns.

Sources:
  - MDN Web Docs (Web APIs, JavaScript, CSS)
  - TypeScript Handbook
  - Node.js documentation
  - Python official docs (security sections)
  - OWASP Cheat Sheets
  - NIST NVD CVE feed
  - CISA Known Exploited Vulnerabilities
  - npm Security Advisories
  - GitHub Blog (engineering posts)
  - Google Engineering Practices
  - The 12-Factor App
  - SOLID, DDD, Clean Architecture resources

Everything is filtered to Software Engineering / Data Science / ML only.
Only technical content is stored — no general web crawling.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# MASTER knowledge crawl list — all of software engineering & tech
# The engine ingests these on startup and re-crawls every 24 hours.
# New sources here = engine gets smarter automatically.
# ─────────────────────────────────────────────────────────────────────────────
DOC_SOURCES: list[dict] = [

    # ── OWASP Security Cheat Sheets ──────────────────────────────────────────
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html",
     "topic": "authentication-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
     "topic": "sql-injection-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/XSS_Prevention_Cheat_Sheet.html",
     "topic": "xss-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html",
     "topic": "cryptographic-storage", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html",
     "topic": "secrets-management", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html",
     "topic": "input-validation", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/NodeJS_Security_Cheat_Sheet.html",
     "topic": "nodejs-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html",
     "topic": "docker-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Access_Control_Cheat_Sheet.html",
     "topic": "access-control", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html",
     "topic": "session-management", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/CSRF_Prevention_Cheat_Sheet.html",
     "topic": "csrf-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html",
     "topic": "password-storage", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html",
     "topic": "rest-api-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/GraphQL_Cheat_Sheet.html",
     "topic": "graphql-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Kubernetes_Security_Cheat_Sheet.html",
     "topic": "kubernetes-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html",
     "topic": "database-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/PHP_Configuration_Cheat_Sheet.html",
     "topic": "php-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Java_Security_Cheat_Sheet.html",
     "topic": "java-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/DotNet_Security_Cheat_Sheet.html",
     "topic": "dotnet-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html",
     "topic": "injection-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html",
     "topic": "file-upload-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html",
     "topic": "deserialization-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html",
     "topic": "http-headers-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Microservices_Security_Cheat_Sheet.html",
     "topic": "microservices-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Serverless_Security_Cheat_Sheet.html",
     "topic": "serverless-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Mobile_Application_Security_Cheat_Sheet.html",
     "topic": "mobile-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html",
     "topic": "security-logging", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html",
     "topic": "error-handling-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html",
     "topic": "third-party-js-security", "domain": "security"},

    # ── CVE / Advisory Feeds ─────────────────────────────────────────────────
    {"url": "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
     "topic": "cisa-kev", "domain": "security", "format": "json"},

    # ── Engineering Best Practices ───────────────────────────────────────────
    {"url": "https://google.github.io/styleguide/tsguide.html",
     "topic": "typescript-style-guide", "domain": "quality"},
    {"url": "https://google.github.io/styleguide/pyguide.html",
     "topic": "python-style-guide", "domain": "quality"},
    {"url": "https://google.github.io/styleguide/go/decisions",
     "topic": "go-style-guide", "domain": "quality"},
    {"url": "https://google.github.io/styleguide/javaguide.html",
     "topic": "java-style-guide", "domain": "quality"},
    {"url": "https://12factor.net/",
     "topic": "twelve-factor-app", "domain": "architecture"},
    {"url": "https://martinfowler.com/bliki/UbiquitousLanguage.html",
     "topic": "ddd-ubiquitous-language", "domain": "architecture"},
    {"url": "https://semver.org/",
     "topic": "semantic-versioning", "domain": "quality"},

    # ── TypeScript / JavaScript ──────────────────────────────────────────────
    {"url": "https://www.typescriptlang.org/docs/handbook/2/types-from-types.html",
     "topic": "typescript-advanced-types", "domain": "quality"},
    {"url": "https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html",
     "topic": "typescript-do-dont", "domain": "quality"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Memory_management",
     "topic": "js-memory-management", "domain": "performance"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity",
     "topic": "subresource-integrity", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy",
     "topic": "csp-policy", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies",
     "topic": "cookie-security", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers",
     "topic": "web-workers", "domain": "performance"},

    # ── Python ───────────────────────────────────────────────────────────────
    {"url": "https://docs.python.org/3/library/secrets.html",
     "topic": "python-secrets-module", "domain": "security"},
    {"url": "https://docs.python.org/3/library/hashlib.html",
     "topic": "python-hashlib", "domain": "security"},
    {"url": "https://docs.python.org/3/howto/logging.html",
     "topic": "python-logging", "domain": "quality"},
    {"url": "https://realpython.com/python-concurrency/",
     "topic": "python-concurrency", "domain": "performance"},

    # ── Go ───────────────────────────────────────────────────────────────────
    {"url": "https://go.dev/doc/effective_go",
     "topic": "effective-go", "domain": "quality"},
    {"url": "https://go.dev/blog/error-handling-and-go",
     "topic": "go-error-handling", "domain": "quality"},
    {"url": "https://go.dev/doc/faq",
     "topic": "go-faq", "domain": "quality"},

    # ── Rust ─────────────────────────────────────────────────────────────────
    {"url": "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
     "topic": "rust-ownership", "domain": "quality"},
    {"url": "https://doc.rust-lang.org/book/ch09-00-error-handling.html",
     "topic": "rust-error-handling", "domain": "quality"},
    {"url": "https://doc.rust-lang.org/book/ch16-00-concurrency.html",
     "topic": "rust-concurrency", "domain": "performance"},
    {"url": "https://anssi-fr.github.io/rust-guide/",
     "topic": "rust-secure-coding", "domain": "security"},

    # ── Database ─────────────────────────────────────────────────────────────
    {"url": "https://www.postgresql.org/docs/current/sql-syntax-calling-funcs.html",
     "topic": "postgresql-parameterized", "domain": "security"},
    {"url": "https://redis.io/docs/manual/security/",
     "topic": "redis-security", "domain": "security"},
    {"url": "https://www.mongodb.com/docs/manual/security/",
     "topic": "mongodb-security", "domain": "security"},

    # ── Cloud & Infrastructure ────────────────────────────────────────────────
    {"url": "https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html",
     "topic": "aws-security-pillar", "domain": "security"},
    {"url": "https://cloud.google.com/docs/security/best-practices",
     "topic": "gcp-security-best-practices", "domain": "security"},
    {"url": "https://learn.microsoft.com/en-us/azure/security/fundamentals/best-practices-and-patterns",
     "topic": "azure-security-best-practices", "domain": "security"},
    {"url": "https://docs.docker.com/engine/security/",
     "topic": "docker-security-official", "domain": "security"},
    {"url": "https://kubernetes.io/docs/concepts/security/pod-security-standards/",
     "topic": "k8s-pod-security-standards", "domain": "security"},
    {"url": "https://kubernetes.io/docs/concepts/security/overview/",
     "topic": "k8s-security-overview", "domain": "security"},

    # ── Architecture & Design ─────────────────────────────────────────────────
    {"url": "https://microservices.io/patterns/index.html",
     "topic": "microservices-patterns", "domain": "architecture"},
    {"url": "https://learn.microsoft.com/en-us/azure/architecture/patterns/",
     "topic": "cloud-design-patterns", "domain": "architecture"},
    {"url": "https://refactoring.guru/design-patterns/catalog",
     "topic": "design-patterns-catalog", "domain": "architecture"},
    {"url": "https://www.oreilly.com/library/view/clean-architecture-a/9780134494272/",
     "topic": "clean-architecture", "domain": "architecture"},

    # ── Performance ───────────────────────────────────────────────────────────
    {"url": "https://web.dev/articles/performance-http2",
     "topic": "http2-performance", "domain": "performance"},
    {"url": "https://web.dev/articles/rendering-performance",
     "topic": "rendering-performance", "domain": "performance"},
    {"url": "https://developer.chrome.com/docs/lighthouse/performance/",
     "topic": "lighthouse-performance", "domain": "performance"},

    # ── API Design ────────────────────────────────────────────────────────────
    {"url": "https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design",
     "topic": "rest-api-design", "domain": "architecture"},
    {"url": "https://graphql.org/learn/best-practices/",
     "topic": "graphql-best-practices", "domain": "architecture"},

    # ── CI/CD & DevOps ────────────────────────────────────────────────────────
    {"url": "https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions",
     "topic": "github-actions-security", "domain": "security"},
    {"url": "https://owasp.org/www-project-devsecops-guideline/",
     "topic": "devsecops-guideline", "domain": "security"},

    # ── OWASP API Security Top 10 ────────────────────────────────────────────
    {"url": "https://owasp.org/API-Security/editions/2023/en/0x11-t10/",
     "topic": "owasp-api-top10", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/API_Security_Cheat_Sheet.html",
     "topic": "api-security-cheatsheet", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/JWT_Security_Cheat_Sheet.html",
     "topic": "jwt-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html",
     "topic": "oauth2-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html",
     "topic": "saml-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html",
     "topic": "open-redirect-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html",
     "topic": "tls-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html",
     "topic": "csp-cheatsheet", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html",
     "topic": "clickjacking-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html",
     "topic": "csrf-advanced", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html",
     "topic": "ssrf-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html",
     "topic": "xxe-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html",
     "topic": "idor-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html",
     "topic": "mass-assignment-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html",
     "topic": "business-logic-security", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html",
     "topic": "prototype-pollution-prevention", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Pinning_Cheat_Sheet.html",
     "topic": "certificate-pinning", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Virtual_Patching_Cheat_Sheet.html",
     "topic": "virtual-patching", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Vulnerability_Disclosure_Cheat_Sheet.html",
     "topic": "vulnerability-disclosure", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.html",
     "topic": "supply-chain-security", "domain": "security"},

    # ── NIST / CISA / CIS Security Standards ─────────────────────────────────
    {"url": "https://nvd.nist.gov/vuln/full-listing",
     "topic": "nist-nvd-vuln-listing", "domain": "security", "format": "json"},
    {"url": "https://www.cisecurity.org/controls/",
     "topic": "cis-controls", "domain": "security"},
    {"url": "https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final",
     "topic": "nist-800-53-controls", "domain": "security"},
    {"url": "https://www.cisa.gov/secure-by-design",
     "topic": "secure-by-design-principles", "domain": "security"},

    # ── Language-specific Security ────────────────────────────────────────────
    {"url": "https://python-security.readthedocs.io/",
     "topic": "python-security-guide", "domain": "security"},
    {"url": "https://docs.python.org/3/library/ssl.html",
     "topic": "python-ssl-docs", "domain": "security"},
    {"url": "https://pycqa.github.io/isort/docs/configuration/options.html",
     "topic": "python-import-security", "domain": "security"},
    {"url": "https://owasp.org/www-project-python-security/",
     "topic": "owasp-python-security", "domain": "security"},
    {"url": "https://docs.golang.org/doc/security/",
     "topic": "go-security-docs", "domain": "security"},
    {"url": "https://go.dev/blog/vuln",
     "topic": "go-vulnerability-management", "domain": "security"},
    {"url": "https://owasp.org/www-project-go-secure-coding-practices-guide/",
     "topic": "go-secure-coding", "domain": "security"},
    {"url": "https://rustsec.org/advisories/",
     "topic": "rust-security-advisories", "domain": "security"},
    {"url": "https://owasp.org/www-project-rust-secure-coding-practices/",
     "topic": "rust-owasp-secure-coding", "domain": "security"},
    {"url": "https://cheatsheetseries.owasp.org/cheatsheets/Ruby_on_Rails_Cheat_Sheet.html",
     "topic": "rails-security-cheatsheet", "domain": "security"},
    {"url": "https://guides.rubyonrails.org/security.html",
     "topic": "rails-security-guide", "domain": "security"},

    # ── Cryptography Standards ────────────────────────────────────────────────
    {"url": "https://www.nist.gov/publications/digital-signature-standard-dss",
     "topic": "nist-dss-standard", "domain": "security"},
    {"url": "https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program",
     "topic": "nist-crypto-validation", "domain": "security"},
    {"url": "https://owasp.org/www-project-cryptographic-storage/",
     "topic": "owasp-crypto-storage", "domain": "security"},
    {"url": "https://latacora.micro.blog/2018/04/03/cryptographic-right-answers.html",
     "topic": "cryptographic-right-answers", "domain": "security"},

    # ── Container & Cloud Security ────────────────────────────────────────────
    {"url": "https://docs.docker.com/develop/security-best-practices/",
     "topic": "docker-security-best-practices", "domain": "security"},
    {"url": "https://kubernetes.io/docs/tasks/administer-cluster/securing-a-cluster/",
     "topic": "k8s-cluster-security", "domain": "security"},
    {"url": "https://kubernetes.io/docs/concepts/security/rbac-good-practices/",
     "topic": "k8s-rbac-best-practices", "domain": "security"},
    {"url": "https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html",
     "topic": "aws-iam-best-practices", "domain": "security"},
    {"url": "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-best-practices.html",
     "topic": "aws-vpc-security", "domain": "security"},
    {"url": "https://docs.aws.amazon.com/kms/latest/developerguide/best-practices.html",
     "topic": "aws-kms-best-practices", "domain": "security"},
    {"url": "https://cloud.google.com/iam/docs/using-iam-securely",
     "topic": "gcp-iam-security", "domain": "security"},
    {"url": "https://cloud.google.com/security/encryption/default-encryption",
     "topic": "gcp-encryption", "domain": "security"},
    {"url": "https://learn.microsoft.com/en-us/azure/security/fundamentals/identity-management-best-practices",
     "topic": "azure-identity-security", "domain": "security"},
    {"url": "https://learn.microsoft.com/en-us/azure/key-vault/general/best-practices",
     "topic": "azure-key-vault-best-practices", "domain": "security"},

    # ── Supply Chain Security ─────────────────────────────────────────────────
    {"url": "https://slsa.dev/spec/v1.0/",
     "topic": "slsa-supply-chain-framework", "domain": "security"},
    {"url": "https://openssf.org/",
     "topic": "openssf-security-framework", "domain": "security"},
    {"url": "https://docs.npmjs.com/about-audit-reports",
     "topic": "npm-audit-reports", "domain": "security"},
    {"url": "https://pypi.org/security/",
     "topic": "pypi-security", "domain": "security"},
    {"url": "https://www.sigstore.dev/",
     "topic": "sigstore-signing", "domain": "security"},

    # ── Compliance & Regulations ──────────────────────────────────────────────
    {"url": "https://gdpr-info.eu/",
     "topic": "gdpr-regulations", "domain": "compliance"},
    {"url": "https://www.hhs.gov/hipaa/for-professionals/security/index.html",
     "topic": "hipaa-security-rule", "domain": "compliance"},
    {"url": "https://www.pcisecuritystandards.org/document_library/",
     "topic": "pci-dss-standards", "domain": "compliance"},
    {"url": "https://www.iso.org/standard/27001",
     "topic": "iso-27001", "domain": "compliance"},
    {"url": "https://www.aicpa.org/resources/landing/system-and-organization-controls-soc-suite-of-services",
     "topic": "soc2-framework", "domain": "compliance"},

    # ── JavaScript / TypeScript Advanced ─────────────────────────────────────
    {"url": "https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides",
     "topic": "mdn-practical-security", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API",
     "topic": "trusted-types-api", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/HTTP/Feature_Policy",
     "topic": "permissions-policy", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
     "topic": "mixed-content-security", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy",
     "topic": "same-origin-policy", "domain": "security"},
    {"url": "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS",
     "topic": "cors-security", "domain": "security"},
    {"url": "https://nodejs.org/en/docs/guides/security/",
     "topic": "nodejs-security-guide", "domain": "security"},
    {"url": "https://expressjs.com/en/advanced/best-practice-security.html",
     "topic": "express-security-best-practices", "domain": "security"},
    {"url": "https://nextjs.org/docs/app/building-your-application/authentication",
     "topic": "nextjs-authentication", "domain": "security"},
    {"url": "https://nextjs.org/docs/advanced-features/security-headers",
     "topic": "nextjs-security-headers", "domain": "security"},

    # ── Database Security ─────────────────────────────────────────────────────
    {"url": "https://www.postgresql.org/docs/current/auth-pg-hba-conf.html",
     "topic": "postgresql-auth-config", "domain": "security"},
    {"url": "https://dev.mysql.com/doc/refman/8.0/en/security-guidelines.html",
     "topic": "mysql-security-guidelines", "domain": "security"},
    {"url": "https://www.mongodb.com/docs/manual/security/authentication/",
     "topic": "mongodb-authentication", "domain": "security"},
    {"url": "https://redis.io/docs/management/security/acl/",
     "topic": "redis-acl-security", "domain": "security"},
    {"url": "https://cassandra.apache.org/doc/latest/cassandra/operating/security.html",
     "topic": "cassandra-security", "domain": "security"},
    {"url": "https://www.elastic.co/guide/en/elasticsearch/reference/current/security-getting-started.html",
     "topic": "elasticsearch-security", "domain": "security"},

    # ── Web Performance ───────────────────────────────────────────────────────
    {"url": "https://developer.chrome.com/docs/lighthouse/performance/largest-contentful-paint/",
     "topic": "lcp-performance", "domain": "performance"},
    {"url": "https://web.dev/articles/fid",
     "topic": "first-input-delay", "domain": "performance"},
    {"url": "https://web.dev/articles/cls",
     "topic": "cumulative-layout-shift", "domain": "performance"},
    {"url": "https://web.dev/articles/optimize-lcp",
     "topic": "optimize-lcp", "domain": "performance"},
    {"url": "https://web.dev/articles/reduce-javascript-payloads-with-tree-shaking",
     "topic": "tree-shaking-js", "domain": "performance"},
    {"url": "https://web.dev/articles/code-splitting-suspense",
     "topic": "code-splitting-react", "domain": "performance"},

    # ── Backend Architecture ──────────────────────────────────────────────────
    {"url": "https://martinfowler.com/articles/microservices.html",
     "topic": "microservices-architecture", "domain": "architecture"},
    {"url": "https://martinfowler.com/bliki/CQRS.html",
     "topic": "cqrs-pattern", "domain": "architecture"},
    {"url": "https://martinfowler.com/eaaDev/EventSourcing.html",
     "topic": "event-sourcing-pattern", "domain": "architecture"},
    {"url": "https://martinfowler.com/articles/strangler-fig.html",
     "topic": "strangler-fig-pattern", "domain": "architecture"},
    {"url": "https://microservices.io/patterns/data/saga.html",
     "topic": "saga-pattern", "domain": "architecture"},
    {"url": "https://microservices.io/patterns/reliability/circuit-breaker.html",
     "topic": "circuit-breaker-pattern", "domain": "architecture"},
    {"url": "https://microservices.io/patterns/apigateway.html",
     "topic": "api-gateway-pattern", "domain": "architecture"},
    {"url": "https://microservices.io/patterns/observability/distributed-tracing.html",
     "topic": "distributed-tracing", "domain": "architecture"},

    # ── Testing Best Practices ────────────────────────────────────────────────
    {"url": "https://martinfowler.com/articles/practical-test-pyramid.html",
     "topic": "test-pyramid", "domain": "quality"},
    {"url": "https://kentcdodds.com/blog/write-tests",
     "topic": "testing-philosophy", "domain": "quality"},
    {"url": "https://testing-library.com/docs/guiding-principles/",
     "topic": "testing-library-principles", "domain": "quality"},
    {"url": "https://jestjs.io/docs/best-practices",
     "topic": "jest-best-practices", "domain": "quality"},
    {"url": "https://docs.pytest.org/en/stable/explanation/goodpractices.html",
     "topic": "pytest-best-practices", "domain": "quality"},

    # ── Code Quality ──────────────────────────────────────────────────────────
    {"url": "https://refactoring.guru/refactoring/techniques",
     "topic": "refactoring-techniques", "domain": "quality"},
    {"url": "https://refactoring.guru/code-smells",
     "topic": "code-smells", "domain": "quality"},
    {"url": "https://martinfowler.com/bliki/TechnicalDebt.html",
     "topic": "technical-debt", "domain": "quality"},
    {"url": "https://www.thoughtworks.com/radar",
     "topic": "thoughtworks-tech-radar", "domain": "quality"},

    # ── Observability / SRE ───────────────────────────────────────────────────
    {"url": "https://sre.google/sre-book/monitoring-distributed-systems/",
     "topic": "sre-monitoring-guide", "domain": "quality"},
    {"url": "https://opentelemetry.io/docs/concepts/",
     "topic": "opentelemetry-concepts", "domain": "quality"},
    {"url": "https://prometheus.io/docs/practices/naming/",
     "topic": "prometheus-best-practices", "domain": "quality"},

    # ── ML / AI Security ──────────────────────────────────────────────────────
    {"url": "https://owasp.org/www-project-machine-learning-security-top-10/",
     "topic": "owasp-ml-security-top10", "domain": "security"},
    {"url": "https://llmtop10.com/",
     "topic": "owasp-llm-top10", "domain": "security"},
    {"url": "https://atlas.mitre.org/",
     "topic": "mitre-atlas-ml-attacks", "domain": "security"},
]


def _strip_html(html: str) -> str:
    """Simple HTML to text extraction."""
    # Remove script/style blocks
    html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", html)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> list[str]:
    """Split text into overlapping chunks for better RAG retrieval."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        if len(chunk) > 50:
            chunks.append(chunk)
        i += chunk_size - overlap
    return chunks


class DocCrawler:
    """
    Crawls documentation sources and stores knowledge as embeddings.
    Runs periodically to keep GitScope's knowledge up-to-date.
    """

    def __init__(self):
        self._crawl_interval = 24 * 3600  # Once per day
        self._last_crawled: dict[str, float] = {}

    async def run_doc_cycle(self) -> int:
        """Crawl all documentation sources."""
        logger.info("Starting documentation crawl cycle...")
        total = 0

        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            for source in DOC_SOURCES:
                url = source["url"]

                # Skip if crawled recently
                last = self._last_crawled.get(url, 0)
                if time.time() - last < self._crawl_interval:
                    continue

                try:
                    patterns = await self._crawl_source(client, source)
                    total += patterns
                    self._last_crawled[url] = time.time()
                    await asyncio.sleep(1)  # Polite crawl delay
                except Exception as e:
                    logger.debug(f"Doc crawl failed for {url}: {e}")

        logger.info(f"Doc crawl complete: {total} knowledge chunks stored")
        return total

    async def _crawl_source(self, client: httpx.AsyncClient, source: dict) -> int:
        """Fetch and process a single documentation source."""
        from memory.vector_store import store_code_pattern

        resp = await client.get(source["url"])
        if not resp.is_success:
            return 0

        content_type = resp.headers.get("content-type", "")
        count = 0

        if "json" in content_type or source.get("format") == "json":
            # JSON feed (CISA KEV, npm advisories, etc.)
            try:
                data = resp.json()
                count = self._process_json_feed(data, source)
            except Exception:
                pass
        else:
            # HTML documentation
            text = _strip_html(resp.text)
            chunks = _chunk_text(text, chunk_size=600, overlap=80)

            for i, chunk in enumerate(chunks[:30]):  # Max 30 chunks per page
                doc_id = f"doc:{source['topic']}:{i}:{hashlib.sha256(chunk.encode()).hexdigest()[:8]}"
                success = store_code_pattern(
                    doc_id=doc_id,
                    code_text=chunk,
                    findings=[],
                    metadata={
                        "source": "documentation",
                        "topic": source["topic"],
                        "domain": source["domain"],
                        "url": source["url"],
                        "chunk_index": i,
                    },
                )
                if success:
                    count += 1

        return count

    def _process_json_feed(self, data: Any, source: dict) -> int:
        """Process structured JSON feeds like CISA KEV."""
        from memory.vector_store import store_code_pattern

        count = 0
        topic = source.get("topic", "advisory")

        # CISA Known Exploited Vulnerabilities
        if topic == "cisa-kev" and isinstance(data, dict):
            vulns = data.get("vulnerabilities", [])
            for v in vulns[:100]:
                cve_id = v.get("cveID", "")
                description = v.get("shortDescription", "")
                action = v.get("requiredAction", "")

                if not cve_id or not description:
                    continue

                text = f"CISA KEV: {cve_id}\nVendor: {v.get('vendorProject', '')}\nProduct: {v.get('product', '')}\nDescription: {description}\nRequired Action: {action}"
                doc_id = f"cisa-kev:{cve_id}"

                store_code_pattern(
                    doc_id=doc_id,
                    code_text=text,
                    findings=[{
                        "severity": "critical",
                        "category": "security",
                        "description": f"{cve_id}: {description[:200]}",
                        "suggestion": action or "Apply vendor patch immediately.",
                        "cve_id": cve_id,
                        "rule_id": f"cisa-kev-{cve_id}",
                    }],
                    metadata={
                        "source": "cisa-kev",
                        "cve_id": cve_id,
                        "severity": "critical",
                        "domain": "security",
                    },
                )
                count += 1

        return count
