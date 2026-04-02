<p align="center">
  <img src="public/assets/purelogo.png" alt="Pure Storage" width="300" />
</p>

<h1 align="center">AI Use Case Repository (AIUC)</h1>

<p align="center">
  <strong>Internal AI use case &amp; industry data dashboard — secured with Okta + AWS IAM</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/AWS_Lambda-FF9900?style=for-the-badge&logo=awslambda&logoColor=white" />
  <img src="https://img.shields.io/badge/Amazon_S3-569A31?style=for-the-badge&logo=amazons3&logoColor=white" />
  <img src="https://img.shields.io/badge/Okta-007DC1?style=for-the-badge&logo=okta&logoColor=white" />
</p>

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [One-Time AWS Setup](#one-time-aws-setup)
  - [Step 1 — Create S3 Bucket](#step-1--create-s3-bucket)
  - [Step 2 — Create Lambda Function](#step-2--create-lambda-function)
  - [Step 3 — Configure Okta (AWS Secrets Manager)](#step-3--configure-okta-aws-secrets-manager)
  - [Step 4 — Attach IAM Policies to Lambda](#step-4--attach-iam-policies-to-lambda)
  - [Step 5 — Configure Lambda Function URL](#step-5--configure-lambda-function-url)
- [Deployment](#deployment)
  - [Option A — Manual Deployment](#option-a--manual-deployment)
  - [Option B — GitHub Actions (Automated)](#option-b--github-actions-automated)
- [Lambda Environment Variables](#lambda-environment-variables)
- [Sub-Path Deployment (ALB / Reverse Proxy)](#sub-path-deployment-alb--reverse-proxy)
- [S3 Bucket Structure](#s3-bucket-structure)
- [Granting User Access](#granting-user-access)
- [Testing the Deployment](#testing-the-deployment)
- [Deployment Checklist](#deployment-checklist)

---

## Overview

The **AI Use Case Repository** is an internal React dashboard that surfaces AI use case data and industry-specific AI implementation records. It is served through an **AWS Lambda Function URL** and secured with **Okta OIDC authentication**. All data is stored in a private **Amazon S3** bucket — users never access S3 directly.

> **Confidential — Internal Use Only**

---

## Architecture

```
Browser (Okta login)
    │
    ▼
Lambda Function URL  ──►  AWS Lambda (Node.js 20)
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
             Static files           Data & Config APIs
          (dist/ from S3)      /api/data/use-cases
                                /api/data/industry
                                /api/okta-config
                                /api/contact
                    │
                    ▼
            S3 Bucket (private)
            ├── dist/           ← built React app
            ├── use_cases.json
            └── industry_use_cases.json
```

- **Lambda** acts as a secure proxy — it reads from S3 using its IAM execution role
- **Okta credentials** are stored in AWS Secrets Manager, never hardcoded
- **No direct S3 access** — bucket blocks all public access

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 18.x | Build the frontend |
| npm | ≥ 9.x | Package management |
| AWS CLI | any | Deploy to AWS |
| AWS Account | — | Lambda, S3, IAM, Secrets Manager |

```bash
# Verify installations
node --version
npm --version
aws --version

# Configure AWS CLI
aws configure
# Enter: Access Key ID, Secret Access Key, Region (e.g. us-east-2), output format (json)
```

---

## Local Development

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start dev server (proxies /api to localhost:3001)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview
```

> The `/api/*` routes won't return data in local dev unless you run the Lambda locally or point `VITE_API_BASE_URL` at your deployed Lambda URL.

---

## One-Time AWS Setup

Do these steps **once** when setting up a new environment. Skip any step if the resource already exists.

---

### Step 1 — Create S3 Bucket

1. Open [S3 Console](https://console.aws.amazon.com/s3/) → **Create bucket**
2. Use these settings:

| Setting | Value |
|---------|-------|
| Bucket name | Globally unique, e.g. `aiuc-yourorg` |
| AWS Region | Same region you will use for Lambda (e.g. `us-east-2`) |
| Object Ownership | ACLs disabled (Bucket owner enforced) |
| Block Public Access | **Block all public access** — all 4 checkboxes ON |
| Versioning | Disabled (or enable for rollback capability) |
| Encryption | SSE-S3 (default) |

3. Click **Create bucket**

> Public access must stay blocked. The Lambda execution role accesses S3 via IAM — no public access is needed.

---

### Step 2 — Create Lambda Function

1. Open [Lambda Console](https://console.aws.amazon.com/lambda/) → **Create function**
2. Choose **Author from scratch** with these settings:

| Setting | Value |
|---------|-------|
| Function name | e.g. `aiuc-frontend` |
| Runtime | **Node.js 20.x** |
| Architecture | x86_64 |
| Execution role | Create a new role with basic Lambda permissions |

3. Click **Create function**
4. In **Configuration → General configuration** → **Edit** → set **Timeout** to `60` seconds → **Save**

---

### Step 3 — Configure Okta (AWS Secrets Manager)

Okta credentials are **never hardcoded**. The `OKTA_CLIENT_ID` is stored in Secrets Manager and fetched at runtime by the Lambda via the `/api/okta-config` endpoint.

#### 3a — Create the Secret

1. Open [Secrets Manager Console](https://console.aws.amazon.com/secretsmanager/) → **Store a new secret**
2. Choose **Other type of secret**
3. Add this key/value pair:

| Key | Value |
|-----|-------|
| `OKTA_CLIENT_ID` | Your Okta Client ID (from your Okta admin) |

4. Click **Next**
5. Set **Secret name** — use a name you will also set as `AIUC_SECRET_NAME` in Lambda (e.g. `aiuc/okta`)
6. Leave rotation disabled → **Next** → **Store**

#### 3b — Grant Lambda Permission to Read the Secret

1. Lambda Console → **Configuration** → **Permissions** → click the **Execution role** link (opens IAM)
2. Click **Add permissions** → **Create inline policy** → **JSON** tab → paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:SECRET_NAME*"
    }
  ]
}
```

Replace `REGION` (e.g. `us-east-2`), `ACCOUNT_ID` (12-digit number, top-right in AWS Console), and `SECRET_NAME` (e.g. `aiuc/okta`).

3. Click **Next** → name it `aiuc-secrets-manager-read` → **Create policy**

---

### Step 4 — Attach IAM Policies to Lambda

The Lambda execution role needs read access to S3. Without this you will get **500 Internal Server Error**.

1. Lambda Console → **Configuration** → **Permissions** → click the **Execution role** link
2. Click **Add permissions** → **Create inline policy** → **JSON** tab → paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME",
        "arn:aws:s3:::YOUR_BUCKET_NAME/*"
      ]
    }
  ]
}
```

Replace `YOUR_BUCKET_NAME` with your actual bucket name.

3. Click **Next** → name it `aiuc-s3-read` → **Create policy**

---

### Step 5 — Configure Lambda Function URL

#### Option A — Public Access (no IAM signing required)

1. Lambda Console → **Configuration** → **Function URL** → **Create function URL**
2. Set **Auth type** to `NONE`
3. Under **Additional settings**, enable **CORS** and set origin to `*`
4. Click **Save**
5. Go to **Configuration** → **Permissions** → **Resource-based policy statements** → **Add permissions**:
   - Policy statement: `Function URL`
   - Auth type: `NONE`
   - Principal: `*`
   - Action: `lambda:InvokeFunctionUrl`
6. Click **Save**

#### Option B — IAM Authentication (more secure)

1. Lambda Console → **Configuration** → **Function URL** → **Create function URL**
2. Set **Auth type** to `AWS_IAM`
3. Click **Save**

With IAM auth, users must sign requests with SigV4. See [Granting User Access](#granting-user-access) below.

---

## Deployment

### Option A — Manual Deployment

Run these commands every time you push a new version.

#### 1. Build the frontend

```bash
# Standard deployment (app at root /)
npm run build

# Sub-path deployment (e.g. behind ALB at /app/aiuc) — see Sub-Path section
VITE_BASE_PATH=/app/aiuc npm run build
```

#### 2. Upload built files to S3

```bash
# Upload dist/ folder to s3://YOUR_BUCKET/dist/
aws s3 sync dist/ s3://YOUR_BUCKET_NAME/dist/ --delete

# Upload JSON data files to bucket root (first time only, or when data changes)
aws s3 cp use_cases.json s3://YOUR_BUCKET_NAME/use_cases.json
aws s3 cp industry_use_cases.json s3://YOUR_BUCKET_NAME/industry_use_cases.json
```

#### 3. Package the Lambda function

```bash
cd lambda
npm install --omit=dev
zip -r ../lambda.zip .
cd ..
```

#### 4. Deploy Lambda code

```bash
aws lambda update-function-code \
  --function-name YOUR_LAMBDA_FUNCTION_NAME \
  --zip-file fileb://lambda.zip
```

#### 5. Set Lambda environment variables (first time or when values change)

```bash
aws lambda update-function-configuration \
  --function-name YOUR_LAMBDA_FUNCTION_NAME \
  --environment "Variables={
    BUCKET_NAME=YOUR_BUCKET_NAME,
    S3_REGION=us-east-2,
    DIST_PREFIX=dist,
    OKTA_ISSUER=https://YOUR_OKTA_DOMAIN/oauth2/default,
    AIUC_SECRET_NAME=aiuc/okta,
    CONTACT_EMAIL=aiuc@yourorg.com,
    SMTP_HOST=smtp.gmail.com,
    SMTP_PORT=587,
    SMTP_USER=your@email.com,
    SMTP_PASS=your_app_password,
    SMTP_FROM=your@email.com
  }"
```

> It is easier to set these in the AWS Console — see [Lambda Environment Variables](#lambda-environment-variables) below.

---

### Option B — GitHub Actions (Automated)

Every push to `main` automatically builds, uploads to S3, and redeploys Lambda.

#### Setup — Add GitHub Secrets (one time)

Go to your repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret** and add:

| Secret Name | Example Value | Description |
|-------------|---------------|-------------|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | `wJal...` | IAM user secret key |
| `AWS_REGION` | `us-east-2` | AWS region |
| `S3_BUCKET_NAME` | `aiuc-yourorg` | S3 bucket name |
| `LAMBDA_FUNCTION_NAME` | `aiuc-frontend` | Lambda function name |

Once these are set, push to `main` and the workflow in `.github/workflows/deploy.yml` handles the rest.

---

## Lambda Environment Variables

Set these in **Lambda Console → Configuration → Environment variables → Edit**.

### Required Variables

| Key | Example Value | Description |
|-----|---------------|-------------|
| `BUCKET_NAME` | `aiuc-yourorg` | S3 bucket storing frontend assets and JSON data |
| `S3_REGION` | `us-east-2` | AWS region of the S3 bucket |
| `DIST_PREFIX` | `dist` | Folder inside S3 bucket containing the built frontend |
| `OKTA_ISSUER` | `https://yourcompany.okta.com/oauth2/default` | Okta issuer URL — get from your Okta admin |
| `AIUC_SECRET_NAME` | `aiuc/okta` | AWS Secrets Manager secret name holding `OKTA_CLIENT_ID` |

### Email / Contact Form Variables

| Key | Example Value | Description |
|-----|---------------|-------------|
| `CONTACT_EMAIL` | `aiuc@yourorg.com` | Address that receives contact form submissions |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port (587 for TLS, 465 for SSL) |
| `SMTP_USER` | `sender@gmail.com` | SMTP login username |
| `SMTP_PASS` | `app_password` | SMTP password or app password |
| `SMTP_FROM` | `sender@gmail.com` | From address on outgoing emails (defaults to `SMTP_USER`) |

### Optional Variables

| Key | Example Value | Description |
|-----|---------------|-------------|
| `BASE_PATH` | `/app/aiuc` | **Only needed** when app is deployed at a sub-path behind an ALB or reverse proxy. Leave **unset** for standard Lambda Function URL deployment at root `/`. |

> **Do not** set `VITE_BASE_PATH` in Lambda — it is a build-time variable only used during `npm run build`.

---

## Sub-Path Deployment (ALB / Reverse Proxy)

If your organisation routes traffic through an ALB or internal portal where the app lives at a sub-path (e.g. `/app/aiuc`) instead of root `/`, two extra steps are required:

### 1. Build with base path

```bash
VITE_BASE_PATH=/app/aiuc npm run build
```

This tells Vite to prefix all asset URLs in the built HTML with `/app/aiuc/assets/*` instead of `/assets/*`.

### 2. Add BASE_PATH to Lambda environment variables

In Lambda Console → **Configuration** → **Environment variables** → **Edit** → add:

| Key | Value |
|-----|-------|
| `BASE_PATH` | `/app/aiuc` |

This tells the Lambda to strip the `/app/aiuc` prefix from incoming request paths before looking up files in S3.

**Example without BASE_PATH (standard setup):**
```
Request:  GET /assets/index.js
S3 key:   dist/assets/index.js  ✓
```

**Example with BASE_PATH=/app/aiuc:**
```
Request:  GET /app/aiuc/assets/index.js
Stripped: /assets/index.js
S3 key:   dist/assets/index.js  ✓
```

---

## S3 Bucket Structure

After a full deployment your bucket should look like this:

```
your-bucket/
├── dist/                        ← uploaded by: aws s3 sync dist/ s3://bucket/dist/
│   ├── index.html
│   └── assets/
│       ├── index-xxxxx.js
│       ├── index-xxxxx.css
│       └── ...
├── use_cases.json               ← uploaded manually to bucket root
└── industry_use_cases.json      ← uploaded manually to bucket root
```

The `DIST_PREFIX=dist` Lambda env var tells the handler where to find `index.html` and assets inside the bucket.

The two JSON files must be at the **bucket root** (not inside `dist/`). The dashboard loads but shows empty tables if these files are missing — place `[]` in each file as a placeholder if you have no data yet.

---

## Granting User Access

### For IAM-authenticated Lambda Function URL (Option B)

Create and attach this policy to each IAM user or role that needs access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunctionUrl",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT_ID:function:LAMBDA_FUNCTION_NAME"
    }
  ]
}
```

```bash
# Attach to a user
aws iam attach-user-policy \
  --user-name USERNAME \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/POLICY_NAME

# Attach to a role
aws iam attach-role-policy \
  --role-name ROLE_NAME \
  --policy-arn arn:aws:iam::ACCOUNT_ID:policy/POLICY_NAME
```

### For public Function URL (Option A)

No IAM policy needed — Okta handles authentication at the application level.

---

## Testing the Deployment

### 1. Verify Okta config endpoint

```bash
curl https://YOUR_LAMBDA_URL.lambda-url.us-east-2.on.aws/api/okta-config
```

Expected response:
```json
{ "issuer": "https://yourcompany.okta.com/oauth2/default", "clientId": "0oaXXXXXX" }
```

### 2. Verify data endpoints

```bash
curl https://YOUR_LAMBDA_URL.lambda-url.us-east-2.on.aws/api/data/use-cases
curl https://YOUR_LAMBDA_URL.lambda-url.us-east-2.on.aws/api/data/industry
```

Both should return a JSON array. Empty array `[]` means the JSON file exists but has no data.

### 3. Open the app in a browser

Navigate to your Lambda Function URL — you should see the Okta login screen, then the dashboard after signing in.

### 4. Test that S3 is not publicly accessible

```bash
aws s3 ls s3://YOUR_BUCKET_NAME/ --no-sign-request
# Expected: AccessDenied error
```

---

## Deployment Checklist

Use this before going live or after any update:

**Build & Upload**
- [ ] Ran `npm run build` (with `VITE_BASE_PATH` if deploying at sub-path)
- [ ] Uploaded `dist/` to `s3://BUCKET_NAME/dist/` via `aws s3 sync`
- [ ] `use_cases.json` present at S3 bucket root
- [ ] `industry_use_cases.json` present at S3 bucket root

**Lambda**
- [ ] Packaged `lambda.zip` from the `lambda/` folder
- [ ] Uploaded `lambda.zip` to Lambda function
- [ ] All required environment variables set (see [Lambda Environment Variables](#lambda-environment-variables))
- [ ] `DIST_PREFIX` = `dist`
- [ ] `BUCKET_NAME` matches your S3 bucket name
- [ ] `S3_REGION` matches your S3 bucket region

**IAM & Secrets**
- [ ] Lambda execution role has `aiuc-s3-read` inline policy (S3 GetObject + ListBucket)
- [ ] Lambda execution role has `aiuc-secrets-manager-read` inline policy
- [ ] Secret created in Secrets Manager with key `OKTA_CLIENT_ID`
- [ ] `AIUC_SECRET_NAME` in Lambda matches the secret name in Secrets Manager

**Verification**
- [ ] `/api/okta-config` returns correct `issuer` and `clientId`
- [ ] App loads and Okta login works in browser
- [ ] Direct S3 access returns AccessDenied

---

<p align="center">
  <sub>Powered by <strong>Spearhead</strong> • Confidential – Internal Use Only</sub>
</p>
