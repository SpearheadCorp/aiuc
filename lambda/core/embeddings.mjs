/**
 * core/embeddings.mjs
 * Shared embedding generation using OpenAI text-embedding-3-small.
 *
 * Both PureStorage and Spearhead import from this module — do NOT duplicate
 * this logic in client-specific Lambda handlers.
 *
 * Model: text-embedding-3-small  (1536-dim)
 * Requires: OPENAI_API_KEY environment variable
 */

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate a 1536-dim embedding vector via OpenAI text-embedding-3-small.
 *
 * @param {string} text - Input text to embed
 * @param {import("openai").OpenAI} openaiClient
 * @returns {Promise<number[]>} 1536-dim float array
 * @throws {Error} if OpenAI returns an unexpected response shape or the call fails
 */
export async function getEmbedding(text, openaiClient) {
    try {
        const response = await openaiClient.embeddings.create({
            model: EMBEDDING_MODEL,
            input: text,
            dimensions: EMBEDDING_DIMENSIONS,
        });
        const embedding = response.data[0]?.embedding;
        if (!Array.isArray(embedding)) {
            throw new Error(`OpenAI returned unexpected response shape: ${JSON.stringify(response)?.slice(0, 200)}`);
        }
        console.log(`[Embedding] success dim=${embedding.length}`);
        return embedding;
    } catch (err) {
        console.error("[Embedding] OpenAI error:", err.message);
        throw err;
    }
}

/**
 * L2-normalise a vector. Required before adding to a FlatIP index so that
 * inner product equals cosine similarity for unit-length vectors.
 *
 * @param {number[]} vec
 * @returns {number[]}
 */
export function l2normalize(vec) {
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag === 0 ? vec : vec.map(v => v / mag);
}
