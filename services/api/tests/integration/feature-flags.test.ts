import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRowsMock = vi.fn();

vi.mock("../../src/aws/dynamo", async () => {
  const actual = await vi.importActual<typeof import("../../src/aws/dynamo")>("../../src/aws/dynamo");
  return {
    ...actual,
    supportTableName: vi.fn(() => "support-table"),
    queryRows: queryRowsMock,
  };
});

describe("integration feature flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps enabled and disabled Workday layer flags correctly", async () => {
    queryRowsMock.mockResolvedValueOnce([
      { flagName: "workday_layer2_headless", enabled: true },
      { flagName: "workday_layer3_scraperapi", enabled: false },
    ]);
    const { loadSystemWorkdayLayerFlags } = await import("../../src/storage/accounts");

    await expect(loadSystemWorkdayLayerFlags()).resolves.toEqual({
      layer2: true,
      layer3: false,
    });
  });

  it("returns safe false defaults when the flags are missing", async () => {
    queryRowsMock.mockResolvedValueOnce([]);
    const { loadSystemWorkdayLayerFlags } = await import("../../src/storage/accounts");

    await expect(loadSystemWorkdayLayerFlags()).resolves.toEqual({
      layer2: false,
      layer3: false,
    });
  });

  it("returns safe false defaults when the DynamoDB read throws", async () => {
    queryRowsMock.mockRejectedValueOnce(new Error("dynamo unavailable"));
    const { loadSystemWorkdayLayerFlags } = await import("../../src/storage/accounts");

    await expect(loadSystemWorkdayLayerFlags()).resolves.toEqual({
      layer2: false,
      layer3: false,
    });
  });
});
