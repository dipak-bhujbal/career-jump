import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from "aws-lambda";
import { authorizeRequest, authHeaders } from "./auth";
import { makeAwsEnv } from "./env";
import { handleRequest } from "../routes";
import { logErrorEvent } from "../lib/logger";

const lambda = new LambdaClient({});

function makeRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function requestFromEvent(event: LambdaFunctionURLEvent): Request {
  const protocol = event.headers["x-forwarded-proto"] ?? "https";
  const host = event.headers.host ?? "localhost";
  const rawPath = event.rawPath || "/";
  const rawQueryString = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const url = `${protocol}://${host}${rawPath}${rawQueryString}`;
  const body = event.body
    ? event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body
    : undefined;
  return new Request(url, {
    method: event.requestContext.http.method,
    headers: event.headers as HeadersInit,
    body: ["GET", "HEAD"].includes(event.requestContext.http.method) ? undefined : body,
  });
}

async function responseToResult(response: Response, origin?: string | null): Promise<APIGatewayProxyStructuredResultV2> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    statusCode: response.status,
    headers: {
      ...headers,
      ...authHeaders(origin),
    },
    body: await response.text(),
  };
}

async function startAwsRun(request: Request): Promise<Response> {
  const functionName = process.env.RUN_ORCHESTRATOR_FUNCTION_NAME;
  if (!functionName) {
    return new Response(JSON.stringify({ ok: false, error: "RUN_ORCHESTRATOR_FUNCTION_NAME is not configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const runId = makeRunId("manual");
  // Forward the authenticated actor so manual scans run against the signed-in
  // user's tenant instead of the scheduler's system tenant.
  await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify({
      runId,
      triggerType: "manual",
      userId: request.headers.get("x-cj-user-id") ?? undefined,
      tenantId: request.headers.get("x-cj-tenant-id") ?? undefined,
      email: request.headers.get("x-cj-email") ?? undefined,
      displayName: request.headers.get("x-cj-display-name") ?? undefined,
      scope: request.headers.get("x-cj-auth-scope") ?? undefined,
      isAdmin: request.headers.get("x-cj-admin") === "true",
    })),
  }));

  return new Response(JSON.stringify({ ok: true, runId, status: "accepted" }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
}

export async function handler(event: LambdaFunctionURLEvent): Promise<APIGatewayProxyStructuredResultV2> {
  const incomingRequest = requestFromEvent(event);
  const origin = incomingRequest.headers.get("origin");
  const authResult = await authorizeRequest(incomingRequest);
  if (authResult.response) return responseToResult(authResult.response, origin);
  const request = authResult.request ?? incomingRequest;

  const env = makeAwsEnv();
  try {
    const url = new URL(request.url);
    const response = request.method === "POST" && url.pathname === "/api/run"
      ? await startAwsRun(request)
      : await handleRequest(request, env);
    return responseToResult(response, origin);
  } catch (error) {
    await logErrorEvent(env, {
      event: "api_unhandled_error",
      message: error instanceof Error ? error.message : String(error),
      route: "aws/api",
      error,
    });
    return {
      statusCode: 500,
      headers: {
        "content-type": "application/json",
        ...authHeaders(origin),
      },
      body: JSON.stringify({ ok: false, error: "Internal server error" }),
    };
  }
}
