import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getRowMock,
  putRowMock,
  kvGetMock,
  kvPutMock,
  loadRegistryCacheMock,
  listAllMock,
  getByCompanyMock,
} = vi.hoisted(() => ({
  getRowMock: vi.fn(),
  putRowMock: vi.fn(),
  kvGetMock: vi.fn(),
  kvPutMock: vi.fn(),
  loadRegistryCacheMock: vi.fn(),
  listAllMock: vi.fn(() => []),
  getByCompanyMock: vi.fn(() => null),
}));

vi.mock("../../src/aws/dynamo", () => ({
  getRow: getRowMock,
  putRow: putRowMock,
}));

vi.mock("../../src/lib/bindings", () => ({
  configStoreKv: vi.fn(() => ({
    get: kvGetMock,
    put: kvPutMock,
  })),
}));

vi.mock("../../src/storage/registry-cache", () => ({
  loadRegistryCache: loadRegistryCacheMock,
  listAll: listAllMock,
  getByCompany: getByCompanyMock,
}));

describe("runtime config table migration", () => {
  const originalEnv = process.env.AWS_CONFIG_TABLE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.AWS_CONFIG_TABLE = "career-jump-test-config";
    loadRegistryCacheMock.mockResolvedValue(undefined);
    listAllMock.mockReturnValue([]);
    getByCompanyMock.mockReturnValue(null);
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.AWS_CONFIG_TABLE;
    else process.env.AWS_CONFIG_TABLE = originalEnv;
  });

  it("loads runtime config from the dedicated Dynamo config table when present", async () => {
    getRowMock.mockResolvedValue({
      pk: "TENANT#tenant-1",
      sk: "RUNTIME_CONFIG",
      tenantId: "tenant-1",
      config: {
        companies: [{ company: "Adobe Inc", enabled: true, source: "workday" }],
        jobtitles: { includeKeywords: ["manager"], excludeKeywords: [] },
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    });
    kvGetMock.mockResolvedValue(null);

    const { loadRuntimeConfig } = await import("../../src/config");
    const config = await loadRuntimeConfig({} as never, "tenant-1");

    expect(config.companies).toHaveLength(1);
    expect(config.jobtitles.includeKeywords).toEqual(["manager"]);
    // Loading from the dedicated table can still repair and persist the
    // normalized company shape, but it should stay on the dedicated table.
    expect(putRowMock).toHaveBeenCalledWith("career-jump-test-config", expect.objectContaining({
      pk: "TENANT#tenant-1",
      sk: "RUNTIME_CONFIG",
    }));
  });

  it("copies forward legacy KV-backed tenant config into the dedicated table", async () => {
    getRowMock.mockResolvedValue(null);
    kvGetMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        companies: [{ company: "Canva", enabled: true, source: "lever" }],
        jobtitles: { includeKeywords: [], excludeKeywords: ["intern"] },
        updatedAt: "2026-04-29T00:00:00.000Z",
      });

    const { loadRuntimeConfig } = await import("../../src/config");
    const config = await loadRuntimeConfig({} as never, "tenant-1");

    expect(config.companies).toHaveLength(1);
    expect(putRowMock).toHaveBeenCalledWith("career-jump-test-config", expect.objectContaining({
      pk: "TENANT#tenant-1",
      sk: "RUNTIME_CONFIG",
      tenantId: "tenant-1",
      config: expect.objectContaining({
        companies: expect.any(Array),
        jobtitles: { includeKeywords: [], excludeKeywords: ["intern"] },
      }),
    }));
    expect(kvPutMock).not.toHaveBeenCalled();
  });

  it("writes saved tenant config into the dedicated table", async () => {
    const { saveRuntimeConfig } = await import("../../src/config");

    await saveRuntimeConfig({} as never, {
      companies: [{ company: "Box", enabled: true, source: "greenhouse" }],
      jobtitles: { includeKeywords: ["manager"], excludeKeywords: [] },
      updatedAt: "2026-04-29T00:00:00.000Z",
    }, "tenant-99", "admin-1");

    expect(putRowMock).toHaveBeenCalledWith("career-jump-test-config", expect.objectContaining({
      pk: "TENANT#tenant-99",
      sk: "RUNTIME_CONFIG",
      tenantId: "tenant-99",
      updatedByUserId: "admin-1",
      config: expect.objectContaining({
        companies: expect.any(Array),
        jobtitles: { includeKeywords: ["manager"], excludeKeywords: [] },
      }),
    }));
    expect(kvPutMock).not.toHaveBeenCalled();
  });

  it("stores a compact admin config while still returning expanded registry companies", async () => {
    listAllMock.mockReturnValue([
      {
        company: "Adobe Inc",
        ats: "workday",
        board_url: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
        sample_url: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
        tier: "tier-1",
      },
    ]);
    getByCompanyMock.mockImplementation((company: string) => (
      company === "Adobe Inc"
        ? {
            company: "Adobe Inc",
            ats: "workday",
            board_url: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
            sample_url: "https://adobe.wd5.myworkdayjobs.com/external_experienced",
            tier: "tier-1",
          }
        : null
    ));

    const { saveRuntimeConfig, loadRuntimeConfig } = await import("../../src/config");

    await saveRuntimeConfig({} as never, {
      companies: [
        { company: "Adobe Inc", enabled: true, source: "workday", isRegistry: true, registryAts: "workday", registryTier: "tier-1" },
        { company: "Custom Co", enabled: true, source: "custom-jsonld", boardUrl: "https://example.com/jobs" },
      ],
      jobtitles: { includeKeywords: [], excludeKeywords: [] },
      updatedAt: "2026-04-29T00:00:00.000Z",
    }, "tenant-admin", "admin-1", { isAdmin: true });

    expect(putRowMock).toHaveBeenCalledWith("career-jump-test-config", expect.objectContaining({
      pk: "TENANT#tenant-admin",
      sk: "RUNTIME_CONFIG",
      config: expect.objectContaining({
        // Canonical registry companies are regenerated on admin reads, so the
        // stored config keeps only the truly custom rows.
        companies: [
          expect.objectContaining({ company: "Custom Co" }),
        ],
      }),
    }));

    getRowMock.mockResolvedValue({
      pk: "TENANT#tenant-admin",
      sk: "RUNTIME_CONFIG",
      tenantId: "tenant-admin",
      config: {
        companies: [{ company: "Custom Co", enabled: true, source: "custom-jsonld", boardUrl: "https://example.com/jobs" }],
        jobtitles: { includeKeywords: [], excludeKeywords: [] },
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    });

    const config = await loadRuntimeConfig({} as never, "tenant-admin", { isAdmin: true });
    expect(config.companies.map((company) => company.company)).toEqual(["Custom Co", "Adobe Inc"]);
  });
});
