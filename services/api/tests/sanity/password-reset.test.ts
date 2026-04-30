import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/types";

const cognitoSendMock = vi.fn();
const sesSendMock = vi.fn();
const storePasswordResetCodeMock = vi.fn();
const consumePasswordResetCodeMock = vi.fn();
const clearPasswordResetCodeMock = vi.fn();
const recordPasswordResetConfirmAttemptMock = vi.fn();

vi.mock("@aws-sdk/client-cognito-identity-provider", () => {
  class CognitoIdentityProviderClient {
    send = cognitoSendMock;
    constructor(_input: Record<string, unknown>) {}
  }

  class AdminGetUserCommand {
    input: Record<string, unknown>;
    __type = "AdminGetUserCommand";
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  class AdminSetUserPasswordCommand {
    input: Record<string, unknown>;
    __type = "AdminSetUserPasswordCommand";
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return {
    CognitoIdentityProviderClient,
    AdminGetUserCommand,
    AdminSetUserPasswordCommand,
  };
});

vi.mock("@aws-sdk/client-sesv2", () => {
  class SESv2Client {
    send = sesSendMock;
    constructor(_input: Record<string, unknown>) {}
  }

  class SendEmailCommand {
    input: Record<string, unknown>;
    __type = "SendEmailCommand";
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return {
    SESv2Client,
    SendEmailCommand,
  };
});

vi.mock("../../src/storage/password-reset", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage/password-reset")>("../../src/storage/password-reset");
  return {
    ...actual,
    createResetCode: vi.fn(() => "123456"),
    storePasswordResetCode: storePasswordResetCodeMock,
    consumePasswordResetCode: consumePasswordResetCodeMock,
    clearPasswordResetCode: clearPasswordResetCodeMock,
    recordPasswordResetConfirmAttempt: recordPasswordResetConfirmAttemptMock,
  };
});

const mockEnv = {
  JOB_STATE: {} as KVNamespace,
  ATS_CACHE: {} as KVNamespace,
  CONFIG_STORE: {} as KVNamespace,
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
  SES_FROM_EMAIL: "noreply@test.com",
} as unknown as Env;

async function request(handleRequest: typeof import("../../src/routes").handleRequest, pathname: string, body: unknown): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), mockEnv);
}

describe("api sanity password reset", () => {
  const originalEnv = { ...process.env };
  let handleRequest: typeof import("../../src/routes").handleRequest;

  beforeAll(async () => {
    process.env.COGNITO_USER_POOL_ID = "pool-user";
    process.env.ADMIN_COGNITO_USER_POOL_ID = "pool-admin";
    vi.resetModules();
    ({ handleRequest } = await import("../../src/routes"));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    cognitoSendMock.mockImplementation(async (command: { __type?: string; input?: Record<string, unknown> }) => {
      if (command.__type === "AdminGetUserCommand") {
        const username = String(command.input?.Username ?? "");
        if (username === "unknown@test.com") {
          throw new Error("UserNotFoundException");
        }
        return {};
      }
      if (command.__type === "AdminSetUserPasswordCommand") {
        return {};
      }
      throw new Error(`Unexpected Cognito command: ${command.__type}`);
    });
    sesSendMock.mockResolvedValue({});
    storePasswordResetCodeMock.mockResolvedValue(undefined);
    consumePasswordResetCodeMock.mockResolvedValue("ok");
    clearPasswordResetCodeMock.mockResolvedValue(undefined);
    recordPasswordResetConfirmAttemptMock.mockResolvedValue(true);
  });

  it("stores a reset token and triggers email delivery for a known email", async () => {
    const response = await request(handleRequest, "/api/auth/reset/request", { email: "known@test.com" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(storePasswordResetCodeMock).toHaveBeenCalledWith("known@test.com", "user", "123456");
    expect(sesSendMock).toHaveBeenCalledTimes(1);
    expect(sesSendMock.mock.calls[0]?.[0]?.input).toMatchObject({
      Destination: { ToAddresses: ["known@test.com"] },
    });
  });

  it("returns the same success shape for an unknown email without storing a token or sending email", async () => {
    const response = await request(handleRequest, "/api/auth/reset/request", { email: "unknown@test.com" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(storePasswordResetCodeMock).not.toHaveBeenCalled();
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("rejects reset-request submissions with a missing email field", async () => {
    const response = await request(handleRequest, "/api/auth/reset/request", { email: "   " });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Email is required",
    });
    expect(storePasswordResetCodeMock).not.toHaveBeenCalled();
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("updates the password and clears the reset token on a valid confirm", async () => {
    const response = await request(handleRequest, "/api/auth/reset/confirm", {
      email: "user@test.com",
      code: "123456",
      newPassword: "StrongerPassword123!",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(consumePasswordResetCodeMock).toHaveBeenCalledWith("user@test.com", "123456", "user");
    expect(cognitoSendMock.mock.calls.some(([command]) => command.__type === "AdminSetUserPasswordCommand")).toBe(true);
    expect(clearPasswordResetCodeMock).toHaveBeenCalledWith("user@test.com");
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("rejects reset confirmations with missing required fields", async () => {
    const response = await request(handleRequest, "/api/auth/reset/confirm", {
      email: "user@test.com",
      code: "",
      newPassword: "",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Email, code, and new password are required",
    });
    expect(consumePasswordResetCodeMock).not.toHaveBeenCalled();
    expect(clearPasswordResetCodeMock).not.toHaveBeenCalled();
  });

  it("rate-limits reset confirmations when too many attempts hit the same bucket", async () => {
    recordPasswordResetConfirmAttemptMock.mockResolvedValueOnce(false);

    const response = await request(handleRequest, "/api/auth/reset/confirm", {
      email: "user@test.com",
      code: "123456",
      newPassword: "StrongerPassword123!",
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Too many reset attempts. Please wait a minute and try again.",
    });
    expect(consumePasswordResetCodeMock).not.toHaveBeenCalled();
  });

  it("does not update the password when the reset code is expired", async () => {
    consumePasswordResetCodeMock.mockResolvedValueOnce("expired");

    const response = await request(handleRequest, "/api/auth/reset/confirm", {
      email: "user@test.com",
      code: "123456",
      newPassword: "StrongerPassword123!",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Reset code expired. Request a new code.",
    });
    expect(cognitoSendMock.mock.calls.some(([command]) => command.__type === "AdminSetUserPasswordCommand")).toBe(false);
    expect(clearPasswordResetCodeMock).not.toHaveBeenCalled();
  });

  it("does not update the password when the reset code is invalid or already used", async () => {
    consumePasswordResetCodeMock.mockResolvedValueOnce("invalid");

    const response = await request(handleRequest, "/api/auth/reset/confirm", {
      email: "user@test.com",
      code: "111111",
      newPassword: "StrongerPassword123!",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Invalid reset code",
    });
    expect(cognitoSendMock.mock.calls.some(([command]) => command.__type === "AdminSetUserPasswordCommand")).toBe(false);
    expect(clearPasswordResetCodeMock).not.toHaveBeenCalled();
  });

  it("locks the reset flow after too many invalid attempts", async () => {
    consumePasswordResetCodeMock.mockResolvedValueOnce("locked");

    const response = await request(handleRequest, "/api/auth/reset/confirm", {
      email: "user@test.com",
      code: "999999",
      newPassword: "StrongerPassword123!",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "Too many invalid reset attempts. Request a new code.",
    });
    expect(cognitoSendMock.mock.calls.some(([command]) => command.__type === "AdminSetUserPasswordCommand")).toBe(false);
  });
});
