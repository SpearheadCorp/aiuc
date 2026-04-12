# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Local development (requires two terminals)
npm run dev:server   # Start local API server on port 3001
npm run dev          # Start Vite dev server on port 5173 (proxies /api/* → 3001)

# Build & quality
npm run build        # Type-check (tsc -b) then build frontend to dist/
npm run lint         # Run ESLint across the entire project
npm run preview      # Preview the production build locally
```

For Lambda-only dependency installs, run `npm install` inside the `lambda/` directory.

## Architecture

This is a React + TypeScript SPA backed by a single AWS Lambda function that also serves the frontend from S3.

### Two-server local dev model
- `vite.config.ts` proxies `/api/*` to `localhost:3001`
- `lambda/local-server.mjs` mirrors the Lambda handler for local development
- Production: Lambda handles both `/api/*` routes and static asset serving from S3

### Frontend (`src/`)
- `main.tsx` wraps the app in Okta's `<Security>` provider; Okta config is fetched dynamically from `/api/okta-config` (not baked in at build time)
- `App.tsx` is the top-level dashboard; renders two tabs using `UseCaseTable` and `IndustryDataTable`
- `hooks/useS3Data.ts` fetches all data via the Lambda API, attaching the Okta JWT as `Authorization: Bearer`
- Tables use TanStack React Table + React Virtual for virtualized rendering of large datasets
- Data keys are snake_case in S3 JSON but mapped to PascalCase TypeScript types defined in `src/types.ts`

### Backend (`lambda/index.mjs`)
Single Lambda handler that routes based on path:
| Route | Auth required | Action |
|---|---|---|
| `GET /api/okta-config` | No | Returns Okta issuer + clientId from Secrets Manager |
| `GET /api/data/use-cases` | JWT | Reads `use_cases.json` from S3 |
| `GET /api/data/industry` | JWT | Reads `industry_use_cases.json` from S3 |
| `POST /api/search` | JWT | Bedrock Titan embedding + vector search + Nova Lite why-matched |
| `POST /api/search/industry` | JWT | Bedrock Titan embedding + vector search + Nova Lite why-matched |
| `GET /*` | No | Serves `dist/index.html` or static assets from S3 |

JWT verification uses Okta JWKS (RS256). The contact button in the UI opens a Gmail compose tab directly in the browser — there is no backend email route.

### Authentication flow
1. Frontend loads → fetches `/api/okta-config` → initializes Okta SDK with PKCE
2. Unauthenticated users are redirected to Okta login
3. All protected API calls include `Authorization: Bearer <access_token>`
4. Lambda verifies the token signature on every request

### Deployment
CI/CD is via `.github/workflows/deploy.yml` (triggers on push to `main`): builds the frontend, syncs `dist/` to S3, then packages and deploys the Lambda. Required GitHub Secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`, `LAMBDA_FUNCTION_NAME`.

### Environment variables
- `VITE_*` variables in `.env.local` are baked into the frontend bundle at build time
- Lambda runtime variables (Okta issuer/audience, S3 bucket name, Bedrock region) are set in the AWS Lambda Console and accessed via `process.env`
- Sensitive values (Okta client ID) are stored in AWS Secrets Manager and fetched at Lambda cold start
