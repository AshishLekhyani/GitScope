"""
Compliance Guardian Agent
==========================
Regulatory compliance analysis covering:
  - GDPR  (General Data Protection Regulation) — EU 2016/679
  - HIPAA (Health Insurance Portability and Accountability Act) — 45 CFR Parts 160/164
  - PCI-DSS (Payment Card Industry Data Security Standard) — v4.0
  - SOC 2  (Service Organization Control 2) — Trust Services Criteria
  - CCPA   (California Consumer Privacy Act) — Cal. Civ. Code § 1798.100

Each framework is scored independently (0-100) and contributes to
the overall compliance score. Findings carry specific article/section
references so developers know exactly which obligation is implicated.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Any

from agents.base import AgentResult, BaseAgent, Finding


# ---------------------------------------------------------------------------
# PII / PHI / PAN detection patterns
# ---------------------------------------------------------------------------

PII_PATTERNS: dict[str, re.Pattern] = {
    # Standard email address
    "email": re.compile(
        r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+",
        re.IGNORECASE,
    ),
    # US Social Security Numbers — 9 digits with common separators
    "ssn": re.compile(
        r"\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b",
    ),
    # North-American phone numbers (also matches international with +country)
    "phone": re.compile(
        r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b",
    ),
    # IPv4 addresses
    "ipv4": re.compile(
        r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b",
    ),
    # Full name patterns adjacent to PII keywords
    "name_field": re.compile(
        r"""(?:full_?name|first_?name|last_?name|patient_?name|user_?name)\s*[=:]\s*["']?[A-Z][a-z]+ [A-Z][a-z]+""",
        re.IGNORECASE,
    ),
    # Passport numbers (rough — country + 7-9 alphanumeric)
    "passport": re.compile(
        r"\b[A-Z]{1,2}[0-9]{6,9}\b",
    ),
    # Medical Record Numbers — common patterns used by EHR systems
    "mrn": re.compile(
        r"\b(?:MRN|mrn|medical[_\-\s]?record)[_\-\s]?(?:number|num|no|#)?\s*[=:#]?\s*[0-9]{5,12}\b",
        re.IGNORECASE,
    ),
    # Date of birth
    "dob": re.compile(
        r"\b(?:dob|date_?of_?birth|birthdate)\s*[=:]\s*[\"']?\d{1,2}[/-]\d{1,2}[/-]\d{2,4}",
        re.IGNORECASE,
    ),
}

# PHI indicator terms (HIPAA 45 CFR § 164.514)
PHI_INDICATORS: frozenset[str] = frozenset({
    "patient", "diagnosis", "prescription", "medication", "treatment",
    "medical_record", "health_record", "clinical", "ehr", "emr",
    "insurance_id", "member_id", "beneficiary", "icd10", "icd_code",
    "cpt_code", "npi", "hipaa", "phi", "protected_health",
    "lab_result", "radiology", "imaging", "pathology",
    "discharge_summary", "admission_date", "dob", "date_of_birth",
    "blood_type", "allergy", "vital_sign", "symptom",
})

# PAN (Primary Account Number) — detects 13-19 digit card numbers with Luhn-checkable shape
PAN_PATTERN: re.Pattern = re.compile(
    r"\b(?:4[0-9]{12}(?:[0-9]{3})?|"          # Visa (13 or 16 digits)
    r"5[1-5][0-9]{14}|"                        # MC classic
    r"2(?:2[2-9][1-9]|[3-6][0-9]{2}|7[01][0-9]|720)[0-9]{12}|"  # MC 2-series
    r"3[47][0-9]{13}|"                         # Amex
    r"3(?:0[0-5]|[68][0-9])[0-9]{11}|"        # Diners
    r"6(?:011|5[0-9]{2})[0-9]{12}|"           # Discover
    r"(?:2131|1800|35\d{3})\d{11})"            # JCB
    r"\b",
)

CVV_PATTERN: re.Pattern = re.compile(
    r"\b(?:cvv|cvc|cvv2|cvc2|security[_\s]?code|card[_\s]?verification)\s*[=:]\s*[\"']?\d{3,4}[\"']?\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Compliance rule definitions
# ---------------------------------------------------------------------------

@dataclass
class ComplianceRule:
    rule_id: str
    framework: str          # GDPR | HIPAA | PCI-DSS | SOC2 | CCPA
    severity: str           # critical | high | medium | low
    description_tpl: str    # may contain {file} placeholder
    suggestion: str
    article: str            # Regulation article / section reference
    pattern: re.Pattern | None = None
    confidence: float = 0.82


COMPLIANCE_RULES: list[ComplianceRule] = [
    # ---- GDPR ----------------------------------------------------------------
    ComplianceRule(
        rule_id="gdpr-pii-in-logs",
        framework="GDPR",
        severity="high",
        description_tpl="PII detected in logging statement in {file}. Logging personal data without consent violates GDPR.",
        suggestion=(
            "Remove PII from log messages. Use pseudonymous identifiers (user IDs) instead of emails/names. "
            "If audit logging is required, use a dedicated compliant audit log system with access controls. "
            "See GDPR Art. 5(1)(f) — integrity and confidentiality principle."
        ),
        article="GDPR Art. 5(1)(f), Art. 32",
        pattern=re.compile(
            r"(?:console\.|logger\.|log\.|print\(|logging\.).*?"
            r"(?:[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}"  # email in log
            r"|\b(?:user|customer|patient)(?:Email|Name|Phone|Address)\b)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="gdpr-cookie-no-consent",
        framework="GDPR",
        severity="high",
        description_tpl="Cookie set in {file} without a detectable consent check. Non-essential cookies require prior consent under GDPR.",
        suggestion=(
            "Wrap all non-essential cookie writes inside a consent check: "
            "`if (hasConsent('analytics')) { setCookie(...) }`. "
            "Implement a consent management platform (CMP) and honour opt-out signals. "
            "See GDPR Art. 7, Recital 32 and ePrivacy Directive."
        ),
        article="GDPR Art. 6(1)(a), Art. 7; ePrivacy Directive Art. 5(3)",
        pattern=re.compile(
            r"(?:document\.cookie\s*=|setCookie\s*\(|cookies\.set\s*\(|res\.cookie\s*\()"
            r"(?![\s\S]{0,200}?(?:consent|gdpr|cookieConsent|hasConsent|cookiePolicy))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="gdpr-no-ttl-pii",
        framework="GDPR",
        severity="medium",
        description_tpl="PII stored in {file} without an expiry/TTL signal. GDPR requires data minimisation and storage limitation.",
        suggestion=(
            "Add explicit TTL to all PII storage: Redis `SET key value EX 86400`, "
            "database records with `expires_at` columns, or automated purge jobs. "
            "Document your data retention periods in a Data Retention Policy. "
            "See GDPR Art. 5(1)(e) — storage limitation principle."
        ),
        article="GDPR Art. 5(1)(e)",
        pattern=re.compile(
            r"(?:redis|cache|store|set)\s*\(.*?"
            r"(?:email|phone|address|fullName|firstName|lastName)"
            r"(?![\s\S]{0,100}?(?:ttl|expire|expiry|EX\s+\d|maxAge))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="gdpr-pii-in-url",
        framework="GDPR",
        severity="high",
        description_tpl="Personal data embedded in a URL in {file}. URLs are logged by servers, proxies, and browsers — exposing PII widely.",
        suggestion=(
            "Never embed PII in URL paths or query parameters. Use POST body or "
            "server-side session references instead. For email verification, use "
            "short-lived opaque tokens, not the email itself. "
            "See GDPR Art. 5(1)(f) and Art. 32."
        ),
        article="GDPR Art. 5(1)(f), Art. 32",
        pattern=re.compile(
            r"""(?:fetch|axios|get|post|redirect|router\.push|window\.location)\s*\(?\s*[`"'].*?"""
            r"""(?:\?|&)(?:email|name|phone|ssn|address)\s*=(?:[^`"'&\s]{1,120})""",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="gdpr-missing-erasure-endpoint",
        framework="GDPR",
        severity="medium",
        description_tpl="No right-to-erasure endpoint detected in {file}. GDPR Art. 17 mandates a mechanism for users to request data deletion.",
        suggestion=(
            "Implement a DELETE /api/account or POST /api/gdpr/erase endpoint that "
            "removes all user data across primary DB, caches, analytics, backups, "
            "and third-party processors. Log erasure requests for compliance audits. "
            "See GDPR Art. 17 — Right to Erasure ('Right to be Forgotten')."
        ),
        article="GDPR Art. 17",
        confidence=0.70,  # Structural check — lower confidence for file-level
    ),
    ComplianceRule(
        rule_id="gdpr-analytics-no-consent",
        framework="GDPR",
        severity="high",
        description_tpl="Third-party analytics initialised in {file} without a detectable consent gate. Analytics scripts that set cookies require opt-in consent.",
        suggestion=(
            "Load analytics scripts only after explicit user consent: "
            "`if (consent.analytics) { loadGtag(); }`. "
            "Use consent mode (Google Consent Mode v2) or server-side analytics "
            "that do not rely on cookies as an alternative. "
            "See GDPR Art. 6(1)(a), Art. 7 and ePrivacy Directive."
        ),
        article="GDPR Art. 6(1)(a), Art. 7",
        pattern=re.compile(
            r"(?:gtag\s*\(|GA4|google-analytics|googletagmanager|mixpanel\.init|"
            r"amplitude\.init|segment\.load|heap\.load|hotjar\.init|posthog\.init)"
            r"(?![\s\S]{0,400}?(?:consent|gdprConsent|cookieConsent|hasConsent|consentGiven))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="gdpr-unencrypted-pii-at-rest",
        framework="GDPR",
        severity="high",
        description_tpl="PII field stored in plaintext in {file}. Storing personal data without encryption violates GDPR's security principle.",
        suggestion=(
            "Encrypt sensitive fields at rest using AES-256-GCM or equivalent. "
            "For databases: use column-level encryption (Prisma Encryption, pgcrypto) "
            "or database-level TDE. Consider hashing emails for lookups with bcrypt/argon2. "
            "See GDPR Art. 32(1)(a) — pseudonymisation and encryption of personal data."
        ),
        article="GDPR Art. 32(1)(a)",
        pattern=re.compile(
            r"(?:email|phone|address|full_?name|national_?id)\s*:\s*(?:String|Text|VARCHAR|string)\b"
            r"(?![\s\S]{0,200}?(?:encrypt|hash|bcrypt|argon|cipher|aes|pgcrypto))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="gdpr-cross-border-transfer",
        framework="GDPR",
        severity="medium",
        description_tpl="API call to a non-EU service with apparent PII in {file}. Cross-border data transfers require a legal mechanism.",
        suggestion=(
            "Ensure cross-border data transfers rely on an approved mechanism: "
            "SCCs (Standard Contractual Clauses), adequacy decision, or Binding Corporate Rules. "
            "Document the transfer in your Records of Processing Activities (RoPA). "
            "See GDPR Art. 44-49 — transfers of personal data to third countries."
        ),
        article="GDPR Art. 44-49",
        pattern=re.compile(
            r"(?:fetch|axios\.get|axios\.post|http\.request)\s*\(.*?"
            r"(?:amazonaws\.com|azure\.com|salesforce\.com|sendgrid\.net|twilio\.com)"
            r"[\s\S]{0,200}?"
            r"(?:email|phone|name|address|personalData)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),

    # ---- HIPAA ---------------------------------------------------------------
    ComplianceRule(
        rule_id="hipaa-phi-in-logs",
        framework="HIPAA",
        severity="critical",
        description_tpl="Potential PHI detected in a logging call in {file}. Logging PHI without safeguards violates HIPAA Security Rule.",
        suggestion=(
            "Never log PHI — not even in DEBUG mode. Implement field-level redaction "
            "in your logger: `logger.phi_safe(record, redact=['diagnosis', 'mrn', 'dob'])`. "
            "Audit your logging configuration and add a CI gate that fails on PHI in logs. "
            "See HIPAA Security Rule 45 CFR § 164.312(b) — Audit Controls."
        ),
        article="HIPAA 45 CFR § 164.312(b)",
        pattern=re.compile(
            r"(?:console\.|logger\.|log\.|print\(|logging\.)"
            r"[\s\S]{0,80}?"
            r"(?:patient|diagnosis|prescription|medication|treatment|mrn|"
            r"medical_record|health_record|dob|date_of_birth|ssn)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="hipaa-missing-audit-trail",
        framework="HIPAA",
        severity="high",
        description_tpl="PHI accessed in {file} without detectable audit logging. HIPAA requires audit controls for all PHI access.",
        suggestion=(
            "Instrument every PHI read and write with an immutable audit log entry: "
            "{ timestamp, userId, action, resourceType, resourceId, ip }. "
            "Store audit logs separately from application logs with write-once semantics. "
            "See HIPAA Security Rule 45 CFR § 164.312(b) — Audit Controls and "
            "§ 164.308(a)(1)(ii)(D) — Information System Activity Review."
        ),
        article="HIPAA 45 CFR § 164.312(b), § 164.308(a)(1)(ii)(D)",
        pattern=re.compile(
            r"(?:findUnique|findOne|findAll|select|query|GET)\s*[\s\S]{0,120}?"
            r"(?:patient|medicalRecord|healthRecord|prescription|diagnosis)"
            r"(?![\s\S]{0,200}?(?:auditLog|audit_log|accessLog|hipaa_log|logAccess))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="hipaa-unencrypted-phi-transmission",
        framework="HIPAA",
        severity="critical",
        description_tpl="PHI may be transmitted over insecure HTTP in {file}. HIPAA requires encryption in transit for all ePHI.",
        suggestion=(
            "Replace all http:// PHI endpoints with https://. Enforce TLS 1.2+ with "
            "strong cipher suites (ECDHE, AES-256-GCM). Add HSTS headers. "
            "Consider mTLS for service-to-service PHI transfers. "
            "See HIPAA Security Rule 45 CFR § 164.312(e)(1) — Transmission Security."
        ),
        article="HIPAA 45 CFR § 164.312(e)(1)",
        pattern=re.compile(
            r"http://[^\s\"'`]+"
            r"(?![\s\S]{0,80}?(?:localhost|127\.0\.0\.1|0\.0\.0\.0))"
            r"[\s\S]{0,200}?"
            r"(?:patient|phi|health|medical|diagnosis|prescription)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="hipaa-phi-in-error-response",
        framework="HIPAA",
        severity="high",
        description_tpl="PHI may be exposed in an error response in {file}. PHI in client-visible errors violates HIPAA minimum necessary standard.",
        suggestion=(
            "Catch all errors that involve PHI and return a sanitised generic message: "
            "`{ error: 'Record not found' }` — never include the actual PHI. "
            "Log the full error server-side to an access-controlled audit log. "
            "See HIPAA 45 CFR § 164.514(d) — Minimum Necessary Standard."
        ),
        article="HIPAA 45 CFR § 164.514(d)",
        pattern=re.compile(
            r"(?:res\.(?:json|send|status)\s*\(|throw\s+new\s+Error\s*\(|return\s+\{)"
            r"[\s\S]{0,120}?"
            r"(?:patient|diagnosis|mrn|medication|dob|ssn|health_record)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="hipaa-hardcoded-patient-id",
        framework="HIPAA",
        severity="high",
        description_tpl="Hardcoded patient ID or MRN detected in {file}. Hardcoded PHI identifiers are a HIPAA violation and a security risk.",
        suggestion=(
            "Remove all hardcoded patient identifiers from source code. "
            "Use environment variables or test fixture factories that generate "
            "synthetic data (e.g. Faker). Never commit real PHI to version control. "
            "See HIPAA 45 CFR § 164.514(b) — De-identification of PHI."
        ),
        article="HIPAA 45 CFR § 164.514(b)",
        pattern=re.compile(
            r"""(?:patient_id|patientId|mrn|medical_record_number)\s*[=:]\s*["\']?[0-9]{5,12}["\']?""",
            re.IGNORECASE,
        ),
    ),
    ComplianceRule(
        rule_id="hipaa-missing-session-timeout",
        framework="HIPAA",
        severity="medium",
        description_tpl="No session timeout configuration detected in {file}. HIPAA requires automatic logoff for health applications.",
        suggestion=(
            "Implement automatic session timeout (≤ 15 minutes idle for clinical apps). "
            "In Next.js/Auth.js: `maxAge: 900` in session config. "
            "Add client-side idle detection that calls `signOut()` after inactivity. "
            "See HIPAA Security Rule 45 CFR § 164.312(a)(2)(iii) — Automatic Logoff."
        ),
        article="HIPAA 45 CFR § 164.312(a)(2)(iii)",
        confidence=0.68,
    ),
    ComplianceRule(
        rule_id="hipaa-phi-in-analytics",
        framework="HIPAA",
        severity="critical",
        description_tpl="PHI may be sent to analytics/telemetry in {file}. Sharing PHI with analytics vendors requires a signed BAA.",
        suggestion=(
            "Scrub all PHI before sending analytics events. Never pass patient IDs, "
            "diagnoses, or MRNs as analytics properties. If your analytics vendor "
            "processes PHI, obtain a signed Business Associate Agreement (BAA). "
            "Consider self-hosted analytics (Plausible, Matomo) for health apps. "
            "See HIPAA 45 CFR § 164.308(b) — Business Associate Contracts."
        ),
        article="HIPAA 45 CFR § 164.308(b)",
        pattern=re.compile(
            r"(?:track|identify|capture|analytics\.|posthog\.|mixpanel\.|segment\.)"
            r"[\s\S]{0,120}?"
            r"(?:patient|diagnosis|medication|mrn|dob|health)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),

    # ---- PCI-DSS -------------------------------------------------------------
    ComplianceRule(
        rule_id="pci-pan-in-logs",
        framework="PCI-DSS",
        severity="critical",
        description_tpl="Potential credit card number (PAN) detected in a logging statement in {file}. Logging PANs violates PCI-DSS.",
        suggestion=(
            "Never log PANs — even masked. Remove card number from all log calls. "
            "Implement a log scrubber that detects and redacts card patterns before write. "
            "Use tokenization: store the token, never the PAN. "
            "See PCI-DSS v4.0 Requirement 3.3.1 — SAD must not be retained after auth."
        ),
        article="PCI-DSS v4.0 Req. 3.3.1, Req. 10.3.3",
        pattern=re.compile(
            r"(?:console\.|logger\.|log\.|print\(|logging\.)"
            r"[\s\S]{0,200}?"
            r"(?:cardNumber|card_number|pan|creditCard|credit_card|ccNumber|cc_num)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="pci-cvv-stored",
        framework="PCI-DSS",
        severity="critical",
        description_tpl="CVV/CVC storage or persistence detected in {file}. Storing CVV after authorisation is strictly prohibited by PCI-DSS.",
        suggestion=(
            "Delete CVV immediately after the authorisation transaction — never persist it. "
            "Remove CVV from any database schema, cache, or log. "
            "If you need to re-use card details, use your payment processor's vault/token "
            "(Stripe PaymentMethod, Braintree Vault) — never your own storage. "
            "See PCI-DSS v4.0 Requirement 3.3.2 — SAD must not be stored after auth."
        ),
        article="PCI-DSS v4.0 Req. 3.3.2",
        pattern=re.compile(
            r"(?:cvv|cvc|cvv2|cvc2|security_code|card_verification)\s*[=:]\s*[\"']?\d{3,4}[\"']?"
            r"|(?:save|store|insert|create|set)\s*[\s\S]{0,80}?"
            r"(?:cvv|cvc|securityCode|security_code|cardVerification)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="pci-card-in-localstorage",
        framework="PCI-DSS",
        severity="critical",
        description_tpl="Card data written to localStorage or sessionStorage in {file}. Browser storage is accessible to XSS and violates PCI-DSS.",
        suggestion=(
            "Never store card data in client-side storage. Use your payment processor's "
            "secure JS SDK (Stripe Elements, Braintree Hosted Fields) which keeps card "
            "data in an isolated iframe and never touches your DOM or storage. "
            "See PCI-DSS v4.0 Requirement 4.2.1 and Requirement 6.4.3."
        ),
        article="PCI-DSS v4.0 Req. 4.2.1, Req. 6.4.3",
        pattern=re.compile(
            r"(?:localStorage|sessionStorage)\.setItem\s*\(.*?"
            r"(?:card|pan|cvv|creditCard|cardNumber|payment)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="pci-card-in-url",
        framework="PCI-DSS",
        severity="critical",
        description_tpl="Card number or CVV embedded in a URL in {file}. URLs are logged in server access logs, proxies, and browser history.",
        suggestion=(
            "Never transmit card data in GET query parameters or URL paths. "
            "Use POST with a TLS-encrypted body. Implement a payment tokenization flow "
            "so that raw card data never reaches your servers. "
            "See PCI-DSS v4.0 Requirement 4.2.1."
        ),
        article="PCI-DSS v4.0 Req. 4.2.1",
        pattern=re.compile(
            r"""[`"'].*?(?:\?|&)(?:card|pan|cvv|ccn|credit_card)\s*=.*?[`"']""",
            re.IGNORECASE,
        ),
    ),
    ComplianceRule(
        rule_id="pci-missing-tokenization",
        framework="PCI-DSS",
        severity="high",
        description_tpl="Raw card number passed through application logic in {file}. PCI-DSS strongly recommends tokenization to reduce PCI scope.",
        suggestion=(
            "Tokenize card numbers at the point of entry using your payment processor's SDK. "
            "Replace `cardNumber` parameters with `paymentMethodToken` or `paymentMethodId`. "
            "Tokenization removes raw PANs from your environment, drastically reducing PCI scope. "
            "See PCI-DSS v4.0 Requirement 3.5 — Protection of stored account data."
        ),
        article="PCI-DSS v4.0 Req. 3.5",
        pattern=re.compile(
            r"(?:function|const|let|var|def)\s+\w*[Pp]ay\w*\s*\([^)]*"
            r"(?:cardNumber|card_number|pan|creditCard)\b",
            re.IGNORECASE,
        ),
    ),
    ComplianceRule(
        rule_id="pci-weak-tls",
        framework="PCI-DSS",
        severity="high",
        description_tpl="Weak or deprecated TLS/SSL version configured in {file}. PCI-DSS v4.0 requires TLS 1.2+ for all cardholder data environments.",
        suggestion=(
            "Remove SSLv2, SSLv3, TLSv1.0, and TLSv1.1 from your configuration. "
            "Enforce a minimum of TLS 1.2 with strong cipher suites (ECDHE + AES-GCM). "
            "Prefer TLS 1.3 where possible. Use tools like `testssl.sh` or "
            "Qualys SSL Labs to audit your TLS configuration. "
            "See PCI-DSS v4.0 Requirement 4.2.1 — Strong cryptography for data in transit."
        ),
        article="PCI-DSS v4.0 Req. 4.2.1",
        pattern=re.compile(
            r"(?:SSLv2|SSLv3|TLSv1\.0|TLSv1_0|ssl_version\s*=\s*['\"]TLSv1['\"]"
            r"|minVersion\s*:\s*['\"]TLSv1(?:\.[01])?['\"])",
            re.IGNORECASE,
        ),
    ),
    ComplianceRule(
        rule_id="pci-hardcoded-pan",
        framework="PCI-DSS",
        severity="critical",
        description_tpl="Hardcoded credit card number (PAN) detected in {file}. PANs must never appear in source code.",
        suggestion=(
            "Remove the hardcoded card number immediately. Rotate any cards that may "
            "have been exposed in version control history (`git filter-repo`). "
            "For testing, use your payment processor's official test card numbers "
            "(e.g. Stripe test cards: 4242 4242 4242 4242) — never real PANs. "
            "See PCI-DSS v4.0 Requirement 3.3.1."
        ),
        article="PCI-DSS v4.0 Req. 3.3.1",
    ),

    # ---- SOC 2 ---------------------------------------------------------------
    ComplianceRule(
        rule_id="soc2-missing-auth-check",
        framework="SOC2",
        severity="high",
        description_tpl="Sensitive endpoint in {file} appears to lack an authentication guard. SOC 2 CC6.1 requires logical access controls.",
        suggestion=(
            "Add authentication middleware to all sensitive routes: "
            "`export { authMiddleware as middleware }` in Next.js, or `requireAuth()` "
            "guard on Express/Fastify routes. Return 401 for unauthenticated requests. "
            "See SOC 2 Trust Services Criteria CC6.1 — Logical access security."
        ),
        article="SOC 2 CC6.1",
        pattern=re.compile(
            r"(?:router\.|app\.)(?:get|post|put|delete|patch)\s*\("
            r"['\"`][^'\"`,]*(?:admin|internal|manage|delete|export|download|report)[^'\"`,]*['\"`]"
            r"(?![\s\S]{0,300}?(?:auth|authenticate|requireAuth|getSession|verifyToken|middleware))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="soc2-no-access-logging",
        framework="SOC2",
        severity="medium",
        description_tpl="No access logging detected for sensitive operation in {file}. SOC 2 CC7.2 requires monitoring of system access.",
        suggestion=(
            "Log all access to sensitive resources: user ID, action, resource, IP, timestamp. "
            "Use structured logging (JSON) and ship logs to a SIEM or immutable log store. "
            "Set up alerts for anomalous access patterns. "
            "See SOC 2 CC7.2 — The entity monitors system components for anomalies."
        ),
        article="SOC 2 CC7.2, CC6.8",
        pattern=re.compile(
            r"(?:delete|deleteMany|DROP TABLE|TRUNCATE|removeUser|banUser|revokeAccess)"
            r"(?![\s\S]{0,200}?(?:auditLog|audit_log|accessLog|logger\.|log\.))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="soc2-missing-input-validation",
        framework="SOC2",
        severity="medium",
        description_tpl="Public endpoint in {file} handles input without detectable validation schema. SOC 2 CC6.6 requires input validation.",
        suggestion=(
            "Validate all incoming data with a schema library before processing: "
            "Zod, Joi, Yup, or class-validator. Reject unexpected fields. "
            "This prevents injection attacks and enforces data integrity contracts. "
            "See SOC 2 CC6.6 — Logical and physical access restriction."
        ),
        article="SOC 2 CC6.6",
        pattern=re.compile(
            r"req\.body\s*\.\s*\w+|request\.json\s*\(\s*\)"
            r"(?![\s\S]{0,300}?(?:\.parse\s*\(|\.validate\s*\(|\.safeParse\s*\(|Joi\.|z\.))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="soc2-sensitive-data-unclassified",
        framework="SOC2",
        severity="low",
        description_tpl="Sensitive data field in {file} lacks a classification comment or annotation. SOC 2 CC9.2 recommends data classification.",
        suggestion=(
            "Add data classification annotations to sensitive fields in your schema: "
            "// @sensitivity: PII, // @sensitivity: confidential. "
            "Document your data classification policy and train engineers on it. "
            "See SOC 2 CC9.2 — Risk mitigation activities."
        ),
        article="SOC 2 CC9.2",
        pattern=re.compile(
            r"(?:ssn|taxId|bankAccount|salary|compensation|creditScore|backgroundCheck)"
            r"(?![\s\S]{0,100}?(?:@sensitivity|@pii|@confidential|@classified|// sensitive))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),

    # ---- CCPA ----------------------------------------------------------------
    ComplianceRule(
        rule_id="ccpa-missing-opt-out",
        framework="CCPA",
        severity="high",
        description_tpl="Data collection in {file} without a detectable opt-out signal. CCPA grants California residents the right to opt out of data sale.",
        suggestion=(
            "Implement a 'Do Not Sell or Share My Personal Information' mechanism. "
            "Check for Global Privacy Control (GPC) signals in request headers: "
            "`Sec-GPC: 1`. Honour opt-out before any data sharing with third parties. "
            "See CCPA Cal. Civ. Code § 1798.120 — Right to opt-out."
        ),
        article="CCPA § 1798.120",
        pattern=re.compile(
            r"(?:sell|share|transfer)\s*[\s\S]{0,80}?(?:userData|user_data|personalInfo|personal_info|userProfile)"
            r"(?![\s\S]{0,200}?(?:optOut|opt_out|doNotSell|gpc|globalPrivacyControl|ccpaConsent))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    ComplianceRule(
        rule_id="ccpa-data-sale-no-disclosure",
        framework="CCPA",
        severity="medium",
        description_tpl="Data monetization or sharing with third-party detected in {file} without disclosure signals. CCPA requires disclosure of data selling.",
        suggestion=(
            "If you sell or share personal data for cross-context behavioral advertising, "
            "you must disclose this in your Privacy Policy and provide opt-out. "
            "Add disclosure: `// CCPA: data shared with third-party for advertising`. "
            "See CCPA Cal. Civ. Code § 1798.100, § 1798.115."
        ),
        article="CCPA § 1798.100, § 1798.115",
        pattern=re.compile(
            r"(?:thirdParty|third_party|advertis|monetiz)"
            r"[\s\S]{0,80}?"
            r"(?:user|customer|visitor|lead)"
            r"(?![\s\S]{0,200}?(?:ccpa|disclosure|privacy_policy|doNotSell|opt.?out))",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
]


# ---------------------------------------------------------------------------
# Per-framework scoring weights
# ---------------------------------------------------------------------------

FRAMEWORK_DEDUCTIONS: dict[str, dict[str, int]] = {
    "GDPR":    {"critical": 30, "high": 18, "medium": 10, "low": 4},
    "HIPAA":   {"critical": 35, "high": 22, "medium": 12, "low": 5},
    "PCI-DSS": {"critical": 40, "high": 25, "medium": 14, "low": 6},
    "SOC2":    {"critical": 28, "high": 16, "medium": 9,  "low": 3},
    "CCPA":    {"critical": 25, "high": 14, "medium": 8,  "low": 3},
}

FRAMEWORK_BASELINES: dict[str, int] = {
    "GDPR":    90,
    "HIPAA":   95,  # Higher baseline — HIPAA is stricter
    "PCI-DSS": 95,  # PCI is the strictest
    "SOC2":    85,
    "CCPA":    88,
}

GRADE_THRESHOLDS = [
    (90, "A"),
    (80, "B"),
    (70, "C"),
    (60, "D"),
    (0,  "F"),
]


def _compliance_grade(score: int) -> str:
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return "F"


def _luhn_check(digits: str) -> bool:
    """Validate a digit string with the Luhn algorithm."""
    total = 0
    reverse = digits[::-1]
    for i, ch in enumerate(reverse):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _is_test_file(filename: str) -> bool:
    """Heuristic: does this path belong to a test / fixture context?"""
    lower = filename.lower()
    return any(seg in lower for seg in (
        ".test.", ".spec.", "_test.", "/__tests__/", "/test/", "/tests/",
        "/fixtures/", "/mocks/", "/stubs/", "/__mocks__/",
    ))


def _has_phi_context(content: str) -> bool:
    """Return True if the content contains PHI indicator terms."""
    lower = content.lower()
    return any(term in lower for term in PHI_INDICATORS)


# ---------------------------------------------------------------------------
# The Agent
# ---------------------------------------------------------------------------

class ComplianceAgent(BaseAgent):
    """
    Regulatory compliance agent — checks code for GDPR, HIPAA, PCI-DSS,
    SOC 2, and CCPA violations and produces per-framework compliance scores.
    """

    agent_id = "compliance"
    agent_name = "Compliance Guardian"
    specialization = (
        "GDPR Art. 5/32, HIPAA 45 CFR § 164, PCI-DSS v4.0, SOC 2 TSC, CCPA § 1798"
    )

    async def run(self, context: dict[str, Any]) -> AgentResult:
        start = time.perf_counter()

        try:
            is_repo = context.get("analysis_type") == "repo"
            if is_repo:
                findings, positives, metadata = self._scan_repo(context)
            else:
                findings, positives, metadata = self._scan_diff(context)

            framework_scores = self._compute_framework_scores(findings)
            overall_score = self._compute_overall_score(framework_scores)
            insights = self._build_insights(findings, framework_scores, overall_score)

            metadata["framework_scores"] = framework_scores
            metadata["framework_grades"] = {
                fw: _compliance_grade(sc) for fw, sc in framework_scores.items()
            }

            # Sort: critical first, then by framework alphabetically
            sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
            sorted_findings = sorted(
                findings,
                key=lambda f: (sev_order.get(f.severity, 5), f.category),
            )

            return self._timed_result(start, AgentResult(
                agent_id=self.agent_id,
                agent_name=self.agent_name,
                score=overall_score,
                confidence=0.83,
                findings=sorted_findings[:12],
                insights=insights,
                positives=positives[:5],
                metadata=metadata,
            ))

        except Exception as exc:
            return self._degraded_result(start, str(exc))

    # ------------------------------------------------------------------
    # Diff-mode scanning (PR analysis)
    # ------------------------------------------------------------------

    def _scan_diff(
        self, context: dict[str, Any]
    ) -> tuple[list[Finding], list[str], dict]:
        files = context.get("files", [])
        findings: list[Finding] = []
        positives: list[str] = []

        for file in files:
            filename = file.get("filename", "unknown")
            patch = file.get("patch", "") or ""
            added_lines = [
                line[1:]
                for line in patch.splitlines()
                if line.startswith("+") and not line.startswith("+++")
            ]
            if not added_lines:
                continue

            added_code = "\n".join(added_lines)
            is_test = _is_test_file(filename)

            findings.extend(
                self._check_rules(added_code, filename, is_test)
            )
            findings.extend(
                self._check_pan_in_code(added_code, filename, is_test)
            )
            findings.extend(
                self._check_pii_patterns(added_code, filename, is_test)
            )

        # Structural checks across all changed files
        file_names = [f.get("filename", "") for f in files]
        findings.extend(self._structural_checks_diff(file_names, context))

        # Positives
        if any(
            "consent" in (f.get("patch", "") or "").lower() for f in files
        ):
            positives.append("Consent handling code detected in the diff")
        if any("encrypt" in (f.get("patch", "") or "").lower() for f in files):
            positives.append("Encryption usage detected in the changes")
        if any("auditLog" in (f.get("patch", "") or "") for f in files):
            positives.append("Audit logging present in the modified code")

        return findings, positives, {}

    def _check_rules(
        self, code: str, filename: str, is_test: bool
    ) -> list[Finding]:
        results: list[Finding] = []
        seen: set[str] = set()

        for rule in COMPLIANCE_RULES:
            if rule.pattern is None:
                continue
            if rule.rule_id in seen:
                continue

            match = self._safe_run_sync(
                re.search, rule.pattern, code, fallback=None
            )
            if not match:
                continue

            seen.add(rule.rule_id)
            snippet = code[max(0, match.start() - 20): match.end() + 40].strip()[:120]
            severity = rule.severity

            # Downgrade severity for test files
            if is_test:
                severity = self._downgrade_severity(severity)

            confidence = rule.confidence
            if is_test:
                confidence = max(0.40, confidence - 0.25)

            results.append(Finding(
                severity=severity,
                category=f"compliance:{rule.framework.lower()}",
                description=rule.description_tpl.format(file=filename.split("/")[-1]),
                suggestion=rule.suggestion,
                file=filename,
                code_snippet=snippet or None,
                confidence=confidence,
                rule_id=rule.rule_id,
                cve_id=None,
            ))

        return results

    def _check_pan_in_code(
        self, code: str, filename: str, is_test: bool
    ) -> list[Finding]:
        """Detect Luhn-valid PANs in code (hardcoded card numbers)."""
        results: list[Finding] = []
        for match in PAN_PATTERN.finditer(code):
            digits = re.sub(r"[\s\-]", "", match.group())
            if not _luhn_check(digits):
                continue  # Not a valid card number — skip
            severity = "critical" if not is_test else "medium"
            results.append(Finding(
                severity=severity,
                category="compliance:pci-dss",
                description=(
                    f"Luhn-valid credit card number (PAN) detected in "
                    f"{filename.split('/')[-1]}. PANs must never appear in source code."
                ),
                suggestion=(
                    "Remove the card number immediately. Use your payment processor's "
                    "official test cards (Stripe: 4242 4242 4242 4242 — not real PANs). "
                    "Purge the number from git history using `git filter-repo`. "
                    "See PCI-DSS v4.0 Req. 3.3.1."
                ),
                file=filename,
                code_snippet=match.group()[:30] + "...",
                confidence=0.92,
                rule_id="pci-hardcoded-pan",
            ))
        return results

    def _check_pii_patterns(
        self, code: str, filename: str, is_test: bool
    ) -> list[Finding]:
        """
        Detect PII in contexts that suggest exposure: logging, URLs, error messages.
        We only flag when PII is adjacent to a risky context to reduce noise.
        """
        results: list[Finding] = []

        # Check for SSNs anywhere in non-test code
        ssn_matches = self._safe_run_sync(
            re.findall, PII_PATTERNS["ssn"], code, fallback=[]
        )
        if ssn_matches and not is_test:
            results.append(Finding(
                severity="high",
                category="compliance:gdpr",
                description=(
                    f"Social Security Number (SSN) pattern detected in "
                    f"{filename.split('/')[-1]}. SSNs are sensitive PII requiring "
                    "strict controls under GDPR, CCPA, and US state laws."
                ),
                suggestion=(
                    "Remove SSNs from source code. Never store raw SSNs — use "
                    "tokenized references. Encrypt SSNs at rest with AES-256. "
                    "Mask SSNs in any UI display (***-**-1234). "
                    "See GDPR Art. 9 — Special categories of personal data."
                ),
                file=filename,
                code_snippet=str(ssn_matches[0])[:20] + "...",
                confidence=0.88,
                rule_id="gdpr-ssn-exposure",
            ))

        # Check for MRNs outside test fixtures
        mrn_matches = self._safe_run_sync(
            re.findall, PII_PATTERNS["mrn"], code, fallback=[]
        )
        if mrn_matches and not is_test:
            results.append(Finding(
                severity="critical",
                category="compliance:hipaa",
                description=(
                    f"Medical Record Number (MRN) pattern detected in "
                    f"{filename.split('/')[-1]}. MRNs are HIPAA identifiers under "
                    "the Safe Harbor de-identification standard."
                ),
                suggestion=(
                    "Replace real MRNs with synthetic test data (Faker, Synthea). "
                    "In production, use tokenized references — never store raw MRNs "
                    "in code or logs. See HIPAA 45 CFR § 164.514(b) — Safe Harbor "
                    "de-identification (18 identifiers must be removed)."
                ),
                file=filename,
                code_snippet=str(mrn_matches[0])[:40],
                confidence=0.85,
                rule_id="hipaa-mrn-in-code",
            ))

        return results

    def _structural_checks_diff(
        self, file_names: list[str], context: dict[str, Any]
    ) -> list[Finding]:
        """Checks that look at the set of changed files rather than content."""
        findings: list[Finding] = []

        # GDPR: right-to-erasure — warn if processing user account routes without delete
        has_account_routes = any(
            "account" in f.lower() or "user" in f.lower() for f in file_names
        )
        has_delete_route = any(
            "delete" in f.lower() or "erase" in f.lower() or "gdpr" in f.lower()
            for f in file_names
        )
        if has_account_routes and not has_delete_route:
            findings.append(Finding(
                severity="medium",
                category="compliance:gdpr",
                description=(
                    "Account/user route changes detected but no right-to-erasure "
                    "endpoint (DELETE /account, POST /gdpr/erase) found in the diff."
                ),
                suggestion=(
                    "Ensure your application exposes a data deletion endpoint and "
                    "that it cascades deletion across all data stores (DB, cache, "
                    "analytics, third-party processors). "
                    "See GDPR Art. 17 — Right to Erasure."
                ),
                confidence=0.65,
                rule_id="gdpr-missing-erasure-endpoint",
            ))

        return findings

    # ------------------------------------------------------------------
    # Repo-mode scanning (full repository analysis)
    # ------------------------------------------------------------------

    def _scan_repo(
        self, context: dict[str, Any]
    ) -> tuple[list[Finding], list[str], dict]:
        file_tree: list[str] = context.get("file_tree", [])
        contents: dict[str, str] = context.get("key_file_contents", {})
        findings: list[Finding] = []
        positives: list[str] = []

        # Scan key file contents with all rules
        for fname, content in contents.items():
            if not content:
                continue
            is_test = _is_test_file(fname)
            findings.extend(self._check_rules(content, fname, is_test))
            findings.extend(self._check_pan_in_code(content, fname, is_test))
            findings.extend(self._check_pii_patterns(content, fname, is_test))

        # Structural / file-tree compliance checks
        findings.extend(self._structural_checks_repo(file_tree, contents))

        # Positives
        has_privacy_policy = any(
            "privacy" in f.lower() for f in file_tree
        )
        has_terms = any("terms" in f.lower() for f in file_tree)
        has_security_txt = any(
            f.endswith("security.txt") or "security" in f.lower() for f in file_tree
        )
        has_gdpr_route = any(
            "gdpr" in f.lower() or "erase" in f.lower() or "erasure" in f.lower()
            for f in file_tree
        )
        has_cookie_consent = any(
            "consent" in f.lower() or "cookie-banner" in f.lower() or "cookiebanner" in f.lower()
            for f in file_tree
        )
        has_encryption = any(
            "encrypt" in (contents.get(f, "") or "").lower() for f in file_tree
        )

        if has_privacy_policy:
            positives.append("Privacy policy page detected in the repository")
        if has_terms:
            positives.append("Terms of service documented in the repository")
        if has_gdpr_route:
            positives.append("GDPR/erasure endpoint detected — right-to-erasure implemented")
        if has_cookie_consent:
            positives.append("Cookie consent component detected")
        if has_encryption:
            positives.append("Encryption utilities present in the codebase")
        if has_security_txt:
            positives.append("security.txt present — responsible disclosure policy published")

        return findings, positives, {}

    def _structural_checks_repo(
        self, file_tree: list[str], contents: dict[str, str]
    ) -> list[Finding]:
        findings: list[Finding] = []
        lower_tree = [f.lower() for f in file_tree]

        # GDPR: missing privacy policy
        has_privacy = any("privacy" in p for p in lower_tree)
        if not has_privacy:
            findings.append(Finding(
                severity="high",
                category="compliance:gdpr",
                description=(
                    "No privacy policy page or document detected. "
                    "GDPR Art. 13/14 require a privacy notice explaining how personal "
                    "data is collected, processed, and stored."
                ),
                suggestion=(
                    "Create a /privacy page covering: data controller identity, "
                    "lawful basis for processing, data categories collected, "
                    "retention periods, third-party processors, and user rights. "
                    "See GDPR Art. 13 — Information to be provided on data collection."
                ),
                confidence=0.90,
                rule_id="gdpr-missing-privacy-policy",
            ))

        # GDPR: missing right-to-erasure endpoint
        has_erasure = any(
            "gdpr" in p or "erase" in p or "erasure" in p or "delete-account" in p
            for p in lower_tree
        )
        if not has_erasure:
            findings.append(Finding(
                severity="medium",
                category="compliance:gdpr",
                description=(
                    "No right-to-erasure endpoint found in the file tree. "
                    "GDPR Art. 17 mandates that users can request deletion of all their data."
                ),
                suggestion=(
                    "Implement DELETE /api/account or POST /api/gdpr/erase. "
                    "The endpoint must cascade deletion to all data stores: "
                    "primary DB, Redis cache, analytics, audit logs, and third-party processors. "
                    "See GDPR Art. 17."
                ),
                confidence=0.80,
                rule_id="gdpr-missing-erasure-endpoint",
            ))

        # HIPAA: check if repo contains PHI indicators and lacks audit infrastructure
        phi_files = [
            fname for fname, content in contents.items()
            if content and _has_phi_context(content)
        ]
        if phi_files:
            has_audit_log = any(
                "audit" in p or "hipaa" in p for p in lower_tree
            )
            if not has_audit_log:
                findings.append(Finding(
                    severity="high",
                    category="compliance:hipaa",
                    description=(
                        f"Repository contains PHI-related code ({len(phi_files)} files with health data terms) "
                        "but no dedicated audit log infrastructure detected."
                    ),
                    suggestion=(
                        "Create a dedicated audit log module: `src/lib/audit.ts` or "
                        "`services/audit-log/`. Every PHI access must emit an immutable "
                        "audit record. Consider using a WORM-compatible log store. "
                        "See HIPAA 45 CFR § 164.312(b)."
                    ),
                    confidence=0.78,
                    rule_id="hipaa-missing-audit-trail",
                ))

            has_baa_signal = any(
                "baa" in p or "business_associate" in p or "associate_agreement" in p
                for p in lower_tree
            )
            if not has_baa_signal:
                findings.append(Finding(
                    severity="medium",
                    category="compliance:hipaa",
                    description=(
                        "PHI-related code detected but no Business Associate Agreement (BAA) "
                        "reference found. Third-party services processing PHI require a signed BAA."
                    ),
                    suggestion=(
                        "Document all third-party services that may process PHI and ensure "
                        "each has a signed BAA. Add a `docs/baa/` directory or compliance "
                        "register listing BAA status for each vendor. "
                        "See HIPAA 45 CFR § 164.308(b) — Business Associate Contracts."
                    ),
                    confidence=0.70,
                    rule_id="hipaa-missing-baa-signal",
                ))

            # HIPAA: session timeout signal
            has_session_timeout = any(
                "maxage" in (contents.get(f, "") or "").lower()
                or "session_timeout" in (contents.get(f, "") or "").lower()
                or "autologoff" in (contents.get(f, "") or "").lower()
                for f in file_tree
            )
            if not has_session_timeout:
                findings.append(Finding(
                    severity="medium",
                    category="compliance:hipaa",
                    description=(
                        "PHI-related code found but no session timeout configuration detected. "
                        "HIPAA Security Rule requires automatic logoff for electronic PHI systems."
                    ),
                    suggestion=(
                        "Configure session maxAge ≤ 900 seconds (15 minutes) for health apps. "
                        "Add client-side idle detection: "
                        "`useIdleTimer({ timeout: 900_000, onIdle: () => signOut() })`. "
                        "See HIPAA 45 CFR § 164.312(a)(2)(iii) — Automatic Logoff."
                    ),
                    confidence=0.72,
                    rule_id="hipaa-missing-session-timeout",
                ))

        # PCI-DSS: check if payment-related code exists without tokenization signals
        payment_files = [
            fname for fname, content in contents.items()
            if content and re.search(
                r"(?:payment|checkout|billing|stripe|braintree|paypal|square)",
                content, re.IGNORECASE
            )
        ]
        if payment_files:
            has_tokenization = any(
                re.search(
                    r"(?:token|paymentMethod|paymentIntent|clientSecret|vaultToken)",
                    contents.get(f, "") or "", re.IGNORECASE
                )
                for f in payment_files
            )
            if not has_tokenization:
                findings.append(Finding(
                    severity="high",
                    category="compliance:pci-dss",
                    description=(
                        f"Payment-related code found in {len(payment_files)} file(s) "
                        "but no tokenization pattern detected. Raw card data may be handled directly."
                    ),
                    suggestion=(
                        "Integrate Stripe Elements, Braintree Hosted Fields, or similar "
                        "tokenization SDK so raw PANs never reach your servers. "
                        "Your payment flow should only ever handle tokens/paymentMethodIds. "
                        "See PCI-DSS v4.0 Req. 3.5 and Req. 4.2.1."
                    ),
                    confidence=0.75,
                    rule_id="pci-missing-tokenization",
                ))

            has_csp = any(
                "content-security-policy" in (contents.get(f, "") or "").lower()
                or "contentSecurityPolicy" in (contents.get(f, "") or "")
                for f in file_tree
            )
            if not has_csp:
                findings.append(Finding(
                    severity="high",
                    category="compliance:pci-dss",
                    description=(
                        "Payment-related code detected but no Content-Security-Policy (CSP) "
                        "configuration found. CSP is required by PCI-DSS v4.0 for payment pages."
                    ),
                    suggestion=(
                        "Configure a strict CSP for all payment pages: "
                        "`Content-Security-Policy: default-src 'self'; script-src 'self' "
                        "https://js.stripe.com; frame-src https://js.stripe.com`. "
                        "Add the CSP header in next.config.js headers() or middleware.ts. "
                        "See PCI-DSS v4.0 Req. 6.4.3 — All scripts on payment pages authorised."
                    ),
                    confidence=0.82,
                    rule_id="pci-payment-missing-csp",
                ))

        # CCPA: check for data collection without opt-out route
        has_analytics = any(
            re.search(r"(?:gtag|GA4|mixpanel|segment|amplitude|posthog|heap)", content or "", re.IGNORECASE)
            for content in contents.values()
        )
        has_opt_out = any("opt-out" in p or "optout" in p or "do-not-sell" in p for p in lower_tree)
        if has_analytics and not has_opt_out:
            findings.append(Finding(
                severity="medium",
                category="compliance:ccpa",
                description=(
                    "Analytics/tracking scripts detected but no opt-out or "
                    "'Do Not Sell' page found in the file tree."
                ),
                suggestion=(
                    "Add a /privacy or /do-not-sell page with a clear opt-out mechanism. "
                    "Respect the Global Privacy Control (GPC) signal automatically: "
                    "`if (navigator.globalPrivacyControl) { disableAnalytics(); }`. "
                    "See CCPA § 1798.120 — Right to opt-out of sale."
                ),
                confidence=0.78,
                rule_id="ccpa-missing-opt-out",
            ))

        # SOC2: no access logging infrastructure
        has_access_log = any(
            "audit" in p or "access-log" in p or "accesslog" in p
            for p in lower_tree
        )
        if not has_access_log:
            findings.append(Finding(
                severity="medium",
                category="compliance:soc2",
                description=(
                    "No dedicated access logging or audit trail infrastructure detected. "
                    "SOC 2 CC7.2 requires monitoring of access to sensitive systems and data."
                ),
                suggestion=(
                    "Implement a structured audit log: `{ timestamp, userId, action, "
                    "resource, ip, userAgent }`. Ship to an immutable log store "
                    "(CloudWatch, Datadog, Splunk). Set up anomaly detection alerts. "
                    "See SOC 2 CC7.2 — System monitoring."
                ),
                confidence=0.80,
                rule_id="soc2-no-access-logging",
            ))

        return findings

    # ------------------------------------------------------------------
    # Scoring and reporting helpers
    # ------------------------------------------------------------------

    def _compute_framework_scores(
        self, findings: list[Finding]
    ) -> dict[str, int]:
        scores: dict[str, int] = {}
        for fw, baseline in FRAMEWORK_BASELINES.items():
            score = baseline
            fw_lower = fw.lower()
            for f in findings:
                # category format: "compliance:gdpr", "compliance:hipaa", etc.
                cat = (f.category or "").lower()
                if fw_lower not in cat and fw_lower.replace("-", "") not in cat:
                    continue
                deductions = FRAMEWORK_DEDUCTIONS.get(fw, {})
                score -= deductions.get(f.severity, 5)
            scores[fw] = self._clamp(score)
        return scores

    def _compute_overall_score(self, framework_scores: dict[str, int]) -> int:
        if not framework_scores:
            return 75
        # Weighted average — HIPAA and PCI carry more weight due to regulatory severity
        weights = {"GDPR": 1.0, "HIPAA": 1.4, "PCI-DSS": 1.4, "SOC2": 0.9, "CCPA": 0.7}
        total_weight = sum(weights.get(fw, 1.0) for fw in framework_scores)
        weighted_sum = sum(
            framework_scores[fw] * weights.get(fw, 1.0)
            for fw in framework_scores
        )
        return self._clamp(int(weighted_sum / total_weight))

    def _build_insights(
        self,
        findings: list[Finding],
        framework_scores: dict[str, int],
        overall_score: int,
    ) -> list[str]:
        insights: list[str] = []

        critical_findings = [f for f in findings if f.severity == "critical"]
        high_findings = [f for f in findings if f.severity == "high"]

        if critical_findings:
            frameworks_hit = sorted({
                (f.category or "").split(":")[-1].upper()
                for f in critical_findings
            })
            insights.append(
                f"{len(critical_findings)} CRITICAL compliance violation"
                f"{'s' if len(critical_findings) > 1 else ''} detected "
                f"({', '.join(frameworks_hit)}) — these may constitute regulatory breaches "
                "requiring immediate remediation and possibly breach notification."
            )

        if high_findings:
            insights.append(
                f"{len(high_findings)} high-severity compliance issue"
                f"{'s' if len(high_findings) > 1 else ''} need resolution before production deployment."
            )

        # Per-framework grade summaries
        grade_summary_parts: list[str] = []
        for fw, score in sorted(framework_scores.items()):
            grade = _compliance_grade(score)
            grade_summary_parts.append(f"{fw}: {score}/100 ({grade})")
        if grade_summary_parts:
            insights.append("Compliance grades — " + " | ".join(grade_summary_parts))

        # Framework-specific actionable insights
        failing_frameworks = [
            fw for fw, score in framework_scores.items() if score < 70
        ]
        if "PCI-DSS" in failing_frameworks:
            insights.append(
                "PCI-DSS compliance is below acceptable threshold. "
                "Do not process live payment card data until critical findings are resolved. "
                "Consider engaging a Qualified Security Assessor (QSA)."
            )
        if "HIPAA" in failing_frameworks:
            insights.append(
                "HIPAA compliance is below acceptable threshold. "
                "PHI must not be accessed through this system until violations are remediated. "
                "A HIPAA Risk Assessment (45 CFR § 164.308(a)(1)) is recommended."
            )
        if "GDPR" in failing_frameworks:
            insights.append(
                "GDPR compliance gaps detected. Non-compliance can result in fines of up to "
                "€20M or 4% of annual global turnover (GDPR Art. 83). "
                "Engage a Data Protection Officer (DPO) if not already assigned."
            )

        if overall_score >= 85 and not critical_findings:
            insights.append(
                "Overall compliance posture is strong. "
                "Continue regular compliance audits and keep frameworks up to date."
            )

        return insights

    # ------------------------------------------------------------------
    # Severity downgrade for test/fixture contexts
    # ------------------------------------------------------------------

    @staticmethod
    def _downgrade_severity(severity: str) -> str:
        """Reduce severity by one level for test file findings."""
        ladder = ["critical", "high", "medium", "low", "info"]
        try:
            idx = ladder.index(severity)
            return ladder[min(idx + 1, len(ladder) - 1)]
        except ValueError:
            return severity
