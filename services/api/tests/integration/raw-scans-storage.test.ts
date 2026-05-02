import { beforeEach, describe, expect, it, vi } from "vitest";

const getRowMock = vi.fn();
const putRowMock = vi.fn();
const queryRowsMock = vi.fn();
const deleteRowMock = vi.fn();
const scanAllRowsMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  rawScansTableName: vi.fn(() => "raw-scans-table"),
  getRow: getRowMock,
  putRow: putRowMock,
  queryRows: queryRowsMock,
  deleteRow: deleteRowMock,
  scanAllRows: scanAllRowsMock,
}));

describe("raw scan storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    getRowMock.mockResolvedValue(null);
    putRowMock.mockResolvedValue(undefined);
    queryRowsMock.mockResolvedValue([]);
    deleteRowMock.mockResolvedValue(undefined);
    scanAllRowsMock.mockResolvedValue([]);
  });

  it("replaces missing company jobs when a new raw scan arrives", async () => {
    const { saveRawScan } = await import("../../src/storage/raw-scans");
    queryRowsMock.mockResolvedValueOnce([
      {
        pk: "RAW_SCAN#greenhouse#board:openai",
        sk: "JOB#job-1",
        entityType: "RAW_SCAN_JOB",
        job: { id: "job-1" },
      },
      {
        pk: "RAW_SCAN#greenhouse#board:openai",
        sk: "JOB#job-2",
        entityType: "RAW_SCAN_JOB",
        job: { id: "job-2" },
      },
    ]);

    await saveRawScan(
      "OpenAI",
      { source: "greenhouse", boardToken: "openai", company: "OpenAI" },
      [
        {
          source: "greenhouse",
          company: "OpenAI",
          id: "job-1",
          title: "Engineer",
          location: "San Francisco, CA",
          url: "https://boards.greenhouse.io/openai/jobs/1",
        },
      ],
    );

    // The second job disappeared from the latest source scan, so the shared
    // live inventory must remove it instead of relying on TTL expiry.
    expect(deleteRowMock).toHaveBeenCalledWith("raw-scans-table", {
      pk: "RAW_SCAN#greenhouse#board:openai",
      sk: "JOB#job-2",
    });
    expect(putRowMock).toHaveBeenCalledWith(
      "raw-scans-table",
      expect.objectContaining({
        entityType: "RAW_SCAN_CURRENT",
        company: "OpenAI",
        fetchedCount: 1,
      }),
    );
  });

  it("rebuilds the latest scan from per-job rows when the current summary row is absent", async () => {
    const { loadLatestRawScan } = await import("../../src/storage/raw-scans");
    queryRowsMock.mockResolvedValueOnce([
      {
        pk: "RAW_SCAN#greenhouse#board:openai",
        sk: "JOB#job-2",
        entityType: "RAW_SCAN_JOB",
        scannedAt: "2026-05-01T12:00:00.000Z",
        job: {
          source: "greenhouse",
          company: "OpenAI",
          id: "job-2",
          title: "Backend Engineer",
          location: "Remote",
          url: "https://boards.greenhouse.io/openai/jobs/2",
          postedAt: "2026-05-01T11:00:00.000Z",
        },
      },
      {
        pk: "RAW_SCAN#greenhouse#board:openai",
        sk: "JOB#job-1",
        entityType: "RAW_SCAN_JOB",
        scannedAt: "2026-05-01T12:00:00.000Z",
        job: {
          source: "greenhouse",
          company: "OpenAI",
          id: "job-1",
          title: "Applied Scientist",
          location: "Remote",
          url: "https://boards.greenhouse.io/openai/jobs/1",
          postedAt: "2026-05-01T12:00:00.000Z",
        },
      },
    ]);

    const result = await loadLatestRawScan("OpenAI", {
      source: "greenhouse",
      boardToken: "openai",
      company: "OpenAI",
    });

    // Per-job rows are now sufficient to rebuild a company's current live
    // inventory, which keeps the company-indexed read path working.
    expect(result?.jobs.map((job) => job.id)).toEqual(["job-1", "job-2"]);
    expect(result?.scannedAt).toBe("2026-05-01T12:00:00.000Z");
  });

  it("treats durable current rows as stale only for freshness-gated reads", async () => {
    const { loadLatestRawScan } = await import("../../src/storage/raw-scans");
    getRowMock.mockResolvedValueOnce({
      pk: "RAW_SCAN#greenhouse#board:openai",
      sk: "CURRENT",
      entityType: "RAW_SCAN_CURRENT",
      scannedAt: "2026-04-25T12:00:00.000Z",
      jobs: [
        {
          source: "greenhouse",
          company: "OpenAI",
          id: "job-1",
          title: "Applied Scientist",
          location: "Remote",
          url: "https://boards.greenhouse.io/openai/jobs/1",
        },
      ],
    });

    const freshOnly = await loadLatestRawScan(
      "OpenAI",
      { source: "greenhouse", boardToken: "openai", company: "OpenAI" },
      { maxAgeMs: 60 * 60 * 1000 },
    );

    getRowMock.mockResolvedValueOnce({
      pk: "RAW_SCAN#greenhouse#board:openai",
      sk: "CURRENT",
      entityType: "RAW_SCAN_CURRENT",
      scannedAt: "2026-04-25T12:00:00.000Z",
      jobs: [
        {
          source: "greenhouse",
          company: "OpenAI",
          id: "job-1",
          title: "Applied Scientist",
          location: "Remote",
          url: "https://boards.greenhouse.io/openai/jobs/1",
        },
      ],
    });

    const allowWeekendStale = await loadLatestRawScan(
      "OpenAI",
      { source: "greenhouse", boardToken: "openai", company: "OpenAI" },
      { allowStale: true },
    );

    // Freshness-gated weekday scans should treat an old current row as stale,
    // while weekend/read-only paths can still serve the last known inventory.
    expect(freshOnly).toBeNull();
    expect(allowWeekendStale?.jobs).toHaveLength(1);
    expect(allowWeekendStale?.scannedAt).toBe("2026-04-25T12:00:00.000Z");
  });

  it("summarizes paged current raw scans for the admin workspace", async () => {
    const { summarizeCurrentRawScans } = await import("../../src/storage/raw-scans");
    scanAllRowsMock.mockResolvedValueOnce([
      {
        entityType: "RAW_SCAN_CURRENT",
        company: "Cisco",
        scannedAt: "2026-05-02T03:15:57.912Z",
        jobs: [{ id: "1" }, { id: "2" }],
      },
      {
        entityType: "RAW_SCAN_CURRENT",
        company: "Takeda",
        scannedAt: "2026-05-02T07:05:49.163Z",
        jobs: [{ id: "3" }],
      },
    ]);

    const summary = await summarizeCurrentRawScans();

    expect(summary).toEqual({
      currentCompanies: 2,
      currentJobs: 3,
      lastScannedAt: "2026-05-02T07:05:49.163Z",
    });
  });
});
