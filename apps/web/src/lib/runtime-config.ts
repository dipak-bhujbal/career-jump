/**
 * Runtime AWS config injected by the deployed `public/aws-config.js` asset.
 *
 * Keeping this in one helper prevents auth and API clients from drifting. Build
 * time `VITE_*` values remain useful for local dev, while production can swap
 * AWS resource IDs without rebuilding the React bundle.
 */
export interface CareerJumpAwsRuntimeConfig {
  apiBaseUrl?: string;
  /** Separate Lambda Function URL for the registry API (career-jump-web-poc-registry stack).
   *  When set, /api/registry/* calls go here instead of apiBaseUrl. */
  registryBaseUrl?: string;
  cognitoDomain?: string;
  cognitoClientId?: string;
  cognitoUserPoolId?: string;
  adminCognitoDomain?: string;
  adminCognitoClientId?: string;
  adminCognitoUserPoolId?: string;
  redirectUri?: string;
}

declare global {
  interface Window {
    CAREER_JUMP_AWS?: CareerJumpAwsRuntimeConfig;
  }
}

export function envValue(key: string): string {
  return (import.meta as unknown as { env: Record<string, string | undefined> }).env[key] ?? "";
}

export function runtimeValue<K extends keyof CareerJumpAwsRuntimeConfig>(key: K): string {
  return (typeof window !== "undefined" ? window.CAREER_JUMP_AWS?.[key] : undefined) ?? "";
}

export function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}
