import { describe, it, expect } from "vitest";
import { stubFetch } from "./_helpers";
import { countBambooJobs, fetchBambooJobs, validateBambooSlug } from "../core/bamboohr";

const sample = {
  result: [
    {
      id: 42,
      jobOpeningName: "Senior Engineer",
      jobOpeningStatus: "Open",
      location: { city: "Austin", state: "TX", country: "USA" },
      departmentLabel: "Engineering",
      datePosted: "2026-04-01",
    },
  ],
};

describe("bamboohr adapter", () => {
  it("validates", async () => {
    stubFetch([{ body: sample }]);
    expect(await validateBambooSlug("acme")).toEqual({ source: "bamboohr", companySlug: "acme" });
  });

  it("counts", async () => {
    stubFetch([{ body: sample }]);
    expect(await countBambooJobs("acme")).toBe(1);
  });

  it("maps job + builds posting URL", async () => {
    stubFetch([{ body: sample }]);
    const jobs = await fetchBambooJobs("acme", "Acme");
    expect(jobs[0]).toMatchObject({
      id: "42",
      title: "Senior Engineer",
      url: "https://acme.bamboohr.com/careers/42",
      department: "Engineering",
    });
  });
});
