import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminActor, userActor } from "../_helpers/actors";
import type { Env } from "../../src/types";

const {
  loadScanQuotaUsageMock,
  remainingLiveScansMock,
  adminSetUserPlanMock,
  getScanQuotaAnalyticsMock,
} = vi.hoisted(() => ({
  loadScanQuotaUsageMock: vi.fn(),
  remainingLiveScansMock: vi.fn(),
  adminSetUserPlanMock: vi.fn(),
  getScanQuotaAnalyticsMock: vi.fn(),
}));

vi.mock("../../src/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/tenant")>("../../src/lib/tenant");
  return {
    ...actual,
    resolveRequestTenantContext: vi.fn(),
  };
});

vi.mock("../../src/storage", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage")>("../../src/storage");
  return {
    ...actual,
    loadScanQuotaUsage: loadScanQuotaUsageMock,
    remainingLiveScans: remainingLiveScansMock,
    adminSetUserPlan: adminSetUserPlanMock,
    getScanQuotaAnalytics: getScanQuotaAnalyticsMock,
  };
});

import { resolveRequestTenantContext } from "../../src/lib/tenant";
import { handleRequest } from "../../src/routes";

const resolveTenantContextMock = vi.mocked(resolveRequestTenantContext);

const mockEnv = {
  JOB_STATE: {} as KVNamespace,
  ATS_CACHE: {} as KVNamespace,
  CONFIG_STORE: {} as KVNamespace,
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
} as unknown as Env;

async function request(pathname: string, init?: RequestInit): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`, init), mockEnv);
}

describe("api smoke scan quota routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Route-level smoke tests pin auth at the tenant-context seam so the new
    // quota endpoints can be validated without real Cognito/session setup.
    resolveTenantContextMock.mockResolvedValue(userActor);
  });

  it("returns the current tenant scan quota snapshot", async () => {
    loadScanQuotaUsageMock.mockResolvedValue({
      tenantId: userActor.tenantId,
      date: "2026-04-29",
      liveScansUsed: 1,
      lastLiveScanAt: "2026-04-29T14:00:00.000Z",
      runIds: ["manual-1"],
    });
    remainingLiveScansMock.mockResolvedValue(1);

    const response = await request("/api/scan-quota");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      liveScansUsed: 1,
      remainingLiveScansToday: 1,
      lastLiveScanAt: "2026-04-29T14:00:00.000Z",
      date: "2026-04-29",
    });
    expect(loadScanQuotaUsageMock).toHaveBeenCalledWith(userActor.tenantId);
    expect(remainingLiveScansMock).toHaveBeenCalledWith(userActor.tenantId, undefined, {
      isAdmin: false,
    });
  });

  it("lets an admin override a user's plan", async () => {
    resolveTenantContextMock.mockResolvedValue(adminActor);
    adminSetUserPlanMock.mockResolvedValue({
      userId: "user-99",
      plan: "pro",
      status: "active",
      provider: "internal",
      updatedAt: "2026-04-29T15:00:00.000Z",
    });

    const response = await request("/api/admin/users/USER%23user-99/plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "pro" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      billing: expect.objectContaining({
        userId: "user-99",
        plan: "pro",
      }),
    });
    expect(adminSetUserPlanMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: adminActor.userId,
      tenantId: adminActor.tenantId,
    }), "user-99", "pro");
  });

  it("returns scan quota analytics for admins", async () => {
    resolveTenantContextMock.mockResolvedValue(adminActor);
    getScanQuotaAnalyticsMock.mockResolvedValue({
      cachedAt: "2026-04-29T15:30:00.000Z",
      cacheExpiresAt: "2026-04-29T16:30:00.000Z",
      data: {
        cacheHitRate: 0.6,
        liveFetchRate: 0.3,
        quotaBlockRate: 0.1,
        totalRunsAnalyzed: 25,
        totalCacheHits: 60,
        totalLiveFetches: 30,
        totalQuotaBlocked: 10,
        perPlanUsage: [
          { plan: "free", totalLiveScansUsed: 8, tenantCount: 4, avgPerTenant: 2 },
        ],
        quotaUsagePerDay: [
          { date: "2026-04-29", count: 12 },
        ],
      },
    });

    const response = await request("/api/admin/analytics/scan-quota");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: expect.objectContaining({
        totalRunsAnalyzed: 25,
        totalQuotaBlocked: 10,
      }),
    });
    expect(getScanQuotaAnalyticsMock).toHaveBeenCalledTimes(1);
  });
});
