/**
 * core/api_handlers.mjs
 * Shared route logic for POST /api/search and POST /api/search/industry.
 *
 * Both PureStorage and Spearhead import from this module — do NOT duplicate
 * this logic in client-specific Lambda handlers.
 *
 * Each handler accepts injected AWS clients and S3 config so that each
 * deployment can point at its own bucket and embeddings files.
 */

import { getEmbedding } from "./embeddings.mjs";
import { loadSearchIndex, runVectorSearch, runKeywordSearch, USE_CASE_FIELDS, INDUSTRY_FIELDS } from "./search.mjs";
import { generateExplanations, FALLBACK_WHY } from "./why_matched.mjs";
import { ENABLE_AI_SEARCH } from "./ai_toggle.mjs";

/**
 * Handle POST /api/search — semantic use-case search with keyword fallback.
 *
 * @param {object} opts
 * @param {string}   opts.query                - User's natural-language search query
 * @param {number}   opts.limit                - Requested result count (clamped to 1–15)
 * @param {import("@aws-sdk/client-s3").S3Client} opts.s3Client
 * @param {string}   opts.bucket               - S3 bucket containing the embeddings file
 * @param {string}   opts.embeddingsKey        - S3 key for use-case embeddings JSON
 * @param {import("@aws-sdk/client-bedrock-runtime").BedrockRuntimeClient} opts.bedrockClient
 * @returns {Promise<{ results: Array<{ useCase: object, score: number, whyMatched: string }> }>}
 */
export async function handleUseCaseSearch({ query, limit, s3Client, bucket, embeddingsKey, bedrockClient }) {
    const queryText = query.trim().slice(0, 1000);
    const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 15);

    const { index, meta } = await loadSearchIndex(s3Client, bucket, embeddingsKey, "useCase", "[SearchIndex]");

    let results;
    let searchMode;

    if (ENABLE_AI_SEARCH) {
        try {
            const queryVec = await getEmbedding(queryText, bedrockClient);
            results = runVectorSearch(index, meta, queryVec, safeLimit);
            searchMode = "vector";
        } catch (err) {
            console.warn(`[Search] embedding failed → keyword fallback: ${err.message}`);
            results = runKeywordSearch(queryText, meta, USE_CASE_FIELDS, safeLimit);
            searchMode = "keyword-fallback";
        }
    } else {
        results = runKeywordSearch(queryText, meta, USE_CASE_FIELDS, safeLimit);
        searchMode = "keyword";
    }

    const useCases = results.map(r => r.data);
    const explanations = await generateExplanations(
        queryText,
        useCases,
        uc => `"${uc.ai_use_case || ""}" — ${uc.business_function || ""} / ${uc.business_capability || ""}: ${uc.action_implementation || ""}`,
        bedrockClient
    );

    console.log(`[Search] mode=${searchMode} results=${results.length} query="${queryText.slice(0, 60)}"`);
    return {
        results: results.map((r, i) => ({
            useCase: r.data,
            score: r.score,
            whyMatched: explanations[i] || FALLBACK_WHY,
        })),
    };
}

/**
 * Handle POST /api/search/industry — semantic industry use-case search with keyword fallback.
 *
 * @param {object} opts
 * @param {string}   opts.query                   - User's natural-language search query
 * @param {number}   opts.limit                   - Requested result count (clamped to 1–15)
 * @param {import("@aws-sdk/client-s3").S3Client} opts.s3Client
 * @param {string}   opts.bucket                  - S3 bucket containing the embeddings file
 * @param {string}   opts.industryEmbeddingsKey   - S3 key for industry embeddings JSON
 * @param {import("@aws-sdk/client-bedrock-runtime").BedrockRuntimeClient} opts.bedrockClient
 * @returns {Promise<{ results: Array<{ item: object, score: number, whyMatched: string }> }>}
 */
export async function handleIndustrySearch({ query, limit, s3Client, bucket, industryEmbeddingsKey, bedrockClient }) {
    const queryText = query.trim().slice(0, 1000);
    const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 15);

    const { index, meta } = await loadSearchIndex(s3Client, bucket, industryEmbeddingsKey, "item", "[IndustrySearchIndex]");

    let results;
    let searchMode;

    if (ENABLE_AI_SEARCH) {
        try {
            const queryVec = await getEmbedding(queryText, bedrockClient);
            results = runVectorSearch(index, meta, queryVec, safeLimit);
            searchMode = "vector";
        } catch (err) {
            console.warn(`[IndustrySearch] embedding failed → keyword fallback: ${err.message}`);
            results = runKeywordSearch(queryText, meta, INDUSTRY_FIELDS, safeLimit);
            searchMode = "keyword-fallback";
        }
    } else {
        results = runKeywordSearch(queryText, meta, INDUSTRY_FIELDS, safeLimit);
        searchMode = "keyword";
    }

    const items = results.map(r => r.data);
    const explanations = await generateExplanations(
        queryText,
        items,
        item => `"${item.ai_use_case || ""}" — ${item.industry || ""} / ${item.business_function || ""}: ${item.description || ""}`,
        bedrockClient
    );

    console.log(`[IndustrySearch] mode=${searchMode} results=${results.length} query="${queryText.slice(0, 60)}"`);
    return {
        results: results.map((r, i) => ({
            item: r.data,
            score: r.score,
            whyMatched: explanations[i] || FALLBACK_WHY,
        })),
    };
}
