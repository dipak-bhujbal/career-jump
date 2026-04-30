import { describe, expect, it } from "vitest";
import { analyzeJobLocation, shouldKeepJobForUSInventory } from "../../src/lib/utils";

describe("geography gate", () => {
  it("treats DE as a non-US country code instead of Delaware", () => {
    const analysis = analyzeJobLocation("Munich, Bavaria, DE");
    expect(analysis.isUSLikely).toBe(false);
    expect(analysis.hasNonUS).toBe(true);
    expect(analysis.detectedCountry).not.toBe("United States");
    expect(shouldKeepJobForUSInventory("Munich, Bavaria, DE")).toBe(false);
  });

  it("treats AR as a non-US country code instead of Arkansas", () => {
    const analysis = analyzeJobLocation("CABA, CABA, AR");
    expect(analysis.isUSLikely).toBe(false);
    expect(analysis.detectedCountry).toBe("ar");
    expect(shouldKeepJobForUSInventory("CABA, CABA, AR")).toBe(false);
  });

  it("still keeps actual US locations", () => {
    const analysis = analyzeJobLocation("Austin, TX, US");
    expect(analysis.isUSLikely).toBe(true);
    expect(analysis.detectedCountry).toBe("United States");
    expect(shouldKeepJobForUSInventory("Austin, TX, US")).toBe(true);
  });
});
