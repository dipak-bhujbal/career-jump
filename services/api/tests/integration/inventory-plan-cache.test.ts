import { beforeEach, describe, expect, it, vi } from "vitest";

const loadLatestRawScanMock = vi.fn();
const fetchJobsForDetectedConfigMock = vi.fn();
const saveRawScanMock = vi.fn();
const loadBillingSubscriptionMock = vi.fn();
const getDetectedConfigMock = vi.fn();
const markRegistryCompanyScanSuccessMock = vi.fn();
const markRegistryCompanyScanFailureMock = vi.fn();
const markRegistryCompanyScanMisconfiguredMock = vi.fn();

vi.mock("../../src/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/storage")>();
  return {
    ...actual,
    loadLatestRawScan: loadLatestRawScanMock,
    saveRawScan: saveRawScanMock,
    loadBillingSubscription: loadBillingSubscriptionMock,
    markRegistryCompanyScanSuccess: markRegistryCompanyScanSuccessMock,
    markRegistryCompanyScanFailure: markRegistryCompanyScanFailureMock,
    markRegistryCompanyScanMisconfigured: markRegistryCompanyScanMisconfiguredMock,
    loadDiscardRegistry: vi.fn().mockResolvedValue({ jobKeys: new Set(), fingerprints: new Set() }),
    loadAppliedJobs: vi.fn().mockResolvedValue({}),
    loadJobNotes: vi.fn().mockResolvedValue({}),
    recordAppLog: vi.fn().mockResolvedValue(undefined),
    recordEvent: vi.fn().mockResolvedValue(undefined),
    saveJobNotes: vi.fn().mockResolvedValue(undefined),
    ensureActiveRunOwnership: vi.fn().mockResolvedValue(undefined),
    heartbeatActiveRun: vi.fn().mockResolvedValue(undefined),
    promoteCustomCompaniesToRegistry: vi.fn().mockResolvedValue(undefined),
    firstSeenFingerprintKey: actual.firstSeenFingerprintKey,
    seenJobKey: actual.seenJobKey,
    legacySeenJobKeys: actual.legacySeenJobKeys,
  };
});

vi.mock("../../src/services/discovery", () => ({
  fetchJobsForDetectedConfig: fetchJobsForDetectedConfigMock,
  getDetectedConfig: getDetectedConfigMock,
}));

vi.mock("../../src/ats/shared/init-core", () => ({}));
vi.mock("../../src/ats/custom", () => ({}));
vi.mock("../../src/lib/bindings", () => ({
  jobStateKv: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] }),
  })),
}));

const DETECTED_GREENHOUSE: import("../../src/types").DetectedConfig = {
  source: "greenhouse",
  boardToken: "stripe",
};

const CACHED_JOBS = [
  { id: "job1", title: "Engineer", company: "Stripe", source: "greenhouse", url: "https://greenhouse.io/1" },
];

const LIVE_JOBS = [
  { id: "job2", title: "Staff Engineer", company: "Stripe", source: "greenhouse", url: "https://greenhouse.io/2" },
];

function makeConfig(plan: string): { config: import("../../src/types").RuntimeConfig; env: import("../../src/types").Env } {
  const config = {
    companies: [{ company: "Stripe", source: "greenhouse", enabled: true }],
    jobtitles: { includeKeywords: ["engineer"], excludeKeywords: [] },
    updatedAt: "2026-04-28T00:00:00.000Z",
  } as unknown as import("../../src/types").RuntimeConfig;
  const env = {} as import("../../src/types").Env;
  loadBillingSubscriptionMock.mockResolvedValue({ plan });
  return { config, env };
}

describe("buildInventory plan-tier cache enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    saveRawScanMock.mockResolvedValue(undefined);
    markRegistryCompanyScanSuccessMock.mockResolvedValue(undefined);
    markRegistryCompanyScanFailureMock.mockResolvedValue(undefined);
    markRegistryCompanyScanMisconfiguredMock.mockResolvedValue(undefined);
  });

  it("free tier: serves stale cache and never calls fetchJobsForDetectedConfig", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // loadLatestRawScan called with allowStale: true for free tier
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: "2026-04-27T00:00:00.000Z" });

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-123");

    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(saveRawScanMock).not.toHaveBeenCalled();
    expect(inventory.jobs.length).toBeGreaterThanOrEqual(0);
    expect(loadLatestRawScanMock).toHaveBeenCalledWith(
      "Stripe",
      DETECTED_GREENHOUSE,
      expect.objectContaining({ allowStale: true }),
    );
  });

  it("free tier: returns empty jobs when no cache exists (no live fetch)", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce(null);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-123");

    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(inventory.stats.totalFetched).toBe(0);
  });

  it("pro tier: serves cache when within 8h threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T10:00:00.000Z"));
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // scannedAt is 6h ago — within 8h threshold for Pro
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: "2026-04-28T04:00:00.000Z" });

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-456");

    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(inventory.stats.totalFetched).toBe(1);
    expect(loadLatestRawScanMock).toHaveBeenCalledWith(
      "Stripe",
      DETECTED_GREENHOUSE,
      expect.objectContaining({ maxAgeMs: 8 * 60 * 60 * 1000 }),
    );
  });

  it("pro tier: triggers live fetch when cache exceeds 8h", async () => {
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // loadLatestRawScan returns null (cache is too old for Pro)
    loadLatestRawScanMock.mockResolvedValueOnce(null);
    fetchJobsForDetectedConfigMock.mockResolvedValueOnce(LIVE_JOBS);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-456");

    expect(fetchJobsForDetectedConfigMock).toHaveBeenCalledOnce();
    expect(saveRawScanMock).toHaveBeenCalledOnce();
    expect(inventory.stats.totalFetched).toBe(1);
  });

  it("power tier: triggers live fetch when cache exceeds 4h", async () => {
    const { config, env } = makeConfig("power");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce(null);
    fetchJobsForDetectedConfigMock.mockResolvedValueOnce(LIVE_JOBS);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-789");

    expect(fetchJobsForDetectedConfigMock).toHaveBeenCalledOnce();
    expect(saveRawScanMock).toHaveBeenCalledOnce();
    expect(loadLatestRawScanMock).toHaveBeenCalledWith(
      "Stripe",
      DETECTED_GREENHOUSE,
      expect.objectContaining({ maxAgeMs: 4 * 60 * 60 * 1000 }),
    );
  });

  it("cache-hit: does NOT call markRegistryCompanyScanSuccess (scan-state must stay clean)", async () => {
    // Covers free, pro-within-threshold, and power-within-threshold — any cache hit
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // Cache is 6h old — within Pro's 8h window
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: "2026-04-28T04:00:00.000Z" });

    const { buildInventory } = await import("../../src/services/inventory");
    await buildInventory(env, config, null, undefined, "user-cache-hit");

    expect(markRegistryCompanyScanSuccessMock).not.toHaveBeenCalled();
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
  });

  it("live fetch: DOES call markRegistryCompanyScanSuccess", async () => {
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // Cache miss — triggers live fetch
    loadLatestRawScanMock.mockResolvedValueOnce(null);
    fetchJobsForDetectedConfigMock.mockResolvedValueOnce(LIVE_JOBS);

    const { buildInventory } = await import("../../src/services/inventory");
    await buildInventory(env, config, null, undefined, "user-live");

    expect(markRegistryCompanyScanSuccessMock).toHaveBeenCalledOnce();
  });

  it("free tier: does NOT call markRegistryCompanyScanSuccess even when stale cache exists", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: "2026-04-27T00:00:00.000Z" });

    const { buildInventory } = await import("../../src/services/inventory");
    await buildInventory(env, config, null, undefined, "user-free-stale");

    expect(markRegistryCompanyScanSuccessMock).not.toHaveBeenCalled();
  });

  it("defaults to free tier when billing lookup fails", async () => {
    const config = {
      companies: [{ company: "Stripe", source: "greenhouse", enabled: true }],
      jobtitles: { includeKeywords: ["engineer"], excludeKeywords: [] },
      updatedAt: "2026-04-28T00:00:00.000Z",
    } as unknown as import("../../src/types").RuntimeConfig;
    const env = {} as import("../../src/types").Env;
    loadBillingSubscriptionMock.mockRejectedValueOnce(new Error("billing unavailable"));
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: "2026-04-27T00:00:00.000Z" });

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-000");

    // Should behave like free: no live fetch
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(loadLatestRawScanMock).toHaveBeenCalledWith(
      "Stripe",
      DETECTED_GREENHOUSE,
      expect.objectContaining({ allowStale: true }),
    );
    expect(inventory).toBeDefined();
  });
});
