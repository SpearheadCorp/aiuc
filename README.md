# AI Use Case Repository (AIUC)

A React + TypeScript SPA backed by a single AWS Lambda function that lets authenticated employees browse, filter, and semantically search an internal library of AI use cases. Users type a natural-language sentence or paragraph; the system embeds the query with OpenAI, runs cosine-similarity search against pre-computed use-case vectors, and returns the most relevant results along with a concise "Why Matched" explanation for each one.

Deployed at: **Everpure (PureStorage)** — authentication via Okta, AI via OpenAI, infra on AWS (Lambda + S3).

---

## Table of Contents

1. [Key Features](#key-features)
2. [Tech Stack](#tech-stack)
3. [Prerequisites](#prerequisites)
4. [Getting Started — Local Development](#getting-started--local-development)
5. [Architecture](#architecture)
6. [OpenAI Embedding Pipeline](#openai-embedding-pipeline)
7. [Environment Variables Reference](#environment-variables-reference)
8. [Available Scripts](#available-scripts)
9. [Deployment](#deployment)
   - [Step 1 — Generate & Upload Embeddings](#step-1--generate--upload-embeddings)
   - [Step 2 — Build & Upload Frontend](#step-2--build--upload-frontend)
   - [Step 3 — Package & Deploy Lambda](#step-3--package--deploy-lambda)
   - [Step 4 — AWS Secrets Manager](#step-4--aws-secrets-manager)
   - [Step 5 — Lambda Environment Variables](#step-5--lambda-environment-variables)
   - [CI/CD via GitHub Actions](#cicd-via-github-actions)
10. [AI Search Feature Flag](#ai-search-feature-flag)
11. [Rate Limiting](#rate-limiting)
12. [Troubleshooting](#troubleshooting)

---

## Key Features

- **Semantic AI Search** — type a sentence or full paragraph; the system finds the most relevant use cases by meaning, not just keywords.
- **"Why Matched" column** — each result includes a 1–2 sentence AI-generated explanation of why it matched the query.
- **Two datasets** — "Case Study" (PureStorage-specific use cases) and "Industry Data" (cross-industry use cases), each with independent AI search.
- **AI toggle flag** — `ENABLE_AI_SEARCH=false` falls back to keyword search with no UI change, useful for cost control or if the OpenAI key is unavailable.
- **Okta PKCE authentication** — all data endpoints require a valid Okta JWT; the Okta config is fetched dynamically at runtime, not baked into the build.
- **Virtualized tables** — TanStack React Table + React Virtual handle large datasets smoothly without pagination.
- **Per-user rate limiting** — sliding-window limit on `/api/search*` protects OpenAI costs.
- **Shared Lambda core** — both the Everpure and Spearhead deployments import from the same `lambda/core/` module; only auth, branding, and data configs differ.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript 5.9, Vite 7 |
| **UI** | Material UI (MUI) v5, Emotion |
| **Tables** | TanStack React Table v8 + React Virtual v3 |
| **Auth** | Okta PKCE (`@okta/okta-react`, `@okta/okta-auth-js`) |
| **Backend** | AWS Lambda (Node.js 20, ESM) |
| **Static hosting** | AWS S3 (Lambda serves `dist/` from S3) |
| **JWT verification** | `jose` (JWKS, RS256) |
| **AI Embeddings** | OpenAI `text-embedding-3-small` (1536 dimensions) |
| **AI Explanations** | OpenAI `gpt-4o-mini` |
| **Vector search** | Pure-JS cosine similarity (FlatIP index, in-memory) |
| **Secrets** | AWS Secrets Manager |
| **CI/CD** | GitHub Actions (`.github/workflows/deploy.yml`) |

---

## Prerequisites

Make sure you have these installed before starting:

- **Node.js 20+** — `node --version`
- **npm 10+** — included with Node.js
- **AWS CLI** — for S3 uploads and Lambda deploys (`aws --version`)
- **An OpenAI API key** — needed only for generating embeddings locally and for the local dev server AI search. In production the key comes from Secrets Manager.
- **An Okta developer account** — for local auth testing. The app fetches Okta config from `/api/okta-config` at runtime.

---

## Getting Started — Local Development

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_ORG/aiuc.git
cd aiuc
```

### 2. Install dependencies

```bash
# Root (frontend + dev tools)
npm install

# Lambda (backend runtime dependencies)
cd lambda && npm install && cd ..
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in:

```env
# Okta — get these from your Okta admin or AWS Secrets Manager
VITE_OKTA_ISSUER=https://YOUR_OKTA_DOMAIN.okta.com/oauth2/default
VITE_OKTA_CLIENT_ID=0oaXXXXXXXXXXXXXXXXX

# OpenAI — local dev only (production uses Secrets Manager)
# Note: use OPENAI_API_KEY_N, not OPENAI_API_KEY, to avoid conflict with
# any system-level key you may already have set in your shell.
OPENAI_API_KEY_N=sk-proj-...

# Vite dev proxy target
VITE_API_BASE_URL=http://localhost:3001
```

> **Why `OPENAI_API_KEY_N`?** If your machine already has `OPENAI_API_KEY` set as a system environment variable (e.g., from another project), the `.env.local` loader would skip it because the key already exists in the process environment. Using a unique name (`OPENAI_API_KEY_N`) guarantees the correct key is always picked up from `.env.local` regardless of what is set system-wide.

### 4. Generate embeddings (first time only)

`use_cases.json` and `industry_use_cases.json` are already committed in `public/data/` — you don't need to create or copy them anywhere. What you do need to generate are the **embedding files** (vectors computed from that data), which are gitignored due to their size:

```bash
npm run embeddings          # → public/data/pure_use_cases_embeddings.json
npm run embeddings:industry # → public/data/pure_industry_use_cases_embeddings.json
```

Each script reads `.env.local` automatically, so no shell env var setup is needed. Re-run only when the source JSON data changes.

> See [OpenAI Embedding Pipeline](#openai-embedding-pipeline) for a full explanation of what these files are and why they exist.

### 5. Start development servers (two terminals)

**Terminal 1 — Local API server (port 3001):**

```bash
npm run dev:server
```

You should see:

```
✓ Loaded .env.local
✓ Local API server running at http://localhost:3001
  Okta issuer  : https://trial-XXXXXXX.okta.com/oauth2/default
  Okta clientId: 0oaXXXXXXXXXXXXXXXXX
  AI search    : enabled

Ready — waiting for Vite proxy requests...
```

**Terminal 2 — Vite dev server (port 5173):**

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). You will be redirected to Okta for login.

> The Vite server proxies all `/api/*` requests to `localhost:3001`, so you get the same API behaviour as production without deploying anything.

---

## Architecture

### Directory structure

```
aiuc/
├── src/                          # React frontend
│   ├── main.tsx                  # Entry point — initialises Okta dynamically
│   ├── App.tsx                   # Root layout: header, tabs, footer
│   ├── types.ts                  # TypeScript interfaces (UseCaseData, IndustryData)
│   ├── theme.ts                  # MUI theme + brand colours
│   ├── components/
│   │   ├── UseCaseTable.tsx      # Case Study tab — table + AI search bar
│   │   ├── IndustryDataTable.tsx # Industry Data tab — table + AI search bar
│   │   ├── ContactDialog.tsx     # "Request Info" modal (opens Gmail compose)
│   │   └── Logo.tsx              # Accessible logo with fallback text
│   ├── hooks/
│   │   ├── useS3Data.ts          # Fetches both datasets on mount (JWT-authenticated)
│   │   ├── useAISearch.ts        # POST /api/search — use case semantic search
│   │   ├── useIndustrySearch.ts  # POST /api/search/industry — industry semantic search
│   │   └── useOktaUser.ts        # Extracts user name + email from Okta auth state
│   └── config/
│       └── okta.ts               # Fetches /api/okta-config then builds OktaAuth instance
│
├── lambda/                       # AWS Lambda backend (Node.js 20, ESM)
│   ├── index.mjs                 # Main handler — routes all requests
│   ├── core/                     # Shared module (Everpure + Spearhead both import this)
│   │   ├── embeddings.mjs        # OpenAI text-embedding-3-small wrapper
│   │   ├── why_matched.mjs       # OpenAI gpt-4o-mini "Why Matched" generation
│   │   ├── search.mjs            # FlatIP index, vector search, keyword fallback
│   │   ├── api_handlers.mjs      # Route logic for /api/search and /api/search/industry
│   │   └── ai_toggle.mjs         # ENABLE_AI_SEARCH feature flag
│   ├── local-server.mjs          # Dev server that mirrors Lambda (reads local files)
│   ├── generate-embeddings-local.mjs          # Generate use case embeddings
│   ├── generate-embeddings-industry-local.mjs # Generate industry embeddings
│   ├── clean-for-lambda.mjs      # Strips unused deps before zipping
│   └── package.json              # Lambda-only dependencies
│
├── public/data/                  # Data files
│   ├── use_cases.json                           # Already in repo — source of truth
│   ├── industry_use_cases.json                  # Already in repo — source of truth
│   ├── pure_use_cases_embeddings.json           # Generated locally, gitignored
│   └── pure_industry_use_cases_embeddings.json  # Generated locally, gitignored
│
├── .github/workflows/deploy.yml  # CI/CD — builds, syncs S3, deploys Lambda
├── .env.example                  # Environment variable reference (committed)
├── .env.local                    # Your local values (gitignored — never commit)
└── vite.config.ts                # Vite config — proxies /api/* to localhost:3001
```

### API routes

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Health check for uptime monitors |
| `GET` | `/api/okta-config` | None | Returns Okta issuer + clientId from Secrets Manager |
| `GET` | `/api/data/use-cases` | JWT | Reads `use_cases.json` from S3 |
| `GET` | `/api/data/industry` | JWT | Reads `industry_use_cases.json` from S3 |
| `POST` | `/api/search` | JWT + rate limit | Semantic search over use cases |
| `POST` | `/api/search/industry` | JWT + rate limit | Semantic search over industry use cases |
| `GET` | `/*` | None | Serves `dist/index.html` or static assets from S3 |

### Request flow

```
Browser
  │
  ├─ GET /api/okta-config  ──────────────────► Lambda (no auth)
  │                                              └─ Reads OKTA_CLIENT_ID from Secrets Manager
  │                                              └─ Returns { issuer, clientId }
  │
  ├─ Okta PKCE login (redirect) ─────────────► Okta IdP
  │                                              └─ Returns access_token (JWT, RS256)
  │
  ├─ GET /api/data/use-cases ────────────────► Lambda (JWT required)
  │   Authorization: Bearer <token>              └─ Verifies token against Okta JWKS
  │                                              └─ Reads use_cases.json from S3
  │
  └─ POST /api/search ───────────────────────► Lambda (JWT + rate limit)
      { "query": "automate invoice processing" } └─ Fetches OpenAI key from Secrets Manager
                                                 └─ Embeds query via OpenAI (1536-dim)
                                                 └─ Loads pure_use_cases_embeddings.json from S3
                                                 └─ Cosine similarity search (FlatIP index)
                                                 └─ Generates "Why Matched" via gpt-4o-mini
                                                 └─ Returns top-K results + explanations
```

### Authentication flow

1. Frontend loads → calls `GET /api/okta-config` (unauthenticated).
2. Lambda reads `OKTA_CLIENT_ID` from AWS Secrets Manager and returns `{ issuer, clientId }`.
3. Frontend initialises `OktaAuth` with these values — not baked in at build time, so the Okta config can change without a rebuild.
4. Unauthenticated users are redirected to Okta login via PKCE.
5. After login, all API calls include `Authorization: Bearer <access_token>`.
6. Lambda verifies the JWT signature on every request using Okta's JWKS endpoint (RS256).

### Shared core module

`lambda/core/` is the single source of truth for all RAG logic. Both the Everpure Lambda and the Spearhead Lambda import from `core/` — never duplicating the embedding, search, or explanation code. Only deployment-specific things differ: auth provider, branding, S3 bucket, and embedding file names.

```
lambda/index.mjs (Everpure)    ──┐
                                  ├──► lambda/core/ (shared RAG + search logic)
spearhead/index.mjs (Spearhead) ──┘
```

---

## OpenAI Embedding Pipeline

### What embeddings are and why we need them

Standard keyword search matches exact words. If a user types *"reduce manual effort in accounts payable"*, keyword search won't find a use case titled *"Invoice Automation"* unless the same words appear. Semantic/vector search fixes this by converting both the query and every use case into a high-dimensional numeric vector (an "embedding") where **meaning determines proximity**, not exact words.

We use **OpenAI `text-embedding-3-small`** — a 1536-dimension model. Each use case record is converted into a 1536-number vector and stored in a JSON file on S3. At search time, the user's query is embedded on the fly, then compared against all stored vectors using cosine similarity. The closest matches are returned.

### Why we pre-compute embeddings offline

Embedding every use case at search time would be extremely slow and expensive. Instead, we embed them **once locally** and upload the result to S3. The Lambda loads this file into memory on first request and caches it for the lifetime of the container — subsequent searches are near-instant.

### Why the files are named `pure_*`

Both the Everpure (PureStorage) and Spearhead deployments may share the same S3 bucket. The `pure_` prefix namespaces Everpure's embedding files so they never overwrite Spearhead's files:

| S3 file | Deployment | Model |
|---|---|---|
| `pure_use_cases_embeddings.json` | Everpure | OpenAI `text-embedding-3-small` (1536-dim) |
| `pure_industry_use_cases_embeddings.json` | Everpure | OpenAI `text-embedding-3-small` (1536-dim) |
| `use_cases_embeddings.json` | Spearhead | AWS Bedrock Titan (different vector space) |
| `industry_use_cases_embeddings.json` | Spearhead | AWS Bedrock Titan (different vector space) |

> **Important:** Everpure uses OpenAI embeddings; Spearhead uses AWS Bedrock Titan. These live in completely different vector spaces — you cannot mix files between deployments even if dimensions happen to match. Always regenerate from scratch if you switch models.

### Why OpenAI instead of Bedrock for Everpure

Everpure's infosec team has not officially approved AWS Bedrock. OpenAI APIs are approved and the key is stored securely in AWS Secrets Manager under `EVERPURE_OPENAI_API_KEY`. Spearhead continues to use Bedrock since it is already approved for that deployment.

### How "Why Matched" works

After the vector search returns the top-K results, the Lambda makes **a single `gpt-4o-mini` call** with all results in one prompt. It asks the model to write 1–2 sentences for each result explaining specifically why it matches the query. The response is parsed as a JSON array and attached to each result before returning to the frontend.

```
Query: "automate invoice processing"
           │
           ├─ OpenAI embedding → [0.021, -0.041, ...] (1536 dims)
           │
           ├─ Cosine similarity vs all pre-computed use-case vectors
           │
           ├─ Top 10 results selected
           │
           └─ Single gpt-4o-mini call:
                "For each of the following 10 use cases, write 1-2 sentences
                 explaining why it matches the query..."
                  └─ Returns JSON array of 10 explanations
```

### Step-by-step: generating embedding files locally

**Prerequisites:** `OPENAI_API_KEY_N` set in `.env.local`.

```bash
# Generate use case embeddings
npm run embeddings
```

Expected output:

```
✓ Loaded .env.local
Model:      text-embedding-3-small (1536 dimensions)
Output:     .../public/data/pure_use_cases_embeddings.json

Generating embeddings for 87 use cases…

  [ 10/87] done
  [ 20/87] done
  ...
  [ 87/87] done

✓ 87 embeddings (2.1 MB) → public/data/pure_use_cases_embeddings.json

Upload to S3:
  aws s3 cp public/data/pure_use_cases_embeddings.json s3://YOUR_BUCKET/pure_use_cases_embeddings.json
```

```bash
# Generate industry use case embeddings
npm run embeddings:industry
# → public/data/pure_industry_use_cases_embeddings.json
```

**What each record in the embedding file looks like:**

```json
[
  {
    "useCase": {
      "ai_use_case": "Invoice Automation",
      "business_function": "Finance",
      "business_capability": "Accounts Payable",
      "action_implementation": "Use ML to extract and process invoice data...",
      "...": "..."
    },
    "embedding": [0.0231, -0.0418, 0.0872, "..."]
  }
]
```

**When to regenerate:**

- `use_cases.json` or `industry_use_cases.json` data changes (new records, edited fields).
- You switch embedding models (any model change = incompatible vector space = must regenerate everything).
- Old Bedrock Titan (1024-dim) files are in S3 — these are **not compatible** with OpenAI vectors even if you try to reuse them.

---

## Environment Variables Reference

### `.env.local` — local development only (never commit)

| Variable | Required | Description |
|---|---|---|
| `VITE_OKTA_ISSUER` | Yes | Okta OAuth2 issuer URL |
| `VITE_OKTA_CLIENT_ID` | Yes | Okta OIDC client ID |
| `VITE_API_BASE_URL` | Yes | Vite proxy target — set to `http://localhost:3001` |
| `OPENAI_API_KEY_N` | For AI search | OpenAI API key for local embedding generation and dev server AI search |

### Lambda runtime — set in AWS Lambda Console

| Variable | Default | Description |
|---|---|---|
| `BUCKET_NAME` | _(required)_ | S3 bucket name |
| `S3_REGION` | `us-east-2` | AWS region for S3 and Secrets Manager |
| `DIST_PREFIX` | `dist` | S3 key prefix where the frontend `dist/` is uploaded |
| `AIUC_SECRET_NAME` | _(required)_ | Secrets Manager secret name |
| `OKTA_ISSUER` | _(required)_ | Okta issuer URL for JWT verification |
| `OKTA_AUDIENCE` | `api://default` | Expected JWT audience claim |
| `USE_CASES_EMBEDDINGS_KEY` | `pure_use_cases_embeddings.json` | S3 key for use case embeddings |
| `INDUSTRY_EMBEDDINGS_KEY` | `pure_industry_use_cases_embeddings.json` | S3 key for industry embeddings |
| `ENABLE_AI_SEARCH` | `true` | Set to `false` to force keyword-only search |
| `SEARCH_RATE_LIMIT_MAX` | `10` | Max search requests per user per window |
| `SEARCH_RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window in ms (default: 1 minute) |
| `BASE_PATH` | _(empty)_ | Sub-path prefix if deployed behind a reverse proxy |

### AWS Secrets Manager — secret JSON shape

The secret named by `AIUC_SECRET_NAME` must contain:

```json
{
  "OKTA_CLIENT_ID": "0oaXXXXXXXXXXXXXXXXX",
  "EVERPURE_OPENAI_API_KEY": "sk-proj-..."
}
```

The Lambda reads both keys from one secret on cold start and caches them in memory for the lifetime of the container.

---

## Available Scripts

Run from the project root:

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server on port 5173 (proxies `/api/*` → port 3001) |
| `npm run dev:server` | Start local Lambda-mirror API server on port 3001 |
| `npm run build` | Type-check (`tsc -b`) then build frontend to `dist/` |
| `npm run lint` | Run ESLint across the entire project |
| `npm run preview` | Preview the production build locally |
| `npm run embeddings` | Generate `public/data/pure_use_cases_embeddings.json` |
| `npm run embeddings:industry` | Generate `public/data/pure_industry_use_cases_embeddings.json` |

Run from the `lambda/` directory:

| Command | Description |
|---|---|
| `npm install --omit=dev` | Install production-only dependencies before zipping |

---

## Deployment

### Step 1 — Generate & Upload Embeddings

Do this whenever the data files change or when setting up a fresh environment.

```bash
# 1. Generate embedding files locally (reads OPENAI_API_KEY_N from .env.local)
npm run embeddings
npm run embeddings:industry

# 2. Upload to S3
#    The pure_ prefix keeps Everpure files separate from Spearhead files
#    that may share the same bucket.
aws s3 cp public/data/pure_use_cases_embeddings.json \
  s3://YOUR_BUCKET_NAME/pure_use_cases_embeddings.json

aws s3 cp public/data/pure_industry_use_cases_embeddings.json \
  s3://YOUR_BUCKET_NAME/pure_industry_use_cases_embeddings.json
```

> These files are 1–3 MB each and are **not committed to git**. Always regenerate from the source JSON files when data changes.

### Step 2 — Build & Upload Frontend

```bash
# Build the React frontend
npm run build

# Sync dist/ to S3 (--delete removes files that no longer exist locally)
aws s3 sync dist/ s3://YOUR_BUCKET_NAME/dist/ --delete

# Upload source data files (not the embeddings — those are handled in Step 1)
aws s3 cp public/data/use_cases.json s3://YOUR_BUCKET_NAME/use_cases.json
aws s3 cp public/data/industry_use_cases.json s3://YOUR_BUCKET_NAME/industry_use_cases.json
```

### Step 3 — Package & Deploy Lambda

```bash
cd lambda

# 1. Install production dependencies only
npm install --omit=dev

# 2. Strip packages already provided by the Lambda Node.js 20 runtime.
#    AWS SDK v3 (@aws-sdk/* + @smithy/*) ships built-in — bundling it wastes ~18 MB.
rm -rf node_modules/@aws-sdk
rm -rf node_modules/@smithy
rm -rf node_modules/@aws-crypto
rm -rf node_modules/@types
rm -rf node_modules/@googleapis
rm -rf node_modules/@xenova
rm -rf node_modules/@huggingface

# 3. Create the zip.
#    IMPORTANT: include core/ — index.mjs imports from ./core/api_handlers.mjs etc.
#    Without core/ the Lambda will throw a module-not-found error on every invocation.
zip -r ../lambda.zip index.mjs package.json core/ node_modules/

cd ..

# 4. Check size (should be ~4 MB)
du -sh lambda.zip

# 5. Upload and deploy
aws s3 cp lambda.zip s3://YOUR_BUCKET_NAME/deployments/lambda.zip

aws lambda update-function-code \
  --function-name YOUR_LAMBDA_FUNCTION_NAME \
  --s3-bucket YOUR_BUCKET_NAME \
  --s3-key deployments/lambda.zip
```

Expected zip size: **~4 MB** (jose + openai packages, core/ modules, handler).

### Step 4 — AWS Secrets Manager

The Lambda reads both the Okta client ID and the OpenAI API key from a **single** Secrets Manager secret, so you only need to manage one secret entry.

**One-time setup:**

1. Go to **AWS Secrets Manager → Store a new secret**.
2. Choose **Other type of secret** → **Plaintext** tab.
3. Paste this JSON (replacing placeholder values):

```json
{
  "OKTA_CLIENT_ID": "0oaXXXXXXXXXXXXXXXXX",
  "EVERPURE_OPENAI_API_KEY": "sk-proj-..."
}
```

4. Give the secret a name, e.g. `aiuc/everpure`.
5. Finish and save.

**IAM permission:** The Lambda's execution role needs:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:GetSecretValue",
  "Resource": "arn:aws:secretsmanager:us-east-2:YOUR_ACCOUNT_ID:secret:aiuc/everpure-*"
}
```

> **Why Secrets Manager instead of Lambda env vars?** Lambda env vars are visible in plain text to anyone with `lambda:GetFunctionConfiguration` IAM permission. Secrets Manager encrypts values at rest with KMS, provides fine-grained IAM access control, and enables key rotation without redeployment.

### Step 5 — Lambda Environment Variables

Set these in **AWS Lambda Console → Configuration → Environment variables**:

| Key | Value |
|---|---|
| `BUCKET_NAME` | Your S3 bucket name |
| `S3_REGION` | `us-east-2` (or your region) |
| `DIST_PREFIX` | `dist` |
| `AIUC_SECRET_NAME` | `aiuc/everpure` |
| `OKTA_ISSUER` | `https://YOUR_OKTA_DOMAIN.okta.com/oauth2/default` |
| `OKTA_AUDIENCE` | `api://default` |
| `USE_CASES_EMBEDDINGS_KEY` | `pure_use_cases_embeddings.json` |
| `INDUSTRY_EMBEDDINGS_KEY` | `pure_industry_use_cases_embeddings.json` |
| `ENABLE_AI_SEARCH` | `true` |

### CI/CD via GitHub Actions

Pushing to `main` automatically triggers `.github/workflows/deploy.yml` which:

1. Installs root dependencies and builds the frontend (`npm run build`).
2. Syncs `dist/` to S3.
3. Uploads `use_cases.json`, `industry_use_cases.json`, and any `pure_*_embeddings.json` files found in `public/data/`.
4. Installs Lambda production deps, strips the bundled AWS SDK (provided by the Lambda runtime), zips `index.mjs + package.json + core/ + node_modules/`, uploads to S3, and calls `update-function-code`.

**Required GitHub Secrets** (Settings → Secrets → Actions):

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `AWS_REGION` | e.g. `us-east-2` |
| `S3_BUCKET_NAME` | S3 bucket name |
| `LAMBDA_FUNCTION_NAME` | Lambda function name |

> **Embeddings are not auto-generated in CI.** The `pure_*_embeddings.json` files must already exist in `public/data/` before CI runs (generated locally and committed, or already uploaded to S3 separately). Since each file can be 1–3 MB, many teams generate them once after a data change and upload directly rather than committing to git.

---

## AI Search Feature Flag

The `ENABLE_AI_SEARCH` Lambda environment variable controls whether semantic search is active:

| Value | Behaviour |
|---|---|
| `true` (default) | Vector embedding search + "Why Matched" explanations via OpenAI |
| `false` | Keyword term-frequency search only, no OpenAI calls, no cost |

When set to `false`:
- No OpenAI API calls are made — zero cost.
- The UI search bar still works — results are returned by keyword matching across all text fields.
- No code changes or redeployment needed — just update the env var and the Lambda picks it up on the next cold start.

This flag is useful for:
- Cost control during non-critical periods.
- Incident response if OpenAI has an outage.
- Environments where AI has not yet been approved (deploy with `false`, enable when ready).

---

## Rate Limiting

The `/api/search` and `/api/search/industry` endpoints enforce a per-user sliding-window rate limit to protect OpenAI costs.

**Defaults:** 10 requests per user per 60 seconds.

- Keyed on the `sub` (subject) claim from the verified JWT — one limit per Okta user identity.
- When exceeded: `HTTP 429` with a `Retry-After` header (seconds until the window clears).
- The frontend surfaces the retry delay in the UI error message.
- Tune via Lambda env vars: `SEARCH_RATE_LIMIT_MAX` and `SEARCH_RATE_LIMIT_WINDOW_MS`.

> **Note:** The rate limit store is in-memory per Lambda container. If AWS scales to multiple concurrent containers, each has its own store. For a hard global cap, set **Lambda reserved concurrency** in the AWS console — this limits the total number of parallel Lambda executions.

---

## Troubleshooting

### AI search returns "Search failed. Please try again."

Check CloudWatch logs for the Lambda. Common causes:

**1. OpenAI key not found:**
```
Error: OpenAI API key not found in Secrets Manager or OPENAI_API_KEY env var
```
→ Verify `AIUC_SECRET_NAME` is set correctly and the secret JSON contains `EVERPURE_OPENAI_API_KEY`.

**2. Lambda can't reach Secrets Manager:**
→ Check the Lambda IAM execution role has `secretsmanager:GetSecretValue` permission on the secret ARN.

**3. Embeddings file not found in S3:**
```
[SearchIndex] empty or invalid embeddings at s3://BUCKET/pure_use_cases_embeddings.json
```
→ Run `npm run embeddings` locally and upload the file (see [Step 1](#step-1--generate--upload-embeddings)).

**4. Dimension mismatch / wrong model:**
→ Old Bedrock Titan (1024-dim) files were uploaded instead of OpenAI (1536-dim) ones. Regenerate using `npm run embeddings`.

---

### Local dev server fails — "OPENAI_API_KEY_N is not set"

Ensure `.env.local` contains:
```
OPENAI_API_KEY_N=sk-proj-...
```
The scripts read `.env.local` automatically — no shell export needed.

---

### Local dev server starts but AI search returns 503

The embeddings files don't exist in `public/data/`. Run:
```bash
npm run embeddings
npm run embeddings:industry
```

---

### Frontend shows "Failed to load authentication configuration"

The `/api/okta-config` call failed.

**Local dev:** Ensure `npm run dev:server` is running on port 3001 and `VITE_OKTA_ISSUER` / `VITE_OKTA_CLIENT_ID` are set in `.env.local`.

**Production:** Check `AIUC_SECRET_NAME` is set in Lambda env vars and the Secrets Manager secret exists with `OKTA_CLIENT_ID`.

---

### Lambda zip is too large (> 50 MB)

Run the cleanup script before zipping:
```bash
cd lambda
npm install --omit=dev
rm -rf node_modules/@aws-sdk node_modules/@smithy node_modules/@aws-crypto
rm -rf node_modules/@types node_modules/@googleapis node_modules/@xenova node_modules/@huggingface
zip -r ../lambda.zip index.mjs package.json core/ node_modules/
```
Expected final size: ~4 MB. If still large, check for unexpected packages in `lambda/node_modules/`.

---

### Data changes not reflected after deployment

The Lambda caches the search index in memory for the lifetime of the container. After uploading new embedding files or data files to S3:
- Either wait for the Lambda container to recycle (happens automatically after a period of inactivity), or
- Force a cold start by deploying a new version: `aws lambda update-function-code ...`

---

### Rate limit hit during local testing

The local dev server (`local-server.mjs`) does **not** enforce rate limits — they only apply to the Lambda. You can make unlimited search requests locally.

---

### Okta token expired mid-session

The `useOktaAuth` hook handles token refresh automatically via Okta's silent renew mechanism. If you see 401 errors, try signing out and back in via the Okta redirect.
