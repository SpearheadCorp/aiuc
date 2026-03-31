import { createHmac } from "crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { GoogleGenerativeAI } from "@google/generative-ai";
import nodemailer from "nodemailer";

const s3 = new S3Client({ region: process.env.S3_REGION });
const secretsManager = new SecretsManagerClient({ region: process.env.S3_REGION || process.env.AWS_REGION });
const dynamodb = new DynamoDBClient({ region: process.env.S3_REGION || process.env.AWS_REGION });
const geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const BUCKET = process.env.BUCKET_NAME;
const DIST_PREFIX = process.env.DIST_PREFIX;
const LOG_TABLE = process.env.LOG_TABLE_NAME || "aiuc-usage-logs";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "aiuc@purestorage.com";
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL || CONTACT_EMAIL;
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "change-me-in-production";

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

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

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
    if (sig !== expected) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString());
        if (Date.now() > data.exp) return null; // expired
        return data;
    } catch {
        return null;
    }
}

/**
 * Classify an email domain using Gemini to determine if it is an enterprise domain.
 * Returns { confidence, isEnterprise, reasoning, recommendation } or safe defaults on error.
 */
async function checkDomainWithGemini(domain) {
    const safeDefault = {
        confidence: 0,
        isEnterprise: false,
        reasoning: "Classification unavailable — AI service error",
        recommendation: "Review",
    };

    if (!process.env.GEMINI_API_KEY) {
        console.warn("[checkDomainWithGemini] GEMINI_API_KEY not set — skipping AI check");
        return safeDefault;
    }

    const prompt = `You are an email domain classifier. Determine if this domain belongs to a business or enterprise organization.

Domain: ${domain}

Respond with ONLY valid JSON (no markdown code fences, no extra text before or after):
{
  "confidence": <integer 0-100>,
  "isEnterprise": <true or false>,
  "reasoning": "<one concise sentence>",
  "recommendation": "<Approve, Review, or Reject>"
}

Rules:
- confidence > 80  → clearly enterprise (company, university, government, NGO) → "Approve"
- confidence 50–80 → ambiguous, needs human review → "Review"
- confidence < 50  → likely personal or suspicious → "Reject"`;

    try {
        const model = geminiClient.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        // Strip markdown fences if Gemini wraps the JSON anyway
        const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        const parsed = JSON.parse(cleaned);

        return {
            confidence:    typeof parsed.confidence    === "number"  ? parsed.confidence    : 0,
            isEnterprise:  typeof parsed.isEnterprise  === "boolean" ? parsed.isEnterprise  : false,
            reasoning:     typeof parsed.reasoning     === "string"  ? parsed.reasoning     : "No reasoning provided",
            recommendation: ["Approve", "Review", "Reject"].includes(parsed.recommendation)
                ? parsed.recommendation
                : "Review",
        };
    } catch (err) {
        console.error("[checkDomainWithGemini] Error:", err.message);
        return safeDefault;
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

            await transporter.sendMail({
                from: process.env.SMTP_FROM,
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
            await transporter.sendMail({
                from: process.env.SMTP_FROM,
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
            await transporter.sendMail({
                from: process.env.SMTP_FROM,
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
                    console.log(`[validate-email] Token approved for ${email}`);
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

            // 1. Check whitelist (comma-separated env var, e.g. "company1.com,company2.com")
            const whitelist = (process.env.WHITELIST_DOMAINS || "")
                .split(",")
                .map(d => d.trim().toLowerCase())
                .filter(Boolean);

            if (whitelist.includes(domain)) {
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ allowed: true }),
                };
            }

            // 2. Block known personal email providers — no notification sent
            if (BLOCKED_DOMAINS.has(domain)) {
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ allowed: false }),
                };
            }

            // 3. Unknown domain — ask Gemini to classify it
            const aiResult = await checkDomainWithGemini(domain);
            const { confidence } = aiResult;

            // Tier thresholds:
            //   > 80%  → auto-approve (full registration, no human needed)
            //   10–80% → pending human review
            //   < 10%  → reject
            const autoApprove   = confidence > 80;
            const pendingReview = confidence >= 10 && confidence <= 80;

            console.log(`[validate-email] domain=${domain} confidence=${confidence} recommendation=${aiResult.recommendation} autoApprove=${autoApprove} pendingReview=${pendingReview}`);

            // Generate signed tokens for approve and reject links
            const approvalToken = generateApprovalToken(email, domain, name || "");
            const approveLink = `${APP_URL}/api/approve?token=${encodeURIComponent(approvalToken)}`;
            const rejectLink  = `${APP_URL}/api/reject?token=${encodeURIComponent(approvalToken)}`;

            // Notify approval alias for all non-trivial outcomes
            await transporter.sendMail({
                from: process.env.SMTP_FROM,
                to: APPROVAL_EMAIL,
                subject: `[AIUC] Registration — ${domain} | ${autoApprove ? "Auto-Approved" : pendingReview ? "Needs Review" : "Rejected"} (${confidence}%)`,
                text: [
                    "A new user has requested access to the AI Use Case Repository.",
                    "",
                    `Registrant  : ${name || "Not provided"} <${email}>`,
                    `Domain      : ${domain}`,
                    `Confidence  : ${confidence}%`,
                    `Enterprise  : ${aiResult.isEnterprise ? "Yes" : "No"}`,
                    `AI Reasoning: ${aiResult.reasoning}`,
                    `Recommended : ${aiResult.recommendation}`,
                    "",
                    autoApprove
                        ? "✅ Access GRANTED automatically (confidence > 80%). No action needed."
                        : pendingReview
                            ? `⏳ Access PENDING — take action:\n\n  ✅ APPROVE: ${approveLink}\n\n  ❌ REJECT:  ${rejectLink}`
                            : `❌ Auto-REJECTED (confidence < 10%).\nTo override:\n\n  ✅ APPROVE: ${approveLink}\n\n  ❌ REJECT:  ${rejectLink}`,
                ].join("\n"),
            });

            // > 80%: allow with no pendingApproval — RegisterForm proceeds straight to Cognito signup
            if (autoApprove) {
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ allowed: true }),
                };
            }

            // 10–80%: allow through domain check but flag as pending — RegisterForm shows "pending" screen
            if (pendingReview) {
                return {
                    statusCode: 200,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ allowed: true, pendingApproval: true }),
                };
            }

            // < 10%: block
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ allowed: false }),
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

            await dynamodb.send(new PutItemCommand({
                TableName: LOG_TABLE,
                Item: {
                    eventId:   { S: eventId },
                    timestamp: { S: ts },
                    eventType: { S: eventType },
                    userEmail: { S: userEmail || "anonymous" },
                    userName:  { S: userName  || "anonymous" },
                    sessionId: { S: sessionId || "unknown" },
                    data:      { S: JSON.stringify(data || {}) },
                },
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
