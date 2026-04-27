/**
 * Seed the company registry into DynamoDB.
 *
 * Usage:
 *   node scripts/seed-registry.mjs [--table <table-name>] [--region <region>] [--dry-run]
 *
 * Defaults:
 *   --table   career-jump-web-poc-registry   (set TABLE_NAME env var to override)
 *   --region  us-east-1                   (set AWS_REGION env var to override)
 *
 * Requires AWS credentials in the environment (AWS_ACCESS_KEY_ID +
 * AWS_SECRET_ACCESS_KEY, or an active AWS SSO session / instance profile).
 *
 * Install the SDK once (dev only):
 *   npm install --save-dev @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
 *
 * Schema written:
 *   pk  = "REGISTRY"
 *   sk  = "COMPANY#<company_name>"
 *   + all registry fields (company, board_url, ats, tier, rank, sheet, sample_url, …)
 *
 * Idempotent — safe to re-run. Existing items are overwritten with fresh data.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Args / config
// ---------------------------------------------------------------------------

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const TABLE   = flag("--table")  ?? process.env.TABLE_NAME ?? "career-jump-web-poc-registry";
const REGION  = flag("--region") ?? process.env.AWS_REGION ?? "us-east-1";
const DRY_RUN = hasFlag("--dry-run");

const REGISTRY_PATH = resolve(
  __dir,
  "../../ats-discovery-agent/data/seed_registry_final.json",
);

// ---------------------------------------------------------------------------
// Load SDK (must be installed first)
// ---------------------------------------------------------------------------

let DynamoDBDocumentClient, BatchWriteCommand;
try {
  ({ DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb"));
  ({ BatchWriteCommand } = await import("@aws-sdk/lib-dynamodb"));
} catch {
  console.error(
    "❌  AWS SDK not found. Install it first:\n" +
    "    npm install --save-dev @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb\n",
  );
  process.exit(1);
}

let DynamoDBClient;
try {
  ({ DynamoDBClient } = await import("@aws-sdk/client-dynamodb"));
} catch {
  console.error("❌  @aws-sdk/client-dynamodb not found.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load registry data
// ---------------------------------------------------------------------------

let raw;
try {
  raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
} catch {
  console.error(`❌  Cannot read registry file: ${REGISTRY_PATH}`);
  process.exit(1);
}

const companies = raw.companies ?? [];
if (companies.length === 0) {
  console.error("❌  No companies found in registry file.");
  process.exit(1);
}

console.log(`📦  Registry: ${companies.length} companies`);
console.log(`📋  Table:    ${TABLE}`);
console.log(`🌍  Region:   ${REGION}`);
if (DRY_RUN) console.log("🔍  DRY RUN — no writes will be made\n");

// ---------------------------------------------------------------------------
// DynamoDB client
// ---------------------------------------------------------------------------

const client = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Batch write (25 items per request — DynamoDB limit)
// ---------------------------------------------------------------------------

const BATCH_SIZE = 25;
let written = 0;
let failed  = 0;

function toItem(c) {
  return {
    pk:         "REGISTRY",
    sk:         `COMPANY#${c.company}`,
    company:    c.company,
    board_url:  c.board_url  ?? null,
    ats:        c.ats        ?? null,
    tier:       c.tier       ?? "NEEDS_REVIEW",
    rank:       c.rank       ?? null,
    sheet:      c.sheet      ?? null,
    sample_url: c.sample_url ?? null,
    total_jobs: c.total_jobs ?? null,
    updatedAt:  new Date().toISOString(),
  };
}

async function writeBatch(items) {
  if (DRY_RUN) {
    written += items.length;
    return;
  }
  const requests = items.map((item) => ({
    PutRequest: { Item: toItem(item) },
  }));

  let unprocessed = requests;
  let attempts = 0;

  while (unprocessed.length > 0 && attempts < 5) {
    attempts++;
    const cmd = new BatchWriteCommand({
      RequestItems: { [TABLE]: unprocessed },
    });
    const result = await ddb.send(cmd);
    const leftover = result.UnprocessedItems?.[TABLE] ?? [];
    written += unprocessed.length - leftover.length;
    unprocessed = leftover;
    if (leftover.length > 0) {
      await new Promise((r) => setTimeout(r, 200 * attempts));
    }
  }

  if (unprocessed.length > 0) {
    failed += unprocessed.length;
    console.warn(`⚠️   ${unprocessed.length} items unprocessed after 5 retries`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const startMs = Date.now();
for (let i = 0; i < companies.length; i += BATCH_SIZE) {
  const batch = companies.slice(i, i + BATCH_SIZE);
  await writeBatch(batch);

  const pct = Math.round(((i + batch.length) / companies.length) * 100);
  process.stdout.write(`\r  ⏳  ${written} / ${companies.length} (${pct}%)`);
}

const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
console.log(`\n\n✅  Done in ${elapsed}s — ${written} written, ${failed} failed`);

if (!DRY_RUN && failed === 0) {
  console.log("\n📝  Also write the registry meta record (total counts):");
  const meta = {
    pk: "REGISTRY",
    sk: "META",
    total:       raw._meta?.total       ?? companies.length,
    version:     raw._meta?.version     ?? "unknown",
    generated:   raw._meta?.generated   ?? new Date().toISOString().slice(0, 10),
    tier1:       companies.filter((c) => c.tier === "TIER1_VERIFIED").length,
    tier2:       companies.filter((c) => c.tier === "TIER2_MEDIUM").length,
    tier3:       companies.filter((c) => c.tier === "TIER3_LOW").length,
    needsReview: companies.filter((c) => c.tier === "NEEDS_REVIEW").length,
    updatedAt:   new Date().toISOString(),
  };
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb");
  await ddb.send(new PutCommand({ TableName: TABLE, Item: meta }));
  console.log("✅  Meta record written (pk=REGISTRY, sk=META)");
}
