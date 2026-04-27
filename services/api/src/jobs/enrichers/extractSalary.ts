import type { Enricher } from "../types";

/**
 * Parse compensation from description (when present). Adds `salary`:
 *   { min, max, currency, period }  (period: hour | year)
 *
 * Looks for common US-style ranges:
 *   "$120,000 - $180,000", "$120k-$180k", "120,000 to 180,000 USD",
 *   "$60/hr", "60–80 USD/hour"
 */

type Salary = { min?: number; max?: number; currency?: string; period?: "hour" | "year" };

const RANGE = /\$?\s*([\d,]+(?:\.\d+)?\s*[KkMm]?)\s*(?:-|–|to)\s*\$?\s*([\d,]+(?:\.\d+)?\s*[KkMm]?)\s*(USD|EUR|GBP|CAD|AUD)?/;
const HOURLY = /\$?\s*([\d,]+(?:\.\d+)?)\s*(?:-|–|to)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(?:USD|EUR|GBP|CAD|AUD)?\s*\/\s*(?:hr|hour|h\b)/i;
const SINGLE_K = /\$\s*([\d,]+(?:\.\d+)?\s*[KkMm]?)/;

function parseAmount(s: string): number {
  const cleaned = s.replace(/[\s,$]/g, "");
  const m = cleaned.match(/([\d.]+)([kKmM])?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2]?.toLowerCase() === "k") n *= 1_000;
  if (m[2]?.toLowerCase() === "m") n *= 1_000_000;
  return Math.round(n);
}

function parse(text: string): Salary | null {
  if (!text) return null;
  const hr = text.match(HOURLY);
  if (hr) {
    return {
      min: Math.round(parseFloat(hr[1].replace(/,/g, ""))),
      max: Math.round(parseFloat(hr[2].replace(/,/g, ""))),
      currency: "USD",
      period: "hour",
    };
  }
  const r = text.match(RANGE);
  if (r) {
    const min = parseAmount(r[1]);
    const max = parseAmount(r[2]);
    if (min > 0 && max > 0 && max < min * 100) {
      return { min, max, currency: r[3] ?? "USD", period: min < 1000 ? "hour" : "year" };
    }
  }
  const single = text.match(SINGLE_K);
  if (single) {
    const v = parseAmount(single[1]);
    if (v > 0) return { min: v, max: v, currency: "USD", period: v < 1000 ? "hour" : "year" };
  }
  return null;
}

export const extractSalary: Enricher<{ salary?: Salary }> = (jobs) =>
  jobs.map((j) => {
    const desc = (j as { description?: string }).description ?? "";
    const salary = parse(desc + " " + j.title);
    return salary ? { ...j, salary } : { ...j };
  });
