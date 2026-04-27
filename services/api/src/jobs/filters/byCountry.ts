import type { Filter } from "../types";

/**
 * Keep only jobs whose location matches one of the listed countries.
 * Default match is loose substring on the location string (case-insensitive).
 *
 * For a tighter match, run `enrichers/normalizeLocation` first, which
 * structures location into city/state/country fields.
 */

const ALIASES: Record<string, string[]> = {
  US: ["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "america"],
  UK: ["uk", "u.k.", "united kingdom", "england", "scotland", "wales", "northern ireland", "great britain"],
  Canada: ["canada", "ca"],
  Germany: ["germany", "deutschland", "de"],
  India: ["india", "in"],
  Australia: ["australia", "au"],
  Singapore: ["singapore", "sg"],
  Ireland: ["ireland", "ie"],
  France: ["france", "fr"],
  Netherlands: ["netherlands", "nl"],
  Mexico: ["mexico", "mx"],
  Japan: ["japan", "jp"],
};

function matchesCountry(location: string, country: string): boolean {
  const loc = location.toLowerCase();
  const aliases = ALIASES[country] ?? [country.toLowerCase()];
  return aliases.some((a) => new RegExp(`\\b${a.replace(/\./g, "\\.")}\\b`).test(loc));
}

export function byCountry(countries: string[]): Filter {
  return (jobs) =>
    jobs.filter((j) => {
      if (!j.location) return false;
      return countries.some((c) => matchesCountry(j.location, c));
    });
}

export const usOnly: Filter = byCountry(["US"]);
