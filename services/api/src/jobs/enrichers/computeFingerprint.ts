import type { Enricher } from "../types";

/**
 * Compute a stable fingerprint per job. Adds `fingerprint` (16-hex prefix of
 * SHA-256). Used by the dedupe reducer + the existing discard registry in
 * career-jump-aws v3.1.
 *
 * Inputs to the hash:
 *   - normalized title (lowercased, punctuation stripped)
 *   - normalized location
 *   - first 200 chars of normalized description
 *
 * NOT included: company. So the same role posted to multiple ATSes (typical
 * for staffing-firm aggregators) collapses to one fingerprint.
 */

import { createHash } from "node:crypto";

function normalize(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const computeFingerprint: Enricher<{ fingerprint: string }> = (jobs) =>
  jobs.map((j) => {
    const desc = (j as { description?: string }).description ?? "";
    const sig =
      normalize(j.title ?? "") + "|" +
      normalize(j.location ?? "") + "|" +
      normalize(desc).slice(0, 200);
    const fingerprint = createHash("sha256").update(sig).digest("hex").slice(0, 16);
    return { ...j, fingerprint };
  });
