import { describe, expect, it } from "vitest";
import { formatLastRunSummary, formatRunCompletionToast, wasRunFullyQuotaBlocked } from "./presentation";
import type { RunStartResponse } from "@/lib/api";

function makeRunResult(patch: Partial<RunStartResponse> = {}): RunStartResponse {
  return {
    ok: true,
    runAt: "2026-04-29T18:00:00.000Z",
    totalNewMatches: 0,
    totalUpdatedMatches: 0,
    totalMatched: 0,
    totalFetched: 0,
    byCompany: {},
    emailedJobs: [],
    emailedUpdatedJobs: [],
    emailStatus: "skipped",
    emailError: null,
    scanMeta: {
      cacheHits: 0,
      liveFetchCompanies: 0,
      quotaBlockedCompanies: [],
      remainingLiveScansToday: 2,
    },
    ...patch,
  };
}

describe("run presentation", () => {
  it("does not crash when older results are missing scanMeta", () => {
    const result = {
      ...makeRunResult(),
      scanMeta: undefined,
    } as unknown as RunStartResponse;

    expect(wasRunFullyQuotaBlocked(result)).toBe(false);
    expect(formatLastRunSummary(result)).toBe("Last run completed with no live-scan activity.");
    expect(formatRunCompletionToast(result)).toBe("Scan finished using cached results.");
  });

  it("keeps quota-blocked messaging for normalized results", () => {
    const result = makeRunResult({
      scanMeta: {
        cacheHits: 1,
        liveFetchCompanies: 0,
        quotaBlockedCompanies: ["Adobe"],
        remainingLiveScansToday: 0,
      },
    });

    expect(wasRunFullyQuotaBlocked(result)).toBe(true);
    expect(formatLastRunSummary(result)).toContain("skipped 1 company");
    expect(formatRunCompletionToast(result)).toContain("Cached results were used");
  });
});
