import { beforeEach, describe, expect, it, vi } from "vitest";

const getRowMock = vi.fn();
const putRowMock = vi.fn();
const saveRawScanMock = vi.fn();
const fetchJobsForDetectedConfigMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  ConditionalCheckFailedException: class extends Error {},
  registryTableName: vi.fn(() => "registry-table"),
  rawScansTableName: vi.fn(() => "raw-scans-table"),
  getRow: getRowMock,
  putRow: putRowMock,
  scanAllRows: vi.fn(),
}));

vi.mock("../../src/storage/raw-scans", () => ({
  saveRawScan: saveRawScanMock,
}));

vi.mock("../../src/services/discovery", () => ({
  fetchJobsForDetectedConfig: fetchJobsForDetectedConfigMock,
}));

vi.mock("../../src/ats/shared/init-core", () => ({}));
vi.mock("../../src/ats/custom", () => ({}));

function makeSqsEvent(bodies: object[]) {
  return {
    Records: bodies.map((body, i) => ({
      messageId: `msg-${i}`,
      body: JSON.stringify(body),
    })),
  };
}

function makeRegistryRow(overrides: Partial<{
  company: string;
  ats: string | null;
  board_url: string | null;
  tier: string;
}> = {}) {
  return {
    pk: "REGISTRY",
    sk: "COMPANY#stripe",
    company: overrides.company ?? "Stripe",
    ats: overrides.ats ?? "greenhouse",
    board_url: overrides.board_url ?? "https://boards.greenhouse.io/stripe",
    sample_url: null,
    total_jobs: null,
    rank: null,
    sheet: "Registry",
    source: "curated",
    tier: overrides.tier ?? "TIER1_VERIFIED",
    last_checked: null,
  };
}

function makeMessage(overrides: Partial<{
  company: string;
  companySlug: string;
  adapterId: string | null;
  isReprobe: boolean;
}> = {}) {
  return {
    company: overrides.company ?? "Stripe",
    companySlug: overrides.companySlug ?? "stripe",
    adapterId: overrides.adapterId ?? "greenhouse",
    scanPool: "cold" as const,
    priority: "normal" as const,
    isReprobe: overrides.isReprobe ?? false,
  };
}

describe("registry-scan-worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    saveRawScanMock.mockResolvedValue(undefined);
    putRowMock.mockResolvedValue(undefined);
  });

  it("scans a healthy registry company end-to-end and writes raw scan + success state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));

    getRowMock
      .mockResolvedValueOnce(makeRegistryRow())  // registry entry lookup
      .mockResolvedValueOnce(null);               // loadRegistryCompanyScanState (no prior state)

    fetchJobsForDetectedConfigMock.mockResolvedValue([
      { id: "job1", title: "Engineer", company: "Stripe", source: "greenhouse", url: "https://greenhouse.io/job/1" },
    ]);

    const { handler } = await import("../../src/aws/registry-scan-worker");
    const result = await handler(makeSqsEvent([makeMessage()]) as never);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(fetchJobsForDetectedConfigMock).toHaveBeenCalledWith(
      "Stripe",
      expect.objectContaining({ source: "greenhouse" }),
    );
    expect(saveRawScanMock).toHaveBeenCalledWith(
      "Stripe",
      expect.objectContaining({ source: "greenhouse" }),
      expect.arrayContaining([expect.objectContaining({ id: "job1" })]),
    );
    expect(putRowMock).toHaveBeenCalledWith(
      "registry-table",
      expect.objectContaining({
        sk: "REGISTRY-SCAN-STATE",
        status: "healthy",
        failureCount: 0,
        lastFetchedCount: 1,
      }),
    );
  });

  it("marks misconfigured and does NOT scan when registry entry is missing", async () => {
    getRowMock.mockResolvedValueOnce(null);  // registry entry not found

    const { handler } = await import("../../src/aws/registry-scan-worker");
    const result = await handler(makeSqsEvent([makeMessage()]) as never);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(saveRawScanMock).not.toHaveBeenCalled();
    expect(putRowMock).toHaveBeenCalledWith(
      "registry-table",
      expect.objectContaining({ status: "misconfigured" }),
    );
  });

  it("marks misconfigured when registry entry exists but DetectedConfig resolves to null", async () => {
    getRowMock
      .mockResolvedValueOnce(makeRegistryRow({
        ats: "greenhouse",
        board_url: "https://careers.someunknown.com/jobs",
      }))
      .mockResolvedValueOnce(null);

    const { handler } = await import("../../src/aws/registry-scan-worker");
    const result = await handler(makeSqsEvent([makeMessage()]) as never);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(putRowMock).toHaveBeenCalledWith(
      "registry-table",
      expect.objectContaining({ status: "misconfigured" }),
    );
  });

  it("returns batchItemFailure for a message that throws unexpectedly", async () => {
    getRowMock.mockRejectedValueOnce(new Error("DynamoDB unavailable"));

    const { handler } = await import("../../src/aws/registry-scan-worker");
    const result = await handler(makeSqsEvent([makeMessage()]) as never);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-0");
    expect(saveRawScanMock).not.toHaveBeenCalled();
  });

  it("processes multiple records and returns only failed ones in batchItemFailures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));

    getRowMock
      .mockResolvedValueOnce(makeRegistryRow({ company: "Stripe", companySlug: "stripe" }))
      .mockResolvedValueOnce(null)              // scan state for stripe
      .mockRejectedValueOnce(new Error("timeout"));  // registry lookup for second company fails

    fetchJobsForDetectedConfigMock.mockResolvedValue([]);

    const { handler } = await import("../../src/aws/registry-scan-worker");
    const result = await handler(makeSqsEvent([
      makeMessage({ company: "Stripe", companySlug: "stripe" }),
      makeMessage({ company: "Figma", companySlug: "figma" }),
    ]) as never);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-1");
  });

  it("calls markRegistryCompanyScanFailure and returns batchItemFailure when fetch throws", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T12:00:00.000Z"));

    getRowMock
      .mockResolvedValueOnce(makeRegistryRow())  // registry entry
      .mockResolvedValueOnce(null);               // scan state (no prior state)

    fetchJobsForDetectedConfigMock.mockRejectedValueOnce(new Error("upstream 503"));

    const { handler } = await import("../../src/aws/registry-scan-worker");
    const result = await handler(makeSqsEvent([makeMessage()]) as never);

    expect(result.batchItemFailures).toHaveLength(1);
    expect(result.batchItemFailures[0].itemIdentifier).toBe("msg-0");
    expect(saveRawScanMock).not.toHaveBeenCalled();
    expect(putRowMock).toHaveBeenCalledWith(
      "registry-table",
      expect.objectContaining({
        status: "failing",
        failureCount: 1,
        lastFailureReason: "upstream 503",
      }),
    );
  });

  it("handles isReprobe=true — scans normally and transitions paused → healthy on success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T12:00:00.000Z"));

    getRowMock
      .mockResolvedValueOnce(makeRegistryRow())  // registry entry
      .mockResolvedValueOnce({                   // existing paused scan state
        company: "Stripe",
        companySlug: "stripe",
        adapterId: "greenhouse",
        scanPool: "cold",
        priority: "normal",
        status: "paused",
        failureCount: 5,
        lastFailureAt: "2026-04-28T12:00:00.000Z",
        lastFetchedCount: 10,
        updatedAt: "2026-04-28T12:00:00.000Z",
      });

    fetchJobsForDetectedConfigMock.mockResolvedValue([
      { id: "job1", title: "Engineer", company: "Stripe", source: "greenhouse", url: "https://greenhouse.io/1" },
    ]);

    const { handler } = await import("../../src/aws/registry-scan-worker");
    const result = await handler(makeSqsEvent([makeMessage({ isReprobe: true })]) as never);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(putRowMock).toHaveBeenCalledWith(
      "registry-table",
      expect.objectContaining({
        status: "healthy",
        failureCount: 0,
      }),
    );
  });
});
