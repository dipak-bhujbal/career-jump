import type { Filter } from "../types";

/**
 * Filter jobs by department / function. Match is case-insensitive substring.
 * Useful when an ATS exposes consistent department labels.
 */
export function byDepartment(departments: string[]): Filter {
  const ci = departments.map((d) => d.toLowerCase());
  return (jobs) =>
    jobs.filter((j) => {
      const dep = ((j as { department?: string }).department ?? "").toLowerCase();
      if (!dep) return true; // missing department → pass through
      return ci.some((d) => dep.includes(d));
    });
}
