// lambda/emailTemplate.mjs
// Returns a branded HTML email string.
// All styles are inline for maximum email-client compatibility.

/**
 * @param {object} params
 * @param {string} params.fromEmail      - Sender's email address
 * @param {string} params.subject        - Email subject line
 * @param {string} params.message        - Message body (plain text, newlines preserved)
 * @param {string} params.contactEmail   - Destination address shown in footer
 *
 * Configurable via Lambda environment variables (all optional):
 * @param {string} [params.headerTitle]  - EMAIL_HEADER_TITLE  — header bar text
 * @param {string} [params.brandColor]   - EMAIL_BRAND_COLOR   — hex color for header/border/links
 * @param {string} [params.companyName]  - EMAIL_COMPANY_NAME  — company name in footer
 *
 * @returns {string} Complete HTML email
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildEmailHtml({
  fromEmail,
  subject,
  message,
  contactEmail,
  headerTitle  = "Contact Form",
  brandColor   = "#FA4616",
  companyName  = "AIUC",
}) {
  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const escapedFrom    = escapeHtml(fromEmail);
  const escapedSubject = escapeHtml(subject);
  const escapedContact = escapeHtml(contactEmail);
  const escapedTitle   = escapeHtml(headerTitle);
  const escapedCompany = escapeHtml(companyName);
  // Validate hex color — fall back to default if malformed
  const safeColor = /^#[0-9A-Fa-f]{3,6}$/.test(brandColor) ? brandColor : "#FA4616";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapedSubject}</title>
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
            <td style="background-color:${safeColor};padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;
                         letter-spacing:0.5px;">
                ${escapedTitle}
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
                ${escapedFrom}
              </p>

              <p style="margin:0 0 8px;font-size:13px;color:#888888;
                        text-transform:uppercase;letter-spacing:0.5px;">
                Subject
              </p>
              <p style="margin:0 0 24px;font-size:16px;font-weight:600;color:#222222;">
                ${escapedSubject}
              </p>

              <p style="margin:0 0 8px;font-size:13px;color:#888888;
                        text-transform:uppercase;letter-spacing:0.5px;">
                Message
              </p>
              <div style="background-color:#f9f9f9;border-left:4px solid ${safeColor};
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
                This message was sent via the ${escapedCompany} Contact Form to
                <a href="mailto:${escapedContact}"
                   style="color:${safeColor};text-decoration:none;">${escapedContact}</a>
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
