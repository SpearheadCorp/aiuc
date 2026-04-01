import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Security, LoginCallback, useOktaAuth } from "@okta/okta-react";
import { toRelativeUrl } from "@okta/okta-auth-js";
import { oktaAuth } from "./config/okta";
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

function AppWithOkta() {
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

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <BrowserRouter>
            <AppWithOkta />
        </BrowserRouter>
    </StrictMode>
);
