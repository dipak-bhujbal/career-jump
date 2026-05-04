import { describe, expect, it } from "vitest";
import { assessJobGeography, annotateJobGeography, shouldKeepJobPostingForUSInventory } from "./utils";
import type { JobPosting } from "../types";

function baseJob(overrides: Partial<JobPosting>): JobPosting {
  return {
    source: "greenhouse",
    company: "GeoCo",
    id: "geo-1",
    title: "Software Engineer",
    location: "Unknown",
    url: "https://example.com/jobs/geo-1",
    ...overrides,
  };
}

describe("geo classifier", () => {
  it("keeps explicit U.S. remote scope in mixed-location text", () => {
    const assessment = assessJobGeography(baseJob({
      location: "Remote - US or Canada",
      title: "Senior Engineer",
    }));
    expect(assessment.decision).toBe("keep");
    expect(assessment.isUSLikely).toBe(true);
  });

  it("drops confident non-US rows from structured adapter country", () => {
    const assessment = assessJobGeography(baseJob({
      location: "Remote",
      locationCountry: "Germany",
    }));
    expect(assessment.decision).toBe("drop");
    expect(assessment.detectedCountry).toBe("germany");
  });

  it("keeps review rows for ambiguous city-only U.S. locality names", () => {
    const assessment = assessJobGeography(baseJob({
      location: "Cambridge",
    }));
    expect(assessment.decision).not.toBe("drop");
    expect(shouldKeepJobPostingForUSInventory(baseJob({ location: "Cambridge" }))).toBe(true);
  });

  it("annotates canonical U.S. locality metadata for major hub aliases", () => {
    const annotated = annotateJobGeography(baseJob({
      location: "SF Bay Area",
    }));
    expect(annotated.matchedUsLocality).toBe("San Francisco-Oakland-Fremont, CA");
    expect(annotated.geoDecision).toBe("keep");
  });

  it("keeps mixed-location rows when one location is in the U.S.", () => {
    const assessment = assessJobGeography(baseJob({
      location: "Pune, India / Boston, MA",
    }));
    expect(assessment.decision).toBe("keep");
    expect(assessment.isMixed).toBe(true);
  });
});
