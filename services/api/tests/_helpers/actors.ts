/**
 * Shared actor fixtures for route-level tests. Keep these small and explicit so
 * auth-gate expectations stay readable in smoke/sanity/integration suites.
 */
export const anonActor = null;

export const userActor = {
  userId: "u1",
  tenantId: "t1",
  email: "user@test.com",
  displayName: "Test User",
  scope: "user" as const,
  isAdmin: false,
};

export const adminActor = {
  ...userActor,
  isAdmin: true,
  scope: "admin" as const,
};
