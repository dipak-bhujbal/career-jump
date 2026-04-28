import { beforeEach, describe, expect, it, vi } from "vitest";

// Stateful stores — separate buckets per DynamoDB table type.
let cacheStore: Map<string, Record<string, unknown>>;
let eventsByType: Map<string, Record<string, unknown>[]>;

const putRowMock = vi.fn();
const getRowMock = vi.fn();
const queryRowsMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  eventsTableName: vi.fn(() => "events-table"),
  registryTableName: vi.fn(() => "registry-table"),
  getRow: getRowMock,
  putRow: putRowMock,
  queryRows: queryRowsMock,
}));

describe("e2e admin analytics flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T10:00:00.000Z"));

    cacheStore = new Map();
    eventsByType = new Map();

    // putRow: route to the right bucket based on table name argument
    putRowMock.mockImplementation(async (table: string, row: Record<string, unknown>) => {
      if (table === "registry-table") {
        cacheStore.set(`${row.pk}#${row.sk}`, row);
      } else if (table === "events-table" && typeof row.gsi1pk === "string") {
        const existing = eventsByType.get(row.gsi1pk) ?? [];
        existing.push(row);
        eventsByType.set(row.gsi1pk, existing);
      }
    });

    getRowMock.mockImplementation(async (_table: string, keys: Record<string, unknown>) => {
      return cacheStore.get(`${keys.pk}#${keys.sk}`) ?? null;
    });

    queryRowsMock.mockImplementation(
      async (
        _table: string,
        _condition: string,
        params: Record<string, unknown>
      ) => {
        const eventType = String(params[":eventType"] ?? "");
        return eventsByType.get(eventType) ?? [];
      }
    );
  });

  it("reflects fired events in growth analytics, then returns cached data on a second call", async () => {
    const { recordEvent } = await import("../../src/storage/accounts");
    const { getGrowthAnalytics } = await import("../../src/storage/admin-analytics");

    const actorA = {
      userId: "user-a",
      tenantId: "user-a",
      email: "a@example.com",
      displayName: "A",
      scope: "user" as const,
      isAdmin: false,
    };
    const actorB = {
      userId: "user-b",
      tenantId: "user-b",
      email: "b@example.com",
      displayName: "B",
      scope: "user" as const,
      isAdmin: false,
    };

    // Fire two USER_CREATED events (two signups)
    await recordEvent(actorA, "USER_CREATED", {});
    await recordEvent(actorB, "USER_CREATED", {});

    // Fire one FIRST_SCAN_RUN (one activation, 2 hours after signup)
    await recordEvent(actorA, "FIRST_SCAN_RUN", { hoursAfterSignup: 2 });

    // Fire one RUN_COMPLETED (actorA has run, actorB has not — actorB is a churn signal
    // only if signup was >14 days ago; since we're using fake now, both are recent so 0 churn)
    await recordEvent(actorA, "RUN_COMPLETED", {});

    // First call: cache miss → events are queried → analytics computed → cache written
    const result1 = await getGrowthAnalytics();

    expect(result1.data.signupsPerDay).toHaveLength(1);
    expect(result1.data.signupsPerDay[0]).toMatchObject({ date: "2026-04-28", count: 2 });
    // 1 of 2 users activated = 0.5
    expect(result1.data.activationRate).toBe(0.5);
    // median hours to first scan is 2
    expect(result1.data.medianHoursToFirstScan).toBe(2);
    // both users signed up today (<14 days ago), so no churn signal yet
    expect(result1.data.churnSignalCount).toBe(0);

    // Cache row was written
    expect(putRowMock).toHaveBeenCalledWith(
      "registry-table",
      expect.objectContaining({ pk: "ADMIN#STATS", sk: "cache#growth" })
    );
    const queryCallCount = queryRowsMock.mock.calls.length;
    expect(queryCallCount).toBeGreaterThan(0);

    // Second call: cache is warm → same data returned, no re-query
    const result2 = await getGrowthAnalytics();

    expect(result2.data).toEqual(result1.data);
    // queryRows was NOT called again
    expect(queryRowsMock).toHaveBeenCalledTimes(queryCallCount);
    // putRow was NOT called again (no new cache write)
    expect(putRowMock).toHaveBeenCalledTimes(
      // events writes + one cache write from first call
      eventsByType.size > 0
        ? putRowMock.mock.calls.filter(([t]: [string]) => t === "events-table").length + 1
        : 1
    );
  });

  it("recomputes analytics and refreshes cache when TTL has expired", async () => {
    const { recordEvent } = await import("../../src/storage/accounts");
    const { getGrowthAnalytics } = await import("../../src/storage/admin-analytics");

    const actor = {
      userId: "user-c",
      tenantId: "user-c",
      email: "c@example.com",
      displayName: "C",
      scope: "user" as const,
      isAdmin: false,
    };
    await recordEvent(actor, "USER_CREATED", {});

    // First call: computes and caches
    const result1 = await getGrowthAnalytics();
    expect(result1.data.signupsPerDay).toHaveLength(1);

    // Advance time past the 1-hour cache TTL
    vi.setSystemTime(new Date("2026-04-28T11:30:00.000Z"));

    // Add a second event in the "new" time window
    await recordEvent(actor, "RUN_COMPLETED", {});

    const queriesBeforeExpiry = queryRowsMock.mock.calls.length;

    // Second call after TTL: cache is stale → recomputes from events
    const result2 = await getGrowthAnalytics();

    expect(queryRowsMock.mock.calls.length).toBeGreaterThan(queriesBeforeExpiry);
    // New cache row was written with updated expiry
    const cacheWrites = putRowMock.mock.calls.filter(
      ([t]: [string]) => t === "registry-table"
    );
    expect(cacheWrites.length).toBe(2);
    const [, secondCacheRow] = cacheWrites[1] as [string, Record<string, unknown>];
    expect((secondCacheRow as { expiresAtEpoch: number }).expiresAtEpoch).toBeGreaterThan(
      (cacheWrites[0][1] as { expiresAtEpoch: number }).expiresAtEpoch
    );
    expect(result2.data).toBeDefined();
  });
});
