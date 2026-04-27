#!/usr/bin/env node
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const DEFAULT_MANIFEST = [
  ["CONFIG_STORE", "runtime:config", "config.json"],
  ["CONFIG_STORE", "runtime:company_scan_overrides", "company_scan_overrides.json"],
  ["CONFIG_STORE", "runtime:saved_filters", "saved_filters.json"],
  ["JOB_STATE", "runtime:latest_inventory", "latest_inventory.json"],
  ["JOB_STATE", "runtime:applied_jobs", "applied_jobs.json"],
  ["JOB_STATE", "runtime:job_notes", "job_notes.json"],
  ["JOB_STATE", "runtime:discarded_job_keys", "discarded_job_keys.json"],
  ["JOB_STATE", "runtime:trend_points", "trend_points.json"],
  ["JOB_STATE", "runtime:last_new_jobs_count", "last_new_jobs_count.txt"],
  ["JOB_STATE", "runtime:last_new_job_keys", "last_new_job_keys.json"],
  ["JOB_STATE", "runtime:last_updated_jobs_count", "last_updated_jobs_count.txt"],
  ["JOB_STATE", "runtime:last_updated_job_keys", "last_updated_job_keys.json"],
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function usage() {
  return [
    "Usage:",
    "  AWS_STATE_TABLE=career-jump-aws-poc-state AWS_REGION=us-east-1 node scripts/import-cloudflare-runtime-to-aws.mjs /tmp/career-jump-cf-export",
    "",
    "Expected files:",
    ...DEFAULT_MANIFEST.map(([, key, file]) => `  ${file} -> ${key}`),
  ].join("\n");
}

async function readOptionalText(directory, fileName) {
  try {
    const value = await readFile(join(directory, fileName), "utf8");
    const trimmed = value.trim();
    if (!trimmed || trimmed === "null") return null;
    if (fileName.endsWith(".json")) {
      JSON.parse(trimmed);
    }
    return trimmed;
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function putKv(client, tableName, namespace, key, value) {
  await client.send(new PutItemCommand({
    TableName: tableName,
    Item: marshall({
      pk: `KV#${namespace}`,
      sk: key,
      value,
    }),
  }));
}

async function main() {
  const exportDirectory = process.argv[2];
  if (!exportDirectory) {
    console.error(usage());
    process.exit(2);
  }

  const tableName = requireEnv("AWS_STATE_TABLE");
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const client = new DynamoDBClient({ region });

  const imported = [];
  const skipped = [];

  for (const [namespace, key, fileName] of DEFAULT_MANIFEST) {
    const value = await readOptionalText(exportDirectory, fileName);
    if (value === null) {
      skipped.push(`${namespace}/${key} (${basename(fileName)})`);
      continue;
    }
    await putKv(client, tableName, namespace, key, value);
    imported.push(`${namespace}/${key}`);
  }

  console.log(`Imported ${imported.length} runtime keys into ${tableName}.`);
  for (const item of imported) console.log(`  + ${item}`);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} missing or empty export files.`);
    for (const item of skipped) console.log(`  - ${item}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
