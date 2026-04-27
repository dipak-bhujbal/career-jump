import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, UserPlus, CheckCircle2, XCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthContext";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/signup")({ component: SignupRoute });

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", met ? "text-green-500" : "text-[hsl(var(--muted-foreground))]")}>
      {met ? <CheckCircle2 size={11} /> : <XCircle size={11} className="opacity-40" />}
      {label}
    </div>
  );
}

function SignupRoute() {
  const { signUp, status } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Redirect after the component commits so authenticated users do not hit a
  // render-time navigation loop on first load.
  useEffect(() => {
    if (status === "authenticated") {
      window.location.replace("/");
    }
  }, [status]);

  if (status === "authenticated") return null;

  const rules = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const passwordValid = Object.values(rules).every(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Display name is required"); return; }
    if (!email.trim()) { setError("Email is required"); return; }
    if (!passwordValid) { setError("Password does not meet the requirements"); return; }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim());
      void navigate({ to: "/verify-email", search: { email: email.trim() } });
    } catch (err) {
      const ae = err as { message?: string };
      setError(ae.message ?? "Sign up failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      description="Join Career Jump — free beta access"
      width="md"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-blue-500 hover:text-blue-400 font-medium">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-sm text-rose-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Display name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Password</label>
          <div className="relative">
            <Input
              type={showPwd ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create a strong password"
              autoComplete="new-password"
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
          {password && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
              <PasswordRule met={rules.length} label="At least 8 characters" />
              <PasswordRule met={rules.upper} label="Uppercase letter" />
              <PasswordRule met={rules.lower} label="Lowercase letter" />
              <PasswordRule met={rules.number} label="Number" />
              <PasswordRule met={rules.symbol} label="Special character" />
            </div>
          )}
        </div>

        <div className="rounded-lg bg-[hsl(var(--secondary))]/60 px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">
          We&apos;ll send a 6-digit verification code to your email. Your data is isolated to your account only — no sharing between users.
        </div>

        <Button type="submit" disabled={loading || !passwordValid} className="w-full gap-2 mt-1">
          <UserPlus size={15} />
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
