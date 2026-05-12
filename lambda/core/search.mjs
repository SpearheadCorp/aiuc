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

// Common English stop words that carry no discriminating signal for search ranking.
// Filtering these out prevents generic query words ("filter all use cases with…")
// from inflating scores on unrelated records.
const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "up", "about", "into", "as", "is", "it",
    "its", "be", "are", "was", "were", "been", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "may", "might",
    "all", "any", "both", "each", "few", "more", "most", "other", "some",
    "such", "no", "nor", "not", "only", "own", "same", "than", "too",
    "very", "just", "because", "i", "me", "my", "we", "our", "you", "your",
    "he", "she", "they", "them", "their", "what", "which", "who", "this",
    "that", "these", "those", "how", "when", "where", "why", "find", "get",
    "show", "give", "make", "let", "filter", "search", "list", "use", "used",
    "case", "cases", "data", "based", "related", "like", "so", "if",
    "then", "there", "here", "can", "need", "want", "help", "please", "us",
    "me", "looking", "look",
]);

/**
 * Keyword fallback: score items by term-frequency across specified fields.
 * Used when ENABLE_AI_SEARCH=false or when embedding fails.
 *
 * Improvements over binary word matching:
 * - Stop words are filtered so generic query scaffolding ("filter all use cases with…")
 *   doesn't inflate scores on unrelated records.
 * - Term-frequency counting (not binary) rewards items that mention key terms often.
 * - Phrase-match bonus: consecutive meaningful terms found together as a substring
 *   get a score boost equal to 3× the number of query terms, pulling exact-phrase
 *   matches to the top.
 *
 * @param {string} query - User query string
 * @param {object[]} items - Dataset items to search through
 * @param {string[]} fields - Item fields to include in the search haystack
 * @param {number} topK - Maximum number of results
 * @returns {{ data: object, score: number }[]}
 */
export function runKeywordSearch(query, items, fields, topK) {
    const rawTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const terms = rawTokens.filter(t => !STOP_WORDS.has(t));
    // If every token was a stop word, fall back to all tokens so we still return something.
    const searchTerms = terms.length > 0 ? terms : rawTokens;
    if (searchTerms.length === 0) return [];

    // Build meaningful phrases: runs of 2+ consecutive non-stop tokens in the original query.
    const phrases = [];
    let run = [];
    for (const token of rawTokens) {
        if (!STOP_WORDS.has(token)) {
            run.push(token);
        } else {
            if (run.length >= 2) phrases.push(run.join(" "));
            run = [];
        }
    }
    if (run.length >= 2) phrases.push(run.join(" "));
    // Also add the full search-term sequence if it wasn't already captured.
    if (searchTerms.length >= 2) {
        const full = searchTerms.join(" ");
        if (!phrases.includes(full)) phrases.push(full);
    }
    // Cap phrases to avoid O(phrases × items) blowup on adversarial long queries.
    const cappedPhrases = phrases.slice(0, 20);

    const phraseBonus = searchTerms.length * 3;

    return items
        .map(item => {
            const haystack = fields.map(f => String(item[f] || "")).join(" ").toLowerCase();

            // Term-frequency score: count occurrences of each meaningful term.
            let score = searchTerms.reduce((s, t) => {
                let count = 0;
                let pos = haystack.indexOf(t);
                while (pos !== -1) { count++; pos = haystack.indexOf(t, pos + 1); }
                return s + count;
            }, 0);

            // Phrase-match bonus: exact phrase appearing in the haystack is a strong signal.
            for (const phrase of cappedPhrases) {
                if (haystack.includes(phrase)) score += phraseBonus;
            }

            return { data: item, score };
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

/**
 * Hybrid search using Reciprocal Rank Fusion (RRF) to merge vector and keyword results.
 * Casts a wider net from each method then re-ranks by combined RRF score so that
 * both semantic intent and exact keyword matches are rewarded.
 *
 * @param {object} index - FlatIP index from createFlatIPIndex()
 * @param {object[]} meta - Metadata array parallel to the index vectors
 * @param {number[]} queryVec - Query embedding (raw, will be L2-normalised internally)
 * @param {string} query - Original query string for keyword scoring
 * @param {string[]} fields - Fields to search for keyword scoring
 * @param {number} topK - Final number of results to return
 * @returns {{ data: object, score: number }[]}
 */
export function runHybridSearch(index, meta, queryVec, query, fields, topK) {
    const candidateK = Math.min(topK * 4, meta.length);

    const vectorResults = runVectorSearch(index, meta, queryVec, candidateK);
    const keywordResults = runKeywordSearch(query, meta, fields, candidateK);

    // Build rank maps keyed by object reference — works because both searches
    // return items directly from the shared meta array (no cloning).
    const vectorRanks = new Map(vectorResults.map((r, i) => [r.data, i + 1]));
    const keywordRanks = new Map(keywordResults.map((r, i) => [r.data, i + 1]));

    // Union of all candidates from both lists
    const allCandidates = new Set([
        ...vectorResults.map(r => r.data),
        ...keywordResults.map(r => r.data),
    ]);

    // RRF score = 1/(k+rank_vector) + 1/(k+rank_keyword); k=60 is standard
    const k = 60;
    const scored = [...allCandidates].map(data => {
        const vRank = vectorRanks.get(data) ?? (candidateK + 1);
        const kwRank = keywordRanks.get(data) ?? (candidateK + 1);
        return { data, score: 1 / (k + vRank) + 1 / (k + kwRank) };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
