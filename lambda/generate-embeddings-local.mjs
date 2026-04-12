#!/usr/bin/env node
/**
 * Generates vector embeddings for use_cases.json locally using Amazon Bedrock
 * Titan Text Embeddings v2 (1024 dimensions).
 *
 * The same model is called at runtime in the Lambda to embed search queries,
 * so dimensions always match — no manual alignment needed.
 *
 * Prerequisites:
 *   AWS credentials available in your environment:
 *     AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   IAM permission: bedrock:InvokeModel on amazon.titan-embed-text-v2:0
 *
 * Usage:
 *   node lambda/generate-embeddings-local.mjs
 *
 * Output:
 *   public/data/use_cases_embeddings.json
 *
 * After running, upload to S3:
 *   aws s3 cp public/data/use_cases_embeddings.json s3://auic/use_cases_embeddings.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-provider-ini";

const __dir = dirname(fileURLToPath(import.meta.url));

const INPUT  = resolve(__dir, "../public/data/use_cases.json");
const OUTPUT = resolve(__dir, "../public/data/use_cases_embeddings.json");

const BEDROCK_REGION = process.env.AWS_REGION   || "us-east-2";
const AWS_PROFILE    = process.env.AWS_PROFILE   || "Praveen";
const MODEL_ID       = "amazon.titan-embed-text-v2:0";
const DIMENSIONS     = 1024;

// Retry config for transient Bedrock throttling
const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 1000;

// ── Validation ────────────────────────────────────────────────────────────────
if (!existsSync(INPUT)) {
    console.error(`✗ Input file not found: ${INPUT}`);
    console.error("  Place use_cases.json in public/data/ first.");
    process.exit(1);
}

// ── Bedrock client ────────────────────────────────────────────────────────────
const bedrock = new BedrockRuntimeClient({
    region:      BEDROCK_REGION,
    credentials: fromIni({ profile: AWS_PROFILE }),
});

async function embedText(text, retries = 0) {
    try {
        const command = new InvokeModelCommand({
            modelId:     MODEL_ID,
            contentType: "application/json",
            accept:      "application/json",
            body: JSON.stringify({ inputText: text, dimensions: DIMENSIONS, normalize: true }),
        });
        const response = await bedrock.send(command);
        const result   = JSON.parse(Buffer.from(response.body).toString("utf-8"));

        if (!Array.isArray(result.embedding)) {
            throw new Error("Unexpected response shape from Bedrock Titan");
        }
        return result.embedding;
    } catch (err) {
        if (retries < MAX_RETRIES && err.name === "ThrottlingException") {
            const delay = RETRY_DELAY_MS * (retries + 1);
            process.stdout.write(`  [throttled] retry ${retries + 1}/${MAX_RETRIES} in ${delay}ms…\n`);
            await new Promise(r => setTimeout(r, delay));
            return embedText(text, retries + 1);
        }
        throw err;
    }
}

// ── Text builder ──────────────────────────────────────────────────────────────
function buildEmbedText(uc) {
    const fields = [
        ["AI Use Case",              uc.ai_use_case],
        ["Business Function",        uc.business_function],
        ["Business Capability",      uc.business_capability],
        ["Action / Implementation",  uc.action_implementation],
        ["Expected Outcomes",        uc.expected_outcomes_and_results],
        ["Stakeholder / User",       uc.stakeholder_or_user],
        ["AI Tools & Models",        uc.ai_tools_models],
        ["Datasets",                 uc.datasets],
    ];
    return fields
        .filter(([, v]) => v && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\nModel:   ${MODEL_ID} (${DIMENSIONS} dimensions)`);
    console.log(`Region:  ${BEDROCK_REGION}`);
    console.log(`Profile: ${AWS_PROFILE}\n`);

    const useCases = JSON.parse(readFileSync(INPUT, "utf-8"));
    console.log(`Generating embeddings for ${useCases.length} use cases…\n`);

    const results = [];
    for (let i = 0; i < useCases.length; i++) {
        const uc        = useCases[i];
        const text      = buildEmbedText(uc);
        const embedding = await embedText(text);
        results.push({ useCase: uc, embedding });

        if ((i + 1) % 10 === 0 || i === useCases.length - 1) {
            process.stdout.write(`  [${String(i + 1).padStart(3)}/${useCases.length}] done\n`);
        }
    }

    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, JSON.stringify(results));

    const kb = Math.round(Buffer.byteLength(JSON.stringify(results)) / 1024);
    console.log(`\n✓ ${results.length} embeddings (${kb} KB) → ${OUTPUT}`);
    console.log("\nUpload to S3:");
    console.log("  aws s3 cp public/data/use_cases_embeddings.json s3://auic/use_cases_embeddings.json\n");
}

main().catch(err => {
    console.error("\n✗ Fatal:", err.message);
    process.exit(1);
});
