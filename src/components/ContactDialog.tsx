import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";

const PURE_ORANGE = "#fe5000";

interface ContactDialogProps {
  open: boolean;
  onClose: () => void;
  userEmail: string;
  subject: string;
  contactEmail: string;
}

export default function ContactDialog({
  open,
  onClose,
  userEmail,
  subject,
  contactEmail,
}: ContactDialogProps) {
  const [fromEmail, setFromEmail] = useState(userEmail);
  const [subjectLine, setSubjectLine] = useState(subject);
  const [message, setMessage] = useState(
    "Hi,\n\nI'm interested in this use case. Please contact me to discuss further.\n\nThank you."
  );
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Reset form when dialog opens with new props
  const handleEnter = () => {
    setFromEmail(userEmail);
    setSubjectLine(subject);
    setMessage(
      "Hi,\n\nI'm interested in this use case. Please contact me to discuss further.\n\nThank you."
    );
    setResult(null);
    setSending(false);
  };

  const handleSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: fromEmail,
          subject: subjectLine,
          message,
        }),
      });
      if (!response.ok) {
        // Parse the JSON body to surface the real server error message
        const errBody = await response.json().catch(() => ({}));
        throw new Error(
          errBody.error || `Failed to send (HTTP ${response.status})`
        );
      }
      setResult({ type: "success", text: "Your message has been sent successfully!" });
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setResult({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to send message",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{ onEnter: handleEnter }}
      PaperProps={{
        sx: {
          borderRadius: "10px",
          borderTop: `3px solid ${PURE_ORANGE}`,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: "1.1rem" }}>
          I'm Interested — Contact Me
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            label="From (your email)"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            size="small"
            fullWidth
            InputProps={{ readOnly: !!userEmail }}
            sx={{
              "& .MuiOutlinedInput-root": {
                "&.Mui-focused fieldset": {
                  borderColor: PURE_ORANGE,
                },
              },
              "& .MuiInputLabel-root.Mui-focused": {
                color: PURE_ORANGE,
              },
            }}
          />

          <Typography variant="body2" sx={{ color: "#666" }}>
            To: <strong>{contactEmail}</strong>
          </Typography>

          <TextField
            label="Subject"
            value={subjectLine}
            onChange={(e) => setSubjectLine(e.target.value)}
            size="small"
            fullWidth
            sx={{
              "& .MuiOutlinedInput-root": {
                "&.Mui-focused fieldset": {
                  borderColor: PURE_ORANGE,
                },
              },
              "& .MuiInputLabel-root.Mui-focused": {
                color: PURE_ORANGE,
              },
            }}
          />

          <TextField
            label="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            multiline
            rows={5}
            fullWidth
            sx={{
              "& .MuiOutlinedInput-root": {
                "&.Mui-focused fieldset": {
                  borderColor: PURE_ORANGE,
                },
              },
              "& .MuiInputLabel-root.Mui-focused": {
                color: PURE_ORANGE,
              },
            }}
          />

          {result && (
            <Alert
              severity={result.type}
              sx={{
                ...(result.type === "error" && {
                  backgroundColor: "#fff5f2",
                  borderLeft: `4px solid ${PURE_ORANGE}`,
                }),
              }}
            >
              {result.text}
            </Alert>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={onClose}
          sx={{
            color: "#666",
            "&:hover": { backgroundColor: "#f5f5f5" },
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={sending || !fromEmail || !subjectLine}
          startIcon={sending ? <CircularProgress size={16} /> : <SendIcon />}
          sx={{
            backgroundColor: PURE_ORANGE,
            "&:hover": { backgroundColor: "#cc4000" },
            "&.Mui-disabled": { backgroundColor: "#ccc" },
          }}
        >
          {sending ? "Sending..." : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
