import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminActor, userActor } from "../_helpers/actors";
import type { Env } from "../../src/types";

const {
  loadEmailWebhookConfigMock,
  saveEmailWebhookConfigMock,
} = vi.hoisted(() => ({
  loadEmailWebhookConfigMock: vi.fn(),
  saveEmailWebhookConfigMock: vi.fn(),
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
    loadEmailWebhookConfig: loadEmailWebhookConfigMock,
    saveEmailWebhookConfig: saveEmailWebhookConfigMock,
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
  APPS_SCRIPT_WEBHOOK_URL: "https://apps-script.example/exec",
  APPS_SCRIPT_SHARED_SECRET: "env-secret",
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
} as unknown as Env;

async function request(pathname: string, init?: RequestInit): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`, init), mockEnv);
}

describe("api smoke admin email webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Route smoke tests pin auth to the tenant-context seam so the global
    // webhook config contract can be validated without Cognito setup.
    resolveTenantContextMock.mockResolvedValue(adminActor);
  });

  it("returns the stored or environment-backed admin webhook config", async () => {
    loadEmailWebhookConfigMock.mockResolvedValue({
      webhookUrl: "https://stored.example/webhook",
      sharedSecret: "stored-secret",
    });

    const response = await request("/api/admin/email-webhook");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      webhookUrl: "https://stored.example/webhook",
      sharedSecretConfigured: true,
    });
  });

  it("lets admins update the shared webhook config", async () => {
    const response = await request("/api/admin/email-webhook", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        webhookUrl: "https://new.example/webhook",
        sharedSecret: "new-secret",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(saveEmailWebhookConfigMock).toHaveBeenCalledWith(mockEnv, {
      webhookUrl: "https://new.example/webhook",
      sharedSecret: "new-secret",
    });
  });

  it("rejects non-admin access", async () => {
    resolveTenantContextMock.mockResolvedValue(userActor);

    const response = await request("/api/admin/email-webhook");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Admin access required",
    });
  });
});
