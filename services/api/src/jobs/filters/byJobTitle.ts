import type { Filter } from "../types";

/**
 * Apply the project's runtime jobtitles config (jobtitles.json) — runs the
 * include/exclude lists from RuntimeConfig.jobtitles.
 *
 * This is the production filter used by the existing inventory pipeline; it
 * wraps `byKeywords` but pulls the keyword lists from FilterContext.config.
 */
import { byKeywords } from "./byKeywords";

export const byJobTitle: Filter = (jobs, ctx) => {
  const { includeKeywords = [], excludeKeywords = [] } = ctx.config.jobtitles ?? {};
  return byKeywords(includeKeywords, excludeKeywords)(jobs, ctx);
};
