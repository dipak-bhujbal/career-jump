import type { Enricher } from "../types";

/**
 * Derive employmentType from title. Adds `employmentType`:
 *   "fulltime" | "contract" | "parttime" | "intern" | "temporary"
 */

type EmpType = "fulltime" | "contract" | "parttime" | "intern" | "temporary";

const RULES: Array<[EmpType, RegExp]> = [
  ["intern", /\b(intern|internship|co-?op|trainee|apprentice)\b/i],
  ["contract", /\b(contract|contractor|consultant|freelance|c2c|1099|independent)\b/i],
  ["parttime", /\b(part\s*-?\s*time|p\/t|pt\b)\b/i],
  ["temporary", /\b(temporary|temp\b|seasonal|fixed[-\s]?term)\b/i],
];

export const extractCompType: Enricher<{ employmentType?: EmpType }> = (jobs) =>
  jobs.map((j) => {
    const t = j.title ?? "";
    for (const [type, re] of RULES) {
      if (re.test(t)) return { ...j, employmentType: type };
    }
    return { ...j, employmentType: "fulltime" }; // default — most postings are FTE
  });
