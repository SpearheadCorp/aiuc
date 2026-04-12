/**
 * openGmailCompose
 *
 * Opens a Gmail compose window in a new tab with pre-filled fields.
 * This is a frontend-only implementation — no backend API is called.
 *
 * @param contactEmail - Recipient address (e.g. aiuc@purestorage.com)
 * @param subject      - Pre-filled subject line
 * @param body         - Pre-filled message body
 */
export function openGmailCompose(
  contactEmail: string,
  subject: string,
  body: string
): void {
  const safeSubject = subject.trim() || "Request for Information";
  const safeBody = body.trim() || "Hi,\n\nI'm interested in this use case. Please contact me to discuss further.\n\nThank you.";

  const gmailUrl =
    `https://mail.google.com/mail/?view=cm&fs=1&tf=1` +
    `&to=${encodeURIComponent(contactEmail)}` +
    `&su=${encodeURIComponent(safeSubject)}` +
    `&body=${encodeURIComponent(safeBody)}`;

  window.open(gmailUrl, "_blank");
}
