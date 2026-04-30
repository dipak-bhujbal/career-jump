import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminActor } from "../_helpers/actors";
import type { Env } from "../../src/types";

const {
  loadUserProfileMock,
  loadUserSettingsMock,
  loadBillingSubscriptionMock,
  listAdminTicketsMock,
  loadRuntimeConfigMock,
} = vi.hoisted(() => ({
  loadUserProfileMock: vi.fn(),
  loadUserSettingsMock: vi.fn(),
  loadBillingSubscriptionMock: vi.fn(),
  listAdminTicketsMock: vi.fn(),
  loadRuntimeConfigMock: vi.fn(),
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
    loadUserProfile: loadUserProfileMock,
    loadUserSettings: loadUserSettingsMock,
    loadBillingSubscription: loadBillingSubscriptionMock,
    listAdminTickets: listAdminTicketsMock,
  };
});

vi.mock("../../src/config", async () => {
  const actual = await vi.importActual<typeof import("../../src/config")>("../../src/config");
  return {
    ...actual,
    loadRuntimeConfig: loadRuntimeConfigMock,
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

async function request(pathname: string): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`), mockEnv);
}

describe("api smoke admin user runtime config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Admin-only route tests pin auth to the tenant-context seam so the
    // response contract can be validated without Cognito setup.
    resolveTenantContextMock.mockResolvedValue(adminActor);
    loadUserProfileMock.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
      email: "person@example.com",
      displayName: "Person Example",
      accountStatus: "active",
      plan: "free",
      joinedAt: "2026-04-30T00:00:00.000Z",
      lastLoginAt: "2026-04-30T00:00:00.000Z",
      cognitoSub: "user-1",
      scope: "user",
    });
    loadUserSettingsMock.mockResolvedValue({
      userId: "user-1",
      emailNotifications: true,
      weeklyDigest: true,
      trackedCompanies: [],
      updatedAt: "2026-04-30T00:00:00.000Z",
    });
    loadBillingSubscriptionMock.mockResolvedValue({
      userId: "user-1",
      plan: "power",
      status: "active",
      provider: "internal",
      updatedAt: "2026-04-30T00:00:00.000Z",
    });
    listAdminTicketsMock.mockResolvedValue([]);
    loadRuntimeConfigMock.mockResolvedValue({
      companies: [
        { company: "Adobe Inc", enabled: true, source: "workday" },
        { company: "Canva", enabled: true, source: "lever" },
      ],
      jobtitles: { includeKeywords: [], excludeKeywords: [] },
      updatedAt: "2026-04-30T00:00:00.000Z",
    });
  });

  it("reports tracked companies from runtime config instead of empty notification settings", async () => {
    const response = await request("/api/admin/users/user-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      settings: {
        trackedCompanies: ["Adobe Inc", "Canva"],
      },
    });
  });
});
