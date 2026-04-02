import { OktaAuth } from "@okta/okta-auth-js";

export async function createOktaAuth(): Promise<OktaAuth> {
    const response = await fetch("/api/okta-config");
    if (!response.ok) {
        throw new Error("Failed to load authentication configuration");
    }
    const { issuer, clientId } = await response.json();

    return new OktaAuth({
        issuer,
        clientId,
        redirectUri: `${window.location.origin}/login/callback`,
        scopes: ["openid", "profile", "email"],
        pkce: true,
        restoreOriginalUri: undefined,
    });
}
