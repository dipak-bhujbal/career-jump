import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest } from "../../src/routes";
import { adminActor, userActor } from "../_helpers/actors";
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

async function request(pathname: string, init: RequestInit): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`, init), mockEnv);
}

describe("api smoke invalid body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantContextMock.mockResolvedValue(userActor);
  });

  it("rejects support tickets with missing required fields", async () => {
    const response = await request("/api/support/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "", body: "" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "subject and body are required",
    });
  });

  it("rejects feature flag updates with a blank trimmed flag name", async () => {
    resolveTenantContextMock.mockResolvedValue(adminActor);

    const response = await request("/api/admin/feature-flags", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ flagName: "   ", enabled: true }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "flagName is required",
    });
  });

  it("rejects admin user status updates with an invalid enum value", async () => {
    resolveTenantContextMock.mockResolvedValue(adminActor);

    const response = await request("/api/admin/users/u-123/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountStatus: "paused" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "accountStatus must be active or suspended",
    });
  });

  it("rejects toggle-all when paused is the wrong type", async () => {
    const response = await request("/api/companies/toggle-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: "true" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "paused boolean is required",
    });
  });

  it("treats malformed JSON bodies as validation failures instead of server errors", async () => {
    const response = await request("/api/support/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json-at-all",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      // Hardened body parsing should fail fast on malformed JSON instead of
      // falling through to field-level validation.
      error: "Invalid JSON body",
    });
  });
});
