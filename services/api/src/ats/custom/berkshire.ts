import { registerAdapter } from "../shared/types";

/**
 * Berkshire Hathaway is a holding company with no centralized ATS.
 * Each subsidiary (BH Specialty, GEICO, BNSF, etc.) has its own.
 *
 * This adapter is a stub: it returns 0 jobs and signals upstream to scan
 * subsidiaries individually. The ats-discovery-agent should populate
 * subsidiary entries with their own (ats, board_url) — those will be matched
 * by core adapters.
 */

registerAdapter({
  id: "custom:berkshirehathaway",
  kind: "custom",
  async validate() {
    return false;
  },
  async count() {
    return 0;
  },
  async fetchJobs() {
    return [];
  },
});
