# Security Policy

## Supported Versions

The following versions of GitScope are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Features

GitScope implements comprehensive security measures:

### Authentication & Authorization
- **NextAuth.js v4** with JWT session strategy
- **bcrypt** password hashing (12 salt rounds)
- GitHub OAuth with email verification via API
- Google OAuth with verified email enforcement
- Automatic account linking with audit logging
- Instant session invalidation for deleted users

### CSRF Protection
- Double Submit Cookie pattern
- HMAC-SHA256 token validation
- Constant-time comparison to prevent timing attacks
- `__Host-` prefix cookies (secure, httpOnly, sameSite=strict)

### Rate Limiting
- IP-based rate limiting with reputation tracking
- Exponential backoff for repeat violators
- Different presets: auth (5/min), sensitive (10/min), standard (60/min)
- Rate limit headers exposed to clients

### Data Protection
- **AES-256-GCM** encryption for GitHub PATs at rest
- Random IV and authentication tag per encryption
- PostgreSQL with TLS 1.3 for data in transit
- No source code or repository data stored

### Audit & Monitoring
- 34 security event types logged
- Batched writes with immediate flush for critical events
- IP, user agent, and metadata captured
- Database persistence with retry logic

### Input Validation
- Strict validation on all API endpoints
- Email format validation
- Password complexity enforcement
- GitHub repo format validation
- Avatar URL allowlist validation
- String length limits enforced

### SSRF Protection
- Path validation on GitHub proxy endpoint
- Blocks paths starting with `http` or containing `..`
- Only allows relative GitHub API paths

## Reporting a Vulnerability

We take security seriously and appreciate responsible disclosure.

### How to Report

Please email **security@gitscope.dev** with:

1. **Description** — Clear explanation of the vulnerability
2. **Steps to Reproduce** — Detailed instructions to trigger the issue
3. **Impact Assessment** — What data or systems could be affected
4. **Proof of Concept** (optional) — Demo code or screenshots

### What to Expect

| Timeline | Action |
|----------|--------|
| Within 2 business days | Acknowledgment of your report |
| Within 7 days | Initial assessment and severity rating |
| Within 30 days | Fix or mitigation deployed |
| Upon resolution | Public acknowledgment (if desired) |

### In Scope

- gitscope.dev and all subdomains
- Authentication and session management flaws
- Authorization bypass (accessing another user's data)
- Cross-site scripting (XSS) with demonstrated impact
- SQL injection or database exposure
- Sensitive data exposure via API endpoints
- CSRF vulnerabilities
- Rate limit bypass with demonstrated harm

### Out of Scope

- Denial-of-service attacks
- Social engineering of GitScope staff
- Vulnerabilities in third-party services (GitHub, Stripe, Vercel)
- Missing security headers without demonstrated exploit
- Self-XSS or issues requiring physical device access
- Brute force attacks without rate limit bypass

## Security Best Practices for Self-Hosting

If you're running GitScope on your own infrastructure:

### Required Environment Variables

```bash
# Generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your_32_byte_base64_secret
GITHUB_PAT_ENCRYPTION_KEY=your_32_byte_base64_key
CSRF_SECRET=your_32_byte_base64_secret
```

### Recommended Settings

1. **Always use HTTPS** in production — GitScope enforces secure cookies
2. **Set TRUSTED_PROXIES** if behind a load balancer
3. **Enable email (SMTP)** for password reset and verification flows
4. **Configure request signing** for webhook endpoints
5. **Review audit logs** regularly at `/api/admin/audit-logs` (admin only)

### Database Security

- Use PostgreSQL 14+ with SSL enabled
- Rotate database credentials regularly
- Enable connection pooling (PgBouncer recommended)
- Set `DATABASE_URL` with SSL mode: `?sslmode=require`

### Network Security

- Deploy behind a CDN/WAF (Cloudflare, AWS WAF)
- Configure IP allowlists for admin endpoints
- Enable DDoS protection at the edge
- Monitor for unusual traffic patterns

## Security Checklist for Production

- [ ] All secrets generated with cryptographically secure random (openssl)
- [ ] `GITHUB_PAT_ENCRYPTION_KEY` is set and 32 bytes (base64)
- [ ] `NEXTAUTH_URL` matches your production domain exactly
- [ ] `NODE_ENV=production` is set
- [ ] Database uses SSL/TLS connections
- [ ] SMTP is configured for transactional emails
- [ ] Rate limiting is enabled (default: enabled)
- [ ] CSRF protection is active
- [ ] Audit logging is enabled (default: enabled)
- [ ] Trusted proxy configuration is set (if applicable)
- [ ] Security headers are being sent (HSTS, CSP, etc.)

## Bug Bounty

GitScope does not currently run a formal paid bug bounty program. However, we genuinely appreciate the time and effort researchers invest in responsible disclosure.

Valid vulnerability reports that lead to a security fix will receive:
- Public acknowledgment in our [Changelog](https://git-scope-pi.vercel.app/changelog) (if desired)
- A personal thank-you from the team
- Priority consideration for future bug bounty programs

## Contact

For security-related inquiries:
- **Email:** security@gitscope.dev
- **Response Time:** Within 2 business days
- **PGP Key:** Available on request

---

Last updated: April 2026
