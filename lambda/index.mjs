import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import nodemailer from "nodemailer";

const s3 = new S3Client({ region: process.env.S3_REGION });

const BUCKET        = process.env.BUCKET_NAME;
const DIST_PREFIX   = process.env.DIST_PREFIX;
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "aiuc@purestorage.com";
const SMTP_HOST     = process.env.SMTP_HOST     || "";
const SMTP_PORT     = process.env.SMTP_PORT     || "587";
const SMTP_USER     = process.env.SMTP_USER     || "";
const SMTP_PASS     = process.env.SMTP_PASS     || "";
const SMTP_FROM     = process.env.SMTP_FROM     || SMTP_USER;

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
    const path   = event.rawPath || event.path || "/";
    const method = event.requestContext?.http?.method || event.httpMethod || "GET";

    console.log(`[Request] ${method} ${path}`);

    // ── Data API ───────────────────────────────────────────────────────────────
    if (path === "/api/data/use-cases" || path === "/api/data/use-cases/") {
        return getS3Object("use_cases.json", "application/json");
    }
    if (path === "/api/data/industry" || path === "/api/data/industry/") {
        return getS3Object("industry_use_cases.json", "application/json");
    }

    // ── POST /api/contact ──────────────────────────────────────────────────────
    if ((path === "/api/contact" || path === "/api/contact/") && method === "POST") {
        try {
            const body = JSON.parse(event.body || "{}");
            const { from, subject, message } = body;

            if (!from || !subject || !message) {
                return json(400, { error: "Missing required fields: from, subject, message" });
            }

            if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
                return json(503, { error: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in Lambda environment variables." });
            }

            const transporter = nodemailer.createTransport({
                host: SMTP_HOST,
                port: parseInt(SMTP_PORT, 10),
                secure: false,
                auth: { user: SMTP_USER, pass: SMTP_PASS },
            });

            await transporter.sendMail({
                from:    SMTP_FROM,
                to:      CONTACT_EMAIL,
                replyTo: from,
                subject,
                text:    `From: ${from}\n\n${message}`,
            });

            return json(200, { success: true, message: "Email sent successfully" });
        } catch (err) {
            console.error("Contact email error:", err);
            return json(500, { error: `Failed to send email: ${err.message}` });
        }
    }

    // ── Static file serving ────────────────────────────────────────────────────
    let key;
    if (path === "/" || path === "") {
        key = `${DIST_PREFIX}/index.html`;
    } else {
        const cleanPath = path.startsWith("/") ? path.substring(1) : path;
        key = `${DIST_PREFIX}/${cleanPath}`;
    }

    return getS3Object(key, getMimeType(key));
}
