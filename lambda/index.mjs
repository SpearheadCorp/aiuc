import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import OpenAI from "openai";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { handleUseCaseSearch, handleIndustrySearch } from "./core/api_handlers.mjs";

// ── AWS clients (reused across invocations) ───────────────────────────────────
const REGION = process.env.S3_REGION || "us-east-2";

const s3 = new S3Client({ region: REGION });
const secretsManager = new SecretsManagerClient({ region: REGION });

// ── Environment config ────────────────────────────────────────────────────────
const BUCKET = process.env.BUCKET_NAME;
if (!BUCKET) {
    console.error("[Config] BUCKET_NAME environment variable is not set — S3 calls will fail.");
}
const DIST_PREFIX = process.env.DIST_PREFIX;
const OKTA_ISSUER = process.env.OKTA_ISSUER || "";
const OKTA_AUDIENCE = process.env.OKTA_AUDIENCE || "api://default";
const AIUC_SECRET_NAME = process.env.AIUC_SECRET_NAME || "";
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/$/, "");

// S3 keys for pre-computed embeddings (PureStorage-specific paths).
// Override via Lambda env vars to point at a different bucket location.
const USE_CASES_EMBEDDINGS_KEY = process.env.USE_CASES_EMBEDDINGS_KEY || "pure_use_cases_embeddings.json";
const INDUSTRY_EMBEDDINGS_KEY  = process.env.INDUSTRY_EMBEDDINGS_KEY  || "pure_industry_use_cases_embeddings.json";

// ── Search rate limiting ──────────────────────────────────────────────────────
// Sliding-window rate limit applied to /api/search* to protect OpenAI costs.
// Combined with Lambda reserved concurrency (set in AWS console/CLI) for a
// hard cap on parallel OpenAI invocations.
//
// Tune via Lambda env vars:
//   SEARCH_RATE_LIMIT_MAX        — max requests per window per user (default: 10)
//   SEARCH_RATE_LIMIT_WINDOW_MS  — rolling window in milliseconds (default: 60000 = 1 min)
const RATE_LIMIT_MAX    = Math.max(1, parseInt(process.env.SEARCH_RATE_LIMIT_MAX        || "10",    10));
const RATE_LIMIT_WINDOW = Math.max(1, parseInt(process.env.SEARCH_RATE_LIMIT_WINDOW_MS  || "60000", 10));

// Per-user request timestamp store — lives for the lifetime of this Lambda container.
// Key: userId (JWT sub claim).  Value: array of request timestamps (ms).
const rateLimitStore = new Map();

/**
 * Check whether the given user has exceeded the rate limit.
 * Returns { limited: false } if the request is allowed and records it.
 * Returns { limited: true, retryAfterSeconds: N } when the limit is exceeded.
 *
 * @param {string} userId - Stable user identifier (JWT `sub` claim)
 */
function checkRateLimit(userId) {
    const now         = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    // Keep only timestamps within the current window
    const prev = rateLimitStore.get(userId) ?? [];
    const inWindow = prev.filter(t => t > windowStart);

    if (inWindow.length >= RATE_LIMIT_MAX) {
        // Retry-After = time until the oldest request in the window falls out
        const retryAfterMs = Math.max(0, inWindow[0] + RATE_LIMIT_WINDOW - now);
        console.warn(`[RateLimit] userId=${userId} hit limit (${inWindow.length}/${RATE_LIMIT_MAX} in ${RATE_LIMIT_WINDOW}ms)`);
        return { limited: true, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }

    inWindow.push(now);
    rateLimitStore.set(userId, inWindow);

    // Prune stale entries if the store grows beyond 5 000 users (memory guard)
    if (rateLimitStore.size > 5000) {
        for (const [uid, timestamps] of rateLimitStore) {
            if (timestamps.every(t => t <= windowStart)) rateLimitStore.delete(uid);
        }
    }

    return { limited: false };
}

/**
 * Decode the `sub` claim from an already-verified JWT without re-validating
 * the signature. Safe to call only after requireAuth() has returned null.
 *
 * @param {object} event - Lambda event
 * @returns {string} userId (JWT sub) or "unknown"
 */
function getUserIdFromToken(event) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) return "unknown";
    try {
        const payloadB64 = authHeader.slice(7).split(".")[1];
        const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
        return payload.sub || payload.email || "unknown";
    } catch {
        return "unknown";
    }
}

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

// ── Auth (Okta — PureStorage-specific) ───────────────────────────────────────
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
// Both OKTA_CLIENT_ID and EVERPURE_OPENAI_API_KEY are read from the same
// secret so Everpure only needs to manage a single Secrets Manager entry.
// Expected secret JSON shape:
//   { "OKTA_CLIENT_ID": "...", "EVERPURE_OPENAI_API_KEY": "sk-..." }
let cachedSecrets = null;

async function getSecrets() {
    if (cachedSecrets) return cachedSecrets;
    const command = new GetSecretValueCommand({ SecretId: AIUC_SECRET_NAME });
    const response = await secretsManager.send(command);
    cachedSecrets = JSON.parse(response.SecretString);
    return cachedSecrets;
}

async function getOktaClientId() {
    const secrets = await getSecrets();
    return secrets.OKTA_CLIENT_ID;
}

// OpenAI client — lazy-initialised after the secret is fetched.
// Key lookup order:
//   1. EVERPURE_OPENAI_API_KEY in Secrets Manager (production path)
//   2. OPENAI_API_KEY in Secrets Manager (generic fallback)
//   3. OPENAI_API_KEY env var (local dev only)
let cachedOpenaiClient = null;

async function getOpenAIClient() {
    if (cachedOpenaiClient) return cachedOpenaiClient;
    let apiKey;
    if (AIUC_SECRET_NAME) {
        const secrets = await getSecrets();
        apiKey = secrets.EVERPURE_OPENAI_API_KEY || secrets.OPENAI_API_KEY;
    }
    if (!apiKey) {
        apiKey = process.env.OPENAI_API_KEY;
    }
    if (!apiKey) throw new Error("OpenAI API key not found in Secrets Manager or OPENAI_API_KEY env var");
    cachedOpenaiClient = new OpenAI({ apiKey });
    return cachedOpenaiClient;
}

// ── S3 static file serving ────────────────────────────────────────────────────
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
            return json(404, { error: "Not found" });
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

// ── Lambda handler ────────────────────────────────────────────────────────────
export async function handler(event) {
    const rawPath = event.rawPath || event.path || "/";
    const method = event.requestContext?.http?.method || event.httpMethod || "GET";
    const path = BASE_PATH && rawPath.startsWith(BASE_PATH)
        ? rawPath.slice(BASE_PATH.length) || "/"
        : rawPath;

    console.log(`[Request] ${method} ${rawPath} → ${path}`);

    // ── GET /health ───────────────────────────────────────────────────────────
    // Unauthenticated — used by load balancers / uptime monitors.
    if (path === "/health" || path === "/health/") {
        return json(200, { status: "ok" });
    }

    // ── GET /api/okta-config ──────────────────────────────────────────────────
    // Intentionally unauthenticated: the frontend needs the Okta issuer and
    // clientId to bootstrap the OktaAuth SDK before the user has signed in.
    if (path === "/api/okta-config" || path === "/api/okta-config/") {
        try {
            const clientId = await getOktaClientId();
            return json(200, { issuer: OKTA_ISSUER, clientId });
        } catch (err) {
            console.error("[OktaConfig] error:", err);
            return json(500, { error: "Failed to load authentication configuration" });
        }
    }

    // ── GET /api/data/use-cases (auth required) ───────────────────────────────
    if (path === "/api/data/use-cases" || path === "/api/data/use-cases/") {
        const authError = await requireAuth(event);
        if (authError) return authError;
        return getS3Object("use_cases.json", "application/json", "no-cache, no-store, must-revalidate");
    }

    // ── GET /api/data/industry (auth required) ────────────────────────────────
    if (path === "/api/data/industry" || path === "/api/data/industry/") {
        const authError = await requireAuth(event);
        if (authError) return authError;
        return getS3Object("industry_use_cases.json", "application/json", "no-cache, no-store, must-revalidate");
    }

    // ── POST /api/search (auth + rate limit required) ────────────────────────
    if ((path === "/api/search" || path === "/api/search/") && method === "POST") {
        const authError = await requireAuth(event);
        if (authError) return authError;

        const userId   = getUserIdFromToken(event);
        const { limited, retryAfterSeconds } = checkRateLimit(userId);
        if (limited) {
            return {
                statusCode: 429,
                headers: {
                    "Content-Type": "application/json",
                    "Retry-After": String(retryAfterSeconds),
                    "X-RateLimit-Limit":  String(RATE_LIMIT_MAX),
                    "X-RateLimit-Window": String(RATE_LIMIT_WINDOW),
                },
                body: JSON.stringify({
                    error: `Too many search requests. Please wait ${retryAfterSeconds}s before trying again.`,
                }),
            };
        }

        try {
            const body = JSON.parse(event.body || "{}");
            const { query, limit = 10 } = body;

            if (!query || typeof query !== "string" || !query.trim()) {
                return json(400, { error: "Missing required field: query" });
            }

            const result = await handleUseCaseSearch({
                query,
                limit,
                s3Client: s3,
                bucket: BUCKET,
                embeddingsKey: USE_CASES_EMBEDDINGS_KEY,
                openaiClient: await getOpenAIClient(),
            });
            return json(200, result);
        } catch (err) {
            console.error("[Search] error:", err);
            return json(500, { error: "Search failed. Please try again." });
        }
    }

    // ── POST /api/search/industry (auth + rate limit required) ───────────────
    if ((path === "/api/search/industry" || path === "/api/search/industry/") && method === "POST") {
        const authError = await requireAuth(event);
        if (authError) return authError;

        const userId   = getUserIdFromToken(event);
        const { limited, retryAfterSeconds } = checkRateLimit(userId);
        if (limited) {
            return {
                statusCode: 429,
                headers: {
                    "Content-Type": "application/json",
                    "Retry-After": String(retryAfterSeconds),
                    "X-RateLimit-Limit":  String(RATE_LIMIT_MAX),
                    "X-RateLimit-Window": String(RATE_LIMIT_WINDOW),
                },
                body: JSON.stringify({
                    error: `Too many search requests. Please wait ${retryAfterSeconds}s before trying again.`,
                }),
            };
        }

        try {
            const body = JSON.parse(event.body || "{}");
            const { query, limit = 10 } = body;

            if (!query || typeof query !== "string" || !query.trim()) {
                return json(400, { error: "Missing required field: query" });
            }

            const result = await handleIndustrySearch({
                query,
                limit,
                s3Client: s3,
                bucket: BUCKET,
                industryEmbeddingsKey: INDUSTRY_EMBEDDINGS_KEY,
                openaiClient: await getOpenAIClient(),
            });
            return json(200, result);
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
