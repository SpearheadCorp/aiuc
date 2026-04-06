<p align="center">
  <img src="public/assets/purelogo.png" alt="Pure Storage" width="300" />
</p>

<h1 align="center">AI Use Case Repository (AIUC)</h1>

An internal, employee-only React dashboard for browsing AI use cases and industry-specific AI implementation records. Protected by Okta authentication and served via AWS Lambda + S3.

## Key Features

- Secure Okta OIDC login (PKCE flow) — no unauthenticated access
- Use Case table and Industry data table with filtering, sorting, and virtual scrolling
- Contact form that sends branded HTML emails via Gmail API
- Fully serverless — AWS Lambda serves both the React app and the API

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Local Development](#local-development)
4. [Environment Variables](#environment-variables)
5. [Architecture Overview](#architecture-overview)
6. [API Endpoints](#api-endpoints)
7. [Gmail API Setup](#gmail-api-setup) — Google Cloud setup, token generation, email template, Lambda config, credential rotation
8. [AWS Lambda Deployment](#aws-lambda-deployment)
9. [GitHub Actions CI/CD](#github-actions-cicd)
10. [Available Scripts](#available-scripts)
11. [Directory Structure](#directory-structure)
12. [Troubleshooting](#troubleshooting)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript 5.9, Vite 7 |
| **UI** | Material UI (MUI) 5, Emotion |
| **Routing** | React Router 7 |
| **Tables** | TanStack React Table + React Virtual |
| **Auth** | Okta OIDC (`@okta/okta-react`, `@okta/okta-auth-js`) |
| **Backend** | AWS Lambda (Node.js 20, ESM) |
| **Storage** | AWS S3 (static assets + JSON data files) |
| **Secrets** | AWS Secrets Manager (Okta Client ID) |
| **Email** | Google Gmail API v1 (OAuth2 refresh token) |
| **JWT Verification** | `jose` library |
| **Build Tool** | Vite (frontend), plain Node.js (Lambda) |
| **CI/CD** | GitHub Actions |

---

## Prerequisites

Install these before starting:

- **Node.js 20+** — [https://nodejs.org](https://nodejs.org)
- **npm 10+** — comes with Node.js
- **AWS CLI** (for Lambda deployment) — [install guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- **Okta developer account** (or org account) — for authentication
- **Google Cloud project** with Gmail API enabled — for contact form emails
- **AWS account** with Lambda, S3, and Secrets Manager access

---

## Local Development

Local dev uses a **two-server setup**:

| Server | Command | Port | Purpose |
|--------|---------|------|---------|
| Vite dev server | `npm run dev` | `5173` | Serves frontend with hot reload |
| Local API server | `npm run dev:server` | `3001` | Mirrors Lambda API routes |

Vite proxies all `/api/*` requests to the local API server on port 3001.

### Step 1 — Clone and Install

```bash
git clone <repo-url>
cd aiuc
npm install
cd lambda && npm install && cd ..
```

### Step 2 — Create `.env.local`

Create a `.env.local` file in the project root (this file is gitignored):

```env
# ── Okta ──────────────────────────────────────────────────────────────────────
VITE_OKTA_ISSUER=https://YOUR_OKTA_DOMAIN/oauth2/default
VITE_OKTA_CLIENT_ID=YOUR_OKTA_CLIENT_ID

# ── Gmail API ─────────────────────────────────────────────────────────────────
GMAIL_CLIENT_ID=your_google_oauth_client_id
GMAIL_CLIENT_SECRET=your_google_oauth_client_secret
GMAIL_REFRESH_TOKEN=your_refresh_token
GMAIL_SENDER=your_gmail_address@gmail.com
CONTACT_EMAIL=destination_email@example.com

# ── API proxy target ──────────────────────────────────────────────────────────
VITE_API_BASE_URL=http://localhost:3001
```

> See [Gmail API Setup](#gmail-api-setup) to get your Gmail credentials.
> Your `VITE_OKTA_ISSUER` and `VITE_OKTA_CLIENT_ID` come from your Okta app settings.

### Step 3 — Add `localhost` as Okta Redirect URI

In your Okta Admin Console:

1. Go to **Applications → Your App → General**
2. Under **Sign-in redirect URIs**, add:
   ```
   http://localhost:5173/login/callback
   ```
3. Under **Sign-out redirect URIs**, add:
   ```
   http://localhost:5173
   ```
4. Save changes.

### Step 4 — (Optional) Add Local JSON Data Files

The data tables load from `/api/data/use-cases` and `/api/data/industry`. In local dev, these read from local JSON files if they exist:

```
local-data/
├── use_cases.json
└── industry_use_cases.json
```

Create the `local-data/` folder in the project root and place your data files there. If files don't exist the tables render empty — the app still works for testing the contact form and auth flow.

### Step 5 — Start Both Servers

**Terminal 1 — API server (start this first):**

```cmd
npm run dev:server
```

Expected output:
```
✓ Loaded .env.local
✓ Local API server running at http://localhost:3001
  Okta issuer  : https://trial-xxx.okta.com/oauth2/default
  Okta clientId: 0oa...
  Gmail sender : you@gmail.com
  Contact email: destination@example.com

Ready — waiting for Vite proxy requests...
```

**Terminal 2 — Vite frontend:**

```cmd
npm run dev
```

Expected output:
```
  VITE v7.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

### Step 6 — Open in Browser

Go to **http://localhost:5173** — you will be redirected to Okta to sign in, then land on the dashboard.

---

## Environment Variables

### Frontend (build-time, in `.env` or `.env.local`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_OKTA_ISSUER` | Local dev only | — | Okta issuer URL (e.g. `https://company.okta.com/oauth2/default`) |
| `VITE_OKTA_CLIENT_ID` | Local dev only | — | Okta app Client ID |
| `VITE_API_BASE_URL` | Local dev only | — | API server URL for Vite proxy — set to `http://localhost:3001` |
| `VITE_CONTACT_EMAIL` | No | `aiuc@purestorage.com` | Contact email shown in the UI footer |
| `VITE_EMAIL_TOOLTIP_TEXT` | No | `I'm interested — contact me` | Tooltip on the email icon |
| `VITE_BASE_PATH` | No | `/` | Base URL path — only set for sub-path deployments (e.g. `/app/aiuc`) |

> In production, `VITE_OKTA_ISSUER` and `VITE_OKTA_CLIENT_ID` are **not** needed as frontend env vars. The Lambda fetches them securely from AWS Secrets Manager at runtime via `/api/okta-config`.

### Lambda (AWS Lambda Console → Configuration → Environment Variables)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BUCKET_NAME` | Yes | — | S3 bucket name (e.g. `auic`) |
| `S3_REGION` | Yes | — | AWS region (e.g. `us-east-2`) |
| `DIST_PREFIX` | Yes | — | S3 key prefix for frontend files (e.g. `dist`) |
| `OKTA_ISSUER` | Yes | — | Okta issuer URL |
| `OKTA_AUDIENCE` | No | `api://default` | Expected JWT audience |
| `AIUC_SECRET_NAME` | Yes | — | Secrets Manager secret name (e.g. `aiuc/okta`) |
| `CONTACT_EMAIL` | No | `aiuc@purestorage.com` | Destination address for contact emails |
| `GMAIL_CLIENT_ID` | Yes (email) | — | Google OAuth2 Client ID |
| `GMAIL_CLIENT_SECRET` | Yes (email) | — | Google OAuth2 Client Secret |
| `GMAIL_REFRESH_TOKEN` | Yes (email) | — | Long-lived OAuth2 refresh token |
| `GMAIL_SENDER` | Yes (email) | — | Gmail address used to send emails |
| `BASE_PATH` | No | — | Sub-path prefix (e.g. `/app/aiuc`) — sub-path deployments only |

### AWS Secrets Manager Secret (`aiuc/okta`)

Create this secret with the following JSON value:

```json
{
  "OKTA_CLIENT_ID": "your_okta_client_id_here"
}
```

---

## Architecture Overview

```
Browser
  │
  ├── Local Dev ────────────────────────────────────────────────────────────
  │     Vite (port 5173) ──proxy /api/*──► local-server.mjs (port 3001)
  │                                           reads .env.local
  │
  └── Production ───────────────────────────────────────────────────────────
        Lambda Function URL
          ├── GET  /                  → Serves dist/index.html from S3
          ├── GET  /assets/*          → Serves static assets from S3
          ├── GET  /api/okta-config   → Secrets Manager → { issuer, clientId }
          ├── GET  /api/data/*        → Verify JWT → S3 JSON files
          └── POST /api/contact       → Verify JWT → Gmail API → send email
```

### Okta Authentication Flow

```
1. App loads → fetches /api/okta-config (issuer + clientId from Secrets Manager)
2. Okta SDK initialized with PKCE
3. User not authenticated → redirect to Okta login page
4. User logs in → Okta redirects to /login/callback
5. PKCE code exchange → access token stored in browser session
6. All /api/* requests include: Authorization: Bearer <access_token>
7. Lambda verifies token signature using Okta JWKS (RS256, pinned)
8. Verified → request proceeds; invalid token → 401 Unauthorized
```

### S3 Bucket Layout (Production)

```
s3://your-bucket/
├── dist/                       ← Built React app (uploaded by CI/CD)
│   ├── index.html
│   └── assets/
│       ├── index-[hash].js
│       └── index-[hash].css
├── use_cases.json              ← Use case data (upload manually)
└── industry_use_cases.json     ← Industry data (upload manually)
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `GET` | `/api/okta-config` | No | Returns Okta `issuer` and `clientId` |
| `GET` | `/api/data/use-cases` | JWT | Returns use case JSON array from S3 |
| `GET` | `/api/data/industry` | JWT | Returns industry data JSON array from S3 |
| `POST` | `/api/contact` | JWT | Sends contact email via Gmail API |
| `GET` | `/*` | No | Serves static files from S3 `dist/` |

### `POST /api/contact` — Request Body

```json
{
  "from": "user@example.com",
  "subject": "Interest in: AI Use Case Name",
  "message": "Hello, I am interested in this use case..."
}
```

### `POST /api/contact` — Success Response

```json
{ "success": true, "message": "Email sent successfully" }
```

---

## Gmail API Setup

The contact form sends branded HTML emails via **Gmail API (OAuth2)** — not SMTP. This means no SMTP server is needed; the Lambda authenticates as your Gmail account using a long-lived refresh token and calls the Gmail API directly.

### How It Works

```
User submits contact form
        │
        ▼
POST /api/contact  (with Okta Bearer token)
        │
        ▼
Lambda (index.mjs)
  ├── Verifies Okta JWT
  ├── Validates email format + sanitizes headers
  ├── Builds HTML email  ← lambda/emailTemplate.mjs
  ├── Creates Gmail OAuth2 client from GMAIL_* env vars
  ├── Refreshes access token automatically (no user interaction)
  └── Calls gmail.users.messages.send()
        │
        ▼
Email delivered to CONTACT_EMAIL inbox
  From:     GMAIL_SENDER
  Reply-To: user's email address
  Subject:  as submitted
  Body:     branded HTML template (Pure Storage orange #FA4616)
```

### The Email Template (`lambda/emailTemplate.mjs`)

All emails use a branded HTML template with:

- Pure Storage orange (`#FA4616`) header bar
- Sender email, subject line, and message body displayed clearly
- All user input HTML-escaped (prevents injection)
- Inline CSS for maximum email client compatibility (Gmail, Outlook, Apple Mail)
- Footer with destination address

To preview the template locally before deploying:

```cmd
cd lambda
node test-template-local.mjs
```

This writes `lambda/test-email-output.html` — open it in your browser to see exactly how the email will look.

---

### Step 1 — Create a Google Cloud Project

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com)
2. Sign in with the Gmail account that will **send** the emails (e.g. `aiuc@yourcompany.com`)
3. Click the project dropdown at the top → **New Project**
   - Project name: `aiuc-email`
   - Click **Create**
4. Make sure the new project is selected in the dropdown

---

### Step 2 — Enable the Gmail API

1. Go to **APIs & Services → Library**
2. Search for `Gmail API` → click it → click **Enable**

---

### Step 3 — Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. User type: **External** → **Create**
3. Fill in:
   - App name: `AIUC Contact Form`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue** through Scopes (no changes needed)
5. On the **Test users** screen:
   - Click **+ Add Users**
   - Add the Gmail address that will send emails
   - Click **Save**
6. Click **Back to Dashboard**

> The app stays in Testing mode permanently — it only needs to work for the one Gmail account, never for external users.

---

### Step 4 — Create OAuth2 Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Desktop app**
4. Name: `aiuc-lambda-mailer`
5. Click **Create**
6. In the popup — click **Download JSON** (or copy the values directly):
   - `client_id` (looks like `186826723477-xxx.apps.googleusercontent.com`)
   - `client_secret` (looks like `GOCSPX-xxx`)

---

### Step 5 — Generate the Refresh Token (one-time per environment)

The refresh token allows the Lambda to send emails indefinitely without user interaction.

**Create the token generation script:**

```cmd
cd lambda
```

Create `get-gmail-token.mjs` with:

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
  console.log("\n=== Save these to Lambda environment variables ===\n");
  console.log(`GMAIL_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`GMAIL_CLIENT_SECRET = ${CLIENT_SECRET}`);
  console.log(`GMAIL_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log("\n==================================================\n");
  console.log("DELETE this file now: lambda/get-gmail-token.mjs");
});
```

**Run it:**

```cmd
node get-gmail-token.mjs
```

**Follow the prompts:**

1. The script prints a long URL — open it in your browser
2. Sign in with the Gmail account that will send emails
3. Click **Allow** on the Google authorization page
4. Google shows a code — copy it
5. Paste the code into the terminal prompt and press Enter
6. The script prints your 3 credential values — copy them

**Output looks like:**
```
GMAIL_CLIENT_ID     = 186826723477-xxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET = GOCSPX-xxx
GMAIL_REFRESH_TOKEN = 1//0gXXX...
```

> **Immediately delete** `get-gmail-token.mjs` after copying the token — it contains your credentials:
> ```cmd
> del lambda\get-gmail-token.mjs
> ```

---

### Step 6 — Store the Credentials

#### For Local Development — `.env.local`

Add to `.env.local` in the project root:

```env
GMAIL_CLIENT_ID=186826723477-xxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-xxx
GMAIL_REFRESH_TOKEN=1//0gXXX...
GMAIL_SENDER=your_gmail@gmail.com
CONTACT_EMAIL=destination@example.com
```

#### For AWS Lambda — Environment Variables

In **AWS Console → Lambda → Your Function → Configuration → Environment Variables → Edit**, add:

| Key | Value |
|-----|-------|
| `GMAIL_CLIENT_ID` | from Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | from Google Cloud Console |
| `GMAIL_REFRESH_TOKEN` | from token script output |
| `GMAIL_SENDER` | Gmail address you authorized (e.g. `aiuc@yourcompany.com`) |
| `CONTACT_EMAIL` | where contact emails are delivered |

Click **Save**. The Lambda picks up the new env vars immediately — no redeploy needed.

---

### Step 7 — Test the Email Locally

Before deploying to Lambda, verify everything works:

```cmd
cd lambda
set GMAIL_CLIENT_ID=your_client_id
set GMAIL_CLIENT_SECRET=your_client_secret
set GMAIL_REFRESH_TOKEN=your_refresh_token
set GMAIL_SENDER=your_gmail@gmail.com
set CONTACT_EMAIL=your_gmail@gmail.com
node test-gmail-send-local.mjs
```

Expected output:
```
Sending test email from your_gmail@gmail.com to your_gmail@gmail.com ...
✓ Email sent successfully!
  Gmail message ID: 18xxxxxxxxxxxxxxx
  Check inbox at: your_gmail@gmail.com
```

Check your inbox — you should receive the branded HTML email.

---

### Step 8 — Test on AWS Lambda

After setting env vars in Lambda console, test via the contact form in the deployed app, or use `curl`:

```cmd
curl -X POST https://YOUR_LAMBDA_FUNCTION_URL/api/contact ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_OKTA_ACCESS_TOKEN" ^
  -d "{\"from\":\"test@example.com\",\"subject\":\"Test\",\"message\":\"Hello from Lambda\"}"
```

Expected response:
```json
{"success": true, "message": "Email sent successfully"}
```

---

### Rotating Credentials

Gmail credentials should be rotated if exposed. To rotate:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials**
2. Click the pencil on `aiuc-lambda-mailer` → **Reset Secret** → copy the new secret
3. Go to [https://myaccount.google.com/permissions](https://myaccount.google.com/permissions) → find the app → **Remove Access** (revokes old refresh token)
4. Re-run `get-gmail-token.mjs` with the new secret to get a new refresh token
5. Update `GMAIL_CLIENT_SECRET` and `GMAIL_REFRESH_TOKEN` in:
   - `.env.local` (local dev)
   - AWS Lambda environment variables (production)

---

## AWS Lambda Deployment

> For first-time infrastructure setup (Lambda function creation, S3 bucket policy, IAM role, Secrets Manager, Function URL), see **[DEPLOYMENT_CONFIG.md](./DEPLOYMENT_CONFIG.md)**.

### 1 — Build the Frontend

```cmd
npm run build
```

For sub-path deployments (app served at e.g. `/app/aiuc`):

```cmd
set VITE_BASE_PATH=/app/aiuc && npm run build
```

Output is written to `dist/`.

### 2 — Upload Frontend Assets to S3

```cmd
aws s3 sync dist/ s3://YOUR_BUCKET_NAME/dist/ --delete --region YOUR_REGION
```

### 3 — Upload Data Files (first time or when data changes)

```cmd
aws s3 cp use_cases.json s3://YOUR_BUCKET_NAME/ --region YOUR_REGION
aws s3 cp industry_use_cases.json s3://YOUR_BUCKET_NAME/ --region YOUR_REGION
```

### 4 — Package the Lambda Function

```cmd
cd lambda
npm install --omit=dev
```

**Windows (PowerShell):**
```powershell
Compress-Archive -Path lambda\* -DestinationPath lambda.zip -Force
```

**Mac / Linux:**
```bash
cd lambda && zip -r ../lambda.zip . && cd ..
```

### 5 — Deploy Lambda Code

```cmd
aws lambda update-function-code ^
  --function-name YOUR_LAMBDA_FUNCTION_NAME ^
  --zip-file fileb://lambda.zip ^
  --region YOUR_REGION
```

### 6 — Set Lambda Environment Variables

In **AWS Console → Lambda → Your Function → Configuration → Environment Variables → Edit**:

| Key | Example Value |
|-----|---------------|
| `BUCKET_NAME` | `auic` |
| `S3_REGION` | `us-east-2` |
| `DIST_PREFIX` | `dist` |
| `OKTA_ISSUER` | `https://company.okta.com/oauth2/default` |
| `OKTA_AUDIENCE` | `api://default` |
| `AIUC_SECRET_NAME` | `aiuc/okta` |
| `CONTACT_EMAIL` | `aiuc@purestorage.com` |
| `GMAIL_CLIENT_ID` | from Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | from Google Cloud Console |
| `GMAIL_REFRESH_TOKEN` | from token generation script |
| `GMAIL_SENDER` | `sender@gmail.com` |

### 7 — Register Lambda URL in Okta

In Okta Admin Console → **Applications → Your App → General**:

- **Sign-in redirect URIs** → add:
  ```
  https://YOUR_LAMBDA_FUNCTION_URL/login/callback
  ```
- **Sign-out redirect URIs** → add:
  ```
  https://YOUR_LAMBDA_FUNCTION_URL/
  ```

### 8 — Verify Deployment

```cmd
curl https://YOUR_LAMBDA_FUNCTION_URL/api/okta-config
```

Expected response:
```json
{"issuer":"https://company.okta.com/oauth2/default","clientId":"0oa..."}
```

---

## GitHub Actions CI/CD

Every push to `main` automatically builds and deploys via `.github/workflows/deploy.yml`.

### Required GitHub Secrets

Go to **GitHub → Repo → Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AWS_REGION` | e.g. `us-east-2` |
| `S3_BUCKET_NAME` | e.g. `auic` |
| `LAMBDA_FUNCTION_NAME` | e.g. `dev-aiuc-frontend` |

### What the Workflow Does

1. Checks out code on push to `main`
2. Installs Node.js 20 + runs `npm install`
3. Runs `npm run build` → outputs `dist/`
4. Syncs `dist/` to S3
5. Packages `lambda/` as a zip
6. Runs `aws lambda update-function-code`

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server at `http://localhost:5173` |
| `npm run dev:server` | Start local API server at `http://localhost:3001` |
| `npm run build` | Type-check + build frontend to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint on `src/` |

### Lambda Local Test Scripts

```cmd
cd lambda

# Preview the HTML email template in a browser
node test-template-local.mjs
# → writes lambda/test-email-output.html, open it in your browser

# Send a real test email via Gmail API
# Set GMAIL_* env vars first — see comments inside the file
node test-gmail-send-local.mjs
```

---

## Directory Structure

```
aiuc/
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Actions CI/CD
├── docs/
│   └── plans/                      # Implementation plan docs
├── lambda/
│   ├── index.mjs                   # Lambda handler (routes, auth, S3, email)
│   ├── emailTemplate.mjs           # Branded HTML email builder
│   ├── local-server.mjs            # Local dev API server (mirrors Lambda)
│   ├── package.json
│   └── package-lock.json
├── local-data/                     # (gitignored) local JSON data files
│   ├── use_cases.json
│   └── industry_use_cases.json
├── public/
│   └── assets/
│       ├── purelogo.png
│       └── spearhead.png
├── src/
│   ├── components/
│   │   ├── ContactDialog.tsx        # Contact form modal
│   │   ├── IndustryDataTable.tsx    # Industry data table with filters
│   │   ├── UseCaseTable.tsx         # Use case data table with filters
│   │   └── Logo.tsx
│   ├── config/
│   │   └── okta.ts                  # Okta SDK initialization
│   ├── hooks/
│   │   ├── useOktaUser.ts           # Extract user info from Okta token
│   │   └── useS3Data.ts             # Fetch + map data from API
│   ├── App.tsx                      # Main dashboard (tabs, layout)
│   ├── main.tsx                     # Entry point, Okta Security wrapper
│   ├── theme.ts                     # MUI theme (Pure Storage branding)
│   ├── types.ts                     # TypeScript interfaces
│   ├── utils.ts
│   └── globals.css
├── .env.local                       # (gitignored) local env vars
├── .gitignore
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── README.md
└── DEPLOYMENT_CONFIG.md             # Detailed AWS infrastructure setup guide
```

---

## Troubleshooting

### `ECONNREFUSED` on `/api/okta-config`

**Cause:** Local API server is not running.

**Fix:** Open a second terminal and run:
```cmd
npm run dev:server
```

---

### `Failed to load authentication configuration` in UI

**Cause:** `VITE_OKTA_ISSUER` or `VITE_OKTA_CLIENT_ID` is missing from `.env.local`, or Vite was not restarted after editing the file.

**Fix:**
1. Confirm both values are set in `.env.local`
2. Stop and restart both servers

---

### Okta `400 Bad Request — redirect_uri not allowed`

**Cause:** `http://localhost:5173/login/callback` not in Okta app's allowed redirect URIs.

**Fix:** Okta Admin → **Applications → Your App → General → Sign-in redirect URIs** → add `http://localhost:5173/login/callback`.

---

### Okta `403 access_denied`

**Cause:** App is in Testing mode and your account is not a test user.

**Fix:** Okta Admin → **Applications → Your App → Assignments** → assign your user. Also add your email as a test user in the Google OAuth consent screen.

---

### `Cannot find package 'googleapis'`

**Cause:** Running `node local-server.mjs` directly from the root. `googleapis` lives in `lambda/node_modules`.

**Fix:** Always use the npm script from the project root:
```cmd
npm run dev:server
```

---

### Gmail `invalid_client` error

**Cause:** `GMAIL_CLIENT_SECRET` is stale or was rotated.

**Fix:**
1. [Google Cloud Console](https://console.cloud.google.com/) → **Credentials** → edit `aiuc-lambda-mailer` → reset secret
2. Update `GMAIL_CLIENT_SECRET` in `.env.local`
3. Re-run `node lambda/get-gmail-token.mjs` to get a new refresh token

---

### Contact form submits but no email received

**Check in order:**
1. Check your spam / junk folder
2. Confirm `CONTACT_EMAIL` is set to your address
3. Check Terminal 1 for `✓ Email sent — Gmail ID: xxx`
4. Run the standalone send test:
   ```cmd
   cd lambda
   set GMAIL_CLIENT_ID=...
   set GMAIL_CLIENT_SECRET=...
   set GMAIL_REFRESH_TOKEN=...
   set GMAIL_SENDER=...
   set CONTACT_EMAIL=your@email.com
   node test-gmail-send-local.mjs
   ```

---

### Lambda returns 503 on `/api/contact`

**Cause:** `GMAIL_*` environment variables not set in Lambda.

**Fix:** AWS Console → Lambda → Configuration → Environment Variables → add all four `GMAIL_*` vars.

---

### Data tables show empty in local dev

**Cause:** `local-data/use_cases.json` or `local-data/industry_use_cases.json` missing.

**Fix:** Create `local-data/` in the project root and add your JSON files. See `src/hooks/useS3Data.ts` for the expected data shape (snake_case keys).

---

For detailed AWS infrastructure setup (first-time Lambda function creation, S3 bucket policy, IAM role, Secrets Manager, Function URL configuration), see **[DEPLOYMENT_CONFIG.md](./DEPLOYMENT_CONFIG.md)**.
