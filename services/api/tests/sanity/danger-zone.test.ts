import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../../src/routes";
import { userActor } from "../_helpers/actors";
import type { Env, RuntimeConfig } from "../../src/types";

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
    loadRuntimeConfig: vi.fn(),
  };
});

vi.mock("../../src/storage", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage")>("../../src/storage");
  return {
    ...actual,
    clearATSCache: vi.fn(),
    deleteKvPrefix: vi.fn(),
    saveAppliedJobsForTenant: vi.fn(),
    saveJobNotes: vi.fn(),
  };
});

import { resolveRequestTenantContext } from "../../src/lib/tenant";
import { loadRuntimeConfig } from "../../src/config";
import { clearATSCache, deleteKvPrefix, saveAppliedJobsForTenant, saveJobNotes } from "../../src/storage";

const resolveTenantContextMock = vi.mocked(resolveRequestTenantContext);
const loadRuntimeConfigMock = vi.mocked(loadRuntimeConfig);
const clearATSCacheMock = vi.mocked(clearATSCache);
const deleteKvPrefixMock = vi.mocked(deleteKvPrefix);
const saveAppliedJobsForTenantMock = vi.mocked(saveAppliedJobsForTenant);
const saveJobNotesMock = vi.mocked(saveJobNotes);

function makeKvNamespace() {
  return {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cursor: "" })),
  } as unknown as KVNamespace;
}

const jobStateKv = makeKvNamespace();
const atsCacheKv = makeKvNamespace();

const mockEnv = {
  JOB_STATE: jobStateKv,
  ATS_CACHE: atsCacheKv,
  CONFIG_STORE: makeKvNamespace(),
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
} as unknown as Env;

const runtimeConfig: RuntimeConfig = {
  companies: [
    { company: "Acme", enabled: true, source: "greenhouse" },
  ],
  jobtitles: { includeKeywords: ["engineer"], excludeKeywords: [] },
  updatedAt: "2026-04-27T00:00:00.000Z",
};

async function request(pathname: string): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }), mockEnv);
}

describe("api sanity danger zone routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantContextMock.mockResolvedValue(userActor);
    loadRuntimeConfigMock.mockResolvedValue(runtimeConfig);
  });

  it("clears the available-jobs cache for an authenticated user", async () => {
    const response = await request("/api/cache/clear");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      cleared: "available jobs cache",
    });
    expect(clearATSCacheMock).toHaveBeenCalledWith(mockEnv, runtimeConfig.companies);
    expect(saveJobNotesMock).toHaveBeenCalledWith(mockEnv, {}, userActor.tenantId);
  });

  it("clears inventory and pipeline state for an authenticated user", async () => {
    const response = await request("/api/data/clear");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      cleared: "inventory and pipeline state",
    });
    expect(deleteKvPrefixMock).toHaveBeenCalledTimes(3);
    expect(saveAppliedJobsForTenantMock).toHaveBeenCalledWith(mockEnv, {}, userActor.tenantId);
    expect(saveJobNotesMock).toHaveBeenCalledWith(mockEnv, {}, userActor.tenantId);
  });

  it("does not invoke destructive helpers when tenant-context resolution fails before cache clear", async () => {
    resolveTenantContextMock.mockRejectedValueOnce(new Error("Missing bearer token"));

    const response = await request("/api/cache/clear");

    expect(response.status).toBe(500);
    expect(clearATSCacheMock).not.toHaveBeenCalled();
    expect(deleteKvPrefixMock).not.toHaveBeenCalled();
    expect(saveAppliedJobsForTenantMock).not.toHaveBeenCalled();
    expect(saveJobNotesMock).not.toHaveBeenCalled();
  });

  it("does not invoke destructive helpers when tenant-context resolution fails before data clear", async () => {
    resolveTenantContextMock.mockRejectedValueOnce(new Error("Missing bearer token"));

    const response = await request("/api/data/clear");

    expect(response.status).toBe(500);
    expect(clearATSCacheMock).not.toHaveBeenCalled();
    expect(deleteKvPrefixMock).not.toHaveBeenCalled();
    expect(saveAppliedJobsForTenantMock).not.toHaveBeenCalled();
    expect(saveJobNotesMock).not.toHaveBeenCalled();
  });
});
