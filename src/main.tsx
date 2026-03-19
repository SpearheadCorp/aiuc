import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Security, LoginCallback } from "@okta/okta-react";
import { OktaAuth } from "@okta/okta-auth-js";
import { CircularProgress, Box, ThemeProvider, CssBaseline, Typography } from "@mui/material";
import { theme, PURE_ORANGE } from "./theme";
import App from "./App.tsx";
import "./globals.css";

function AppWithOkta() {
    const navigate = useNavigate();
    const [oktaAuth, setOktaAuth] = useState<OktaAuth | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch("/api/config");
                if (!res.ok) {
                    throw new Error("Failed to fetch Okta configuration");
                }
                const data = await res.json();
                
                const auth = new OktaAuth({
                    issuer: data.issuer,
                    clientId: data.clientId,
                    redirectUri: `${window.location.origin}/login/callback`,
                    scopes: ["openid", "profile", "email"],
                    pkce: true,
                });
                
                setOktaAuth(auth);
            } catch (err) {
                console.error(err);
                setError(err instanceof Error ? err.message : "Initialization error");
            }
        };

        fetchConfig();
    }, []);

    const restoreOriginalUri = async (
        _oktaAuth: unknown,
        originalUri: string
    ) => {
        navigate(originalUri || "/", { replace: true });
    };

    if (error) {
        return (
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
                    <Typography color="error">Error loading configuration: {error}</Typography>
                </Box>
            </ThemeProvider>
        );
    }

    if (!oktaAuth) {
        return (
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                    gap: 2,
                    backgroundColor: "#fafafa",
                  }}
                >
                    <CircularProgress sx={{ color: PURE_ORANGE }} />
                    <Typography variant="body2" sx={{ color: "#666" }}>
                        Loading configuration...
                    </Typography>
                </Box>
            </ThemeProvider>
        );
    }

    return (
        <Security oktaAuth={oktaAuth} restoreOriginalUri={restoreOriginalUri}>
            <Routes>
                <Route path="/login/callback" element={<LoginCallback />} />
                <Route path="*" element={<App />} />
            </Routes>
        </Security>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <AppWithOkta />
        </BrowserRouter>
    </StrictMode>
);
