#!/usr/bin/env node
/**
 * Generates vector embeddings for industry_use_cases.json locally using OpenAI
 * text-embedding-3-small (1536 dimensions).
 *
 * The same model is called at runtime in the Lambda to embed search queries,
 * so dimensions always match — no manual alignment needed.
 *
 * Prerequisites:
 *   OPENAI_API_KEY environment variable must be set.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node lambda/generate-embeddings-industry-local.mjs
 *
 * Output:
 *   public/data/industry_use_cases_embeddings.json
 *
 * After running, upload to S3:
 *   aws s3 cp public/data/pure_industry_use_cases_embeddings.json s3://YOUR_BUCKET/pure_industry_use_cases_embeddings.json
 *
 * NOTE: If you previously used Bedrock Titan (1024-dim) embeddings, you MUST
 * regenerate and re-upload — the vector dimensions are incompatible.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local automatically ────────────────────────────────────────────
const envPath = resolve(__dir, "../.env.local");
if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const raw = trimmed.slice(eqIdx + 1).trim();
        const val = raw.replace(/^(['"])(.*)\1$/, "$2");
        if (!process.env[key]) process.env[key] = val;
    }
    console.log("✓ Loaded .env.local");
}

const INPUT = resolve(__dir, "../public/data/industry_use_cases.json");
const OUTPUT = resolve(__dir, "../public/data/pure_industry_use_cases_embeddings.json");

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ── Validation ────────────────────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY_N) {
    console.error("✗ OPENAI_API_KEY_N environment variable is not set.");
    console.error("  Add OPENAI_API_KEY_N=sk-... to .env.local");
    process.exit(1);
}

if (!existsSync(INPUT)) {
    console.error(`✗ Input file not found: ${INPUT}`);
    console.error("  Place industry_use_cases.json in public/data/ first.");
    process.exit(1);
}

// ── OpenAI client ─────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY_N });

async function embedText(text, retries = 0) {
    try {
        const response = await openai.embeddings.create({
            model: MODEL,
            input: text,
            dimensions: DIMENSIONS,
        });
        const embedding = response.data[0]?.embedding;
        if (!Array.isArray(embedding)) {
            throw new Error("Unexpected response shape from OpenAI embeddings");
        }
        return embedding;
    } catch (err) {
        if (retries < MAX_RETRIES && err.status === 429) {
            const delay = RETRY_DELAY_MS * (retries + 1);
            process.stdout.write(`  [rate-limited] retry ${retries + 1}/${MAX_RETRIES} in ${delay}ms…\n`);
            await new Promise(r => setTimeout(r, delay));
            return embedText(text, retries + 1);
        }
        throw err;
    }
}

// ── Text builder ──────────────────────────────────────────────────────────────
function buildEmbedText(item) {
    const fields = [
        ["AI Use Case", item.ai_use_case],
        ["Industry", item.industry],
        ["Business Function", item.business_function],
        ["Business Capability", item.business_capability],
        ["Description", item.description],
        ["Implementation Plan", item.implementation_plan],
        ["Expected Outcomes", item.expected_outcomes],
        ["Stakeholders / Users", item.stakeholders_users],
        ["AI Tools / Platforms", item.ai_tools_platforms],
        ["Datasets", item.datasets],
    ];
    return fields
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\nModel:      ${MODEL} (${DIMENSIONS} dimensions)`);
    console.log(`Output:     ${OUTPUT}\n`);

    const items = JSON.parse(readFileSync(INPUT, "utf-8"));
    console.log(`Generating embeddings for ${items.length} industry use cases…\n`);

    const results = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const text = buildEmbedText(item);
        const embedding = await embedText(text);
        results.push({ item, embedding });

        if ((i + 1) % 10 === 0 || i === items.length - 1) {
            process.stdout.write(`  [${String(i + 1).padStart(3)}/${items.length}] done\n`);
        }
    }

    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, JSON.stringify(results));

    const kb = Math.round(Buffer.byteLength(JSON.stringify(results)) / 1024);
    console.log(`\n✓ ${results.length} embeddings (${kb} KB) → ${OUTPUT}`);
    console.log("\nUpload to S3:");
    console.log("  aws s3 cp public/data/pure_industry_use_cases_embeddings.json s3://YOUR_BUCKET/pure_industry_use_cases_embeddings.json\n");
}

main().catch(err => {
    console.error("\n✗ Fatal:", err.message);
    process.exit(1);
});
