# AI Use Case Repository (AIUC)

An internal web application for exploring, searching, and sharing AI use cases across business functions and industries. Built for the Spearhead AI event, it features Cognito-based authentication, role-based data access, an admin approval workflow, and full analytics logging.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Authentication & Authorization](#authentication--authorization)
- [Column-Level Access Control](#column-level-access-control)
- [Admin Approval Workflow](#admin-approval-workflow)
- [Analytics & Usage Logs](#analytics--usage-logs)
- [API Reference](#api-reference)
- [Deployment to AWS](#deployment-to-aws)
- [Troubleshooting](#troubleshooting)

---

## Features

- **Two data views** — "Case Study" table and "Industry Data" table with virtualized scrolling for large datasets
- **Search & filter** — full-text search and per-column filtering on all data
- **Cognito authentication** — email/password registration, login, and forgot-password flow
- **Role-based data access** — unauthenticated users see blurred restricted columns; authenticated users see all data
- **Server-side data filtering** — restricted columns are stripped in the Lambda response for unauthenticated requests (JWT verified via `aws-jwt-verify`)
- **Admin approval workflow** — non-work-email registrations trigger an admin review email with one-click Approve/Reject links (HMAC-signed, 7-day expiry, replay-protected)
- **Contact form** — users can email the team from within the app (sent via AWS SES)
- **Configurable column restrictions** — restricted columns controlled via Lambda environment variables (no code deployment needed)
- **Usage analytics** — every user interaction (search, click, filter, row view) logged to S3 with session tracking
- **Spearhead branding** — header/footer logos link to spearhead.so

---

## AI Search (RAG)

The app includes a semantic RAG search powered by Amazon Bedrock, controlled via the `ENABLE_AI_SEARCH` Lambda environment variable.

### Enabling / Disabling AI Search

Set the variable in **AWS Lambda Console → Configuration → Environment variables**:

```
ENABLE_AI_SEARCH=true    # semantic vector search (default)
ENABLE_AI_SEARCH=false   # keyword-only fallback (no Bedrock calls)
```

No redeployment required — the Lambda reads the flag at cold-start.

### How It Works

1. User types a natural-language query in the **AI Search** input and presses **AI Search** (or Enter).
2. The frontend POSTs `{ query, limit }` to `/api/search` (Case Study) or `/api/search/industry` (Industry Data).
3. Lambda embeds the query using **`amazon.titan-embed-text-v2:0`** (1024-dim).
4. A pure-JS cosine similarity index ranks pre-computed embeddings loaded from S3.
5. **`us.amazon.nova-lite-v1:0`** generates a 1–2 sentence "Why Matched" explanation per result.
6. Results appear in the table with the **Why Matched** column visible.

Clicking **Show All** clears results and returns to the full browseable dataset.

### Required IAM Permissions

Add to the Lambda execution role:

```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": [
    "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0",
    "arn:aws:bedrock:*::foundation-model/us.amazon.nova-lite-v1:0"
  ]
}
```

### S3 Embeddings Setup

1. **Upload dataset** to `s3://<BUCKET_NAME>/use_cases.json` and `s3://<BUCKET_NAME>/industry_use_cases.json` (arrays of snake_case objects).

2. **Generate embeddings** (calls Bedrock Titan — requires `bedrock:InvokeModel`):
   ```bash
   cd lambda && node scripts/generate-embeddings.mjs
   ```
   Produces `public/data/use_cases_embeddings.json` and `public/data/industry_use_cases_embeddings.json`.

3. **Upload embeddings to S3**:
   ```bash
   aws s3 cp public/data/use_cases_embeddings.json s3://<BUCKET_NAME>/use_cases_embeddings.json
   aws s3 cp public/data/industry_use_cases_embeddings.json s3://<BUCKET_NAME>/industry_use_cases_embeddings.json
   ```

Override S3 key paths via Lambda env vars if needed:
```
USE_CASES_EMBEDDINGS_KEY=path/to/use_cases_embeddings.json
INDUSTRY_EMBEDDINGS_KEY=path/to/industry_use_cases_embeddings.json
```

The Lambda caches the loaded index in memory across warm invocations.

### Shared Core Module

All RAG logic lives in `lambda/core/` — shared across all deployments:

| File | Purpose |
|------|---------|
| `core/embeddings.mjs` | Bedrock Titan Text Embeddings v2 (1024-dim) |
| `core/search.mjs` | FlatIP index, vector search, keyword fallback |
| `core/ai_toggle.mjs` | `ENABLE_AI_SEARCH` feature flag |
| `core/why_matched.mjs` | Bedrock Nova Lite "Why Matched" explanations |
| `core/api_handlers.mjs` | `handleUseCaseSearch` / `handleIndustrySearch` |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Vite 7 |
| **UI Library** | Material UI (MUI) v5 |
| **Tables** | TanStack Table v8 + TanStack Virtual v3 |
| **Routing** | React Router DOM v7 |
| **Authentication** | Amazon Cognito (`amazon-cognito-identity-js`) |
| **Backend** | AWS Lambda (Node.js 20, ESM) |
| **Static files** | Amazon S3 (served through Lambda) |
| **Data storage** | Amazon S3 (JSON data files + event logs) |
| **Email** | AWS SES (`@aws-sdk/client-ses`) |
| **JWT Verification** | `aws-jwt-verify` v4 |
| **Deployment** | AWS Lambda Function URL (public HTTPS) |

---

## Architecture

```
Browser
  │
  └─► Lambda Function URL  (HTTPS, public — no IAM auth)
        │
        ├─ GET /              ──► S3 dist/index.html         (SPA entry)
        ├─ GET /assets/*      ──► S3 dist/assets/*           (JS, CSS, images)
        ├─ GET /api/data/use-cases    ──► S3 use_cases.json  (filtered by auth)
        ├─ GET /api/data/industry     ──► S3 industry_use_cases.json
        ├─ GET /api/columns-config    ──► reads Lambda env vars
        ├─ POST /api/validate-email   ──► domain check + approval token verify
        ├─ GET /api/approve           ──► SES approval email to user
        ├─ GET /api/reject            ──► SES rejection email to user
        ├─ POST /api/contact          ──► SES email to CONTACT_EMAIL
        └─ POST /api/log              ──► S3 logs/{date}/{eventId}.json

Browser ──► Cognito User Pool  (SDK direct calls — not proxied through Lambda)
                                (registration, login, forgot password, session)
```

**Authenticated data flow:**

```
Frontend                        Lambda                       Cognito
   │                               │                            │
   ├─ GET /api/data/use-cases ──►  │                            │
   │   Authorization: Bearer {idToken}                          │
   │                               ├─ CognitoJwtVerifier ──────►│
   │                               │◄── valid / invalid ────────┤
   │                               │                            │
   │                               ├─ valid:   return ALL columns
   │                               └─ invalid: strip restricted columns
   │◄──────────────── filtered JSON ──────────────────────────────┘
```

---

## Project Structure

```
aiuc/
├── src/                          # React/TypeScript frontend source
│   ├── components/
│   │   ├── UseCaseTable.tsx      # "Case Study" tab — virtualized data table
│   │   ├── IndustryDataTable.tsx # "Industry Data" tab — virtualized data table
│   │   ├── LoginForm.tsx         # Cognito email/password login
│   │   ├── RegisterForm.tsx      # Multi-step Cognito registration
│   │   ├── ForgotPasswordForm.tsx# 3-screen password reset flow
│   │   ├── ContactDialog.tsx     # "I'm Interested" modal (sends SES email)
│   │   ├── RestrictedCell.tsx    # Blurred cell for restricted columns
│   │   └── Logo.tsx              # Image with text fallback
│   ├── config/
│   │   ├── cognito.ts            # CognitoUserPool client (reads VITE_ env vars)
│   │   └── restrictedColumns.ts  # Fallback restricted column lists
│   ├── hooks/
│   │   ├── useCognitoUser.ts     # Session check → userName, userEmail, isRegistered
│   │   ├── useColumnsConfig.ts   # Fetches /api/columns-config (module-level cache)
│   │   ├── useS3Data.ts          # Fetches /api/data/* with Cognito Bearer token
│   │   └── useLogger.ts          # Fire-and-forget POST /api/log
│   ├── App.tsx                   # Layout: header, tab bar, tables, footer
│   ├── main.tsx                  # Routes: /, /login, /register, /forgot-password
│   ├── theme.ts                  # MUI theme — Pure Orange (#fe5000)
│   └── types.ts                  # UseCaseData, IndustryData interfaces
│
├── lambda/
│   ├── index.mjs                 # Lambda handler — all routes for production
│   ├── server.mjs                # Local dev server — mirrors Lambda API routes
│   └── package.json              # Lambda dependencies (AWS SDK v3, aws-jwt-verify)
│
├── public/
│   └── assets/
│       ├── spearhead.svg         # Favicon + header logo (SVG)
│       ├── spearhead.png         # Footer logo (PNG)
│       └── purelogo.png          # Pure Storage logo (login/register forms)
│
├── index.html                    # HTML shell (title, favicon, #root mount)
├── vite.config.ts                # Vite: React plugin, /api/* proxy → localhost:3001
├── package.json                  # Root scripts + frontend dependencies
└── .env                          # Local environment variables (git-ignored)
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18.x | https://nodejs.org |
| npm | ≥ 9.x | Included with Node.js |
| AWS CLI | ≥ 2.x | https://aws.amazon.com/cli/ |
| AWS account | — | Required for SES email in local dev |

```bash
# Verify installed versions
node --version    # must be 18+
npm --version     # must be 9+
aws --version     # must be 2+
```

---

## Local Development Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/NachiketAxia19/aiuc.git
cd aiuc

# Install frontend dependencies
npm install

# Install Lambda dependencies (separate node_modules)
cd lambda && npm install && cd ..
```

### 2. Create the environment file

Create `.env` in the project root (the Lambda dev server loads this automatically):

```env
# ── Cognito (frontend auth — baked into bundle at build time) ──
VITE_COGNITO_USER_POOL_ID=us-east-2_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-east-2
VITE_REDIRECT_URI=https://xxx.lambda-url.us-east-2.on.aws

# ── SES email (local dev server) ──
SES_FROM_EMAIL=aiuc@spearhead.so
SES_REGION=us-east-2

# ── App config (local dev server) ──
CONTACT_EMAIL=aiuc@spearhead.so
APPROVAL_EMAIL=admin@spearhead.so
APPROVAL_SECRET=change-me-to-a-long-random-string
APP_URL=http://localhost:5173

# ── AWS credentials (SSO profile) ──
AWS_PROFILE=aiuc-local
```

### 3. Set up AWS credentials

The local API server sends emails via SES and needs AWS credentials. This project uses AWS SSO (federated login):

```bash
# First-time SSO profile setup
aws configure sso --profile aiuc-local
# Enter: SSO start URL, SSO region, account ID, role, output format

# Login (run this each time your session expires — opens browser)
aws sso login --profile aiuc-local
```

> If you have static IAM credentials (Access Key + Secret), you can set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in `.env` instead of using a profile.

### 4. Start development servers

Open **two terminals**:

```bash
# Terminal 1 — local API server (mirrors all Lambda routes)
npm run dev:api
# → http://localhost:3001

# Terminal 2 — Vite dev server
npm run dev
# → http://localhost:5173
# All /api/* requests are proxied to localhost:3001 automatically
```

Open http://localhost:5173

---

## Environment Variables

### Frontend variables (`.env` — embedded at build time)

Prefixed `VITE_` — these are compiled into the JavaScript bundle. Changing them requires a rebuild.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_COGNITO_USER_POOL_ID` | Yes | Cognito User Pool ID (e.g. `us-east-2_AbCdEfGhI`) |
| `VITE_COGNITO_CLIENT_ID` | Yes | Cognito App Client ID (public client, no secret) |
| `VITE_AWS_REGION` | Yes | AWS region where Cognito pool lives |
| `VITE_REDIRECT_URI` | Yes | Your app URL (for Cognito Hosted UI callbacks) |

### Lambda environment variables (set in Lambda Console)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BUCKET_NAME` | Yes | S3 bucket name | `aiuc` |
| `S3_REGION` | Yes | S3 bucket region | `us-east-2` |
| `DIST_PREFIX` | Yes | S3 folder containing the built `dist/` | `dist1` |
| `SES_FROM_EMAIL` | Yes | Verified SES sender address | `nachiket.kapure@spearhead.so` |
| `SES_REGION` | Yes | Region where SES identity is verified | `us-east-2` |
| `CONTACT_EMAIL` | Yes | Receives contact form emails | `nachiket.kapure@spearhead.so` |
| `APPROVAL_EMAIL` | Yes | Receives registration approval requests | `nachiket.kapure@ax-ia.ai` |
| `APP_URL` | Yes | Lambda Function URL (no trailing slash) | `https://xxx.lambda-url.us-east-2.on.aws` |
| `APPROVAL_SECRET` | Yes | HMAC-SHA256 secret for signing tokens | `a-long-random-string` |
| `COGNITO_USER_POOL_ID` | Yes | For server-side JWT verification | `us-east-2_AbCdEfGhI` |
| `COGNITO_CLIENT_ID` | Yes | For server-side JWT verification | `1ud7kicq2o4700g3l7v7flajgo` |
| `USE_CASE_RESTRICTED_COLUMNS` | No | Comma-separated restricted column names | `AI Algorithms & Frameworks,Datasets` |
| `INDUSTRY_RESTRICTED_COLUMNS` | No | Comma-separated restricted column names | `Implementation Plan,Datasets` |

> `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` must match the `VITE_COGNITO_*` values used at build time.

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server on http://localhost:5173 |
| `npm run dev:api` | Start local API server on http://localhost:3001 |
| `npm run build` | TypeScript check + Vite production bundle → `dist/` |
| `npm run lint` | ESLint on all `.ts` / `.tsx` files |
| `npm run preview` | Serve the production `dist/` build locally |

---

## Authentication & Authorization

### User registration

```
1. User fills RegisterForm (email, name, password)
         │
         ▼
2. POST /api/validate-email
         │
         ├─ Approval token provided?
         │     └─ Verify HMAC + expiry, check S3 for replay
         │           allowed → go to step 4
         │
         └─ No token: check email domain
               ├─ Personal domain (gmail, yahoo, hotmail...)? → blocked
               └─ Work domain → allowed
                       │
                       ▼
3. Admin receives SES email with Approve / Reject links
         │
         ▼ (after admin approves, user gets email with personal registration link)
         │
4. Frontend calls Cognito SignUp → user receives email verification code
         │
         ▼
5. User enters code → Cognito confirms account → login enabled
```

### Login

1. User enters email + password on `/login`
2. `amazon-cognito-identity-js` calls `authenticateUser()` against Cognito
3. On success: Cognito stores ID token in browser localStorage (handled by SDK)
4. `useCognitoUser` hook reads session → decodes `name` + `email` attributes
5. App shows authenticated UI with user greeting and full data access

### Password reset

1. `/forgot-password` — user enters email
2. Cognito sends 6-digit code to email
3. User enters code + new password
4. `confirmPassword()` updates Cognito account

### Data authorization

- `useS3Data` hook reads Cognito ID token from current session
- Attaches it as `Authorization: Bearer {idToken}` on all `/api/data/*` requests
- Lambda verifies with `CognitoJwtVerifier` — valid token → all columns; no/invalid token → restricted columns blanked

---

## Column-Level Access Control

### Two-layer protection

| Layer | Mechanism | When applied |
|-------|-----------|-------------|
| **Frontend** | `RestrictedCell` blurs the value (CSS filter) + lock icon | Always for restricted cols when user not logged in |
| **Backend** | Lambda strips restricted column keys from JSON before sending | When no valid JWT provided |

This ensures data is never exposed even if someone bypasses the UI.

### Change restricted columns without redeploying

Edit **Lambda environment variables** in the Lambda Console:

```
USE_CASE_RESTRICTED_COLUMNS  =  AI Algorithms & Frameworks,Datasets,Action / Implementation,AI Tools & Models,Digital Platforms and Tools
INDUSTRY_RESTRICTED_COLUMNS  =  Implementation Plan,Datasets,AI Tools / Platforms,Digital Tools / Platforms,AI Frameworks,AI Tools and Models,Industry References
```

- Comma-separated, no leading/trailing spaces around values
- Column names are **case-sensitive** and must match the data exactly
- Changes take effect on next Lambda invocation — no redeploy needed

### Change defaults in code

Edit `src/config/restrictedColumns.ts` (used when `/api/columns-config` is unreachable):

```typescript
export const USE_CASE_RESTRICTED_COLUMNS: string[] = [
  "AI Algorithms & Frameworks",
  "Datasets",
  // ...
];
```

Requires a frontend rebuild and redeployment after changes.

---

## Admin Approval Workflow

When a user with a new work email registers:

1. User submits RegisterForm → `POST /api/validate-email` allows the domain
2. User sees "Pending Approval" screen and waits
3. Admin receives this SES email at `APPROVAL_EMAIL`:

```
Subject: [AIUC] New Registration Request

Name:  John Doe
Email: john@company.com

Approve: https://xxx.lambda-url.on.aws/api/approve?token=<signed-token>
Reject:  https://xxx.lambda-url.on.aws/api/reject?token=<signed-token>
```

4. **Admin clicks Approve** →
   - Lambda verifies HMAC signature and expiry
   - Checks S3 `used_tokens/` to prevent replay
   - Sends user a personal registration link (valid 7 days)
   - User clicks link → pre-approved → can complete Cognito signup

5. **Admin clicks Reject** →
   - Sends user a rejection email mentioning `CONTACT_EMAIL` for appeals

**Token properties:**
- HMAC-SHA256 signed with `APPROVAL_SECRET`
- 7-day expiry embedded in payload
- One-time use: SHA256 hash stored in S3 on first use, rejected on reuse

---

## Analytics & Usage Logs

Every user action is fire-and-forget logged to S3. Errors are swallowed — logging never affects the user experience.

**S3 path:** `s3://BUCKET_NAME/logs/YYYY-MM-DD/{uuid}.json`

**Logged events:**

| Event type | Triggered by |
|-----------|-------------|
| `page_view` | App load |
| `search` | Text entered in search box |
| `filter` | Column filter applied |
| `click` | Tab switch, button click |
| `column_click` | Column header click |
| `row_click` | Table row expanded / contact dialog opened |
| `register` | Successful Cognito account creation |

**Log entry format:**
```json
{
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-04-07T12:00:00.000Z",
  "eventType": "search",
  "userEmail": "user@company.com",
  "userName": "John Doe",
  "sessionId": "550e8400-...",
  "data": { "query": "machine learning automation" }
}
```

**Export logs for analysis:**
```bash
# Download all logs for a specific date
aws s3 sync s3://YOUR-BUCKET/logs/2025-04-07/ ./logs/ --profile aiuc-local

# List all log files
aws s3 ls s3://YOUR-BUCKET/logs/ --recursive --profile aiuc-local
```

---

## API Reference

All routes are served by `lambda/index.mjs` (production) or `lambda/server.mjs` (local dev).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | None | SPA entry — serves `dist/index.html` |
| `GET` | `/assets/*` | None | Static assets from S3 (JS, CSS, images) |
| `GET` | `/api/data/use-cases` | Optional JWT | Case Study data; restricted cols stripped if no valid JWT |
| `GET` | `/api/data/industry` | Optional JWT | Industry data; restricted cols stripped if no valid JWT |
| `GET` | `/api/columns-config` | None | Returns `{useCaseRestricted, industryRestricted}` from env vars |
| `POST` | `/api/validate-email` | None | Checks email domain; verifies approval token if provided |
| `GET` | `/api/approve` | Token param | Admin approval: sends user a registration link via SES |
| `GET` | `/api/reject` | Token param | Admin rejection: sends user a rejection email via SES |
| `POST` | `/api/contact` | None | Sends contact form email via SES to `CONTACT_EMAIL` |
| `POST` | `/api/log` | None | Writes analytics event to S3 (always returns 200) |
| `POST` | `/api/search` | Optional JWT | RAG use-case search — `{query, limit}` → `{results: [{useCase, score, whyMatched}]}` |
| `POST` | `/api/search/industry` | Optional JWT | RAG industry search — `{query, limit}` → `{results: [{item, score, whyMatched}]}` |

---

## Deployment to AWS

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the complete step-by-step guide.

**Quick redeploy after code changes:**

```bash
# Step 1 — Build the frontend
npm run build

# Step 2 — Upload frontend to S3
#   Replace BUCKET and PREFIX with your actual values
aws s3 sync dist/ s3://YOUR-BUCKET/dist1/ --delete

# Step 3 — Package Lambda
cd lambda
npm install --omit=dev
zip -r ../lambda.zip .
cd ..

# Step 4 — Deploy Lambda
aws lambda update-function-code \
  --function-name aiuc-frontend \
  --zip-file fileb://lambda.zip
```

---

## Troubleshooting

### Blurred columns don't clear after login
The session check is async. Wait for the loading spinner to disappear. If the issue persists, open browser DevTools → Application → Local Storage → clear entries for your domain → reload.

### Local dev: `/api/contact` returns 500
- Ensure `npm run dev:api` is running in a separate terminal
- Run `aws sso login --profile aiuc-local` to refresh SSO credentials
- Verify `SES_FROM_EMAIL` is a confirmed SES identity in the region set by `SES_REGION`

### Local dev: "Could not load credentials from any providers"
Your AWS SSO session has expired. Run:
```bash
aws sso login --profile aiuc-local
```

### Lambda returns 500 on data routes
- Verify `BUCKET_NAME` (bucket name only, not ARN)
- Verify `DIST_PREFIX` matches the S3 folder you uploaded `dist/` into
- Check CloudWatch Logs: Lambda Console → Monitor → View CloudWatch logs

### SES "MessageRejected: Email address not verified"
- Go to SES Console → Verified identities → verify `SES_FROM_EMAIL`
- If in **SES sandbox mode**, all *recipient* addresses must also be verified
- Request **SES production access** to send to any address (AWS Console → SES → Account dashboard → Request production access)

### Approval email links point to localhost
Set `APP_URL` in Lambda environment variables to your Lambda Function URL:
```
APP_URL = https://xxx.lambda-url.us-east-2.on.aws
```

### JWT verification fails / users see blurred data after login
- `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` in Lambda env vars must exactly match `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID` used when the frontend was built
- Rebuild the frontend if Cognito values changed

### Registration: "UserNotConfirmedException"
User signed up but hasn't confirmed their email code. They should check their inbox for the Cognito verification email and enter the 6-digit code. The RegisterForm has a "Resend code" option.

---

*Confidential — Internal Use Only • Powered by Spearhead*
