import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/types";

// Stateful in-memory DynamoDB — persists across all three steps in the flow.
const dynamo = new Map<string, Record<string, unknown>>();

const cognitoSendMock = vi.fn();
const sesSendMock = vi.fn();
const putRowMock = vi.fn();
const getRowMock = vi.fn();
const deleteRowMock = vi.fn();

vi.mock("@aws-sdk/client-cognito-identity-provider", () => {
  class CognitoIdentityProviderClient {
    send = cognitoSendMock;
    constructor(_input: Record<string, unknown>) {}
  }
  class AdminGetUserCommand {
    input: Record<string, unknown>;
    __type = "AdminGetUserCommand";
    constructor(input: Record<string, unknown>) { this.input = input; }
  }
  class AdminSetUserPasswordCommand {
    input: Record<string, unknown>;
    __type = "AdminSetUserPasswordCommand";
    constructor(input: Record<string, unknown>) { this.input = input; }
  }
  return { CognitoIdentityProviderClient, AdminGetUserCommand, AdminSetUserPasswordCommand };
});

vi.mock("@aws-sdk/client-sesv2", () => {
  class SESv2Client {
    send = sesSendMock;
    constructor(_input: Record<string, unknown>) {}
  }
  class SendEmailCommand {
    input: Record<string, unknown>;
    __type = "SendEmailCommand";
    constructor(input: Record<string, unknown>) { this.input = input; }
  }
  return { SESv2Client, SendEmailCommand };
});

vi.mock("../../src/aws/dynamo", () => ({
  stateTableName: vi.fn(() => "state-table"),
  eventsTableName: vi.fn(() => "events-table"),
  registryTableName: vi.fn(() => "registry-table"),
  getRow: getRowMock,
  putRow: putRowMock,
  deleteRow: deleteRowMock,
  queryRows: vi.fn(async () => []),
}));

const mockEnv = {
  JOB_STATE: {} as KVNamespace,
  ATS_CACHE: {} as KVNamespace,
  CONFIG_STORE: {} as KVNamespace,
  DB: {} as D1Database,
  ASSETS: { fetch: vi.fn(async () => new Response("", { status: 200 })) },
  SES_FROM_EMAIL: "noreply@test.com",
} as unknown as Env;

async function post(
  handleRequest: typeof import("../../src/routes").handleRequest,
  pathname: string,
  body: unknown
): Promise<Response> {
  return handleRequest(
    new Request(`http://localhost${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    mockEnv
  );
}

describe("e2e password reset flow", () => {
  const savedEnv = { ...process.env };
  let handleRequest: typeof import("../../src/routes").handleRequest;

  beforeAll(async () => {
    process.env.COGNITO_USER_POOL_ID = "pool-user";
    process.env.ADMIN_COGNITO_USER_POOL_ID = "pool-admin";
    vi.resetModules();
    ({ handleRequest } = await import("../../src/routes"));
  });

  afterAll(() => {
    process.env = savedEnv;
  });

  it("executes the complete reset state machine: request → confirm → reject reuse", async () => {
    // ── Setup stateful DynamoDB mock ──────────────────────────────────────────
    putRowMock.mockImplementation(async (_table: string, row: Record<string, unknown>) => {
      dynamo.set(`${row.pk}#${row.sk}`, row);
    });
    getRowMock.mockImplementation(async (_table: string, keys: Record<string, unknown>) => {
      return dynamo.get(`${keys.pk}#${keys.sk}`) ?? null;
    });
    deleteRowMock.mockImplementation(async (_table: string, keys: Record<string, unknown>) => {
      dynamo.delete(`${keys.pk}#${keys.sk}`);
    });

    // Cognito: user exists in the user pool
    cognitoSendMock.mockImplementation(async (command: { __type?: string; input?: Record<string, unknown> }) => {
      if (command.__type === "AdminGetUserCommand") return {};
      if (command.__type === "AdminSetUserPasswordCommand") return {};
      throw new Error(`Unexpected Cognito command: ${command.__type}`);
    });
    sesSendMock.mockResolvedValue({});

    // ── Step 1: request reset ─────────────────────────────────────────────────
    const requestRes = await post(handleRequest, "/api/auth/reset/request", {
      email: "alice@example.com",
    });

    expect(requestRes.status).toBe(200);
    await expect(requestRes.json()).resolves.toMatchObject({ ok: true });

    // Token was stored in DynamoDB
    expect(putRowMock).toHaveBeenCalledWith(
      "state-table",
      expect.objectContaining({
        pk: expect.stringContaining("alice@example.com"),
        sk: "CODE",
        email: "alice@example.com",
        scope: "user",
      })
    );

    // Email was sent to alice
    expect(sesSendMock).toHaveBeenCalledTimes(1);
    const emailInput = sesSendMock.mock.calls[0]?.[0]?.input as Record<string, unknown>;
    expect((emailInput.Destination as { ToAddresses: string[] }).ToAddresses).toContain("alice@example.com");

    // Extract the reset code from the email body
    const emailBody = (emailInput.Content as { Simple: { Body: { Text: { Data: string } } } })
      .Simple.Body.Text.Data;
    const codeMatch = emailBody.match(/code is: (\d{6})/);
    expect(codeMatch).not.toBeNull();
    const code = codeMatch![1];

    // ── Step 2: confirm with correct code ─────────────────────────────────────
    const confirmRes = await post(handleRequest, "/api/auth/reset/confirm", {
      email: "alice@example.com",
      code,
      newPassword: "NewSecurePass123!",
    });

    expect(confirmRes.status).toBe(200);
    await expect(confirmRes.json()).resolves.toMatchObject({ ok: true });

    // Password was updated in Cognito with the correct new password
    const setPasswordCall = cognitoSendMock.mock.calls.find(
      ([cmd]: [{ __type?: string; input?: Record<string, unknown> }]) =>
        cmd.__type === "AdminSetUserPasswordCommand"
    );
    expect(setPasswordCall).toBeDefined();
    expect(setPasswordCall![0].input).toMatchObject({
      Username: "alice@example.com",
      Password: "NewSecurePass123!",
      Permanent: true,
    });

    // Token was cleared from DynamoDB after successful confirm
    expect(deleteRowMock).toHaveBeenCalledWith(
      "state-table",
      expect.objectContaining({
        pk: expect.stringContaining("alice@example.com"),
        sk: "CODE",
      })
    );
    const tokenStillPresent = dynamo.has(
      `runtime:password-reset:alice@example.com#CODE`
    );
    expect(tokenStillPresent).toBe(false);

    // No additional email was sent during confirm
    expect(sesSendMock).toHaveBeenCalledTimes(1);

    // ── Step 3: confirm again with the same code — must be rejected ───────────
    const reuseRes = await post(handleRequest, "/api/auth/reset/confirm", {
      email: "alice@example.com",
      code,
      newPassword: "AnotherPass456!",
    });

    expect(reuseRes.status).toBe(400);
    const reuseBody = await reuseRes.json() as { ok: boolean; error: string };
    expect(reuseBody.ok).toBe(false);
    // Token is gone so verify returns "invalid" → route returns 400 with the invalid-code message
    expect(reuseBody.error).toBeTruthy();

    // Cognito password update was NOT called a second time
    const setPasswordCalls = cognitoSendMock.mock.calls.filter(
      ([cmd]: [{ __type?: string }]) => cmd.__type === "AdminSetUserPasswordCommand"
    );
    expect(setPasswordCalls).toHaveLength(1);
  });
});
