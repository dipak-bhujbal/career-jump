import { beforeEach, describe, expect, it, vi } from "vitest";
import { userActor } from "../_helpers/actors";
import type { Env, RuntimeConfig } from "../../src/types";

const {
  loadRuntimeConfigMock,
  saveRuntimeConfigMock,
  loadBillingSubscriptionMock,
  loadPlanConfigMock,
  loadCompanyScanOverridesMock,
  setCompanyScanOverrideMock,
  setCompanyScanOverridesMock,
} = vi.hoisted(() => ({
  loadRuntimeConfigMock: vi.fn(),
  saveRuntimeConfigMock: vi.fn(),
  loadBillingSubscriptionMock: vi.fn(),
  loadPlanConfigMock: vi.fn(),
  loadCompanyScanOverridesMock: vi.fn(),
  setCompanyScanOverrideMock: vi.fn(),
  setCompanyScanOverridesMock: vi.fn(),
}));

vi.mock("../../src/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/tenant")>("../../src/lib/tenant");
  return {
    ...actual,
    resolveRequestTenantContext: vi.fn(),
  };
});

vi.mock("../../src/config", async () => {
  const actual = await vi.importActual<typeof import("../../src/config")>("../../src/config");
  return {
    ...actual,
    loadRuntimeConfig: loadRuntimeConfigMock,
    saveRuntimeConfig: saveRuntimeConfigMock,
  };
});

vi.mock("../../src/storage", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage")>("../../src/storage");
  return {
    ...actual,
    loadBillingSubscription: loadBillingSubscriptionMock,
    loadPlanConfig: loadPlanConfigMock,
    loadCompanyScanOverrides: loadCompanyScanOverridesMock,
    setCompanyScanOverride: setCompanyScanOverrideMock,
    setCompanyScanOverrides: setCompanyScanOverridesMock,
  };
});

vi.mock("../../src/storage/registry-cache", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage/registry-cache")>("../../src/storage/registry-cache");
  return {
    ...actual,
    loadRegistryCache: vi.fn(async () => ({ all: [], meta: { total: 0, version: "test" }, loadedAt: Date.now() })),
    getByCompany: vi.fn(() => null),
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

function makeConfig(companies: Array<{ company: string; enabled?: boolean }>): RuntimeConfig {
  return {
    companies: companies.map((company) => ({
      company: company.company,
      enabled: company.enabled ?? true,
    })),
    jobtitles: { includeKeywords: [], excludeKeywords: [] },
    updatedAt: "2026-04-28T00:00:00.000Z",
  };
}

async function request(pathname: string, init: RequestInit): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`, init), mockEnv);
}

describe("api smoke max companies enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantContextMock.mockResolvedValue(userActor);
    loadBillingSubscriptionMock.mockResolvedValue({ userId: userActor.userId, plan: "pro", status: "active", provider: "internal", updatedAt: "" });
    loadPlanConfigMock.mockResolvedValue({
      plan: "pro",
      displayName: "Pro",
      scanCacheAgeHours: 8,
      canTriggerLiveScan: true,
      maxCompanies: 1,
      maxSessions: 2,
      emailNotificationsEnabled: true,
      weeklyDigestEnabled: true,
      maxEmailsPerWeek: 7,
      enabledFeatures: [],
      updatedAt: "",
      updatedBy: "system",
    });
    saveRuntimeConfigMock.mockResolvedValue(undefined);
    setCompanyScanOverrideMock.mockResolvedValue({ company: "Beta", paused: true, updatedAt: "" });
    setCompanyScanOverridesMock.mockResolvedValue({});
  });

  it("rejects config save when a user adds enabled companies beyond the plan limit", async () => {
    loadRuntimeConfigMock.mockResolvedValueOnce(makeConfig([{ company: "Alpha" }]));

    const response = await request("/api/config/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companies: [{ company: "Alpha", enabled: true }, { company: "Beta", enabled: true }],
        jobtitles: { includeKeywords: [], excludeKeywords: [] },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      limit: 1,
      current: 1,
    });
    expect(saveRuntimeConfigMock).not.toHaveBeenCalled();
  });

  it("allows config save when a user reduces enabled companies while already over the plan limit", async () => {
    loadRuntimeConfigMock.mockResolvedValueOnce(makeConfig([{ company: "Alpha" }, { company: "Beta" }]));

    const response = await request("/api/config/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companies: [{ company: "Alpha", enabled: true }, { company: "Beta", enabled: false }],
        jobtitles: { includeKeywords: [], excludeKeywords: [] },
      }),
    });

    expect(response.status).toBe(200);
    expect(saveRuntimeConfigMock).toHaveBeenCalledOnce();
  });

  it("rejects company toggle when enabling a paused company would exceed the plan limit", async () => {
    loadRuntimeConfigMock.mockResolvedValueOnce(makeConfig([{ company: "Alpha" }, { company: "Beta" }]));
    loadCompanyScanOverridesMock.mockResolvedValueOnce({
      beta: { company: "Beta", paused: true, updatedAt: "" },
    });

    const response = await request("/api/companies/Beta/toggle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: false }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      limit: 1,
      current: 1,
    });
    expect(setCompanyScanOverrideMock).not.toHaveBeenCalled();
  });

  it("rejects toggle-all when re-enabling all companies would exceed the plan limit", async () => {
    loadRuntimeConfigMock.mockResolvedValueOnce(makeConfig([{ company: "Alpha" }, { company: "Beta" }]));
    loadCompanyScanOverridesMock.mockResolvedValueOnce({
      beta: { company: "Beta", paused: true, updatedAt: "" },
    });

    const response = await request("/api/companies/toggle-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: false }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      limit: 1,
      current: 1,
    });
    expect(setCompanyScanOverridesMock).not.toHaveBeenCalled();
  });
});
