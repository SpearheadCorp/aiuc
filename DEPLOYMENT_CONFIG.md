# AIUC – Deployment Configuration Guide

## Repository

The latest code has been pushed to GitHub.
**Branch:** `feature/okta-auth-ui-enhancements`
Please pull this branch for deployment.

## Application URL (Current Test Deployment)

https://i55277glxwyi6tmhik5dzvdaiu0czjsa.lambda-url.us-east-2.on.aws/

---

## 1. Frontend Configuration (Vite Environment Variables)

**Where to configure:** In the root of the project, create or edit a file named `.env` (or set these as build environment variables in your CI/CD pipeline such as GitHub Actions secrets).

| Variable | Description | Example |
|---|---|---|
| `VITE_CONTACT_EMAIL` | Contact email displayed in the UI | `aiuc@purestorage.com` |
| `VITE_EMAIL_TOOLTIP_TEXT` | Tooltip text shown when hovering over contact icon | `I'm interested — contact me` |

> ⚠️ **`VITE_OKTA_ISSUER` and `VITE_OKTA_CLIENT_ID` are no longer set in the frontend `.env`.**
> Okta credentials are now fetched securely at runtime from **AWS Secrets Manager** via the Lambda `/api/okta-config` endpoint. See Section 2a below.

**Example `.env` file:**
```
VITE_CONTACT_EMAIL=aiuc@purestorage.com
VITE_EMAIL_TOOLTIP_TEXT=I'm interested — contact me
```

> These values are baked into the frontend build. After changing them, run `npm run build` and re-deploy the `dist/` folder to S3.

---

## 2. Backend Configuration (AWS Lambda Environment Variables)

**Where to configure:**
1. Open the [AWS Lambda Console](https://console.aws.amazon.com/lambda/)
2. Select the function (e.g., `dev-aiuc-frontend`)
3. Go to **Configuration** → **Environment variables** → **Edit**
4. Add or update the following keys:

| Variable | Description | Example |
|---|---|---|
| `BUCKET_NAME` | S3 bucket storing frontend assets and JSON data | `aiuc-data-bucket` |
| `S3_REGION` | AWS region of the S3 bucket and Secrets Manager | `us-east-2` |
| `DIST_PREFIX` | Folder containing built frontend assets | `dist` |
| `OKTA_ISSUER` | Okta issuer URL — read from this env var at runtime | `https://yourcompany.okta.com/oauth2/default` |
| `AIUC_SECRET_NAME` | AWS Secrets Manager secret name holding Okta credentials | `aiuc/okta` |

---

## 2a. Okta Authentication — AWS Secrets Manager Setup

Okta credentials are **not stored in environment variables or frontend code**. The `OKTA_CLIENT_ID` is stored in AWS Secrets Manager and fetched by Lambda at runtime.

### How it works

```
Browser  →  GET /api/okta-config
         →  Lambda reads OKTA_ISSUER from env var
         →  Lambda reads AIUC_SECRET_NAME from env var
         →  Lambda fetches secret from AWS Secrets Manager
         →  Returns { issuer, clientId } to the browser
         →  Browser initializes Okta SDK with these values
```

### Step 1 — Create the secret in AWS Secrets Manager

1. Go to **AWS Console → Secrets Manager → Store a new secret**
2. Select **"Other type of secret"**
3. Add the following key/value pair:

   | Key | Value |
   |---|---|
   | `OKTA_CLIENT_ID` | `<Okta Client ID — provided by your Okta admin>` |

4. Click **Next**
5. Set the **Secret name** to match what you will use for `AIUC_SECRET_NAME` (e.g. `aiuc/okta`)
6. Leave rotation disabled → click **Next** → **Store**

### Step 2 — Add IAM permission to Lambda execution role

1. In Lambda Console → **Configuration** → **Permissions** → click the **Execution role name** (opens IAM)
2. Click **Add permissions** → **Create inline policy**
3. Switch to **JSON** tab and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:<YOUR_REGION>:<YOUR_ACCOUNT_ID>:secret:<YOUR_SECRET_NAME>*"
    }
  ]
}
```

Replace:
- `<YOUR_REGION>` → e.g. `us-east-2`
- `<YOUR_ACCOUNT_ID>` → 12-digit number visible in top-right of AWS Console
- `<YOUR_SECRET_NAME>` → e.g. `aiuc/okta`

4. Name the policy `aiuc-secrets-manager-read` → **Create policy**

### Step 3 — Verify

```bash
curl https://<your-lambda-url>.lambda-url.<region>.on.aws/api/okta-config
```

Expected response:
```json
{ "issuer": "https://yourcompany.okta.com/oauth2/default", "clientId": "0oaXXXXXXXX" }
```

---

## 3. Email / SMTP Configuration

**Where to configure:** Same place as Section 2 — AWS Lambda Console → **Configuration** → **Environment variables**.

Email functionality is fully implemented. The current **503 error** occurs because SMTP credentials have not been configured yet. No code changes are needed — only these environment variables need to be set.

| Variable | Description | Example |
|---|---|---|
| `CONTACT_EMAIL` | Destination email address for contact form submissions | `aiuc@purestorage.com` |
| `SMTP_HOST` | SMTP server hostname | `smtp.office365.com` or `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username or email account used for sending | `noreply@yourcompany.com` |
| `SMTP_PASS` | SMTP password or app password | _(keep secure)_ |
| `SMTP_FROM` | Sender address shown on outbound emails | `noreply@yourcompany.com` |

> **Action required from client:** Please share which email account will be used for outbound system emails (e.g., a no-reply address) along with the SMTP credentials. Timur can then add these directly in the Lambda console — no code deployment needed.

---

## 4. S3 Data Files

**Where to configure:** [AWS S3 Console](https://console.aws.amazon.com/s3/) → select your bucket → upload files to the **bucket root**.

The following JSON data files are **not stored in the repository** and must be uploaded directly to S3:

| File | S3 Location | Purpose |
|---|---|---|
| `use_cases.json` | `s3://your-bucket/use_cases.json` | AI use case data for the main table |
| `industry_use_cases.json` | `s3://your-bucket/industry_use_cases.json` | Industry-specific AI implementation data |

**Expected bucket structure:**
```
your-bucket/
├── dist/
│   ├── index.html
│   ├── assets/
│   └── ...
├── use_cases.json          ← upload here
└── industry_use_cases.json ← upload here
```

---

## 5. Deployment Checklist

- [ ] Pull repository branch: `feature/okta-auth-ui-enhancements`
- [ ] Create `.env` file with frontend variables (Section 1) and run `npm run build`
- [ ] Upload `dist/` folder contents to S3 bucket
- [ ] Upload `use_cases.json` and `industry_use_cases.json` to S3 bucket root (Section 4)
- [ ] In Lambda Console → set backend environment variables (Section 2): `BUCKET_NAME`, `S3_REGION`, `DIST_PREFIX`, `OKTA_ISSUER`, `AIUC_SECRET_NAME`
- [ ] Create secret in AWS Secrets Manager with key `OKTA_CLIENT_ID` (Section 2a — Step 1)
- [ ] Add `aiuc-secrets-manager-read` inline policy to Lambda execution role (Section 2a — Step 2)
- [ ] Verify `/api/okta-config` returns correct `issuer` and `clientId` (Section 2a — Step 3)
- [ ] In Lambda Console → add SMTP credentials (Section 3) once email account is confirmed
- [ ] Test the application via the Lambda Function URL
- [ ] Test contact form email functionality

---

*Powered by Spearhead — Confidential, Internal Use Only*
