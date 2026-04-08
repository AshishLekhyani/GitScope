"""
Secrets Hunter Agent
=====================
Comprehensive credential and secret leakage detection covering:
  - AWS, GCP/Google, Azure, Cloudflare, DigitalOcean
  - GitHub, GitLab, Bitbucket tokens
  - Stripe, PayPal, Square payment keys
  - Slack, Twilio, SendGrid, Mailgun communication tokens
  - Heroku, Shopify, PagerDuty, Okta, Datadog
  - npm, PyPI, Terraform Cloud tokens
  - JWT tokens (validated by decoding header)
  - RSA, EC, OpenSSH, PGP private keys
  - X.509 Certificates
  - Database connection strings (PostgreSQL, MySQL, MongoDB, Redis)
  - Docker registry credentials (.dockerconfigjson)
  - Kubernetes Secret manifests
  - CI/CD hardcoded credentials (.travis.yml, CircleCI, GitHub Actions)
  - Generic high-entropy secrets assigned to secret-like variable names
  - Shannon entropy analysis for unknown token formats
  - Placeholder / safe-reference filtering

Severity model:
  - critical : live production credential (sk_live_, AKIA*, ghp_*, etc.)
  - high     : private key material, certificate, high-entropy generic secret
  - medium   : test-mode credential, low-confidence or generic match
  Test context (tests/, fixtures/, mocks/, *.test.*, *.spec.*) downgrades:
    critical → high, high → medium

Scoring:
  - Base: 95
  - critical: -35, high: -20, medium: -8
  - Clamped 0–100

References:
  - OWASP Secrets Management Cheat Sheet
  - NIST SP 800-57 Key Management
  - GitHub Advisory Database — token exposure patterns
"""

from __future__ import annotations

import base64
import json
import math
import re
import time
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding

# ══════════════════════════════════════════════════════════════════════════════
# §1  PLACEHOLDER / FALSE-POSITIVE FILTER
# ══════════════════════════════════════════════════════════════════════════════

_PLACEHOLDER_PATTERNS: list[re.Pattern] = [
    re.compile(r"example", re.IGNORECASE),
    re.compile(r"your[_\-]?", re.IGNORECASE),
    re.compile(r"xxx+", re.IGNORECASE),
    re.compile(r"placeholder", re.IGNORECASE),
    re.compile(r"changeme", re.IGNORECASE),
    re.compile(r"<[^>]+>"),          # <MY_SECRET>
    re.compile(r"\$\{[^}]+\}"),      # ${MY_SECRET}
    re.compile(r"%[sd]"),            # printf-style format
    re.compile(r"\{\{[^}]+\}\}"),    # {{ secret }} Jinja / Helm
    re.compile(r"INSERT[_\s]"),
    re.compile(r"REPLACE[_\s]"),
    re.compile(r"__[A-Z_]+__"),      # __SECRET_HERE__
    re.compile(r"<YOUR"),
    re.compile(r"test[_\-]?key", re.IGNORECASE),
    re.compile(r"fake[_\-]?", re.IGNORECASE),
    re.compile(r"dummy", re.IGNORECASE),
    re.compile(r"sample", re.IGNORECASE),
    re.compile(r"1234567890"),
    re.compile(r"abcdef(gh)?", re.IGNORECASE),
]

# env-var or config references are safe — they don't embed the literal secret
_ENV_REF_PATTERNS: list[re.Pattern] = [
    re.compile(r"process\.env\.", re.IGNORECASE),
    re.compile(r"os\.environ", re.IGNORECASE),
    re.compile(r"os\.getenv\(", re.IGNORECASE),
    re.compile(r"config\.", re.IGNORECASE),
    re.compile(r"secrets\.", re.IGNORECASE),
    re.compile(r"getenv\(", re.IGNORECASE),
    re.compile(r"vault\.", re.IGNORECASE),
    re.compile(r"keyring\.", re.IGNORECASE),
    re.compile(r"\$[A-Z_][A-Z0-9_]+"),   # $MY_SECRET shell variable
]

# ══════════════════════════════════════════════════════════════════════════════
# §2  TEST-CONTEXT DETECTION
# ══════════════════════════════════════════════════════════════════════════════

_TEST_PATH_RE = re.compile(
    r"(?:^|[\\/])(?:tests?|__tests?__|fixtures?|mocks?|spec)[\\/]",
    re.IGNORECASE,
)
_TEST_FILENAME_RE = re.compile(
    r"\.(?:test|spec)\.[a-z]+$",
    re.IGNORECASE,
)
_MOCK_FILENAME_RE = re.compile(
    r"(?:mock|stub|fixture|fake)[^/\\]*$",
    re.IGNORECASE,
)

# ══════════════════════════════════════════════════════════════════════════════
# §3  SECRET PATTERNS  (category, rule_id, regex, severity, description, suggestion)
# ══════════════════════════════════════════════════════════════════════════════

# Each entry: (category, rule_id, pattern, severity, description, suggestion)
# Patterns are all raw strings with named group 'secret' where practical.

_SECRET_RULES: list[dict] = [
    # ── AWS ──────────────────────────────────────────────────────────────────
    {
        "category": "aws",
        "rule_id": "aws-access-key-id",
        "pattern": re.compile(
            r"""(?:^|[^A-Z0-9])(AKIA[0-9A-Z]{16})(?:[^A-Z0-9]|$)""",
            re.MULTILINE,
        ),
        "severity": "critical",
        "description": "AWS Access Key ID (AKIA…) detected — live IAM credential exposed.",
        "suggestion": "Rotate the key immediately via IAM console. Use AWS Secrets Manager or environment variables. "
                      "Enable AWS CloudTrail to audit any misuse.",
    },
    {
        "category": "aws",
        "rule_id": "aws-secret-access-key",
        "pattern": re.compile(
            r"""(?i)(?:aws[_\-\s]?secret[_\-\s]?(?:access[_\-\s]?)?key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*['"` ]*([A-Za-z0-9+/]{40})['"` ]?""",
        ),
        "severity": "critical",
        "description": "AWS Secret Access Key (40-char base64) detected in code.",
        "suggestion": "Revoke via IAM → Delete key. Store in AWS Secrets Manager or ~/.aws/credentials. "
                      "Never commit credentials — use IAM roles for EC2/ECS/Lambda.",
    },
    {
        "category": "aws",
        "rule_id": "aws-session-token",
        "pattern": re.compile(
            r"""(?i)(?:AWS_SESSION_TOKEN|aws[_\-\s]?session[_\-\s]?token)\s*[=:]\s*['"` ]*([A-Za-z0-9+/=]{100,})['"` ]?""",
        ),
        "severity": "critical",
        "description": "AWS Session Token (STS temporary credential) detected.",
        "suggestion": "Rotate the STS session and revoke the underlying IAM role's temporary credentials.",
    },
    {
        "category": "aws",
        "rule_id": "aws-mws-key",
        "pattern": re.compile(
            r"""(?i)(?:mws|amazon[_\-]?marketplace)\s*[_\-]?\s*(?:key|token|secret)\s*[=:]\s*['"` ]*([A-Za-z0-9]{20,40})['"` ]?""",
        ),
        "severity": "high",
        "description": "Potential AWS Marketplace Web Service (MWS) key detected.",
        "suggestion": "Rotate the MWS key from Seller Central → Developer Token Management.",
    },

    # ── GitHub ────────────────────────────────────────────────────────────────
    {
        "category": "github",
        "rule_id": "github-pat-classic",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(ghp_[A-Za-z0-9]{36})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "GitHub Personal Access Token (classic, ghp_…) detected.",
        "suggestion": "Revoke at github.com/settings/tokens immediately. Use GitHub Secrets for CI/CD. "
                      "Consider fine-grained tokens with minimal scopes.",
    },
    {
        "category": "github",
        "rule_id": "github-oauth-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(gho_[A-Za-z0-9]{36})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "GitHub OAuth App Access Token (gho_…) detected.",
        "suggestion": "Revoke via GitHub OAuth App settings. Rotate client secret and reissue tokens.",
    },
    {
        "category": "github",
        "rule_id": "github-app-installation-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(ghs_[A-Za-z0-9]{36})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "GitHub App Server-to-Server (installation) token (ghs_…) detected.",
        "suggestion": "These tokens expire in 1 hour but revoke the GitHub App installation if possible.",
    },
    {
        "category": "github",
        "rule_id": "github-user-to-server-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(ghu_[A-Za-z0-9]{36})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "GitHub App User-to-Server token (ghu_…) detected.",
        "suggestion": "Revoke the token via the GitHub App's authorized OAuth Apps settings.",
    },
    {
        "category": "github",
        "rule_id": "github-fine-grained-pat",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(github_pat_[A-Za-z0-9_]{59,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "GitHub Fine-Grained Personal Access Token (github_pat_…) detected.",
        "suggestion": "Revoke at github.com/settings/personal-access-tokens. Use GitHub Actions secrets instead.",
    },

    # ── Google / GCP ──────────────────────────────────────────────────────────
    {
        "category": "google",
        "rule_id": "google-api-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(AIza[0-9A-Za-z\-_]{35})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Google API Key (AIza…, 39 chars) detected — valid for Maps, Firebase, YouTube, etc.",
        "suggestion": "Restrict the key in Google Cloud Console → APIs & Services → Credentials. "
                      "Apply HTTP referrer / IP restrictions. Rotate if exposed.",
    },
    {
        "category": "google",
        "rule_id": "gcp-service-account-json",
        "pattern": re.compile(
            r""""type"\s*:\s*"service_account".*?"private_key"\s*:\s*"-----BEGIN""",
            re.DOTALL,
        ),
        "severity": "critical",
        "description": "GCP Service Account JSON key (with private key) detected in source.",
        "suggestion": "Delete the service account key in GCP IAM & Admin → Service Accounts. "
                      "Use Workload Identity Federation instead of key files.",
    },
    {
        "category": "google",
        "rule_id": "google-oauth-client-secret",
        "pattern": re.compile(
            r"""(?i)(?:client_secret|GOOGLE_CLIENT_SECRET|google[_\-]?oauth[_\-]?secret)\s*[=:]\s*['"` ]*([A-Za-z0-9\-_]{24,})""",
        ),
        "severity": "critical",
        "description": "Google OAuth 2.0 client secret detected.",
        "suggestion": "Regenerate the OAuth client secret in Google Cloud Console. "
                      "Store in Secret Manager or environment variables.",
    },

    # ── Azure ─────────────────────────────────────────────────────────────────
    {
        "category": "azure",
        "rule_id": "azure-storage-connection-string",
        "pattern": re.compile(
            r"""DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=([A-Za-z0-9+/]{86}==)""",
        ),
        "severity": "critical",
        "description": "Azure Storage Account connection string with AccountKey detected.",
        "suggestion": "Rotate the storage account key in Azure Portal → Storage Account → Access Keys. "
                      "Use Azure Managed Identity or Azure Key Vault references.",
    },
    {
        "category": "azure",
        "rule_id": "azure-client-secret",
        "pattern": re.compile(
            r"""(?i)(?:AZURE_CLIENT_SECRET|azure[_\-]?client[_\-]?secret|clientSecret)\s*[=:]\s*['"` ]*([A-Za-z0-9~._\-]{34,40})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Azure Active Directory application client secret detected.",
        "suggestion": "Rotate the secret in Azure AD → App Registrations → Certificates & Secrets.",
    },
    {
        "category": "azure",
        "rule_id": "azure-sas-token",
        "pattern": re.compile(
            r"""(?i)(?:sv=\d{4}-\d{2}-\d{2}&(?:ss|se|sp|spr|srt|sig)=[^&\s]{4,}&sig=)([A-Za-z0-9%+/=]{30,})""",
        ),
        "severity": "high",
        "description": "Azure Shared Access Signature (SAS) token detected.",
        "suggestion": "Revoke the SAS token and regenerate with minimal permissions and short expiry.",
    },
    {
        "category": "azure",
        "rule_id": "azure-service-bus-connection-string",
        "pattern": re.compile(
            r"""Endpoint=sb://[^;]+;SharedAccessKeyName=[^;]+;SharedAccessKey=([A-Za-z0-9+/=]{44,})""",
        ),
        "severity": "critical",
        "description": "Azure Service Bus connection string with SharedAccessKey detected.",
        "suggestion": "Regenerate the shared access key in Azure Portal → Service Bus → Shared access policies.",
    },

    # ── Stripe ────────────────────────────────────────────────────────────────
    {
        "category": "stripe",
        "rule_id": "stripe-live-secret-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(sk_live_[0-9a-zA-Z]{24,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Stripe LIVE secret API key (sk_live_…) detected — full payment access.",
        "suggestion": "Rotate immediately in Stripe Dashboard → Developers → API Keys. "
                      "Use Stripe Restricted Keys with minimal permissions.",
    },
    {
        "category": "stripe",
        "rule_id": "stripe-live-publishable-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(pk_live_[0-9a-zA-Z]{24,})(?![A-Za-z0-9_])""",
        ),
        "severity": "high",
        "description": "Stripe LIVE publishable key (pk_live_…) detected. "
                       "Publishable keys are client-side but their exposure in server code is a red flag.",
        "suggestion": "Verify this is only used in client-side contexts. Restrict domain usage in Stripe settings.",
    },
    {
        "category": "stripe",
        "rule_id": "stripe-live-restricted-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(rk_live_[0-9a-zA-Z]{24,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Stripe LIVE restricted key (rk_live_…) detected.",
        "suggestion": "Rotate in Stripe Dashboard → Developers → Restricted Keys.",
    },
    {
        "category": "stripe",
        "rule_id": "stripe-webhook-secret",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(whsec_[A-Za-z0-9]{40,})(?![A-Za-z0-9_])""",
        ),
        "severity": "high",
        "description": "Stripe webhook signing secret (whsec_…) detected.",
        "suggestion": "Regenerate the webhook secret in Stripe Dashboard → Developers → Webhooks.",
    },

    # ── Slack ─────────────────────────────────────────────────────────────────
    {
        "category": "slack",
        "rule_id": "slack-bot-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(xoxb-[0-9]{8,13}-[0-9]{8,13}-[A-Za-z0-9]{24,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Slack Bot Token (xoxb-…) detected — can read/write messages and files.",
        "suggestion": "Revoke in Slack API → Your Apps → OAuth & Permissions → Revoke Token. "
                      "Store in environment variables or secret management.",
    },
    {
        "category": "slack",
        "rule_id": "slack-user-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(xoxp-[0-9]{8,13}-[0-9]{8,13}-[0-9]{8,13}-[A-Za-z0-9]{32,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Slack User Token (xoxp-…) detected — acts as a real user account.",
        "suggestion": "Revoke immediately at api.slack.com/apps. User tokens have broad permissions.",
    },
    {
        "category": "slack",
        "rule_id": "slack-app-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(xoxa-[0-9]{8,13}-[0-9]{8,13}-[A-Za-z0-9]{24,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Slack App-Level Token (xoxa-…) detected.",
        "suggestion": "Regenerate in Slack API → App settings → App-Level Tokens.",
    },
    {
        "category": "slack",
        "rule_id": "slack-workspace-access-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(xoxs-[0-9]{8,13}-[0-9]{8,13}-[0-9]{8,13}-[A-Za-z0-9]{32,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Slack Legacy Workspace Access Token (xoxs-…) detected.",
        "suggestion": "Migrate to granular bot tokens and revoke this legacy credential immediately.",
    },

    # ── Twilio ────────────────────────────────────────────────────────────────
    {
        "category": "twilio",
        "rule_id": "twilio-account-sid",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(AC[0-9a-f]{32})(?![A-Za-z0-9_])""",
        ),
        "severity": "high",
        "description": "Twilio Account SID (AC[32hex]) detected. "
                       "Alone it is not sensitive, but combined with Auth Token enables full account access.",
        "suggestion": "Ensure Auth Token is not present nearby. Store in environment variables.",
    },
    {
        "category": "twilio",
        "rule_id": "twilio-auth-token",
        "pattern": re.compile(
            r"""(?i)(?:TWILIO_AUTH_TOKEN|twilio[_\-]?auth[_\-]?token)\s*[=:]\s*['"` ]*([0-9a-f]{32})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Twilio Auth Token (32 hex chars) detected — provides full account control.",
        "suggestion": "Rotate in Twilio Console → Account → Settings → Auth Tokens. "
                      "Use API Keys instead of the primary auth token for production.",
    },
    {
        "category": "twilio",
        "rule_id": "twilio-api-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(SK[0-9a-f]{32})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Twilio API Key SID (SK[32hex]) detected.",
        "suggestion": "Revoke in Twilio Console → API Keys & Tokens. Rotate the associated secret.",
    },

    # ── SendGrid ──────────────────────────────────────────────────────────────
    {
        "category": "sendgrid",
        "rule_id": "sendgrid-api-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_.])(SG\.[A-Za-z0-9\-_]{22,}\.[A-Za-z0-9\-_]{43,})(?![A-Za-z0-9_.])""",
        ),
        "severity": "critical",
        "description": "SendGrid API Key (SG.xxx.xxx) detected — allows sending emails on your behalf.",
        "suggestion": "Revoke at app.sendgrid.com → Settings → API Keys. Create scoped keys with minimal permissions.",
    },

    # ── Mailgun ───────────────────────────────────────────────────────────────
    {
        "category": "mailgun",
        "rule_id": "mailgun-api-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(key-[0-9a-f]{32})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Mailgun Private API Key (key-[32hex]) detected.",
        "suggestion": "Regenerate at app.mailgun.com → Settings → API Keys.",
    },
    {
        "category": "mailgun",
        "rule_id": "mailgun-public-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(pubkey-[0-9a-f]{32})(?![A-Za-z0-9_])""",
        ),
        "severity": "medium",
        "description": "Mailgun Public Validation Key (pubkey-[32hex]) detected.",
        "suggestion": "Public keys have limited scope but should not be committed to version control.",
    },

    # ── Heroku ────────────────────────────────────────────────────────────────
    {
        "category": "heroku",
        "rule_id": "heroku-api-key",
        "pattern": re.compile(
            r"""(?i)(?:heroku[_\-]?api[_\-]?key|HEROKU_API_KEY)\s*[=:]\s*['"` ]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Heroku API Key (UUID format) detected — full access to Heroku account.",
        "suggestion": "Rotate at dashboard.heroku.com → Account → API Key. Use HEROKU_API_KEY env var.",
    },

    # ── Shopify ───────────────────────────────────────────────────────────────
    {
        "category": "shopify",
        "rule_id": "shopify-private-app-password",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(shpss_[A-Za-z0-9]{32,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Shopify Private App Password (shpss_…) detected.",
        "suggestion": "Regenerate in Shopify Partners → Apps → Private Apps.",
    },
    {
        "category": "shopify",
        "rule_id": "shopify-access-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(shpat_[A-Za-z0-9]{32,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Shopify Access Token (shpat_…) detected.",
        "suggestion": "Revoke and regenerate the access token in Shopify admin.",
    },
    {
        "category": "shopify",
        "rule_id": "shopify-custom-app-access-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(shpca_[A-Za-z0-9]{32,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Shopify Custom App Access Token (shpca_…) detected.",
        "suggestion": "Revoke in Shopify Partners Dashboard → Apps → API credentials.",
    },
    {
        "category": "shopify",
        "rule_id": "shopify-partner-api-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(shppa_[A-Za-z0-9]{32,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Shopify Partner API Token (shppa_…) detected.",
        "suggestion": "Rotate in Shopify Partners Dashboard → Partner API client.",
    },

    # ── Datadog ───────────────────────────────────────────────────────────────
    {
        "category": "datadog",
        "rule_id": "datadog-api-key",
        "pattern": re.compile(
            r"""(?i)(?:DD_API_KEY|DATADOG_API_KEY|datadog[_\-]?api[_\-]?key)\s*[=:]\s*['"` ]*([A-Za-z0-9]{32,40})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Datadog API Key detected — allows submitting metrics and logs.",
        "suggestion": "Rotate at app.datadoghq.com → Organization Settings → API Keys.",
    },
    {
        "category": "datadog",
        "rule_id": "datadog-app-key",
        "pattern": re.compile(
            r"""(?i)(?:DD_APP_KEY|DATADOG_APP_KEY|datadog[_\-]?app[_\-]?key)\s*[=:]\s*['"` ]*([A-Za-z0-9]{40,})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Datadog Application Key detected — allows read/write access to Datadog configuration.",
        "suggestion": "Rotate at app.datadoghq.com → Organization Settings → Application Keys.",
    },

    # ── PagerDuty ─────────────────────────────────────────────────────────────
    {
        "category": "pagerduty",
        "rule_id": "pagerduty-api-key",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_+])(u\+[0-9a-f]{16})(?![A-Za-z0-9_+])""",
        ),
        "severity": "critical",
        "description": "PagerDuty API Key (u+[16hex]) detected.",
        "suggestion": "Revoke at app.pagerduty.com → Integrations → API Access Keys.",
    },
    {
        "category": "pagerduty",
        "rule_id": "pagerduty-integration-key",
        "pattern": re.compile(
            r"""(?i)(?:PAGERDUTY[_\-]?(?:API[_\-]?)?(?:INTEGRATION[_\-]?)?KEY|pagerduty_token)\s*[=:]\s*['"` ]*([A-Za-z0-9_\-]{20,40})['"` ]?""",
        ),
        "severity": "high",
        "description": "PagerDuty Integration Key detected.",
        "suggestion": "Rotate the integration key in PagerDuty → Services → Integrations.",
    },

    # ── Okta ──────────────────────────────────────────────────────────────────
    {
        "category": "okta",
        "rule_id": "okta-ssws-api-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(SSWS[A-Za-z0-9_\-]{40,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "Okta SSWS API Token detected — admin-level access to Okta org.",
        "suggestion": "Revoke at your-org.okta.com → Security → API → Tokens.",
    },
    {
        "category": "okta",
        "rule_id": "okta-client-secret",
        "pattern": re.compile(
            r"""(?i)(?:OKTA_CLIENT_SECRET|okta[_\-]?client[_\-]?secret)\s*[=:]\s*['"` ]*([A-Za-z0-9\-_]{40,64})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Okta OAuth 2.0 Client Secret detected.",
        "suggestion": "Rotate in Okta Admin Console → Applications → Client Credentials.",
    },

    # ── Cloudflare ────────────────────────────────────────────────────────────
    {
        "category": "cloudflare",
        "rule_id": "cloudflare-api-token",
        "pattern": re.compile(
            r"""(?i)(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN|cloudflare[_\-]?(?:api[_\-]?)?token)\s*[=:]\s*['"` ]*([A-Za-z0-9_\-]{40,})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Cloudflare API Token detected — controls DNS, CDN, and firewall rules.",
        "suggestion": "Revoke at dash.cloudflare.com → Profile → API Tokens. Use scoped tokens.",
    },
    {
        "category": "cloudflare",
        "rule_id": "cloudflare-global-api-key",
        "pattern": re.compile(
            r"""(?i)(?:CF_API_KEY|CLOUDFLARE_API_KEY|cloudflare[_\-]?(?:global[_\-]?)?api[_\-]?key)\s*[=:]\s*['"` ]*([0-9a-f]{37})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Cloudflare Global API Key (37 hex chars) detected — full account access.",
        "suggestion": "Never use the Global API Key in code. Use scoped API Tokens instead. Rotate immediately.",
    },

    # ── DigitalOcean ──────────────────────────────────────────────────────────
    {
        "category": "digitalocean",
        "rule_id": "digitalocean-personal-access-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(dop_v1_[A-Za-z0-9]{64})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "DigitalOcean Personal Access Token (dop_v1_…) detected.",
        "suggestion": "Revoke at cloud.digitalocean.com → API → Tokens/Keys.",
    },
    {
        "category": "digitalocean",
        "rule_id": "digitalocean-api-key",
        "pattern": re.compile(
            r"""(?i)(?:DO_API_KEY|DIGITALOCEAN_ACCESS_TOKEN|digitalocean[_\-]?(?:api[_\-]?)?(?:key|token))\s*[=:]\s*['"` ]*([A-Za-z0-9]{64})['"` ]?""",
        ),
        "severity": "critical",
        "description": "DigitalOcean API Key detected.",
        "suggestion": "Rotate at cloud.digitalocean.com → API → Tokens/Keys.",
    },

    # ── npm ───────────────────────────────────────────────────────────────────
    {
        "category": "npm",
        "rule_id": "npm-access-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(npm_[A-Za-z0-9]{36})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "npm Access Token (npm_[36alphanum]) detected — allows publishing packages.",
        "suggestion": "Revoke at npmjs.com → Profile → Access Tokens. Use token with minimal scopes.",
    },
    {
        "category": "npm",
        "rule_id": "npmrc-auth-token",
        "pattern": re.compile(
            r"""//registry\.npmjs\.org/:_authToken\s*=\s*([A-Za-z0-9\-_]{36,})""",
        ),
        "severity": "critical",
        "description": "npm authentication token in .npmrc detected.",
        "suggestion": "Add .npmrc to .gitignore. Use NPM_TOKEN environment variable in CI/CD.",
    },

    # ── PyPI ──────────────────────────────────────────────────────────────────
    {
        "category": "pypi",
        "rule_id": "pypi-upload-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(pypi-[A-Za-z0-9_\-]{40,})(?![A-Za-z0-9_])""",
        ),
        "severity": "critical",
        "description": "PyPI Upload Token (pypi-…) detected — allows publishing Python packages.",
        "suggestion": "Revoke at pypi.org → Account settings → API tokens. Use trusted publishing instead.",
    },

    # ── Terraform Cloud ───────────────────────────────────────────────────────
    {
        "category": "terraform",
        "rule_id": "terraform-cloud-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])([A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9]{60})(?![A-Za-z0-9_.])""",
        ),
        "severity": "critical",
        "description": "Terraform Cloud / Atlas API token detected.",
        "suggestion": "Revoke at app.terraform.io → User Settings → Tokens.",
    },

    # ── JWT ───────────────────────────────────────────────────────────────────
    {
        "category": "jwt",
        "rule_id": "jwt-token",
        "pattern": re.compile(
            r"""(?<![A-Za-z0-9_])(eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*)(?![A-Za-z0-9_])""",
        ),
        "severity": "high",
        "description": "JSON Web Token (JWT) detected in source — may be a long-lived service token.",
        "suggestion": "Never hardcode JWTs. Use short-lived tokens, verify signatures, "
                      "and store service tokens in secret managers.",
    },

    # ── Private Keys ──────────────────────────────────────────────────────────
    {
        "category": "private-key",
        "rule_id": "rsa-private-key",
        "pattern": re.compile(
            r"""-----BEGIN RSA PRIVATE KEY-----""",
        ),
        "severity": "critical",
        "description": "RSA Private Key block detected in source code.",
        "suggestion": "Remove immediately. Store private keys in a secrets manager (Vault, AWS KMS, "
                      "Azure Key Vault). Rotate any certificates/tokens signed by this key.",
    },
    {
        "category": "private-key",
        "rule_id": "ec-private-key",
        "pattern": re.compile(
            r"""-----BEGIN EC PRIVATE KEY-----""",
        ),
        "severity": "critical",
        "description": "EC (Elliptic Curve) Private Key block detected in source code.",
        "suggestion": "Remove immediately and rotate all credentials using this key.",
    },
    {
        "category": "private-key",
        "rule_id": "pkcs8-private-key",
        "pattern": re.compile(
            r"""-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----""",
        ),
        "severity": "critical",
        "description": "PKCS#8 Private Key block detected in source code.",
        "suggestion": "Remove and rotate immediately. Use a HSM or secrets manager.",
    },
    {
        "category": "private-key",
        "rule_id": "openssh-private-key",
        "pattern": re.compile(
            r"""-----BEGIN OPENSSH PRIVATE KEY-----""",
        ),
        "severity": "critical",
        "description": "OpenSSH Private Key block detected — SSH identity file content in source.",
        "suggestion": "Remove immediately. SSH keys must never be committed. "
                      "Rotate on all servers where this key was authorized.",
    },
    {
        "category": "private-key",
        "rule_id": "pgp-private-key",
        "pattern": re.compile(
            r"""-----BEGIN PGP PRIVATE KEY BLOCK-----""",
        ),
        "severity": "critical",
        "description": "PGP/GPG Private Key block detected in source code.",
        "suggestion": "Remove and revoke the key from keyservers. Rotate any secrets encrypted/signed with it.",
    },
    {
        "category": "certificate",
        "rule_id": "x509-certificate",
        "pattern": re.compile(
            r"""-----BEGIN CERTIFICATE-----""",
        ),
        "severity": "medium",
        "description": "X.509 Certificate block detected in source code. "
                       "Certificates themselves are public, but their presence may indicate collocated private key.",
        "suggestion": "Verify no private key accompanies this certificate. "
                      "Certificates are best stored in a dedicated cert store or secrets manager.",
    },
    {
        "category": "dsa-private-key",
        "rule_id": "dsa-private-key",
        "pattern": re.compile(
            r"""-----BEGIN DSA PRIVATE KEY-----""",
        ),
        "severity": "critical",
        "description": "DSA Private Key block detected. DSA is deprecated; this is both insecure and exposed.",
        "suggestion": "Migrate to ED25519 or ECDSA. Remove this key from source and rotate immediately.",
    },

    # ── Database Connection Strings ───────────────────────────────────────────
    {
        "category": "database",
        "rule_id": "postgresql-connection-string",
        "pattern": re.compile(
            r"""postgresql://[A-Za-z0-9_\-]+:[^@\s]{3,}@[A-Za-z0-9.\-]+(?::\d+)?/[A-Za-z0-9_\-]+""",
            re.IGNORECASE,
        ),
        "severity": "critical",
        "description": "PostgreSQL connection string with embedded password detected.",
        "suggestion": "Use DATABASE_URL environment variable. Never embed passwords in source code.",
    },
    {
        "category": "database",
        "rule_id": "mysql-connection-string",
        "pattern": re.compile(
            r"""mysql://[A-Za-z0-9_\-]+:[^@\s]{3,}@[A-Za-z0-9.\-]+(?::\d+)?/[A-Za-z0-9_\-]+""",
            re.IGNORECASE,
        ),
        "severity": "critical",
        "description": "MySQL connection string with embedded password detected.",
        "suggestion": "Use DATABASE_URL environment variable or a secrets manager.",
    },
    {
        "category": "database",
        "rule_id": "mongodb-connection-string",
        "pattern": re.compile(
            r"""mongodb(?:\+srv)?://[A-Za-z0-9_\-]+:[^@\s]{3,}@[A-Za-z0-9.\-,]+(?::\d+)?(?:/[A-Za-z0-9_\-]+)?""",
            re.IGNORECASE,
        ),
        "severity": "critical",
        "description": "MongoDB connection string with embedded password detected.",
        "suggestion": "Use MONGODB_URI environment variable. Rotate the DB user password.",
    },
    {
        "category": "database",
        "rule_id": "redis-connection-string",
        "pattern": re.compile(
            r"""redis://:([^@\s]+)@[A-Za-z0-9.\-]+(?::\d+)?""",
            re.IGNORECASE,
        ),
        "severity": "critical",
        "description": "Redis connection string with embedded password detected.",
        "suggestion": "Use REDIS_URL environment variable. Enable Redis AUTH and rotate the password.",
    },
    {
        "category": "database",
        "rule_id": "mssql-connection-string",
        "pattern": re.compile(
            r"""(?i)(?:Server|Data Source)=[A-Za-z0-9.\-]+;.*?(?:Password|PWD)=([^;'"]{4,})""",
        ),
        "severity": "critical",
        "description": "MSSQL/SQL Server connection string with Password detected.",
        "suggestion": "Use Windows Integrated Security or environment variables for connection strings.",
    },
    {
        "category": "database",
        "rule_id": "cassandra-connection-string",
        "pattern": re.compile(
            r"""(?i)(?:CASSANDRA[_\-]?(?:PASS(?:WORD)?|AUTH))\s*[=:]\s*['"` ]*([A-Za-z0-9!@#$%^&*]{8,})['"` ]?""",
        ),
        "severity": "critical",
        "description": "Cassandra password or auth token detected.",
        "suggestion": "Store Cassandra credentials in environment variables or a secrets manager.",
    },

    # ── Docker Registry Credentials ───────────────────────────────────────────
    {
        "category": "docker",
        "rule_id": "dockerconfigjson-auth",
        "pattern": re.compile(
            r"""\.dockerconfigjson['"` \s]*:['"` \s]*[{"].*?"auths"\s*:\s*\{""",
            re.DOTALL,
        ),
        "severity": "critical",
        "description": "Docker registry auth config (.dockerconfigjson) detected in source.",
        "suggestion": "Store Docker credentials as Kubernetes Secret of type kubernetes.io/dockerconfigjson, "
                      "never in source code. Use credential helpers (docker-credential-ecr-login, etc.).",
    },
    {
        "category": "docker",
        "rule_id": "docker-auth-base64",
        "pattern": re.compile(
            r'''"auth"\s*:\s*"([A-Za-z0-9+/=]{20,})"''',
        ),
        "severity": "high",
        "description": "Docker registry base64 auth credential detected.",
        "suggestion": "This is a base64-encoded user:password. Remove from source and use credential helpers.",
    },

    # ── Kubernetes Secrets ────────────────────────────────────────────────────
    {
        "category": "kubernetes",
        "rule_id": "k8s-secret-manifest",
        "pattern": re.compile(
            r"""apiVersion:\s*v1\s*\nkind:\s*Secret.*?\ndata:\s*\n(?:\s+\w+:\s+\S+\n)+""",
            re.DOTALL,
        ),
        "severity": "high",
        "description": "Kubernetes Secret manifest with non-empty data section detected in source.",
        "suggestion": "Never commit Kubernetes Secrets to version control. "
                      "Use Sealed Secrets, External Secrets Operator, or Vault Agent Injector.",
    },

    # ── CI/CD Secrets ─────────────────────────────────────────────────────────
    {
        "category": "cicd",
        "rule_id": "github-actions-hardcoded-secret",
        "pattern": re.compile(
            r"""(?i)(?:env:|environment:)\s*\n(?:\s+(?!secrets\.|vars\.)[A-Z_]+\s*:\s*['"` ]*[A-Za-z0-9+/=_\-]{16,}['"` ]*\n)+""",
            re.MULTILINE,
        ),
        "severity": "high",
        "description": "Hardcoded secret value in GitHub Actions workflow env block detected. "
                       "Should use ${{ secrets.NAME }} references.",
        "suggestion": "Replace hardcoded values with ${{ secrets.SECRET_NAME }} references. "
                      "Add secrets via GitHub Repository Settings → Secrets → Actions.",
    },
    {
        "category": "cicd",
        "rule_id": "travis-ci-env-secret",
        "pattern": re.compile(
            r"""(?i)secure:\s+([A-Za-z0-9+/=]{50,})""",
        ),
        "severity": "medium",
        "description": "Travis CI encrypted environment variable (secure:) detected. "
                       "Encrypted but key could be extracted if Travis account is compromised.",
        "suggestion": "Verify the Travis CI repo settings. Migrate to GitHub Actions with GitHub Secrets.",
    },
    {
        "category": "cicd",
        "rule_id": "circleci-env-value",
        "pattern": re.compile(
            r"""(?i)(?:CIRCLE_TOKEN|circleci[_\-]?(?:api[_\-]?)?token)\s*[=:]\s*['"` ]*([A-Za-z0-9_\-]{20,})['"` ]?""",
        ),
        "severity": "critical",
        "description": "CircleCI API token detected in source code.",
        "suggestion": "Store in CircleCI Project Settings → Environment Variables, not in code.",
    },

    # ── Generic High-Entropy Assignments ─────────────────────────────────────
    # (These are checked programmatically with entropy verification in the scanner)
    {
        "category": "generic",
        "rule_id": "generic-secret-assignment",
        "pattern": re.compile(
            r"""(?i)(?:password|passwd|secret|api[_\-]?key|auth[_\-]?token|private[_\-]?key|"""
            r"""access[_\-]?(?:key|token)|signing[_\-]?(?:key|secret)|encryption[_\-]?key|"""
            r"""client[_\-]?secret|db[_\-]?pass(?:word)?|bearer[_\-]?token|"""
            r"""master[_\-]?key|root[_\-]?pass|admin[_\-]?pass|service[_\-]?key|"""
            r"""webhook[_\-]?secret|deploy[_\-]?key|session[_\-]?secret|"""
            r"""jwt[_\-]?secret|app[_\-]?secret|connection[_\-]?string)"""
            r"""\s*[=:]\s*['"` ]+([A-Za-z0-9+/!@#$%^&*\-_=]{16,})['"` ]+""",
        ),
        "severity": "high",
        "description": "Potential hardcoded secret assigned to a sensitive variable name.",
        "suggestion": "Move this value to an environment variable or secrets manager. "
                      "Use a .env file (in .gitignore) for local development.",
    },
]

# ══════════════════════════════════════════════════════════════════════════════
# §4  SENSITIVE FILE PATTERNS
# ══════════════════════════════════════════════════════════════════════════════

_SENSITIVE_FILE_RULES: list[dict] = [
    {
        "pattern": re.compile(r"(?:^|/)\.env(?:\.local|\.production|\.staging|\.development)?$", re.IGNORECASE),
        "rule_id": "sensitive-file-env",
        "severity": "high",
        "description": "Environment file (.env) committed to repository — may contain live credentials.",
        "suggestion": "Add .env to .gitignore immediately. Use .env.example as a documented template.",
    },
    {
        "pattern": re.compile(r"(?:^|/)(?:id_rsa|id_ecdsa|id_ed25519|id_dsa)$"),
        "rule_id": "sensitive-file-ssh-key",
        "severity": "critical",
        "description": "SSH private key file committed to repository.",
        "suggestion": "Remove from git history with git-filter-repo. Rotate the key on all servers.",
    },
    {
        "pattern": re.compile(r"\.pem$", re.IGNORECASE),
        "rule_id": "sensitive-file-pem",
        "severity": "critical",
        "description": "PEM certificate/key file committed to repository.",
        "suggestion": "Remove from git history. Use a PKI or secrets manager for certificate storage.",
    },
    {
        "pattern": re.compile(r"(?:^|/)(?:secrets|credentials)\.(?:json|yaml|yml)$", re.IGNORECASE),
        "rule_id": "sensitive-file-secrets-json",
        "severity": "critical",
        "description": "Secrets or credentials file committed to repository.",
        "suggestion": "Remove from git history with git-filter-repo. Audit all exposed credentials.",
    },
    {
        "pattern": re.compile(r"(?:^|/)service[_\-]?account.*\.json$", re.IGNORECASE),
        "rule_id": "sensitive-file-gcp-sa",
        "severity": "critical",
        "description": "GCP Service Account key file committed to repository.",
        "suggestion": "Delete the key in GCP IAM. Remove from git history. Use Workload Identity.",
    },
    {
        "pattern": re.compile(r"(?:^|/)kubeconfig$|kube[_\-]?config\.(?:yaml|yml)$", re.IGNORECASE),
        "rule_id": "sensitive-file-kubeconfig",
        "severity": "critical",
        "description": "Kubernetes kubeconfig file committed — contains cluster credentials.",
        "suggestion": "Remove from history. Rotate cluster credentials. Use KUBECONFIG env var.",
    },
    {
        "pattern": re.compile(r"terraform\.tfstate(?:\.backup)?$", re.IGNORECASE),
        "rule_id": "sensitive-file-tfstate",
        "severity": "high",
        "description": "Terraform state file committed — may contain sensitive infrastructure details.",
        "suggestion": "Use remote state backend (S3, GCS, Terraform Cloud) with encryption. Add to .gitignore.",
    },
    {
        "pattern": re.compile(r"\.npmrc$", re.IGNORECASE),
        "rule_id": "sensitive-file-npmrc",
        "severity": "high",
        "description": ".npmrc file committed — may contain npm authentication tokens.",
        "suggestion": "Add .npmrc to .gitignore. Use NPM_TOKEN environment variable in CI.",
    },
    {
        "pattern": re.compile(r"\.pypirc$", re.IGNORECASE),
        "rule_id": "sensitive-file-pypirc",
        "severity": "high",
        "description": ".pypirc file committed — contains PyPI upload credentials.",
        "suggestion": "Add .pypirc to .gitignore. Use TWINE_USERNAME/TWINE_PASSWORD in CI.",
    },
    {
        "pattern": re.compile(r"(?:^|/)\.htpasswd$"),
        "rule_id": "sensitive-file-htpasswd",
        "severity": "high",
        "description": ".htpasswd file committed — contains hashed web authentication passwords.",
        "suggestion": "Remove from repository. Store .htpasswd outside the web root and git repo.",
    },
    {
        "pattern": re.compile(r"(?:^|/)(?:\.netrc|netrc)$"),
        "rule_id": "sensitive-file-netrc",
        "severity": "critical",
        "description": ".netrc file committed — contains FTP/HTTP credentials in plaintext.",
        "suggestion": "Remove immediately from git history. Rotate all credentials listed in it.",
    },
    {
        "pattern": re.compile(r"(?:^|/)(?:p12|pfx)$", re.IGNORECASE),
        "rule_id": "sensitive-file-pkcs12",
        "severity": "critical",
        "description": "PKCS#12 certificate bundle committed — contains private key material.",
        "suggestion": "Remove from git history. Rotate the certificate and key. Use a PKI/KMS.",
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# §5  THE AGENT
# ══════════════════════════════════════════════════════════════════════════════

class SecretsAgent(BaseAgent):
    """
    Secrets Hunter — detects credential leakage across diffs and full repo scans.

    Implements Shannon entropy analysis, placeholder filtering, test-context
    severity downgrading, and 29+ distinct secret type detectors.
    """

    agent_id = "secrets"
    agent_name = "Secrets Hunter"
    specialization = "credential leakage, API keys, tokens, private keys, entropy analysis"

    # ── Public entry point ───────────────────────────────────────────────────

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()

        try:
            is_repo_scan = context.get("analysis_type") == "repo"

            if is_repo_scan:
                findings, positives, insights = self._scan_repo(context)
            else:
                files = context.get("files", [])
                findings, positives, insights = self._scan_diff(files)

            score = self._compute_score(findings)

            # Positive signal: no live creds found
            has_live_creds = any(
                f.severity == "critical" and f.category != "certificate"
                for f in findings
            )
            if not has_live_creds:
                positives.append("No live credentials detected in the analyzed content")

            uses_env_refs = self._all_references_are_env(context)
            if uses_env_refs:
                positives.append("All secrets appear to use environment variable references")

            return self._timed_result(start, AgentResult(
                agent_id=self.agent_id,
                agent_name=self.agent_name,
                score=score,
                confidence=0.91,
                findings=sorted(
                    findings,
                    key=lambda f: {"critical": 0, "high": 1, "medium": 2, "low": 3}.get(f.severity, 4),
                )[:20],
                insights=insights[:6],
                positives=positives[:5],
                metadata={
                    "total_findings": len(findings),
                    "critical_count": sum(1 for f in findings if f.severity == "critical"),
                    "high_count": sum(1 for f in findings if f.severity == "high"),
                    "medium_count": sum(1 for f in findings if f.severity == "medium"),
                    "rules_triggered": list({f.rule_id for f in findings if f.rule_id}),
                },
            ))

        except Exception as exc:  # noqa: BLE001
            return self._degraded_result(start, str(exc))

    # ── Diff scanning ────────────────────────────────────────────────────────

    def _scan_diff(self, files: list[dict]) -> tuple[list[Finding], list[str], list[str]]:
        findings: list[Finding] = []
        positives: list[str] = []
        insights: list[str] = []
        seen: set[str] = set()           # dedup key: (rule_id, file, snippet[:20])

        for file_entry in files:
            filename = file_entry.get("filename", "unknown")
            patch = file_entry.get("patch", "") or ""

            # Check whether the changed file itself is a sensitive file
            for sf_rule in _SENSITIVE_FILE_RULES:
                if sf_rule["pattern"].search(filename):
                    dedup_key = (sf_rule["rule_id"], filename, "file")
                    if dedup_key not in seen:
                        seen.add(dedup_key)
                        sev = sf_rule["severity"]
                        if self._is_test_context(filename):
                            sev = self._downgrade_severity(sev)
                        findings.append(Finding(
                            severity=sev,
                            category="secrets",
                            description=sf_rule["description"],
                            suggestion=sf_rule["suggestion"],
                            file=filename,
                            rule_id=sf_rule["rule_id"],
                            confidence=0.95,
                        ))

            # Extract added lines with line numbers
            added_lines: list[tuple[int, str]] = []
            line_counter = 0
            for raw_line in patch.splitlines():
                if raw_line.startswith("@@"):
                    # Extract the starting line number from the hunk header
                    m = re.search(r"\+(\d+)", raw_line)
                    line_counter = int(m.group(1)) - 1 if m else line_counter
                elif raw_line.startswith("+") and not raw_line.startswith("+++"):
                    line_counter += 1
                    added_lines.append((line_counter, raw_line[1:]))
                elif not raw_line.startswith("-"):
                    line_counter += 1

            if not added_lines:
                continue

            # Joined text for multi-line patterns (like PEM blocks, k8s manifests)
            joined_added = "\n".join(line for _, line in added_lines)

            is_test = self._is_test_context(filename)

            for rule in _SECRET_RULES:
                matches = rule["pattern"].findall(joined_added)
                if not matches:
                    continue

                for raw_match in matches:
                    # If match is a tuple (group captures), take the last non-empty group
                    if isinstance(raw_match, tuple):
                        secret_value = next((g for g in reversed(raw_match) if g), raw_match[0])
                    else:
                        secret_value = raw_match

                    # Skip obvious placeholders
                    if not self._looks_like_real_secret(secret_value):
                        continue

                    # JWT extra validation — make sure it actually decodes to {"alg":...}
                    if rule["rule_id"] == "jwt-token":
                        if not self._validate_jwt_structure(secret_value):
                            continue

                    # Find the line number of the first occurrence
                    line_num = self._find_line_number(added_lines, secret_value)

                    snippet = self._redact_snippet(secret_value)
                    dedup_key = (rule["rule_id"], filename, snippet[:20])
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    sev = rule["severity"]
                    if is_test:
                        sev = self._downgrade_severity(sev)

                    findings.append(Finding(
                        severity=sev,
                        category="secrets",
                        description=rule["description"],
                        suggestion=rule["suggestion"],
                        file=filename,
                        line=line_num,
                        code_snippet=snippet,
                        confidence=self._confidence_for_rule(rule["rule_id"]),
                        rule_id=rule["rule_id"],
                    ))

            # Generic entropy sweep on added lines
            entropy_findings = self._entropy_sweep(added_lines, filename, is_test, seen)
            findings.extend(entropy_findings)

        if not findings:
            positives.append("No secrets or credentials detected in the diff")
        else:
            crit = [f for f in findings if f.severity == "critical"]
            if crit:
                insights.append(
                    f"{len(crit)} CRITICAL credential leak{'s' if len(crit) > 1 else ''} detected — "
                    "immediate rotation required before this code is merged or deployed."
                )
            high = [f for f in findings if f.severity == "high"]
            if high:
                insights.append(
                    f"{len(high)} high-severity secret{'s' if len(high) > 1 else ''} found — "
                    "review and rotate affected credentials."
                )

        return findings, positives, insights

    # ── Repo scanning ────────────────────────────────────────────────────────

    def _scan_repo(self, context: dict) -> tuple[list[Finding], list[str], list[str]]:
        findings: list[Finding] = []
        positives: list[str] = []
        insights: list[str] = []
        seen: set[str] = set()

        file_tree: list[str] = context.get("file_tree", [])
        contents: dict[str, str] = context.get("key_file_contents", {})

        # ── Gitignore checks ────────────────────────────────────────────────
        has_gitignore = self._check_gitignore(file_tree)
        if not has_gitignore:
            findings.append(Finding(
                severity="high",
                category="secrets",
                description="No .gitignore found — sensitive files may be committed accidentally.",
                suggestion="Create a comprehensive .gitignore (use gitignore.io). "
                           "At minimum, exclude: .env, *.pem, *.key, secrets.json, credentials.json.",
                rule_id="missing-gitignore",
                confidence=0.97,
            ))
        else:
            env_excluded = self._check_env_in_gitignore(contents)
            if env_excluded:
                positives.append(".gitignore properly excludes .env files")
            else:
                findings.append(Finding(
                    severity="high",
                    category="secrets",
                    description=".gitignore exists but does not exclude .env files — "
                                "environment files with secrets may be committed.",
                    suggestion="Add the following to .gitignore: .env, .env.local, "
                               ".env.production, .env.staging, .env.*.local",
                    rule_id="gitignore-missing-env",
                    confidence=0.90,
                ))

        # ── Sensitive file presence ─────────────────────────────────────────
        for filename in file_tree:
            for sf_rule in _SENSITIVE_FILE_RULES:
                if sf_rule["pattern"].search(filename):
                    dedup_key = (sf_rule["rule_id"], filename)
                    if dedup_key not in seen:
                        seen.add(dedup_key)
                        findings.append(Finding(
                            severity=sf_rule["severity"],
                            category="secrets",
                            description=sf_rule["description"],
                            suggestion=sf_rule["suggestion"],
                            file=filename,
                            rule_id=sf_rule["rule_id"],
                            confidence=0.95,
                        ))

        # ── Scan key file contents ──────────────────────────────────────────
        for fname, content in contents.items():
            if not content:
                continue

            is_test = self._is_test_context(fname)
            lines: list[tuple[int, str]] = [(i + 1, ln) for i, ln in enumerate(content.splitlines())]
            joined = content

            for rule in _SECRET_RULES:
                matches = rule["pattern"].findall(joined)
                if not matches:
                    continue

                for raw_match in matches:
                    if isinstance(raw_match, tuple):
                        secret_value = next((g for g in reversed(raw_match) if g), raw_match[0])
                    else:
                        secret_value = raw_match

                    if not self._looks_like_real_secret(secret_value):
                        continue

                    if rule["rule_id"] == "jwt-token":
                        if not self._validate_jwt_structure(secret_value):
                            continue

                    line_num = self._find_line_number(lines, secret_value)
                    snippet = self._redact_snippet(secret_value)
                    dedup_key = (rule["rule_id"], fname, snippet[:20])
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)

                    sev = rule["severity"]
                    if is_test:
                        sev = self._downgrade_severity(sev)

                    findings.append(Finding(
                        severity=sev,
                        category="secrets",
                        description=rule["description"],
                        suggestion=rule["suggestion"],
                        file=fname,
                        line=line_num,
                        code_snippet=snippet,
                        confidence=self._confidence_for_rule(rule["rule_id"]),
                        rule_id=rule["rule_id"],
                    ))

            # Entropy sweep on repo file lines
            entropy_findings = self._entropy_sweep(lines, fname, is_test, seen)
            findings.extend(entropy_findings)

        # ── Aggregated insights ─────────────────────────────────────────────
        if not findings:
            positives.append("No credentials or secrets detected in the repository scan")
        else:
            by_category: dict[str, int] = {}
            for f in findings:
                by_category[f.category] = by_category.get(f.category, 0) + 1
            top = sorted(by_category.items(), key=lambda x: -x[1])[:3]
            top_str = ", ".join(f"{cat} ({n})" for cat, n in top)
            insights.append(f"Secret categories detected: {top_str}")

            crit = sum(1 for f in findings if f.severity == "critical")
            if crit:
                insights.append(
                    f"{crit} critical credential leak{'s' if crit > 1 else ''} found in repository — "
                    "each exposed credential must be rotated immediately."
                )

        env_example_present = any(
            f == ".env.example" or f.endswith("/.env.example")
            for f in file_tree
        )
        if env_example_present:
            positives.append("Environment variable template documented (.env.example)")

        return findings, positives, insights

    # ── Entropy sweep ─────────────────────────────────────────────────────────

    # Variable names that suggest a secret is being assigned
    _SECRET_VAR_RE = re.compile(
        r"""(?i)(?:^|['"` ;,({\[])"""
        r"""(password|passwd|secret|api[_\-]?key|auth[_\-]?token|private[_\-]?key|"""
        r"""access[_\-]?(?:key|token)|signing[_\-]?(?:key|secret)|encryption[_\-]?key|"""
        r"""client[_\-]?secret|db[_\-]?pass(?:word)?|bearer[_\-]?token|master[_\-]?key|"""
        r"""root[_\-]?pass|admin[_\-]?pass|service[_\-]?key|webhook[_\-]?secret|"""
        r"""deploy[_\-]?key|session[_\-]?secret|jwt[_\-]?secret|app[_\-]?secret|"""
        r"""connection[_\-]?string|token|passphrase|credential)"""
        r"""\s*[=:]\s*['"` ]+([A-Za-z0-9+/!@#$%^&*()\-_=]{20,})['"` ]+""",
    )

    def _entropy_sweep(
        self,
        lines: list[tuple[int, str]],
        filename: str,
        is_test: bool,
        seen: set[str],
    ) -> list[Finding]:
        """
        Scan lines for generic high-entropy string assignments.
        Targets variable names matching secret-like patterns.
        """
        results: list[Finding] = []

        for line_num, line_text in lines:
            m = self._SECRET_VAR_RE.search(line_text)
            if not m:
                continue
            var_name = m.group(1)
            candidate = m.group(2)

            if not self._looks_like_real_secret(candidate):
                continue

            entropy = self._entropy(candidate)
            if entropy < 4.5:
                continue

            snippet = self._redact_snippet(candidate)
            dedup_key = ("generic-entropy", filename, snippet[:20])
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            sev = "high"
            if is_test:
                sev = self._downgrade_severity(sev)

            results.append(Finding(
                severity=sev,
                category="secrets",
                description=(
                    f"High-entropy string ({entropy:.2f} bits/char) assigned to "
                    f"'{var_name}' — potential hardcoded secret."
                ),
                suggestion=(
                    "Move this value to an environment variable or secrets manager. "
                    "Use a .env file (excluded by .gitignore) for local development."
                ),
                file=filename,
                line=line_num,
                code_snippet=snippet,
                confidence=min(0.50 + (entropy - 4.5) * 0.1, 0.90),
                rule_id="generic-high-entropy",
            ))

        return results

    # ── Utility methods ───────────────────────────────────────────────────────

    @staticmethod
    def _is_test_context(filename: str) -> bool:
        """Return True if the file lives in a test/fixture/mock directory or is a test file."""
        if _TEST_PATH_RE.search(filename):
            return True
        if _TEST_FILENAME_RE.search(filename):
            return True
        if _MOCK_FILENAME_RE.search(filename):
            return True
        return False

    @staticmethod
    def _downgrade_severity(severity: str) -> str:
        """Downgrade severity in test contexts: critical→high, high→medium, others unchanged."""
        return {"critical": "high", "high": "medium"}.get(severity, severity)

    @staticmethod
    def _entropy(s: str) -> float:
        """Shannon entropy in bits per character."""
        if not s:
            return 0.0
        freq: dict[str, int] = {}
        for ch in s:
            freq[ch] = freq.get(ch, 0) + 1
        n = len(s)
        return -sum((count / n) * math.log2(count / n) for count in freq.values())

    @staticmethod
    def _looks_like_real_secret(value: str) -> bool:
        """
        Return True when the value is plausibly a real secret:
          - Not a placeholder, example, or template variable
          - Not an environment variable reference
          - Minimum length 8 chars
          - Has some character diversity (entropy > 1.5)
        """
        if not value or len(value) < 8:
            return False

        # Reject environment variable references
        for env_re in _ENV_REF_PATTERNS:
            if env_re.search(value):
                return False

        # Reject placeholder patterns
        for ph_re in _PLACEHOLDER_PATTERNS:
            if ph_re.search(value):
                return False

        # Must have at least a bit of entropy — pure letter-repeating strings aren't secrets
        if len(set(value)) < 4:
            return False

        return True

    @staticmethod
    def _validate_jwt_structure(token: str) -> bool:
        """
        Return True only if the JWT header base64-decodes to a JSON object with
        an 'alg' key — distinguishing real JWTs from random eyJ… strings.
        """
        try:
            parts = token.split(".")
            if len(parts) < 2:
                return False
            # Add padding
            header_b64 = parts[0] + "=" * (-len(parts[0]) % 4)
            header_bytes = base64.urlsafe_b64decode(header_b64)
            header_json = json.loads(header_bytes.decode("utf-8", errors="replace"))
            return isinstance(header_json, dict) and "alg" in header_json
        except Exception:  # noqa: BLE001
            return False

    @staticmethod
    def _redact_snippet(value: str) -> str:
        """
        Return a partially redacted version of the secret for safe display.
        Shows first 4 and last 2 characters, masks the middle.
        """
        if len(value) <= 8:
            return "***REDACTED***"
        visible_start = min(4, len(value) // 4)
        visible_end = min(2, len(value) // 6)
        return f"{value[:visible_start]}{'*' * (len(value) - visible_start - visible_end)}{value[-visible_end:] if visible_end else ''}"

    @staticmethod
    def _find_line_number(lines: list[tuple[int, str]], value: str) -> int | None:
        """Find the first line number containing the given value fragment."""
        # Search for the first 8 chars of the value to locate the line
        search_fragment = value[:8] if len(value) >= 8 else value
        for line_num, line_text in lines:
            if search_fragment in line_text:
                return line_num
        return None

    @staticmethod
    def _check_gitignore(file_tree: list[str]) -> bool:
        """Return True if a .gitignore file is present in the repository root."""
        return any(
            f == ".gitignore" or f.endswith("/.gitignore")
            for f in file_tree
        )

    @staticmethod
    def _check_env_in_gitignore(contents: dict[str, str]) -> bool:
        """
        Return True if .gitignore content includes a rule that would exclude .env files.
        Checks for common patterns: .env, .env*, *.env, etc.
        """
        gitignore_content = contents.get(".gitignore", "") or ""
        if not gitignore_content:
            return False

        env_patterns = [
            r"^\.env$",
            r"^\.env\.",
            r"^\.env\*",
            r"^\*\.env",
            r"^\.env\.local",
            r"^\.env\.production",
        ]
        for line in gitignore_content.splitlines():
            stripped = line.strip()
            if stripped.startswith("#") or not stripped:
                continue
            for pat in env_patterns:
                if re.match(pat, stripped, re.IGNORECASE):
                    return True
            # Direct match
            if stripped in (".env", ".env.*", "*.env", ".env*"):
                return True
        return False

    @staticmethod
    def _all_references_are_env(context: dict) -> bool:
        """
        Return True when all secret-like assignments in the diff use
        environment variable references rather than literal values.
        Heuristic: at least one env reference present and no literal assignment found.
        """
        files = context.get("files", [])
        if not files:
            return False

        found_env_ref = False
        found_literal = False

        env_ref_re = re.compile(
            r"""(?:process\.env\.|os\.environ|os\.getenv\(|\$[A-Z_][A-Z0-9_]+|\$\{[A-Z_])""",
            re.IGNORECASE,
        )
        literal_assign_re = re.compile(
            r"""(?i)(?:secret|api[_\-]?key|auth[_\-]?token|password|private[_\-]?key)"""
            r"""\s*[=:]\s*['"` ]+[A-Za-z0-9+/!@#$%^&*()\-_=]{16,}['"` ]+""",
        )

        for f in files:
            patch = f.get("patch", "") or ""
            added = "\n".join(
                ln[1:] for ln in patch.splitlines()
                if ln.startswith("+") and not ln.startswith("+++")
            )
            if env_ref_re.search(added):
                found_env_ref = True
            if literal_assign_re.search(added):
                found_literal = True

        return found_env_ref and not found_literal

    def _compute_score(self, findings: list[Finding]) -> int:
        """Compute a 0-100 security score based on finding severity."""
        score = 95
        for f in findings:
            deduction = {"critical": 35, "high": 20, "medium": 8, "low": 3, "info": 1}.get(f.severity, 5)
            score -= deduction
        return self._clamp(score)

    @staticmethod
    def _confidence_for_rule(rule_id: str) -> float:
        """
        Return the confidence level for a given rule.
        Specific token-prefix rules (ghp_, AKIA, etc.) have very high confidence.
        Generic / entropy-based rules have lower confidence.
        """
        high_confidence_rules = {
            "aws-access-key-id", "github-pat-classic", "github-oauth-token",
            "github-app-installation-token", "github-user-to-server-token",
            "github-fine-grained-pat", "google-api-key", "stripe-live-secret-key",
            "stripe-live-restricted-key", "slack-bot-token", "slack-user-token",
            "slack-app-token", "slack-workspace-access-token", "sendgrid-api-key",
            "mailgun-api-key", "npm-access-token", "npmrc-auth-token",
            "pypi-upload-token", "terraform-cloud-token", "shopify-private-app-password",
            "shopify-access-token", "shopify-custom-app-access-token",
            "shopify-partner-api-token", "digitalocean-personal-access-token",
            "okta-ssws-api-token", "rsa-private-key", "ec-private-key",
            "pkcs8-private-key", "openssh-private-key", "pgp-private-key",
            "dsa-private-key",
        }
        medium_confidence_rules = {
            "aws-secret-access-key", "aws-session-token", "azure-storage-connection-string",
            "azure-client-secret", "azure-service-bus-connection-string",
            "gcp-service-account-json", "google-oauth-client-secret",
            "stripe-live-publishable-key", "stripe-webhook-secret",
            "twilio-auth-token", "twilio-api-key", "twilio-account-sid",
            "heroku-api-key", "datadog-api-key", "datadog-app-key",
            "pagerduty-api-key", "cloudflare-api-token", "cloudflare-global-api-key",
            "digitalocean-api-key", "okta-client-secret", "circleci-env-value",
            "postgresql-connection-string", "mysql-connection-string",
            "mongodb-connection-string", "redis-connection-string",
            "mssql-connection-string",
        }
        if rule_id in high_confidence_rules:
            return 0.95
        if rule_id in medium_confidence_rules:
            return 0.82
        return 0.65
