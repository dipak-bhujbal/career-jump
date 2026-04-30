import { describe, expect, it } from "vitest";
import { analyzeJobLocation, shouldKeepJobForUSInventory } from "./job-filters";

describe("job geography filters", () => {
  it("classifies DE as non-US in trailing tokens", () => {
    const analysis = analyzeJobLocation("Munich, Bavaria, DE");
    expect(analysis.isUSLikely).toBe(false);
    expect(analysis.hasNonUS).toBe(true);
    expect(analysis.detectedCountry).not.toBe("United States");
    expect(shouldKeepJobForUSInventory("Munich, Bavaria, DE")).toBe(false);
  });

  it("classifies AR as non-US in trailing tokens", () => {
    const analysis = analyzeJobLocation("CABA, CABA, AR");
    expect(analysis.isUSLikely).toBe(false);
    expect(analysis.detectedCountry).toBe("ar");
    expect(shouldKeepJobForUSInventory("CABA, CABA, AR")).toBe(false);
  });
});
