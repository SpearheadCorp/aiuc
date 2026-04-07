import { useState } from "react";
import { CognitoUser } from "amazon-cognito-identity-js";
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

type Screen = "email" | "reset" | "success";

function sendForgotPassword(email: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!userPool) { reject(new Error("Cognito is not configured")); return; }
        const user = new CognitoUser({ Username: email, Pool: userPool });
        user.forgotPassword({
            onSuccess: () => resolve(),
            onFailure: (err) => reject(err),
        });
    });
}

function confirmNewPassword(email: string, code: string, newPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!userPool) { reject(new Error("Cognito is not configured")); return; }
        const user = new CognitoUser({ Username: email, Pool: userPool });
        user.confirmPassword(code, newPassword, {
            onSuccess: () => resolve(),
            onFailure: (err) => reject(err),
        });
    });
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

export default function ForgotPasswordForm() {
    const [screen, setScreen] = useState<Screen>("email");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [passwordError, setPasswordError] = useState("");

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        if (!email.trim()) { setError("Email is required."); return; }
        setLoading(true);
        try {
            await sendForgotPassword(email.trim());
            setScreen("reset");
        } catch (err: unknown) {
            const errCode = (err as { code?: string }).code;
            if (errCode === "UserNotFoundException") {
                setError("No account found with this email address.");
            } else if (errCode === "LimitExceededException") {
                setError("Too many requests. Please wait a few minutes and try again.");
            } else {
                setError(err instanceof Error ? err.message : "Failed to send reset code. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        if (!code.trim()) { setError("Please enter the verification code."); return; }
        const passErr = validatePassword(newPassword);
        if (passErr) { setPasswordError(passErr); return; }
        setPasswordError("");
        setLoading(true);
        try {
            await confirmNewPassword(email.trim(), code.trim(), newPassword);
            setScreen("success");
        } catch (err: unknown) {
            const errCode = (err as { code?: string }).code;
            if (errCode === "CodeMismatchException") {
                setError("Invalid verification code. Please try again.");
            } else if (errCode === "ExpiredCodeException") {
                setError("Code has expired. Please request a new one.");
            } else {
                setError(err instanceof Error ? err.message : "Failed to reset password. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

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
                            src="/assets/purelogo.png"
                            alt="Pure Storage"
                            width={200}
                            height={40}
                            fallbackText="PURESTORAGE"
                        />
                    </Box>

                    {/* ── Screen: enter email ── */}
                    {screen === "email" && (
                        <>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                                Reset Password
                            </Typography>
                            <Typography variant="body2" sx={{ color: "#666", mb: 3 }}>
                                Enter your work email and we'll send a verification code to reset your password.
                            </Typography>
                            <Box component="form" onSubmit={handleSendCode} noValidate>
                                <TextField
                                    label="Work Email"
                                    type="email"
                                    fullWidth
                                    required
                                    value={email}
                                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                                    disabled={loading}
                                    sx={{ mb: 1 }}
                                    size="small"
                                    autoFocus
                                />
                                {error && (
                                    <Typography variant="body2" sx={{ color: "error.main", mb: 1 }}>
                                        {error}
                                    </Typography>
                                )}
                                <Button
                                    type="submit"
                                    variant="contained"
                                    fullWidth
                                    disabled={loading || !email}
                                    sx={{
                                        mt: 1,
                                        backgroundColor: PURE_ORANGE,
                                        "&:hover": { backgroundColor: "#cc4000" },
                                        "&:disabled": { backgroundColor: "#ffb899" },
                                        textTransform: "none",
                                        fontWeight: 600,
                                        height: 40,
                                    }}
                                >
                                    {loading ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Send Reset Code"}
                                </Button>
                            </Box>
                        </>
                    )}

                    {/* ── Screen: enter code + new password ── */}
                    {screen === "reset" && (
                        <>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                                Enter New Password
                            </Typography>
                            <Typography variant="body2" sx={{ color: "#666", mb: 3 }}>
                                A verification code was sent to <strong>{email}</strong>. Enter it below along with your new password.
                            </Typography>
                            <Box component="form" onSubmit={handleResetPassword} noValidate>
                                <TextField
                                    label="Verification Code"
                                    fullWidth
                                    required
                                    value={code}
                                    onChange={(e) => { setCode(e.target.value); setError(""); }}
                                    disabled={loading}
                                    inputProps={{ inputMode: "numeric", maxLength: 10 }}
                                    sx={{ mb: 2 }}
                                    size="small"
                                    autoFocus
                                />
                                <TextField
                                    label="New Password"
                                    type={showPassword ? "text" : "password"}
                                    fullWidth
                                    required
                                    value={newPassword}
                                    onChange={(e) => { setNewPassword(e.target.value); setPasswordError(""); }}
                                    disabled={loading}
                                    error={!!passwordError}
                                    helperText={passwordError ?? "Min 8 chars, uppercase, lowercase, number & special character."}
                                    sx={{ mb: 1 }}
                                    size="small"
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
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
                                {error && (
                                    <Typography variant="body2" sx={{ color: "error.main", mb: 1 }}>
                                        {error}
                                    </Typography>
                                )}
                                <Button
                                    type="submit"
                                    variant="contained"
                                    fullWidth
                                    disabled={loading || !code || !newPassword}
                                    sx={{
                                        mt: 1,
                                        backgroundColor: PURE_ORANGE,
                                        "&:hover": { backgroundColor: "#cc4000" },
                                        "&:disabled": { backgroundColor: "#ffb899" },
                                        textTransform: "none",
                                        fontWeight: 600,
                                        height: 40,
                                    }}
                                >
                                    {loading ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Reset Password"}
                                </Button>
                                <Typography
                                    variant="caption"
                                    sx={{ display: "block", mt: 2, color: "#999", textAlign: "center" }}
                                >
                                    Didn&apos;t receive the code? Check your spam folder or{" "}
                                    <Link
                                        component="button"
                                        variant="caption"
                                        onClick={() => { setScreen("email"); setCode(""); setNewPassword(""); setError(""); }}
                                        sx={{ color: PURE_ORANGE }}
                                    >
                                        request a new one
                                    </Link>.
                                </Typography>
                            </Box>
                        </>
                    )}

                    {/* ── Screen: success ── */}
                    {screen === "success" && (
                        <>
                            <Box
                                sx={{
                                    p: 2,
                                    borderRadius: 1,
                                    backgroundColor: "#f0fdf4",
                                    border: "1px solid #a5d6a7",
                                    textAlign: "center",
                                    mb: 3,
                                }}
                            >
                                <Typography variant="body1" sx={{ fontWeight: 600, color: "#2e7d32" }}>
                                    Password Reset Successful!
                                </Typography>
                                <Typography variant="body2" sx={{ mt: 1, color: "#555" }}>
                                    Your password has been updated. You can now sign in with your new password.
                                </Typography>
                            </Box>
                            <Button
                                component="a"
                                href="/login"
                                variant="contained"
                                fullWidth
                                sx={{
                                    backgroundColor: PURE_ORANGE,
                                    "&:hover": { backgroundColor: "#cc4000" },
                                    textTransform: "none",
                                    fontWeight: 600,
                                    height: 40,
                                }}
                            >
                                Go to Sign In
                            </Button>
                        </>
                    )}

                    {screen !== "success" && (
                        <Typography
                            variant="body2"
                            sx={{ mt: 3, textAlign: "center", color: "#666" }}
                        >
                            Remember your password?{" "}
                            <Link href="/login" underline="hover" sx={{ color: PURE_ORANGE, fontWeight: 500 }}>
                                Sign in
                            </Link>
                        </Typography>
                    )}

                    <Typography
                        variant="caption"
                        sx={{ display: "block", mt: 1.5, color: "#999", textAlign: "center" }}
                    >
                        Confidential — Internal Use Only
                    </Typography>
                </Paper>
            </Box>
        </ThemeProvider>
    );
}
