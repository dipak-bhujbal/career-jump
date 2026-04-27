import type { JobPosting, RuntimeConfig } from "../types";

/**
 * Pipeline context passed to every filter/enricher/reducer. Add new fields
 * here when you need cross-cutting state (per-tenant config, user prefs, etc.).
 */
export type FilterContext = {
  config: RuntimeConfig;
  /** ISO timestamp the pipeline started (filters that depend on "now" should use this). */
  now: string;
  /** Phase 2: tenant id used for per-tenant overrides. */
  tenantId?: string;
  /** Optional per-user preferences (Phase 2). */
  user?: UserPreferences;
};

export type UserPreferences = {
  countries?: string[];
  remotePreference?: "any" | "remote-only" | "onsite-only";
  includeKeywords?: string[];
  excludeKeywords?: string[];
  seniorities?: SeniorityLevel[];
  minPostedSinceDays?: number;
};

export type SeniorityLevel = "intern" | "junior" | "mid" | "senior" | "staff" | "principal" | "manager" | "director" | "vp" | "exec";

/**
 * A pipeline stage. Each stage is a single function that takes jobs in and
 * returns jobs out (filter or reducer) or jobs with extra fields (enricher).
 *
 * Stages must be:
 *   - **Pure** w.r.t. the input array (no mutation in place; return a new array)
 *   - **Stateless** between invocations (use FilterContext for dynamic state)
 *   - **Async-safe** (return a Promise or value; runner awaits)
 */
export type Stage<I = JobPosting, O = JobPosting> = (
  jobs: I[],
  ctx: FilterContext,
) => O[] | Promise<O[]>;

/** Convenience aliases — same shape, different intent. */
export type Filter = Stage;
export type Enricher<E = Record<string, unknown>> = Stage<JobPosting, JobPosting & E>;
export type Reducer = Stage;

/**
 * Stateful stage — for cross-batch dedup (DDB-backed) or LLM enrichment that
 * needs per-run setup/teardown.
 */
export interface StatefulStage<I = JobPosting, O = JobPosting> {
  init?: (ctx: FilterContext) => Promise<void> | void;
  process: Stage<I, O>;
  finalize?: (ctx: FilterContext) => Promise<void> | void;
}
