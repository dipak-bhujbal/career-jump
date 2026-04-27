import { describe, it, expect } from "vitest";
import { stubFetch } from "./_helpers";
import { countWorkableJobs, fetchWorkableJobs, validateWorkableSlug } from "../core/workable";

const sample = {
  name: "FooCorp",
  jobs: [
    {
      id: "abc123",
      shortcode: "abc123",
      title: "Senior Software Engineer",
      city: "Boston",
      state: "MA",
      country: "United States",
      shortlink: "https://apply.workable.com/foocorp/j/abc123/",
      department: "Engineering",
      published_on: "2026-04-01",
    },
    {
      id: "xyz789",
      shortcode: "xyz789",
      title: "Product Manager",
      city: "Remote",
      country: "United States",
      shortlink: "https://apply.workable.com/foocorp/j/xyz789/",
    },
  ],
};

describe("workable adapter", () => {
  it("validates a slug", async () => {
    stubFetch([{ body: sample }]);
    const r = await validateWorkableSlug("foocorp");
    expect(r).toEqual({ source: "workable", companySlug: "foocorp" });
  });

  it("returns null on 404", async () => {
    stubFetch([{ status: 404 }]);
    const r = await validateWorkableSlug("doesnotexist");
    expect(r).toBeNull();
  });

  it("counts jobs", async () => {
    stubFetch([{ body: sample }]);
    expect(await countWorkableJobs("foocorp")).toBe(2);
  });

  it("maps jobs to JobPosting shape", async () => {
    stubFetch([{ body: sample }]);
    const jobs = await fetchWorkableJobs("foocorp", "FooCorp");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "abc123",
      title: "Senior Software Engineer",
      company: "FooCorp",
      location: "Boston, MA, United States",
      url: "https://apply.workable.com/foocorp/j/abc123/",
      department: "Engineering",
      postedAt: "2026-04-01",
    });
  });

  it("handles empty jobs gracefully", async () => {
    stubFetch([{ body: { name: "FooCorp", jobs: [] } }]);
    expect(await fetchWorkableJobs("foocorp", "FooCorp")).toEqual([]);
  });
});
