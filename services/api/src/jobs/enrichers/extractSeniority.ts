import type { Enricher, SeniorityLevel } from "../types";

/**
 * Pattern-match the job title to derive a seniority level. Adds `seniority`.
 *
 * Order matters — most specific patterns first so "Senior Staff" → staff, not senior.
 */

const RULES: Array<[SeniorityLevel, RegExp]> = [
  ["exec", /\b(chief|cto|cio|cpo|cfo|ceo|coo|c-?suite)\b/i],
  ["vp", /\b(vp|vice\s+president)\b/i],
  ["director", /\b(director|head\s+of)\b/i],
  ["manager", /\b(manager|mgr|lead\b(?!.*engineer))\b/i],
  ["principal", /\b(principal|distinguished|fellow)\b/i],
  ["staff", /\b(staff)\b/i],
  ["senior", /\b(senior|sr\.?|sr$|lead\s+(?:engineer|developer|designer))\b/i],
  ["mid", /\b(mid\b|mid-level|ii|iii)\b/i],
  ["junior", /\b(junior|jr\.?|associate|entry|graduate|grad\b|new\s+grad)\b/i],
  ["intern", /\b(intern|internship|co-?op|trainee|apprentice)\b/i],
];

function classify(title: string): SeniorityLevel | null {
  for (const [level, re] of RULES) {
    if (re.test(title)) return level;
  }
  return null;
}

export const extractSeniority: Enricher<{ seniority?: SeniorityLevel }> = (jobs) =>
  jobs.map((j) => {
    const seniority = classify(j.title ?? "");
    return seniority ? { ...j, seniority } : { ...j };
  });
