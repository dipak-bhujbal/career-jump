import { beforeEach, describe, expect, it, vi } from "vitest";

const getRowMock = vi.fn();
const putRowMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  billingTableName: vi.fn(() => "billing-table"),
  getRow: getRowMock,
  putRow: putRowMock,
}));

function makePlanRow(plan: "free" | "pro" | "power", overrides: Record<string, unknown> = {}) {
  const base = {
    free:    { plan: "free",    displayName: "Free",    scanCacheAgeHours: 0, canTriggerLiveScan: false, maxCompanies: 5,    maxSessions: 1, maxVisibleJobs: 15,  maxAppliedJobs: 50,   emailNotificationsEnabled: false, weeklyDigestEnabled: false, maxEmailsPerWeek: 0,  enabledFeatures: [] },
    starter: { plan: "starter", displayName: "Starter", scanCacheAgeHours: 4, canTriggerLiveScan: true,  maxCompanies: 10,   maxSessions: 1, maxVisibleJobs: 40,  maxAppliedJobs: 150,  emailNotificationsEnabled: false, weeklyDigestEnabled: false, maxEmailsPerWeek: 3,  enabledFeatures: [] },
    pro:     { plan: "pro",     displayName: "Pro",     scanCacheAgeHours: 8, canTriggerLiveScan: true,  maxCompanies: 25,   maxSessions: 2, maxVisibleJobs: 100, maxAppliedJobs: 500,  emailNotificationsEnabled: true,  weeklyDigestEnabled: true,  maxEmailsPerWeek: 7,  enabledFeatures: ["email_notifications"] },
    power:   { plan: "power",   displayName: "Power",   scanCacheAgeHours: 4, canTriggerLiveScan: true,  maxCompanies: null, maxSessions: 3, maxVisibleJobs: null, maxAppliedJobs: null, emailNotificationsEnabled: true,  weeklyDigestEnabled: true,  maxEmailsPerWeek: 14, enabledFeatures: ["email_notifications", "priority_scan"] },
  }[plan];
  return { pk: "PLAN_CONFIG", sk: plan, ...base, updatedAt: "2026-04-28T00:00:00.000Z", updatedBy: "admin-1", ...overrides };
}

describe("plan-config storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("loadPlanConfig", () => {
    it("returns the row from DynamoDB when present", async () => {
      getRowMock.mockResolvedValueOnce(makePlanRow("pro"));
      const { loadPlanConfig } = await import("../../src/storage/plan-config");
      const cfg = await loadPlanConfig("pro");
      expect(cfg.plan).toBe("pro");
      expect(cfg.scanCacheAgeHours).toBe(8);
      expect(cfg.canTriggerLiveScan).toBe(true);
      expect(cfg.maxCompanies).toBe(25);
      expect(getRowMock).toHaveBeenCalledWith("billing-table", { pk: "PLAN_CONFIG", sk: "pro" });
    });

    it("returns hardcoded defaults when DynamoDB returns null", async () => {
      getRowMock.mockResolvedValueOnce(null);
      const { loadPlanConfig } = await import("../../src/storage/plan-config");
      const cfg = await loadPlanConfig("free");
      expect(cfg.plan).toBe("free");
      expect(cfg.canTriggerLiveScan).toBe(false);
      expect(cfg.maxCompanies).toBe(5);
      expect(cfg.maxSessions).toBe(1);
    });

    it("serves from in-memory cache on second call without hitting DynamoDB again", async () => {
      getRowMock.mockResolvedValueOnce(makePlanRow("power"));
      const { loadPlanConfig } = await import("../../src/storage/plan-config");
      await loadPlanConfig("power");
      await loadPlanConfig("power");
      expect(getRowMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadAllPlanConfigs", () => {
    it("returns all four plans in free/starter/pro/power order", async () => {
      getRowMock
        .mockResolvedValueOnce(makePlanRow("free"))
        .mockResolvedValueOnce(makePlanRow("starter"))
        .mockResolvedValueOnce(makePlanRow("pro"))
        .mockResolvedValueOnce(makePlanRow("power"));
      const { loadAllPlanConfigs } = await import("../../src/storage/plan-config");
      const configs = await loadAllPlanConfigs();
      expect(configs).toHaveLength(4);
      expect(configs.map((c) => c.plan)).toEqual(["free", "starter", "pro", "power"]);
    });

    it("fills in defaults for any plan missing from DynamoDB", async () => {
      getRowMock
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makePlanRow("pro"))
        .mockResolvedValueOnce(null);
      const { loadAllPlanConfigs } = await import("../../src/storage/plan-config");
      const configs = await loadAllPlanConfigs();
      const free = configs.find((c) => c.plan === "free")!;
      const starter = configs.find((c) => c.plan === "starter")!;
      const power = configs.find((c) => c.plan === "power")!;
      expect(free.canTriggerLiveScan).toBe(false);
      expect(starter.canTriggerLiveScan).toBe(true);
      expect(power.canTriggerLiveScan).toBe(true);
    });

    it("serves from cache after initial load (4 DynamoDB calls total)", async () => {
      getRowMock
        .mockResolvedValueOnce(makePlanRow("free"))
        .mockResolvedValueOnce(makePlanRow("starter"))
        .mockResolvedValueOnce(makePlanRow("pro"))
        .mockResolvedValueOnce(makePlanRow("power"));
      const { loadAllPlanConfigs } = await import("../../src/storage/plan-config");
      await loadAllPlanConfigs();
      await loadAllPlanConfigs();
      expect(getRowMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("savePlanConfig", () => {
    it("writes to DynamoDB with pk=PLAN_CONFIG and sk=plan", async () => {
      putRowMock.mockResolvedValueOnce(undefined);
      const { savePlanConfig } = await import("../../src/storage/plan-config");
      const result = await savePlanConfig("admin-user-1", {
        plan: "pro",
        displayName: "Pro",
        scanCacheAgeHours: 6,
        canTriggerLiveScan: true,
        maxCompanies: 20,
        maxSessions: 2,
        maxVisibleJobs: 80,
        maxAppliedJobs: 400,
        emailNotificationsEnabled: true,
        weeklyDigestEnabled: true,
        maxEmailsPerWeek: 7,
        enabledFeatures: ["email_notifications"],
      });
      expect(putRowMock).toHaveBeenCalledWith(
        "billing-table",
        expect.objectContaining({ pk: "PLAN_CONFIG", sk: "pro", updatedBy: "admin-user-1", scanCacheAgeHours: 6 }),
      );
      expect(result.updatedBy).toBe("admin-user-1");
      expect(result.scanCacheAgeHours).toBe(6);
    });

    it("invalidates cache so next load re-reads from DynamoDB", async () => {
      getRowMock.mockResolvedValueOnce(makePlanRow("pro"));
      putRowMock.mockResolvedValueOnce(undefined);
      getRowMock.mockResolvedValueOnce(makePlanRow("pro", { scanCacheAgeHours: 6 }));

      const { loadPlanConfig, savePlanConfig } = await import("../../src/storage/plan-config");
      const before = await loadPlanConfig("pro");
      expect(before.scanCacheAgeHours).toBe(8);

      await savePlanConfig("admin-1", { ...before, scanCacheAgeHours: 6 });

      const after = await loadPlanConfig("pro");
      expect(after.scanCacheAgeHours).toBe(6);
      expect(getRowMock).toHaveBeenCalledTimes(2);
    });
  });
});
