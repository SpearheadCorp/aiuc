# AI Use Case Repository — AWS Deployment Guide

Complete step-by-step guide to deploy AIUC from scratch on AWS Lambda.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [AWS Services Required](#aws-services-required)
- [Prerequisites](#prerequisites)
- [Step 1 — Create Cognito User Pool](#step-1--create-cognito-user-pool)
- [Step 2 — Verify SES Identity](#step-2--verify-ses-identity)
- [Step 3 — Create S3 Bucket](#step-3--create-s3-bucket)
- [Step 4 — Create Lambda Function](#step-4--create-lambda-function)
- [Step 5 — Lambda IAM Permissions](#step-5--lambda-iam-permissions)
- [Step 6 — Environment Variables](#step-6--environment-variables)
- [Step 7 — Build & Upload](#step-7--build--upload)
- [Step 8 — Lambda Function URL](#step-8--lambda-function-url)
- [Step 9 — Verify the Deployment](#step-9--verify-the-deployment)
- [GitHub Actions CI/CD](#github-actions-cicd)
- [Configuring Restricted Columns](#configuring-restricted-columns)
- [Admin Approval Flow](#admin-approval-flow)
- [Viewing Usage Logs](#viewing-usage-logs)
- [Redeployment Cheatsheet](#redeployment-cheatsheet)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
Browser
  │
  └─► Lambda Function URL  (public HTTPS — no IAM auth)
        │
        ├─ GET /              ──► S3 {DIST_PREFIX}/index.html
        ├─ GET /assets/*      ──► S3 {DIST_PREFIX}/assets/*
        ├─ GET /api/data/*    ──► S3 use_cases.json / industry_use_cases.json
        │                         (restricted columns stripped for unauth users)
        ├─ GET /api/columns-config  ──► Lambda env vars (no S3 call)
        ├─ POST /api/validate-email ──► domain check + HMAC token verify
        ├─ GET /api/approve         ──► SES email to user
        ├─ GET /api/reject          ──► SES email to user
        ├─ POST /api/contact        ──► SES email to CONTACT_EMAIL
        └─ POST /api/log            ──► S3 logs/{date}/{eventId}.json

Browser ──► Cognito User Pool  (direct SDK — not proxied through Lambda)
```

---

## AWS Services Required

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| **AWS Lambda** | Serves frontend + all API routes | 1M requests/month |
| **Amazon S3** | Frontend files, data JSON, usage logs | 5 GB storage |
| **Amazon Cognito** | User registration and authentication | 50,000 MAU |
| **Amazon SES** | Transactional email (contact, approve, reject) | 3,000 emails/month (in production) |

> No DynamoDB, Gemini API, SMTP, or Secrets Manager required.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18.x | https://nodejs.org |
| npm | ≥ 9.x | Included with Node.js |
| AWS CLI | ≥ 2.x | https://aws.amazon.com/cli/ |
| AWS account | — | https://aws.amazon.com |

```bash
# Verify
node --version && npm --version && aws --version

# Configure AWS CLI (skip if using SSO/federated login)
aws configure
# Enter: Access Key ID, Secret Access Key, Region (e.g. us-east-2), json
```

For federated SSO accounts:
```bash
aws configure sso --profile aiuc-deploy
aws sso login --profile aiuc-deploy
# Then prefix all aws CLI commands with: --profile aiuc-deploy
```

---

## Step 1 — Create Cognito User Pool

1. Open [Cognito Console](https://console.aws.amazon.com/cognito/) → **Create user pool**

2. Configure:

**Authentication providers → Cognito user pool**
- Sign-in options: check **Email**

**Password policy:**
- Minimum 8 characters
- Require uppercase, lowercase, numbers, special characters

**Multi-factor authentication:** None (or Optional — your choice)

**Self-service account recovery:** Enable email recovery

**Required attributes:** `email`, `name`

**Email delivery:** Cognito (for testing) — switch to SES for production volume

**App client:**
- App type: **Public client** (no client secret)
- App client name: `aiuc-web`
- Auth flows: enable `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`
- Callback URL: `https://placeholder.example.com` (update after Step 8)

3. Click **Create user pool**

**Save these values — needed for `.env` and Lambda env vars:**

| Value | Where to find it | Variable name |
|-------|-----------------|---------------|
| User Pool ID | User pool overview page | `VITE_COGNITO_USER_POOL_ID` + `COGNITO_USER_POOL_ID` |
| App Client ID | App integration → App clients | `VITE_COGNITO_CLIENT_ID` + `COGNITO_CLIENT_ID` |
| Region | Top-right of AWS Console | `VITE_AWS_REGION` |

---

## Step 2 — Verify SES Identity

The Lambda sends emails using SES. The sender address must be verified.

1. Open [SES Console](https://console.aws.amazon.com/ses/) → **Verified identities → Create identity**
2. Choose **Email address**
3. Enter: `nachiket.kapure@spearhead.so` (or your sender address)
4. Click **Create identity**
5. Check your inbox → click the verification link

**For full domain verification** (recommended — allows any `@spearhead.so` address):
1. Choose **Domain** instead of Email address
2. Enter: `spearhead.so`
3. Add the provided CNAME DNS records to your domain registrar
4. Wait for DNS propagation (usually <1 hour)

**SES Sandbox vs Production:**

By default, SES is in **Sandbox mode** — you can only send to verified addresses. To send to anyone:
1. SES Console → **Account dashboard → Request production access**
2. Fill in the use case form (takes ~24h)

---

## Step 3 — Create S3 Bucket

1. Open [S3 Console](https://console.aws.amazon.com/s3/) → **Create bucket**

| Setting | Value |
|---------|-------|
| Bucket name | Globally unique, e.g., `aiuc-spearhead-prod` |
| Region | **Same as your Lambda** (e.g., `us-east-2`) |
| Block all public access | **All 4 checkboxes ON** ← required |
| Bucket versioning | Disabled (optional — enable for rollback) |
| Default encryption | SSE-S3 (recommended) |

2. Click **Create bucket**

3. Upload your data files to the **bucket root**:

```bash
aws s3 cp use_cases.json            s3://YOUR-BUCKET/use_cases.json
aws s3 cp industry_use_cases.json   s3://YOUR-BUCKET/industry_use_cases.json
```

Both files must be JSON arrays: `[{ ... }, { ... }]`. Upload `[]` as a placeholder if you have no data yet.

4. (Optional) Set a lifecycle rule to expire old logs:
   - Bucket → Management → Lifecycle rules → Create rule
   - Scope: prefix `logs/`
   - Action: Expire current versions after **90 days**

---

## Step 4 — Create Lambda Function

1. Open [Lambda Console](https://console.aws.amazon.com/lambda/) → **Create function**

| Setting | Value |
|---------|-------|
| Author from scratch | ✓ |
| Function name | `aiuc-frontend` |
| Runtime | **Node.js 20.x** |
| Architecture | x86_64 |
| Execution role | **Create a new role with basic Lambda permissions** |

2. After creation, increase the timeout:
   - **Configuration → General configuration → Edit**
   - Timeout: `1 min 0 sec`
   - Memory: `256 MB` (increase to `512 MB` if cold starts are slow)
   - Click **Save**

---

## Step 5 — Lambda IAM Permissions

The Lambda execution role needs S3 read + write access (data files, logs, token replay protection) and SES send access.

1. Lambda Console → **Configuration → Permissions**
2. Click the **Role name** (opens IAM Console)
3. **Add permissions → Create inline policy**
4. Switch to **JSON** tab and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3DataAndLogs",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    },
    {
      "Sid": "SESSendEmail",
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

Replace `YOUR-BUCKET-NAME` with your actual S3 bucket name.

5. Click **Next** → name it `aiuc-s3-ses-policy` → **Create policy**

---

## Step 6 — Environment Variables

### 6a. Frontend `.env` (baked into bundle at build time)

Create `.env` in the project root. These `VITE_` prefixed values are compiled into JavaScript — you must rebuild and re-upload the frontend after changing them.

```env
# Cognito (must match the user pool and client from Step 1)
VITE_COGNITO_USER_POOL_ID=us-east-2_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-east-2
VITE_REDIRECT_URI=https://xxx.lambda-url.us-east-2.on.aws
```

> If you don't have the Lambda URL yet (Step 8), use a placeholder — update and rebuild after Step 8.

### 6b. Lambda environment variables

Set in **Lambda Console → Configuration → Environment variables → Edit → Add environment variable**.

| Key | Value | Notes |
|-----|-------|-------|
| `BUCKET_NAME` | `aiuc-spearhead-prod` | Your S3 bucket name (not ARN) |
| `S3_REGION` | `us-east-2` | Must match bucket region |
| `DIST_PREFIX` | `dist1` | S3 folder containing built frontend files |
| `SES_FROM_EMAIL` | `nachiket.kapure@spearhead.so` | Must be verified in SES (Step 2) |
| `SES_REGION` | `us-east-2` | Region where SES identity is verified |
| `CONTACT_EMAIL` | `nachiket.kapure@spearhead.so` | Receives contact form submissions |
| `APPROVAL_EMAIL` | `nachiket.kapure@ax-ia.ai` | Receives registration approval requests |
| `APP_URL` | `https://xxx.lambda-url.us-east-2.on.aws` | Your Lambda Function URL (Step 8) |
| `APPROVAL_SECRET` | `a-long-random-secret-string` | Signs/verifies approval tokens — keep secret |
| `COGNITO_USER_POOL_ID` | `us-east-2_XXXXXXXXX` | Must match `VITE_COGNITO_USER_POOL_ID` |
| `COGNITO_CLIENT_ID` | `xxxxxxxxxxxxxxxxxxxxxxxxxx` | Must match `VITE_COGNITO_CLIENT_ID` |
| `USE_CASE_RESTRICTED_COLUMNS` | `AI Algorithms & Frameworks,Datasets,Action / Implementation,AI Tools & Models,Digital Platforms and Tools` | Comma-separated; no spaces around commas |
| `INDUSTRY_RESTRICTED_COLUMNS` | `Implementation Plan,Datasets,AI Tools / Platforms,Digital Tools / Platforms,AI Frameworks,AI Tools and Models,Industry References` | Comma-separated |

---

## Step 7 — Build & Upload

### 7a. Build the frontend

```bash
# From the project root
npm install
npm run build
# Output: dist/ folder
```

### 7b. Upload frontend to S3

The `DIST_PREFIX` Lambda env var controls which folder in S3 to serve from. If `DIST_PREFIX=dist1`:

```bash
aws s3 sync dist/ s3://YOUR-BUCKET-NAME/dist1/ --delete
```

### 7c. Package the Lambda

```bash
cd lambda
npm install --omit=dev    # production deps only
zip -r ../lambda.zip .
cd ..
```

> On Windows, use Git Bash or WSL for the `zip` command. Alternatively, select all files inside `lambda/` and create a zip via File Explorer (the zip must contain `index.mjs` at the root, not inside a subfolder).

### 7d. Upload Lambda code

**Via AWS Console:**
Lambda Console → Code → **Upload from** → **.zip file** → upload `lambda.zip` → **Save**

**Via CLI:**
```bash
aws lambda update-function-code \
  --function-name aiuc-frontend \
  --zip-file fileb://lambda.zip
```

---

## Step 8 — Lambda Function URL

1. Lambda Console → **Configuration → Function URL**
2. Click **Create function URL**

| Setting | Value |
|---------|-------|
| Auth type | **NONE** (public — no IAM signing required) |
| Configure CORS | **✓ Enable** |
| Allow origins | `*` |
| Allow headers | `content-type,authorization` |
| Allow methods | `*` |

3. Click **Save**
4. Copy the Function URL — looks like:
   `https://i55277glxwyi6tmhik5dzvdaiu0czjsa.lambda-url.us-east-2.on.aws`

5. **Update two places with this URL:**

   a. Lambda env var `APP_URL` → set to the Function URL

   b. Frontend `.env` → set `VITE_REDIRECT_URI` to the Function URL, then rebuild:
   ```bash
   npm run build
   aws s3 sync dist/ s3://YOUR-BUCKET/dist1/ --delete
   ```

6. Update the Cognito App Client callback URL:
   Cognito Console → your user pool → **App integration → App clients** → Edit → set callback URL to the Function URL

---

## Step 9 — Verify the Deployment

```bash
# 1. Fetch the homepage — should return HTML
curl https://xxx.lambda-url.us-east-2.on.aws/

# 2. Fetch columns config
curl https://xxx.lambda-url.us-east-2.on.aws/api/columns-config

# 3. Fetch use case data (unauthenticated — restricted columns will be blank)
curl https://xxx.lambda-url.us-east-2.on.aws/api/data/use-cases | head -c 500

# 4. Test contact form
curl -X POST https://xxx.lambda-url.us-east-2.on.aws/api/contact \
  -H "Content-Type: application/json" \
  -d '{"from":"test@example.com","subject":"Test","message":"Hello"}'
```

If any call returns 403 or 500, check Lambda CloudWatch Logs:
Lambda Console → **Monitor → View CloudWatch logs** → latest log stream.

---

## GitHub Actions CI/CD

Pushing to `main` can automatically build and deploy. The workflow file lives at `.github/workflows/deploy.yml`.

### Required GitHub Secrets

Go to: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM deploy user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM deploy user secret key |
| `AWS_REGION` | e.g., `us-east-2` |
| `S3_BUCKET_NAME` | Your S3 bucket name |
| `S3_DIST_PREFIX` | e.g., `dist1` |
| `LAMBDA_FUNCTION_NAME` | e.g., `aiuc-frontend` |
| `VITE_COGNITO_USER_POOL_ID` | From Step 1 |
| `VITE_COGNITO_CLIENT_ID` | From Step 1 |
| `VITE_AWS_REGION` | e.g., `us-east-2` |
| `VITE_REDIRECT_URI` | Your Lambda Function URL |

### IAM user for GitHub Actions (least-privilege)

Create a dedicated IAM user (`aiuc-github-deploy`) with this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["lambda:UpdateFunctionCode"],
      "Resource": "arn:aws:lambda:YOUR-REGION:YOUR-ACCOUNT-ID:function:aiuc-frontend"
    }
  ]
}
```

---

## Configuring Restricted Columns

Restricted columns are shown blurred to unauthenticated users on the frontend, and stripped entirely from API responses server-side.

### Method 1: Lambda env vars (no code change, no redeploy needed)

Edit `USE_CASE_RESTRICTED_COLUMNS` and `INDUSTRY_RESTRICTED_COLUMNS` in Lambda Console → Configuration → Environment variables.

```
USE_CASE_RESTRICTED_COLUMNS = AI Algorithms & Frameworks,Datasets,Action / Implementation
INDUSTRY_RESTRICTED_COLUMNS = Implementation Plan,Datasets,AI Tools / Platforms
```

Rules:
- Comma-separated, **no leading/trailing spaces** around column names
- Column names are **case-sensitive** — must match the JSON data keys exactly
- Changes take effect immediately on the next request

### Method 2: Code defaults (requires rebuild + redeploy)

Edit `src/config/restrictedColumns.ts`:

```typescript
export const USE_CASE_RESTRICTED_COLUMNS: string[] = [
  "AI Algorithms & Frameworks",
  "Datasets",
  // add / remove entries here
];
```

Then rebuild and re-upload frontend + Lambda.

---

## Admin Approval Flow

When a user with a new work email domain registers:

1. User submits the registration form
2. `POST /api/validate-email` checks the domain — non-personal work domains are allowed
3. User sees "Pending Approval" screen
4. Admin receives SES email at `APPROVAL_EMAIL` with Approve and Reject links

**Approve link** (`GET /api/approve?token=...`):
- Verifies HMAC signature (`APPROVAL_SECRET`)
- Checks expiry (7-day TTL embedded in token)
- Checks S3 `used_tokens/` for replay (one-time use)
- Sends user an email with a personal registration link
- User clicks link → bypasses domain approval → completes Cognito signup

**Reject link** (`GET /api/reject?token=...`):
- Sends user a polite rejection email mentioning `CONTACT_EMAIL` for appeals

**If the token expires (after 7 days):** The user must re-submit the registration form to trigger a new approval email.

---

## Viewing Usage Logs

Every user action (search, click, filter, row view) is stored in S3.

**S3 path structure:**
```
s3://YOUR-BUCKET/logs/
├── 2025-04-07/
│   ├── 550e8400-e29b-41d4-a716-446655440000.json
│   └── ...
└── 2025-04-08/
    └── ...
```

**View in AWS Console:**
1. S3 Console → your bucket → `logs/` folder → browse by date

**Download for analysis:**
```bash
# All logs for a specific date
aws s3 sync s3://YOUR-BUCKET/logs/2025-04-07/ ./logs-2025-04-07/

# All logs ever
aws s3 sync s3://YOUR-BUCKET/logs/ ./all-logs/
```

**Logged event types:** `page_view`, `search`, `filter`, `click`, `column_click`, `row_click`, `register`

Each log file contains: `eventId`, `timestamp`, `eventType`, `userEmail`, `userName`, `sessionId`, `data`

---

## Redeployment Cheatsheet

### Only frontend changed (React/TypeScript code, `.env` values)

```bash
npm run build
aws s3 sync dist/ s3://YOUR-BUCKET/dist1/ --delete
```

### Only Lambda changed (`lambda/index.mjs` or `lambda/server.mjs`)

```bash
cd lambda && npm install --omit=dev && zip -r ../lambda.zip . && cd ..
aws lambda update-function-code --function-name aiuc-frontend --zip-file fileb://lambda.zip
```

### Both changed

```bash
# Build frontend
npm run build
aws s3 sync dist/ s3://YOUR-BUCKET/dist1/ --delete

# Package and deploy Lambda
cd lambda && npm install --omit=dev && zip -r ../lambda.zip . && cd ..
aws lambda update-function-code --function-name aiuc-frontend --zip-file fileb://lambda.zip
```

### Only restricted columns changed (no code change needed)

Edit `USE_CASE_RESTRICTED_COLUMNS` or `INDUSTRY_RESTRICTED_COLUMNS` in Lambda Console → Environment variables → Save. Done — no redeploy required.

---

## Troubleshooting

### Lambda returns 403 on all requests
The Function URL policy may be missing. Lambda Console → Configuration → Permissions → Resource-based policy:
- Add statement: Principal `*`, Action `lambda:InvokeFunctionUrl`, Auth type `NONE`

### Lambda returns 500 on `/api/data/*`
- Check `BUCKET_NAME` and `S3_REGION` in Lambda env vars
- Check `DIST_PREFIX` — must match the S3 folder you uploaded `dist/` into
- Ensure Lambda execution role has `s3:GetObject` on your bucket (Step 5)
- View CloudWatch logs for the specific error

### SES "MessageRejected: Email address not verified"
- Verify `SES_FROM_EMAIL` in SES Console (must be same region as `SES_REGION`)
- In sandbox mode: recipient addresses must also be verified
- Request SES production access to send unrestricted

### Approval emails contain localhost in links
Set `APP_URL` in Lambda env vars to the Lambda Function URL (not localhost).

### Authenticated users still see blurred columns
- `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` in Lambda env vars must match the values used when the frontend was built (`VITE_COGNITO_*` in `.env`)
- Rebuild frontend if Cognito pool was recreated

### S3 `AccessDenied` on `s3:PutObject` (logs or token replay)
Lambda execution role is missing `s3:PutObject`. Update the inline policy in IAM Console (Step 5).

### Cold start latency (first request is slow)
Increase Lambda memory (Configuration → General → Memory → 512 MB). Higher memory = faster CPU = shorter cold start. Cost difference is negligible at this scale.

### Registration approval email not received
- Check `APPROVAL_EMAIL` is set correctly in Lambda env vars
- In SES sandbox: `APPROVAL_EMAIL` must also be a verified identity
- Check Lambda CloudWatch logs for SES errors after a registration attempt

---

*Powered by Spearhead • Confidential – Internal Use Only*
