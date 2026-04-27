import { ensureUserProfile, ensureUserSession } from "../storage/accounts";
import type { Env } from "../types";

export type AuthenticatedTenantContext = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  scope: "user" | "admin";
  isAdmin: boolean;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeIdentityToken(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || fallback;
}

function titleCaseFromEmail(email: string): string {
  const local = normalizeEmail(email).split("@")[0] || "user";
  const words = local.replace(/[._-]+/g, " ").split(/\s+/).filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || "User";
}

function defaultEmail(env: Env): string {
  return env.DEFAULT_TENANT_EMAIL?.trim().toLowerCase() || "local@career-jump.local";
}

function headerValue(request: Request, key: string): string | null {
  return request.headers.get(key)
    || request.headers.get(key.toLowerCase())
    || request.headers.get(key.toUpperCase())
    || request.headers.get(key.replace(/(^|-)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`))
    || null;
}

function accessEmail(request: Request): string | null {
  return headerValue(request, "x-cj-email")
    || request.headers.get("cf-access-authenticated-user-email")
    || request.headers.get("Cf-Access-Authenticated-User-Email")
    || null;
}

function displayNameFromRequest(request: Request, email: string): string {
  const explicit = headerValue(request, "x-cj-display-name");
  if (explicit?.trim()) return explicit.trim();
  return titleCaseFromEmail(email);
}

function scopeFromRequest(request: Request): "user" | "admin" {
  return headerValue(request, "x-cj-auth-scope") === "admin" ? "admin" : "user";
}

function isAdminRequest(request: Request): boolean {
  return headerValue(request, "x-cj-admin") === "true";
}

function requestUserId(request: Request, email: string): string {
  return headerValue(request, "x-cj-user-id")
    || `user-${safeIdentityToken(normalizeEmail(email), "default")}`;
}

function requestTenantId(request: Request, userId: string): string {
  return headerValue(request, "x-cj-tenant-id") || userId;
}

function requestSessionId(request: Request): string {
  return headerValue(request, "x-cj-session-id") || "";
}

function requestDeviceFingerprint(request: Request): string {
  return headerValue(request, "x-cj-device-fingerprint") || "unknown-device";
}

function requestIpAddress(request: Request): string {
  const raw = headerValue(request, "x-forwarded-for") || headerValue(request, "x-real-ip") || "";
  return raw.split(",")[0]?.trim() || "unknown-ip";
}

function requestCountry(request: Request): string {
  return (headerValue(request, "cloudfront-viewer-country") || "").trim().toUpperCase();
}

export function tenantScopedKey(tenantId: string | undefined, key: string): string {
  return tenantId ? `tenant:${tenantId}:${key}` : key;
}

export function tenantScopedPrefix(tenantId: string | undefined, prefix: string): string {
  return tenantId ? `tenant:${tenantId}:${prefix}` : prefix;
}

export async function resolveRequestTenantContext(request: Request, env: Env): Promise<AuthenticatedTenantContext> {
  const email = normalizeEmail(accessEmail(request) || defaultEmail(env));
  const userId = requestUserId(request, email);
  const tenantId = requestTenantId(request, userId);
  const actor = {
    userId,
    tenantId,
    email,
    displayName: displayNameFromRequest(request, email),
    scope: scopeFromRequest(request),
    isAdmin: isAdminRequest(request),
  } as const;
  const profile = await ensureUserProfile(actor);
  const sessionId = requestSessionId(request);
  if (sessionId) {
    await ensureUserSession(actor, {
      sessionId,
      deviceFingerprint: requestDeviceFingerprint(request),
      ipAddress: requestIpAddress(request),
      country: requestCountry(request) || "US",
    });
  }
  return {
    userId: profile.userId,
    tenantId: profile.tenantId,
    email: profile.email,
    displayName: profile.displayName,
    scope: actor.scope,
    isAdmin: actor.isAdmin,
  };
}

export async function resolveSystemTenantContext(env: Env): Promise<AuthenticatedTenantContext> {
  const email = defaultEmail(env);
  return {
    userId: `system-${safeIdentityToken(email, "career-jump")}`,
    tenantId: `system-${safeIdentityToken(email, "career-jump")}`,
    email,
    displayName: env.APP_NAME?.trim() || "Career Jump",
    scope: "admin",
    isAdmin: true,
  };
}
