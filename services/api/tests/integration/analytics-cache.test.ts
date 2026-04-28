import { beforeEach, describe, expect, it, vi } from "vitest";

const getRowMock = vi.fn();
const putRowMock = vi.fn();
const queryRowsMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  eventsTableName: vi.fn(() => "events-table"),
  registryTableName: vi.fn(() => "registry-table"),
  getRow: getRowMock,
  putRow: putRowMock,
  queryRows: queryRowsMock,
}));

describe("integration analytics cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T21:00:00.000Z"));
  });

  it("computes and stores analytics on the first cache miss", async () => {
    getRowMock.mockResolvedValueOnce(null);
    queryRowsMock.mockResolvedValue([]);
    const { getGrowthAnalytics } = await import("../../src/storage/admin-analytics");

    const result = await getGrowthAnalytics();

    expect(result.data).toMatchObject({
      signupsPerDay: [],
      activationRate: 0,
      medianHoursToFirstScan: null,
      churnSignalCount: 0,
    });
    expect(queryRowsMock).toHaveBeenCalledTimes(3);
    expect(putRowMock).toHaveBeenCalledWith("registry-table", expect.objectContaining({
      pk: "ADMIN#STATS",
      sk: "cache#growth",
      expiresAtEpoch: Math.floor(Date.now() / 1000) + 3600,
    }));
  });

  it("returns the cached row within TTL without querying event data again", async () => {
    getRowMock.mockResolvedValueOnce({
      pk: "ADMIN#STATS",
      sk: "cache#growth",
      data: {
        signupsPerDay: [{ date: "2026-04-27", count: 5 }],
        activationRate: 0.5,
        medianHoursToFirstScan: 4,
        churnSignalCount: 1,
      },
      cachedAt: "2026-04-27T20:55:00.000Z",
      cacheExpiresAt: "2026-04-27T22:00:00.000Z",
      expiresAtEpoch: Math.floor(Date.now() / 1000) + 3600,
    });
    const { getGrowthAnalytics } = await import("../../src/storage/admin-analytics");

    const result = await getGrowthAnalytics();

    expect(result).toMatchObject({
      data: {
        signupsPerDay: [{ date: "2026-04-27", count: 5 }],
        activationRate: 0.5,
        medianHoursToFirstScan: 4,
        churnSignalCount: 1,
      },
    });
    expect(queryRowsMock).not.toHaveBeenCalled();
    expect(putRowMock).not.toHaveBeenCalled();
  });

  it("recomputes and rewrites the cache after TTL expiry", async () => {
    getRowMock.mockResolvedValueOnce({
      pk: "ADMIN#STATS",
      sk: "cache#growth",
      data: {
        signupsPerDay: [],
        activationRate: 0,
        medianHoursToFirstScan: null,
        churnSignalCount: 0,
      },
      cachedAt: "2026-04-27T18:00:00.000Z",
      cacheExpiresAt: "2026-04-27T20:00:00.000Z",
      expiresAtEpoch: Math.floor(Date.now() / 1000) - 10,
    });
    queryRowsMock.mockResolvedValue([
      { actor: "a1", createdAt: "2026-04-27T19:00:00.000Z", details: {} },
    ]);
    const { getGrowthAnalytics } = await import("../../src/storage/admin-analytics");

    const result = await getGrowthAnalytics();

    expect(queryRowsMock).toHaveBeenCalledTimes(3);
    expect(putRowMock).toHaveBeenCalledWith("registry-table", expect.objectContaining({
      pk: "ADMIN#STATS",
      sk: "cache#growth",
      expiresAtEpoch: Math.floor(Date.now() / 1000) + 3600,
    }));
    expect(result.cachedAt).toBeTruthy();
    expect(result.cacheExpiresAt).toBeTruthy();
  });
});
