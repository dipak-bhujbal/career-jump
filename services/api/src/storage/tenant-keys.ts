/**
 * Phase 2 — DynamoDB key conventions for multi-tenant isolation.
 *
 * Goal: pick the key shape NOW so phase-2 multitenancy doesn't require a
 * data migration. All keys include a tenant prefix; in single-tenant mode
 * we use the literal string "default".
 *
 * Access patterns supported:
 *   1) Get one company in registry by name        → registryKey
 *   2) List all registry rows for a tenant        → Query pk
 *   3) List by ATS within a tenant                → registryByAtsKey + sk-prefix
 *   4) Per-tenant settings                        → tenantSettingsKey
 *   5) Per-tenant user overrides                  → userOverrideKey
 *
 * Use these helpers everywhere you read/write tenant-scoped data so the
 * pattern stays consistent.
 */

export const DEFAULT_TENANT = "default";

export type Pk = string;
export type Sk = string;

export function tenantPrefix(tenantId?: string): string {
  return `tenant#${tenantId ?? DEFAULT_TENANT}`;
}

/** pk for the registry of a tenant. */
export function registryPk(tenantId?: string): Pk {
  return `${tenantPrefix(tenantId)}#registry`;
}

/** sk for one company in the registry. */
export function registrySk(companyKey: string): Sk {
  return `company#${companyKey}`;
}

/** Convenience pair. */
export function registryKey(companyKey: string, tenantId?: string) {
  return { pk: registryPk(tenantId), sk: registrySk(companyKey) };
}

/** Secondary access — list all entries for a given ATS within a tenant. */
export function registryByAtsPk(tenantId?: string): Pk {
  return `${tenantPrefix(tenantId)}#registry-by-ats`;
}

export function registryByAtsSk(ats: string, companyKey: string): Sk {
  return `${ats.toLowerCase()}#${companyKey}`;
}

export function registryByAtsKey(ats: string, companyKey: string, tenantId?: string) {
  return { pk: registryByAtsPk(tenantId), sk: registryByAtsSk(ats, companyKey) };
}

/** Per-tenant settings row. */
export function tenantSettingsKey(tenantId?: string) {
  return { pk: tenantPrefix(tenantId), sk: "settings" };
}

/** Per-user, per-tenant override (e.g., "this URL is wrong, use X"). */
export function userOverrideKey(userId: string, companyKey: string, tenantId?: string) {
  return { pk: `${tenantPrefix(tenantId)}#user#${userId}`, sk: `override#${companyKey}` };
}

/** Normalized company key used in sk values. */
export function normalizeCompanyKey(name: string): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
