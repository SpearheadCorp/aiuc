<p align="center">
  <img src="public/assets/purelogo.png" alt="Pure Storage" width="300" />
</p>

<h1 align="center">AI Use Case Repository (AIUC)</h1>

An internal, employee-only React dashboard for browsing AI use cases and industry-specific AI implementation records. Protected by Okta OIDC authentication and served via AWS Lambda + S3. Features semantic AI search powered by Amazon Bedrock embeddings and vector similarity, with AI-generated explanations for every result.

## Key Features

- **Secure Okta OIDC login** (PKCE flow) — no unauthenticated access
- **Use Case table** and **Industry data table** with multi-column filtering, sorting, and virtual scrolling
- **AI-powered semantic search** — query in plain English; Amazon Bedrock Titan embeds your query, finds the closest matches across 1 024-dimension vectors, and Bedrock Nova Lite explains why each result matched
- **Industry AI search** — same RAG pipeline applied to industry-specific records
- **Keyword fallback search** — automatic degradation when Bedrock is unavailable
- **Contact button** — opens a Gmail compose tab directly in the browser
- **Fully serverless** — one AWS Lambda function serves the React app, all API routes, and the vector search pipeline

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Local Development](#local-development)
4. [Environment Variables](#environment-variables)
5. [Architecture Overview](#architecture-overview)
6. [AI / RAG Search — How It Works](#ai--rag-search--how-it-works)
7. [Generating Embeddings](#generating-embeddings)
8. [API Endpoints](#api-endpoints)
9. [AWS Lambda Deployment](#aws-lambda-deployment)
10. [GitHub Actions CI/CD](#github-actions-cicd)
11. [Available Scripts](#available-scripts)
12. [Directory Structure](#directory-structure)
13. [Troubleshooting](#troubleshooting)

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
| **Storage** | AWS S3 (static assets + JSON data + pre-computed embeddings) |
| **Secrets** | AWS Secrets Manager (Okta Client ID) |
| **Embeddings Model** | Amazon Bedrock — Titan Text Embeddings v2 (`amazon.titan-embed-text-v2:0`, 1 024-dim) |
| **Explanation Model** | Amazon Bedrock — Nova Lite (`amazon.nova-lite-v1:0`) |
| **Vector Index** | Custom in-memory FlatIP index (cosine similarity on L2-normalised vectors) |
| **JWT Verification** | `jose` library |
| **Build Tool** | Vite (frontend), plain Node.js (Lambda) |
| **CI/CD** | GitHub Actions |

---

## Prerequisites

Install these before starting:

- **Node.js 20+** — [https://nodejs.org](https://nodejs.org)
- **npm 10+** — comes with Node.js
- **AWS CLI** configured with credentials that have access to Lambda, S3, Secrets Manager, and Bedrock — [install guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- **Okta developer account** (or org account) — for authentication
- **AWS account** with Amazon Bedrock access enabled in your region (needed for embedding generation and live search)

---

## Local Development

Local dev uses a **two-server setup**:

| Server | Command | Port | Purpose |
|--------|---------|------|---------|
| Vite dev server | `npm run dev` | `5173` | Serves frontend with hot reload |
| Local API server | `npm run dev:server` | `3001` | Mirrors all Lambda API routes including search |

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

# ── AWS / Bedrock ─────────────────────────────────────────────────────────────
AWS_REGION=us-east-2
# AWS credentials are picked up automatically from ~/.aws/credentials or env vars:
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...

# ── AI Search feature flag ────────────────────────────────────────────────────
ENABLE_AI_SEARCH=true        # set to false to force keyword-only search

# ── API proxy target ──────────────────────────────────────────────────────────
VITE_API_BASE_URL=http://localhost:3001
```

> `VITE_OKTA_ISSUER` and `VITE_OKTA_CLIENT_ID` come from your Okta app settings.
> AWS credentials for Bedrock are read from your local AWS config — no hard-coded keys needed.

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

### Step 4 — Add Local JSON Data Files

The data tables load from `/api/data/use-cases` and `/api/data/industry`. In local dev, the API server reads from local JSON files:

```
local-data/
├── use_cases.json
└── industry_use_cases.json
```

Create the `local-data/` folder in the project root and place your JSON data files there. If files are missing the tables render empty — auth and search flows still work.

The search endpoints also require the pre-computed embeddings files. Copy them into `local-data/` as well (or generate them — see [Generating Embeddings](#generating-embeddings)):

```
local-data/
├── use_cases.json
├── industry_use_cases.json
├── use_cases_embeddings.json           ← required for AI search
└── industry_use_cases_embeddings.json  ← required for industry AI search
```

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
  AI search    : enabled

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

Go to **http://localhost:5173** — you will be redirected to Okta to sign in, then land on the dashboard. Use the **AI Search** toggle in either table to try semantic search.

---

## Environment Variables

### Frontend (build-time, in `.env.local`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_OKTA_ISSUER` | Local dev only | — | Okta issuer URL (e.g. `https://company.okta.com/oauth2/default`) |
| `VITE_OKTA_CLIENT_ID` | Local dev only | — | Okta app Client ID |
| `VITE_API_BASE_URL` | Local dev only | — | API server URL for Vite proxy — set to `http://localhost:3001` |
| `VITE_CONTACT_EMAIL` | No | `aiuc@purestorage.com` | Contact email shown in the UI |
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
| `ENABLE_AI_SEARCH` | No | `true` | Set to `false` to disable Bedrock and use keyword-only search |
| `CONTACT_EMAIL` | No | `aiuc@purestorage.com` | Destination address shown in contact button |
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
  ├── Local Dev ──────────────────────────────────────────────────────────────
  │     Vite (port 5173) ──proxy /api/*──► local-server.mjs (port 3001)
  │                                           reads .env.local
  │                                           calls Bedrock for search
  │
  └── Production ─────────────────────────────────────────────────────────────
        Lambda Function URL
          ├── GET  /                        → Serves dist/index.html from S3
          ├── GET  /assets/*                → Serves static assets from S3
          ├── GET  /api/okta-config         → Secrets Manager → { issuer, clientId }
          ├── GET  /api/data/use-cases      → Verify JWT → S3 use_cases.json
          ├── GET  /api/data/industry       → Verify JWT → S3 industry_use_cases.json
          ├── POST /api/search              → Verify JWT → Bedrock embed → vector search → Nova Lite
          └── POST /api/search/industry     → Verify JWT → Bedrock embed → vector search → Nova Lite
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
├── dist/                                   ← Built React app (uploaded by CI/CD)
│   ├── index.html
│   └── assets/
│       ├── index-[hash].js
│       └── index-[hash].css
├── use_cases.json                          ← Use case data (upload manually)
├── industry_use_cases.json                 ← Industry data (upload manually)
├── use_cases_embeddings.json               ← Pre-computed vectors (upload after generation)
└── industry_use_cases_embeddings.json      ← Pre-computed vectors (upload after generation)
```

---

## AI / RAG Search — How It Works

AIUC implements a **Retrieval-Augmented Generation (RAG)** pipeline for both the Use Case and Industry tables. Here is the complete end-to-end flow:

### 1. Offline: Embedding Generation

Before the search feature can work, each record in `use_cases.json` and `industry_use_cases.json` must be converted into a numeric vector using Amazon Bedrock Titan Text Embeddings v2.

This is a **one-time offline step** that you run locally whenever the data changes. The scripts concatenate the most informative fields of each record into a single text string, call the Bedrock embedding API, and write the resulting 1 024-dimension vectors alongside the original records to a new JSON file.

See [Generating Embeddings](#generating-embeddings) for the exact commands.

### 2. Storage

The generated embedding files are stored in S3 alongside the raw data JSON. The Lambda loads them once per cold start and keeps them in memory for the lifetime of the execution environment — so there is no per-request S3 read overhead after the first call.

### 3. Query Time: Vector Search

When a user types a query and clicks **Search** with the AI Search toggle on:

```
User query
    │
    ▼ POST /api/search  (Bearer token)
    │
    ▼ Lambda
    ├── Verify Okta JWT
    ├── Load embeddings from S3 (cached in memory)
    ├── Call Bedrock Titan to embed the query → 1 024-dim vector
    ├── Compute cosine similarity against every stored vector (FlatIP index)
    ├── Return top-K results (default 10, max 15) with similarity score
    └── For each result, call Bedrock Nova Lite:
            "In one sentence, why does this record match the query?"
    │
    ▼ JSON response
    [
      { "useCase": { ...fields }, "score": 0.87, "whyMatched": "This record focuses on..." },
      ...
    ]
    │
    ▼ Frontend hook (useAISearch / useIndustrySearch)
    └── Renders results with score badge + "Why Matched" column
```

### 4. Fallback: Keyword Search

If Bedrock is unavailable (throttled, network error) or `ENABLE_AI_SEARCH=false`, the search endpoint automatically falls back to a **keyword search**: it splits the query into terms, counts how many fields each record matches, and returns results sorted by match count. The Nova Lite explanations are still generated for keyword results.

### 5. Frontend UI

In `UseCaseTable` and `IndustryDataTable` there is an **AI Search** toggle button (state persisted to `localStorage`).

- **Toggle off** — standard multi-column filter view
- **Toggle on** — shows a text input and **Search** button; results appear in a scored list with a **Why Matched** column

---

## Generating Embeddings

Run these scripts whenever your source data changes. You need AWS credentials with Bedrock access in the region where Titan is available.

### Use Case Embeddings

```bash
# From the project root
node lambda/generate-embeddings-local.mjs
```

- **Reads**: `public/data/use_cases.json`
- **Writes**: `public/data/use_cases_embeddings.json`
- **Fields embedded**: `ai_use_case`, `business_function`, `business_capability`, `action_implementation`, `expected_outcomes`, `stakeholder`, `ai_tools_models`, `datasets`
- **Model**: `amazon.titan-embed-text-v2:0` (1 024 dimensions, L2-normalised)
- Includes automatic retry with exponential backoff for Bedrock throttling

Expected output:
```
Generating embeddings for 250 use cases...
[1/250] Embedded: "Predictive maintenance for storage arrays"
[2/250] Embedded: "Automated capacity planning"
...
✓ Done. Written to public/data/use_cases_embeddings.json
```

### Industry Use Case Embeddings

```bash
node lambda/generate-embeddings-industry-local.mjs
```

- **Reads**: `public/data/industry_use_cases.json`
- **Writes**: `public/data/industry_use_cases_embeddings.json`
- **Fields embedded**: `ai_use_case`, `industry`, `business_function`, `business_capability`, `description`, `implementation_plan`, `expected_outcomes`, `stakeholders`, `ai_tools_platforms`, `datasets`

### Upload Embeddings to S3

After generating, upload both files to your S3 bucket so Lambda can load them:

```bash
aws s3 cp public/data/use_cases_embeddings.json \
    s3://YOUR_BUCKET_NAME/use_cases_embeddings.json \
    --region YOUR_REGION

aws s3 cp public/data/industry_use_cases_embeddings.json \
    s3://YOUR_BUCKET_NAME/industry_use_cases_embeddings.json \
    --region YOUR_REGION
```

> The embedding files are large (~10–15 MB each). Do **not** commit them to git — they are listed in `.gitignore`. Always regenerate from source and upload directly to S3.

### Embeddings File Format

Each file is a JSON array. Every element contains the original record and its 1 024-dimension vector:

```json
[
  {
    "useCase": {
      "id": 1,
      "ai_use_case": "Predictive maintenance for storage arrays",
      ...
    },
    "embedding": [0.0231, -0.0184, 0.0412, ...]
  },
  ...
]
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `GET` | `/api/okta-config` | No | Returns Okta `issuer` and `clientId` |
| `GET` | `/api/data/use-cases` | JWT | Returns use case JSON array from S3 |
| `GET` | `/api/data/industry` | JWT | Returns industry data JSON array from S3 |
| `POST` | `/api/search` | JWT | AI vector search over use cases |
| `POST` | `/api/search/industry` | JWT | AI vector search over industry records |
| `GET` | `/*` | No | Serves static files from S3 `dist/` |

### `POST /api/search` — Request Body

```json
{
  "query": "machine learning for storage capacity forecasting"
}
```

### `POST /api/search` — Success Response

```json
[
  {
    "useCase": {
      "id": 42,
      "Business Function": "IT Operations",
      "AI Use Case": "Predictive Capacity Planning",
      "Expected Outcomes and Results": "Reduce over-provisioning by 30%",
      "..."
    },
    "score": 0.891,
    "whyMatched": "This use case applies ML to forecast storage capacity needs, directly matching the query about capacity forecasting."
  },
  ...
]
```

### `POST /api/search/industry` — Request Body

```json
{
  "query": "AI fraud detection in financial services"
}
```

Response shape is the same as `/api/search` but the `useCase` field contains industry record fields (`Industry`, `Description`, `Implementation Plan`, etc.).

---

## AWS Lambda Deployment

> For first-time infrastructure setup (Lambda function creation, S3 bucket policy, IAM role, Secrets Manager, Function URL), see **[DEPLOYMENT_CONFIG.md](./DEPLOYMENT_CONFIG.md)**.

### IAM Permissions Required for AI Search

The Lambda execution role needs the following additional permissions for Bedrock:

```json
{
  "Effect": "Allow",
  "Action": [
    "bedrock:InvokeModel"
  ],
  "Resource": [
    "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2:0",
    "arn:aws:bedrock:*::foundation-model/amazon.nova-lite-v1:0"
  ]
}
```

Add this to your Lambda execution role in **IAM → Roles → Your Role → Add permissions → Create inline policy**.

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
aws s3 cp public/data/use_cases.json s3://YOUR_BUCKET_NAME/ --region YOUR_REGION
aws s3 cp public/data/industry_use_cases.json s3://YOUR_BUCKET_NAME/ --region YOUR_REGION
```

### 4 — Upload Embeddings (after generating or when data changes)

```cmd
aws s3 cp public/data/use_cases_embeddings.json s3://YOUR_BUCKET_NAME/ --region YOUR_REGION
aws s3 cp public/data/industry_use_cases_embeddings.json s3://YOUR_BUCKET_NAME/ --region YOUR_REGION
```

### 5 — Package the Lambda Function

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

### 6 — Deploy Lambda Code

```cmd
aws lambda update-function-code ^
  --function-name YOUR_LAMBDA_FUNCTION_NAME ^
  --zip-file fileb://lambda.zip ^
  --region YOUR_REGION
```

### 7 — Set Lambda Environment Variables

In **AWS Console → Lambda → Your Function → Configuration → Environment Variables → Edit**:

| Key | Example Value |
|-----|---------------|
| `BUCKET_NAME` | `auic` |
| `S3_REGION` | `us-east-2` |
| `DIST_PREFIX` | `dist` |
| `OKTA_ISSUER` | `https://company.okta.com/oauth2/default` |
| `OKTA_AUDIENCE` | `api://default` |
| `AIUC_SECRET_NAME` | `aiuc/okta` |
| `ENABLE_AI_SEARCH` | `true` |

### 8 — Register Lambda URL in Okta

In Okta Admin Console → **Applications → Your App → General**:

- **Sign-in redirect URIs** → add:
  ```
  https://YOUR_LAMBDA_FUNCTION_URL/login/callback
  ```
- **Sign-out redirect URIs** → add:
  ```
  https://YOUR_LAMBDA_FUNCTION_URL/
  ```

### 9 — Verify Deployment

```cmd
curl https://YOUR_LAMBDA_FUNCTION_URL/api/okta-config
```

Expected response:
```json
{"issuer":"https://company.okta.com/oauth2/default","clientId":"0oa..."}
```

Test the search endpoint (requires a valid Okta token):

```cmd
curl -X POST https://YOUR_LAMBDA_FUNCTION_URL/api/search ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_OKTA_ACCESS_TOKEN" ^
  -d "{\"query\":\"machine learning for storage\"}"
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

> Embedding files are **not** regenerated by CI/CD. Run the embedding scripts locally whenever your source data changes and upload the results to S3 manually (or add a separate manual workflow for it).

---

## Available Scripts

### Frontend

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server at `http://localhost:5173` |
| `npm run dev:server` | Start local API server at `http://localhost:3001` |
| `npm run build` | Type-check + build frontend to `dist/` |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint on `src/` |

### Embedding Generation

| Command | Description |
|---------|-------------|
| `npm run embeddings` | Generate `use_cases_embeddings.json` via Bedrock Titan |
| `npm run embeddings:industry` | Generate `industry_use_cases_embeddings.json` via Bedrock Titan |

Or run the scripts directly from the project root:

```bash
node lambda/generate-embeddings-local.mjs
node lambda/generate-embeddings-industry-local.mjs
```

---

## Directory Structure

```
aiuc/
├── .github/
│   └── workflows/
│       └── deploy.yml                          # GitHub Actions CI/CD
├── docs/
│   └── plans/                                  # Implementation plan docs
├── lambda/
│   ├── index.mjs                               # Lambda handler (routes, auth, S3, search)
│   ├── local-server.mjs                        # Local dev API server (mirrors Lambda)
│   ├── generate-embeddings-local.mjs           # Bedrock Titan embedding gen — use cases
│   ├── generate-embeddings-industry-local.mjs  # Bedrock Titan embedding gen — industry
│   ├── package.json
│   └── package-lock.json
├── local-data/                                 # (gitignored) local JSON data files for dev
│   ├── use_cases.json
│   ├── industry_use_cases.json
│   ├── use_cases_embeddings.json
│   └── industry_use_cases_embeddings.json
├── public/
│   ├── assets/
│   │   ├── purelogo.png
│   │   └── spearhead.png
│   └── data/                                   # Source data and generated embeddings
│       ├── use_cases.json
│       ├── industry_use_cases.json
│       ├── use_cases_embeddings.json           # Generated — do not commit
│       └── industry_use_cases_embeddings.json  # Generated — do not commit
├── src/
│   ├── components/
│   │   ├── ContactDialog.tsx                   # Contact button (opens Gmail compose)
│   │   ├── IndustryDataTable.tsx               # Industry table with filters + AI search
│   │   ├── UseCaseTable.tsx                    # Use case table with filters + AI search
│   │   └── Logo.tsx
│   ├── config/
│   │   └── okta.ts                             # Okta SDK initialization
│   ├── hooks/
│   │   ├── useAISearch.ts                      # Vector search hook — use cases
│   │   ├── useIndustrySearch.ts                # Vector search hook — industry
│   │   ├── useOktaUser.ts                      # Extract user info from Okta token
│   │   └── useS3Data.ts                        # Fetch + map raw data from API
│   ├── App.tsx                                 # Main dashboard (tabs, layout)
│   ├── main.tsx                                # Entry point, Okta Security wrapper
│   ├── theme.ts                                # MUI theme (Pure Storage branding)
│   ├── types.ts                                # TypeScript interfaces
│   ├── utils.ts
│   └── globals.css
├── .env.local                                  # (gitignored) local env vars
├── .gitignore
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
├── README.md
└── DEPLOYMENT_CONFIG.md                        # Detailed AWS infrastructure setup guide
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

**Fix:** Okta Admin → **Applications → Your App → Assignments** → assign your user.

---

### AI Search returns no results / falls back to keyword search

**Cause:** Bedrock is not reachable — missing credentials, wrong region, or model not enabled.

**Fix:**
1. Confirm your AWS credentials have Bedrock `InvokeModel` permission for Titan and Nova Lite
2. Make sure Bedrock model access is **enabled** in the AWS Console: **Bedrock → Model access → Manage model access** → enable `amazon.titan-embed-text-v2:0` and `amazon.nova-lite-v1:0`
3. Check that `AWS_REGION` in `.env.local` matches the region where you enabled models
4. Run a direct Bedrock test:
   ```bash
   aws bedrock-runtime invoke-model \
     --model-id amazon.titan-embed-text-v2:0 \
     --body '{"inputText":"test"}' \
     --cli-binary-format raw-in-base64-out \
     output.json --region us-east-2
   ```

---

### AI Search endpoint returns `500 — embeddings not loaded`

**Cause:** The embedding JSON files are missing from S3 (or `local-data/` in dev).

**Fix:**
1. Run the embedding generation scripts (see [Generating Embeddings](#generating-embeddings))
2. Upload the output files to S3
3. In local dev, copy the files to `local-data/`

---

### Embedding generation script fails with throttling errors

**Cause:** Bedrock Titan has per-minute request limits and you are hitting them.

**Fix:** The scripts include automatic retry with exponential backoff — they will handle this automatically. If the failure is persistent, reduce the concurrency by adding a `--delay` flag (or wait a few minutes and re-run — the script is safe to restart; existing embeddings are overwritten).

---

### `Cannot find package 'googleapis'` or `@aws-sdk/*`

**Cause:** Running `node local-server.mjs` directly from the root. Dependencies live in `lambda/node_modules`.

**Fix:** Always use the npm script from the project root:
```cmd
npm run dev:server
```

---

### Data tables show empty in local dev

**Cause:** `local-data/use_cases.json` or `local-data/industry_use_cases.json` missing.

**Fix:** Create `local-data/` in the project root and add your JSON files. See `src/hooks/useS3Data.ts` for the expected data shape (snake_case keys).

---

### Lambda search endpoint returns `403` or `401`

**Cause:** The Okta JWT sent in `Authorization: Bearer` is expired or the Lambda's `OKTA_ISSUER` / `OKTA_AUDIENCE` doesn't match.

**Fix:**
1. Refresh your Okta session in the browser (log out and log back in)
2. Verify `OKTA_ISSUER` in Lambda env vars matches `VITE_OKTA_ISSUER` used at build time
3. Verify `OKTA_AUDIENCE` is `api://default` (or whatever your Okta authorization server uses)

---

For detailed AWS infrastructure setup (first-time Lambda function creation, S3 bucket policy, IAM role, Secrets Manager, Function URL configuration), see **[DEPLOYMENT_CONFIG.md](./DEPLOYMENT_CONFIG.md)**.
