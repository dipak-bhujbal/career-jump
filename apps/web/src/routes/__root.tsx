/**
 * Root route — wraps every page with auth + app shell.
 *
 * Auth flow:
 *   - /login, /signup, /verify-email, /forgot-password, /privacy → public
 *   - all other routes → require authentication
 *   - while auth is loading → full-page spinner
 *   - unauthenticated on protected route → redirect to /login
 */
import { Outlet, createRootRoute, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { ToastViewport } from "@/components/ui/toast";
import { CommandPalette } from "@/components/command-palette";
import { KeyboardHelp } from "@/components/keyboard-help";
import { MeteorBackground } from "@/components/meteor-background";
import { RunProgress } from "@/components/run-progress";
import { useHotkey } from "@/lib/hotkeys";
import { AuthProvider, useAuth } from "@/features/auth/AuthContext";
import { Sparkles } from "lucide-react";

const PUBLIC_PATHS = ["/login", "/signup", "/verify-email", "/forgot-password", "/privacy"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

function AppShell() {
  const navigate = useNavigate();
  useHotkey({ id: "go-dashboard", description: "Go to Dashboard", category: "Navigate", sequence: ["g", "d"] }, () => navigate({ to: "/" }));
  useHotkey({ id: "go-jobs", description: "Go to Available Jobs", category: "Navigate", sequence: ["g", "j"] }, () => navigate({ to: "/jobs" }));
  useHotkey({ id: "go-applied", description: "Go to Applied Jobs", category: "Navigate", sequence: ["g", "a"] }, () => navigate({ to: "/applied" }));
  useHotkey({ id: "go-plan", description: "Go to Action Plan", category: "Navigate", sequence: ["g", "p"] }, () => navigate({ to: "/plan" }));
  useHotkey({ id: "go-config", description: "Go to Configuration", category: "Navigate", sequence: ["g", "c"] }, () => navigate({ to: "/configuration" }));

  return (
    <div className="h-screen overflow-hidden flex relative">
      <MeteorBackground />
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <RunProgress />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </div>
      </main>
      <ToastViewport />
      <CommandPalette />
      <KeyboardHelp />
    </div>
  );
}

function AuthGate() {
  const { status } = useAuth();
  const { pathname } = useLocation();

  // Redirect after render so protected routes do not flash a blank screen
  // while TanStack Router processes the location change.
  useEffect(() => {
    if (status === "unauthenticated" && !isPublicPath(pathname)) {
      // Use a hard same-origin redirect here because the blank-screen bug
      // occurs before the SPA can reliably complete a client-side transition.
      window.location.replace("/login");
    }
  }, [pathname, status]);

  if (isPublicPath(pathname)) return <Outlet />;

  if (status === "loading") {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-[hsl(var(--background))]">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white shadow-lg animate-pulse">
          <Sparkles size={24} />
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))] animate-pulse">Loading…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="h-screen flex items-center justify-center bg-[hsl(var(--background))] text-sm text-[hsl(var(--muted-foreground))]">
        Redirecting to sign in…
      </div>
    );
  }

  return <AppShell />;
}

function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

export const Route = createRootRoute({ component: RootLayout });
