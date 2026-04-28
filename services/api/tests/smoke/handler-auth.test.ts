import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LambdaFunctionURLEvent } from "aws-lambda";

const verifyTokenMock = vi.fn();

vi.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: vi.fn(() => ({
      verify: verifyTokenMock,
    })),
  },
}));

function makeEvent(path: string, method = "GET", headers: Record<string, string> = {}): LambdaFunctionURLEvent {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      host: "localhost",
      "x-forwarded-proto": "https",
      ...headers,
    },
    requestContext: {
      accountId: "test-account",
      apiId: "test-api",
      domainName: "localhost",
      domainPrefix: "localhost",
      http: {
        method,
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req-1",
      routeKey: "$default",
      stage: "$default",
      time: "27/Apr/2026:21:00:00 +0000",
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  } as LambdaFunctionURLEvent;
}

describe("api smoke handler auth", () => {
  const originalEnv = { ...process.env };
  let handler: typeof import("../../src/aws/api").handler;

  beforeAll(async () => {
    process.env.APP_ENV = "dev";
    process.env.APP_NAME = "Career Jump Test";
    process.env.COGNITO_USER_POOL_ID = "pool-user";
    process.env.COGNITO_CLIENT_ID = "client-user";
    process.env.ADMIN_COGNITO_USER_POOL_ID = "pool-admin";
    process.env.ADMIN_COGNITO_CLIENT_ID = "client-admin";

    vi.resetModules();
    ({ handler } = await import("../../src/aws/api"));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("allows the public health path to pass through without auth", async () => {
    const response = await handler(makeEvent("/health"));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: true,
      appName: "Career Jump Test",
    });
  });

  it("rejects a protected path with no authorization header", async () => {
    const response = await handler(makeEvent("/api/companies"));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      error: "Missing bearer token",
    });
  });

  it("rejects a protected path with an invalid bearer token", async () => {
    verifyTokenMock.mockRejectedValueOnce(new Error("invalid token"));
    verifyTokenMock.mockRejectedValueOnce(new Error("invalid token"));

    const response = await handler(makeEvent("/api/companies", "GET", {
      authorization: "Bearer not-a-valid-token",
    }));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      error: "Invalid bearer token",
    });
  });

  it("rejects a protected path with the wrong authorization scheme", async () => {
    const response = await handler(makeEvent("/api/companies", "GET", {
      authorization: "Basic abc123",
    }));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      ok: false,
      error: "Missing bearer token",
    });
  });
});
