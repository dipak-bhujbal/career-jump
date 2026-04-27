/**
 * Registry-driven scrape service.
 *
 * Reads from the in-memory registry cache, dispatches to the right ATS
 * adapter via the shared adapter registry, then runs the jobs/ pipeline.
 *
 * This is the new path. The legacy `services/inventory.ts` flow (config-
 * driven via runtimeConfig.companies) stays as-is and is unaffected.
 *
 * Flow:
 *   loadRegistryCache() once on cold start
 *   scrapeOne(name) / scrapeMany(filter) / scrapeAll() at request time
 */
import type { JobPosting, RuntimeConfig } from "../types";
import { fetchJobsForEntry, type RegistryEntry } from "../ats/registry";
import { loadRegistryCache, listByTier, listForTenant, getByCompany, listByAts } from "../storage/registry-cache";
import { pipe, filters, enrichers, reducers } from "../jobs";
import type { FilterContext } from "../jobs";

export type ScrapeOptions = {
  /** Run the default transform pipeline before returning. Default: true. */
  applyPipeline?: boolean;
  /** Override the pipeline stages. Implies applyPipeline=true. */
  pipelineStages?: ReturnType<typeof defaultPipeline>;
  /** Tenant scope (Phase 2). */
  tenantId?: string;
};

export type ScrapeResult = {
  entry: RegistryEntry;
  jobs: JobPosting[];
  /** Stage at which this entry resolved: 'fetched' / 'unsupported' / 'error'. */
  status: "fetched" | "unsupported" | "error";
  error?: string;
  ms: number;
};

function defaultPipeline() {
  return [
    enrichers.normalizeLocation,
    enrichers.extractSeniority,
    enrichers.extractCompType,
    enrichers.extractSalary,
    enrichers.computeFingerprint,
    reducers.dedupeByApplyUrl,
    reducers.dedupeByFingerprint,
  ];
}

function buildContext(config: RuntimeConfig, tenantId?: string): FilterContext {
  return {
    config,
    now: new Date().toISOString(),
    tenantId,
  };
}

/**
 * Scrape one company by name (case-insensitive lookup against the registry).
 */
export async function scrapeOne(
  companyName: string,
  config: RuntimeConfig,
  options: ScrapeOptions = {},
): Promise<ScrapeResult | null> {
  await loadRegistryCache();
  const entry = getByCompany(companyName);
  if (!entry) return null;
  return scrapeEntry(entry, config, options);
}

/** Scrape all entries matching a filter (defaults to TIER 1 only). */
export async function scrapeMany(
  filter: (entry: RegistryEntry) => boolean,
  config: RuntimeConfig,
  options: ScrapeOptions = {},
): Promise<ScrapeResult[]> {
  await loadRegistryCache();
  const tenantEntries = listForTenant(options.tenantId);
  const targets = tenantEntries.filter(filter);
  return Promise.all(targets.map((e) => scrapeEntry(e, config, options)));
}

/** Convenience: scrape every TIER 1 entry. */
export async function scrapeAllTier1(
  config: RuntimeConfig,
  options: ScrapeOptions = {},
): Promise<ScrapeResult[]> {
  await loadRegistryCache();
  const targets = listByTier("TIER1_VERIFIED");
  return Promise.all(targets.map((e) => scrapeEntry(e, config, options)));
}

/** Scrape every entry of a given ATS (e.g., all Workday boards). */
export async function scrapeByAts(
  ats: string,
  config: RuntimeConfig,
  options: ScrapeOptions = {},
): Promise<ScrapeResult[]> {
  await loadRegistryCache();
  const targets = listByAts(ats);
  return Promise.all(targets.map((e) => scrapeEntry(e, config, options)));
}

async function scrapeEntry(
  entry: RegistryEntry,
  config: RuntimeConfig,
  options: ScrapeOptions,
): Promise<ScrapeResult> {
  const t0 = Date.now();
  let raw: JobPosting[] | null = null;
  try {
    raw = await fetchJobsForEntry(entry);
  } catch (e) {
    return {
      entry,
      jobs: [],
      status: "error",
      error: (e as Error).message,
      ms: Date.now() - t0,
    };
  }
  if (raw === null) {
    return { entry, jobs: [], status: "unsupported", ms: Date.now() - t0 };
  }
  const apply = options.applyPipeline ?? true;
  if (!apply) {
    return { entry, jobs: raw, status: "fetched", ms: Date.now() - t0 };
  }
  const stages = options.pipelineStages ?? defaultPipeline();
  const ctx = buildContext(config, options.tenantId);
  const jobs = await pipe(raw, ctx, ...stages);
  return { entry, jobs, status: "fetched", ms: Date.now() - t0 };
}
