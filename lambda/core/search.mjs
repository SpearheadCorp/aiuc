/**
 * core/search.mjs
 * Shared vector search primitives: index creation, S3-backed index loading,
 * vector search, and keyword fallback search.
 *
 * Both PureStorage and Spearhead import from this module — do NOT duplicate
 * this logic in client-specific Lambda handlers.
 */

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { l2normalize } from "./embeddings.mjs";

// ── Pure-JS cosine similarity index ──────────────────────────────────────────
// Vectors must be L2-normalised before adding; inner product then equals cosine.
/**
 * Create an in-memory flat inner-product index (FlatIP).
 * @returns {{ add(vec: number[]): void, ntotal(): number, search(queryVec: number[], k: number): { labels: number[], distances: number[] } }}
 */
export function createFlatIPIndex() {
    const vectors = [];
    return {
        add(vec) { vectors.push(Float32Array.from(vec)); },
        ntotal() { return vectors.length; },
        search(queryVec, k) {
            const q = Float32Array.from(queryVec);
            const scores = vectors.map((v, idx) => {
                let dot = 0;
                for (let j = 0; j < v.length; j++) dot += v[j] * q[j];
                return { idx, score: dot };
            });
            scores.sort((a, b) => b.score - a.score);
            const top = scores.slice(0, k);
            return {
                labels: top.map(r => r.idx),
                distances: top.map(r => r.score),
            };
        },
    };
}

// ── Search index cache (keyed by "bucket/s3Key") ──────────────────────────────
// Shared across invocations within the same Lambda container or process.
const indexCache = new Map();

/**
 * Load a search index from an S3 embeddings JSON file, building an in-memory
 * FlatIP index. Results are cached by bucket+s3Key for subsequent invocations.
 *
 * The embeddings JSON must be an array of objects with shape:
 *   { [itemKey]: <data object>, embedding: number[] }
 *
 * @param {import("@aws-sdk/client-s3").S3Client} s3Client
 * @param {string} bucket - S3 bucket name
 * @param {string} s3Key - S3 object key for the embeddings JSON
 * @param {string} [itemKey="item"] - Key in each record that holds the item data
 * @param {string} [logPrefix="[SearchIndex]"] - Log prefix for identification
 * @returns {Promise<{ index: object, meta: object[] }>}
 */
export async function loadSearchIndex(s3Client, bucket, s3Key, itemKey = "item", logPrefix = "[SearchIndex]") {
    const cacheKey = `${bucket}/${s3Key}`;
    if (indexCache.has(cacheKey)) return indexCache.get(cacheKey);

    console.log(`${logPrefix} loading from s3://${bucket}/${s3Key}`);
    const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
    const response = await s3Client.send(command);
    const raw = JSON.parse(await response.Body.transformToString());

    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error(`${logPrefix} empty or invalid embeddings at s3://${bucket}/${s3Key}`);
    }

    const dim = raw[0].embedding.length;
    const index = createFlatIPIndex();
    const meta = raw.map(record => {
        index.add(l2normalize(record.embedding));
        return record[itemKey];
    });

    console.log(`${logPrefix} ready: ${index.ntotal()} vectors dim=${dim}`);
    const result = { index, meta };
    indexCache.set(cacheKey, result);
    return result;
}

// ── Field lists for keyword fallback search ───────────────────────────────────
export const USE_CASE_FIELDS = [
    "ai_use_case", "business_function", "business_capability",
    "action_implementation", "expected_outcomes_and_results",
    "stakeholder_or_user", "ai_tools_models",
];

export const INDUSTRY_FIELDS = [
    "ai_use_case", "industry", "business_function", "business_capability",
    "description", "implementation_plan", "ai_tools_platforms",
];

/**
 * Run a vector similarity search, returning top-K results sorted descending
 * by cosine similarity.
 *
 * @param {object} index - FlatIP index from createFlatIPIndex()
 * @param {object[]} meta - Metadata array parallel to the index vectors
 * @param {number[]} queryVec - Query embedding (L2-normalised before search)
 * @param {number} topK - Maximum number of results to return
 * @returns {{ data: object, score: number }[]}
 */
export function runVectorSearch(index, meta, queryVec, topK) {
    const { labels, distances } = index.search(l2normalize(queryVec), topK);
    return labels
        .map((idx, i) => ({ data: meta[idx], score: distances[i] }))
        .filter(r => r.data != null); // idx = -1 when index has fewer vectors than topK
}

/**
 * Keyword fallback: score items by term-frequency across specified fields.
 * Used when ENABLE_AI_SEARCH=false or when Bedrock embedding fails.
 *
 * @param {string} query - User query string
 * @param {object[]} items - Dataset items to search through
 * @param {string[]} fields - Item fields to include in the search haystack
 * @param {number} topK - Maximum number of results
 * @returns {{ data: object, score: number }[]}
 */
export function runKeywordSearch(query, items, fields, topK) {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (terms.length === 0) return [];

    return items
        .map(item => {
            const haystack = fields.map(f => String(item[f] || "")).join(" ").toLowerCase();
            const score = terms.reduce((s, t) => s + (haystack.includes(t) ? 1 : 0), 0);
            return { data: item, score };
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
