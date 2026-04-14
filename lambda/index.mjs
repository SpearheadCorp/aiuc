import { createHmac, createHash, timingSafeEqual } from "crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { handleUseCaseSearch, handleIndustrySearch } from "./core/api_handlers.mjs";

const REGION = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
const s3 = new S3Client({ region: REGION });
const secretsManager = new SecretsManagerClient({ region: REGION });
const sts = new STSClient({ region: "us-west-2" });
const bedrockRuntime = new BedrockRuntimeClient({ region: REGION });

// S3 keys for pre-computed embeddings (override via Lambda env vars)
const USE_CASES_EMBEDDINGS_KEY = process.env.USE_CASES_EMBEDDINGS_KEY || "use_cases_embeddings.json";
const INDUSTRY_EMBEDDINGS_KEY = process.env.INDUSTRY_EMBEDDINGS_KEY || "industry_use_cases_embeddings.json";
const SES_CROSS_ACCOUNT_ROLE = process.env.SES_CROSS_ACCOUNT_ROLE_ARN;
const BUCKET = process.env.BUCKET_NAME;
const DIST_PREFIX = process.env.DIST_PREFIX;
const LOG_PREFIX = process.env.LOG_PREFIX || "logs";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "aiuc@spearhead.com";
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL || CONTACT_EMAIL;
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const APPROVAL_SECRET = process.env.APPROVAL_SECRET;

if (!APPROVAL_SECRET) throw new Error("APPROVAL_SECRET env var is required");

// Personal email domains that are blocked from registration
const BLOCKED_DOMAINS = new Set([
    "gmail.com", "googlemail.com",
    "yahoo.com", "yahoo.co.uk", "yahoo.co.in", "ymail.com",
    "hotmail.com", "hotmail.co.uk",
    "outlook.com", "outlook.co.uk",
    "icloud.com", "me.com", "mac.com",
    "protonmail.com", "proton.me",
    "aol.com",
    "live.com", "live.co.uk",
    "msn.com",
]);

const SES_FROM = process.env.SES_FROM_EMAIL;

// ── Cognito JWT verifier (E4: server-side data filtering) ─────────────────────
const cognitoVerifier = process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID
    ? CognitoJwtVerifier.create({
        userPoolId: process.env.COGNITO_USER_POOL_ID,
        tokenUse: "id",
        clientId: process.env.COGNITO_CLIENT_ID,
    })
    : null;

async function isRequestAuthenticated(event) {
    if (!cognitoVerifier) return false;
    const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) return false;
    try {
        await cognitoVerifier.verify(authHeader.slice(7));
        return true;
    } catch {
        return false;
    }
}

// Display name → JSON key mapping for server-side column stripping
const USE_CASE_COLUMN_KEYS = {
    "AI Algorithms & Frameworks": "ai_algorithms_frameworks",
    "Datasets": "datasets",
    "Action / Implementation": "action_implementation",
    "AI Tools & Models": "ai_tools_models",
    "Digital Platforms and Tools": "digital_platforms_and_tools",
    "Expected Outcomes and Results": "expected_outcomes_and_results",
};
const INDUSTRY_COLUMN_KEYS = {
    "Implementation Plan": "implementation_plan",
    "Datasets": "datasets",
    "AI Tools / Platforms": "ai_tools_platforms",
    "Digital Tools / Platforms": "digital_tools_platforms",
    "AI Frameworks": "ai_frameworks",
    "AI Tools and Models": "ai_tools_and_models",
    "Industry References": "industry_references",
};

function stripRestrictedColumns(rows, restrictedNames, columnKeyMap) {
    const keysToBlank = restrictedNames.map((n) => columnKeyMap[n]).filter(Boolean);
    if (keysToBlank.length === 0) return rows;
    return rows.map((row) => {
        const out = { ...row };
        keysToBlank.forEach((k) => { out[k] = ""; });
        return out;
    });
}

async function getSESClient() {
    const assumed = await sts.send(new AssumeRoleCommand({
        RoleArn: SES_CROSS_ACCOUNT_ROLE,
        RoleSessionName: "aiuc-ses-send",
    }));
    return new SESClient({
        region: "us-west-2",
        credentials: {
            accessKeyId: assumed.Credentials.AccessKeyId,
            secretAccessKey: assumed.Credentials.SecretAccessKey,
            sessionToken: assumed.Credentials.SessionToken,
        },
    });
}

async function sendEmail({ to, subject, text, replyTo }) {
    const ses = await getSESClient();
    const params = {
        Source: SES_FROM,
        Destination: { ToAddresses: [to] },
        Message: {
            Subject: { Data: subject },
            Body: { Text: { Data: text } },
        },
        ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    };
    await ses.send(new SendEmailCommand(params));
}

/**
 * MIME type mapping for static assets
 */
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

/**
 * Fetch an object from S3 and return it as a Lambda response
 */
async function getS3Object(key, contentType) {
    try {
        const isBinary = contentType.startsWith("image/") || contentType.startsWith("font/");
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const response = await s3.send(command);

        if (isBinary) {
            const bodyBytes = await response.Body.transformToByteArray();
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

        const body = await response.Body.transformToString();
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
            // For SPA routing: if file not found, serve index.html
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

/**
 * Generate a signed approval token valid for 7 days.
 * Payload: { email, domain, name, exp }
 */
function generateApprovalToken(email, domain, name) {
    const payload = Buffer.from(JSON.stringify({
        email, domain, name,
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })).toString("base64url");
    const sig = createHmac("sha256", APPROVAL_SECRET).update(payload).digest("hex");
    return `${payload}.${sig}`;
}

/**
 * Verify a signed approval token. Returns the payload or null if invalid/expired.
 */
function verifyApprovalToken(token) {
    if (!token || !token.includes(".")) return null;
    const dotIdx = token.lastIndexOf(".");
    const payload = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    const expected = createHmac("sha256", APPROVAL_SECRET).update(payload).digest("hex");
    try {
        if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
    } catch {
        return null; // invalid hex (wrong length, bad chars)
    }
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString());
        if (Date.now() > data.exp) return null; // expired
        return data;
    } catch {
        return null;
    }
}

/**
 * Lambda handler — serves the Vite frontend and data API
 */
export async function handler(event) {
    // Support both Function URL (rawPath) and ALB (path)
    const path = event.rawPath || event.path || "/";
    const method = event.requestContext?.http?.method || event.httpMethod || "GET";

    console.log(`[Request] ${method} ${path}`);

    // --- Columns config route (lets admin control which columns are greyed out via env vars) ---
    if (path === "/api/columns-config" || path === "/api/columns-config/") {
        const useCaseRestricted = process.env.USE_CASE_RESTRICTED_COLUMNS
            ? process.env.USE_CASE_RESTRICTED_COLUMNS.split(",").map((s) => s.trim()).filter(Boolean)
            : ["AI Algorithms & Frameworks", "Datasets", "Action / Implementation", "AI Tools & Models", "Digital Platforms and Tools"];
        const industryRestricted = process.env.INDUSTRY_RESTRICTED_COLUMNS
            ? process.env.INDUSTRY_RESTRICTED_COLUMNS.split(",").map((s) => s.trim()).filter(Boolean)
            : ["Implementation Plan", "Datasets", "AI Tools / Platforms", "Digital Tools / Platforms", "AI Frameworks", "AI Tools and Models", "Industry References"];
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ useCaseRestricted, industryRestricted }),
        };
    }

    // --- Data API routes (with server-side column filtering for unauthenticated users) ---
    if (path === "/api/data/use-cases" || path === "/api/data/use-cases/") {
        try {
            const authenticated = await isRequestAuthenticated(event);
            const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: "use_cases.json" });
            const res = await s3.send(cmd);
            let rows = JSON.parse(await res.Body.transformToString());
            if (!authenticated) {
                const restricted = process.env.USE_CASE_RESTRICTED_COLUMNS
                    ? process.env.USE_CASE_RESTRICTED_COLUMNS.split(",").map((s) => s.trim()).filter(Boolean)
                    : Object.keys(USE_CASE_COLUMN_KEYS);
                rows = stripRestrictedColumns(rows, restricted, USE_CASE_COLUMN_KEYS);
            }
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) };
        } catch (err) {
            console.error("[data/use-cases] error:", err.message);
            return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Failed to load data" }) };
        }
    }
    if (path === "/api/data/industry" || path === "/api/data/industry/") {
        try {
            const authenticated = await isRequestAuthenticated(event);
            const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: "industry_use_cases.json" });
            const res = await s3.send(cmd);
            let rows = JSON.parse(await res.Body.transformToString());
            if (!authenticated) {
                const restricted = process.env.INDUSTRY_RESTRICTED_COLUMNS
                    ? process.env.INDUSTRY_RESTRICTED_COLUMNS.split(",").map((s) => s.trim()).filter(Boolean)
                    : Object.keys(INDUSTRY_COLUMN_KEYS);
                rows = stripRestrictedColumns(rows, restricted, INDUSTRY_COLUMN_KEYS);
            }
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) };
        } catch (err) {
            console.error("[data/industry] error:", err.message);
            return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Failed to load data" }) };
        }
    }

    // --- Config API route ---
    if (path === "/api/config" || path === "/api/config/") {
        try {
            const issuer = process.env.OKTA_ISSUER;
            const secretName = process.env.AIUC_SECRET_NAME;

            if (!issuer || !secretName) {
                console.warn("OKTA_ISSUER or AIUC_SECRET_NAME not set");
                return {
                    statusCode: 500,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Server configuration error" }),
                };
            }

            const command = new GetSecretValueCommand({ SecretId: secretName });
            const response = await secretsManager.send(command);

            let secretData = {};
            if ("SecretString" in response) {
                secretData = JSON.parse(response.SecretString);
            }

            const clientId = secretData.OKTA_CLIENT_ID;

            if (!clientId) {
                return {
                    statusCode: 500,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "OKTA_CLIENT_ID not found in secret" }),
                };
            }

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ issuer, clientId }),
            };
        } catch (err) {
            console.error("Config fetch error:", err);
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Failed to fetch configuration" }),
            };
        }
    }

    // --- Contact API route ---
    if ((path === "/api/contact" || path === "/api/contact/") && method === "POST") {
        try {
            const authenticated = await isRequestAuthenticated(event);
            if (!authenticated) {
                return {
                    statusCode: 401,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "You must be signed in to send a message." }),
                };
            }

            const body = JSON.parse(event.body || "{}");
            const { from, subject, message } = body;

            if (!from || !subject || !message) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Missing required fields: from, subject, message" }),
                };
            }

            await sendEmail({
                to: CONTACT_EMAIL,
                replyTo: from,
                subject,
                text: `From: ${from}\n\n${message}`,
            });

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ success: true, message: "Email sent successfully" }),
            };
        } catch (err) {
            console.error("Contact email error:", err);
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Failed to send email" }),
            };
        }
    }

    // --- Admin approval route ---
    if ((path === "/api/approve" || path === "/api/approve/") && method === "GET") {
        const qs = event.queryStringParameters || {};
        const token = qs.token || "";
        const payload = verifyApprovalToken(token);

        const html = (title, body, color = "#2e7d32") =>
            `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">` +
            `<h2 style="color:${color}">${title}</h2><p>${body}</p></body></html>`;

        if (!payload) {
            return {
                statusCode: 400,
                headers: { "Content-Type": "text/html" },
                body: html("Invalid or Expired Link", "This approval link is invalid or has expired (links are valid for 7 days).", "#c62828"),
            };
        }

        // Send the user their registration link
        const regToken = generateApprovalToken(payload.email, payload.domain, payload.name);
        const regLink = `${APP_URL}/register?token=${encodeURIComponent(regToken)}`;

        try {
            await sendEmail({
                to: payload.email,
                subject: "You're approved — complete your registration for AI Use Case Repository",
                text: [
                    `Hi ${payload.name || "there"},`,
                    "",
                    "Your access request for the AI Use Case Repository has been approved!",
                    "",
                    "Click the link below to complete your registration:",
                    regLink,
                    "",
                    "This link is valid for 7 days.",
                    "",
                    "— AI Use Case Repository Team",
                ].join("\n"),
            });
            console.log(`[approve] Approval email sent to ${payload.email}`);
        } catch (err) {
            console.error("[approve] Failed to send approval email:", err.message);
            return {
                statusCode: 500,
                headers: { "Content-Type": "text/html" },
                body: html("Email Failed", `Approval recorded but failed to send email to ${payload.email}. Please email them manually.`, "#e65100"),
            };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "text/html" },
            body: html(
                "User Approved ✓",
                `An email has been sent to <strong>${payload.email}</strong> with a link to complete their registration.`
            ),
        };
    }

    // --- Admin rejection route ---
    if ((path === "/api/reject" || path === "/api/reject/") && method === "GET") {
        const qs = event.queryStringParameters || {};
        const token = qs.token || "";
        const payload = verifyApprovalToken(token);

        const html = (title, body, color = "#c62828") =>
            `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">` +
            `<h2 style="color:${color}">${title}</h2><p>${body}</p></body></html>`;

        if (!payload) {
            return {
                statusCode: 400,
                headers: { "Content-Type": "text/html" },
                body: html("Invalid or Expired Link", "This rejection link is invalid or has expired (links are valid for 7 days)."),
            };
        }

        try {
            await sendEmail({
                to: payload.email,
                subject: "Update on your AI Use Case Repository access request",
                text: [
                    `Hi ${payload.name || "there"},`,
                    "",
                    "Thank you for your interest in the AI Use Case Repository.",
                    "",
                    "After reviewing your request, we're unable to grant access at this time.",
                    "If you believe this is an error or would like to provide more context,",
                    `please reach out to us at ${CONTACT_EMAIL}.`,
                    "",
                    "— AI Use Case Repository Team",
                ].join("\n"),
            });
            console.log(`[reject] Rejection email sent to ${payload.email}`);
        } catch (err) {
            console.error("[reject] Failed to send rejection email:", err.message);
            return {
                statusCode: 500,
                headers: { "Content-Type": "text/html" },
                body: html("Email Failed", `Failed to send rejection email to ${payload.email}. Please email them manually.`, "#e65100"),
            };
        }

        return {
            statusCode: 200,
            headers: { "Content-Type": "text/html" },
            body: html(
                "User Rejected",
                `A rejection email has been sent to <strong>${payload.email}</strong>.`,
                "#555"
            ),
        };
    }

    // --- Email domain validation route ---
    if ((path === "/api/validate-email" || path === "/api/validate-email/") && method === "POST") {
        try {
            const body = JSON.parse(event.body || "{}");
            const { email, name, token } = body;

            // If an approval token is provided, validate it and bypass domain checks
            if (token) {
                const payload = verifyApprovalToken(token);
                if (payload && payload.email.toLowerCase() === (email || "").trim().toLowerCase()) {
                    // B11: Token replay protection — reject already-used tokens
                    const tokenHash = createHash("sha256").update(token).digest("hex");
                    const usedKey = `used_tokens/${tokenHash}`;
                    try {
                        await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: usedKey }));
                        // Token already exists in S3 → it was already used
                        return {
                            statusCode: 200,
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ allowed: false, reason: "token_already_used" }),
                        };
                    } catch {
                        // Token not found → mark it as used now
                        await s3.send(new PutObjectCommand({
                            Bucket: BUCKET,
                            Key: usedKey,
                            Body: new Date().toISOString(),
                            ContentType: "text/plain",
                        }));
                    }
                    return {
                        statusCode: 200,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ allowed: true }),
                    };
                }
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ allowed: false }),
                };
            }

            if (!email) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Missing required field: email" }),
                };
            }

            const domain = email.split("@")[1]?.toLowerCase();
            if (!domain) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Invalid email address" }),
                };
            }

            // 1. Block known personal email providers — no notification sent
            if (BLOCKED_DOMAINS.has(domain)) {
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ allowed: false }),
                };
            }

            // 2. Any non-personal domain is allowed
            console.log(`[validate-email] Non-personal domain allowed: ${domain}`);
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ allowed: true }),
            };
        } catch (err) {
            console.error("Email validation error:", err);
            return {
                statusCode: 500,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Failed to validate email" }),
            };
        }
    }

    // --- Usage logging route ---
    if ((path === "/api/log" || path === "/api/log/") && method === "POST") {
        try {
            const body = JSON.parse(event.body || "{}");
            const { eventType, userEmail, userName, data, timestamp, sessionId } = body;

            const validEventTypes = ["search", "click", "column_click", "row_click", "filter", "page_view", "register"];
            if (!eventType || !validEventTypes.includes(eventType)) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Invalid or missing eventType" }),
                };
            }

            const eventId = crypto.randomUUID();
            const ts = timestamp || new Date().toISOString();
            const date = ts.slice(0, 10); // YYYY-MM-DD

            const logEntry = {
                eventId,
                timestamp: ts,
                eventType,
                userEmail: userEmail || "anonymous",
                userName: userName || "anonymous",
                sessionId: sessionId || "unknown",
                data: data || {},
            };

            await s3.send(new PutObjectCommand({
                Bucket: BUCKET,
                Key: `${LOG_PREFIX}/${date}/${eventId}.json`,
                Body: JSON.stringify(logEntry),
                ContentType: "application/json",
            }));

            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ok: true }),
            };
        } catch (err) {
            console.error("Log write error:", err);
            // Return 200 so the frontend never retries or surfaces this error
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ok: false }),
            };
        }
    }

    // --- RAG search routes ---
    if ((path === "/api/search" || path === "/api/search/") && method === "POST") {
        try {
            const body = JSON.parse(event.body || "{}");
            const { query, limit } = body;
            if (!query || typeof query !== "string" || !query.trim()) {
                return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing required field: query" }) };
            }
            const result = await handleUseCaseSearch({
                query,
                limit,
                s3Client: s3,
                bucket: BUCKET,
                embeddingsKey: USE_CASES_EMBEDDINGS_KEY,
                bedrockClient: bedrockRuntime,
            });
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
        } catch (err) {
            console.error("[search] error:", err.message);
            return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Search failed" }) };
        }
    }

    if ((path === "/api/search/industry" || path === "/api/search/industry/") && method === "POST") {
        try {
            const body = JSON.parse(event.body || "{}");
            const { query, limit } = body;
            if (!query || typeof query !== "string" || !query.trim()) {
                return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Missing required field: query" }) };
            }
            const result = await handleIndustrySearch({
                query,
                limit,
                s3Client: s3,
                bucket: BUCKET,
                industryEmbeddingsKey: INDUSTRY_EMBEDDINGS_KEY,
                bedrockClient: bedrockRuntime,
            });
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
        } catch (err) {
            console.error("[search/industry] error:", err.message);
            return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Industry search failed" }) };
        }
    }

    // --- Static file serving ---
    let key;
    if (path === "/" || path === "") {
        key = `${DIST_PREFIX}/index.html`;
    } else {
        // Remove leading slash and prepend dist prefix
        const cleanPath = path.startsWith("/") ? path.substring(1) : path;
        key = `${DIST_PREFIX}/${cleanPath}`;
    }

    const contentType = getMimeType(key);
    return getS3Object(key, contentType);
}
