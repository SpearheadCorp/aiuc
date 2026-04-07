import { CognitoUserPool } from "amazon-cognito-identity-js";

// ─────────────────────────────────────────────────────────────────────────────
// Cognito Configuration — edit ONLY this file when you have real credentials.
// All values are read from environment variables defined in the root .env file.
// ─────────────────────────────────────────────────────────────────────────────

// TODO: Replace with real value from AWS Console → Cognito → User Pools → Your Pool
// Format: us-east-1_XXXXXXXXX
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string;

// TODO: Replace with real value from AWS Console → Cognito → User Pools → App Clients
// Must be a PUBLIC client (no client secret) for browser-based apps
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string;

// TODO: Replace with real AWS region from AWS Console (e.g. "us-east-1", "us-west-2")
export const COGNITO_REGION = import.meta.env.VITE_AWS_REGION as string;

export const userPool = USER_POOL_ID && CLIENT_ID
    ? new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
    : null;
