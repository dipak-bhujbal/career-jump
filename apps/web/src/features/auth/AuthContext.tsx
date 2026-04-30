/**
 * AuthContext — provides auth state + actions to the entire component tree.
 *
 * On mount: loads persisted tokens, refreshes if within 5-min expiry window.
 * Auth state drives route protection in __root.tsx.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { auth, type AuthUser, type AuthError, type AuthScope } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthStatus =
  | "loading"        // initial token check
  | "unauthenticated"
  | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  error: AuthError | null;

  signIn: (email: string, password: string, rememberMe?: boolean, scope?: AuthScope) => Promise<void>;
  signUp: (email: string, password: string, username: string) => Promise<{ sub: string }>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  forgotPassword: (email: string, scope?: AuthScope) => Promise<void>;
  confirmForgotPassword: (email: string, code: string, newPassword: string, scope?: AuthScope) => Promise<void>;
  signOut: () => void;
  deleteAccount: () => Promise<void>;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<AuthError | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function tokenExpiresInMs(idToken: string): number | null {
    try {
      const parts = idToken.split(".");
      if (parts.length < 2) return null;
      const payload = JSON.parse(atob(parts[1])) as { exp?: number };
      if (!payload.exp) return null;
      return (payload.exp * 1000) - Date.now();
    } catch {
      return null;
    }
  }

  function scheduleRefresh(expiresInMs: number) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    // Refresh 5 minutes before expiry
    const delay = Math.max(expiresInMs - 5 * 60 * 1000, 10_000);
    refreshTimer.current = setTimeout(async () => {
      const refreshed = await auth.refreshSession();
      if (refreshed) {
        setUser(refreshed);
        const nextExpiresInMs = tokenExpiresInMs(refreshed.idToken);
        if (nextExpiresInMs !== null) scheduleRefresh(nextExpiresInMs);
      } else {
        setUser(null);
        setStatus("unauthenticated");
      }
    }, delay);
  }

  // Initial auth check
  useEffect(() => {
    async function init() {
      const existing = auth.currentUser();
      if (existing) {
        setUser(existing);
        setStatus("authenticated");
        // Schedule proactive refresh
        const expiresInMs = tokenExpiresInMs(existing.idToken);
        if (expiresInMs !== null) scheduleRefresh(expiresInMs);
        return;
      }
      // No valid token — try silent refresh
      const refreshed = await auth.refreshSession();
      if (refreshed) {
        setUser(refreshed);
        setStatus("authenticated");
        const expiresInMs = tokenExpiresInMs(refreshed.idToken);
        if (expiresInMs !== null) scheduleRefresh(expiresInMs);
      } else {
        setStatus("unauthenticated");
      }
    }
    void init();
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, []);

  const signIn = useCallback(async (email: string, password: string, rememberMe = false, scope: AuthScope = "user") => {
    setError(null);
    try {
      const u = await auth.signIn(email, password, rememberMe, scope);
      setUser(u);
      setStatus("authenticated");
      const expiresInMs = tokenExpiresInMs(u.idToken);
      if (expiresInMs !== null) scheduleRefresh(expiresInMs);
    } catch (e) {
      setError(e as AuthError);
      throw e;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, username: string) => {
    setError(null);
    try {
      return await auth.signUp(email, password, username);
    } catch (e) {
      setError(e as AuthError);
      throw e;
    }
  }, []);

  const confirmSignUp = useCallback(async (email: string, code: string) => {
    setError(null);
    try {
      await auth.confirmSignUp(email, code);
    } catch (e) {
      setError(e as AuthError);
      throw e;
    }
  }, []);

  const resendConfirmationCode = useCallback(async (email: string) => {
    setError(null);
    try {
      await auth.resendConfirmationCode(email);
    } catch (e) {
      setError(e as AuthError);
      throw e;
    }
  }, []);

  const forgotPassword = useCallback(async (email: string, scope: AuthScope = "user") => {
    setError(null);
    try {
      await auth.forgotPassword(email, scope);
    } catch (e) {
      setError(e as AuthError);
      throw e;
    }
  }, []);

  const confirmForgotPassword = useCallback(async (email: string, code: string, newPassword: string, scope: AuthScope = "user") => {
    setError(null);
    try {
      await auth.confirmForgotPassword(email, code, newPassword, scope);
    } catch (e) {
      setError(e as AuthError);
      throw e;
    }
  }, []);

  const signOut = useCallback(() => {
    auth.signOut();
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setUser(null);
    setStatus("unauthenticated");
    setError(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    await auth.deleteAccount();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{
      status, user, error,
      signIn, signUp, confirmSignUp, resendConfirmationCode,
      forgotPassword, confirmForgotPassword,
      signOut, deleteAccount, clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
