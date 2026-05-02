#!/usr/bin/env node
/**
 * Sync the bundled seed registry into the live DynamoDB registry table.
 *
 * This script upserts all seed rows, refreshes the REGISTRY/META row, and
 * deletes company rows that no longer exist in the seed file so the table
 * matches the repo source of truth exactly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BatchWriteItemCommand, DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const args = process.argv.slice(2);

function flag(name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

function hyphenSlug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function companyKey(company) {
  return `COMPANY#${hyphenSlug(company) || company.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown-company"}`;
}

const seedPath = flag("--seed", resolve("services/api/data/seed_registry.json"));
const tableName = flag("--table", process.env.TABLE_NAME ?? process.env.AWS_REGISTRY_TABLE ?? "career-jump-prod-registry");
const region = flag("--region", process.env.AWS_REGION ?? "us-east-1");
const dryRun = hasFlag("--dry-run");

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const companies = Array.isArray(seed.companies) ? seed.companies : [];
const meta = {
  version: seed?._meta?.version ?? "seed-sync",
  total: companies.length,
  generated: seed?._meta?.generated ?? new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const client = new DynamoDBClient({ region });

async function listExistingRegistryRows() {
  const rows = [];
  let exclusiveStartKey;
  do {
    const response = await client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: marshall({
        ":pk": "REGISTRY",
        ":prefix": "COMPANY#",
      }),
      ExclusiveStartKey: exclusiveStartKey,
    }));
    rows.push(...(response.Items ?? []));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return rows;
}

async function writeBatches(requests) {
  const batchSize = 25;
  let completed = 0;
  for (let index = 0; index < requests.length; index += batchSize) {
    let pending = requests.slice(index, index + batchSize);
    if (dryRun) {
      completed += pending.length;
      console.log(`processed ${completed}/${requests.length}`);
      continue;
    }
    if (!dryRun) {
      for (let attempt = 1; pending.length > 0 && attempt <= 6; attempt += 1) {
        const response = await client.send(new BatchWriteItemCommand({
          RequestItems: { [tableName]: pending },
        }));
        pending = response.UnprocessedItems?.[tableName] ?? [];
        if (pending.length > 0) {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
        }
      }
    }
    completed += requests.slice(index, index + batchSize).length;
    console.log(`processed ${completed}/${requests.length}`);
    if (pending.length > 0) {
      throw new Error(`Unprocessed registry writes remained after retries: ${pending.length}`);
    }
  }
}

const existingRows = await listExistingRegistryRows();
const desiredRows = companies.map((entry) => ({
  pk: "REGISTRY",
  sk: companyKey(entry.company),
  ...entry,
  updatedAt: meta.updatedAt,
}));
const desiredKeys = new Set(desiredRows.map((row) => row.sk));
const existingKeys = new Set(existingRows.map((row) => row.sk?.S).filter(Boolean));

const upserts = desiredRows.map((row) => ({
  PutRequest: {
    Item: marshall(row, { removeUndefinedValues: true }),
  },
}));
upserts.push({
  PutRequest: {
    Item: marshall({
      pk: "REGISTRY",
      sk: "META",
      ...meta,
    }, { removeUndefinedValues: true }),
  },
});

const deletes = [...existingKeys]
  .filter((key) => !desiredKeys.has(key))
  .map((key) => ({
    DeleteRequest: {
      Key: marshall({ pk: "REGISTRY", sk: key }),
    },
  }));

console.log(JSON.stringify({
  seedPath,
  tableName,
  region,
  dryRun,
  totals: {
    desiredCompanies: companies.length,
    existingCompanies: existingKeys.size,
    upserts: upserts.length,
    deletes: deletes.length,
  },
}, null, 2));

await writeBatches([...upserts, ...deletes]);

console.log("registry sync complete");
