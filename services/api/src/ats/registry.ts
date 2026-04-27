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
import { normalizeAtsId } from "./shared/normalize";

export type RegistryEntry = {
  rank: number | null;
  sheet: string;
  company: string;
  board_url: string | null;
  ats: string | null;
  total_jobs: number | null;
  source: string | null;
  tier: "TIER1_VERIFIED" | "TIER2_MEDIUM" | "TIER3_LOW" | "NEEDS_REVIEW";
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
export function resolveAdapter(entry: RegistryEntry) {
  // Custom-by-company wins
  const customId = `custom:${normalizeCompanyKey(entry.company)}`;
  const custom = getAdapter(customId);
  if (custom) return custom;
  // Generic ATS adapter
  if (entry.ats) {
    const generic = getAdapter(normalizeAtsId(entry.ats));
    if (generic) return generic;
  }
  return null;
}

function normalizeCompanyKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export async function countJobs(entry: RegistryEntry): Promise<number> {
  if (!entry.board_url) return 0;
  const adapter = resolveAdapter(entry);
  if (!adapter) return 0;
  return adapter.count({ boardUrl: entry.board_url, tenantId: entry.tenantId });
}

export async function fetchJobsForEntry(entry: RegistryEntry): Promise<JobPosting[] | null> {
  if (!entry.board_url) return null;
  const adapter = resolveAdapter(entry);
  if (!adapter) return null;
  return adapter.fetchJobs(
    { boardUrl: entry.board_url, tenantId: entry.tenantId },
    entry.company,
  );
}

/** Diagnostic: return all registered adapter ids. */
export function registeredAdapterIds(): string[] {
  return listAdapters().map((a) => a.id);
}
