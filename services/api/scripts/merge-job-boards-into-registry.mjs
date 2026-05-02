#!/usr/bin/env node
/**
 * Merge job_boards.json into both:
 * - the repo seed registry JSON
 * - the live DynamoDB registry table
 *
 * Rules:
 * - the current live Dynamo registry is the source of truth for duplicate
 *   detection, not the seed file
 * - only missing companies are added automatically
 * - duplicate companies are reported to a JSON diff file instead of being
 *   overwritten silently
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BatchWriteItemCommand, DynamoDBClient, GetItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const args = process.argv.slice(2);

function flag(name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(name);
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

function titleCaseAts(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const map = new Map([
    ["workday", "Workday"],
    ["phenom", "Phenom"],
    ["icims", "iCIMS"],
    ["smartrecruiters", "SmartRecruiters"],
    ["greenhouse", "Greenhouse"],
    ["lever", "Lever"],
    ["ashby", "Ashby"],
    ["eightfold", "Eightfold"],
    ["avature", "Avature"],
    ["brassring", "BrassRing"],
    ["successfactors", "SuccessFactors"],
    ["oracle_cloud_hcm", "Oracle Cloud HCM"],
    ["taleo", "Taleo"],
    ["selectminds", "SelectMinds"],
    ["teamtailor", "Teamtailor"],
    ["rippling", "Rippling"],
    ["custom", "Custom"],
    ["recruitee", "Recruitee"],
  ]);
  return map.get(raw) ?? String(value ?? "").trim();
}

function hyphenSlug(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function companyKey(company) {
  return `COMPANY#${hyphenSlug(company) || company.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown-company"}`;
}

function toSeedEntry(board) {
  const ats = titleCaseAts(board.ats);
  return {
    rank: null,
    sheet: "job_boards import",
    company: String(board.company ?? "").trim(),
    board_url: typeof board.url === "string" ? board.url.trim() : null,
    ats: ats || null,
    total_jobs: null,
    source: "job_boards_import",
    tier: "TIER3_LOW",
    from: "job_boards",
    sample_url: null,
    last_checked: null,
    adapterId: typeof board.adapterId === "string" && board.adapterId.trim() ? board.adapterId.trim() : undefined,
    tenant: typeof board.tenant === "string" ? board.tenant.trim() : undefined,
    host: typeof board.host === "string" ? board.host.trim() : undefined,
    board_token: typeof board.board_token === "string" ? board.board_token.trim() : undefined,
    notes: typeof board.notes === "string" ? board.notes.trim() : undefined,
  };
}

function diffConfigs(dynamoRow, board) {
  const jobBoardsConfig = toSeedEntry(board);
  const relevantDynamo = {
    company: dynamoRow.company ?? null,
    ats: dynamoRow.ats ?? null,
    board_url: dynamoRow.board_url ?? null,
    adapterId: dynamoRow.adapterId ?? null,
    tier: dynamoRow.tier ?? null,
    source: dynamoRow.source ?? null,
    sample_url: dynamoRow.sample_url ?? null,
    host: dynamoRow.host ?? null,
    tenant: dynamoRow.tenant ?? null,
    board_token: dynamoRow.board_token ?? null,
    notes: dynamoRow.notes ?? null,
  };
  const relevantBoard = {
    company: jobBoardsConfig.company ?? null,
    ats: jobBoardsConfig.ats ?? null,
    board_url: jobBoardsConfig.board_url ?? null,
    adapterId: jobBoardsConfig.adapterId ?? null,
    tier: jobBoardsConfig.tier ?? null,
    source: jobBoardsConfig.source ?? null,
    sample_url: jobBoardsConfig.sample_url ?? null,
    host: jobBoardsConfig.host ?? null,
    tenant: jobBoardsConfig.tenant ?? null,
    board_token: jobBoardsConfig.board_token ?? null,
    notes: jobBoardsConfig.notes ?? null,
  };
  const differences = {};
  for (const key of Object.keys(relevantBoard)) {
    if (JSON.stringify(relevantDynamo[key]) !== JSON.stringify(relevantBoard[key])) {
      differences[key] = {
        dynamo: relevantDynamo[key],
        job_boards: relevantBoard[key],
      };
    }
  }
  return {
    companyName: jobBoardsConfig.company,
    dynamoConfig: relevantDynamo,
    jobBoardsConfig: relevantBoard,
    differences,
  };
}

const seedPath = flag("--seed", resolve("services/api/data/seed_registry.json"));
const boardsPath = flag("--boards", "/Users/dbhujbal/Downloads/job_boards.json");
const diffPath = flag("--diff-out", "/tmp/job_boards_registry_duplicates.json");
const tableName = flag("--table", process.env.TABLE_NAME ?? process.env.AWS_REGISTRY_TABLE ?? "career-jump-prod-registry");
const region = flag("--region", process.env.AWS_REGION ?? "us-east-1");
const dryRun = hasFlag("--dry-run");

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const boardsFile = JSON.parse(readFileSync(boardsPath, "utf8"));
const boards = Array.isArray(boardsFile?.boards) ? boardsFile.boards : [];

const client = new DynamoDBClient({ region });

async function listCurrentRegistryRows() {
  const rows = [];
  let exclusiveStartKey;
  do {
    const response = await client.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": { S: "REGISTRY" },
        ":prefix": { S: "COMPANY#" },
      },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    rows.push(...(response.Items ?? []).map((item) => unmarshall(item)));
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return rows;
}

async function loadRegistryMetaRow() {
  const response = await client.send(new GetItemCommand({
    TableName: tableName,
    Key: marshall({ pk: "REGISTRY", sk: "META" }),
  }));
  return response.Item ? unmarshall(response.Item) : null;
}

async function writeBatches(requests) {
  const batchSize = 25;
  for (let index = 0; index < requests.length; index += batchSize) {
    let pending = requests.slice(index, index + batchSize);
    if (dryRun) continue;
    for (let attempt = 1; pending.length > 0 && attempt <= 6; attempt += 1) {
      const response = await client.send(new BatchWriteItemCommand({
        RequestItems: { [tableName]: pending },
      }));
      pending = response.UnprocessedItems?.[tableName] ?? [];
      if (pending.length > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250));
      }
    }
    if (pending.length > 0) {
      throw new Error(`DynamoDB left ${pending.length} unprocessed writes after retries`);
    }
  }
}

const currentRows = await listCurrentRegistryRows();
const currentMetaRow = await loadRegistryMetaRow();
const currentByName = new Map(currentRows.map((row) => [normalizeName(row.company), row]));
const seedCompanies = Array.isArray(seed.companies) ? seed.companies : [];
const seedByName = new Map(seedCompanies.map((row) => [normalizeName(row.company), row]));

const additions = [];
const duplicateDiffs = [];

for (const board of boards) {
  const company = String(board.company ?? "").trim();
  if (!company) continue;
  const key = normalizeName(company);
  const current = currentByName.get(key);
  if (current) {
    duplicateDiffs.push(diffConfigs(current, board));
    continue;
  }
  additions.push(toSeedEntry(board));
}

const nextSeedCompanies = [...seedCompanies];
for (const addition of additions) {
  if (!seedByName.has(normalizeName(addition.company))) {
    nextSeedCompanies.push(addition);
  }
}

nextSeedCompanies.sort((a, b) => String(a.company).localeCompare(String(b.company)));
const nextSeed = {
  ...seed,
  _meta: {
    ...(seed._meta ?? {}),
    total: nextSeedCompanies.length,
    job_boards_import_added: additions.length,
    updatedAt: new Date().toISOString(),
  },
  companies: nextSeedCompanies,
};

if (!dryRun) {
  // Keep the dry run side-effect free for the repo while still producing the
  // duplicate-diff report the user requested.
  writeFileSync(seedPath, `${JSON.stringify(nextSeed, null, 2)}\n`);
}
writeFileSync(diffPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceBoardsPath: boardsPath,
  liveRegistryTable: tableName,
  duplicateCount: duplicateDiffs.length,
  addedCount: additions.length,
  duplicates: duplicateDiffs,
}, null, 2)}\n`);

const putRequests = additions.map((row) => ({
  PutRequest: {
    Item: marshall({
      pk: "REGISTRY",
      sk: companyKey(row.company),
      ...row,
      updatedAt: new Date().toISOString(),
    }, { removeUndefinedValues: true }),
  },
}));

putRequests.push({
  PutRequest: {
    Item: marshall({
      pk: "REGISTRY",
      sk: "META",
      ...(currentMetaRow ?? {}),
      version: "job-boards-merge",
      total: currentRows.length + additions.length,
      generated: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { removeUndefinedValues: true }),
  },
});

console.log(JSON.stringify({
  tableName,
  region,
  dryRun,
  totals: {
    currentRegistryCompanies: currentRows.length,
    jobBoardsCompanies: boards.length,
    additions: additions.length,
    duplicates: duplicateDiffs.length,
    nextSeedCompanies: nextSeedCompanies.length,
  },
  diffPath,
}, null, 2));

await writeBatches(putRequests);
console.log("job_boards merge complete");
