import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, RuntimeConfig } from "../../src/types";

const loadLatestRawScanMock = vi.fn();
const loadSystemWorkdayLayerFlagsMock = vi.fn();
const loadWorkdayScanStateMock = vi.fn();
const markWorkdayLayerPromotionMock = vi.fn();
const markWorkdayScanFailureMock = vi.fn();
const markWorkdayScanSuccessMock = vi.fn();
const saveRawScanMock = vi.fn();
const recordAppLogMock = vi.fn();
const recordEventMock = vi.fn();

const getDetectedConfigMock = vi.fn();
const scanWorkdayJobsMock = vi.fn();

vi.mock("../../src/storage", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage")>("../../src/storage");
  return {
    ...actual,
    ensureActiveRunOwnership: vi.fn(),
    heartbeatActiveRun: vi.fn(),
    legacySeenJobKeys: vi.fn(async () => new Set()),
    loadAppliedJobs: vi.fn(async () => ({})),
    loadJobNotes: vi.fn(async () => ({})),
    loadLatestRawScan: loadLatestRawScanMock,
    loadSystemWorkdayLayerFlags: loadSystemWorkdayLayerFlagsMock,
    loadWorkdayScanState: loadWorkdayScanStateMock,
    markWorkdayLayerPromotion: markWorkdayLayerPromotionMock,
    markWorkdayScanFailure: markWorkdayScanFailureMock,
    markWorkdayScanSuccess: markWorkdayScanSuccessMock,
    recordAppLog: recordAppLogMock,
    recordEvent: recordEventMock,
    saveRawScan: saveRawScanMock,
    saveJobNotes: vi.fn(async () => undefined),
    seenJobKey: vi.fn(() => "seen"),
    shouldBypassLiveWorkdayScan: vi.fn(() => false),
    firstSeenFingerprintKey: vi.fn(() => "fingerprint"),
  };
});

vi.mock("../../src/services/discovery", async () => {
  const actual = await vi.importActual<typeof import("../../src/services/discovery")>("../../src/services/discovery");
  return {
    ...actual,
    fetchJobsForDetectedConfig: vi.fn(),
    getDetectedConfig: getDetectedConfigMock,
  };
});

vi.mock("../../src/ats/core/workday", () => ({
  isScraperApiConfigured: vi.fn(() => true),
  scanWorkdayJobs: scanWorkdayJobsMock,
}));

function makeKvNamespace() {
  return {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: "" })),
  } as unknown as KVNamespace;
}

const mockEnv = {
  JOB_STATE: makeKvNamespace(),
  ATS_CACHE: makeKvNamespace(),
  CONFIG_STORE: makeKvNamespace(),
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
} as unknown as Env;

const runtimeConfig: RuntimeConfig = {
  companies: [
    {
      company: "Acme",
      enabled: true,
      source: "workday",
      sampleUrl: "https://example.workdayjobs.com/job",
      workdayBaseUrl: "https://example.workdayjobs.com",
      host: "example.workdayjobs.com",
      tenant: "example",
      site: "careers",
    },
  ],
  jobtitles: { includeKeywords: ["engineer"], excludeKeywords: [] },
  updatedAt: "2026-04-27T00:00:00.000Z",
};

const detectedConfig = {
  company: "Acme",
  source: "workday" as const,
  sampleUrl: "https://example.workdayjobs.com/job",
  workdayBaseUrl: "https://example.workdayjobs.com",
  host: "example.workdayjobs.com",
  tenant: "example",
  site: "careers",
};

describe("integration workday layer promotion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadLatestRawScanMock.mockResolvedValue(null);
    getDetectedConfigMock.mockResolvedValue(detectedConfig);
    loadWorkdayScanStateMock.mockResolvedValue({
      company: "Acme",
      companySlug: "acme",
      scanLayer: "layer1",
      fallbackLayer: "layer2",
      rateLimitStatus: "ok",
      resumeAfter: null,
      failureCount24h: 0,
      lastFailureReason: null,
      lastFailureAt: null,
      probeSuccessCount: 0,
      updatedAt: "2026-04-27T00:00:00.000Z",
    });
    loadSystemWorkdayLayerFlagsMock.mockResolvedValue({ layer2: true, layer3: false });
    markWorkdayLayerPromotionMock.mockResolvedValue(undefined);
    markWorkdayScanFailureMock.mockResolvedValue(undefined);
    markWorkdayScanSuccessMock.mockResolvedValue(undefined);
    saveRawScanMock.mockResolvedValue(undefined);
    recordAppLogMock.mockResolvedValue(undefined);
    recordEventMock.mockReturnValue(Promise.resolve(undefined));
  });

  it("attempts layer2 promotion after a layer1 failure when the flag is enabled", async () => {
    scanWorkdayJobsMock
      .mockResolvedValueOnce({
        ok: false,
        layerUsed: "layer1",
        failureReason: "blocked",
        retryAfter: null,
        message: "layer1 failed",
      })
      .mockResolvedValueOnce({
        ok: true,
        layerUsed: "layer2",
        jobs: [],
      });
    const { buildInventory } = await import("../../src/services/inventory");

    const inventory = await buildInventory(mockEnv, runtimeConfig);

    expect(markWorkdayLayerPromotionMock).toHaveBeenCalledWith("Acme", "layer2");
    expect(scanWorkdayJobsMock).toHaveBeenNthCalledWith(
      2,
      "Acme",
      expect.objectContaining({ host: "example.workdayjobs.com" }),
      ["engineer"],
      "layer2",
    );
    expect(markWorkdayScanSuccessMock).toHaveBeenCalledWith("Acme", "layer2");
    expect(inventory.stats.totalJobsMatched).toBe(0);
  });

  it("skips promotion and records a failed company summary when layer2 is disabled and there is no stale raw scan", async () => {
    loadSystemWorkdayLayerFlagsMock.mockResolvedValueOnce({ layer2: false, layer3: false });
    scanWorkdayJobsMock.mockResolvedValueOnce({
      ok: false,
      layerUsed: "layer1",
      failureReason: "blocked",
      retryAfter: null,
      message: "layer1 failed",
    });
    const { buildInventory } = await import("../../src/services/inventory");

    const inventory = await buildInventory(mockEnv, runtimeConfig);

    expect(markWorkdayLayerPromotionMock).not.toHaveBeenCalled();
    expect(saveRawScanMock).not.toHaveBeenCalled();
    expect(recordEventMock).toHaveBeenCalledWith(
      null,
      "SCAN_FAILED",
      expect.objectContaining({ company: "Acme", layer: "layer1" }),
    );
    expect(inventory.stats).toMatchObject({
      totalJobsMatched: 0,
      totalCompaniesConfigured: 1,
      totalCompaniesDetected: 0,
      totalFetched: 0,
      byCompany: { Acme: 0 },
      byCompanyFetched: { Acme: 0 },
    });
    expect(recordAppLogMock).toHaveBeenCalledWith(
      mockEnv,
      expect.objectContaining({
        event: "company_scan_failed",
        company: "Acme",
      }),
    );
  });

  it("returns stale raw scan data without promotion when the fallback flag is disabled", async () => {
    loadLatestRawScanMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        jobs: [
          {
            source: "workday",
            company: "Acme",
            id: "1",
            title: "Backend Engineer",
            location: "Remote, United States",
            url: "https://example.com/job/1",
          },
        ],
        scannedAt: "2026-04-27T20:00:00.000Z",
      });
    loadSystemWorkdayLayerFlagsMock.mockResolvedValueOnce({ layer2: false, layer3: false });
    scanWorkdayJobsMock.mockResolvedValueOnce({
      ok: false,
      layerUsed: "layer1",
      failureReason: "blocked",
      retryAfter: null,
      message: "layer1 failed",
    });
    const { buildInventory } = await import("../../src/services/inventory");

    const inventory = await buildInventory(mockEnv, runtimeConfig);

    expect(markWorkdayLayerPromotionMock).not.toHaveBeenCalled();
    expect(recordEventMock).toHaveBeenCalledWith(
      null,
      "SCAN_FAILED",
      expect.objectContaining({ company: "Acme", layer: "layer1" }),
    );
    expect(inventory.stats).toMatchObject({
      totalCompaniesDetected: 1,
      totalFetched: 1,
      byCompanyFetched: { Acme: 1 },
    });
    expect(recordAppLogMock).toHaveBeenCalledWith(
      mockEnv,
      expect.objectContaining({
        event: "company_scan_completed",
        company: "Acme",
      }),
    );
  });

  it("escalates from layer2 to layer3 after a promoted company fails its layer1 probe and layer2 retry", async () => {
    loadWorkdayScanStateMock.mockResolvedValueOnce({
      company: "Acme",
      companySlug: "acme",
      scanLayer: "layer2",
      fallbackLayer: "layer3",
      rateLimitStatus: "layer_promoted",
      resumeAfter: null,
      failureCount24h: 1,
      lastFailureReason: "blocked",
      lastFailureAt: "2026-04-27T00:00:00.000Z",
      probeSuccessCount: 0,
      updatedAt: "2026-04-27T00:00:00.000Z",
    });
    loadSystemWorkdayLayerFlagsMock.mockResolvedValueOnce({ layer2: true, layer3: true });
    scanWorkdayJobsMock
      .mockResolvedValueOnce({
        ok: false,
        layerUsed: "layer1",
        failureReason: "blocked",
        retryAfter: null,
        message: "layer1 probe failed",
      })
      .mockResolvedValueOnce({
        ok: false,
        layerUsed: "layer2",
        failureReason: "captcha",
        retryAfter: null,
        message: "layer2 failed",
      })
      .mockResolvedValueOnce({
        ok: true,
        layerUsed: "layer3",
        jobs: [],
      });

    const { buildInventory } = await import("../../src/services/inventory");
    await buildInventory(mockEnv, runtimeConfig);

    expect(markWorkdayLayerPromotionMock).toHaveBeenCalledWith("Acme", "layer3");
    expect(scanWorkdayJobsMock).toHaveBeenNthCalledWith(
      3,
      "Acme",
      expect.objectContaining({ host: "example.workdayjobs.com" }),
      ["engineer"],
      "layer3",
    );
    expect(markWorkdayScanSuccessMock).toHaveBeenCalledWith("Acme", "layer3");
  });
});
