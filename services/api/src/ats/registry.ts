/**
 * Seed registry consumer + ATS dispatcher.
 *
 * The registry JSON (data/seed_registry.json) is published by the
 * ats-discovery-agent project. Each entry has:
 *   { company, board_url, ats, total_jobs, tier, ... }
 *
 * This module loads the registry and dispatches `count` and `fetchJobs` to the
 * right adapter based on the entry's `ats` field. Adapters self-register in
 * `shared/init-core.ts` (auto-imported below) and `custom/index.ts`.
 */
import "./shared/init-core";
import "./custom"; // self-registers all custom adapters

import type { JobPosting } from "../types";
import { getAdapter, listAdapters } from "./shared/types";
import { inferAtsIdFromUrl, normalizeAtsId } from "./shared/normalize";
import type { RegistryScanPool } from "../types";

export type RegistryEntry = {
  rank: number | null;
  sheet: string;
  company: string;
  board_url: string | null;
  ats: string | null;
  total_jobs: number | null;
  source: string | null;
  tier: "TIER1_VERIFIED" | "TIER2_MEDIUM" | "TIER3_LOW" | "NEEDS_REVIEW";
  /**
   * Optional admin override for scheduler cadence. When unset, scheduling
   * still falls back to the curated/rank-derived hot/warm/cold heuristics.
   */
  scan_pool?: RegistryScanPool | null;
  from?: string;
  sample_url?: string | null;
  last_checked?: string | null;
  /** Optional multi-board support (cross-ATS companies). */
  boards?: Array<{ ats: string; url: string; total_jobs?: number }>;
  /** Phase 2: tenant scoping. Currently unused at runtime. */
  tenantId?: string;
};

export type SeedRegistry = {
  _meta: { version: string; total: number; generated?: string; tenantId?: string };
  companies: RegistryEntry[];
};

export function loadRegistry(json: unknown): SeedRegistry {
  return json as SeedRegistry;
}

/**
 * Resolve the adapter for an entry. Custom adapters (keyed by company id)
 * win over generic ATS adapters when both apply.
 */
function adapterCandidates(entry: RegistryEntry) {
  const candidates = new Set<string>();

  // Company-specific adapters always win when they exist.
  candidates.add(`custom:${normalizeCompanyKey(entry.company)}`);

  const normalizedAts = normalizeAtsId(entry.ats);
  if (normalizedAts) candidates.add(normalizedAts);

  // Some rows are missing ATS labels or store older labels that are less
  // reliable than the canonical board URL. Use the URL as a fallback hint.
  const inferred = inferAtsIdFromUrl(entry.sample_url || entry.board_url);
  if (inferred) candidates.add(normalizeAtsId(inferred));

  // Generic custom scraping is the last resort for otherwise valid boards.
  candidates.add("custom-jsonld");
  candidates.add("custom-sitemap");

  return Array.from(candidates)
    .map((id) => getAdapter(id))
    .filter((adapter): adapter is NonNullable<ReturnType<typeof getAdapter>> => Boolean(adapter));
}

export function resolveAdapter(entry: RegistryEntry) {
  return adapterCandidates(entry)[0] ?? null;
}

function normalizeCompanyKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function countJobs(entry: RegistryEntry): Promise<number> {
  if (!entry.board_url) return 0;
  for (const adapter of adapterCandidates(entry)) {
    try {
      const count = await adapter.count({ boardUrl: entry.board_url, tenantId: entry.tenantId });
      if (count > 0) return count;
    } catch {
      // Keep trying fallbacks so one brittle adapter does not block the row.
    }
  }
  return 0;
}

export async function fetchJobsForEntry(entry: RegistryEntry): Promise<JobPosting[] | null> {
  if (!entry.board_url) return null;
  for (const adapter of adapterCandidates(entry)) {
    try {
      const jobs = await adapter.fetchJobs(
        { boardUrl: entry.board_url, tenantId: entry.tenantId },
        entry.company,
      );
      if (jobs.length > 0) return jobs;
    } catch {
      // Fall through to the next adapter candidate for resilient scanning.
    }
  }
  return [];
}

/** Diagnostic: return all registered adapter ids. */
export function registeredAdapterIds(): string[] {
  return listAdapters().map((a) => a.id);
}
