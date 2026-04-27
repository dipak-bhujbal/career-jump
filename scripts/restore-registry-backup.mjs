/**
 * Restore the preserved Career Jump registry backup into a DynamoDB table.
 *
 * This script intentionally writes only the registry table. It does not touch
 * state, jobs, users, or any legacy app resources.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BatchWriteItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name) {
  return args.includes(name);
}

const tableName = flag("--table") ?? process.env.TABLE_NAME ?? "career-jump-prod-registry";
const region = flag("--region") ?? process.env.AWS_REGION ?? "us-east-1";
const backupPath = flag("--backup") ?? resolve(
  __dirname,
  "../backups/registry/20260427-113508/items.raw.json",
);
const dryRun = hasFlag("--dry-run");

const raw = JSON.parse(readFileSync(backupPath, "utf8"));
const items = raw.Items ?? [];
const registryItems = items.filter((item) => item.pk?.S === "REGISTRY" && item.sk?.S);

if (registryItems.length === 0) {
  throw new Error(`No registry items found in backup: ${backupPath}`);
}

console.log(`Registry backup: ${backupPath}`);
console.log(`Target table:    ${tableName}`);
console.log(`Region:          ${region}`);
console.log(`Items:           ${registryItems.length}`);
if (dryRun) console.log("Dry run:         yes");

const client = new DynamoDBClient({ region });
const batchSize = 25;
let written = 0;

async function writeBatch(batch) {
  if (dryRun) {
    written += batch.length;
    return;
  }

  let requests = batch.map((Item) => ({ PutRequest: { Item } }));
  for (let attempt = 1; requests.length > 0 && attempt <= 6; attempt++) {
    const response = await client.send(new BatchWriteItemCommand({
      RequestItems: { [tableName]: requests },
    }));
    const unprocessed = response.UnprocessedItems?.[tableName] ?? [];
    written += requests.length - unprocessed.length;
    requests = unprocessed;
    if (requests.length > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
    }
  }

  if (requests.length > 0) {
    throw new Error(`DynamoDB left ${requests.length} unprocessed registry writes after retries`);
  }
}

for (let index = 0; index < registryItems.length; index += batchSize) {
  const batch = registryItems.slice(index, index + batchSize);
  await writeBatch(batch);
  console.log(`Restored ${written}/${registryItems.length}`);
}

console.log(`Registry restore complete: ${written} items`);
