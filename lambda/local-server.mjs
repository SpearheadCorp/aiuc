/**
 * Local development API server — mirrors the Lambda API routes.
 * Run from project root: npm run dev:server
 * Listens on http://localhost:3001
 *
 * Uses shared core/ modules for search logic (same code paths as Lambda).
 * Differences from Lambda:
 *   - Loads embeddings from local public/data/ instead of S3
 *   - Uses AWS credential profile instead of Lambda IAM role
 *   - No auth enforcement (for dev convenience)
 */

import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-provider-ini";

import { getEmbedding, l2normalize } from "./core/embeddings.mjs";
import { createFlatIPIndex, runVectorSearch, runKeywordSearch, USE_CASE_FIELDS, INDUSTRY_FIELDS } from "./core/search.mjs";
import { generateExplanations, FALLBACK_WHY } from "./core/why_matched.mjs";
import { ENABLE_AI_SEARCH } from "./core/ai_toggle.mjs";

// ── Load .env.local from project root ────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env.local");

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Strip surrounding single or double quotes from value
    const raw = trimmed.slice(eqIdx + 1).trim();
    const val = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("✓ Loaded .env.local");
} else {
  console.warn("⚠ .env.local not found — set env vars manually");
}

const BEDROCK_REGION = process.env.AWS_REGION || "us-east-2";

// AWS_PROFILE must be set in .env.local — no hardcoded fallback
const AWS_PROFILE = process.env.AWS_PROFILE;
if (!AWS_PROFILE) {
  console.error("✗ AWS_PROFILE is not set. Add AWS_PROFILE=<your-profile> to .env.local");
  process.exit(1);
}

const OKTA_ISSUER    = process.env.VITE_OKTA_ISSUER    || "";
const OKTA_CLIENT_ID = process.env.VITE_OKTA_CLIENT_ID || "";

// ── Bedrock client (credential profile for local dev) ─────────────────────────
const bedrock = new BedrockRuntimeClient({
  region:      BEDROCK_REGION,
  credentials: fromIni({ profile: AWS_PROFILE }),
});

// ── Local file-based search index (mirrors S3 loading in Lambda) ──────────────
// Builds a FlatIP index from a local embeddings JSON file on first call.
// Cache prevents re-loading on every request.
const localIndexCache = new Map();

function loadLocalIndex(filePath, itemKey, logPrefix) {
  if (localIndexCache.has(filePath)) return localIndexCache.get(filePath);

  if (!existsSync(filePath)) return null;

  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const index = createFlatIPIndex();
  const meta = raw.map(record => {
    index.add(l2normalize(record.embedding));
    return record[itemKey];
  });

  console.log(`${logPrefix} ready: ${index.ntotal()} vectors (local)`);
  const result = { index, meta };
  localIndexCache.set(filePath, result);
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Restrict CORS to Vite dev server only — not open to all origins
const ALLOWED_ORIGIN = process.env.DEV_ORIGIN || "http://localhost:5173";

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => resolve(data));
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost:3001").pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    });
    return res.end();
  }

  console.log(`[${method}] ${path}`);

  // GET /api/okta-config
  if (path === "/api/okta-config" && method === "GET") {
    return sendJson(res, 200, { issuer: OKTA_ISSUER, clientId: OKTA_CLIENT_ID });
  }

  // GET /api/data/use-cases
  if (path === "/api/data/use-cases" && method === "GET") {
    const file = resolve(__dir, "../public/data/use_cases.json");
    return sendJson(res, 200, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
  }

  // GET /api/data/industry
  if (path === "/api/data/industry" && method === "GET") {
    const file = resolve(__dir, "../public/data/industry_use_cases.json");
    return sendJson(res, 200, existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
  }

  // POST /api/search/industry
  if (path === "/api/search/industry" && method === "POST") {
    try {
      const { query, limit = 10 } = JSON.parse(await readBody(req) || "{}");
      if (!query || !query.trim()) return sendJson(res, 400, { error: "Missing required field: query" });

      const queryText = query.trim().slice(0, 1000);
      const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 15);

      const embFile = resolve(__dir, "../public/data/industry_use_cases_embeddings.json");
      const cached = loadLocalIndex(embFile, "item", "[IndustrySearchIndex]");

      if (!cached) {
        return sendJson(res, 503, {
          error: "Industry embeddings file not found. Run: node lambda/generate-embeddings-industry-local.mjs",
        });
      }

      const { index, meta } = cached;
      let results;
      let searchMode;

      if (ENABLE_AI_SEARCH) {
        try {
          const queryVec = await getEmbedding(queryText, bedrock);
          results = runVectorSearch(index, meta, queryVec, safeLimit);
          searchMode = "vector";
        } catch (err) {
          console.warn(`[IndustrySearch] embedding failed → keyword fallback: ${err.message}`);
          results = runKeywordSearch(queryText, meta, INDUSTRY_FIELDS, safeLimit);
          searchMode = "keyword-fallback";
        }
      } else {
        results = runKeywordSearch(queryText, meta, INDUSTRY_FIELDS, safeLimit);
        searchMode = "keyword";
      }

      const items = results.map(r => r.data);
      const explanations = await generateExplanations(
        queryText,
        items,
        item => `"${item.ai_use_case || ""}" — ${item.industry || ""} / ${item.business_function || ""}: ${item.description || ""}`,
        bedrock
      );

      console.log(`[IndustrySearch] mode=${searchMode} "${queryText.slice(0, 60)}…" → ${results.length} results`);
      return sendJson(res, 200, {
        results: results.map((r, i) => ({
          item: r.data,
          score: r.score,
          whyMatched: explanations[i] || FALLBACK_WHY,
        })),
      });
    } catch (err) {
      console.error("✗ Industry search error:", err.message);
      return sendJson(res, 500, { error: "Search failed. Please try again." });
    }
  }

  // POST /api/search
  if (path === "/api/search" && method === "POST") {
    try {
      const { query, limit = 10 } = JSON.parse(await readBody(req) || "{}");
      if (!query || !query.trim()) return sendJson(res, 400, { error: "Missing required field: query" });

      const queryText = query.trim().slice(0, 1000);
      const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 15);

      const embFile = resolve(__dir, "../public/data/use_cases_embeddings.json");
      const cached = loadLocalIndex(embFile, "useCase", "[SearchIndex]");

      if (!cached) {
        return sendJson(res, 503, {
          error: "Embeddings file not found. Run: node lambda/generate-embeddings-local.mjs",
        });
      }

      const { index, meta } = cached;
      let results;
      let searchMode;

      if (ENABLE_AI_SEARCH) {
        try {
          const queryVec = await getEmbedding(queryText, bedrock);
          results = runVectorSearch(index, meta, queryVec, safeLimit);
          searchMode = "vector";
        } catch (err) {
          console.warn(`[Search] embedding failed → keyword fallback: ${err.message}`);
          results = runKeywordSearch(queryText, meta, USE_CASE_FIELDS, safeLimit);
          searchMode = "keyword-fallback";
        }
      } else {
        results = runKeywordSearch(queryText, meta, USE_CASE_FIELDS, safeLimit);
        searchMode = "keyword";
      }

      const useCases = results.map(r => r.data);
      const explanations = await generateExplanations(
        queryText,
        useCases,
        uc => `"${uc.ai_use_case || ""}" — ${uc.business_function || ""} / ${uc.business_capability || ""}: ${uc.action_implementation || ""}`,
        bedrock
      );

      console.log(`[Search] mode=${searchMode} "${queryText.slice(0, 60)}…" → ${results.length} results`);
      return sendJson(res, 200, {
        results: results.map((r, i) => ({
          useCase: r.data,
          score: r.score,
          whyMatched: explanations[i] || FALLBACK_WHY,
        })),
      });
    } catch (err) {
      console.error("✗ Search error:", err.message);
      return sendJson(res, 500, { error: "Search failed. Please try again." });
    }
  }

  sendJson(res, 404, { error: "Not found" });

}).listen(3001, () => {
  console.log("\n✓ Local API server running at http://localhost:3001");
  console.log("  Okta issuer  :", OKTA_ISSUER    || "⚠ NOT SET");
  console.log("  Okta clientId:", OKTA_CLIENT_ID || "⚠ NOT SET");
  console.log("  AI search    :", ENABLE_AI_SEARCH ? "enabled" : "disabled (keyword fallback)");
  console.log("\nReady — waiting for Vite proxy requests...\n");
});
