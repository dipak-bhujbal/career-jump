import type { Enricher } from "../types";
import { US_STATE_ALIAS_TO_CODE } from "../../lib/us-geo.generated";

/**
 * Parse the free-text `location` string into structured fields.
 * Adds: locationCity, locationState, locationCountry, isRemote, isHybrid.
 *
 * Heuristic-only — no external geocoding. Keeps the original `location`
 * intact so downstream display still works.
 */

const REMOTE_RE = /\b(remote|work\s+from\s+home|wfh|anywhere|distributed)\b/i;
const HYBRID_RE = /\bhybrid\b/i;

const COUNTRY_TOKENS: Record<string, string> = {
  usa: "US", "u.s.a.": "US", "u.s.": "US", us: "US", "united states": "US", america: "US",
  uk: "UK", "u.k.": "UK", "united kingdom": "UK", england: "UK",
  // Include short ISO-like country tokens so job rows ending in ", DE" or
  // ", AR" resolve to the intended country before US-state parsing runs.
  canada: "Canada", germany: "Germany", de: "Germany", argentina: "Argentina", ar: "Argentina", india: "India", australia: "Australia",
  singapore: "Singapore", ireland: "Ireland", france: "France", netherlands: "Netherlands",
  mexico: "Mexico", japan: "Japan", brazil: "Brazil", china: "China",
};

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
  "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);

type LocFields = {
  locationCity?: string;
  locationState?: string;
  locationCountry?: string;
  isRemote?: boolean;
  isHybrid?: boolean;
};

function parse(loc: string): LocFields {
  if (!loc) return {};
  const out: LocFields = {};
  out.isRemote = REMOTE_RE.test(loc);
  out.isHybrid = HYBRID_RE.test(loc);

  const parts = loc.split(/[,/|]/).map((s) => s.trim()).filter(Boolean);
  // Try last-token country
  for (const p of parts) {
    const k = p.toLowerCase();
    if (COUNTRY_TOKENS[k]) { out.locationCountry = COUNTRY_TOKENS[k]; break; }
  }
  // US state: 2-letter code
  for (const p of parts) {
    const upper = p.toUpperCase();
    if (US_STATES.has(upper)) { out.locationState = upper; out.locationCountry ??= "US"; break; }
  }
  // Full state names and common aliases provide a safer fallback than trying
  // to infer the country from generic city-only text.
  if (!out.locationState) {
    for (const p of parts) {
      const mapped = US_STATE_ALIAS_TO_CODE[p.toLowerCase()];
      if (!mapped) continue;
      out.locationState = mapped;
      out.locationCountry ??= "US";
      break;
    }
  }
  // First non-state, non-country token = city
  for (const p of parts) {
    const upper = p.toUpperCase();
    const lower = p.toLowerCase();
    if (US_STATES.has(upper) || COUNTRY_TOKENS[lower]) continue;
    out.locationCity = p;
    break;
  }
  return out;
}

export const normalizeLocation: Enricher<LocFields> = (jobs) =>
  jobs.map((j) => ({ ...j, ...parse(j.location ?? "") }));
