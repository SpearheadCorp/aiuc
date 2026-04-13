/**
 * core/embeddings.mjs
 * Shared embedding generation using Amazon Bedrock Titan Text Embeddings v2.
 *
 * Both PureStorage and Spearhead import from this module — do NOT duplicate
 * this logic in client-specific Lambda handlers.
 *
 * Model: amazon.titan-embed-text-v2:0  (1024-dim, L2-normalised by Bedrock)
 * IAM required: bedrock:InvokeModel on amazon.titan-embed-text-v2:0
 */

import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0";
const EMBEDDING_DIMENSIONS = 1024;

/**
 * Generate a 1024-dim embedding vector via Amazon Bedrock Titan Text Embeddings v2.
 * Vectors are L2-normalised by Bedrock — no post-processing required before storage.
 *
 * @param {string} text - Input text to embed (max ~8192 tokens)
 * @param {import("@aws-sdk/client-bedrock-runtime").BedrockRuntimeClient} bedrockClient
 * @returns {Promise<number[]>} 1024-dim float array
 * @throws {Error} if Bedrock returns an unexpected response shape or the call fails
 */
export async function getEmbedding(text, bedrockClient) {
    const command = new InvokeModelCommand({
        modelId: EMBEDDING_MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS, normalize: true }),
    });
    try {
        const response = await bedrockClient.send(command);
        const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
        if (!Array.isArray(result.embedding)) {
            throw new Error("Bedrock Titan returned unexpected response shape");
        }
        console.log(`[Embedding] success dim=${result.embedding.length}`);
        return result.embedding;
    } catch (err) {
        console.error("[Embedding] Bedrock error:", err.message);
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
