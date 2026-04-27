import type { Filter } from "../types";

/**
 * Title/description keyword inclusion+exclusion filter.
 *
 * Match is case-insensitive substring against `title` (and optionally
 * the description, opt-in via `searchDescription`).
 *
 * - includeKeywords: job must match ≥1 (OR-semantics)
 * - excludeKeywords: job must match 0 (AND-semantics on negation)
 */
export function byKeywords(
  includeKeywords: string[] = [],
  excludeKeywords: string[] = [],
  options: { searchDescription?: boolean } = {},
): Filter {
  const includes = includeKeywords.map((k) => k.toLowerCase());
  const excludes = excludeKeywords.map((k) => k.toLowerCase());
  const includeRequired = includes.length > 0;
  const excludeRequired = excludes.length > 0;

  return (jobs) =>
    jobs.filter((j) => {
      const haystack = (j.title + (options.searchDescription ? " " + ((j as { description?: string }).description ?? "") : "")).toLowerCase();
      if (includeRequired && !includes.some((k) => haystack.includes(k))) return false;
      if (excludeRequired && excludes.some((k) => haystack.includes(k))) return false;
      return true;
    });
}
