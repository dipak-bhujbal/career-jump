import { describe, it, expect } from "vitest";
import { stubFetch } from "./_helpers";
import { countBreezyJobs, fetchBreezyJobs, validateBreezySlug } from "../core/breezy";

const sample = [
  {
    _id: "j1",
    name: "Backend Engineer",
    type: "Full-Time",
    location: { city: "NYC", state: "NY", country: "USA" },
    apply_url: "https://acme.breezy.hr/p/j1",
    department: "Engineering",
    published_date: "2026-04-01",
  },
  {
    _id: "j2",
    name: "Designer",
    location: "Remote",
    apply_url: "https://acme.breezy.hr/p/j2",
  },
];

describe("breezy adapter", () => {
  it("validates a slug", async () => {
    stubFetch([{ body: sample }]);
    expect(await validateBreezySlug("acme")).toEqual({ source: "breezy", companySlug: "acme" });
  });

  it("counts jobs", async () => {
    stubFetch([{ body: sample }]);
    expect(await countBreezyJobs("acme")).toBe(2);
  });

  it("handles object location", async () => {
    stubFetch([{ body: sample }]);
    const jobs = await fetchBreezyJobs("acme", "Acme");
    expect(jobs[0].location).toBe("NYC, NY, USA");
  });

  it("handles string location", async () => {
    stubFetch([{ body: sample }]);
    const jobs = await fetchBreezyJobs("acme", "Acme");
    expect(jobs[1].location).toBe("Remote");
  });
});
