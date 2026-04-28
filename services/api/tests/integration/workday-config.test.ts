import { describe, expect, it } from "vitest";
import { parseWorkdaySampleUrl } from "../../src/config";

describe("workday config parsing", () => {
  it("parses canonical board URLs that do not include an /en-US prefix", () => {
    const parsed = parseWorkdaySampleUrl("https://pfizer.wd1.myworkdayjobs.com/PfizerCareersSearch");

    expect(parsed).toEqual({
      host: "pfizer.wd1.myworkdayjobs.com",
      tenant: "pfizer",
      site: "PfizerCareersSearch",
      workdayBaseUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareersSearch",
    });
  });

  it("keeps locale-prefixed board URLs working for existing registry entries", () => {
    const parsed = parseWorkdaySampleUrl("https://walmart.wd5.myworkdayjobs.com/en-US/WalmartExternal");

    expect(parsed).toEqual({
      host: "walmart.wd5.myworkdayjobs.com",
      tenant: "walmart",
      site: "WalmartExternal",
      workdayBaseUrl: "https://walmart.wd5.myworkdayjobs.com/en-US/WalmartExternal",
    });
  });
});
