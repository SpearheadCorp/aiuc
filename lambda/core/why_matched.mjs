/**
 * core/why_matched.mjs
 * "Why Matched" explanation generation using Amazon Bedrock Nova Lite.
 *
 * Both PureStorage and Spearhead import from this module — do NOT duplicate
 * this logic in client-specific Lambda handlers.
 *
 * Model: us.amazon.nova-lite-v1:0  (fast, cost-effective text generation on Bedrock)
 * IAM required: bedrock:InvokeModel on us.amazon.nova-lite-v1:0
 */

import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export const WHY_MATCHED_MODEL = "us.amazon.nova-lite-v1:0";
export const FALLBACK_WHY = "Matched based on semantic similarity to your query.";

/**
 * Generate 1–2 sentence explanations for why each search result matched the query.
 * Keeps all AI inference within AWS — no external API dependencies.
 *
 * On any Bedrock error, returns the FALLBACK_WHY string for every item so that
 * search results are still returned to the caller.
 *
 * @param {string} query - The user's search query
 * @param {object[]} items - Array of data objects returned by the search
 * @param {function(object): string} formatItem - Maps one item to a descriptive string for the prompt
 * @param {import("@aws-sdk/client-bedrock-runtime").BedrockRuntimeClient} bedrockClient
 * @returns {Promise<string[]>} One explanation string per item (same order as items)
 */
export async function generateExplanations(query, items, formatItem, bedrockClient) {
    if (items.length === 0) return [];

    const safeQuery = query.replace(/"/g, '\\"');
    const list = items.map((item, i) => `${i + 1}. ${formatItem(item)}`).join("\n");

    const prompt = `You are an AI analyst helping employees find relevant AI use cases for their company's internal tool.

User's search query: "${safeQuery}"

The following use cases were retrieved as semantic matches. For each one (numbered 1 to ${items.length}), write exactly 1–2 concise sentences explaining specifically why it matches the user's query. Be concrete about the connection.

${list}

Respond ONLY with a JSON array of strings, one per use case in the same order:
["explanation for 1", "explanation for 2", ...]`;

    try {
        const command = new InvokeModelCommand({
            modelId: WHY_MATCHED_MODEL,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify({
                messages: [{ role: "user", content: [{ text: prompt }] }],
                inferenceConfig: { temperature: 0.2, maxTokens: 1024 },
            }),
        });
        const response = await bedrockClient.send(command);
        const result = JSON.parse(Buffer.from(response.body).toString("utf-8"));
        const text = result.output?.message?.content?.[0]?.text || "[]";
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return items.map(() => FALLBACK_WHY);
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed : items.map(() => FALLBACK_WHY);
    } catch (err) {
        console.error("[WhyMatched] Bedrock error:", err.message);
        return items.map(() => FALLBACK_WHY);
    }
}
