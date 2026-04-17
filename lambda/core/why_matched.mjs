/**
 * core/why_matched.mjs
 * "Why Matched" explanation generation using OpenAI gpt-4o-mini.
 *
 * Both PureStorage and Spearhead import from this module — do NOT duplicate
 * this logic in client-specific Lambda handlers.
 *
 * Model: gpt-4o-mini  (fast, cost-effective text generation via OpenAI)
 * Requires: OPENAI_API_KEY environment variable
 */

export const WHY_MATCHED_MODEL = "gpt-4o-mini";
export const FALLBACK_WHY = "Matched based on semantic similarity to your query.";

/**
 * Generate 1–2 sentence explanations for why each search result matched the query.
 *
 * On any OpenAI error, returns the FALLBACK_WHY string for every item so that
 * search results are still returned to the caller.
 *
 * @param {string} query - The user's search query
 * @param {object[]} items - Array of data objects returned by the search
 * @param {function(object): string} formatItem - Maps one item to a descriptive string for the prompt
 * @param {import("openai").OpenAI} openaiClient
 * @returns {Promise<string[]>} One explanation string per item (same order as items)
 */
export async function generateExplanations(query, items, formatItem, openaiClient) {
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
        const response = await openaiClient.chat.completions.create({
            model: WHY_MATCHED_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 1024,
        });
        const text = response.choices[0]?.message?.content || "[]";
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return items.map(() => FALLBACK_WHY);
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed : items.map(() => FALLBACK_WHY);
    } catch (err) {
        console.error("[WhyMatched] OpenAI error:", err.message);
        return items.map(() => FALLBACK_WHY);
    }
}
