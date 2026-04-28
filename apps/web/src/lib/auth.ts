/**
 * Auth library — wraps Amazon Cognito with a mock fallback for local dev.
 *
 * When VITE_USE_MOCKS=true on localhost, all calls go through a lightweight
 * in-memory mock so the app works without real AWS credentials during local
 * development.
 *
 * Tenant ID = Cognito `sub` claim. Every API call includes the ID token
 * as Authorization: Bearer <idToken>. The backend extracts sub to scope
 * all DynamoDB queries to that user's partition.
 */

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
  type CognitoUserSession,
  type ISignUpResult,
} from "amazon-cognito-identity-js";
import { envValue, isLocalDevHost, runtimeValue } from "./runtime-config";
import { clearSessionId } from "./session";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REGION = envValue("VITE_AWS_REGION") || "us-east-1";
const POOL_ID = runtimeValue("cognitoUserPoolId") || envValue("VITE_COGNITO_USER_POOL_ID");
const CLIENT_ID = runtimeValue("cognitoClientId") || envValue("VITE_COGNITO_APP_CLIENT_ID");
const ADMIN_POOL_ID = runtimeValue("adminCognitoUserPoolId");
const ADMIN_CLIENT_ID = runtimeValue("adminCognitoClientId");
// Only local/dev hosts can enable mocks, even if a prod build accidentally
// carries VITE_USE_MOCKS=true.
const USE_MOCKS = isLocalDevHost() && (envValue("VITE_USE_MOCKS") === "true") && !POOL_ID;

// ---------------------------------------------------------------------------
// Token storage — sessionStorage primary, localStorage for "remember me"
// ---------------------------------------------------------------------------

const TOKEN_KEY = "cj:auth";

interface TokenBundle {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  sub: string;
  email: string;
  username: string;
  scope: AuthScope;
  expiresAt: number; // epoch ms
}

function saveTokens(t: TokenBundle, persist: boolean): void {
  const raw = JSON.stringify(t);
  sessionStorage.setItem(TOKEN_KEY, raw);
  if (persist) localStorage.setItem(TOKEN_KEY, raw);
}

function loadTokens(): TokenBundle | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as TokenBundle) : null;
  } catch {
    return null;
  }
}

function clearTokens(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

async function authPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const apiBaseUrl = runtimeValue("apiBaseUrl") || envValue("VITE_API_BASE_URL") || "";
  const response = await fetch(`${String(apiBaseUrl).replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) {
    throw toAuthError({ code: "unknown", message: String(data.error ?? data.message ?? "Request failed") });
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuthUser {
  sub: string;
  email: string;
  username: string;
  idToken: string;
  accessToken: string;
  scope: AuthScope;
}

export type AuthErrorCode =
  | "UserNotConfirmedException"
  | "NotAuthorizedException"
  | "UsernameExistsException"
  | "CodeMismatchException"
  | "ExpiredCodeException"
  | "LimitExceededException"
  | "UserNotFoundException"
  | "InvalidPasswordException"
  | "unknown";

export interface AuthError {
  code: AuthErrorCode;
  message: string;
}

function toAuthError(err: unknown): AuthError {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code: string; message: string };
    return { code: e.code as AuthErrorCode, message: e.message };
  }
  return { code: "unknown", message: err instanceof Error ? err.message : String(err) };
}

// ---------------------------------------------------------------------------
// Cognito helpers
// ---------------------------------------------------------------------------

export type AuthScope = "user" | "admin";

let _pool: CognitoUserPool | null = null;
let _adminPool: CognitoUserPool | null = null;

function poolForScope(scope: AuthScope): CognitoUserPool {
  if (scope === "admin") {
    if (!ADMIN_POOL_ID || !ADMIN_CLIENT_ID) {
      throw toAuthError({ code: "unknown", message: "Admin sign-in is not configured yet." });
    }
    if (!_adminPool) _adminPool = new CognitoUserPool({ UserPoolId: ADMIN_POOL_ID, ClientId: ADMIN_CLIENT_ID });
    return _adminPool;
  }
  if (!_pool) _pool = new CognitoUserPool({ UserPoolId: POOL_ID, ClientId: CLIENT_ID });
  return _pool;
}

function cognitoUser(email: string, scope: AuthScope = "user"): CognitoUser {
  return new CognitoUser({ Username: email.toLowerCase(), Pool: poolForScope(scope) });
}

function sessionToBundle(session: CognitoUserSession, email: string, username: string, scope: AuthScope): TokenBundle {
  const idToken = session.getIdToken();
  return {
    idToken: idToken.getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    refreshToken: session.getRefreshToken().getToken(),
    sub: idToken.payload.sub as string,
    email,
    username: username || (idToken.payload["custom:username"] as string) || email,
    scope,
    expiresAt: idToken.getExpiration() * 1000,
  };
}

// ---------------------------------------------------------------------------
// Mock implementation — works offline, no AWS required
// ---------------------------------------------------------------------------

interface MockUser {
  email: string;
  password: string;
  username: string;
  verified: boolean;
  sub: string;
}

const MOCK_USERS_KEY = "cj:mock-users";

function mockUsers(): Record<string, MockUser> {
  try {
    return JSON.parse(localStorage.getItem(MOCK_USERS_KEY) ?? "{}") as Record<string, MockUser>;
  } catch {
    return {};
  }
}

function saveMockUsers(users: Record<string, MockUser>): void {
  localStorage.setItem(MOCK_USERS_KEY, JSON.stringify(users));
}

function mockBundle(user: MockUser): TokenBundle {
  const now = Date.now();
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    sub: user.sub,
    email: user.email,
    "custom:username": user.username,
    exp: Math.floor(now / 1000) + 3600,
    iat: Math.floor(now / 1000),
  }));
  const fakeJwt = `${header}.${payload}.mock-signature`;
  return {
    idToken: fakeJwt,
    accessToken: fakeJwt,
    refreshToken: `mock-refresh.${user.sub}`,
    sub: user.sub,
    email: user.email,
    username: user.username,
    scope: "user",
    expiresAt: now + 3600_000,
  };
}

// ---------------------------------------------------------------------------
// Auth API — unified interface, switches between real Cognito and mock
// ---------------------------------------------------------------------------

export const auth = {
  isMockMode: USE_MOCKS,
  region: REGION,

  currentUser(): AuthUser | null {
    const t = loadTokens();
    if (!t || t.expiresAt <= Date.now() - 60_000) {
      if (t) clearTokens();
      return null;
    }
    return { sub: t.sub, email: t.email, username: t.username, idToken: t.idToken, accessToken: t.accessToken, scope: t.scope ?? "user" };
  },

  getIdToken(): string {
    return loadTokens()?.idToken ?? "";
  },

  async refreshSession(): Promise<AuthUser | null> {
    if (USE_MOCKS) {
      const t = loadTokens();
      if (!t) return null;
      saveTokens({ ...t, expiresAt: Date.now() + 3600_000 }, !!localStorage.getItem(TOKEN_KEY));
      return auth.currentUser();
    }
    return new Promise((resolve) => {
      const t = loadTokens();
      if (!t) { resolve(null); return; }
      const cu = cognitoUser(t.email, t.scope ?? "user");
      const session = cu.getSignInUserSession();
      if (!session) { clearTokens(); resolve(null); return; }
      cu.refreshSession(session.getRefreshToken(), (err, newSession: CognitoUserSession) => {
        if (err) { clearTokens(); resolve(null); return; }
        const bundle = sessionToBundle(newSession, t.email, t.username, t.scope ?? "user");
        saveTokens(bundle, !!localStorage.getItem(TOKEN_KEY));
        resolve(auth.currentUser());
      });
    });
  },

  async signIn(email: string, password: string, rememberMe = false, scope: AuthScope = "user"): Promise<AuthUser> {
    if (USE_MOCKS) {
      const users = mockUsers();
      const user = users[email.toLowerCase()];
      if (!user) throw toAuthError({ code: "UserNotFoundException", message: "No account found with that email" });
      if (!user.verified) throw toAuthError({ code: "UserNotConfirmedException", message: "Please verify your email before signing in" });
      if (user.password !== password) throw toAuthError({ code: "NotAuthorizedException", message: "Incorrect email or password" });
      const bundle = mockBundle(user);
      saveTokens(bundle, rememberMe);
      return auth.currentUser()!;
    }
    return new Promise((resolve, reject) => {
      const cu = cognitoUser(email, scope);
      cu.authenticateUser(new AuthenticationDetails({ Username: email.toLowerCase(), Password: password }), {
        onSuccess: (session) => {
          const payload = session.getIdToken().payload;
          const bundle = sessionToBundle(session, email, (payload["custom:username"] as string) || (payload.name as string) || email, scope);
          saveTokens(bundle, rememberMe);
          resolve(auth.currentUser()!);
        },
        onFailure: (err) => reject(toAuthError(err)),
        newPasswordRequired: () => reject(toAuthError({ code: "unknown", message: "New password required. Contact support." })),
      });
    });
  },

  async signUp(email: string, password: string, username: string): Promise<{ sub: string }> {
    if (USE_MOCKS) {
      const users = mockUsers();
      const key = email.toLowerCase();
      if (users[key]) throw toAuthError({ code: "UsernameExistsException", message: "An account with that email already exists" });
      const sub = crypto.randomUUID();
      users[key] = { email: key, password, username, verified: false, sub };
      saveMockUsers(users);
      sessionStorage.setItem(`cj:mock-code:${key}`, "123456");
      return { sub };
    }
    return new Promise((resolve, reject) => {
      poolForScope("user").signUp(
        email.toLowerCase(),
        password,
        [
          new CognitoUserAttribute({ Name: "email", Value: email.toLowerCase() }),
          new CognitoUserAttribute({ Name: "custom:username", Value: username }),
        ],
        [],
        (err, result?: ISignUpResult) => {
          if (err) { reject(toAuthError(err)); return; }
          resolve({ sub: result?.userSub ?? "" });
        },
      );
    });
  },

  async confirmSignUp(email: string, code: string): Promise<void> {
    if (USE_MOCKS) {
      const key = email.toLowerCase();
      const expected = sessionStorage.getItem(`cj:mock-code:${key}`);
      if (!expected) throw toAuthError({ code: "UserNotFoundException", message: "No pending verification found" });
      if (code.trim() !== expected) throw toAuthError({ code: "CodeMismatchException", message: "Invalid verification code" });
      const users = mockUsers();
      if (users[key]) { users[key].verified = true; saveMockUsers(users); }
      sessionStorage.removeItem(`cj:mock-code:${key}`);
      return;
    }
    return new Promise((resolve, reject) => {
      cognitoUser(email, "user").confirmRegistration(code, true, (err) => {
        if (err) { reject(toAuthError(err)); return; }
        resolve();
      });
    });
  },

  async resendConfirmationCode(email: string): Promise<void> {
    if (USE_MOCKS) {
      sessionStorage.setItem(`cj:mock-code:${email.toLowerCase()}`, "123456");
      return;
    }
    return new Promise((resolve, reject) => {
      cognitoUser(email, "user").resendConfirmationCode((err) => {
        if (err) { reject(toAuthError(err)); return; }
        resolve();
      });
    });
  },

  async forgotPassword(email: string, scope: AuthScope = "user"): Promise<void> {
    if (USE_MOCKS) {
      sessionStorage.setItem(`cj:mock-reset:${email.toLowerCase()}`, "654321");
      return;
    }
    // Route production resets through our own API so we are not blocked by
    // Cognito's flaky email delivery path in this account.
    await authPost("/api/auth/reset/request", { email: email.toLowerCase(), scope });
  },

  async confirmForgotPassword(email: string, code: string, newPassword: string, scope: AuthScope = "user"): Promise<void> {
    if (USE_MOCKS) {
      const key = email.toLowerCase();
      const expected = sessionStorage.getItem(`cj:mock-reset:${key}`);
      if (!expected || code.trim() !== expected) throw toAuthError({ code: "CodeMismatchException", message: "Invalid or expired code" });
      const users = mockUsers();
      if (users[key]) { users[key].password = newPassword; saveMockUsers(users); }
      sessionStorage.removeItem(`cj:mock-reset:${key}`);
      return;
    }
    await authPost("/api/auth/reset/confirm", {
      email: email.toLowerCase(),
      code,
      newPassword,
      scope,
    });
  },

  signOut(): void {
    if (!USE_MOCKS) {
      const t = loadTokens();
      if (t) { try { cognitoUser(t.email, t.scope ?? "user").signOut(); } catch { /* best-effort */ } }
    }
    clearTokens();
    clearSessionId();
  },

  async deleteAccount(): Promise<void> {
    if (USE_MOCKS) {
      const t = loadTokens();
      if (t) { const users = mockUsers(); delete users[t.email]; saveMockUsers(users); }
      clearTokens();
      clearSessionId();
      return;
    }
    return new Promise((resolve, reject) => {
      const t = loadTokens();
      if (!t) { clearTokens(); resolve(); return; }
      cognitoUser(t.email, t.scope ?? "user").deleteUser((err) => {
        clearTokens();
        clearSessionId();
        if (err) { reject(toAuthError(err)); return; }
        resolve();
      });
    });
  },
};

// ---------------------------------------------------------------------------
// Legacy shims — keeps existing api.ts working unchanged
// ---------------------------------------------------------------------------

export function getValidIdToken(): string {
  return auth.getIdToken();
}

export function isAuthEnabled(): boolean {
  return true;
}
