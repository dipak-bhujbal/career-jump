import type { Reducer } from "../types";

/**
 * Drop duplicates by canonical apply URL (case-insensitive, query-stripped).
 * Cheaper than the fingerprint dedupe — use as a fast first pass.
 */
export const dedupeByApplyUrl: Reducer = (jobs) => {
  const seen = new Set<string>();
  const out = [];
  for (const j of jobs) {
    if (!j.url) { out.push(j); continue; }
    const key = j.url.toLowerCase().split(/[?#]/)[0].replace(/\/+$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(j);
  }
  return out;
};
