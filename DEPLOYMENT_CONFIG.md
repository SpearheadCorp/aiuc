# AIUC – Deployment Configuration Guide

> This document covers **all configuration decisions** needed to deploy the AIUC app.
> For full step-by-step AWS setup instructions (creating S3 bucket, Lambda, IAM roles, etc.) refer to **README.md**.

---

## Repository

**GitHub:** `https://github.com/SpearheadCorp/aiuc`
**Branch to deploy:** `feature/okta-auth-ui-enhancements`

```bash
git clone https://github.com/SpearheadCorp/aiuc.git
cd aiuc
git checkout feature/okta-auth-ui-enhancements
```

---

## Current Test Deployment

| Item | Value |
|------|-------|
| Lambda Function URL | `https://i55277glxwyi6tmhik5dzvdaiu0czjsa.lambda-url.us-east-2.on.aws/` |
| S3 Bucket | `auic` |
| AWS Region | `us-east-2` |
| Lambda Function Name | `dev-aiuc-frontend` |

---

## Section 1 — Frontend Build Variables (`.env`)

These are **build-time only** — they get baked into the compiled frontend during `npm run build`. They are **not** set in the Lambda console.

Create a `.env` file in the project root (or set them as GitHub Actions secrets for CI/CD):

```env
# Contact form display
VITE_CONTACT_EMAIL=aiuc@purestorage.com
VITE_EMAIL_TOOLTIP_TEXT=I'm interested — contact me

# Only needed when deploying at a sub-path (e.g. behind an ALB at /app/aiuc)
# Leave this out for standard Lambda Function URL deployment at root /
# VITE_BASE_PATH=/app/aiuc
```

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CONTACT_EMAIL` | No | Contact email shown in the UI footer. Defaults to `aiuc@purestorage.com` |
| `VITE_EMAIL_TOOLTIP_TEXT` | No | Tooltip on the contact icon. Defaults to `I'm interested — contact me` |
| `VITE_BASE_PATH` | No | Base URL path prefix for asset URLs. Only set when app is deployed at a sub-path (see Section 5). Leave **unset** for standard deployment |

> After changing any `.env` value, you must run `npm run build` again and re-upload `dist/` to S3.

> `VITE_OKTA_ISSUER` and `VITE_OKTA_CLIENT_ID` are **not used** in the frontend `.env`. Okta credentials are fetched securely at runtime from AWS Secrets Manager via `/api/okta-config`.

---

## Section 2 — Lambda Environment Variables

Set these in **AWS Lambda Console → Configuration → Environment variables → Edit**.

### 2a. Core Variables (Required)

| Key | Value | Description |
|-----|-------|-------------|
| `BUCKET_NAME` | `auic` | S3 bucket name storing frontend assets and JSON data |
| `S3_REGION` | `us-east-2` | AWS region of your S3 bucket and Secrets Manager |
| `DIST_PREFIX` | `dist` | Folder inside S3 bucket containing the built React app |

### 2b. Okta Authentication (Required)

| Key | Value | Description |
|-----|-------|-------------|
| `OKTA_ISSUER` | `https://yourcompany.okta.com/oauth2/default` | Okta issuer URL — get from your Okta admin |
| `AIUC_SECRET_NAME` | `aiuc/okta` | AWS Secrets Manager secret name holding `OKTA_CLIENT_ID` |

> `OKTA_CLIENT_ID` is **not** set here — it lives in Secrets Manager. See Section 3.

### 2c. Email / Contact Form (Required for contact form to work)

| Key | Value | Description |
|-----|-------|-------------|
| `CONTACT_EMAIL` | `aiuc@purestorage.com` | Destination address for contact form submissions |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port (587 for TLS) |
| `SMTP_USER` | `sender@gmail.com` | SMTP login username |
| `SMTP_PASS` | `your_app_password` | SMTP password or app-specific password |
| `SMTP_FROM` | `sender@gmail.com` | From address on outgoing emails (defaults to `SMTP_USER` if unset) |

> For Gmail: use an **App Password** (not your main Gmail password). Generate one at Google Account → Security → 2-Step Verification → App passwords.

### 2d. Optional Variables

| Key | Value | Description |
|-----|-------|-------------|
| `BASE_PATH` | `/app/aiuc` | **Only set this** when deploying behind an ALB or reverse proxy at a sub-path. Leave **unset** for standard Lambda Function URL deployment at root `/`. See Section 5. |

### Complete Environment Variables Reference Table

| Key | Example | Required | Notes |
|-----|---------|----------|-------|
| `BUCKET_NAME` | `auic` | Yes | |
| `S3_REGION` | `us-east-2` | Yes | |
| `DIST_PREFIX` | `dist` | Yes | Always set to `dist` |
| `OKTA_ISSUER` | `https://company.okta.com/oauth2/default` | Yes | |
| `AIUC_SECRET_NAME` | `aiuc/okta` | Yes | Must match secret name in Secrets Manager |
| `CONTACT_EMAIL` | `aiuc@purestorage.com` | Yes | |
| `SMTP_HOST` | `smtp.gmail.com` | Yes | |
| `SMTP_PORT` | `587` | Yes | |
| `SMTP_USER` | `sender@gmail.com` | Yes | |
| `SMTP_PASS` | `app_password` | Yes | |
| `SMTP_FROM` | `sender@gmail.com` | No | Defaults to `SMTP_USER` |
| `BASE_PATH` | `/app/aiuc` | No | Only for sub-path deployments |

---

## Section 3 — Okta Authentication (AWS Secrets Manager)

The `OKTA_CLIENT_ID` is **never hardcoded** in code or Lambda env vars. It is stored in AWS Secrets Manager and fetched at runtime.

### How it works

```
Browser  →  GET /api/okta-config
         →  Lambda reads OKTA_ISSUER from env var
         →  Lambda reads AIUC_SECRET_NAME from env var
         →  Lambda calls Secrets Manager → gets OKTA_CLIENT_ID
         →  Returns { issuer, clientId } to browser
         →  Browser initializes Okta SDK
```

### Step 1 — Create the secret

1. AWS Console → **Secrets Manager** → **Store a new secret**
2. Choose **Other type of secret**
3. Add key/value:

   | Key | Value |
   |-----|-------|
   | `OKTA_CLIENT_ID` | Your Okta Client ID from your Okta admin |

4. Click **Next** → set **Secret name** to `aiuc/okta` (this must match `AIUC_SECRET_NAME` in Lambda)
5. Leave rotation disabled → **Next** → **Store**

### Step 2 — Grant Lambda permission to read the secret

1. Lambda Console → **Configuration** → **Permissions** → click the **Execution role** link
2. **Add permissions** → **Create inline policy** → **JSON** tab:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:aiuc/okta*"
    }
  ]
}
```

Replace `REGION` and `ACCOUNT_ID` (12-digit number shown top-right in AWS Console).

3. Name it `aiuc-secrets-manager-read` → **Create policy**

### Step 3 — Verify

```bash
curl https://YOUR_LAMBDA_URL.lambda-url.us-east-2.on.aws/api/okta-config
```

Expected:
```json
{ "issuer": "https://yourcompany.okta.com/oauth2/default", "clientId": "0oaXXXXXXXX" }
```

---

## Section 4 — S3 Bucket Structure

```
auic/  (your bucket)
├── dist/                        ← upload: aws s3 sync dist/ s3://auic/dist/
│   ├── index.html
│   └── assets/
│       ├── index-xxxxx.js
│       ├── index-xxxxx.css
│       └── (images, fonts, etc.)
├── use_cases.json               ← upload to bucket ROOT (not inside dist/)
└── industry_use_cases.json      ← upload to bucket ROOT (not inside dist/)
```

### Uploading data files

Upload via S3 Console (drag and drop to bucket root) or via CLI:

```bash
aws s3 cp use_cases.json s3://auic/use_cases.json
aws s3 cp industry_use_cases.json s3://auic/industry_use_cases.json
```

**Data file format:**

`use_cases.json` — array of use case objects:
```json
[
  { "capability": 1, "business_function": "Finance", "ai_use_case": "...", ... }
]
```

`industry_use_cases.json` — array of industry objects:
```json
[
  { "id": "1", "industry": "Healthcare", "ai_use_case": "...", ... }
]
```

Place `[]` in each file if you have no data yet — the app will load with empty tables.

---

## Section 5 — Sub-Path Deployment (ALB / Reverse Proxy)

**Only follow this section if your organisation deploys the app at a sub-path** (e.g. `/app/aiuc`) behind an internal ALB or portal, not at the root `/`.

For standard Lambda Function URL deployment, **skip this section entirely**.

### What changes and why

| Without sub-path | With sub-path (`/app/aiuc`) |
|-----------------|----------------------------|
| App at root `/` | App at `/app/aiuc` |
| Assets at `/assets/file.js` | Assets at `/app/aiuc/assets/file.js` |
| Lambda receives `/assets/file.js` | Lambda receives `/app/aiuc/assets/file.js` |
| No stripping needed | Must strip `/app/aiuc` prefix before S3 lookup |

### Step 1 — Build with base path

```bash
VITE_BASE_PATH=/app/aiuc npm run build
```

This makes Vite prefix all asset URLs in the HTML output with `/app/aiuc/`.

### Step 2 — Add BASE_PATH to Lambda

In Lambda Console → **Configuration** → **Environment variables** → **Edit** → add:

| Key | Value |
|-----|-------|
| `BASE_PATH` | `/app/aiuc` |

The Lambda handler strips this prefix from every incoming request path before looking up the file in S3.

### Step 3 — Upload dist/ as normal

```bash
aws s3 sync dist/ s3://YOUR_BUCKET/dist/ --delete
```

No change to S3 structure — the stripping happens at runtime in Lambda, not in S3.

---

## Section 6 — Build & Deploy Commands

### Standard deployment (root `/`)

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Build frontend
npm run build

# 3. Upload dist to S3
aws s3 sync dist/ s3://auic/dist/ --delete

# 4. Package Lambda
cd lambda
npm install --omit=dev
zip -r ../lambda.zip .
cd ..

# 5. Deploy Lambda
aws lambda update-function-code \
  --function-name dev-aiuc-frontend \
  --zip-file fileb://lambda.zip
```

### Sub-path deployment (`/app/aiuc`)

Same as above but replace step 2 with:

```bash
VITE_BASE_PATH=/app/aiuc npm run build
```

And also set `BASE_PATH=/app/aiuc` in Lambda environment variables.

---

## Section 7 — GitHub Actions (Automated CI/CD)

Every push to `main` automatically runs the full build and deploy pipeline via `.github/workflows/deploy.yml`.

### Required GitHub Secrets

Go to repo → **Settings** → **Secrets and variables** → **Actions** → add:

| Secret | Example | Description |
|--------|---------|-------------|
| `AWS_ACCESS_KEY_ID` | `AKIA...` | IAM user access key ID |
| `AWS_SECRET_ACCESS_KEY` | `wJal...` | IAM user secret access key |
| `AWS_REGION` | `us-east-2` | AWS region |
| `S3_BUCKET_NAME` | `auic` | S3 bucket name |
| `LAMBDA_FUNCTION_NAME` | `dev-aiuc-frontend` | Lambda function name |

---

## Section 8 — IAM Policies Summary

Two inline policies must be attached to the Lambda execution role:

### Policy 1 — S3 Read Access (`aiuc-s3-read`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::auic",
        "arn:aws:s3:::auic/*"
      ]
    }
  ]
}
```

### Policy 2 — Secrets Manager Read (`aiuc-secrets-manager-read`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-2:ACCOUNT_ID:secret:aiuc/okta*"
    }
  ]
}
```

---

## Section 9 — Deployment Checklist

### First-time setup

- [ ] S3 bucket created with **Block all public access** enabled
- [ ] Lambda function created with **Node.js 20.x**, timeout set to **60 seconds**
- [ ] `aiuc-s3-read` inline policy attached to Lambda execution role (Section 8)
- [ ] Secret `aiuc/okta` created in Secrets Manager with key `OKTA_CLIENT_ID` (Section 3 — Step 1)
- [ ] `aiuc-secrets-manager-read` inline policy attached to Lambda execution role (Section 3 — Step 2)
- [ ] Lambda Function URL configured (Auth type: `NONE` for public, `AWS_IAM` for restricted)
- [ ] All Lambda environment variables set (Section 2)

### Every deployment

- [ ] `npm run build` run successfully (with `VITE_BASE_PATH` if sub-path deployment)
- [ ] `dist/` uploaded to `s3://auic/dist/` via `aws s3 sync`
- [ ] `use_cases.json` present at S3 bucket root
- [ ] `industry_use_cases.json` present at S3 bucket root
- [ ] `lambda.zip` packaged from `lambda/` folder
- [ ] `lambda.zip` uploaded to Lambda function

### Verification after deployment

- [ ] `GET /api/okta-config` returns correct `issuer` and `clientId`
- [ ] `GET /api/data/use-cases` returns JSON array
- [ ] `GET /api/data/industry` returns JSON array
- [ ] App loads in browser and Okta login works
- [ ] Contact form sends email successfully
- [ ] Direct S3 URL returns `AccessDenied`

---

*Powered by Spearhead — Confidential, Internal Use Only*
