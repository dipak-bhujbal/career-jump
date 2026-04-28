import { beforeEach, describe, expect, it, vi } from "vitest";

const scanAllRowsMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  ConditionalCheckFailedException: class extends Error {},
  registryTableName: vi.fn(() => "registry-table"),
  getRow: vi.fn(),
  putRow: vi.fn(),
  scanAllRows: scanAllRowsMock,
}));

function makeRegistryRows(total: number) {
  return Array.from({ length: total }, (_, index) => ({
    pk: "REGISTRY" as const,
    sk: `COMPANY#company-${index + 1}`,
  }));
}

function makeState(overrides: Partial<{
  company: string;
  companySlug: string;
  status: string;
  staleAfterAt: string | null;
  lastSuccessAt: string | null;
  nextScanAt: string | null;
}> = {}) {
  // Preserve explicit nulls in fixtures so pending/misconfigured edge cases
  // exercise the real status-derivation branches instead of falling back.
  return {
    pk: `COMPANY#${overrides.companySlug ?? "company-1"}`,
    sk: "REGISTRY-SCAN-STATE" as const,
    company: overrides.company ?? "Company 1",
    companySlug: overrides.companySlug ?? "company-1",
    adapterId: "greenhouse",
    scanPool: "low" as const,
    priority: "normal" as const,
    status: overrides.status ?? "healthy",
    nextScanAt: overrides.nextScanAt !== undefined ? overrides.nextScanAt : "2026-04-28T18:00:00.000Z",
    staleAfterAt: overrides.staleAfterAt !== undefined ? overrides.staleAfterAt : "2026-04-28T18:00:00.000Z",
    lastScanAt: "2026-04-28T08:00:00.000Z",
    lastSuccessAt: overrides.lastSuccessAt !== undefined ? overrides.lastSuccessAt : "2026-04-28T08:00:00.000Z",
    lastFailureAt: null,
    lastFailureReason: null,
    failureCount: 0,
    lastFetchedCount: 10,
    updatedAt: "2026-04-28T08:00:00.000Z",
  };
}

describe("registry ops dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("aggregates registry coverage and derives fresh/stale from scan-state timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));
    scanAllRowsMock
      .mockResolvedValueOnce(makeRegistryRows(8))
      .mockResolvedValueOnce([
        makeState({
          company: "Fresh Co",
          companySlug: "fresh-co",
          status: "healthy",
          staleAfterAt: "2026-04-28T18:00:00.000Z",
          nextScanAt: "2026-04-28T16:00:00.000Z",
        }),
        makeState({
          company: "Stale Co",
          companySlug: "stale-co",
          status: "healthy",
          staleAfterAt: "2026-04-28T10:00:00.000Z",
          nextScanAt: "2026-04-28T11:00:00.000Z",
        }),
        makeState({
          company: "Pending Co",
          companySlug: "pending-co",
          status: "pending",
          lastSuccessAt: null,
          staleAfterAt: "2026-04-28T18:00:00.000Z",
          nextScanAt: "2026-04-28T13:00:00.000Z",
        }),
        makeState({
          company: "Failing Co",
          companySlug: "failing-co",
          status: "failing",
          nextScanAt: "2026-04-28T14:00:00.000Z",
        }),
        makeState({
          company: "Paused Co",
          companySlug: "paused-co",
          status: "paused",
          nextScanAt: "2026-04-29T12:00:00.000Z",
        }),
        makeState({
          company: "Broken Co",
          companySlug: "broken-co",
          status: "misconfigured",
          nextScanAt: null,
        }),
      ]);

    const { buildRegistryOpsDashboardSummary } = await import("../../src/aws/registry-ops-dashboard");
    const summary = await buildRegistryOpsDashboardSummary("2026-04-28T12:00:00.000Z");

    expect(summary).toEqual({
      generatedAt: "2026-04-28T12:00:00.000Z",
      total: 8,
      routable: 7,
      neverScanned: 2,
      pending: 1,
      fresh: 1,
      stale: 1,
      failing: 1,
      paused: 1,
      misconfigured: 1,
      scheduled: 4,
    });
  });

  it("treats an empty scan-state table as fully never-scanned", async () => {
    scanAllRowsMock
      .mockResolvedValueOnce(makeRegistryRows(3))
      .mockResolvedValueOnce([]);

    const { buildRegistryOpsDashboardSummary } = await import("../../src/aws/registry-ops-dashboard");
    const summary = await buildRegistryOpsDashboardSummary("2026-04-28T12:00:00.000Z");

    expect(summary.total).toBe(3);
    expect(summary.routable).toBe(3);
    expect(summary.neverScanned).toBe(3);
    expect(summary.pending).toBe(0);
    expect(summary.fresh).toBe(0);
    expect(summary.stale).toBe(0);
    expect(summary.failing).toBe(0);
    expect(summary.paused).toBe(0);
    expect(summary.misconfigured).toBe(0);
    expect(summary.scheduled).toBe(0);
  });

  it("handler returns the same summary shape the scheduled Lambda logs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));
    scanAllRowsMock
      .mockResolvedValueOnce(makeRegistryRows(1))
      .mockResolvedValueOnce([
        makeState({
          company: "Fresh Co",
          companySlug: "fresh-co",
          status: "healthy",
          staleAfterAt: "2026-04-28T18:00:00.000Z",
          nextScanAt: "2026-04-28T16:00:00.000Z",
        }),
      ]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { handler } = await import("../../src/aws/registry-ops-dashboard");
    const summary = await handler();

    expect(summary.total).toBe(1);
    expect(summary.fresh).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[registry-ops-dashboard] summary",
      expect.stringContaining("\"fresh\":1"),
    );
    consoleSpy.mockRestore();
  });
});
