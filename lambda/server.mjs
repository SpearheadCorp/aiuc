/**
 * Local development API server — mirrors the /api/contact and /api/log
 * routes from the Lambda handler so you can test without deploying to AWS.
 *
 * Usage:
 *   node lambda/server.mjs          (reads lambda/.env automatically)
 */

import http from "http";
import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

// ---------------------------------------------------------------------------
// Load lambda/.env (if it exists) into process.env
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Read from root .env (one level up from lambda/)
const envPath = path.join(__dirname, "..", ".env");
try {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding single or double quotes (e.g. KEY="value" → value)
    const value = val.replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = value;
  }
  console.log(`[env] Loaded ${envPath}`);
} catch {
  console.warn(`[env] No .env found — using process environment only.`);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.LOCAL_PORT || "3001");
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "aiuc@purestorage.com";
const APPROVAL_EMAIL = process.env.APPROVAL_EMAIL || CONTACT_EMAIL;
const APP_URL = (process.env.APP_URL || `http://localhost:5173`).replace(/\/$/, "");
const APPROVAL_SECRET = process.env.APPROVAL_SECRET || "change-me-in-production";

function generateApprovalToken(email, domain, name) {
  const payload = Buffer.from(JSON.stringify({
    email, domain, name,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
  })).toString("base64url");
  const sig = createHmac("sha256", APPROVAL_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyApprovalToken(token) {
  if (!token || !token.includes(".")) return null;
  const dotIdx = token.lastIndexOf(".");
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = createHmac("sha256", APPROVAL_SECRET).update(payload).digest("hex");
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > data.exp) return null;
    return data;
  } catch { return null; }
}

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

const ses = new SESClient({ region: process.env.SES_REGION || process.env.AWS_REGION || "us-east-2" });
const SES_FROM = process.env.SES_FROM_EMAIL;

async function sendEmail({ to, subject, text, replyTo }) {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS headers so Vite dev server can reach us
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const rawUrl = req.url || "/";
  const url = rawUrl.split("?")[0];
  const searchParams = new URLSearchParams(rawUrl.includes("?") ? rawUrl.split("?")[1] : "");

  // GET /api/approve — admin clicks to approve a pending user
  if (req.method === "GET" && url === "/api/approve") {
    const token = searchParams.get("token") || "";
    const payload = verifyApprovalToken(token);

    const html = (title, body, color = "#2e7d32") => {
      res.writeHead(color === "#2e7d32" ? 200 : 400, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center"><h2 style="color:${color}">${title}</h2><p>${body}</p></body></html>`);
    };

    if (!payload) return html("Invalid or Expired Link", "This approval link is invalid or has expired (links are valid for 7 days).", "#c62828");

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
      return html("User Approved ✓", `An email has been sent to <strong>${payload.email}</strong> with a link to complete their registration.`);
    } catch (err) {
      console.error("[approve] Failed to send approval email:", err.message);
      return html("Email Failed", `Approval recorded but failed to send email to ${payload.email}.`, "#e65100");
    }
  }

  // GET /api/reject — admin rejects a pending user
  if (req.method === "GET" && url === "/api/reject") {
    const token = searchParams.get("token") || "";
    const payload = verifyApprovalToken(token);

    const html = (title, body, color = "#c62828") => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center"><h2 style="color:${color}">${title}</h2><p>${body}</p></body></html>`);
    };

    if (!payload) return html("Invalid or Expired Link", "This rejection link is invalid or has expired (links are valid for 7 days).");

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
      return html("User Rejected", `A rejection email has been sent to <strong>${payload.email}</strong>.`, "#555");
    } catch (err) {
      console.error("[reject] Failed to send rejection email:", err.message);
      return html("Email Failed", `Failed to send rejection email to ${payload.email}.`, "#e65100");
    }
  }

  // POST /api/contact — send email via SMTP
  if (req.method === "POST" && url === "/api/contact") {
    try {
      const { from, subject, message } = await readBody(req);
      if (!from || !subject || !message) {
        return send(res, 400, { error: "Missing required fields: from, subject, message" });
      }

      console.log(`[contact] Sending email — from: ${from}, subject: ${subject}`);
      await sendEmail({
        to: CONTACT_EMAIL,
        replyTo: from,
        subject,
        text: `From: ${from}\n\n${message}`,
      });
      console.log(`[contact] Email sent OK`);
      return send(res, 200, { success: true, message: "Email sent successfully" });
    } catch (err) {
      console.error(`[contact] Error:`, err.message);
      return send(res, 500, { error: "Failed to send email" });
    }
  }

  // GET /api/columns-config — returns which columns are greyed out
  if (req.method === "GET" && url === "/api/columns-config") {
    const useCaseRestricted = process.env.USE_CASE_RESTRICTED_COLUMNS
      ? process.env.USE_CASE_RESTRICTED_COLUMNS.split(",").map((s) => s.trim()).filter(Boolean)
      : ["AI Algorithms & Frameworks", "Datasets", "Action / Implementation", "AI Tools & Models", "Digital Platforms and Tools"];
    const industryRestricted = process.env.INDUSTRY_RESTRICTED_COLUMNS
      ? process.env.INDUSTRY_RESTRICTED_COLUMNS.split(",").map((s) => s.trim()).filter(Boolean)
      : ["Implementation Plan", "Datasets", "AI Tools / Platforms", "Digital Tools / Platforms", "AI Frameworks", "AI Tools and Models", "Industry References"];
    return send(res, 200, { useCaseRestricted, industryRestricted });
  }

  // POST /api/validate-email — domain validation pre-gate
  if (req.method === "POST" && url === "/api/validate-email") {
    try {
      const { email, name, token } = await readBody(req);

      // Approval token bypass — user came from admin-approved link
      if (token) {
        const payload = verifyApprovalToken(token);
        if (payload && payload.email.toLowerCase() === (email || "").trim().toLowerCase()) {
          console.log(`[validate-email] Token approved for ${email}`);
          return send(res, 200, { allowed: true });
        }
        return send(res, 200, { allowed: false });
      }

      if (!email) {
        return send(res, 400, { error: "Missing required field: email" });
      }

      const domain = email.split("@")[1]?.toLowerCase();
      if (!domain) {
        return send(res, 400, { error: "Invalid email address" });
      }

      // 1. Block known personal providers — silent, no email
      if (BLOCKED_DOMAINS.has(domain)) {
        console.log(`[validate-email] Blocked personal domain: ${domain}`);
        return send(res, 200, { allowed: false });
      }

      // 2. Any non-personal domain is allowed
      console.log(`[validate-email] Non-personal domain allowed: ${domain}`);
      return send(res, 200, { allowed: true });
    } catch (err) {
      console.error(`[validate-email] Error:`, err.message);
      return send(res, 500, { error: "Failed to validate email" });
    }
  }

  // POST /api/log — no-op locally (S3 not available in dev)
  if (req.method === "POST" && url === "/api/log") {
    await readBody(req).catch(() => { });
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`\n Local API server → http://localhost:${PORT}`);
  console.log(`   CONTACT_EMAIL     : ${CONTACT_EMAIL}`);
  console.log(`   APPROVAL_EMAIL    : ${APPROVAL_EMAIL}`);
  console.log(`   SES_FROM_EMAIL    : ${SES_FROM || "(not set)"}`);
  console.log(`   SES_REGION        : ${process.env.SES_REGION || process.env.AWS_REGION || "us-east-2"}\n`);
});
