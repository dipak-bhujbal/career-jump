import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunProgress } from "./run-progress";
import type { RunStartResponse, RunStatus, ScanQuotaEnvelope } from "@/lib/api";

let runStatusData: RunStatus | undefined;
let latestRunData: RunStartResponse | null | undefined;
let quotaData: ScanQuotaEnvelope | undefined;

vi.mock("@/features/run/queries", () => ({
  runStatusKey: ["run", "status"] as const,
  startRunMutationKey: ["run", "start"] as const,
  useRunStatus: () => ({ data: runStatusData }),
  useLatestRunResult: () => ({ data: latestRunData }),
  useScanQuota: () => ({ data: quotaData }),
}));

function renderWithClient() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <RunProgress />
    </QueryClientProvider>,
  );
}

describe("RunProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runStatusData = undefined;
    latestRunData = null;
    quotaData = {
      ok: true,
      liveScansUsed: 0,
      remainingLiveScansToday: 2,
      lastLiveScanAt: null,
      date: "2026-04-29",
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders cleanly when the run state changes from idle to active", () => {
    const view = renderWithClient();
    expect(screen.queryByText("Scan in progress")).not.toBeInTheDocument();

    runStatusData = {
      ok: true,
      active: true,
      triggerType: "manual",
      startedAt: "2026-04-29T19:00:00.000Z",
      fetchedCompanies: 0,
      totalCompanies: 3,
      detail: "starting scan",
      message: "scan starting",
      percent: 0,
    };

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <RunProgress />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Scan in progress")).toBeInTheDocument();
    expect(screen.getByText("starting scan")).toBeInTheDocument();
  });

  it("keeps a queued banner visible before the first server-backed progress heartbeat arrives", () => {
    latestRunData = {
      ok: true,
      runId: "manual-123",
      status: "accepted",
      queuedAt: "2026-04-29T19:00:00.000Z",
      scanMeta: {
        cacheHits: 0,
        liveFetchCompanies: 0,
        quotaBlockedCompanies: [],
        remainingLiveScansToday: 2,
        filteredOutCompanies: 0,
        filteredOutJobs: 0,
      },
    };

    renderWithClient();

    expect(screen.getByText("Scan queued")).toBeInTheDocument();
    expect(screen.getByText("Preparing company progress…")).toBeInTheDocument();
    expect(screen.getByText("Scan request accepted. Progress will appear here as soon as scanning begins.")).toBeInTheDocument();
  });

  it("clears the finished banner after the completion linger window expires", () => {
    const view = renderWithClient();

    runStatusData = {
      ok: true,
      active: true,
      triggerType: "manual",
      startedAt: "2026-04-29T19:00:00.000Z",
      fetchedCompanies: 1,
      totalCompanies: 3,
      detail: "company completed",
      message: "company scan completed",
      percent: 0.33,
    };

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <RunProgress />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Scan in progress")).toBeInTheDocument();

    runStatusData = {
      ok: true,
      active: false,
    };
    latestRunData = {
      ok: true,
      runAt: "2026-04-29T19:00:02.000Z",
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
        liveFetchCompanies: 1,
        quotaBlockedCompanies: [],
        remainingLiveScansToday: 1,
      },
    };

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <RunProgress />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Scan finished")).toBeInTheDocument();

    vi.advanceTimersByTime(1900);

    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <RunProgress />
      </QueryClientProvider>,
    );

    expect(screen.queryByText("Scan finished")).not.toBeInTheDocument();
  });
});
