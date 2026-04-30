import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getRowMock,
  putRowMock,
  kvGetMock,
  kvPutMock,
} = vi.hoisted(() => ({
  getRowMock: vi.fn(),
  putRowMock: vi.fn(),
  kvGetMock: vi.fn(),
  kvPutMock: vi.fn(),
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

describe("runtime config table migration", () => {
  const originalEnv = process.env.AWS_CONFIG_TABLE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.AWS_CONFIG_TABLE = "career-jump-test-config";
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
});
