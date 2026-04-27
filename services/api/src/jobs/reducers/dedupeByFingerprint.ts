import type { Reducer } from "../types";

/**
 * Drop duplicate jobs by their `fingerprint` field (must be added first by
 * `enrichers/computeFingerprint`).
 *
 * Keep-policy: first-wins. If you want company-specific tiebreakers (prefer
 * the smaller / better-known company), sort the input first.
 */
export const dedupeByFingerprint: Reducer = (jobs) => {
  const seen = new Set<string>();
  const out = [];
  for (const j of jobs) {
    const fp = (j as { fingerprint?: string }).fingerprint;
    if (!fp) {
      out.push(j); // no fingerprint → don't drop
      continue;
    }
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(j);
  }
  return out;
};
