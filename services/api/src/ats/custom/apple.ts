import type { JobPosting } from "../../types";
import { atsJson } from "../shared/http";
import { registerAdapter } from "../shared/types";

/**
 * Apple custom adapter.
 *
 * Apple jobs API: https://jobs.apple.com/api/role/search
 * POST with body { query: "", filters: {}, page: N, locale: "en-us", sort: "newest" }
 * Returns { totalRecords, searchResults: [...] }
 */

const API = "https://jobs.apple.com/api/role/search";
const PAGE_SIZE = 20;

type AppleResult = {
  positionId?: string;
  postingTitle?: string;
  jobSummary?: string;
  team?: { teamName?: string };
  locations?: Array<{ name?: string; city?: string; state?: string; countryName?: string }>;
  postingDate?: string;
};

type AppleResponse = {
  totalRecords?: number;
  searchResults?: AppleResult[];
};

async function search(page = 1): Promise<AppleResponse | null> {
  return atsJson<AppleResponse>(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "", filters: {}, page, locale: "en-us", sort: "newest" }),
  });
}

async function countAll(): Promise<number> {
  const r = await search(1);
  return r?.totalRecords ?? 0;
}

async function fetchAll(companyName: string): Promise<JobPosting[]> {
  const first = await search(1);
  if (!first) return [];
  const total = first.totalRecords ?? first.searchResults?.length ?? 0;
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), 50);
  const all: AppleResult[] = first.searchResults ?? [];
  for (let p = 2; p <= pages; p++) {
    const r = await search(p);
    if (!r?.searchResults) break;
    all.push(...r.searchResults);
  }
  return all.map((j) => ({
    id: String(j.positionId ?? ""),
    title: j.postingTitle ?? "",
    company: companyName,
    location: (j.locations ?? [])
      .map((l) => l.name ?? [l.city, l.state, l.countryName].filter(Boolean).join(", "))
      .filter(Boolean)
      .join(" / "),
    url: `https://jobs.apple.com/en-us/details/${j.positionId}`,
    source: "custom:apple" as never,
    department: j.team?.teamName,
    postedAt: j.postingDate,
  } as JobPosting));
}

registerAdapter({
  id: "custom:apple",
  kind: "custom",
  async validate() {
    return (await countAll()) > 0;
  },
  count() {
    return countAll();
  },
  fetchJobs(_c, company) {
    return fetchAll(company);
  },
});
