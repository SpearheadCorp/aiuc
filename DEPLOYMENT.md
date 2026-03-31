# AI Use Case Repository — AWS Deployment Guide

This guide covers everything needed to deploy the AI Use Case Repository from scratch on AWS Lambda.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [AWS Services Required](#aws-services-required)
- [Prerequisites](#prerequisites)
- [Step 1 — Create Cognito User Pool](#step-1--create-cognito-user-pool)
- [Step 2 — Create DynamoDB Table](#step-2--create-dynamodb-table)
- [Step 3 — Create S3 Bucket](#step-3--create-s3-bucket)
- [Step 4 — Create Lambda Function](#step-4--create-lambda-function)
- [Step 5 — Lambda IAM Permissions](#step-5--lambda-iam-permissions)
- [Step 6 — Environment Variables](#step-6--environment-variables)
- [Step 7 — Build & Upload](#step-7--build--upload)
- [Step 8 — Set Lambda Function URL](#step-8--set-lambda-function-url)
- [GitHub Actions (CI/CD)](#github-actions-cicd)
- [Configuring Restricted Columns](#configuring-restricted-columns)
- [Admin Approval Flow](#admin-approval-flow)
- [Viewing Usage Logs](#viewing-usage-logs)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
Browser
  │
  └─► Lambda Function URL (HTTPS, no auth)
        │
        ├─ Static files (/, /assets/*)  ──► S3 bucket  (dist/ folder)
        ├─ /api/data/*                  ──► S3 bucket  (use_cases.json, industry_use_cases.json)
        ├─ /api/validate-email          ──► Google Gemini API + SMTP email
        ├─ /api/approve + /api/reject   ──► SMTP email
        ├─ /api/contact                 ──► SMTP email
        └─ /api/log                     ──► DynamoDB table (aiuc-usage-logs)

Browser ──► Cognito User Pool (registration / login — direct SDK call, not via Lambda)
```

---

## AWS Services Required

| Service | Purpose | AWS Free Tier |
|---------|---------|---------------|
| **AWS Lambda** | Serves frontend + all API routes | 1M requests/month free |
| **Amazon S3** | Stores built frontend + JSON data files | 5 GB free |
| **Amazon DynamoDB** | Usage event logging (search, click, register, etc.) | 25 GB free |
| **Amazon Cognito** | User registration and login | 50,000 MAU free |

> No Secrets Manager or Okta required for the current setup.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18.x | https://nodejs.org |
| npm | ≥ 9.x | Comes with Node.js |
| AWS CLI | ≥ 2.x | https://aws.amazon.com/cli/ |
| AWS account | — | https://aws.amazon.com |

```bash
# Verify versions
node --version
npm --version
aws --version

# Configure AWS CLI with your credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (e.g. us-east-2), output format (json)
```

---

## Step 1 — Create Cognito User Pool

1. Open [AWS Cognito Console](https://console.aws.amazon.com/cognito/)
2. Click **Create user pool**
3. Configure as follows:

**Sign-in options:**
- Check **Email**

**Password policy:**
- Minimum 8 characters
- Require: uppercase, lowercase, numbers, symbols

**Multi-factor authentication:** None (optional)

**Required attributes:** `email`, `name`

**Email delivery:** Cognito (free) or SES for production

**App client:**
- App type: **Public client** (no client secret)
- App client name: e.g., `aiuc-web`
- Auth flows to enable: `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH`
- Callback URL: your Lambda Function URL (you'll get this in Step 8 — add it later)

4. Click **Create user pool**

**Note down these values — you'll need them:**
- **User Pool ID** → e.g., `us-east-2_AbCdEfGhI` → `VITE_COGNITO_USER_POOL_ID`
- **App Client ID** → e.g., `1ud7kicq2o4700g3l7v7flajgo` → `VITE_COGNITO_CLIENT_ID`
- **Region** → e.g., `us-east-2` → `VITE_AWS_REGION`

---

## Step 2 — Create DynamoDB Table

1. Open [DynamoDB Console](https://console.aws.amazon.com/dynamodb/)
2. Click **Create table**

| Setting | Value |
|---------|-------|
| Table name | `aiuc-usage-logs` |
| Partition key | `eventId` — type: **String** |
| Sort key | *(leave empty)* |
| Table settings | **Default settings** (On-demand capacity) |

3. Click **Create table**

That's it. The Lambda will write to this table automatically.

---

## Step 3 — Create S3 Bucket

1. Open [S3 Console](https://console.aws.amazon.com/s3/) → **Create bucket**

| Setting | Value |
|---------|-------|
| Bucket name | Globally unique name, e.g., `aiuc-spearhead-prod` |
| Region | **Same region as your Lambda** (e.g., `us-east-2`) |
| Block all public access | **All 4 checkboxes ON** ← important |
| Bucket versioning | Disabled (or enable for rollback capability) |
| Default encryption | SSE-S3 (recommended) |

2. Click **Create bucket**

**Note down:** bucket name → you'll use this as `BUCKET_NAME` in Lambda env vars.

### Upload data files

After creating the bucket, upload your two JSON data files to the **bucket root**:

```bash
aws s3 cp use_cases.json          s3://YOUR-BUCKET-NAME/use_cases.json
aws s3 cp industry_use_cases.json s3://YOUR-BUCKET-NAME/industry_use_cases.json
```

Or upload via the S3 Console → click your bucket → **Upload** → drag files → **Upload**.

Both files must be JSON arrays (e.g., `[{ ... }, { ... }]`). If you have no data yet, upload `[]` as a placeholder.

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

2. Click **Create function**

3. After creation, set the timeout:
   - **Configuration → General configuration → Edit**
   - Set **Timeout** to `1 min 0 sec` (60 seconds)
   - Click **Save**

---

## Step 5 — Lambda IAM Permissions

The Lambda execution role needs S3 read access and DynamoDB write access.

1. In Lambda Console → **Configuration → Permissions**
2. Click the **Role name** link (opens IAM Console in a new tab)
3. Click **Add permissions → Create inline policy**
4. Click the **JSON** tab and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ReadAccess",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    },
    {
      "Sid": "DynamoDBWriteLogs",
      "Effect": "Allow",
      "Action": ["dynamodb:PutItem"],
      "Resource": "arn:aws:dynamodb:YOUR-REGION:YOUR-ACCOUNT-ID:table/aiuc-usage-logs"
    }
  ]
}
```

Replace:
- `YOUR-BUCKET-NAME` → your S3 bucket name
- `YOUR-REGION` → e.g., `us-east-2`
- `YOUR-ACCOUNT-ID` → your 12-digit AWS account ID (visible top-right in AWS Console)

5. Click **Next** → name it `aiuc-s3-dynamo-policy` → **Create policy**

---

## Step 6 — Environment Variables

### 6a. Frontend environment variables (`.env`)

These are **baked into the JavaScript bundle** at build time. Set them before running `npm run build`.

Create a `.env` file in the project root (copy from `.env.example`):

```bash
cp .env.example .env
```

Edit `.env`:

```env
VITE_COGNITO_USER_POOL_ID=us-east-2_XXXXXXXXX       # from Step 1
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx    # from Step 1
VITE_AWS_REGION=us-east-2                            # your AWS region
VITE_REDIRECT_URI=https://xxx.lambda-url.us-east-1.on.aws  # your Lambda URL (from Step 8)
VITE_CONTACT_EMAIL=aiuc@yourcompany.com              # contact email shown in footer
```

> If you don't have the Lambda URL yet (Step 8), set `VITE_REDIRECT_URI` to a placeholder and rebuild after Step 8.

### 6b. Lambda environment variables

Set these in the **Lambda Console → Configuration → Environment variables → Edit → Add environment variable**.

| Key | Value | Notes |
|-----|-------|-------|
| `BUCKET_NAME` | `aiuc-spearhead-prod` | Your S3 bucket name |
| `S3_REGION` | `us-east-2` | Region of your S3 bucket |
| `DIST_PREFIX` | `dist` | Folder in S3 where frontend is uploaded |
| `LOG_TABLE_NAME` | `aiuc-usage-logs` | DynamoDB table name from Step 2 |
| `CONTACT_EMAIL` | `aiuc@yourcompany.com` | Receives contact form messages |
| `APPROVAL_EMAIL` | `admin@yourcompany.com` | Receives registration approval requests (defaults to CONTACT_EMAIL) |
| `WHITELIST_DOMAINS` | `purestorage.com,spearhead.so` | Comma-separated domains — skip AI check, instant access |
| `GEMINI_API_KEY` | `AIzaSy...` | Get free at https://aistudio.google.com/app/apikey |
| `APP_URL` | `https://xxx.lambda-url.us-east-1.on.aws` | Your Lambda Function URL (no trailing slash) |
| `APPROVAL_SECRET` | `change-me-to-a-long-random-string` | Signs approval tokens — use a strong random string |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | `youremail@gmail.com` | SMTP login |
| `SMTP_PASS` | `xxxx xxxx xxxx xxxx` | Gmail App Password (not your regular password) |
| `SMTP_FROM` | `noreply@yourcompany.com` | From address on sent emails |

**Getting a Gmail App Password:**
1. Go to [Google Account](https://myaccount.google.com/) → Security
2. Enable 2-Step Verification (if not already)
3. Go to Security → App passwords
4. Generate a password for "Mail" → copy the 16-character code → paste as `SMTP_PASS`

---

## Step 7 — Build & Upload

### 7a. Build the frontend

```bash
# From the project root
npm install
npm run build
# Creates: dist/ folder
```

### 7b. Package the Lambda

```bash
cd lambda
npm install --omit=dev
zip -r ../lambda.zip .
cd ..
```

### 7c. Upload frontend to S3

```bash
aws s3 sync dist/ s3://YOUR-BUCKET-NAME/dist/ --delete
```

### 7d. Upload Lambda code

```bash
aws lambda update-function-code \
  --function-name aiuc-frontend \
  --zip-file fileb://lambda.zip
```

Or via Console: **Lambda → Code → Upload from → .zip file** → upload `lambda.zip`.

---

## Step 8 — Set Lambda Function URL

1. In Lambda Console → **Configuration → Function URL**
2. Click **Create function URL** (or **Edit** if it exists)

| Setting | Value |
|---------|-------|
| Auth type | **NONE** |
| Configure cross-origin resource sharing (CORS) | **✓ Enable** |
| Allow origin | `*` |
| Allow headers | `content-type` |
| Allow methods | `*` |

3. Click **Save**
4. Copy the **Function URL** — it looks like:
   `https://xxxxxxxxxxxxxxxx.lambda-url.us-east-1.on.aws`

5. **Update two places with this URL:**
   - Lambda env var: `APP_URL` → set to this URL
   - Frontend `.env`: `VITE_REDIRECT_URI` → set to this URL
   - **Rebuild and re-upload** after updating `.env`:
     ```bash
     npm run build
     aws s3 sync dist/ s3://YOUR-BUCKET-NAME/dist/ --delete
     ```

6. Also go to Cognito Console → your User Pool → **App client** → edit the callback URL to this Function URL.

---

## GitHub Actions (CI/CD)

Pushing to `main` automatically builds and deploys. The workflow file is at `.github/workflows/deploy.yml`.

### Required GitHub Secrets

Go to: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM deploy user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM deploy user secret key |
| `AWS_REGION` | e.g., `us-east-2` |
| `S3_BUCKET_NAME` | Your S3 bucket name |
| `LAMBDA_FUNCTION_NAME` | e.g., `aiuc-frontend` |
| `VITE_COGNITO_USER_POOL_ID` | From Step 1 |
| `VITE_COGNITO_CLIENT_ID` | From Step 1 |
| `VITE_REDIRECT_URI` | Your Lambda Function URL |
| `VITE_CONTACT_EMAIL` | Contact email for footer |

### IAM user for GitHub Actions (least-privilege)

Create a dedicated IAM user for CI with this policy:

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

Edit **`src/config/restrictedColumns.ts`** — this is the only file you need to change:

```typescript
// Blurred columns in the Case Study table for unauthenticated users
export const USE_CASE_RESTRICTED_COLUMNS: string[] = [
  "AI Algorithms & Frameworks",
  "Action / Implementation",
  "Datasets",
  "AI Tools & Models",
  // add or remove column names here
];

// Blurred columns in the Industry Data table
export const INDUSTRY_RESTRICTED_COLUMNS: string[] = [
  "Implementation Plan",
  "Datasets",
  "AI Tools / Platforms",
  // add or remove column names here
];
```

Column names must match exactly what appears in the JSON data (case-sensitive). Rebuild and redeploy after changes.

---

## Admin Approval Flow

When a user registers with a work email that isn't whitelisted, Google Gemini classifies the domain:

| AI Confidence | Outcome |
|---------------|---------|
| > 80% | Auto-approved — user proceeds to create a Cognito account immediately |
| 10–80% | User sees "Pending Approval" screen; admin gets an email with Approve + Reject links |
| < 10% | Auto-rejected — user sees a blocked screen |

**Admin email example (pending review):**
```
Subject: [AIUC] Registration — breakfree.com | Needs Review (65%)

Registrant  : Harsh Joshi <harsh@breakfree.com>
Confidence  : 65%
Recommended : Review

  ✅ APPROVE: https://your-lambda-url.on.aws/api/approve?token=...
  ❌ REJECT:  https://your-lambda-url.on.aws/api/reject?token=...
```

- **Approve** → user receives an email with their personal registration link (valid 7 days)
- **Reject** → user receives a polite denial email mentioning `CONTACT_EMAIL` for appeals
- Both tokens expire after **7 days** — request a new one if expired

---

## Viewing Usage Logs

Every user interaction is logged to DynamoDB automatically.

**In AWS Console:**
1. [DynamoDB Console](https://console.aws.amazon.com/dynamodb/) → Tables → `aiuc-usage-logs`
2. Click **Explore table items**

**Events logged:**

| Event | When |
|-------|------|
| `page_view` | Every app load |
| `search` | Every search query |
| `filter` | Every column filter applied |
| `click` | Tab switches, button clicks |
| `column_click` | Column header clicked |
| `row_click` | Row expanded |
| `register` | Successful Cognito signup |

Each record has: `eventId`, `timestamp`, `eventType`, `userEmail`, `userName`, `sessionId`, `data`.

**Export all logs:**
```bash
aws dynamodb scan \
  --table-name aiuc-usage-logs \
  --output json > logs-export.json
```

---

## Troubleshooting

### Blurred columns still show after registration
The Cognito session check is async. Wait for the orange spinner to disappear — it checks session on every load. If it persists, clear `localStorage` in browser devtools and reload.

### Emails not sending
- Check `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in Lambda env vars
- For Gmail, `SMTP_PASS` must be an **App Password** (16 chars with spaces), not your account password
- Check Lambda CloudWatch logs: **Lambda Console → Monitor → View CloudWatch logs**

### Registration link in approval email points to localhost
Update `APP_URL` in Lambda env vars to your Lambda Function URL (not localhost).

### Lambda returns 500 on /api/validate-email
- Verify `GEMINI_API_KEY` is set and valid
- Lambda timeout may be too short — ensure it's set to 60 seconds

### Lambda Function URL returns 403
The resource-based policy may be missing. In Lambda Console:
- **Configuration → Permissions → Resource-based policy statements → Add permissions**
- Principal: `*`, Action: `lambda:InvokeFunctionUrl`, Auth type: `NONE`

### DynamoDB PutItem AccessDenied in logs
The Lambda execution role is missing `dynamodb:PutItem`. Re-apply the inline policy from [Step 5](#step-5--lambda-iam-permissions).

### Local dev — /api returns "connection refused"
Ensure `npm run dev:api` is running in a second terminal. Check `lambda/.env` exists and has valid values.

---

*Powered by Spearhead • Confidential – Internal Use Only*
