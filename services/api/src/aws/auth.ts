import { CognitoJwtVerifier } from "aws-jwt-verify";
import type { RequestActor } from "../types";

type CognitoClaims = {
  sub?: string;
  email?: string;
  name?: string;
  "custom:username"?: string;
  "cognito:username"?: string;
};

const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
const clientId = process.env.COGNITO_CLIENT_ID ?? "";
const adminUserPoolId = process.env.ADMIN_COGNITO_USER_POOL_ID ?? "";
const adminClientId = process.env.ADMIN_COGNITO_CLIENT_ID ?? "";
const originVerifyHeaderValue = process.env.ORIGIN_VERIFY_HEADER_VALUE ?? "";
const strictEdgeEnforcement = (process.env.APP_ENV ?? "prod") === "prod";
const allowedCountries = new Set(["US"]);

const userVerifier = userPoolId && clientId
  ? CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "id",
      clientId,
    })
  : null;

const adminVerifier = adminUserPoolId && adminClientId
  ? CognitoJwtVerifier.create({
      userPoolId: adminUserPoolId,
      tokenUse: "id",
      clientId: adminClientId,
    })
  : null;

function normalizeEmail(email?: string): string {
  return String(email ?? "").trim().toLowerCase();
}

function displayNameFromClaims(claims: CognitoClaims): string {
  return String(
    claims["custom:username"]
    || claims.name
    || claims["cognito:username"]
    || normalizeEmail(claims.email).split("@")[0]
    || "Career Jump User"
  ).trim();
}

export function authHeaders(origin?: string | null): HeadersInit {
  const allowedOrigin = process.env.CORS_ALLOWED_ORIGIN || "*";
  // Reflect the configured origin contract directly so future env tightening
  // does not depend on a misleading tautological branch.
  const responseOrigin = allowedOrigin === "*" ? "*" : (origin === allowedOrigin ? origin : allowedOrigin);
  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Headers": "authorization,content-type,x-cj-session-id,x-cj-device-fingerprint",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Max-Age": "300",
    Vary: "Origin",
  };
}

export function isPublicPath(pathname: string): boolean {
  return pathname === "/health"
    || pathname === "/docs"
    || pathname === "/api/openapi.json"
    || pathname === "/api/auth/reset/request"
    || pathname === "/api/auth/reset/confirm";
}

function forbidden(message: string, request: Request, status = 403): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json", ...authHeaders(request.headers.get("origin")) },
  });
}

function requestCountry(request: Request): string {
  return String(request.headers.get("cloudfront-viewer-country") ?? "").trim().toUpperCase();
}

function originVerified(request: Request): boolean {
  if (!originVerifyHeaderValue) return true;
  return request.headers.get("x-origin-verify") === originVerifyHeaderValue;
}

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasSessionHeader(request: Request): boolean {
  const sessionId = String(request.headers.get("x-cj-session-id") ?? "").trim();
  return SESSION_ID_PATTERN.test(sessionId);
}

function requestContextHeaders(context: RequestActor): Headers {
  const headers = new Headers();
  headers.set("x-cj-user-id", context.userId);
  headers.set("x-cj-tenant-id", context.tenantId);
  headers.set("x-cj-email", context.email);
  headers.set("x-cj-display-name", context.displayName);
  headers.set("x-cj-auth-scope", context.scope);
  headers.set("x-cj-admin", context.isAdmin ? "true" : "false");
  return headers;
}

async function verifyToken(token: string): Promise<RequestActor | null> {
  if (userVerifier) {
    try {
      const claims = await userVerifier.verify(token) as CognitoClaims;
      const email = normalizeEmail(claims.email);
      if (!claims.sub || !email) return null;
      return {
        userId: claims.sub,
        tenantId: claims.sub,
        email,
        displayName: displayNameFromClaims(claims),
        scope: "user",
        isAdmin: false,
      };
    } catch {
      // Fall through to admin verification so the admin pool can share the same
      // API origin while staying fully isolated from user sign-in.
    }
  }

  if (adminVerifier) {
    try {
      const claims = await adminVerifier.verify(token) as CognitoClaims;
      const email = normalizeEmail(claims.email);
      if (!claims.sub || !email) return null;
      return {
        userId: claims.sub,
        tenantId: claims.sub,
        email,
        displayName: displayNameFromClaims(claims),
        scope: "admin",
        isAdmin: true,
      };
    } catch {
      return null;
    }
  }

  return null;
}

export async function authorizeRequest(
  request: Request
): Promise<{ response: Response | null; context?: RequestActor; request?: Request }> {
  if (request.method === "OPTIONS") {
    return {
      response: new Response(null, { status: 204, headers: authHeaders(request.headers.get("origin")) }),
    };
  }

  const pathname = new URL(request.url).pathname;
  if (strictEdgeEnforcement && !originVerified(request)) {
    return {
      response: forbidden("Requests must come through the approved edge origin", request, 403),
    };
  }

  const country = requestCountry(request);
  if (strictEdgeEnforcement && (!country || !allowedCountries.has(country))) {
    return {
      response: forbidden("This application is available only in the United States", request, 451),
    };
  }

  if (isPublicPath(pathname)) {
    // Public account-recovery routes still inherit edge/country checks so they
    // do not become the one unaudited hole in the perimeter model.
    return { response: null, request };
  }

  if ((!userVerifier && !adminVerifier) || (!clientId && !adminClientId)) {
    return {
      response: forbidden("Authentication is not configured", request, 500),
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return {
      response: forbidden("Missing bearer token", request, 401),
    };
  }

  const context = await verifyToken(match[1]);
  if (!context) {
    return {
      response: forbidden("Invalid bearer token", request, 401),
    };
  }
  if (strictEdgeEnforcement && !hasSessionHeader(request)) {
    return {
      response: forbidden("Missing or invalid session identifier", request, 401),
    };
  }

  const nextHeaders = new Headers(request.headers);
  requestContextHeaders(context).forEach((value, key) => nextHeaders.set(key, value));
  const nextRequest = new Request(request, { headers: nextHeaders });
  return { response: null, context, request: nextRequest };
}
