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
import { APP_CONFIG } from "../config/appConfig";
import { userPool } from "../config/cognito";

const PURE_ORANGE = "#2D89EF";

interface ContactDialogProps {
  open: boolean;
  onClose: () => void;
  userEmail: string;
  subject: string;
}

export default function ContactDialog({
  open,
  onClose,
  userEmail,
  subject,
}: ContactDialogProps) {
  const [fromEmail, setFromEmail] = useState(userEmail);
  const [subjectLine, setSubjectLine] = useState(subject);
  const [message, setMessage] = useState(APP_CONFIG.defaultContactMessage);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Reset form when dialog opens with new props
  const handleEnter = () => {
    setFromEmail(userEmail);
    setSubjectLine(subject);
    setMessage(APP_CONFIG.defaultContactMessage);
    setResult(null);
    setSending(false);
  };

  const getIdToken = (): Promise<string | null> =>
    new Promise((resolve) => {
      const user = userPool?.getCurrentUser();
      if (!user) { resolve(null); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      user.getSession((err: Error | null, session: any) => {
        if (err || !session?.isValid()) { resolve(null); return; }
        resolve(session.getIdToken().getJwtToken());
      });
    });

  const handleSend = async () => {
    setSending(true);
    setResult(null);
    try {
      const token = await getIdToken();
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          from: fromEmail,
          subject: subjectLine,
          message,
        }),
      });
      if (!response.ok) {
        throw new Error(`Failed to send: ${response.status}`);
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
          {APP_CONFIG.contactDialogTitle}
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
            To: <strong>{APP_CONFIG.contactEmail}</strong>
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
            "&:hover": { backgroundColor: "#1a6bbf" },
            "&.Mui-disabled": { backgroundColor: "#ccc" },
          }}
        >
          {sending ? "Sending..." : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
