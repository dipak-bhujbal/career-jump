import type { Filter } from "../types";

/**
 * Location-based filtering.
 *
 * - byCity / byState: match against location string
 * - remoteOnly: keep only jobs that look remote
 * - excludeRemote: drop remote-only postings
 */

const REMOTE_RE = /\b(remote|work\s+from\s+home|wfh|anywhere|distributed)\b/i;
const HYBRID_RE = /\bhybrid\b/i;

export const remoteOnly: Filter = (jobs) =>
  jobs.filter((j) => REMOTE_RE.test(j.location ?? ""));

export const excludeRemote: Filter = (jobs) =>
  jobs.filter((j) => !REMOTE_RE.test(j.location ?? ""));

export const onsiteOnly: Filter = (jobs) =>
  jobs.filter((j) => {
    const loc = j.location ?? "";
    return !REMOTE_RE.test(loc) && !HYBRID_RE.test(loc);
  });

export function byCity(cities: string[]): Filter {
  const ci = cities.map((c) => c.toLowerCase());
  return (jobs) => jobs.filter((j) => ci.some((c) => (j.location ?? "").toLowerCase().includes(c)));
}

export function byState(states: string[]): Filter {
  const ci = states.map((s) => s.toLowerCase());
  return (jobs) => jobs.filter((j) => ci.some((s) => (j.location ?? "").toLowerCase().includes(s)));
}
