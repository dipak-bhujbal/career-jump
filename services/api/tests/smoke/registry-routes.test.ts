import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/types";

const {
  loadRegistryCacheMock,
  listAllMock,
  listByAtsMock,
  getByCompanyMock,
} = vi.hoisted(() => ({
  loadRegistryCacheMock: vi.fn(),
  listAllMock: vi.fn(),
  listByAtsMock: vi.fn(),
  getByCompanyMock: vi.fn(),
}));

vi.mock("../../src/storage/registry-cache", () => ({
  loadRegistryCache: loadRegistryCacheMock,
  listAll: listAllMock,
  listByAts: listByAtsMock,
  getByCompany: getByCompanyMock,
}));

import { handleRequest } from "../../src/routes";

const mockEnv = {
  JOB_STATE: {} as KVNamespace,
  ATS_CACHE: {} as KVNamespace,
  CONFIG_STORE: {} as KVNamespace,
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
  APP_NAME: "Career Jump Test",
} as unknown as Env;

function request(pathname: string): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`), mockEnv);
}

describe("api smoke registry routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Keep the registry fixtures tiny but realistic so the picker contract is
    // validated without depending on the full Dynamo-backed cache.
    const rows = [
      {
        company: "Walmart",
        ats: "Workday",
        tier: "TIER1_VERIFIED",
        board_url: "https://walmart.wd5.myworkdayjobs.com/en-US/WalmartExternal",
      },
      {
        company: "Pfizer",
        ats: "Workday",
        tier: "TIER1_VERIFIED",
        board_url: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareersSearch",
      },
    ];

    loadRegistryCacheMock.mockResolvedValue({
      meta: { total: 1230, version: "test-v1" },
      loadedAt: "2026-04-28T10:00:00.000Z",
      all: rows,
    });
    listAllMock.mockReturnValue(rows);
    listByAtsMock.mockImplementation((ats: string) => rows.filter((row) => row.ats === ats));
    getByCompanyMock.mockImplementation((company: string) => rows.find((row) => row.company === company) ?? null);
  });

  it("returns registry company entries for the add-company picker", async () => {
    const response = await request("/api/registry/companies?limit=50");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      total: 2,
      entries: [
        expect.objectContaining({ company: "Walmart" }),
        expect.objectContaining({ company: "Pfizer" }),
      ],
    });
    expect(loadRegistryCacheMock).toHaveBeenCalledTimes(1);
    expect(listAllMock).toHaveBeenCalledTimes(1);
  });

  it("reports the registry counts used by the add-company dialog badge", async () => {
    const response = await request("/api/registry/meta");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      meta: expect.objectContaining({ total: 1230 }),
      counts: expect.objectContaining({
        total: 2,
        tier1: 2,
      }),
    });
  });
});
