import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { handleUseCaseSearch, handleIndustrySearch } from "./core/api_handlers.mjs";

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

// S3 keys for pre-computed embeddings (PureStorage-specific paths).
// Override via Lambda env vars to point at a different bucket location.
const USE_CASES_EMBEDDINGS_KEY = process.env.USE_CASES_EMBEDDINGS_KEY || "use_cases_embeddings.json";
const INDUSTRY_EMBEDDINGS_KEY = process.env.INDUSTRY_EMBEDDINGS_KEY || "industry_use_cases_embeddings.json";

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

// ── Secrets Manager (Okta client ID — PureStorage-specific) ──────────────────
let cachedOktaClientId = null;

async function getOktaClientId() {
    if (cachedOktaClientId) return cachedOktaClientId;
    const command = new GetSecretValueCommand({ SecretId: AIUC_SECRET_NAME });
    const response = await secretsManager.send(command);
    const secret = JSON.parse(response.SecretString);
    cachedOktaClientId = secret.OKTA_CLIENT_ID;
    return cachedOktaClientId;
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

            const result = await handleUseCaseSearch({
                query,
                limit,
                s3Client: s3,
                bucket: BUCKET,
                embeddingsKey: USE_CASES_EMBEDDINGS_KEY,
                bedrockClient: bedrockRuntime,
            });
            return json(200, result);
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

            const result = await handleIndustrySearch({
                query,
                limit,
                s3Client: s3,
                bucket: BUCKET,
                industryEmbeddingsKey: INDUSTRY_EMBEDDINGS_KEY,
                bedrockClient: bedrockRuntime,
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
