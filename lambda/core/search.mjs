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

// Field-reference patterns: "as <field>" / "in <field>" tell us WHERE to search,
// but the field-label words themselves ("expected", "outcome", "action") must not
// be scored as content terms — every record has them in its field values.
const FIELD_REFERENCE_RULES = [
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+expected\s+(?:outcome|result)s?\b/i,
        field: "expected_outcomes_and_results",
        terms: ["expected", "outcome", "outcomes", "result", "results"],
    },
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+(?:action|implementation)\b/i,
        field: "action_implementation",
        terms: ["action", "implementation"],
    },
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+business\s+function\b/i,
        field: "business_function",
        terms: ["function"],  // "business" is a real content term — keep it
    },
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+(?:business\s+)?capability\b/i,
        field: "business_capability",
        terms: ["capability"],  // "business" is a real content term — keep it
    },
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+stakeholder\b/i,
        field: "stakeholder_or_user",
        terms: ["stakeholder"],
    },
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+ai\s+(?:tool|model)s?\b/i,
        field: "ai_tools_models",
        terms: [],  // "tool" and "model" are real content terms users search for
    },
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+(?:digital\s+)?platform\b/i,
        field: "ai_tools_platforms",
        terms: ["platform", "platforms"],  // "digital" is a real content term — keep it
    },
    {
        pattern: /\b(?:as|in(?:\s+the)?)\s+industry\b/i,
        field: "industry",
        terms: ["industry"],
    },
];

/**
 * Parse a raw user query into structured search signals.
 *
 * Handles three common query patterns that confuse naive term-frequency search:
 *   1. Quoted phrases — "targeted campaigns" → exact-match with a large bonus
 *   2. Command framing — "filter all use cases with X" → strip the scaffolding before embedding
 *   3. Field references — "as expected outcome" → boost that field, exclude the label words
 *      from content scoring (they appear in every record's field value and add noise)
 *
 * @param {string} rawQuery
 * @returns {{
 *   cleanedQuery: string,      // stripped query suitable for embedding
 *   quotedPhrases: string[],   // exact phrases extracted from quotes
 *   boostedFields: string[],   // field names to prioritise in keyword scoring
 *   fieldExcludeTerms: Set<string>, // label words to drop from term scoring
 * }}
 */
export function extractQuerySignals(rawQuery) {
    const quotedPhrases = [];

    // Pull out double-quoted phrases, keep the words in the text for embedding.
    let q = rawQuery.replace(/"([^"]+)"/g, (_, phrase) => {
        quotedPhrases.push(phrase.toLowerCase().trim());
        return ` ${phrase} `;
    });
    // Pull out single-quoted phrases — require word boundary before/after so
    // apostrophes in contractions ("it's", "campaign's") don't open a phrase.
    q = q.replace(/(?<!\w)'([^']{2,})'(?!\w)/g, (_, phrase) => {
        quotedPhrases.push(phrase.toLowerCase().trim());
        return ` ${phrase} `;
    });

    // Detect field-reference patterns: "as expected outcome", "in the action", etc.
    const boostedFields = [];
    const fieldExcludeTerms = new Set();
    for (const { pattern, field, terms } of FIELD_REFERENCE_RULES) {
        if (pattern.test(rawQuery)) {
            boostedFields.push(field);
            terms.forEach(t => fieldExcludeTerms.add(t));
            q = q.replace(pattern, " ");
        }
    }

    // Strip command-framing prefix so the embedding focuses on intent, not the instruction.
    q = q.replace(
        /^(filter|show|find|get|list|display|give\s+me|search\s+for|look\s+for)\s+(all\s+)?(use\s+cases?|cases?|results?|items?|rows?)?\s*(with|that\s+have?|where|having|for|by|of|containing)?\s*/i,
        " "
    ).trim();

    const cleanedQuery = q.trim() || rawQuery.trim();

    return { cleanedQuery, quotedPhrases, boostedFields, fieldExcludeTerms };
}

/**
 * Keyword fallback: score items by term-frequency across specified fields.
 * Used when ENABLE_AI_SEARCH=false or when embedding fails.
 *
 * Scoring strategy:
 * - Stop words filtered so generic scaffolding ("filter all use cases with…") doesn't inflate scores.
 * - fieldExcludeTerms drops field-label words ("expected", "outcome") that appear in every record.
 * - Term-frequency counting rewards items that mention key terms often.
 * - quotedPhrases get a large exact-match bonus (10× terms), pulling them to the top.
 * - boostedFields are scored with 3× weight vs. the general haystack.
 *
 * @param {string} query
 * @param {object[]} items
 * @param {string[]} fields
 * @param {number} topK
 * @param {{ quotedPhrases?: string[], boostedFields?: string[], fieldExcludeTerms?: Set<string> }} [opts]
 * @returns {{ data: object, score: number }[]}
 */
export function runKeywordSearch(query, items, fields, topK, opts = {}) {
    const { quotedPhrases = [], boostedFields = [], fieldExcludeTerms = new Set() } = opts;

    const rawTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const terms = rawTokens.filter(t => !STOP_WORDS.has(t) && !fieldExcludeTerms.has(t));
    const searchTerms = terms.length > 0 ? terms : rawTokens.filter(t => !fieldExcludeTerms.has(t));
    if (searchTerms.length === 0 && quotedPhrases.length === 0) return [];

    // Build implicit phrases from consecutive non-stop tokens.
    const implicitPhrases = [];
    let run = [];
    for (const token of rawTokens) {
        if (!STOP_WORDS.has(token) && !fieldExcludeTerms.has(token)) {
            run.push(token);
        } else {
            if (run.length >= 2) implicitPhrases.push(run.join(" "));
            run = [];
        }
    }
    if (run.length >= 2) implicitPhrases.push(run.join(" "));
    if (searchTerms.length >= 2) {
        const full = searchTerms.join(" ");
        if (!implicitPhrases.includes(full)) implicitPhrases.push(full);
    }
    const cappedImplicit = implicitPhrases.slice(0, 20);

    // Quoted phrases get a much larger bonus than implicit phrase runs.
    const implicitBonus = Math.max(searchTerms.length * 3, 3);
    const quotedBonus = Math.max(searchTerms.length * 10, 10);

    const boostedSet = new Set(boostedFields);

    return items
        .map(item => {
            let score;
            if (boostedSet.size > 0) {
                // Split fields so boosted content isn't double-counted in both haystacks.
                // boosted fields → 3×, everything else → 1×
                const primaryHaystack = fields
                    .filter(f => boostedSet.has(f))
                    .map(f => String(item[f] || "")).join(" ").toLowerCase();
                const secondaryHaystack = fields
                    .filter(f => !boostedSet.has(f))
                    .map(f => String(item[f] || "")).join(" ").toLowerCase();
                score = _scoreHaystack(secondaryHaystack, searchTerms, cappedImplicit, quotedPhrases, implicitBonus, quotedBonus)
                      + _scoreHaystack(primaryHaystack, searchTerms, cappedImplicit, quotedPhrases, implicitBonus, quotedBonus) * 3;
            } else {
                const haystack = fields.map(f => String(item[f] || "")).join(" ").toLowerCase();
                score = _scoreHaystack(haystack, searchTerms, cappedImplicit, quotedPhrases, implicitBonus, quotedBonus);
            }

            return { data: item, score };
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

function _scoreHaystack(haystack, searchTerms, implicitPhrases, quotedPhrases, implicitBonus, quotedBonus) {
    let score = searchTerms.reduce((s, t) => {
        let count = 0;
        let pos = haystack.indexOf(t);
        while (pos !== -1) { count++; pos = haystack.indexOf(t, pos + 1); }
        return s + count;
    }, 0);
    for (const phrase of implicitPhrases) {
        if (haystack.includes(phrase)) score += implicitBonus;
    }
    for (const phrase of quotedPhrases) {
        if (haystack.includes(phrase)) score += quotedBonus;
    }
    return score;
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
 * @param {{ quotedPhrases?: string[], boostedFields?: string[], fieldExcludeTerms?: Set<string> }} [opts]
 * @returns {{ data: object, score: number }[]}
 */
export function runHybridSearch(index, meta, queryVec, query, fields, topK, opts = {}) {
    const candidateK = Math.min(topK * 4, meta.length);

    const vectorResults = runVectorSearch(index, meta, queryVec, candidateK);
    const keywordResults = runKeywordSearch(query, meta, fields, candidateK, opts);

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
