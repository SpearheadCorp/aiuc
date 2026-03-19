import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const s3 = new S3Client({ region: process.env.S3_REGION });
const ses = new SESClient({ region: process.env.S3_REGION });
const secretsManager = new SecretsManagerClient({ region: process.env.S3_REGION || process.env.AWS_REGION });
const BUCKET = process.env.BUCKET_NAME;
const DIST_PREFIX = process.env.DIST_PREFIX;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "aiuc@purestorage.com";
const SENDER_EMAIL = process.env.SENDER_EMAIL || "aiuc@purestorage.com";

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
        const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const response = await s3.send(command);
        const body = await response.Body.transformToString();

        // For binary assets (images, fonts), return base64 encoded
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
 * Lambda handler — serves the Vite frontend and data API
 */
export async function handler(event) {
    // Support both Function URL (rawPath) and ALB (path)
    const path = event.rawPath || event.path || "/";
    const method = event.requestContext?.http?.method || event.httpMethod || "GET";

    console.log(`[Request] ${method} ${path}`);

    // --- Data API routes ---
    if (path === "/api/data/use-cases" || path === "/api/data/use-cases/") {
        return getS3Object("use_cases.json", "application/json");
    }
    if (path === "/api/data/industry" || path === "/api/data/industry/") {
        return getS3Object("industry_use_cases.json", "application/json");
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
            const body = JSON.parse(event.body || "{}");
            const { from, subject, message } = body;

            if (!from || !subject || !message) {
                return {
                    statusCode: 400,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ error: "Missing required fields: from, subject, message" }),
                };
            }

            const command = new SendEmailCommand({
                Source: SENDER_EMAIL,
                Destination: {
                    ToAddresses: [CONTACT_EMAIL],
                },
                Message: {
                    Subject: { Data: subject },
                    Body: {
                        Text: {
                            Data: `From: ${from}\n\n${message}`,
                        },
                    },
                },
                ReplyToAddresses: [from],
            });

            await ses.send(command);

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
