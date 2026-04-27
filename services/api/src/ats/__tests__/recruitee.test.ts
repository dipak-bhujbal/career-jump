import { describe, it, expect } from "vitest";
import { stubFetch } from "./_helpers";
import { countRecruiteeJobs, fetchRecruiteeJobs, validateRecruiteeSlug } from "../core/recruitee";

const sample = {
  offers: [
    {
      id: 100,
      slug: "senior-engineer",
      title: "Senior Engineer",
      city: "Berlin",
      country: "Germany",
      careers_url: "https://acme.recruitee.com/o/senior-engineer",
      department: "Engineering",
      published_at: "2026-04-01",
    },
  ],
};

describe("recruitee adapter", () => {
  it("validates", async () => {
    stubFetch([{ body: sample }]);
    expect(await validateRecruiteeSlug("acme")).toEqual({ source: "recruitee", companySlug: "acme" });
  });

  it("counts", async () => {
    stubFetch([{ body: sample }]);
    expect(await countRecruiteeJobs("acme")).toBe(1);
  });

  it("maps offer", async () => {
    stubFetch([{ body: sample }]);
    const jobs = await fetchRecruiteeJobs("acme", "Acme");
    expect(jobs[0]).toMatchObject({
      id: "100",
      title: "Senior Engineer",
      company: "Acme",
      url: "https://acme.recruitee.com/o/senior-engineer",
      department: "Engineering",
    });
    expect(jobs[0].location).toContain("Berlin");
  });
});
