import { useState } from "react";
import {
    AuthenticationDetails,
    CognitoUser,
} from "amazon-cognito-identity-js";
import {
    Box,
    Button,
    CircularProgress,
    CssBaseline,
    IconButton,
    InputAdornment,
    Paper,
    TextField,
    Typography,
    Link,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { ThemeProvider } from "@mui/material/styles";
import { theme, PURE_ORANGE } from "../theme";
import Logo from "./Logo";
import { userPool } from "../config/cognito";

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

export default function LoginForm() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!email.trim() || !password) {
            setError("Email and password are required.");
            return;
        }

        setLoading(true);
        try {
            await cognitoSignIn(email.trim(), password);
            window.location.replace("/");
        } catch (err: unknown) {
            const code = (err as { code?: string }).code;
            if (code === "NotAuthorizedException") {
                setError("Incorrect email or password. Please try again.");
            } else if (code === "UserNotFoundException") {
                setError("No account found with this email address.");
            } else if (code === "UserNotConfirmedException") {
                setError("Your account is not verified. Please complete registration first.");
            } else {
                setError(err instanceof Error ? err.message : "Sign in failed. Please try again.");
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

                    <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                        Sign In
                    </Typography>
                    <Typography variant="body2" sx={{ color: "#666", mb: 3 }}>
                        AI Use Case Repository — sign in with your registered account.
                    </Typography>

                    <Box component="form" onSubmit={handleSubmit} noValidate>
                        <TextField
                            label="Work Email"
                            type="email"
                            fullWidth
                            required
                            value={email}
                            onChange={(e) => { setEmail(e.target.value); setError(""); }}
                            disabled={loading}
                            sx={{ mb: 2 }}
                            size="small"
                            autoFocus
                        />

                        <TextField
                            label="Password"
                            type={showPassword ? "text" : "password"}
                            fullWidth
                            required
                            value={password}
                            onChange={(e) => { setPassword(e.target.value); setError(""); }}
                            disabled={loading}
                            sx={{ mb: 0.5 }}
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

                        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
                            <Link
                                href="/forgot-password"
                                underline="hover"
                                variant="caption"
                                sx={{ color: PURE_ORANGE }}
                            >
                                Forgot password?
                            </Link>
                        </Box>

                        {error && (
                            <Typography variant="body2" sx={{ color: "error.main", mb: 1 }}>
                                {error}
                            </Typography>
                        )}

                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            disabled={loading || !email || !password}
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
                            {loading ? <CircularProgress size={20} sx={{ color: "#fff" }} /> : "Sign In"}
                        </Button>
                    </Box>

                    <Typography
                        variant="body2"
                        sx={{ mt: 3, textAlign: "center", color: "#666" }}
                    >
                        Don&apos;t have an account?{" "}
                        <Link
                            href="/register"
                            underline="hover"
                            sx={{ color: PURE_ORANGE, fontWeight: 500 }}
                        >
                            Request Access
                        </Link>
                    </Typography>

                    <Typography
                        variant="caption"
                        sx={{ display: "block", mt: 2, color: "#999", textAlign: "center" }}
                    >
                        Confidential — Internal Use Only
                    </Typography>
                </Paper>
            </Box>
        </ThemeProvider>
    );
}
