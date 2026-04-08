import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
    AuthenticationDetails,
    CognitoUser,
    CognitoUserAttribute,
} from "amazon-cognito-identity-js";
import type { ISignUpResult } from "amazon-cognito-identity-js";
import {
    Box,
    Button,
    CircularProgress,
    CssBaseline,
    IconButton,
    InputAdornment,
    Link,
    Paper,
    TextField,
    Typography,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { ThemeProvider } from "@mui/material/styles";
import { theme, PURE_ORANGE } from "../theme";
import Logo from "./Logo";
import { userPool } from "../config/cognito";
import { useLogger } from "../hooks/useLogger";

// ─── Types ────────────────────────────────────────────────────────────────────

// Which screen is shown
type Screen = "form" | "blocked" | "pending" | "verify" | "success";

// ─── Email validation (frontend) ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string): string | null {
    if (!email) return "Email is required.";
    if (!EMAIL_RE.test(email)) return "Enter a valid email address.";
    return null;
}

function validatePassword(password: string): string | null {
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(password)) return "Must include at least one uppercase letter.";
    if (!/[a-z]/.test(password)) return "Must include at least one lowercase letter.";
    if (!/[0-9]/.test(password)) return "Must include at least one number.";
    if (!/[^A-Za-z0-9]/.test(password)) return "Must include at least one special character.";
    return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap userPool.signUp in a Promise */
function cognitoSignUp(
    email: string,
    password: string,
    name: string
): Promise<ISignUpResult> {
    return new Promise((resolve, reject) => {
        const attributes = [
            new CognitoUserAttribute({ Name: "email", Value: email }),
            new CognitoUserAttribute({ Name: "name", Value: name }),
        ];
        if (!userPool) { reject(new Error("Cognito is not configured")); return; }
        userPool.signUp(email, password, attributes, [], (err, result) => {
            if (err || !result) {
                reject(err ?? new Error("signUp returned no result"));
            } else {
                resolve(result);
            }
        });
    });
}

/** Wrap cognitoUser.confirmRegistration in a Promise */
function cognitoConfirm(cognitoUser: CognitoUser, code: string): Promise<void> {
    return new Promise((resolve, reject) => {
        cognitoUser.confirmRegistration(code, true, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

/** Sign in after confirmation so App.tsx can detect a valid Cognito session */
function cognitoSignIn(email: string, password: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!userPool) { reject(new Error("Cognito is not configured")); return; }
        const user = new CognitoUser({ Username: email, Pool: userPool });
        const authDetails = new AuthenticationDetails({ Username: email, Password: password });
        user.authenticateUser(authDetails, {
            onSuccess: () => resolve(),
            onFailure: (err) => reject(err),
        });
    });
}

// ─── Shared layout wrapper (must be outside RegisterForm to avoid remount on every render) ───

function PageWrapper({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                    backgroundColor: "#fafafa",
                }}
            >
                <Paper sx={{ p: 5, maxWidth: 460, width: "100%" }}>
                    <Box sx={{ mb: 3, display: "flex", justifyContent: "center" }}>
                        <Logo
                            src="/assets/spearhead.png"
                            alt="Spearhead"
                            width={200}
                            height={40}
                            fallbackText="SPEARHEAD"
                        />
                    </Box>
                    {children}
                </Paper>
            </Box>
        </ThemeProvider>
    );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RegisterForm() {
    const { logRegister } = useLogger();
    const [searchParams] = useSearchParams();

    // ── Form fields
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [verifyCode, setVerifyCode] = useState("");

    // ── UI state
    const [screen, setScreen] = useState<Screen>("form");
    const [loading, setLoading] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<{
        email?: string;
        password?: string;
    }>({});
    const [serverError, setServerError] = useState("");

    // Persists the CognitoUser between signUp and confirmRegistration steps
    const cognitoUserRef = useRef<CognitoUser | null>(null);

    // ── Read approval token from URL (?token=...) and pre-fill email/name ──────
    const approvalToken = searchParams.get("token") || "";
    useEffect(() => {
        if (!approvalToken) return;
        try {
            // Token is base64url(JSON).sig — decode the payload part to pre-fill fields
            const payloadPart = approvalToken.split(".").slice(0, -1).join(".");
            const data = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/")));
            if (data.email) setEmail(data.email);
            if (data.name)  setName(data.name);
        } catch { /* ignore decode errors */ }
    }, [approvalToken]);

    // ── Step 1: Domain validation + Cognito signUp ────────────────────────────
    const handleFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setServerError("");

        // Frontend validation
        const emailErr = validateEmail(email.trim());
        const passErr = validatePassword(password);
        if (emailErr || passErr) {
            setFieldErrors({ email: emailErr ?? undefined, password: passErr ?? undefined });
            return;
        }
        setFieldErrors({});
        setLoading(true);

        try {
            // 1. Domain validation (existing Lambda route — untouched)
            const res = await fetch("/api/validate-email", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email.trim(), name: name.trim(), ...(approvalToken ? { token: approvalToken } : {}) }),
            });
            const data = await res.json();

            if (!res.ok) {
                setServerError(data.error || "Validation failed. Please try again.");
                setLoading(false);
                return;
            }

            if (!data.allowed) {
                setScreen("blocked");
                setLoading(false);
                return;
            }

            if (data.pendingApproval) {
                setScreen("pending");
                setLoading(false);
                return;
            }

            // 2. Domain is whitelisted — call Cognito signUp
            const result = await cognitoSignUp(email.trim(), password, name.trim());
            cognitoUserRef.current = result.user;

            setScreen("verify");
        } catch (err: unknown) {
            const code = (err as { code?: string }).code;
            if (code === "UsernameExistsException") {
                setServerError("An account with this email already exists. Please use a different email or contact support.");
            } else {
                const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
                setServerError(msg);
            }
        } finally {
            setLoading(false);
        }
    };

    // ── Step 2: Confirm verification code ────────────────────────────────────
    const handleVerifySubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setServerError("");

        if (!verifyCode.trim()) {
            setServerError("Please enter the verification code.");
            return;
        }

        if (!cognitoUserRef.current) {
            setServerError("Session expired. Please start over.");
            setScreen("form");
            return;
        }

        setLoading(true);
        try {
            await cognitoConfirm(cognitoUserRef.current, verifyCode.trim());
            // Sign in immediately so App.tsx detects a valid Cognito session
            await cognitoSignIn(email.trim(), password);
            logRegister({ email: email.trim(), name: name.trim() });
            setScreen("success");
            // Full reload so App.tsx remounts and re-checks the Cognito session
            setTimeout(() => { window.location.replace("/"); }, 1200);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Invalid code. Please try again.";
            setServerError(msg);
        } finally {
            setLoading(false);
        }
    };

    // ── Screen: personal email blocked ────────────────────────────────────────
    if (screen === "blocked") {
        return (
            <PageWrapper>
                <InfoBox
                    title="Work Email Required"
                    message="Personal email addresses (Gmail, Yahoo, Outlook, etc.) are not allowed. Please use your corporate work email."
                />
                <Button
                    fullWidth
                    variant="outlined"
                    sx={{ mt: 2, textTransform: "none" }}
                    onClick={() => {
                        setEmail("");
                        setScreen("form");
                    }}
                >
                    Try a Different Email
                </Button>
            </PageWrapper>
        );
    }

    // ── Screen: approval pending ──────────────────────────────────────────────
    if (screen === "pending") {
        return (
            <PageWrapper>
                <InfoBox
                    title="Registration Pending Approval"
                    message="Your request has been received. Our team has been notified and will review your access. You will receive an email once approved."
                />
            </PageWrapper>
        );
    }

    // ── Screen: registration confirmed ───────────────────────────────────────
    if (screen === "success") {
        return (
            <PageWrapper>
                <InfoBox
                    title="Registration Complete!"
                    message="Your account has been verified. Redirecting to the dashboard..."
                    color="#2e7d32"
                    bgColor="#f0fdf4"
                    borderColor="#a5d6a7"
                />
            </PageWrapper>
        );
    }

    // ── Screen: verification code entry ──────────────────────────────────────
    if (screen === "verify") {
        return (
            <PageWrapper>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Check Your Email
                </Typography>
                <Typography variant="body2" sx={{ color: "#666", mb: 3 }}>
                    A verification code was sent to <strong>{email}</strong>. Enter it below to confirm your account.
                </Typography>

                <Box component="form" onSubmit={handleVerifySubmit} noValidate>
                    <TextField
                        label="Verification Code"
                        fullWidth
                        required
                        value={verifyCode}
                        onChange={(e) => {
                            setVerifyCode(e.target.value);
                            setServerError("");
                        }}
                        disabled={loading}
                        inputProps={{ inputMode: "numeric", maxLength: 10 }}
                        sx={{ mb: 1 }}
                        size="small"
                        autoFocus
                    />

                    {serverError && (
                        <Typography variant="body2" sx={{ color: "error.main", mb: 1 }}>
                            {serverError}
                        </Typography>
                    )}

                    <SubmitButton loading={loading} label="Confirm Account" />
                </Box>

                <Typography
                    variant="caption"
                    sx={{ display: "block", mt: 2, color: "#999", textAlign: "center" }}
                >
                    Didn&apos;t receive the email? Check your spam folder.
                </Typography>
            </PageWrapper>
        );
    }

    // ── Screen: registration form (default) ───────────────────────────────────
    return (
        <PageWrapper>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                {approvalToken ? "Complete Your Registration" : "Request Access"}
            </Typography>
            <Typography variant="body2" sx={{ color: "#666", mb: approvalToken ? 1.5 : 3 }}>
                {approvalToken
                    ? "Your access has been approved. Set a password to finish creating your account."
                    : "AI Use Case Repository — create your account with a work email."}
            </Typography>
            {approvalToken && (
                <Box sx={{ mb: 2, p: 1.5, borderRadius: 1, backgroundColor: "#f0fdf4", border: "1px solid #a5d6a7" }}>
                    <Typography variant="body2" sx={{ color: "#2e7d32", fontSize: "0.8rem" }}>
                        ✓ Access approved — your email is pre-filled and locked.
                    </Typography>
                </Box>
            )}

            <Box component="form" onSubmit={handleFormSubmit} noValidate>
                <TextField
                    label="Full Name"
                    type="text"
                    fullWidth
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={loading}
                    sx={{ mb: 2 }}
                    size="small"
                />

                <TextField
                    label="Work Email"
                    type="email"
                    fullWidth
                    required
                    value={email}
                    onChange={(e) => {
                        if (approvalToken) return; // locked when approved via token
                        setEmail(e.target.value);
                        if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                    }}
                    disabled={loading || !!approvalToken}
                    error={!!fieldErrors.email}
                    helperText={fieldErrors.email}
                    sx={{ mb: 2 }}
                    size="small"
                />

                <TextField
                    label="Password"
                    type={showPassword ? "text" : "password"}
                    fullWidth
                    required
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                    }}
                    disabled={loading}
                    error={!!fieldErrors.password}
                    helperText={
                        fieldErrors.password ??
                        "Min 8 chars, uppercase, lowercase, number & special character."
                    }
                    sx={{ mb: 1 }}
                    size="small"
                    InputProps={{
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="toggle password visibility"
                                    onClick={() => setShowPassword((v) => !v)}
                                    edge="end"
                                    size="small"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />

                {serverError && (
                    <Typography variant="body2" sx={{ color: "error.main", mb: 1 }}>
                        {serverError}
                    </Typography>
                )}

                <SubmitButton loading={loading} label="Create Account" disabled={!email || !name || !password} />
            </Box>

            <Typography
                variant="body2"
                sx={{ mt: 3, textAlign: "center", color: "#666" }}
            >
                Already registered?{" "}
                <Link
                    href="/login"
                    underline="hover"
                    sx={{ color: PURE_ORANGE, fontWeight: 500 }}
                >
                    Sign in
                </Link>
            </Typography>

            <Typography
                variant="caption"
                sx={{ display: "block", mt: 1.5, color: "#999", textAlign: "center" }}
            >
                Confidential — Internal Use Only
            </Typography>
        </PageWrapper>
    );
}

// ─── Small reusable sub-components (local, not exported) ─────────────────────

function InfoBox({
    title,
    message,
    color = "#7c4700",
    bgColor = "#fff5f2",
    borderColor = PURE_ORANGE,
}: {
    title: string;
    message: string;
    color?: string;
    bgColor?: string;
    borderColor?: string;
}) {
    return (
        <Box
            sx={{
                p: 2,
                borderRadius: 1,
                backgroundColor: bgColor,
                border: `1px solid ${borderColor}`,
                textAlign: "center",
            }}
        >
            <Typography variant="body1" sx={{ fontWeight: 600, color }}>
                {title}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1, color: "#555" }}>
                {message}
            </Typography>
        </Box>
    );
}

function SubmitButton({
    loading,
    label,
    disabled,
}: {
    loading: boolean;
    label: string;
    disabled?: boolean;
}) {
    return (
        <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={loading || disabled}
            sx={{
                mt: 1,
                backgroundColor: PURE_ORANGE,
                "&:hover": { backgroundColor: "#1a6bbf" },
                "&:disabled": { backgroundColor: "#a8cff8" },
                textTransform: "none",
                fontWeight: 600,
                height: 40,
            }}
        >
            {loading ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : label}
        </Button>
    );
}
