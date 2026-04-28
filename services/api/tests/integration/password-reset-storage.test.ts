import { beforeEach, describe, expect, it, vi } from "vitest";

const getRowMock = vi.fn();
const putRowMock = vi.fn();
const deleteRowMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  stateTableName: vi.fn(() => "state-table"),
  getRow: getRowMock,
  putRow: putRowMock,
  deleteRow: deleteRowMock,
}));

describe("integration password reset storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("round-trips store -> verify ok -> clear -> verify invalid", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T21:00:00.000Z"));
    const {
      storePasswordResetCode,
      verifyPasswordResetCode,
      clearPasswordResetCode,
    } = await import("../../src/storage/password-reset");

    await storePasswordResetCode("user@test.com", "user", "123456");
    const storedRow = putRowMock.mock.calls[0]?.[1];
    expect(storedRow).toMatchObject({
      pk: expect.stringContaining("user@test.com"),
      sk: "CODE",
      email: "user@test.com",
      scope: "user",
      attempts: 0,
    });

    getRowMock.mockResolvedValueOnce(storedRow);
    await expect(verifyPasswordResetCode("user@test.com", "123456", "user")).resolves.toBe("ok");

    await clearPasswordResetCode("user@test.com");
    expect(deleteRowMock).toHaveBeenCalledWith("state-table", expect.objectContaining({
      sk: "CODE",
    }));

    getRowMock.mockResolvedValueOnce(null);
    await expect(verifyPasswordResetCode("user@test.com", "123456", "user")).resolves.toBe("invalid");
  });

  it("returns expired for codes whose expiry epoch is in the past", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T21:00:00.000Z"));
    const { verifyPasswordResetCode } = await import("../../src/storage/password-reset");

    getRowMock.mockResolvedValueOnce({
      pk: "PASSWORD-RESET#user@test.com",
      sk: "CODE",
      email: "user@test.com",
      scope: "user",
      codeHash: "irrelevant",
      expiresAt: "2026-04-27T20:00:00.000Z",
      expiresAtEpoch: Math.floor(Date.now() / 1000) - 60,
      attempts: 0,
      createdAt: "2026-04-27T19:00:00.000Z",
    });

    await expect(verifyPasswordResetCode("user@test.com", "123456", "user")).resolves.toBe("expired");
    expect(deleteRowMock).toHaveBeenCalledTimes(1);
  });

  it("returns invalid for the wrong code and increments attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-27T21:00:00.000Z"));
    const {
      storePasswordResetCode,
      verifyPasswordResetCode,
    } = await import("../../src/storage/password-reset");

    await storePasswordResetCode("user@test.com", "user", "123456");
    const storedRow = putRowMock.mock.calls[0]?.[1];
    getRowMock.mockResolvedValueOnce(storedRow);

    await expect(verifyPasswordResetCode("user@test.com", "654321", "user")).resolves.toBe("invalid");
    expect(putRowMock).toHaveBeenLastCalledWith("state-table", expect.objectContaining({
      attempts: 1,
      email: "user@test.com",
      scope: "user",
    }));
  });
});
