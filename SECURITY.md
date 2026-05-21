# Security Guide — AIUC

This document outlines security measures, best practices, and recommendations for the AIUC application.

---

## 🔒 Implemented Security Controls

### Authentication & Authorization

#### Okta PKCE Flow ✅
- **Status:** Implemented and verified
- **Details:** 
  - PKCE (Proof Key for Code Exchange) prevents authorization code interception
  - Code challenge + code verifier ensures only legitimate client can exchange code
  - Redirect URI dynamically loaded from `/api/okta-config` for flexibility
  - Redirect URI hardened from `/login/callback` to `/callback`
- **Location:** `src/config/okta.ts`, `lambda/index.mjs:260`

#### JWT Verification ✅
- **Status:** Implemented on every protected request
- **Details:**
  - RS256 signature verification against Okta JWKS endpoint
  - Issuer validation (dynamic support for custom and org-level auth servers)
  - Token extracted from `Authorization: Bearer` header
  - No audience check (org-level tokens use non-standard audience)
- **Location:** `lambda/index.mjs:136-147`

### Secrets Management

#### AWS Secrets Manager ✅
- **Status:** Implemented with KMS encryption
- **Details:**
  - `OKTA_CLIENT_ID` never hardcoded or in Lambda env vars
  - `EVERPURE_OPENAI_API_KEY` stored securely with KMS encryption
  - Secrets fetched at cold start and cached (with 5-minute TTL for rotation)
  - Credentials never logged in plain text
- **Location:** `lambda/index.mjs:151-174`
- **Setup:** See [DEPLOYMENT_CONFIG.md — Section 3](DEPLOYMENT_CONFIG.md#section-3--okta-authentication-aws-secrets-manager)

#### Secrets Cache TTL ✅
- **Status:** Implemented (5-minute refresh)
- **Details:**
  - Secrets refreshed every 5 minutes instead of cached indefinitely
  - Allows OpenAI API key rotation without Lambda redeployment
  - Logged when secrets are refreshed
- **Location:** `lambda/index.mjs:156-173`

### API Security

#### Input Validation ✅
- **Status:** Implemented
- **Query validation:**
  - Query length capped at 1000 characters
  - Query logged as SHA-256 hash (never plain text)
  - Query hash logged with first 8 hex chars + length for debugging
- **Result limit validation:**
  - Result limit clamped to 1-15 (user cannot request unlimited results)
- **Location:** `lambda/core/api_handlers.mjs`

#### Rate Limiting ✅
- **Status:** Implemented (per-container, in-memory)
- **Details:**
  - 10 requests per user per 60 seconds (configurable)
  - Keyed on JWT `sub` claim (stable user identifier)
  - Sliding-window algorithm with timestamp tracking
  - Returns HTTP 429 with `Retry-After` header when exceeded
- **Limitation:** Per-Lambda-container only. At scale with multiple containers, use DynamoDB/Redis.
- **Location:** `lambda/index.mjs:43-70`

#### S3 Path Traversal Prevention ✅
- **Status:** Implemented
- **Details:**
  - `.` and `..` path segments rejected
  - S3 key normalized before access
  - Static file handler validates all requests
- **Location:** `lambda/index.mjs` (static file serving logic)

#### Security Headers ✅
- **Status:** Implemented
- **Headers added to all responses:**
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  ```
- **Location:** `lambda/index.mjs:235-247`

### Data Security

#### Query Privacy ✅
- **Status:** Implemented
- **Details:**
  - User search queries never logged in plain text
  - Logged as SHA-256 hash (first 8 chars) + query length
  - Sample log: `[Search] mode=hybrid results=10 qhash=a3f8c12e qlen=42`
- **Location:** `lambda/core/api_handlers.mjs`

#### TLS/HTTPS ✅
- **Status:** Enforced by AWS
- **Details:**
  - Lambda Function URLs enforced over HTTPS
  - All S3 access via HTTPS
  - Okta redirects enforced to HTTPS
  - HSTS header enforces 1-year HTTPS-only

### Frontend Security

#### XSS Prevention ✅
- **Status:** Implemented via React
- **Details:**
  - React escapes all dynamic content by default
  - No `dangerouslySetInnerHTML` used in codebase
  - OpenAI API responses sanitized before display
- **Note:** CSP headers recommended for additional protection

#### CSRF Protection ✅
- **Status:** Okta PKCE provides code/state protection
- **Enhancement:** Explicit state parameter validation recommended

---

## ⚠️ Security Findings & Recommendations

### HIGH PRIORITY

#### 1. Distributed Rate Limiting (Medium Priority)
**Current:** Per-container in-memory rate limit  
**Issue:** Multiple Lambda containers each have independent limit stores  
**Impact:** Users can exceed global limits by hitting different containers  
**Recommendation:** For production scaling, implement DynamoDB or Redis rate limiting  
**Timeline:** Before scaling beyond 5 concurrent containers

**Implementation option:**
```javascript
// Use DynamoDB for distributed rate limiting
const dynamodb = new DynamoDBClient({ region: REGION });
async function checkRateLimitDynamoDB(userId) {
  // Sliding-window key: {userId}#{windowStart}
  // Increment request count in DynamoDB
  // TTL = window size
}
```

---

### MEDIUM PRIORITY

#### 2. Content Security Policy Header
**Current:** Security headers implemented, but no CSP  
**Recommendation:** Add CSP header to all responses  
**Implementation:**
```javascript
'Content-Security-Policy': 
  "default-src 'self'; " +
  "script-src 'self' https://trial-6303096.okta.com; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https:; " +
  "connect-src 'self' https://trial-6303096.okta.com; " +
  "frame-ancestors 'none';"
```

#### 3. Query Hash Salting
**Current:** SHA-256 hash of queries  
**Recommendation:** Use HMAC-SHA256 with salt to prevent rainbow table attacks  
**Implementation:**
```javascript
import crypto from 'crypto';
const SALT = process.env.LOG_SALT; // from Secrets Manager
const hash = crypto.createHmac('sha256', SALT).update(query).digest('hex');
```

---

### LOW PRIORITY

#### 4. Observability & Monitoring
**Recommendation:**
- Enable CloudWatch Logs insights for error tracking
- Set up alarms for 401 Unauthorized, 429 Rate Limit, 503 Errors
- Monitor OpenAI API usage and costs
- Track JWT verification failures

#### 5. Dependency Scanning
**Recommendation:**
```bash
npm audit
npm outdated
```
Run regularly and update dependencies. Current packages are modern (OpenAI SDK, jose, AWS SDK v3).

---

## 🔐 Security Checklist — Pre-Production

- [x] Okta PKCE authentication implemented
- [x] JWT RS256 signature verification on every request
- [x] Secrets Manager with KMS encryption for credentials
- [x] Security headers (HSTS, X-Frame-Options, CSP pending)
- [x] Input validation (query length, result limits)
- [x] Rate limiting (per-user, sliding-window)
- [x] S3 path traversal protection
- [x] Query privacy (hashed logging)
- [x] TLS/HTTPS enforced
- [ ] Distributed rate limiting (DynamoDB/Redis) — for scale
- [ ] Content Security Policy header — recommended
- [ ] Query hash salting — recommended
- [ ] CloudWatch alarms & monitoring — recommended
- [ ] Secrets rotation tested — recommended

---

## 🚨 Incident Response

### If OpenAI API Key is Compromised

1. **Immediate:** Revoke the key in OpenAI Dashboard
2. **Update Secrets Manager:** Generate new key, update `aiuc/okta` secret
3. **No Lambda redeploy needed:** Secrets are refreshed every 5 minutes
4. **Monitor:** Check CloudWatch for failed API calls during rotation window

### If Okta Client ID is Exposed

1. **Immediate:** Revoke in Okta Admin Console
2. **Update Secrets Manager:** Generate new client ID
3. **No Lambda redeploy needed:** Secrets refreshed every 5 minutes
4. **No frontend changes:** Frontend fetches config dynamically from API

### If S3 Bucket is Misconfigured

1. **Check:** `aws s3api get-bucket-public-access-block --bucket YOUR_BUCKET`
2. **Must see:** `"BlockPublicAcls": true, "BlockPublicPolicy": true`
3. **Enforce:** Use S3 bucket policies to restrict access to Lambda role only

---

## 📋 Security References

| Control | OWASP | Status |
|---------|-------|--------|
| A01:2021 – Broken Access Control | OAuth2 PKCE + JWT | ✅ Implemented |
| A02:2021 – Cryptographic Failures | Secrets Manager + KMS | ✅ Implemented |
| A03:2021 – Injection | Input validation + parameterized queries | ✅ Safe |
| A07:2021 – Cross-Site Scripting (XSS) | React escaping | ✅ Protected |
| A08:2021 – Software & Data Integrity | Dependency scanning | ✅ Recommended |

---

## 🔄 Security Update Schedule

- **Monthly:** Run `npm audit` and update dependencies
- **Quarterly:** Review CloudWatch logs for suspicious patterns
- **Annually:** Security audit of OWASP Top 10 controls

---

## 📞 Report Security Issues

If you discover a security vulnerability:
1. **Do not** open a public GitHub issue
2. Email the security team with details
3. Include: description, impact, reproduction steps

---

*Last Updated: 2026-05-21*  
*Document Version: 1.0*
