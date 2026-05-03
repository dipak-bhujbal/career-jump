/**
 * Lambda-resident registry cache.
 *
 * Loaded once per execution context (cold start) and reused across warm
 * invocations. Production reads the separate DynamoDB registry table so the
 * company registry remains an isolated data asset. Local/test runs fall back
 * to the bundled seed JSON when AWS_REGISTRY_TABLE is not configured.
 */
import { readFile } from "node:fs/promises";
import { DynamoDBClient, GetItemCommand, QueryCommand, type AttributeValue } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import type { RegistryEntry, SeedRegistry } from "../ats/registry";
import { normalizeAtsId } from "../ats/shared/normalize";
import { normalizeCompanyKey, DEFAULT_TENANT } from "./tenant-keys";
import bundledRegistry from "../../data/seed_registry.json";
import type { RegistryScanPool } from "../types";

type CacheState = {
  loadedAt: number;
  byKey: Map<string, RegistryEntry>;
  byAts: Map<string, RegistryEntry[]>;
  all: RegistryEntry[];
  meta: SeedRegistry["_meta"];
};

let state: CacheState | null = null;
const dynamodb = new DynamoDBClient({});

function indexEntries(reg: SeedRegistry): CacheState {
  const byKey = new Map<string, RegistryEntry>();
  const byAts = new Map<string, RegistryEntry[]>();
  for (const entry of reg.companies) {
    byKey.set(normalizeCompanyKey(entry.company), entry);
    if (entry.ats) {
      const k = entry.ats.toLowerCase();
      const list = byAts.get(k) ?? [];
      list.push(entry);
      byAts.set(k, list);
    }
  }
  return {
    loadedAt: Date.now(),
    byKey,
    byAts,
    all: reg.companies,
    meta: reg._meta,
  };
}

function registryTableName(): string | null {
  return process.env.AWS_REGISTRY_TABLE || process.env.REGISTRY_TABLE || null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function scanPoolOrNull(value: unknown): RegistryScanPool | null {
  return value === "hot" || value === "warm" || value === "cold" ? value : null;
}

function itemToRegistryEntry(item: Record<string, unknown>): RegistryEntry | null {
  const company = stringOrNull(item.company);
  if (!company) return null;
  const normalizedAts = stringOrNull(item.ats);
  return {
    rank: numberOrNull(item.rank),
    sheet: stringOrNull(item.sheet) ?? "Registry",
    company,
    board_url: stringOrNull(item.board_url),
    // Canonical ATS ids keep admin filters/dropdowns stable even when older
    // registry rows were written with mixed casing like "Greenhouse".
    ats: normalizedAts ? normalizeAtsId(normalizedAts) : null,
    total_jobs: numberOrNull(item.total_jobs),
    source: stringOrNull(item.source),
    tier: (stringOrNull(item.tier) as RegistryEntry["tier"] | null) ?? "NEEDS_REVIEW",
    scan_pool: scanPoolOrNull(item.scan_pool),
    sample_url: stringOrNull(item.sample_url),
    last_checked: stringOrNull(item.last_checked) ?? stringOrNull(item.updatedAt),
  };
}

function metaFromItem(item: Record<string, unknown> | null, total: number): SeedRegistry["_meta"] {
  return {
    version: stringOrNull(item?.version) ?? "dynamodb",
    total: numberOrNull(item?.total) ?? total,
    generated: stringOrNull(item?.generated) ?? stringOrNull(item?.updatedAt) ?? undefined,
  };
}

async function loadFromDynamoDb(tableName: string): Promise<SeedRegistry> {
  const entries: RegistryEntry[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;

  do {
    const response = await dynamodb.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :companyPrefix)",
      ExpressionAttributeValues: {
        ":pk": { S: "REGISTRY" },
        ":companyPrefix": { S: "COMPANY#" },
      },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    for (const raw of response.Items ?? []) {
      const entry = itemToRegistryEntry(unmarshall(raw));
      if (entry) entries.push(entry);
    }
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  const metaResponse = await dynamodb.send(new GetItemCommand({
    TableName: tableName,
    Key: {
      pk: { S: "REGISTRY" },
      sk: { S: "META" },
    },
  }));

  const metaItem = metaResponse.Item ? unmarshall(metaResponse.Item) : null;
  return {
    _meta: metaFromItem(metaItem, entries.length),
    companies: entries.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
      || a.company.localeCompare(b.company)),
  };
}

/**
 * Load the registry from DynamoDB in AWS or bundled data/seed_registry.json locally.
 * Idempotent — first call loads, subsequent calls reuse. Pass `force` to
 * reload (e.g., after a hot config push).
 */
export async function loadRegistryCache(opts: { path?: string; force?: boolean } = {}): Promise<CacheState> {
  if (state && !opts.force) return state;
  let parsed: SeedRegistry;
  if (opts.path) {
    const raw = await readFile(opts.path, "utf8");
    parsed = JSON.parse(raw) as SeedRegistry;
  } else if (registryTableName()) {
    parsed = await loadFromDynamoDb(registryTableName() as string);
  } else {
    parsed = bundledRegistry as SeedRegistry;
  }
  state = indexEntries(parsed);
  return state;
}

/** Synchronous lookup. Throws if cache hasn't been loaded yet. */
function ensure(): CacheState {
  if (!state) throw new Error("Registry cache not loaded — call loadRegistryCache() first");
  return state;
}

export function getByCompany(name: string): RegistryEntry | null {
  return ensure().byKey.get(normalizeCompanyKey(name)) ?? null;
}

export function listByAts(ats: string): RegistryEntry[] {
  return ensure().byAts.get(ats.toLowerCase()) ?? [];
}

export function listAll(): RegistryEntry[] {
  return ensure().all;
}

export function listByTier(tier: RegistryEntry["tier"]): RegistryEntry[] {
  return ensure().all.filter((e) => e.tier === tier);
}

/** Phase 2 hook — filter by tenantId. Today returns all (tenant = "default"). */
export function listForTenant(tenantId?: string): RegistryEntry[] {
  const t = tenantId ?? DEFAULT_TENANT;
  if (t === DEFAULT_TENANT) return ensure().all;
  return ensure().all.filter((e) => (e.tenantId ?? DEFAULT_TENANT) === t);
}

export function meta() {
  return ensure().meta;
}

export function loadedAt(): number | null {
  return state?.loadedAt ?? null;
}

/** For tests. */
export function _reset() {
  state = null;
}
