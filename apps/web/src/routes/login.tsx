import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthContext";
import { auth } from "@/lib/auth";

export const Route = createFileRoute("/login")({ component: LoginRoute });

function LoginRoute() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Keep redirect side effects out of render to avoid blank screens when the
  // auth gate and route both try to navigate during the same paint.
  useEffect(() => {
    if (status === "authenticated") {
      window.location.replace("/");
    }
  }, [status]);

  if (status === "authenticated") return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Email is required"); return; }
    if (!password) { setError("Password is required"); return; }
    setLoading(true);
    try {
      await signIn(email.trim(), password, rememberMe);
      void navigate({ to: "/" });
    } catch (err) {
      const ae = err as { code?: string; message?: string };
      if (ae.code === "UserNotConfirmedException") {
        void navigate({ to: "/verify-email", search: { email: email.trim() } });
        return;
      }
      setError(ae.message ?? "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to your Career Jump account"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link to="/signup" className="text-blue-500 hover:text-blue-400 font-medium">Create one free</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {auth.isMockMode && (
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2 text-xs text-blue-400">
            <strong>Dev mode</strong> — Sign up to create a local account, or use any previously created account. Verification code: <strong>123456</strong>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-sm text-rose-400">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Password</label>
            <Link to="/forgot-password" className="text-xs text-blue-500 hover:text-blue-400">Forgot password?</Link>
          </div>
          <div className="relative">
            <Input
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            >
              {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded accent-blue-500 cursor-pointer"
          />
          <span className="text-sm text-[hsl(var(--muted-foreground))]">Keep me signed in for 30 days</span>
        </label>

        <Button type="submit" disabled={loading} className="w-full gap-2 mt-2">
          <LogIn size={15} />
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}
