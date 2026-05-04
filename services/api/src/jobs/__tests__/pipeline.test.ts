import { describe, it, expect } from "vitest";
import { pipe, filters, enrichers, reducers } from "../index";
import type { FilterContext } from "../types";
import type { JobPosting, RuntimeConfig } from "../../types";

const ctx: FilterContext = {
  config: {
    companies: [],
    jobtitles: { includeKeywords: ["engineer", "manager"], excludeKeywords: ["hardware"] },
    updatedAt: new Date().toISOString(),
  } as RuntimeConfig,
  now: "2026-04-25T12:00:00.000Z",
};

const jobs: JobPosting[] = [
  { id: "1", title: "Senior Software Engineer", company: "Foo", location: "San Francisco, CA, USA", url: "https://x.com/1", source: "greenhouse" } as JobPosting,
  { id: "2", title: "Hardware Engineer", company: "Foo", location: "Remote", url: "https://x.com/2", source: "greenhouse" } as JobPosting,
  { id: "3", title: "Product Manager", company: "Bar", location: "Berlin, Germany", url: "https://x.com/3", source: "lever" } as JobPosting,
  { id: "4", title: "Senior Software Engineer", company: "Foo", location: "San Francisco, CA, USA", url: "https://x.com/1?ref=ad", source: "greenhouse" } as JobPosting,
];

describe("jobs pipeline", () => {
  it("byJobTitle filters using config", async () => {
    const out = await pipe(jobs, ctx, filters.byJobTitle);
    // 'Senior Software Engineer' x2, 'Product Manager' pass; 'Hardware Engineer' excluded
    expect(out.map((j) => j.id).sort()).toEqual(["1", "3", "4"]);
  });

  it("byCountry US-only", async () => {
    const out = await pipe(jobs, ctx, filters.usOnly);
    // Plain "Remote" stays in review mode so the strict U.S. filter does not
    // falsely discard legitimate U.S.-remote jobs with sparse ATS metadata.
    expect(out.map((j) => j.id).sort()).toEqual(["1", "2", "4"]);
  });

  it("keeps mixed-location jobs when any location is in the US", async () => {
    const mixedJobs: JobPosting[] = [
      {
        id: "mix-1",
        title: "Staff Engineer",
        company: "MixCo",
        location: "Pune, India / Boston, MA",
        url: "https://x.com/mix-1",
        source: "workday",
      } as JobPosting,
    ];
    const out = await pipe(mixedJobs, ctx, filters.usOnly);
    expect(out.map((j) => j.id)).toEqual(["mix-1"]);
  });

  it("drops explicit foreign locations even when the city name also exists in the US", async () => {
    const ambiguousJobs: JobPosting[] = [
      {
        id: "amb-1",
        title: "Platform Engineer",
        company: "AmbCo",
        location: "Cambridge, United Kingdom",
        url: "https://x.com/amb-1",
        source: "greenhouse",
      } as JobPosting,
    ];
    const out = await pipe(ambiguousJobs, ctx, filters.usOnly);
    expect(out).toHaveLength(0);
  });

  it("keeps major US locality aliases such as SF Bay Area", async () => {
    const aliasJobs: JobPosting[] = [
      {
        id: "alias-1",
        title: "Software Engineer",
        company: "AliasCo",
        location: "SF Bay Area",
        url: "https://x.com/alias-1",
        source: "greenhouse",
      } as JobPosting,
    ];
    const out = await pipe(aliasJobs, ctx, filters.usOnly);
    expect(out.map((j) => j.id)).toEqual(["alias-1"]);
  });

  it("parses full state names as US in normalizeLocation", async () => {
    const stateNameJobs: JobPosting[] = [
      {
        id: "state-1",
        title: "Site Reliability Engineer",
        company: "StateCo",
        location: "Austin, Texas",
        url: "https://x.com/state-1",
        source: "greenhouse",
      } as JobPosting,
    ];
    const out = (await pipe(stateNameJobs, ctx, enrichers.normalizeLocation)) as Array<JobPosting & { locationCountry?: string; locationState?: string }>;
    expect(out[0].locationCountry).toBe("US");
    expect(out[0].locationState).toBe("TX");
  });

  it("normalizeLocation enriches", async () => {
    const out = (await pipe(jobs, ctx, enrichers.normalizeLocation)) as Array<JobPosting & { locationCountry?: string }>;
    expect(out[0].locationCountry).toBe("US");
    expect(out[2].locationCountry).toBe("Germany");
  });

  it("extractSeniority enriches", async () => {
    const out = (await pipe(jobs, ctx, enrichers.extractSeniority)) as Array<JobPosting & { seniority?: string }>;
    expect(out[0].seniority).toBe("senior");
    expect(out[2].seniority).toBe("manager");
  });

  it("dedupeByApplyUrl strips query strings", async () => {
    const out = await pipe(jobs, ctx, reducers.dedupeByApplyUrl);
    // ids 1 and 4 share base URL → one dropped
    expect(out).toHaveLength(3);
  });

  it("dedupeByFingerprint requires the enricher", async () => {
    const out = await pipe(jobs, ctx, enrichers.computeFingerprint, reducers.dedupeByFingerprint);
    // ids 1 and 4 are same role/location → fingerprint match, dedup
    expect(out).toHaveLength(3);
  });

  it("composes filters + enrichers + reducers", async () => {
    const out = await pipe(jobs, ctx,
      enrichers.normalizeLocation,
      filters.byJobTitle,
      filters.usOnly,
      enrichers.extractSeniority,
      enrichers.computeFingerprint,
      reducers.dedupeByFingerprint,
    );
    expect(out.length).toBeGreaterThan(0);
    for (const j of out) expect((j as { locationCountry?: string }).locationCountry).toBe("US");
  });
});
