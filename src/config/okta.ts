import { OktaAuth } from "@okta/okta-auth-js";

export async function createOktaAuth(): Promise<OktaAuth> {
    const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
    const response = await fetch(`${base}/api/okta-config`);
    if (!response.ok) {
        throw new Error(`Failed to load authentication configuration (HTTP ${response.status})`);
    }

    const config = await response.json();
    const { issuer, clientId, redirectUri } = config;

    if (!issuer || !clientId) {
        throw new Error("Okta configuration is incomplete: missing issuer or clientId");
    }

    return new OktaAuth({
        issuer,
        clientId,
        redirectUri: redirectUri || `${window.location.origin}/login/callback`,
        scopes: ["openid", "profile", "email"],
        pkce: true,
        restoreOriginalUri: undefined,
    });
}
