import type { AuthUser } from "@/lib/auth";

/**
 * Cognito often uses the email address as the username fallback. For display
 * surfaces, trim that down to the local part so the UI shows a readable name.
 */
export function getAuthDisplayName(user: AuthUser | null | undefined, fallback = "Account"): string {
  const raw = user?.username?.trim() || user?.email?.trim() || "";
  if (!raw) return fallback;
  const localPart = raw.includes("@") ? raw.split("@")[0] : raw;
  return localPart || fallback;
}

/** Keeps email fallback logic consistent across profile-related UI surfaces. */
export function getAuthDisplayEmail(user: AuthUser | null | undefined): string {
  return user?.email?.trim() || "";
}
