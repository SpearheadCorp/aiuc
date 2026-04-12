/**
 * Local development API server — mirrors the Lambda API routes.
 * Run from project root: npm run dev:server
 * Listens on http://localhost:3001
 */

import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-provider-ini";

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
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("✓ Loaded .env.local");
} else {
  console.warn("⚠ .env.local not found — set env vars manually");
}

const BEDROCK_REGION  = process.env.AWS_REGION  || "us-east-2";
const AWS_PROFILE     = process.env.AWS_PROFILE || "Praveen";

// ── Bedrock Titan embedding client (1024-dim, matches generated embeddings) ───
const bedrock = new BedrockRuntimeClient({
  region:      BEDROCK_REGION,
  credentials: fromIni({ profile: AWS_PROFILE }),
});

const OKTA_ISSUER    = process.env.VITE_OKTA_ISSUER    || "";
const OKTA_CLIENT_ID = process.env.VITE_OKTA_CLIENT_ID || "";

// ── Bedrock Titan embedding (1024-dim, same model as Lambda + generate scripts) ─
async function embedText(text) {
  const command = new InvokeModelCommand({
    modelId:     "amazon.titan-embed-text-v2:0",
    contentType: "application/json",
    accept:      "application/json",
    body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
  });
  const response = await bedrock.send(command);
  const result   = JSON.parse(Buffer.from(response.body).toString("utf-8"));
  if (!Array.isArray(result.embedding)) throw new Error("Bedrock Titan: unexpected response shape");
  console.log(`[Embedder] dim=${result.embedding.length}`);
  return result.embedding;
}

// ── AI Search helpers ─────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ── Bedrock "why matched" explanation ─────────────────────────────────────────
// Uses amazon.nova-lite-v1:0 — mirrors lambda/index.mjs exactly.
const WHY_MATCHED_MODEL = "amazon.nova-lite-v1:0";
const FALLBACK_WHY      = "Matched based on semantic similarity to your query.";

async function generateExplanations(query, items, formatItem) {
  if (items.length === 0) return [];

  const safeQuery = query.replace(/"/g, '\\"');
  const list = items.map((item, i) => `${i + 1}. ${formatItem(item)}`).join("\n");

  const prompt = `You are an AI analyst helping employees find relevant AI use cases for their company's internal tool.

User's search query: "${safeQuery}"

The following use cases were retrieved as semantic matches. For each one (numbered 1 to ${items.length}), write exactly 1–2 concise sentences explaining specifically why it matches the user's query. Be concrete about the connection.

${list}

Respond ONLY with a JSON array of strings, one per use case in the same order:
["explanation for 1", "explanation for 2", ...]`;

  try {
    const command = new InvokeModelCommand({
      modelId:     WHY_MATCHED_MODEL,
      contentType: "application/json",
      accept:      "application/json",
      body: JSON.stringify({
        messages:        [{ role: "user", content: [{ text: prompt }] }],
        inferenceConfig: { temperature: 0.2, maxTokens: 1024 },
      }),
    });
    const response = await bedrock.send(command);
    const result   = JSON.parse(Buffer.from(response.body).toString("utf-8"));
    const text     = result.output?.message?.content?.[0]?.text || "[]";
    const match    = text.match(/\[[\s\S]*\]/);
    if (!match) return items.map(() => FALLBACK_WHY);
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : items.map(() => FALLBACK_WHY);
  } catch (err) {
    console.error("[WhyMatched] Bedrock error:", err.message);
    return items.map(() => FALLBACK_WHY);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
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

// ── Server ───────────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost:3001").pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
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

  // // POST /api/contact
  // if (path === "/api/contact" && method === "POST") {
  //   try {
  //     const { from, subject, message } = JSON.parse(await readBody(req) || "{}");

  //     if (!from || !subject || !message)
  //       return sendJson(res, 400, { error: "Missing required fields: from, subject, message" });

  //     if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from))
  //       return sendJson(res, 400, { error: "Invalid email address" });

  //     if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN)
  //       return sendJson(res, 503, { error: "Gmail not configured in .env.local" });

  //     const safeSubject = subject.replace(/[\r\n]/g, "");
  //     const safeFrom    = from.replace(/[\r\n]/g, "");

  //     const oauth2Client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  //     oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  //     const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  //     const htmlBody = buildEmailHtml({
  //       fromEmail:   safeFrom,
  //       subject:     safeSubject,
  //       message,
  //       contactEmail: CONTACT_EMAIL,
  //       headerTitle:  EMAIL_HEADER_TITLE,
  //       brandColor:   EMAIL_BRAND_COLOR,
  //       companyName:  EMAIL_COMPANY_NAME,
  //     });

  //     const rawMsg = Buffer.from([
  //       `From: ${GMAIL_SENDER}`,
  //       `To: ${CONTACT_EMAIL}`,
  //       `Reply-To: ${safeFrom}`,
  //       `Subject: ${safeSubject}`,
  //       `MIME-Version: 1.0`,
  //       `Content-Type: text/html; charset=UTF-8`,
  //       ``,
  //       htmlBody,
  //     ].join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  //     const result = await gmail.users.messages.send({ userId: "me", requestBody: { raw: rawMsg } });
  //     console.log(`✓ Email sent — Gmail ID: ${result.data.id}`);
  //     return sendJson(res, 200, { success: true, message: "Email sent successfully" });

  //   } catch (err) {
  //     console.error("✗ Email error:", err.message);
  //     return sendJson(res, 500, { error: "Failed to send email. Please try again later." });
  //   }
  // }

  // POST /api/search/industry
  if (path === "/api/search/industry" && method === "POST") {
    try {
      const { query, limit = 10 } = JSON.parse(await readBody(req) || "{}");
      if (!query || !query.trim()) return sendJson(res, 400, { error: "Missing required field: query" });

      const queryText = query.trim().slice(0, 1000);
      const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 15);

      const embFile = resolve(__dir, "../public/data/industry_use_cases_embeddings.json");
      if (!existsSync(embFile)) {
        return sendJson(res, 503, {
          error: "Industry embeddings file not found. Run: node lambda/generate-embeddings-industry-local.mjs",
        });
      }
      const embeddings = JSON.parse(readFileSync(embFile, "utf8"));

      const queryEmbedding = await embedText(queryText);

      const scored = embeddings.map(e => ({
        item: e.item,
        score: cosineSimilarity(queryEmbedding, e.embedding),
      }));
      scored.sort((a, b) => b.score - a.score);
      const topResults = scored.slice(0, safeLimit);

      const explanations = await generateExplanations(queryText, topResults.map(r => r.item), item =>
        `"${item.ai_use_case || ""}" — ${item.industry || ""} / ${item.business_function || ""}: ${item.description || ""}`
      );

      console.log(`[IndustrySearch] "${queryText.slice(0, 60)}…" → ${topResults.length} results`);
      return sendJson(res, 200, {
        results: topResults.map((r, i) => ({
          item: r.item,
          score: r.score,
          whyMatched: explanations[i] || "Matched based on semantic similarity to your query.",
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
      if (!existsSync(embFile)) {
        return sendJson(res, 503, {
          error: "Embeddings file not found. Run: node lambda/generate-embeddings-local.mjs",
        });
      }
      const embeddings = JSON.parse(readFileSync(embFile, "utf8"));

      const queryEmbedding = await embedText(queryText);

      const scored = embeddings.map(e => ({
        useCase: e.useCase,
        score: cosineSimilarity(queryEmbedding, e.embedding),
      }));
      scored.sort((a, b) => b.score - a.score);
      const topResults = scored.slice(0, safeLimit);

      const explanations = await generateExplanations(queryText, topResults.map(r => r.useCase), uc =>
        `"${uc.ai_use_case || ""}" — ${uc.business_function || ""} / ${uc.business_capability || ""}: ${uc.action_implementation || ""}`
      );

      console.log(`[Search] "${queryText.slice(0, 60)}…" → ${topResults.length} results`);
      return sendJson(res, 200, {
        results: topResults.map((r, i) => ({
          useCase: r.useCase,
          score: r.score,
          whyMatched: explanations[i] || "Matched based on semantic similarity to your query.",
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
  console.log("  Bedrock model:", WHY_MATCHED_MODEL, "(why-matched explanations)");
  console.log("\nReady — waiting for Vite proxy requests...\n");
});
