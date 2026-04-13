# AIUC – Deployment Configuration Guide

> This document covers **all configuration decisions** needed to deploy the AIUC app.
> For full step-by-step local development setup, see **README.md**.

---

## Repository

**GitHub:** `https://github.com/SpearheadCorp/aiuc`
**Branch to deploy:** `main`

```bash
git clone https://github.com/SpearheadCorp/aiuc.git
cd aiuc
```

---

## Current Test Deployment

| Item | Value |
|------|-------|
| Lambda Function URL | `https://i55277glxwyi6tmhik5dzvdaiu0czjsa.lambda-url.us-east-2.on.aws/` |
| S3 Bucket | `auic` |
| AWS Region | `us-east-2` |
| Lambda Function Name | `dev-aiuc-frontend` |
| Node.js Runtime | `20.x` |
| Email Method | Gmail API (OAuth2) |

---

## Section 1 — Frontend Build Variables (`.env`)

These are **build-time only** — baked into the compiled frontend during `npm run build`. They are **not** set in the Lambda console.

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
| `VITE_BASE_PATH` | No | Base URL path prefix. Only set when app is at a sub-path (see Section 5). Leave **unset** for standard deployment |

> After changing any `.env` value you must re-run `npm run build` and re-upload `dist/` to S3.

> `VITE_OKTA_ISSUER` and `VITE_OKTA_CLIENT_ID` are **not** frontend build vars. Okta credentials are fetched securely at runtime from AWS Secrets Manager via `/api/okta-config`.

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
| `OKTA_AUDIENCE` | `api://default` | Expected JWT audience — defaults to `api://default` |
| `AIUC_SECRET_NAME` | `aiuc/okta` | AWS Secrets Manager secret name holding `OKTA_CLIENT_ID` |

> `OKTA_CLIENT_ID` is **not** set here — it lives in Secrets Manager. See Section 3.

### 2c. Email / Contact Form — Gmail API (Required for contact form)

The contact form uses **Gmail API (OAuth2)** to send branded HTML emails — not SMTP. You need a one-time credential setup (see Section 2e below for the full setup guide).

| Key | Value | Description |
|-----|-------|-------------|
| `CONTACT_EMAIL` | `aiuc@purestorage.com` | Destination address — where contact form emails are delivered |
| `GMAIL_CLIENT_ID` | `use-your-xxx.apps.googleusercontent.com` | Google OAuth2 Client ID from Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | `GOCSPX-xxx` | Google OAuth2 Client Secret |
| `GMAIL_REFRESH_TOKEN` | `1//0gXXX...` | Long-lived refresh token — generated once via token script |
| `GMAIL_SENDER` | `sender@yourcompany.com` | Gmail address used to send outgoing emails |

> The refresh token does not expire unless revoked. The Lambda automatically refreshes the short-lived access token on every invocation.

> **Removed:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — these are no longer used. Remove them from Lambda env vars if present.

### 2c-i. Email Template Branding (Optional — No Redeploy Needed)

These 3 variables let you customise the email template appearance directly from the Lambda console — **no code change or redeployment required**. Changes take effect on the next email sent.

| Key | Default | Description |
|-----|---------|-------------|
| `EMAIL_HEADER_TITLE` | `Contact Form` | Text shown in the colored header bar at the top of every email |
| `EMAIL_BRAND_COLOR` | `#FA4616` | Hex color used for the header background, message border, and footer links. Must be a valid 3 or 6 digit hex (e.g. `#0057B8`). Falls back to `#FA4616` if invalid. |
| `EMAIL_COMPANY_NAME` | `AIUC` | Company name shown in the footer: *"This message was sent via the **AIUC** Contact Form to..."* |

**Example — customising for a different brand:**

```
EMAIL_HEADER_TITLE = Acme Corp — AI Enquiry
EMAIL_BRAND_COLOR  = #0057B8
EMAIL_COMPANY_NAME = Acme Corp
```

This would produce an email with a blue (`#0057B8`) header bar, the title "Acme Corp — AI Enquiry", and footer text reading *"This message was sent via the Acme Corp Contact Form to..."*

**To preview changes locally before setting in Lambda:**

Add the vars to `.env.local` (uncommented), then run:

```cmd
cd lambda
node test-template-local.mjs
```

Open `lambda/test-email-output.html` in your browser to see the result instantly.

### 2d. Understanding the Gmail Credentials — What Each One Is & Why It's Required

Before setting up, it helps to understand what each credential does and why it can't be skipped.

#### The Big Picture — How Gmail API Auth Works

Gmail API uses **OAuth2**, which is a 3-party system:

```
Your App (Lambda)  ←──────────────────────────────────────────────────────┐
        │                                                                  │
        │  "I want to send email as kapnachi1904@gmail.com"               │
        ▼                                                                  │
Google's Auth Server                                                       │
        │                                                                  │
        │  "Prove who you are" (Client ID + Secret)                        │
        │  "Prove the user said yes" (Refresh Token)                       │
        │                                                                  │
        │  ✓ OK — here's a short-lived Access Token (1 hour)              │
        ▼                                                                  │
Lambda uses Access Token to call Gmail API ──────────── email sent ────────┘
```

Every email send goes through this flow. The Lambda handles it **automatically** using the 3 stored credentials — no user interaction needed after the one-time setup.

---

#### `GMAIL_CLIENT_ID` — Who Is Asking?

**What it is:** A public identifier for your Google Cloud app (`aiuc-email` project). Looks like:
```
use-your-own.apps.googleusercontent.com
```

**Why required:** Google needs to know which registered application is making the request. Without it, Google has no idea who is trying to access the Gmail API and will reject the call.

**Is it secret?** Technically it's public (it appears in browser URLs during OAuth flows), but it should still be kept out of source code and treated as sensitive.

**Where to find it:** Google Cloud Console → APIs & Services → Credentials → your OAuth2 client.

---

#### `GMAIL_CLIENT_SECRET` — Prove You Own the App

**What it is:** A private password that proves your Lambda is the legitimate owner of the `aiuc-email` Google Cloud app. Looks like:
```
<your-secret-id>
```

**Why required:** The Client ID alone is not enough — anyone could copy it. The Client Secret proves that *you* (the app owner) are making the request, not someone who just copied the Client ID. Together, Client ID + Secret = "I am the legitimate AIUC app."

**Is it secret?** Yes — treat it like a password. Never commit it to git. Rotate it immediately if exposed.

**Where to find it:** Google Cloud Console → Credentials → edit `aiuc-lambda-mailer` → Client Secret field.

---

#### `GMAIL_REFRESH_TOKEN` — Prove the Gmail User Said Yes

**What it is:** A long-lived token proving that the Gmail account owner (`kapnachi1904@gmail.com`) authorized your app to send emails on their behalf. Looks like:
```
1//0gMZWV13IiIkYCgYIARAAGBASNwF-L9Ir...
```

**Why required — this is the most important one:**

Gmail API does not accept a username + password to send email. Instead, it requires **proof of consent** from the Gmail account owner via OAuth2. That proof is the refresh token.

Here's the flow in plain English:

```
1. You ran get-gmail-token.mjs
2. Google showed a login + consent page
3. You (the Gmail account owner) clicked "Allow"
4. Google issued a refresh token = "this app has permanent permission to send email as you"
5. That token is now stored in Lambda env vars
6. Every time Lambda needs to send an email, it hands this token to Google
7. Google checks it: "yes, the account owner approved this" → issues a 1-hour access token
8. Lambda uses that access token to call gmail.users.messages.send()
```

**Without the refresh token:** Lambda has no way to prove the Gmail account owner consented. Google will refuse every API call with `401 Unauthorized`.

**Does it expire?** The refresh token itself does **not** expire with time. It only gets revoked if:
- The Gmail account owner goes to [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and removes access
- You reset the Client Secret in Google Cloud Console
- Google detects suspicious activity

**Is it secret?** Yes — it grants the ability to send email as your Gmail account. Treat it like a password. Rotate immediately if exposed (see credential rotation steps in Section 2e Setup Guide).

---

#### `GMAIL_SENDER` — Which Gmail Account to Send From

**What it is:** The Gmail address that was authorized in the OAuth consent flow. This is the address that appears in the "From:" field of sent emails.

**Why required:** The Gmail API call needs to know which mailbox to use. The value must match the Gmail account that was used when generating the refresh token — you can't use a refresh token from `account-a@gmail.com` to send email as `account-b@gmail.com`.

---

#### Side-by-Side Comparison: Old SMTP vs New Gmail API

| | Old SMTP | New Gmail API |
|--|---------|---------------|
| **How it authenticates** | Username + password | OAuth2 Client ID + Secret + Refresh Token |
| **Credentials** | `SMTP_USER` + `SMTP_PASS` (Gmail app password) | 3 tokens from Google Cloud Console |
| **Token expiry** | Password never expires unless changed | Refresh token never expires unless revoked |
| **Security** | Password-based | OAuth2 — no password stored anywhere |
| **Setup effort** | Simple | One-time browser consent flow |
| **Email format** | Plain text | Branded HTML template |
| **Requires SMTP server** | Yes (`smtp.gmail.com`) | No — direct API call |

---

### 2e. Gmail API Setup Guide

Follow these steps **once per environment** to get your Gmail credentials.

#### Step 1 — Create a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Sign in with the Gmail account that will **send** emails
3. Project dropdown → **New Project** → name it `aiuc-email` → **Create**
4. Make sure the new project is selected

#### Step 2 — Enable Gmail API

1. **APIs & Services → Library**
2. Search `Gmail API` → click it → **Enable**

#### Step 3 — Configure OAuth Consent Screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** → **Create**
3. Fill in:
   - App name: `AIUC Contact Form`
   - User support email: your email
   - Developer contact email: your email
4. **Save and Continue** through all screens
5. On **Test users** → **+ Add Users** → add the Gmail sender address → **Save**

> The app stays in Testing mode permanently — it only needs to work for the one Gmail sender account.

#### Step 4 — Create OAuth2 Credentials

1. **APIs & Services → Credentials → + Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Desktop app**
3. Name: `aiuc-lambda-mailer` → **Create**
4. In the popup — copy:
   - **Client ID** (e.g. `youraccount-xxx.apps.googleusercontent.com`)
   - **Client Secret** (e.g. `GOCSPX-xxx`)

#### Step 5 — Generate the Refresh Token (one-time)

In the project's `lambda/` directory, create `get-gmail-token.mjs`:

```js
import { createInterface } from "readline";
import { google } from "googleapis";

const CLIENT_ID     = "PASTE_YOUR_CLIENT_ID_HERE";
const CLIENT_SECRET = "PASTE_YOUR_CLIENT_SECRET_HERE";
const REDIRECT_URI  = "urn:ietf:wg:oauth:2.0:oob";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/gmail.send"],
  prompt: "consent",
});

console.log("\n=== Open this URL in your browser ===\n");
console.log(authUrl);
console.log("\n=====================================\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question("Paste the authorization code: ", async (code) => {
  rl.close();
  const { tokens } = await oauth2Client.getToken(code.trim());
  console.log("\n=== Save these values ===\n");
  console.log(`GMAIL_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`GMAIL_CLIENT_SECRET = ${CLIENT_SECRET}`);
  console.log(`GMAIL_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log("\n========================\n");
  console.log("DELETE this file now.");
});
```

Run it:

```cmd
cd lambda
node get-gmail-token.mjs
```

Steps:
1. Open the printed URL in your browser
2. Sign in with the Gmail sender account → **Allow**
3. Copy the authorization code Google shows
4. Paste it into the terminal prompt → press Enter
5. Copy all 3 output values

> **Immediately delete** the script after use — it contains your credentials:
> ```cmd
> del lambda\get-gmail-token.mjs
> ```

#### Step 6 — Set Lambda Environment Variables

In **AWS Console → Lambda → Your Function → Configuration → Environment Variables → Edit**, add:

| Key | Value |
|-----|-------|
| `GMAIL_CLIENT_ID` | from Step 4 |
| `GMAIL_CLIENT_SECRET` | from Step 4 |
| `GMAIL_REFRESH_TOKEN` | from Step 5 output |
| `GMAIL_SENDER` | Gmail address you authorized |
| `CONTACT_EMAIL` | destination address for contact emails |

Click **Save**. No redeploy needed — env vars take effect immediately.

#### Step 7 — Verify Email Sending

Test locally first:

```cmd
cd lambda
set GMAIL_CLIENT_ID=your_client_id
set GMAIL_CLIENT_SECRET=your_client_secret
set GMAIL_REFRESH_TOKEN=your_refresh_token
set GMAIL_SENDER=sender@gmail.com
set CONTACT_EMAIL=destination@gmail.com
node test-gmail-send-local.mjs
```

Expected output:
```
✓ Email sent successfully!
  Gmail message ID: 18xxxxxxxxxxxxxxx
```

Check the `CONTACT_EMAIL` inbox — you should receive the branded HTML email.

#### Rotating Credentials (When Credentials Are Compromised)

1. Go to [https://myaccount.google.com/permissions](https://myaccount.google.com/permissions) → find the app → **Remove Access** (revokes the refresh token immediately)
2. [Google Cloud Console](https://console.cloud.google.com/) → **Credentials** → edit `aiuc-lambda-mailer` → **Reset Secret**
3. Re-run `get-gmail-token.mjs` with the new secret to get a new refresh token
4. Update `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` in Lambda environment variables

### 2e. Optional Variables

| Key | Value | Description |
|-----|-------|-------------|
| `BASE_PATH` | `/app/aiuc` | **Only set** when deploying behind an ALB or reverse proxy at a sub-path. Leave **unset** for standard Lambda Function URL at root `/`. See Section 5. |

### Complete Lambda Environment Variables Reference

| Key | Example | Required | Notes |
|-----|---------|:--------:|-------|
| `BUCKET_NAME` | `auic` | Yes | |
| `S3_REGION` | `us-east-2` | Yes | |
| `DIST_PREFIX` | `dist` | Yes | Always `dist` |
| `OKTA_ISSUER` | `https://company.okta.com/oauth2/default` | Yes | |
| `OKTA_AUDIENCE` | `api://default` | No | Defaults to `api://default` |
| `AIUC_SECRET_NAME` | `aiuc/okta` | Yes | Must match Secrets Manager secret name |
| `CONTACT_EMAIL` | `aiuc@purestorage.com` | Yes | Destination for contact emails |
| `GMAIL_CLIENT_ID` | `yourown-xxx.apps.googleusercontent.com` | Yes | Google Cloud OAuth2 |
| `GMAIL_CLIENT_SECRET` | `secret-xxx` | Yes | Google Cloud OAuth2 |
| `GMAIL_REFRESH_TOKEN` | `1//0gXXX...` | Yes | Generated once via token script |
| `GMAIL_SENDER` | `sender@gmail.com` | Yes | Authorized Gmail address |
| `EMAIL_HEADER_TITLE` | `Contact Form` | No | Header bar text in email template |
| `EMAIL_BRAND_COLOR` | `#FA4616` | No | Hex color for header/border/links in email |
| `EMAIL_COMPANY_NAME` | `AIUC` | No | Company name shown in email footer |
| `BASE_PATH` | `/app/aiuc` | No | Sub-path deployments only |

---

## Section 3 — Okta Authentication (AWS Secrets Manager)

The `OKTA_CLIENT_ID` is **never hardcoded** in code or Lambda env vars. It is stored in AWS Secrets Manager and fetched at runtime.

### How It Works

```
Browser  →  GET /api/okta-config
         →  Lambda reads OKTA_ISSUER from env var
         →  Lambda reads AIUC_SECRET_NAME from env var
         →  Lambda calls Secrets Manager → gets OKTA_CLIENT_ID
         →  Returns { issuer, clientId } to browser
         →  Browser initializes Okta SDK with PKCE
```

### Step 1 — Create the Secret

1. AWS Console → **Secrets Manager** → **Store a new secret**
2. Choose **Other type of secret**
3. Add key/value:

   | Key | Value |
   |-----|-------|
   | `OKTA_CLIENT_ID` | Your Okta Client ID from your Okta admin |

4. Click **Next** → set **Secret name** to `aiuc/okta` (must match `AIUC_SECRET_NAME` in Lambda)
5. Leave rotation disabled → **Next** → **Store**

### Step 2 — Grant Lambda Permission to Read the Secret

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

Replace `REGION` (e.g. `us-east-2`) and `ACCOUNT_ID` (12-digit number shown top-right in AWS Console).

3. Name it `aiuc-secrets-manager-read` → **Create policy**

### Step 3 — Verify

```bash
curl https://YOUR_LAMBDA_URL/api/okta-config
```

Expected:
```json
{ "issuer": "https://yourcompany.okta.com/oauth2/default", "clientId": "0oaXXXXXXXX" }
```

---

## Section 3b — AI Search (RAG) Configuration

The app uses Amazon Bedrock for semantic search. This section documents how to enable/disable AI search, the required IAM permissions, and how to set up the S3 embeddings files.

### How AI Search Works

```
User query (text)
    │
    ▼
Lambda: getEmbedding(query)           ← Bedrock Titan Text Embeddings v2 (1024-dim)
    │
    ▼
Vector similarity search              ← FlatIP index loaded from S3 embeddings JSON
    │
    ▼
Top-K results
    │
    ▼
generateExplanations(query, results)  ← Bedrock Nova Lite (1–2 sentence explanations)
    │
    ▼
Response: [{ useCase/item, score, whyMatched }]
```

If Bedrock is unavailable or `ENABLE_AI_SEARCH=false`, the system falls back to keyword search automatically — no user-facing error.

### Enable / Disable AI Search

| Lambda env var | Value | Behaviour |
|----------------|-------|-----------|
| `ENABLE_AI_SEARCH` | `true` (default) | Semantic vector search + AI explanations |
| `ENABLE_AI_SEARCH` | `false` | Keyword-only fallback, no Bedrock calls |

Set this in **AWS Lambda Console → Configuration → Environment variables**. No redeployment needed — the flag is read at invocation time.

### Required IAM Permissions (Lambda Execution Role)

Add this inline policy (`aiuc-bedrock-invoke`) to your Lambda execution role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": [
        "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0",
        "arn:aws:bedrock:*::foundation-model/us.amazon.nova-lite-v1:0"
      ]
    }
  ]
}
```

> Without this policy, search falls back to keyword mode and logs `[Embedding] Bedrock error: AccessDeniedException`.

### Bedrock Model IDs

| Purpose | Model ID |
|---------|----------|
| Embeddings | `amazon.titan-embed-text-v2:0` |
| Why Matched explanations | `us.amazon.nova-lite-v1:0` |

Both models must be enabled in your AWS account via **Amazon Bedrock → Model access → Manage model access**.

### S3 Embeddings Setup

Pre-computed embeddings must be uploaded to S3 before AI search works:

```
your-bucket/
├── use_cases_embeddings.json           ← array of { useCase, embedding }
└── industry_use_cases_embeddings.json  ← array of { item, embedding }
```

**Step 1 — Generate embeddings (run once per dataset update):**

```bash
# Use-case embeddings
node lambda/generate-embeddings-local.mjs

# Industry embeddings
node lambda/generate-embeddings-industry-local.mjs
```

Both scripts read from `public/data/*.json`, call Bedrock Titan, and write to `public/data/*_embeddings.json`. Requires AWS credentials with `bedrock:InvokeModel` permission.

**Step 2 — Upload to S3:**

```bash
aws s3 cp public/data/use_cases_embeddings.json \
    s3://your-bucket/use_cases_embeddings.json

aws s3 cp public/data/industry_use_cases_embeddings.json \
    s3://your-bucket/industry_use_cases_embeddings.json
```

**Custom S3 paths** — override the default keys via Lambda env vars:

| Env var | Default | Description |
|---------|---------|-------------|
| `USE_CASES_EMBEDDINGS_KEY` | `use_cases_embeddings.json` | S3 key for use-case embeddings |
| `INDUSTRY_EMBEDDINGS_KEY` | `industry_use_cases_embeddings.json` | S3 key for industry embeddings |

This is how multiple deployments (PureStorage, Spearhead, etc.) can share the same Lambda codebase while pointing at their own datasets.

### Shared Core Module

All RAG logic lives in `lambda/core/` and is imported by both PureStorage and Spearhead. **Do not duplicate** any function from this directory in client-specific Lambda handlers.

| File | Exports |
|------|---------|
| `core/embeddings.mjs` | `getEmbedding`, `l2normalize` |
| `core/search.mjs` | `loadSearchIndex`, `runVectorSearch`, `runKeywordSearch`, `createFlatIPIndex`, `USE_CASE_FIELDS`, `INDUSTRY_FIELDS` |
| `core/ai_toggle.mjs` | `ENABLE_AI_SEARCH` |
| `core/why_matched.mjs` | `generateExplanations`, `FALLBACK_WHY`, `WHY_MATCHED_MODEL` |
| `core/api_handlers.mjs` | `handleUseCaseSearch`, `handleIndustrySearch` |

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

### Uploading Data Files

Upload via S3 Console (drag and drop to bucket root) or via CLI:

```bash
aws s3 cp use_cases.json s3://auic/use_cases.json
aws s3 cp industry_use_cases.json s3://auic/industry_use_cases.json
```

**Data file format:**

`use_cases.json` — array of use case objects:
```json
[
  {
    "capability": 1,
    "business_function": "Finance",
    "business_capability": "...",
    "stakeholder_or_user": "...",
    "ai_use_case": "...",
    "ai_algorithms_frameworks": "...",
    "datasets": "...",
    "action_implementation": "...",
    "ai_tools_models": "...",
    "digital_platforms_and_tools": "...",
    "expected_outcomes_and_results": "..."
  }
]
```

`industry_use_cases.json` — array of industry objects:
```json
[
  {
    "id": "1",
    "industry": "Healthcare",
    "business_function": "...",
    "business_capability": "...",
    "stakeholders_users": "...",
    "ai_use_case": "...",
    "description": "...",
    "implementation_plan": "...",
    "expected_outcomes": "...",
    "datasets": "...",
    "ai_tools_platforms": "...",
    "digital_tools_platforms": "...",
    "ai_frameworks": "...",
    "ai_tools_and_models": "...",
    "industry_references": "..."
  }
]
```

Place `[]` in each file if you have no data yet — the app loads with empty tables.

---

## Section 5 — Sub-Path Deployment (ALB / Reverse Proxy)

**Only follow this section if your organisation deploys the app at a sub-path** (e.g. `/app/aiuc`) behind an internal ALB or portal, not at the root `/`.

For standard Lambda Function URL deployment, **skip this section entirely**.

### What Changes and Why

| Without sub-path | With sub-path (`/app/aiuc`) |
|-----------------|----------------------------|
| App at root `/` | App at `/app/aiuc` |
| Assets at `/assets/file.js` | Assets at `/app/aiuc/assets/file.js` |
| Lambda receives `/assets/file.js` | Lambda receives `/app/aiuc/assets/file.js` |
| No stripping needed | Must strip `/app/aiuc` prefix before S3 lookup |

### Step 1 — Build With Base Path

```bash
VITE_BASE_PATH=/app/aiuc npm run build
```

This makes Vite prefix all asset URLs in the HTML output with `/app/aiuc/`.

### Step 2 — Add BASE_PATH to Lambda

In Lambda Console → **Configuration** → **Environment variables** → **Edit** → add:

| Key | Value |
|-----|-------|
| `BASE_PATH` | `/app/aiuc` |

The Lambda handler strips this prefix from every incoming request path before the S3 lookup.

### Step 3 — Upload `dist/` as Normal

```bash
aws s3 sync dist/ s3://YOUR_BUCKET/dist/ --delete
```

No change to S3 structure — stripping happens at runtime in Lambda, not in S3.

---

## Section 6 — Build & Deploy Commands

### Standard Deployment (Root `/`)

```bash
# 1. Install dependencies
npm install

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

### Sub-Path Deployment (`/app/aiuc`)

Same as above but replace step 2 with:

```bash
VITE_BASE_PATH=/app/aiuc npm run build
```

And also set `BASE_PATH=/app/aiuc` in Lambda environment variables.

### Windows (PowerShell) — Package Lambda

On Windows, replace step 4 with:

```powershell
cd lambda
npm install --omit=dev
Compress-Archive -Path lambda\* -DestinationPath lambda.zip -Force
cd ..
```

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

### What the Workflow Does

1. Triggered on push to `main`
2. Installs Node.js 20 + runs `npm install`
3. Runs `npm run build` → outputs `dist/`
4. Syncs `dist/` to `s3://auic/dist/`
5. Packages `lambda/` as `lambda.zip`
6. Runs `aws lambda update-function-code`

> Lambda environment variables are **not** managed by CI/CD — set them manually in the Lambda console.

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

Replace `ACCOUNT_ID` with your 12-digit AWS account ID.

---

## Section 9 — Deployment Checklist

### First-Time Setup

**AWS Infrastructure:**
- [ ] S3 bucket created with **Block all public access** enabled
- [ ] Lambda function created with **Node.js 20.x**, timeout set to **60 seconds**
- [ ] Lambda Function URL configured (Auth type: `NONE` for public access)
- [ ] `aiuc-s3-read` inline policy attached to Lambda execution role (Section 8)
- [ ] `aiuc-secrets-manager-read` inline policy attached to Lambda execution role (Section 3)
- [ ] `aiuc-bedrock-invoke` inline policy attached to Lambda execution role (Section 3b) — required for AI search

**Okta:**
- [ ] Secret `aiuc/okta` created in Secrets Manager with key `OKTA_CLIENT_ID` (Section 3)
- [ ] Lambda Function URL added to Okta app Sign-in redirect URIs
- [ ] Lambda Function URL added to Okta app Sign-out redirect URIs

**Gmail API (Contact Form):**
- [ ] Google Cloud project created with Gmail API enabled (Section 2e — Steps 1–2)
- [ ] OAuth consent screen configured with sender Gmail as test user (Section 2e — Step 3)
- [ ] OAuth2 Desktop App credentials created (Section 2e — Step 4)
- [ ] Refresh token generated via `get-gmail-token.mjs` (Section 2e — Step 5)
- [ ] Token script deleted after use
- [ ] All Lambda environment variables set (Section 2 complete reference table)

### Every Deployment

- [ ] `npm run build` run successfully (with `VITE_BASE_PATH` if sub-path deployment)
- [ ] `dist/` uploaded to `s3://auic/dist/` via `aws s3 sync`
- [ ] `use_cases.json` present at S3 bucket root
- [ ] `industry_use_cases.json` present at S3 bucket root
- [ ] `lambda.zip` packaged from `lambda/` folder (`npm install --omit=dev` run first)
- [ ] `lambda.zip` uploaded to Lambda function

### Verification After Deployment

- [ ] `GET /api/okta-config` returns correct `issuer` and `clientId`
- [ ] App loads in browser and Okta login works
- [ ] `GET /api/data/use-cases` returns JSON array (requires login)
- [ ] `GET /api/data/industry` returns JSON array (requires login)
- [ ] Contact form sends email — check `CONTACT_EMAIL` inbox for branded HTML email
- [ ] Direct S3 URL returns `AccessDenied` (bucket is private)

---

*Powered by Spearhead — Confidential, Internal Use Only*
