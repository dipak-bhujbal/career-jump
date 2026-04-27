import type { CompanyInput, DetectedConfig, JobPosting } from "../../types";

/**
 * Unified contract for every ATS adapter (core or custom).
 *
 * Adapters are PURE I/O — they fetch raw jobs from a single ATS provider for
 * a single tenant/board and return them. Filtering, enrichment, dedup and any
 * business logic happens downstream in the `jobs/` pipeline.
 *
 * One file per adapter; one adapter per provider (core/) or per company (custom/).
 */
export interface AtsAdapter {
  /** Stable identifier — matches the `ats` field in the seed registry. */
  readonly id: string;

  /** Adapter kind: `core` for multi-tenant providers, `custom` for company-specific. */
  readonly kind: "core" | "custom";

  /** Detect/auto-discover the adapter config for a company. Optional — registry-driven flow may bypass. */
  detect?: (company: CompanyInput) => Promise<DetectedConfig | null>;

  /** Validate a known config (slug/host/etc.) is still live. */
  validate: (config: AdapterConfig) => Promise<boolean>;

  /** Return total job count cheaply (single API call where possible). */
  count: (config: AdapterConfig) => Promise<number>;

  /** Fetch all raw jobs for a company. Pure — no filtering or enrichment. */
  fetchJobs: (config: AdapterConfig, companyName: string, options?: FetchOptions) => Promise<JobPosting[]>;
}

/**
 * Adapter configuration. Loose-typed because each ATS has different keys
 * (slug vs host vs site number, etc.). Each adapter narrows it internally.
 *
 * Persisted in the seed registry as `board_url` + `ats`; adapters parse the
 * URL to derive the slug/host/etc.
 */
export type AdapterConfig = {
  /** Canonical board URL stored in the registry. */
  boardUrl: string;
  /** Optional pre-parsed config (avoids re-parsing on every call). */
  parsed?: Record<string, string>;
  /** Future: tenantId for multi-tenant filtering / per-tenant overrides. */
  tenantId?: string;
};

export type FetchOptions = {
  /** Cap pages to limit time/cost. */
  maxPages?: number;
  /** Page size override. */
  pageSize?: number;
  /** Optional abort signal for cancellation. */
  signal?: AbortSignal;
};

/**
 * Adapter registry — populated by importing each adapter module (which
 * registers itself via `registerAdapter`). The dispatcher (../registry.ts)
 * looks up by `ats` field from the seed registry.
 */
const adapters = new Map<string, AtsAdapter>();

export function registerAdapter(adapter: AtsAdapter): void {
  const key = adapter.id.toLowerCase();
  if (adapters.has(key)) {
    throw new Error(`Duplicate adapter registration: ${adapter.id}`);
  }
  adapters.set(key, adapter);
}

export function getAdapter(id: string): AtsAdapter | null {
  return adapters.get(id.toLowerCase()) ?? null;
}

export function listAdapters(): AtsAdapter[] {
  return Array.from(adapters.values());
}

/** For tests — clear the in-memory registry. */
export function _clearAdapters(): void {
  adapters.clear();
}
