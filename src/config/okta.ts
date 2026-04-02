import { OktaAuth } from "@okta/okta-auth-js";

export async function createOktaAuth(): Promise<OktaAuth> {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const response = await fetch(`${base}/api/okta-config`);
    if (!response.ok) {
        throw new Error("Failed to load authentication configuration");
    }
    const { issuer, clientId, redirectUri } = await response.json();

    return new OktaAuth({
        issuer,
        clientId,
        redirectUri: redirectUri || `${window.location.origin}/callback`,
        scopes: ["openid", "profile", "email"],
        pkce: true,
        restoreOriginalUri: undefined,
    });
}
