import type { Reducer } from "../types";

/**
 * Sort jobs by relevance signals. Doesn't drop any.
 *
 * Score (higher is better):
 *   +5 per matched user includeKeyword in title
 *   +3 if location matches a preferred country (when ctx.user.countries set)
 *   +2 if posted within 14 days
 *   -2 if posted older than 60 days
 */
export const rankByRelevance: Reducer = (jobs, ctx) => {
  const include = (ctx.user?.includeKeywords ?? ctx.config.jobtitles?.includeKeywords ?? []).map((k) => k.toLowerCase());
  const countries = (ctx.user?.countries ?? []).map((c) => c.toLowerCase());
  const now = new Date(ctx.now).getTime();

  function score(j: (typeof jobs)[number]): number {
    let s = 0;
    const t = (j.title ?? "").toLowerCase();
    for (const k of include) if (t.includes(k)) s += 5;
    if (countries.length) {
      const loc = (j.location ?? "").toLowerCase();
      if (countries.some((c) => loc.includes(c))) s += 3;
    }
    if (j.postedAt) {
      const age = (now - Date.parse(j.postedAt)) / (24 * 60 * 60 * 1000);
      if (age <= 14) s += 2;
      else if (age > 60) s -= 2;
    }
    return s;
  }

  return [...jobs].sort((a, b) => score(b) - score(a));
};
