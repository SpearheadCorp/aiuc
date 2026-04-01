import { OktaAuth } from "@okta/okta-auth-js";

const OKTA_ISSUER = import.meta.env.VITE_OKTA_ISSUER || "";
const OKTA_CLIENT_ID = import.meta.env.VITE_OKTA_CLIENT_ID || "";
const REDIRECT_URI = `${window.location.origin}/login/callback`;

export const oktaAuth = new OktaAuth({
    issuer: OKTA_ISSUER,
    clientId: OKTA_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scopes: ["openid", "profile", "email"],
    pkce: true,
    restoreOriginalUri: undefined,
});
