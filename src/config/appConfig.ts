export const APP_CONFIG = {
  contactEmail: import.meta.env.VITE_CONTACT_EMAIL || "aiuc@spearhead.so",
  emailTooltipText: import.meta.env.VITE_EMAIL_TOOLTIP_TEXT || "I'm interested — contact me",
  contactDialogTitle: import.meta.env.VITE_CONTACT_DIALOG_TITLE || "I'm Interested — Contact Me",
  defaultContactMessage:
    import.meta.env.VITE_DEFAULT_CONTACT_MESSAGE ||
    "Hi,\nI'm interested in this use case. Please contact me to discuss further.\nThank you.",
} as const;
