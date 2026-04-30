/**
 * Wraps existing core adapter functions into the AtsAdapter interface and
 * self-registers them. Importing this module populates the adapter registry.
 *
 * Each existing adapter file (greenhouse.ts / lever.ts / etc.) was originally
 * built with separate exports (`detectX`, `validateXSlug`, `fetchXJobs`) — we
 * keep those for back-compat and synthesize an AtsAdapter on top of them.
 */
import { fetchAshbyJobs, validateAshbySlug } from "../core/ashby";
import { fetchGreenhouseJobs, validateGreenhouseToken } from "../core/greenhouse";
import { fetchLeverJobs, validateLeverSite } from "../core/lever";
import { fetchSmartRecruitersJobs, detectSmartRecruiters } from "../core/smartrecruiters";
import { fetchWorkdayJobs } from "../core/workday";
import {
  countEightfoldJobs,
  fetchEightfoldJobs,
  fetchEightfoldWhitelabelJobs,
  parseEightfoldBoardUrl,
  validateEightfoldSlug,
} from "../core/eightfold";
import { countPhenomJobs, fetchPhenomJobs, validatePhenomSlug } from "../core/phenom";
import { countJobviteJobs, fetchJobviteJobs, validateJobviteSlug } from "../core/jobvite";
import { countIcimsJobs, fetchIcimsJobs, validateIcimsSlug } from "../core/icims";
import {
  countOracleJobs,
  fetchOracleJobs,
  parseOracleBoardUrl,
  validateOracleConfig,
} from "../core/oracle";
import { countWorkableJobs, fetchWorkableJobs, validateWorkableSlug } from "../core/workable";
import { countBreezyJobs, fetchBreezyJobs, validateBreezySlug } from "../core/breezy";
import { countRecruiteeJobs, fetchRecruiteeJobs, validateRecruiteeSlug } from "../core/recruitee";
import { countBambooJobs, fetchBambooJobs, validateBambooSlug } from "../core/bamboohr";
import {
  countSuccessfactorsJobs,
  fetchSuccessfactorsJobs,
  parseSuccessfactorsBoardUrl,
  validateSuccessfactorsConfig,
} from "../core/successfactors";
import { countTaleoJobs, fetchTaleoJobs, parseTaleoBoardUrl, validateTaleoConfig } from "../core/taleo";
import { atsJson } from "./http";
import { lastPathSegment, subdomain } from "./slug";
import { registerAdapter, type AdapterConfig, type AtsAdapter } from "./types";

const HEADERS = { Accept: "application/json" };

function workdayParts(boardUrl: string): { host: string; sub: string; tenant: string } | null {
  try {
    const u = new URL(boardUrl);
    const seg = u.pathname.split("/").filter(Boolean);
    if (!seg.length) return null;
    return { host: u.hostname, sub: u.hostname.split(".")[0], tenant: seg[seg.length - 1] };
  } catch {
    return null;
  }
}

function greenhouseBoardToken(boardUrl: string): string {
  const url = new URL(boardUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const host = url.hostname.toLowerCase();
  const queryBoardToken = url.searchParams.get("for")?.trim();
  if (queryBoardToken) return queryBoardToken;
  if (host === "boards-api.greenhouse.io" && parts[0] === "v1" && parts[1] === "boards" && parts[2]) {
    return parts[2];
  }
  if (url.searchParams.get("gh_jid")?.trim() && parts[0]) {
    return parts[0];
  }
  return parts[0] ?? "";
}

const adapters: AtsAdapter[] = [
  {
    id: "workday",
    kind: "core",
    async validate(c) {
      const w = workdayParts(c.boardUrl);
      if (!w) return false;
      const r = await atsJson<{ total?: number }>(`https://${w.host}/wday/cxs/${w.sub}/${w.tenant}/jobs`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0 }),
      });
      return r !== null;
    },
    async count(c) {
      const w = workdayParts(c.boardUrl);
      if (!w) return 0;
      const r = await atsJson<{ total?: number }>(`https://${w.host}/wday/cxs/${w.sub}/${w.tenant}/jobs`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0 }),
      });
      return r?.total ?? 0;
    },
    async fetchJobs(c, company) {
      const w = workdayParts(c.boardUrl);
      if (!w) return [];
      // Existing core Workday fetcher expects both the tenant hostname label
      // and the board/site token extracted from the canonical board URL.
      return fetchWorkdayJobs(company, { host: w.host, tenant: w.sub, site: w.tenant }, []);
    },
  },
  {
    id: "greenhouse",
    kind: "core",
    async validate(c) {
      const slug = greenhouseBoardToken(c.boardUrl);
      const cfg = await validateGreenhouseToken(slug);
      return cfg !== null;
    },
    async count(c) {
      const slug = greenhouseBoardToken(c.boardUrl);
      const r = await atsJson<{ meta?: { total?: number }; jobs?: unknown[] }>(
        `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`,
      );
      return r?.meta?.total ?? r?.jobs?.length ?? 0;
    },
    async fetchJobs(c, company) {
      const slug = greenhouseBoardToken(c.boardUrl);
      return fetchGreenhouseJobs(company, slug);
    },
  },
  {
    id: "lever",
    kind: "core",
    async validate(c) {
      const slug = lastPathSegment(c.boardUrl);
      const cfg = await validateLeverSite(slug);
      return cfg !== null;
    },
    async count(c) {
      const slug = lastPathSegment(c.boardUrl);
      const arr = await atsJson<unknown[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      return Array.isArray(arr) ? arr.length : 0;
    },
    async fetchJobs(c, company) {
      const slug = lastPathSegment(c.boardUrl);
      return fetchLeverJobs(company, slug);
    },
  },
  {
    id: "ashby",
    kind: "core",
    async validate(c) {
      const slug = lastPathSegment(c.boardUrl);
      const cfg = await validateAshbySlug(slug);
      return cfg !== null;
    },
    async count(c) {
      const slug = lastPathSegment(c.boardUrl);
      const r = await atsJson<{ jobs?: unknown[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      return r?.jobs?.length ?? 0;
    },
    async fetchJobs(c, company) {
      const slug = lastPathSegment(c.boardUrl);
      return fetchAshbyJobs(company, slug);
    },
  },
  {
    id: "smartrecruiters",
    kind: "core",
    async validate(c) {
      const slug = lastPathSegment(c.boardUrl);
      const cfg = await detectSmartRecruiters({ company: slug });
      return cfg !== null;
    },
    async count(c) {
      const slug = lastPathSegment(c.boardUrl);
      const r = await atsJson<{ totalFound?: number }>(
        `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
      );
      return r?.totalFound ?? 0;
    },
    async fetchJobs(c, company) {
      const slug = lastPathSegment(c.boardUrl);
      return fetchSmartRecruitersJobs(company, slug);
    },
  },
  {
    id: "eightfold",
    kind: "core",
    async validate(c) {
      const parsed = parseEightfoldBoardUrl(c.boardUrl);
      if (!parsed) return false;
      if (parsed.type === "whitelabel") return true; // pcsx URL stored = already validated
      return (await validateEightfoldSlug(parsed.slug)) !== null;
    },
    async count(c) {
      const parsed = parseEightfoldBoardUrl(c.boardUrl);
      if (!parsed) return 0;
      if (parsed.type === "whitelabel") {
        const jobs = await fetchEightfoldWhitelabelJobs(parsed.careersBaseUrl, parsed.domainParam, "", { maxPages: 1 });
        return jobs.length;
      }
      return countEightfoldJobs(parsed.slug);
    },
    async fetchJobs(c, company) {
      const parsed = parseEightfoldBoardUrl(c.boardUrl);
      if (!parsed) return [];
      if (parsed.type === "whitelabel") {
        return fetchEightfoldWhitelabelJobs(parsed.careersBaseUrl, parsed.domainParam, company);
      }
      return fetchEightfoldJobs(parsed.slug, company);
    },
  },
  {
    id: "phenom",
    kind: "core",
    async validate(c) {
      // Phenom custom domains encode tenant details in the full board URL, so
      // validation must use the canonical board URL instead of a guessed slug.
      const r = await validatePhenomSlug(c.boardUrl);
      return r !== null;
    },
    async count(c) {
      return countPhenomJobs(c.boardUrl);
    },
    async fetchJobs(c, company) {
      return fetchPhenomJobs(c.boardUrl, company);
    },
  },
  {
    id: "jobvite",
    kind: "core",
    async validate(c) { const r = await validateJobviteSlug(lastPathSegment(c.boardUrl)); return r !== null; },
    async count(c) { return countJobviteJobs(lastPathSegment(c.boardUrl)); },
    async fetchJobs(c, company) { return fetchJobviteJobs(lastPathSegment(c.boardUrl), company); },
  },
  {
    id: "icims",
    kind: "core",
    async validate(c) {
      // iCIMS boards frequently store `intro` / `dashboard` landing URLs in
      // the registry. The core parser now normalizes and follows those URLs
      // directly instead of reverse-engineering a hostname slug.
      const r = await validateIcimsSlug(c.boardUrl);
      return r !== null;
    },
    async count(c) {
      return countIcimsJobs(c.boardUrl);
    },
    async fetchJobs(c, company) {
      return fetchIcimsJobs(c.boardUrl, company);
    },
  },
  {
    id: "oracle",
    kind: "core",
    async validate(c) {
      const cfg = parseOracleBoardUrl(c.boardUrl);
      return cfg ? validateOracleConfig(cfg) : false;
    },
    async count(c) {
      const cfg = parseOracleBoardUrl(c.boardUrl);
      return cfg ? countOracleJobs(cfg) : 0;
    },
    async fetchJobs(c, company) {
      const cfg = parseOracleBoardUrl(c.boardUrl);
      return cfg ? fetchOracleJobs(cfg, company) : [];
    },
  },
  {
    id: "workable",
    kind: "core",
    async validate(c) { const r = await validateWorkableSlug(lastPathSegment(c.boardUrl)); return r !== null; },
    async count(c) { return countWorkableJobs(lastPathSegment(c.boardUrl)); },
    async fetchJobs(c, company) { return fetchWorkableJobs(lastPathSegment(c.boardUrl), company); },
  },
  {
    id: "breezy",
    kind: "core",
    async validate(c) { const r = await validateBreezySlug(subdomain(c.boardUrl)); return r !== null; },
    async count(c) { return countBreezyJobs(subdomain(c.boardUrl)); },
    async fetchJobs(c, company) { return fetchBreezyJobs(subdomain(c.boardUrl), company); },
  },
  {
    id: "recruitee",
    kind: "core",
    async validate(c) { const r = await validateRecruiteeSlug(subdomain(c.boardUrl)); return r !== null; },
    async count(c) { return countRecruiteeJobs(subdomain(c.boardUrl)); },
    async fetchJobs(c, company) { return fetchRecruiteeJobs(subdomain(c.boardUrl), company); },
  },
  {
    id: "bamboohr",
    kind: "core",
    async validate(c) { const r = await validateBambooSlug(subdomain(c.boardUrl)); return r !== null; },
    async count(c) { return countBambooJobs(subdomain(c.boardUrl)); },
    async fetchJobs(c, company) { return fetchBambooJobs(subdomain(c.boardUrl), company); },
  },
  {
    id: "successfactors",
    kind: "core",
    async validate(c) { const cfg = parseSuccessfactorsBoardUrl(c.boardUrl); return cfg ? validateSuccessfactorsConfig(cfg) : false; },
    async count(c) { const cfg = parseSuccessfactorsBoardUrl(c.boardUrl); return cfg ? countSuccessfactorsJobs(cfg) : 0; },
    async fetchJobs(c, company) { const cfg = parseSuccessfactorsBoardUrl(c.boardUrl); return cfg ? fetchSuccessfactorsJobs(cfg, company) : []; },
  },
  {
    id: "taleo",
    kind: "core",
    async validate(c) { const cfg = parseTaleoBoardUrl(c.boardUrl); return cfg ? validateTaleoConfig(cfg) : false; },
    async count(c) { const cfg = parseTaleoBoardUrl(c.boardUrl); return cfg ? countTaleoJobs(cfg) : 0; },
    async fetchJobs(c, company) { const cfg = parseTaleoBoardUrl(c.boardUrl); return cfg ? fetchTaleoJobs(cfg, company) : []; },
  },
];

let initialized = false;
export function initCoreAdapters(): void {
  if (initialized) return;
  initialized = true;
  for (const a of adapters) registerAdapter(a);
}

// Self-init on import (safe — registerAdapter is idempotent via guard above).
initCoreAdapters();

// Avoid unused-import warnings for the types module.
export type { AdapterConfig };
