import { beforeEach, describe, expect, it, vi } from "vitest";
import { userActor } from "../_helpers/actors";
import type { Env } from "../../src/types";

const {
  loadRegistryCacheMock,
  getByCompanyMock,
} = vi.hoisted(() => ({
  loadRegistryCacheMock: vi.fn(),
  getByCompanyMock: vi.fn(),
}));

vi.mock("../../src/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/tenant")>("../../src/lib/tenant");
  return {
    ...actual,
    resolveRequestTenantContext: vi.fn(),
  };
});

vi.mock("../../src/storage/registry-cache", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage/registry-cache")>("../../src/storage/registry-cache");
  return {
    ...actual,
    loadRegistryCache: loadRegistryCacheMock,
    getByCompany: getByCompanyMock,
  };
});

import { resolveRequestTenantContext } from "../../src/lib/tenant";
import { handleRequest } from "../../src/routes";

const resolveTenantContextMock = vi.mocked(resolveRequestTenantContext);

const mockEnv = {
  JOB_STATE: {} as KVNamespace,
  ATS_CACHE: {} as KVNamespace,
  CONFIG_STORE: {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
  } as unknown as KVNamespace,
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
} as unknown as Env;

async function post(body: unknown): Promise<Response> {
  return handleRequest(new Request("http://localhost/api/config/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), mockEnv);
}

describe("api smoke config save duplicate registry guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantContextMock.mockResolvedValue(userActor);
    loadRegistryCacheMock.mockResolvedValue({ all: [], meta: { total: 0, version: "test" }, loadedAt: Date.now() });
  });

  it("rejects custom companies that already exist in the shared registry", async () => {
    getByCompanyMock.mockReturnValue({
      company: "Airtable",
      ats: "Greenhouse",
      board_url: "https://job-boards.greenhouse.io/airtable",
      tier: "TIER1_VERIFIED",
    });

    const response = await post({
      companies: [
        {
          company: "Airtable",
          enabled: true,
          source: "greenhouse",
          boardUrl: "https://job-boards.greenhouse.io/airtable",
          isRegistry: false,
        },
      ],
      jobtitles: { includeKeywords: [], excludeKeywords: [] },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Company 'Airtable' already exists in the registry. Use Add company to pick it from the catalog instead of creating a custom entry.",
    });
  });
});
