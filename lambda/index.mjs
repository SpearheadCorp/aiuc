import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { createRemoteJWKSet, jwtVerify } from "jose";

// ── Pure-JS cosine similarity index ──────────────────────────────────────────
// Vectors must be L2-normalised before adding; inner product then equals cosine.
function createFlatIPIndex() {
    const vectors = [];
    return {
        add(vec) { vectors.push(Float32Array.from(vec)); },
        ntotal() { return vectors.length; },
        search(queryVec, k) {
            const q = Float32Array.from(queryVec);
            const scores = vectors.map((v, idx) => {
                let dot = 0;
                for (let j = 0; j < v.length; j++) dot += v[j] * q[j];
                return { idx, score: dot };
            });
            scores.sort((a, b) => b.score - a.score);
            const top = scores.slice(0, k);
            return {
                labels: top.map(r => r.idx),
                distances: top.map(r => r.score),
            };
        },
    };
}

// ── AWS clients (reused across invocations) ───────────────────────────────────
const REGION = process.env.S3_REGION || "us-east-2";

const s3 = new S3Client({ region: REGION });
const secretsManager = new SecretsManagerClient({ region: REGION });
const bedrockRuntime = new BedrockRuntimeClient({ region: REGION });

// ── Environment config ────────────────────────────────────────────────────────
const BUCKET = process.env.BUCKET_NAME;
const DIST_PREFIX = process.env.DIST_PREFIX;
const OKTA_ISSUER = process.env.OKTA_ISSUER || "";
const OKTA_AUDIENCE = process.env.OKTA_AUDIENCE || "api://default";
const AIUC_SECRET_NAME = process.env.AIUC_SECRET_NAME || "";
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/$/, "");
// Feature flag: set ENABLE_AI_SEARCH=false to force keyword-only search
const ENABLE_AI_SEARCH = process.env.ENABLE_AI_SEARCH !== "false";

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME_TYPES = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".map": "application/json",
};

function getMimeType(key) {
    const ext = key.substring(key.lastIndexOf("."));
    return MIME_TYPES[ext] || "application/octet-stream";
}

// ── Auth ──────────────────────────────────────────────────────────────────────
let jwks = null;
function getJwks() {
    if (!jwks) jwks = createRemoteJWKSet(new URL(`${OKTA_ISSUER}/v1/keys`));
    return jwks;
}

async function requireAuth(event) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });
    const token = authHeader.slice(7);
    try {
        await jwtVerify(token, getJwks(), { issuer: OKTA_ISSUER, audience: OKTA_AUDIENCE, algorithms: ["RS256"] });
        return null;
    } catch (err) {
        console.error("[Auth] token verification failed:", err.message);
        return json(401, { error: "Unauthorized" });
    }
}

// ── Secrets Manager ───────────────────────────────────────────────────────────
let cachedOktaClientId = null;

async function getOktaClientId() {
    if (cachedOktaClientId) return cachedOktaClientId;
    const command = new GetSecretValueCommand({ SecretId: AIUC_SECRET_NAME });
    const response = await secretsManager.send(command);
    const secret = JSON.parse(response.SecretString);
    cachedOktaClientId = secret.OKTA_CLIENT_ID;
    return cachedOktaClientId;
}

// ── S3 file serving ───────────────────────────────────────────────────────────
async function getS3Object(key, contentType, cacheControl) {
    try {
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const response = await s3.send(command);

        const isBinary = contentType.startsWith("image/") || contentType.startsWith("font/");
        if (isBinary) {
            const bodyBytes = await response.Body.transformToByteArray();
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": contentType,
                    "Cache-Control": cacheControl || "public, max-age=31536000, immutable",
                },
                isBase64Encoded: true,
                body: Buffer.from(bodyBytes).toString("base64"),
            };
        }

        const body = await response.Body.transformToString();
        const defaultCache = contentType === "text/html"
            ? "no-cache"
            : "public, max-age=31536000, immutable";
        return {
            statusCode: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": cacheControl || defaultCache,
            },
            body,
        };
    } catch (err) {
        if (err.name === "NoSuchKey") {
            if (!key.includes(".")) return getS3Object(`${DIST_PREFIX}/index.html`, "text/html");
            return json(404, { error: "Not found", key });
        }
        console.error("[S3] error:", err);
        return json(500, { error: "Internal server error" });
    }
}

function json(statusCode, data) {
    return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    };
}

// ── Embedding: Amazon Bedrock Titan Text Embeddings v2 (1024-dim) ─────────────
// No model to bundle — one Bedrock API call per search query.
// Pre-computed embeddings in S3 must also be 1024-dim (use generate-embeddings-local.mjs).
async function getEmbedding(text) {
    const command = new InvokeModelCommand({
        modelId: "amazon.titan-embed-text-v2:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text, dimensions: 1024, normalize: true }),
    });
    const response = await bedrockRuntime.send(command);
    const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));

    if (!Array.isArray(result.embedding)) {
        throw new Error("Bedrock Titan returned unexpected response shape");
    }
    console.log(`[Embedding] success dim=${result.embedding.length}`);
    return result.embedding; // 1024-dim float array, already normalised by Bedrock
}

// ── Vector math ───────────────────────────────────────────────────────────────
function l2normalize(vec) {
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag === 0 ? vec : vec.map(v => v / mag);
}

// ── Search index cache ────────────────────────────────────────────────────────
let cachedSearchIndex = null;
let cachedIndustrySearchIndex = null;

async function getSearchIndex() {
    if (cachedSearchIndex) return cachedSearchIndex;

    const command = new GetObjectCommand({ Bucket: BUCKET, Key: "use_cases_embeddings.json" });
    const response = await s3.send(command);
    const raw = JSON.parse(await response.Body.transformToString()); // [{ useCase, embedding }]

    const dim = raw[0].embedding.length;
    const index = createFlatIPIndex();
    const meta = raw.map(({ useCase, embedding }) => {
        index.add(l2normalize(embedding));
        return useCase;
    });

    console.log(`[SearchIndex] ready: ${index.ntotal()} vectors dim=${dim}`);
    cachedSearchIndex = { index, meta };
    return cachedSearchIndex;
}

async function getIndustrySearchIndex() {
    if (cachedIndustrySearchIndex) return cachedIndustrySearchIndex;

    const command = new GetObjectCommand({ Bucket: BUCKET, Key: "industry_use_cases_embeddings.json" });
    const response = await s3.send(command);
    const raw = JSON.parse(await response.Body.transformToString()); // [{ item, embedding }]

    const dim = raw[0].embedding.length;
    const index = createFlatIPIndex();
    const meta = raw.map(({ item, embedding }) => {
        index.add(l2normalize(embedding));
        return item;
    });

    console.log(`[IndustrySearchIndex] ready: ${index.ntotal()} vectors dim=${dim}`);
    cachedIndustrySearchIndex = { index, meta };
    return cachedIndustrySearchIndex;
}

// ── Vector search ─────────────────────────────────────────────────────────────
// Returns [{ data, score }] sorted by descending cosine similarity.
function runVectorSearch(index, meta, queryVec, topK) {
    const { labels, distances } = index.search(l2normalize(queryVec), topK);
    return labels
        .map((idx, i) => ({ data: meta[idx], score: distances[i] }))
        .filter(r => r.data != null); // idx = -1 when index has fewer vectors than topK
}

// ── Keyword search ────────────────────────────────────────────────────────────
// Simple multi-term match across relevant text fields — used as fallback.
const USE_CASE_FIELDS = ["ai_use_case", "business_function", "business_capability", "action_implementation", "expected_outcomes_and_results", "stakeholder_or_user", "ai_tools_models"];
const INDUSTRY_FIELDS = ["ai_use_case", "industry", "business_function", "business_capability", "description", "implementation_plan", "ai_tools_platforms"];

function runKeywordSearch(query, items, fields, topK) {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (terms.length === 0) return [];

    return items
        .map(item => {
            const haystack = fields.map(f => String(item[f] || "")).join(" ").toLowerCase();
            const score = terms.reduce((s, t) => s + (haystack.includes(t) ? 1 : 0), 0);
            return { data: item, score };
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

// ── Bedrock "why matched" explanation ─────────────────────────────────────────
// Uses amazon.nova-lite-v1:0 — fast, cost-effective text generation on Bedrock.
// Keeps all AI inference within AWS (no external API dependencies).
// const WHY_MATCHED_MODEL = "amazon.nova-lite-v1:0";
const WHY_MATCHED_MODEL = "us.amazon.nova-lite-v1:0";
const FALLBACK_WHY = "Matched based on semantic similarity to your query.";

/**
 * Generate 1–2 sentence explanations for why each search result matched the query.
 * @param {string}   query      - The user's search query
 * @param {object[]} items      - Array of data objects returned by the search
 * @param {function} formatItem - Maps one item to a descriptive string for the prompt
 * @returns {Promise<string[]>} - One explanation string per item (same order)
 */
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
            modelId: WHY_MATCHED_MODEL,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({
                messages: [{ role: "user", content: [{ text: prompt }] }],
                inferenceConfig: { temperature: 0.2, maxTokens: 1024 },
            }),
        });
        const response = await bedrockRuntime.send(command);
        const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
        const text = result.output?.message?.content?.[0]?.text || "[]";
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return items.map(() => FALLBACK_WHY);
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed : items.map(() => FALLBACK_WHY);
    } catch (err) {
        console.error("[WhyMatched] Bedrock error:", err.message);
        return items.map(() => FALLBACK_WHY);
    }
}

// ── Lambda handler ────────────────────────────────────────────────────────────
export async function handler(event) {
    const rawPath = event.rawPath || event.path || "/";
    const method = event.requestContext?.http?.method || event.httpMethod || "GET";
    const path = BASE_PATH && rawPath.startsWith(BASE_PATH)
        ? rawPath.slice(BASE_PATH.length) || "/"
        : rawPath;

    console.log(`[Request] ${method} ${rawPath} → ${path}`);

    // ── GET /api/okta-config ──────────────────────────────────────────────────
    if (path === "/api/okta-config" || path === "/api/okta-config/") {
        try {
            const clientId = await getOktaClientId();
            return json(200, { issuer: OKTA_ISSUER, clientId });
        } catch (err) {
            console.error("[OktaConfig] error:", err);
            return json(500, { error: "Failed to load authentication configuration" });
        }
    }

    // ── GET /api/data/* (auth required) ──────────────────────────────────────
    if (path === "/api/data/use-cases" || path === "/api/data/use-cases/") {
        const authError = await requireAuth(event);
        if (authError) return authError;
        return getS3Object("use_cases.json", "application/json", "no-cache, no-store, must-revalidate");
    }
    if (path === "/api/data/industry" || path === "/api/data/industry/") {
        const authError = await requireAuth(event);
        if (authError) return authError;
        return getS3Object("industry_use_cases.json", "application/json", "no-cache, no-store, must-revalidate");
    }

    // ── POST /api/search (auth required) ─────────────────────────────────────
    if ((path === "/api/search" || path === "/api/search/") && method === "POST") {
        const authError = await requireAuth(event);
        if (authError) return authError;

        try {
            const body = JSON.parse(event.body || "{}");
            const { query, limit = 10 } = body;

            if (!query || typeof query !== "string" || !query.trim()) {
                return json(400, { error: "Missing required field: query" });
            }

            const queryText = query.trim().slice(0, 1000);
            const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 15);

            // Load FAISS index (cached after first cold-start call)
            const { index, meta } = await getSearchIndex();

            let results;
            let searchMode;

            if (ENABLE_AI_SEARCH) {
                try {
                    // Run embedding + search in parallel is not possible (embedding feeds search),
                    // but the index fetch and embedding call can overlap on cold start.
                    const queryVec = await getEmbedding(queryText);
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
            const explanations = await generateExplanations(queryText, useCases, uc =>
                `"${uc.ai_use_case || ""}" — ${uc.business_function || ""} / ${uc.business_capability || ""}: ${uc.action_implementation || ""}`
            );

            console.log(`[Search] mode=${searchMode} results=${results.length} query="${queryText.slice(0, 60)}"`);
            return json(200, {
                results: results.map((r, i) => ({
                    useCase: r.data,
                    score: r.score,
                    whyMatched: explanations[i] || "Matched based on semantic similarity to your query.",
                })),
            });
        } catch (err) {
            console.error("[Search] error:", err);
            return json(500, { error: "Search failed. Please try again." });
        }
    }

    // ── POST /api/search/industry (auth required) ─────────────────────────────
    if ((path === "/api/search/industry" || path === "/api/search/industry/") && method === "POST") {
        const authError = await requireAuth(event);
        if (authError) return authError;

        try {
            const body = JSON.parse(event.body || "{}");
            const { query, limit = 10 } = body;

            if (!query || typeof query !== "string" || !query.trim()) {
                return json(400, { error: "Missing required field: query" });
            }

            const queryText = query.trim().slice(0, 1000);
            const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 15);

            const { index, meta } = await getIndustrySearchIndex();

            let results;
            let searchMode;

            if (ENABLE_AI_SEARCH) {
                try {
                    const queryVec = await getEmbedding(queryText);
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
            const explanations = await generateExplanations(queryText, items, item =>
                `"${item.ai_use_case || ""}" — ${item.industry || ""} / ${item.business_function || ""}: ${item.description || ""}`
            );

            console.log(`[IndustrySearch] mode=${searchMode} results=${results.length} query="${queryText.slice(0, 60)}"`);
            return json(200, {
                results: results.map((r, i) => ({
                    item: r.data,
                    score: r.score,
                    whyMatched: explanations[i] || "Matched based on semantic similarity to your query.",
                })),
            });
        } catch (err) {
            console.error("[IndustrySearch] error:", err);
            return json(500, { error: "Search failed. Please try again." });
        }
    }

    // ── Static file serving ───────────────────────────────────────────────────
    let key;
    if (path === "/" || path === "") {
        key = `${DIST_PREFIX}/index.html`;
    } else {
        const cleanPath = path.startsWith("/") ? path.substring(1) : path;
        if (cleanPath.split("/").some(seg => seg === ".." || seg === ".")) {
            return json(400, { error: "Invalid path" });
        }
        key = `${DIST_PREFIX}/${cleanPath}`;
    }

    return getS3Object(key, getMimeType(key));
}
