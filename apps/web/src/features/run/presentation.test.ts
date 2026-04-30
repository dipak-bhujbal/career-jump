import { describe, expect, it } from "vitest";
import { formatLastRunSummary, formatRunCompletionToast, isAcceptedRun, isQueuedRunPending, wasRunFullyQuotaBlocked } from "./presentation";
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
      filteredOutCompanies: 0,
      filteredOutJobs: 0,
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
    expect(formatLastRunSummary(result)).toBe("Last run returned no live or cached jobs.");
    expect(formatRunCompletionToast(result)).toBe("Scan finished. No cache was available and no jobs were returned this run.");
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

  it("treats accepted async starts as queued rather than completed", () => {
    const result = {
      ok: true,
      runId: "manual-123",
      status: "accepted",
      queuedAt: "2026-04-29T18:00:00.000Z",
    } as RunStartResponse;

    expect(isAcceptedRun(result)).toBe(true);
    expect(isQueuedRunPending(result, Date.parse("2026-04-29T18:00:20.000Z"))).toBe(true);
    expect(wasRunFullyQuotaBlocked(result)).toBe(false);
    expect(formatLastRunSummary(result)).toBe("Scan queued and waiting for scan progress.");
    expect(formatRunCompletionToast(result)).toBe("Scan queued. Progress will appear here as soon as scanning begins.");
  });

  it("explains when jobs were fetched but excluded by filters", () => {
    const result = makeRunResult({
      totalFetched: 75,
      totalMatched: 0,
      scanMeta: {
        cacheHits: 0,
        liveFetchCompanies: 2,
        quotaBlockedCompanies: [],
        remainingLiveScansToday: 1,
        filteredOutCompanies: 2,
        filteredOutJobs: 75,
      },
    });

    expect(formatRunCompletionToast(result)).toBe(
      "Scan finished. Jobs were fetched, but none matched your current title or geography filters.",
    );
    expect(formatLastRunSummary(result)).toBe(
      "Last run fetched jobs, but your current title or geography filters excluded them.",
    );
  });
});
