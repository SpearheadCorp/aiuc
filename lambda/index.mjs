import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { google } from "googleapis";
import { buildEmailHtml } from "./emailTemplate.mjs";

const s3 = new S3Client({ region: process.env.S3_REGION });
const secretsManager = new SecretsManagerClient({ region: process.env.S3_REGION });

const BUCKET           = process.env.BUCKET_NAME;
const DIST_PREFIX      = process.env.DIST_PREFIX;
const OKTA_ISSUER      = process.env.OKTA_ISSUER || "";
const OKTA_AUDIENCE    = process.env.OKTA_AUDIENCE || "api://default";
const AIUC_SECRET_NAME = process.env.AIUC_SECRET_NAME || "";
const BASE_PATH        = (process.env.BASE_PATH || "").replace(/\/$/, "");

// Cache JWKS across Lambda invocations to avoid re-fetching on every request
let jwks = null;
function getJwks() {
    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(`${OKTA_ISSUER}/v1/keys`));
    }
    return jwks;
}

async function requireAuth(event) {
    const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
        return json(401, { error: "Unauthorized" });
    }
    const token = authHeader.slice(7);
    try {
        await jwtVerify(token, getJwks(), { issuer: OKTA_ISSUER, audience: OKTA_AUDIENCE, algorithms: ["RS256"] });
        return null; // token is valid
    } catch (err) {
        console.error("Token verification failed:", err.message);
        return json(401, { error: "Unauthorized" });
    }
}

let cachedOktaClientId = null;

async function getOktaClientId() {
    if (cachedOktaClientId) return cachedOktaClientId;
    const command = new GetSecretValueCommand({ SecretId: AIUC_SECRET_NAME });
    const response = await secretsManager.send(command);
    const secret = JSON.parse(response.SecretString);
    cachedOktaClientId = secret.OKTA_CLIENT_ID;
    return cachedOktaClientId;
}
const CONTACT_EMAIL       = process.env.CONTACT_EMAIL       || "aiuc@purestorage.com";
const GMAIL_CLIENT_ID     = process.env.GMAIL_CLIENT_ID     || "";
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || "";
const GMAIL_SENDER        = process.env.GMAIL_SENDER        || "";

// ── Email template branding (all optional — defaults used if not set) ─────────
const EMAIL_HEADER_TITLE = process.env.EMAIL_HEADER_TITLE || "Contact Form";
const EMAIL_BRAND_COLOR  = process.env.EMAIL_BRAND_COLOR  || "#FA4616";
const EMAIL_COMPANY_NAME = process.env.EMAIL_COMPANY_NAME || "AIUC";

const MIME_TYPES = {
    ".html": "text/html",
    ".js":   "application/javascript",
    ".mjs":  "application/javascript",
    ".css":  "text/css",
    ".json": "application/json",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif":  "image/gif",
    ".svg":  "image/svg+xml",
    ".ico":  "image/x-icon",
    ".woff": "font/woff",
    ".woff2":"font/woff2",
    ".ttf":  "font/ttf",
    ".txt":  "text/plain",
    ".map":  "application/json",
};

function getMimeType(key) {
    const ext = key.substring(key.lastIndexOf("."));
    return MIME_TYPES[ext] || "application/octet-stream";
}

async function getS3Object(key, contentType) {
    try {
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const response = await s3.send(command);
        const body = await response.Body.transformToString();

        const isBinary = contentType.startsWith("image/") || contentType.startsWith("font/");
        if (isBinary) {
            const bodyBytes = await (await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))).Body.transformToByteArray();
            return {
                statusCode: 200,
                headers: {
                    "Content-Type": contentType,
                    "Cache-Control": "public, max-age=31536000, immutable",
                },
                isBase64Encoded: true,
                body: Buffer.from(bodyBytes).toString("base64"),
            };
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": contentType === "text/html" ? "no-cache" : "public, max-age=31536000, immutable",
            },
            body,
        };
    } catch (err) {
        if (err.name === "NoSuchKey") {
            if (!key.includes(".")) {
                return getS3Object(`${DIST_PREFIX}/index.html`, "text/html");
            }
            return {
                statusCode: 404,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Not found", key }),
            };
        }
        console.error("S3 error:", err);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Internal server error" }),
        };
    }
}

function json(statusCode, data) {
    return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    };
}

export async function handler(event) {
    const rawPath = event.rawPath || event.path || "/";
    const method  = event.requestContext?.http?.method || event.httpMethod || "GET";
    const path    = BASE_PATH && rawPath.startsWith(BASE_PATH)
                    ? rawPath.slice(BASE_PATH.length) || "/"
                    : rawPath;

    console.log(`[Request] ${method} ${rawPath} → ${path}`);

    // ── Okta config API ────────────────────────────────────────────────────────
    if (path === "/api/okta-config" || path === "/api/okta-config/") {
        try {
            const clientId = await getOktaClientId();
            return json(200, { issuer: OKTA_ISSUER, clientId });
        } catch (err) {
            console.error("Failed to fetch Okta config from Secrets Manager:", err);
            return json(500, { error: "Failed to load authentication configuration" });
        }
    }

    // ── Data API (auth required) ───────────────────────────────────────────────
    if (path === "/api/data/use-cases" || path === "/api/data/use-cases/") {
        const authError = await requireAuth(event);
        if (authError) return authError;
        return getS3Object("use_cases.json", "application/json");
    }
    if (path === "/api/data/industry" || path === "/api/data/industry/") {
        const authError = await requireAuth(event);
        if (authError) return authError;
        return getS3Object("industry_use_cases.json", "application/json");
    }

    // ── POST /api/contact (auth required) ─────────────────────────────────────
    if ((path === "/api/contact" || path === "/api/contact/") && method === "POST") {
        const authError = await requireAuth(event);
        if (authError) return authError;
        try {
            const body = JSON.parse(event.body || "{}");
            const { from, subject, message } = body;

            if (!from || !subject || !message) {
                return json(400, { error: "Missing required fields: from, subject, message" });
            }

            // Validate email format
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
                return json(400, { error: "Invalid email address" });
            }

            // Sanitize header values to prevent email header injection
            const safeSubject = subject.replace(/[\r\n]/g, "");
            const safeFrom    = from.replace(/[\r\n]/g, "");

            if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER) {
                return json(503, { error: "Email service is not configured." });
            }

            const oauth2Client = new google.auth.OAuth2(
                GMAIL_CLIENT_ID,
                GMAIL_CLIENT_SECRET
            );
            oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

            const gmail = google.gmail({ version: "v1", auth: oauth2Client });

            const htmlBody = buildEmailHtml({
                fromEmail:   safeFrom,
                subject:     safeSubject,
                message,
                contactEmail: CONTACT_EMAIL,
                headerTitle:  EMAIL_HEADER_TITLE,
                brandColor:   EMAIL_BRAND_COLOR,
                companyName:  EMAIL_COMPANY_NAME,
            });

            const rawLines = [
                `From: ${GMAIL_SENDER}`,
                `To: ${CONTACT_EMAIL}`,
                `Reply-To: ${safeFrom}`,
                `Subject: ${safeSubject}`,
                `MIME-Version: 1.0`,
                `Content-Type: text/html; charset=UTF-8`,
                ``,
                htmlBody,
            ];

            const raw = Buffer.from(rawLines.join("\r\n"))
                .toString("base64")
                .replace(/\+/g, "-")
                .replace(/\//g, "_")
                .replace(/=+$/, "");

            await gmail.users.messages.send({
                userId: "me",
                requestBody: { raw },
            });

            return json(200, { success: true, message: "Email sent successfully" });
        } catch (err) {
            console.error("Contact email error:", err);
            return json(500, { error: "Failed to send email. Please try again later." });
        }
    }

    // ── Static file serving ────────────────────────────────────────────────────
    let key;
    if (path === "/" || path === "") {
        key = `${DIST_PREFIX}/index.html`;
    } else {
        const cleanPath = path.startsWith("/") ? path.substring(1) : path;
        // Prevent path traversal: reject any path containing ".." segments
        if (cleanPath.split("/").some(seg => seg === ".." || seg === ".")) {
            return json(400, { error: "Invalid path" });
        }
        key = `${DIST_PREFIX}/${cleanPath}`;
    }

    return getS3Object(key, getMimeType(key));
}
