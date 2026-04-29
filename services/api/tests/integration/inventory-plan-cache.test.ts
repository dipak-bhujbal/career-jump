import { beforeEach, describe, expect, it, vi } from "vitest";

const loadLatestRawScanMock = vi.fn();
const fetchJobsForDetectedConfigMock = vi.fn();
const saveRawScanMock = vi.fn();
const loadBillingSubscriptionMock = vi.fn();
const loadPlanConfigMock = vi.fn();
const getDetectedConfigMock = vi.fn();
const markRegistryCompanyScanSuccessMock = vi.fn();
const markRegistryCompanyScanFailureMock = vi.fn();
const markRegistryCompanyScanMisconfiguredMock = vi.fn();
const tryConsumeLiveScanMock = vi.fn();
const remainingLiveScansMock = vi.fn();

const PLAN_DEFAULTS = {
  free:    { plan: "free"    as const, canTriggerLiveScan: true, dailyLiveScans: 2,   scanCacheAgeHours: 0, maxSessions: 1, maxCompanies: 5,    maxVisibleJobs: 15,  maxAppliedJobs: 50,   emailNotificationsEnabled: false, weeklyDigestEnabled: false, maxEmailsPerWeek: 0,  enabledFeatures: [], displayName: "Free",    updatedAt: "", updatedBy: "system" },
  starter: { plan: "starter" as const, canTriggerLiveScan: true, dailyLiveScans: 10,  scanCacheAgeHours: 4, maxSessions: 1, maxCompanies: 10,   maxVisibleJobs: 40,  maxAppliedJobs: 150,  emailNotificationsEnabled: false, weeklyDigestEnabled: false, maxEmailsPerWeek: 3,  enabledFeatures: [], displayName: "Starter", updatedAt: "", updatedBy: "system" },
  pro:     { plan: "pro"     as const, canTriggerLiveScan: true, dailyLiveScans: 30,  scanCacheAgeHours: 8, maxSessions: 2, maxCompanies: 25,   maxVisibleJobs: 100, maxAppliedJobs: 500,  emailNotificationsEnabled: true,  weeklyDigestEnabled: true,  maxEmailsPerWeek: 7,  enabledFeatures: [], displayName: "Pro",     updatedAt: "", updatedBy: "system" },
  power:   { plan: "power"   as const, canTriggerLiveScan: true, dailyLiveScans: 100, scanCacheAgeHours: 4, maxSessions: 3, maxCompanies: null, maxVisibleJobs: null, maxAppliedJobs: null, emailNotificationsEnabled: true,  weeklyDigestEnabled: true,  maxEmailsPerWeek: 14, enabledFeatures: [], displayName: "Power",   updatedAt: "", updatedBy: "system" },
};

vi.mock("../../src/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/storage")>();
  return {
    ...actual,
    loadLatestRawScan: loadLatestRawScanMock,
    saveRawScan: saveRawScanMock,
    loadBillingSubscription: loadBillingSubscriptionMock,
    loadPlanConfig: loadPlanConfigMock,
    markRegistryCompanyScanSuccess: markRegistryCompanyScanSuccessMock,
    markRegistryCompanyScanFailure: markRegistryCompanyScanFailureMock,
    markRegistryCompanyScanMisconfigured: markRegistryCompanyScanMisconfiguredMock,
    tryConsumeLiveScan: tryConsumeLiveScanMock,
    remainingLiveScans: remainingLiveScansMock,
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

describe("buildInventory quota-gated cache enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    saveRawScanMock.mockResolvedValue(undefined);
    tryConsumeLiveScanMock.mockResolvedValue(true);
    remainingLiveScansMock.mockResolvedValue(5);
    markRegistryCompanyScanSuccessMock.mockResolvedValue(undefined);
    markRegistryCompanyScanFailureMock.mockResolvedValue(undefined);
    markRegistryCompanyScanMisconfiguredMock.mockResolvedValue(undefined);
    loadPlanConfigMock.mockImplementation((plan: "free" | "pro" | "power") =>
      Promise.resolve(PLAN_DEFAULTS[plan]),
    );
  });

  it("free tier: serves fresh cache without consuming quota", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // Fresh cache hit — within free's window
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: new Date().toISOString() });

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-123");

    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(tryConsumeLiveScanMock).not.toHaveBeenCalled();
    expect(inventory.stats.cacheHits).toBe(1);
  });

  it("free tier: cache miss with quota available — performs live fetch and consumes quota", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // First call: outer fresh check (miss); second call: inside fetchCompanyJobsWithSharedCache (miss)
    loadLatestRawScanMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tryConsumeLiveScanMock.mockResolvedValueOnce(true);
    fetchJobsForDetectedConfigMock.mockResolvedValueOnce(LIVE_JOBS);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-free-quota");

    expect(tryConsumeLiveScanMock).toHaveBeenCalledOnce();
    expect(fetchJobsForDetectedConfigMock).toHaveBeenCalledOnce();
    expect(inventory.stats.liveFetchCompanies).toBe(1);
  });

  it("free tier: cache miss with NO quota and no stale — returns quota_blocked and skips live fetch", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // First call: outer fresh check (miss); second call: stale fallback check (also miss)
    loadLatestRawScanMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tryConsumeLiveScanMock.mockResolvedValueOnce(false);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-free-blocked");

    expect(tryConsumeLiveScanMock).toHaveBeenCalledOnce();
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(inventory.stats.totalFetched).toBe(0);
    expect(inventory.stats.quotaBlockedCompanies).toContain("Stripe");
  });

  it("free tier: cache miss with NO quota but stale cache present — serves stale without blocking", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    const staleScannedAt = "2026-04-20T10:00:00.000Z";
    // First call: outer fresh check (miss); second call: stale fallback (hit)
    loadLatestRawScanMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: staleScannedAt });
    tryConsumeLiveScanMock.mockResolvedValueOnce(false);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-free-stale");

    expect(tryConsumeLiveScanMock).toHaveBeenCalledOnce();
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(inventory.stats.quotaBlockedCompanies).toBeUndefined();
    expect(inventory.stats.cacheHits).toBe(1);
    expect(inventory.stats.totalFetched).toBe(1);
  });

  it("pro tier: serves cache when within 8h threshold — no quota consumed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T10:00:00.000Z"));
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: "2026-04-28T04:00:00.000Z" });

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-456");

    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
    expect(tryConsumeLiveScanMock).not.toHaveBeenCalled();
    expect(inventory.stats.totalFetched).toBe(1);
    expect(loadLatestRawScanMock).toHaveBeenCalledWith(
      "Stripe",
      DETECTED_GREENHOUSE,
      expect.objectContaining({ maxAgeMs: 8 * 60 * 60 * 1000 }),
    );
  });

  it("pro tier: cache miss with quota — triggers live fetch and consumes quota", async () => {
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // First: outer fresh check (miss); second: inside fetchCompanyJobsWithSharedCache (miss)
    loadLatestRawScanMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tryConsumeLiveScanMock.mockResolvedValueOnce(true);
    fetchJobsForDetectedConfigMock.mockResolvedValueOnce(LIVE_JOBS);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-456");

    expect(tryConsumeLiveScanMock).toHaveBeenCalledOnce();
    expect(fetchJobsForDetectedConfigMock).toHaveBeenCalledOnce();
    expect(saveRawScanMock).toHaveBeenCalledOnce();
    expect(inventory.stats.totalFetched).toBe(1);
  });

  it("power tier: triggers live fetch when cache exceeds 4h", async () => {
    const { config, env } = makeConfig("power");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tryConsumeLiveScanMock.mockResolvedValueOnce(true);
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

  it("cache-hit: does NOT call markRegistryCompanyScanSuccess", async () => {
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: "2026-04-28T04:00:00.000Z" });

    const { buildInventory } = await import("../../src/services/inventory");
    await buildInventory(env, config, null, undefined, "user-cache-hit");

    expect(markRegistryCompanyScanSuccessMock).not.toHaveBeenCalled();
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
  });

  it("live fetch: DOES call markRegistryCompanyScanSuccess", async () => {
    const { config, env } = makeConfig("pro");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadLatestRawScanMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tryConsumeLiveScanMock.mockResolvedValueOnce(true);
    fetchJobsForDetectedConfigMock.mockResolvedValueOnce(LIVE_JOBS);

    const { buildInventory } = await import("../../src/services/inventory");
    await buildInventory(env, config, null, undefined, "user-live");

    expect(markRegistryCompanyScanSuccessMock).toHaveBeenCalledOnce();
  });

  it("defaults to free tier behavior when billing lookup fails", async () => {
    const config = {
      companies: [{ company: "Stripe", source: "greenhouse", enabled: true }],
      jobtitles: { includeKeywords: ["engineer"], excludeKeywords: [] },
      updatedAt: "2026-04-28T00:00:00.000Z",
    } as unknown as import("../../src/types").RuntimeConfig;
    const env = {} as import("../../src/types").Env;
    loadBillingSubscriptionMock.mockRejectedValueOnce(new Error("billing unavailable"));
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    // Cache is available — should be served without quota gate
    loadLatestRawScanMock.mockResolvedValueOnce({ jobs: CACHED_JOBS, scannedAt: new Date().toISOString() });

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-000");

    expect(inventory).toBeDefined();
    expect(fetchJobsForDetectedConfigMock).not.toHaveBeenCalled();
  });

  it("falls back to live-fetch mode when plan-config lookup fails", async () => {
    const { config, env } = makeConfig("free");
    getDetectedConfigMock.mockResolvedValueOnce(DETECTED_GREENHOUSE);
    loadPlanConfigMock.mockRejectedValueOnce(new Error("plan config unavailable"));
    loadLatestRawScanMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    tryConsumeLiveScanMock.mockResolvedValueOnce(true);
    fetchJobsForDetectedConfigMock.mockResolvedValueOnce(LIVE_JOBS);

    const { buildInventory } = await import("../../src/services/inventory");
    const inventory = await buildInventory(env, config, null, undefined, "user-plan-config-miss");

    expect(tryConsumeLiveScanMock).toHaveBeenCalledOnce();
    expect(fetchJobsForDetectedConfigMock).toHaveBeenCalledOnce();
    expect(inventory.stats.liveFetchCompanies).toBe(1);
  });
});
