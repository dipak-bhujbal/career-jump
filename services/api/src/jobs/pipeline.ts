import type { JobPosting } from "../types";
import type { FilterContext, Stage, StatefulStage } from "./types";

/**
 * Compose stages into a single pipeline.
 *
 * Usage:
 *   const filtered = await pipe(rawJobs, ctx,
 *     enrichers.normalizeLocation,
 *     filters.byCountry(["US", "Canada"]),
 *     enrichers.extractSeniority,
 *     reducers.dedupeByFingerprint,
 *   );
 *
 * Stages run **sequentially** — order matters. Put enrichers before filters
 * that depend on the enriched fields.
 */
export async function pipe(
  jobs: JobPosting[],
  ctx: FilterContext,
  ...stages: Stage[]
): Promise<JobPosting[]> {
  let current: JobPosting[] = jobs;
  for (const stage of stages) {
    current = await stage(current, ctx);
  }
  return current;
}

/**
 * Run a stateful stage. Use when a stage needs per-run setup/teardown
 * (e.g., DB connection, LLM client warmup, batch dedup table).
 */
export async function runStateful(
  jobs: JobPosting[],
  ctx: FilterContext,
  stage: StatefulStage,
): Promise<JobPosting[]> {
  if (stage.init) await stage.init(ctx);
  try {
    return await stage.process(jobs, ctx);
  } finally {
    if (stage.finalize) await stage.finalize(ctx);
  }
}

/** Convenience builder: gather a pipeline definition once, run many times. */
export function buildPipeline(...stages: Stage[]) {
  return (jobs: JobPosting[], ctx: FilterContext) => pipe(jobs, ctx, ...stages);
}
