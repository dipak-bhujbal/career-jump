import { describe, expect, it } from "vitest";
import { companyToDetectedConfig, parseWorkdaySampleUrl, sanitizeCompanies } from "../../src/config";
import { inferAtsIdFromUrl } from "../../src/ats/shared/normalize";

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

  it("routes non-core ATS rows through the generic registry adapter path", () => {
    const detected = companyToDetectedConfig({
      company: "Acme",
      enabled: true,
      source: "workable",
      boardUrl: "https://apply.workable.com/acme",
      sampleUrl: "https://apply.workable.com/acme",
    });

    expect(detected).toEqual({
      source: "registry-adapter",
      adapterId: "workable",
      boardUrl: "https://apply.workable.com/acme",
      sampleUrl: "https://apply.workable.com/acme",
      companyName: "Acme",
    });
  });

  it("normalizes registry ATS aliases like Oracle Cloud into canonical source ids", () => {
    const [company] = sanitizeCompanies([{
      company: "Oracle Example",
      enabled: true,
      source: "Oracle Cloud",
      boardUrl: "https://example.fa.em5.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001",
    }]);

    expect(company.source).toBe("oracle");
  });

  it("infers Workday when registry rows are missing an ATS label but keep a canonical board URL", () => {
    const [company] = sanitizeCompanies([{
      company: "Eli Lilly",
      enabled: true,
      boardUrl: "https://lilly.wd5.myworkdayjobs.com/en-US/LillyCareers",
    }]);

    expect(company.source).toBe("workday");
    expect(company.site).toBe("LillyCareers");
  });

  it("parses Greenhouse boards-api URLs into the correct board token", () => {
    const [company] = sanitizeCompanies([{
      company: "Navan",
      enabled: true,
      source: "greenhouse",
      boardUrl: "https://boards-api.greenhouse.io/v1/boards/tripactions/jobs?content=true",
    }]);

    expect(company.boardToken).toBe("tripactions");
  });

  it("maps hosted ATS labels like Deel back into a safe generic custom fallback", () => {
    const detected = companyToDetectedConfig({
      company: "Klarna",
      enabled: true,
      source: "custom-jsonld",
      boardUrl: "https://jobs.deel.com/klarna",
    });

    expect(inferAtsIdFromUrl("https://jobs.deel.com/klarna")).toBe("custom-jsonld");
    expect(detected).toEqual({
      source: "registry-adapter",
      adapterId: "custom-jsonld",
      boardUrl: "https://jobs.deel.com/klarna",
      sampleUrl: undefined,
      companyName: "Klarna",
    });
  });

  it("keeps unlabeled registry boards scannable through the generic custom fallback", () => {
    const [company] = sanitizeCompanies([{
      company: "TCS",
      enabled: true,
      boardUrl: "https://www.tcs.com/careers/global",
    }]);

    expect(company.source).toBe("custom-jsonld");
  });
});
