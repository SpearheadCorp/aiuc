# Gmail API + HTML Template Email Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace nodemailer SMTP sending with Gmail API (OAuth2) and send a branded HTML email template instead of plain text.

**Architecture:** The Lambda function will use Google's `googleapis` package to send email through the Gmail API using a service-account or OAuth2 refresh-token credential. The email body will be a self-contained HTML template rendered server-side before being base64-encoded and sent via `gmail.users.messages.send`.

**Tech Stack:** `googleapis` npm package (Gmail API v1), Node.js 20 (ESM), AWS Lambda environment variables for OAuth2 credentials.

---

## Background: What Changes and Why

| Before | After |
|--------|-------|
| nodemailer + SMTP credentials | Gmail API (OAuth2 or Service Account) |
| Plain-text email body | HTML branded email template |
| Env vars: `SMTP_HOST/PORT/USER/PASS/FROM` | Env vars: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER` |

The Gmail API requires a one-time OAuth2 consent flow to obtain a refresh token. Once you have the refresh token, the Lambda auto-refreshes access tokens at runtime — no SMTP server needed.

---

## Pre-requisites (Do These First, Outside the Code)

### Step A: Create Google Cloud OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → select/create a project
2. **APIs & Services → Enable APIs** → search for "Gmail API" → Enable
3. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Desktop App** (for one-time token generation)
   - Download the JSON — you need `client_id` and `client_secret`

### Step B: Get a Refresh Token (One-Time)

Run this locally (Node.js) using the [OAuth2 Playground](https://developers.google.com/oauthplayground/) or the snippet below:

```bash
# Install googleapis locally for token generation only
npm install googleapis

node -e "
const { google } = require('googleapis');
const oauth2 = new google.auth.OAuth2(
  'YOUR_CLIENT_ID',
  'YOUR_CLIENT_SECRET',
  'urn:ietf:wg:oauth:2.0:oob'  // OOB redirect for desktop apps
);
console.log(oauth2.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.send'],
  prompt: 'consent'
}));
"
# Open the URL → authorize → paste the code below:

node -e "
const { google } = require('googleapis');
const oauth2 = new google.auth.OAuth2('CLIENT_ID', 'CLIENT_SECRET', 'urn:ietf:wg:oauth:2.0:oob');
oauth2.getToken('PASTE_AUTH_CODE_HERE').then(r => console.log(r.tokens));
"
# Copy refresh_token from output
```

### Step C: Set Lambda Environment Variables

In AWS Console → Lambda → your function → Configuration → Environment Variables, add:

| Key | Value |
|-----|-------|
| `GMAIL_CLIENT_ID` | from Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | from Google Cloud Console |
| `GMAIL_REFRESH_TOKEN` | from Step B above |
| `GMAIL_SENDER` | the Gmail address you authorized (e.g. `aiuc@purestorage.com`) |
| `CONTACT_EMAIL` | destination address (keep as-is) |

Remove the old SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).

---

## Task 1: Add `googleapis` Dependency to Lambda

**Files:**
- Modify: `lambda/package.json`

**Step 1: Add the dependency**

Edit `lambda/package.json` — replace the `nodemailer` entry with `googleapis`:

```json
{
  "name": "aiuc-lambda",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "cookie": "^1.0.2",
    "googleapis": "^144.0.0",
    "jsonwebtoken": "^9.0.2",
    "jwks-rsa": "^3.1.0"
  }
}
```

(Remove `"nodemailer": "^8.0.4"` — it is no longer needed.)

**Step 2: Install in lambda directory**

```bash
cd lambda
npm install
```

Expected output: `added N packages` with no errors. `googleapis` should appear in `node_modules`.

**Step 3: Verify lock file is updated**

```bash
grep '"googleapis"' lambda/package-lock.json | head -3
```

Expected: shows `googleapis` entry with a version.

**Step 4: Commit**

```bash
git add lambda/package.json lambda/package-lock.json
git commit -m "feat(email): replace nodemailer with googleapis for Gmail API"
```

---

## Task 2: Build the HTML Email Template

**Files:**
- Create: `lambda/emailTemplate.mjs`

**Step 1: Create the template module**

```js
// lambda/emailTemplate.mjs
// Returns a branded HTML email string.
// All styles are inline for maximum email-client compatibility.

/**
 * @param {object} params
 * @param {string} params.fromEmail   - Sender's email address
 * @param {string} params.subject     - Email subject line
 * @param {string} params.message     - Message body (plain text, newlines preserved)
 * @param {string} params.contactEmail - Destination address shown in footer
 * @returns {string} Complete HTML email
 */
export function buildEmailHtml({ fromEmail, subject, message, contactEmail }) {
  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
               style="background-color:#ffffff;border-radius:8px;overflow:hidden;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#FA4616;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;
                         letter-spacing:0.5px;">
                AIUC Contact Form
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;font-size:13px;color:#888888;
                        text-transform:uppercase;letter-spacing:0.5px;">
                New message from
              </p>
              <p style="margin:0 0 24px;font-size:16px;font-weight:600;color:#222222;">
                ${fromEmail}
              </p>

              <p style="margin:0 0 8px;font-size:13px;color:#888888;
                        text-transform:uppercase;letter-spacing:0.5px;">
                Subject
              </p>
              <p style="margin:0 0 24px;font-size:16px;font-weight:600;color:#222222;">
                ${subject}
              </p>

              <p style="margin:0 0 8px;font-size:13px;color:#888888;
                        text-transform:uppercase;letter-spacing:0.5px;">
                Message
              </p>
              <div style="background-color:#f9f9f9;border-left:4px solid #FA4616;
                          border-radius:4px;padding:16px 20px;font-size:15px;
                          line-height:1.6;color:#333333;">
                ${escapedMessage}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f4f4f4;padding:16px 32px;
                       border-top:1px solid #e8e8e8;">
              <p style="margin:0;font-size:12px;color:#aaaaaa;text-align:center;">
                This message was sent via the AIUC Contact Form to
                <a href="mailto:${contactEmail}"
                   style="color:#FA4616;text-decoration:none;">${contactEmail}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
```

**Step 2: Sanity check — open the file and verify it saved correctly**

```bash
head -5 lambda/emailTemplate.mjs
```

Expected: first 5 lines of the file above.

**Step 3: Commit**

```bash
git add lambda/emailTemplate.mjs
git commit -m "feat(email): add branded HTML email template for Gmail API"
```

---

## Task 3: Rewrite the `/api/contact` Handler in Lambda

**Files:**
- Modify: `lambda/index.mjs`

**Step 1: Locate the current email imports and SMTP env vars**

Current lines in `lambda/index.mjs`:
```js
// Line 4
import nodemailer from "nodemailer";

// Lines 50-55
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "aiuc@purestorage.com";
const SMTP_HOST     = process.env.SMTP_HOST     || "";
const SMTP_PORT     = process.env.SMTP_PORT     || "587";
const SMTP_USER     = process.env.SMTP_USER     || "";
const SMTP_PASS     = process.env.SMTP_PASS     || "";
const SMTP_FROM     = process.env.SMTP_FROM     || SMTP_USER;
```

**Step 2: Replace the import (line 4)**

Find:
```js
import nodemailer from "nodemailer";
```

Replace with:
```js
import { google } from "googleapis";
import { buildEmailHtml } from "./emailTemplate.mjs";
```

**Step 3: Replace the SMTP env var block (lines 50-55)**

Find:
```js
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "aiuc@purestorage.com";
const SMTP_HOST     = process.env.SMTP_HOST     || "";
const SMTP_PORT     = process.env.SMTP_PORT     || "587";
const SMTP_USER     = process.env.SMTP_USER     || "";
const SMTP_PASS     = process.env.SMTP_PASS     || "";
const SMTP_FROM     = process.env.SMTP_FROM     || SMTP_USER;
```

Replace with:
```js
const CONTACT_EMAIL      = process.env.CONTACT_EMAIL      || "aiuc@purestorage.com";
const GMAIL_CLIENT_ID    = process.env.GMAIL_CLIENT_ID    || "";
const GMAIL_CLIENT_SECRET= process.env.GMAIL_CLIENT_SECRET|| "";
const GMAIL_REFRESH_TOKEN= process.env.GMAIL_REFRESH_TOKEN|| "";
const GMAIL_SENDER       = process.env.GMAIL_SENDER       || "";
```

**Step 4: Replace the `/api/contact` route handler (lines 169-205)**

Find the entire block:
```js
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
```

Replace with:
```js
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

        if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_SENDER) {
            return json(503, {
                error: "Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, and GMAIL_SENDER in Lambda environment variables.",
            });
        }

        // Build OAuth2 client and refresh access token automatically
        const oauth2Client = new google.auth.OAuth2(
            GMAIL_CLIENT_ID,
            GMAIL_CLIENT_SECRET
        );
        oauth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        // Build the RFC-2822 raw message with HTML body
        const htmlBody = buildEmailHtml({
            fromEmail: from,
            subject,
            message,
            contactEmail: CONTACT_EMAIL,
        });

        const rawLines = [
            `From: ${GMAIL_SENDER}`,
            `To: ${CONTACT_EMAIL}`,
            `Reply-To: ${from}`,
            `Subject: ${subject}`,
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
        return json(500, { error: `Failed to send email: ${err.message}` });
    }
}
```

**Step 5: Verify the file has no leftover SMTP references**

```bash
grep -n "nodemailer\|SMTP_HOST\|SMTP_PORT\|SMTP_USER\|SMTP_PASS\|SMTP_FROM" lambda/index.mjs
```

Expected: **no output** (zero matches).

**Step 6: Verify the new imports are present**

```bash
grep -n "googleapis\|buildEmailHtml\|GMAIL_" lambda/index.mjs | head -20
```

Expected: lines showing the two imports and the four `GMAIL_` env var reads.

**Step 7: Commit**

```bash
git add lambda/index.mjs
git commit -m "feat(email): switch /api/contact from SMTP to Gmail API with HTML template"
```

---

## Task 4: Update Documentation

**Files:**
- Modify: `DEPLOYMENT_CONFIG.md` (Section 2c and Section 9)
- Modify: `README.md` (Lines 366-375)

**Step 1: Update DEPLOYMENT_CONFIG.md — Section 2c**

Find the existing SMTP table in `DEPLOYMENT_CONFIG.md` (around lines 81-91) and replace it with:

```markdown
### 2c. Email / Contact Form (Gmail API)

| Variable | Required | Description |
|----------|----------|-------------|
| `GMAIL_CLIENT_ID` | Yes | OAuth2 Client ID from Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | Yes | OAuth2 Client Secret from Google Cloud Console |
| `GMAIL_REFRESH_TOKEN` | Yes | Long-lived refresh token (see Pre-requisites in plan) |
| `GMAIL_SENDER` | Yes | Gmail address that was authorized (e.g. `aiuc@purestorage.com`) |
| `CONTACT_EMAIL` | No | Destination address for contact form emails (default: `aiuc@purestorage.com`) |

> **Migration:** Remove `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` from Lambda env vars.
> See `docs/plans/2026-04-06-gmail-api-email-templates.md` for OAuth2 token setup steps.
```

**Step 2: Update README.md — email section (around lines 366-375)**

Find the SMTP variable listing and replace it:

```markdown
#### Email / Contact Form (Gmail API)

| Variable | Description |
|----------|-------------|
| `GMAIL_CLIENT_ID` | OAuth2 Client ID from Google Cloud Console |
| `GMAIL_CLIENT_SECRET` | OAuth2 Client Secret |
| `GMAIL_REFRESH_TOKEN` | Refresh token obtained via OAuth2 consent flow |
| `GMAIL_SENDER` | Authorized Gmail address used to send emails |
| `CONTACT_EMAIL` | Recipient address for contact form (default: `aiuc@purestorage.com`) |
```

**Step 3: Commit**

```bash
git add DEPLOYMENT_CONFIG.md README.md
git commit -m "docs: update email config docs to reflect Gmail API migration"
```

---

## Task 5: Local Smoke Test

> This verifies the Lambda handler without deploying to AWS.

**Step 1: Create a local test event file**

Create `lambda/test-contact-event.json` (do NOT commit — add to `.gitignore`):

```json
{
  "httpMethod": "POST",
  "path": "/api/contact",
  "headers": {
    "Authorization": "Bearer REPLACE_WITH_VALID_OKTA_TOKEN"
  },
  "body": "{\"from\":\"tester@example.com\",\"subject\":\"Test Gmail API\",\"message\":\"Hello from local smoke test\"}"
}
```

**Step 2: Add to .gitignore**

```bash
echo "lambda/test-contact-event.json" >> .gitignore
```

**Step 3: Invoke Lambda locally (if SAM CLI is available)**

```bash
cd lambda && sam local invoke -e test-contact-event.json
```

OR use the AWS Console test feature: paste the JSON above as the test event payload.

Expected response body:
```json
{ "success": true, "message": "Email sent successfully" }
```

Check your `CONTACT_EMAIL` inbox — you should receive the branded HTML email.

---

## Rollback Plan

If Gmail API causes issues in production:

1. Revert `lambda/index.mjs` to the SMTP version via `git revert`
2. Re-add SMTP environment variables in Lambda console
3. Reinstall nodemailer: `cd lambda && npm install nodemailer`

---

## Summary of All Changed Files

| File | Change |
|------|--------|
| `lambda/package.json` | Replace `nodemailer` with `googleapis` |
| `lambda/package-lock.json` | Auto-updated by npm |
| `lambda/emailTemplate.mjs` | **New** — branded HTML template |
| `lambda/index.mjs` | Replace SMTP import/config/handler with Gmail API |
| `DEPLOYMENT_CONFIG.md` | Update env var table |
| `README.md` | Update env var table |
