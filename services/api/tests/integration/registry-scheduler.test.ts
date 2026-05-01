import { beforeEach, describe, expect, it, vi } from "vitest";

const sendSqsBatchMock = vi.fn();
const queryDueRegistryCompaniesMock = vi.fn();
const loadSystemRegistryScanFlagMock = vi.fn();

vi.mock("../../src/storage/registry-scan-state", () => ({
  queryDueRegistryCompanies: queryDueRegistryCompaniesMock,
}));

vi.mock("../../src/storage/accounts", () => ({
  loadSystemRegistryScanFlag: loadSystemRegistryScanFlagMock,
}));

vi.mock("../../src/aws/sqs", () => ({
  sendSqsBatch: sendSqsBatchMock,
}));

function makeState(overrides: {
  company: string;
  companySlug: string;
  adapterId?: string | null;
  status?: string;
  scanPool?: string;
  priority?: string;
  nextScanAt?: string;
}) {
  return {
    company: overrides.company,
    companySlug: overrides.companySlug,
    adapterId: overrides.adapterId ?? null,
    status: overrides.status ?? "healthy",
    scanPool: overrides.scanPool ?? "cold",
    priority: overrides.priority ?? "normal",
    nextScanAt: overrides.nextScanAt ?? "2026-04-28T10:00:00.000Z",
    staleAfterAt: "2026-04-29T02:00:00.000Z",
    lastScanAt: "2026-04-28T06:00:00.000Z",
    lastSuccessAt: "2026-04-28T06:00:00.000Z",
    lastFailureAt: null,
    lastFailureReason: null,
    failureCount: 0,
    lastFetchedCount: 42,
    updatedAt: "2026-04-28T06:00:00.000Z",
  };
}

describe("registry-scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env.WORKDAY_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123/cj-queue-workday";
    process.env.ENTERPRISE_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123/cj-queue-enterprise";
    process.env.PUBLIC_API_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123/cj-queue-public-api";
    sendSqsBatchMock.mockResolvedValue(undefined);
    loadSystemRegistryScanFlagMock.mockResolvedValue(true);
  });

  it("routes workday companies to the workday queue", async () => {
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([
      makeState({ company: "Stripe", companySlug: "stripe", adapterId: "workday" }),
    ]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result.dispatched).toBe(1);
    expect(result.byQueue.workday).toBe(1);
    expect(sendSqsBatchMock).toHaveBeenCalledWith(
      "https://sqs.us-east-1.amazonaws.com/123/cj-queue-workday",
      expect.arrayContaining([
        expect.objectContaining({ body: expect.objectContaining({ company: "Stripe", adapterId: "workday" }) }),
      ]),
    );
  });

  it("routes enterprise ATS companies to the enterprise queue", async () => {
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([
      makeState({ company: "Oracle Corp", companySlug: "oraclecorp", adapterId: "oracle" }),
      makeState({ company: "SAP Co", companySlug: "sapco", adapterId: "successfactors" }),
    ]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result.dispatched).toBe(2);
    expect(result.byQueue.enterprise).toBe(2);
    expect(sendSqsBatchMock).toHaveBeenCalledWith(
      "https://sqs.us-east-1.amazonaws.com/123/cj-queue-enterprise",
      expect.arrayContaining([
        expect.objectContaining({ body: expect.objectContaining({ adapterId: "oracle" }) }),
        expect.objectContaining({ body: expect.objectContaining({ adapterId: "successfactors" }) }),
      ]),
    );
  });

  it("routes all other ATS companies to the public-api queue", async () => {
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([
      makeState({ company: "Airbnb", companySlug: "airbnb", adapterId: "greenhouse" }),
      makeState({ company: "Figma", companySlug: "figma", adapterId: "lever" }),
      makeState({ company: "Custom Co", companySlug: "customco", adapterId: "custom-jsonld" }),
    ]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result.dispatched).toBe(3);
    expect(result.byQueue.publicApi).toBe(3);
  });

  it("marks paused companies as isReprobe=true when dispatching", async () => {
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([
      { ...makeState({ company: "Broken Co", companySlug: "brokenco", adapterId: "greenhouse", status: "paused" }), status: "paused" },
    ]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    await handler();

    expect(sendSqsBatchMock).toHaveBeenCalledWith(
      "https://sqs.us-east-1.amazonaws.com/123/cj-queue-public-api",
      expect.arrayContaining([
        expect.objectContaining({ body: expect.objectContaining({ isReprobe: true }) }),
      ]),
    );
  });

  it("skips companies when no queue URL is configured", async () => {
    delete process.env.WORKDAY_QUEUE_URL;
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([
      makeState({ company: "Stripe", companySlug: "stripe", adapterId: "workday" }),
    ]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(sendSqsBatchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("workday"),
      expect.anything(),
    );
  });

  it("routes companies with null adapterId to the public-api queue", async () => {
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([
      makeState({ company: "Unknown Co", companySlug: "unknownco", adapterId: null }),
    ]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result.dispatched).toBe(1);
    expect(result.byQueue.publicApi).toBe(1);
  });

  it("fans out mixed-ATS batches to the correct queues in parallel", async () => {
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([
      makeState({ company: "Workday Inc", companySlug: "workdayinc", adapterId: "workday" }),
      makeState({ company: "Oracle Corp", companySlug: "oraclecorp", adapterId: "oracle" }),
      makeState({ company: "Stripe", companySlug: "stripe", adapterId: "greenhouse" }),
      makeState({ company: "Figma", companySlug: "figma", adapterId: "ashby" }),
    ]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result.dispatched).toBe(4);
    expect(result.byQueue.workday).toBe(1);
    expect(result.byQueue.enterprise).toBe(1);
    expect(result.byQueue.publicApi).toBe(2);
    expect(sendSqsBatchMock).toHaveBeenCalledTimes(3);
  });

  it("returns zero dispatched when no companies are due", async () => {
    queryDueRegistryCompaniesMock.mockResolvedValueOnce([]);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result.dispatched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(sendSqsBatchMock).not.toHaveBeenCalled();
  });

  it("short-circuits when the registry scan flag is disabled", async () => {
    loadSystemRegistryScanFlagMock.mockResolvedValueOnce(false);
    const { handler } = await import("../../src/aws/registry-scheduler");
    const result = await handler();

    expect(result).toEqual({
      dispatched: 0,
      skipped: 0,
      byQueue: { workday: 0, enterprise: 0, publicApi: 0 },
    });
    expect(queryDueRegistryCompaniesMock).not.toHaveBeenCalled();
    expect(sendSqsBatchMock).not.toHaveBeenCalled();
  });
});
