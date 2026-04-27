import { useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { KeyRound, Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthContext";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/forgot-password")({ component: ForgotPasswordRoute });

type Step = "email" | "code" | "done";

function PasswordRule({ met, label }: { met: boolean; label: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", met ? "text-green-500" : "text-[hsl(var(--muted-foreground))]")}>
      {met ? <CheckCircle2 size={11} /> : <XCircle size={11} className="opacity-40" />}
      {label}
    </div>
  );
}

function ForgotPasswordRoute() {
  const { forgotPassword, confirmForgotPassword } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  const rules = {
    length: newPwd.length >= 8,
    upper: /[A-Z]/.test(newPwd),
    lower: /[a-z]/.test(newPwd),
    number: /\d/.test(newPwd),
    symbol: /[^A-Za-z0-9]/.test(newPwd),
  };
  const passwordValid = Object.values(rules).every(Boolean);

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) { setError("Email is required"); return; }
    setError("");
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 100);
    } catch (err) {
      const ae = err as { message?: string };
      setError(ae.message ?? "Could not send reset code. Check the email and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) { setError("Enter the 6-digit code"); return; }
    if (!passwordValid) { setError("Password does not meet requirements"); return; }
    setError("");
    setLoading(true);
    try {
      await confirmForgotPassword(email.trim(), code.trim(), newPwd);
      setStep("done");
    } catch (err) {
      const ae = err as { message?: string };
      setError(ae.message ?? "Reset failed. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "done") {
    return (
      <AuthShell title="Password reset" description="Your password has been updated successfully">
        <div className="text-center space-y-4 py-2">
          <div className="h-14 w-14 rounded-2xl bg-green-500/10 grid place-items-center text-green-500 mx-auto">
            <CheckCircle2 size={28} />
          </div>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            You can now sign in with your new password.
          </p>
          <Button onClick={() => navigate({ to: "/login" })} className="w-full">
            Sign in
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={step === "email" ? "Reset your password" : "Enter your reset code"}
      description={step === "email"
        ? "We'll send a 6-digit code to your email"
        : `Code sent to ${email} — enter it below`}
      footer={
        <Link to="/login" className="text-blue-500 hover:text-blue-400 font-medium">
          Back to sign in
        </Link>
      }
    >
      {step === "email" ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Email address</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              autoComplete="email"
            />
          </div>
          {auth.isMockMode && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2 text-xs text-blue-400">
              Dev mode — reset code will be <strong>654321</strong>
            </div>
          )}
          <Button type="submit" disabled={loading} className="w-full gap-2">
            <KeyRound size={15} />
            {loading ? "Sending code…" : "Send reset code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Verification code</label>
            <Input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">New password</label>
            <div className="relative">
              <Input
                type={showPwd ? "text" : "password"}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
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
            {newPwd && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1">
                <PasswordRule met={rules.length} label="At least 8 characters" />
                <PasswordRule met={rules.upper} label="Uppercase letter" />
                <PasswordRule met={rules.lower} label="Lowercase letter" />
                <PasswordRule met={rules.number} label="Number" />
                <PasswordRule met={rules.symbol} label="Special character" />
              </div>
            )}
          </div>
          <Button type="submit" disabled={loading || !passwordValid} className="w-full gap-2">
            <KeyRound size={15} />
            {loading ? "Resetting…" : "Set new password"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
