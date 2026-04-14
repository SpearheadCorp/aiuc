import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Security, LoginCallback, useOktaAuth } from "@okta/okta-react";
import { toRelativeUrl, OktaAuth } from "@okta/okta-auth-js";
import { createOktaAuth } from "./config/okta";
import App from "./App.tsx";
import "./globals.css";

function RequiredAuth({ children }: { children: React.ReactNode }) {
    const { oktaAuth: auth, authState } = useOktaAuth();

    useEffect(() => {
        if (!authState) return;
        if (!authState.isAuthenticated) {
            const originalUri = toRelativeUrl(window.location.href, window.location.origin);
            auth.setOriginalUri(originalUri);
            auth.signInWithRedirect();
        }
    }, [authState, auth]);

    if (!authState || !authState.isAuthenticated) return null;
    return <>{children}</>;
}

function AppWithOkta({ oktaAuth }: { oktaAuth: OktaAuth }) {
    const navigate = useNavigate();

    const restoreOriginalUri = async (
        _oktaAuth: unknown,
        originalUri: string
    ) => {
        navigate(originalUri || "/", { replace: true });
    };

    return (
        <Security oktaAuth={oktaAuth} restoreOriginalUri={restoreOriginalUri}>
            <Routes>
                <Route path="/login/callback" element={<LoginCallback />} />
                <Route path="*" element={<RequiredAuth><App /></RequiredAuth>} />
            </Routes>
        </Security>
    );
}

function Root() {
    const [oktaAuth, setOktaAuth] = useState<OktaAuth | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        createOktaAuth()
            .then(setOktaAuth)
            .catch((err) => {
                console.error("Failed to initialize Okta:", err);
                setError("Failed to load authentication configuration. Please try again later.");
            });
    }, []);

    if (error) return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100vh", fontFamily: "sans-serif", padding: "24px",
        }}>
            <div style={{ textAlign: "center", maxWidth: 400 }}>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#c62828", marginBottom: 12 }}>
                    Unable to load
                </div>
                <div style={{ color: "#555", fontSize: "0.95rem" }}>{error}</div>
            </div>
        </div>
    );
    if (!oktaAuth) return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100vh", fontFamily: "sans-serif", color: "#555",
        }}>
            Loading…
        </div>
    );

    return (
        <BrowserRouter>
            <AppWithOkta oktaAuth={oktaAuth} />
        </BrowserRouter>
    );
}

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Root />
    </StrictMode>
);
