import type { Filter } from "../types";

/**
 * Drop jobs older than `maxDays`. Falls back to `now` if `postedAt` is missing
 * (so postings without dates pass through — fail-open).
 */
export function byPostedDate(maxDays: number): Filter {
  const ms = maxDays * 24 * 60 * 60 * 1000;
  return (jobs, ctx) => {
    const now = new Date(ctx.now).getTime();
    return jobs.filter((j) => {
      if (!j.postedAt) return true; // fail-open: keep undated
      const t = Date.parse(j.postedAt);
      if (Number.isNaN(t)) return true;
      return now - t <= ms;
    });
  };
}

export const lastWeek = byPostedDate(7);
export const lastMonth = byPostedDate(30);
