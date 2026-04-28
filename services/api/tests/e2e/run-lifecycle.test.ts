import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, RuntimeConfig } from "../../src/types";

const scanWorkdayJobsMock = vi.fn();
const getDetectedConfigMock = vi.fn();
const recordAppLogMock = vi.fn();
const ensureActiveRunOwnershipMock = vi.fn();
const loadWorkdayScanStateMock = vi.fn();
const markWorkdayScanSuccessMock = vi.fn();
const markWorkdayScanFailureMock = vi.fn();

// queryRows routes by table and event type
const queryRowsImpl = vi.fn(async () => []);
const putRowImpl = vi.fn(async () => undefined);
const getRowImpl = vi.fn(async () => null);

vi.mock("../../src/aws/dynamo", () => ({
  stateTableName: vi.fn(() => "state-table"),
  eventsTableName: vi.fn(() => "events-table"),
  registryTableName: vi.fn(() => "registry-table"),
  rawScansTableName: vi.fn(() => "raw-scans-table"),
  getRow: getRowImpl,
  putRow: putRowImpl,
  queryRows: queryRowsImpl,
  deleteRow: vi.fn(async () => undefined),
}));

vi.mock("../../src/ats/core/workday", () => ({
  scanWorkdayJobs: scanWorkdayJobsMock,
}));

vi.mock("../../src/services/discovery", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/discovery")>(
    "../../src/services/discovery"
  );
  return { ...actual, getDetectedConfig: getDetectedConfigMock };
});

vi.mock("../../src/storage", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage")>("../../src/storage");
  return {
    ...actual,
    ensureActiveRunOwnership: ensureActiveRunOwnershipMock,
    heartbeatActiveRun: vi.fn(async () => undefined),
    legacySeenJobKeys: vi.fn(async () => new Set()),
    loadAppliedJobs: vi.fn(async () => ({})),
    loadBillingSubscription: vi.fn(async () => ({ plan: "power" })),
    loadPlanConfig: vi.fn(async () => ({
      plan: "power", canTriggerLiveScan: true, scanCacheAgeHours: 4,
      maxSessions: 3, maxCompanies: null, emailNotificationsEnabled: true,
      weeklyDigestEnabled: true, maxEmailsPerWeek: 14, enabledFeatures: [],
      displayName: "Power", updatedAt: "", updatedBy: "system",
    })),
    loadJobNotes: vi.fn(async () => ({})),
    loadLatestRawScan: vi.fn(async () => null),
    loadSystemWorkdayLayerFlags: vi.fn(async () => ({ layer2: false, layer3: false })),
    loadWorkdayScanState: loadWorkdayScanStateMock,
    markWorkdayLayerPromotion: vi.fn(async () => undefined),
    markWorkdayScanFailure: markWorkdayScanFailureMock,
    markWorkdayScanSuccess: markWorkdayScanSuccessMock,
    promoteCustomCompaniesToRegistry: vi.fn(async () => []),
    recordAppLog: recordAppLogMock,
    recordEvent: vi.fn(async () => undefined),
    saveRawScan: vi.fn(async () => undefined),
    saveJobNotes: vi.fn(async () => undefined),
    seenJobKey: vi.fn((id: string) => `seen:${id}`),
    firstSeenFingerprintKey: vi.fn((fp: string) => `fp:${fp}`),
    shouldBypassLiveWorkdayScan: vi.fn(() => false),
  };
});

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: "" })),
  } as unknown as KVNamespace;
}

const mockEnv = {
  JOB_STATE: makeKv(),
  ATS_CACHE: makeKv(),
  CONFIG_STORE: makeKv(),
  DB: {} as D1Database,
  ASSETS: { fetch: vi.fn(async () => new Response("", { status: 200 })) },
} as unknown as Env;

const config: RuntimeConfig = {
  companies: [
    {
      company: "Acme",
      enabled: true,
      source: "workday",
      sampleUrl: "https://acme.workdayjobs.com/job",
      workdayBaseUrl: "https://acme.workdayjobs.com",
      host: "acme.workdayjobs.com",
      tenant: "acme",
      site: "careers",
    },
  ],
  jobtitles: { includeKeywords: ["engineer"], excludeKeywords: [] },
  updatedAt: "2026-04-28T00:00:00.000Z",
};

const detectedConfig = {
  company: "Acme",
  source: "workday" as const,
  sampleUrl: "https://acme.workdayjobs.com/job",
  workdayBaseUrl: "https://acme.workdayjobs.com",
  host: "acme.workdayjobs.com",
  tenant: "acme",
  site: "careers",
};

const sampleJob = {
  source: "workday" as const,
  company: "Acme",
  id: "job-1",
  title: "Senior Engineer",
  location: "Remote, United States",
  url: "https://acme.workdayjobs.com/job/job-1",
  matchedKeywords: ["engineer"],
};

describe("e2e run lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureActiveRunOwnershipMock.mockResolvedValue(undefined);
    recordAppLogMock.mockResolvedValue(undefined);
    markWorkdayScanSuccessMock.mockResolvedValue(undefined);
    markWorkdayScanFailureMock.mockResolvedValue(undefined);

    getDetectedConfigMock.mockResolvedValue(detectedConfig);
    loadWorkdayScanStateMock.mockResolvedValue({
      company: "Acme",
      companySlug: "acme",
      scanLayer: "layer1",
      fallbackLayer: null,
      rateLimitStatus: "ok",
      resumeAfter: null,
      failureCount24h: 0,
      lastFailureReason: null,
      lastFailureAt: null,
      probeSuccessCount: 0,
      updatedAt: "2026-04-28T00:00:00.000Z",
    });
    putRowImpl.mockResolvedValue(undefined);
    getRowImpl.mockResolvedValue(null);
    queryRowsImpl.mockResolvedValue([]);
  });

  it("returns a populated inventory and logs completion when the scanner succeeds", async () => {
    scanWorkdayJobsMock.mockResolvedValueOnce({
      ok: true,
      layerUsed: "layer1",
      jobs: [sampleJob],
    });

    const { runScan } = await import("../../src/services/inventory");
    const result = await runScan(mockEnv, config, "run-001", "tenant-1");

    // Scanner was actually invoked
    expect(scanWorkdayJobsMock).toHaveBeenCalledTimes(1);

    // Inventory contains the job returned by the scanner
    expect(result.inventory.stats.totalJobsMatched).toBe(1);
    expect(result.inventory.stats.byCompany).toMatchObject({ Acme: 1 });

    // Inventory was persisted to KV (saveInventory calls env.JOB_STATE.put)
    expect((mockEnv.JOB_STATE as { put: ReturnType<typeof vi.fn> }).put).toHaveBeenCalled();

    // Completion was logged
    expect(recordAppLogMock).toHaveBeenCalledWith(
      mockEnv,
      expect.objectContaining({ event: "final_inventory_counts" })
    );

    // Scan success was recorded for the Workday state machine
    expect(markWorkdayScanSuccessMock).toHaveBeenCalledWith("Acme", "layer1");
  });

  it("uses a stale raw scan and still builds a valid inventory when the live scan fails", async () => {
    scanWorkdayJobsMock.mockResolvedValueOnce({
      ok: false,
      layerUsed: "layer1",
      failureReason: "rate-limited",
      retryAfter: null,
      message: "Workday returned 429",
    });

    // Seed a stale raw scan via the queryRows mock for rawScansTableName
    const staleJob = { ...sampleJob, id: "stale-job-1", title: "Stale Engineer" };
    queryRowsImpl.mockImplementation(async (_table: string) => {
      if (_table === "raw-scans-table") {
        return [
          {
            pk: "RAW_SCAN#workday#host:acme-workdayjobs-com|tenant:acme|site:careers",
            sk: "2026-04-28T06:00:00.000Z",
            gsi1pk: "RAW_SCAN",
            gsi1sk: "2026-04-28T06:00:00.000Z",
            entityType: "RAW_SCAN",
            company: "Acme",
            companySlug: "acme",
            source: "workday",
            detected: detectedConfig,
            jobs: [staleJob],
            fetchedCount: 1,
            scannedAt: "2026-04-28T06:00:00.000Z",
            expiresAtEpoch: Math.floor(Date.now() / 1000) + 3600,
            schemaVersion: 1,
          },
        ];
      }
      return [];
    });

    // loadLatestRawScan is called twice: once before the live scan (fresh-cache check),
    // and once after the live scan fails (stale-fallback check).
    // First call must return null so the live scan is attempted; second returns stale data.
    const storageMod = await import("../../src/storage");
    vi.mocked(storageMod.loadLatestRawScan)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        jobs: [staleJob],
        scannedAt: "2026-04-28T06:00:00.000Z",
      });

    const { runScan } = await import("../../src/services/inventory");
    const result = await runScan(mockEnv, config, "run-002", "tenant-1");

    // Scanner was called (and failed)
    expect(scanWorkdayJobsMock).toHaveBeenCalledTimes(1);

    // Stale job appears in the final inventory
    expect(result.inventory.stats.totalJobsMatched).toBe(1);
    expect(result.inventory.stats.byCompany).toMatchObject({ Acme: 1 });

    // Inventory was still persisted (stale data is better than no data)
    expect((mockEnv.JOB_STATE as { put: ReturnType<typeof vi.fn> }).put).toHaveBeenCalled();

    // Completion was still logged
    expect(recordAppLogMock).toHaveBeenCalledWith(
      mockEnv,
      expect.objectContaining({ event: "final_inventory_counts" })
    );
  });
});
