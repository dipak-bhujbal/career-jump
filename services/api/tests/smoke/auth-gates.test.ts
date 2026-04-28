import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../../src/routes";
import { userActor } from "../_helpers/actors";
import type { Env } from "../../src/types";

vi.mock("../../src/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/tenant")>("../../src/lib/tenant");
  return {
    ...actual,
    resolveRequestTenantContext: vi.fn(),
  };
});

import { resolveRequestTenantContext } from "../../src/lib/tenant";

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

describe("api smoke auth gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Route smoke tests control auth at the tenant-context seam so they can
    // assert access policy without involving real Cognito or storage.
    resolveTenantContextMock.mockResolvedValue(userActor);
  });

  it("rejects non-admin access to the admin summary route", async () => {
    const response = await request("/api/admin/summary");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Admin access required",
    });
  });

  it("rejects non-admin access to admin analytics routes", async () => {
    const response = await request("/api/admin/analytics/growth");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Admin access required",
    });
  });

  it("rejects non-admin access to admin mutation routes", async () => {
    const response = await request("/api/admin/feature-flags", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flagName: "demo", enabled: true }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Admin access required",
    });
  });
});
