/**
 * core/ai_toggle.mjs
 * ENABLE_AI_SEARCH feature flag.
 *
 * Set ENABLE_AI_SEARCH=false in the Lambda environment variables to force
 * keyword-only search for all deployments that import this module.
 * Any value other than the string "false" keeps AI search enabled.
 *
 * Both PureStorage and Spearhead import this flag — per-deployment overrides
 * are controlled via their respective Lambda environment variable, not here.
 */

/**
 * True when AI (semantic vector) search is enabled.
 * False when ENABLE_AI_SEARCH env var is explicitly set to "false".
 */
export const ENABLE_AI_SEARCH = process.env.ENABLE_AI_SEARCH !== "false";
