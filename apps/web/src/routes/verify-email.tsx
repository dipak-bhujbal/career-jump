import { useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { MailCheck, RefreshCw } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/AuthContext";
import { auth } from "@/lib/auth";

export const Route = createFileRoute("/verify-email")({
  validateSearch: (s: Record<string, unknown>) => ({ email: (s.email as string) ?? "" }),
  component: VerifyEmailRoute,
});

function VerifyEmailRoute() {
  const { email } = Route.useSearch();
  const { confirmSignUp, resendConfirmationCode } = useAuth();
  const navigate = useNavigate();

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);

  const code = digits.join("");

  function handleDigit(index: number, value: string) {
    const char = value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (char && index < 5) inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(""));
      inputs.current[5]?.focus();
      e.preventDefault();
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError("Enter the 6-digit code"); return; }
    setError("");
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      void navigate({ to: "/login", search: {} });
    } catch (err) {
      const ae = err as { message?: string };
      setError(ae.message ?? "Verification failed. Check the code and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError("");
    setResending(true);
    try {
      await resendConfirmationCode(email);
      setResent(true);
      setDigits(["", "", "", "", "", ""]);
      inputs.current[0]?.focus();
      setTimeout(() => setResent(false), 4000);
    } catch (err) {
      const ae = err as { message?: string };
      setError(ae.message ?? "Could not resend code. Try again shortly.");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Verify your email"
      description={email ? `We sent a 6-digit code to ${email}` : "Enter the verification code from your email"}
      footer={
        <>
          Wrong email?{" "}
          <Link to="/signup" className="text-blue-500 hover:text-blue-400 font-medium">Go back</Link>
        </>
      }
    >
      <form onSubmit={handleVerify} className="space-y-5">
        <div className="flex items-center justify-center py-2">
          <div className="h-14 w-14 rounded-2xl bg-blue-500/10 grid place-items-center text-blue-500">
            <MailCheck size={28} />
          </div>
        </div>

        {auth.isMockMode && (
          <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 px-3 py-2 text-xs text-blue-400 text-center">
            Dev mode — use code <strong>123456</strong>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-sm text-rose-400 text-center">
            {error}
          </div>
        )}

        {resent && (
          <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-3 py-2 text-sm text-green-400 text-center">
            New code sent! Check your inbox.
          </div>
        )}

        {/* 6-digit code input */}
        <div className="flex gap-2 justify-center" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <Input
              key={i}
              ref={(el) => { inputs.current[i] = el; }}
              value={d}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              maxLength={1}
              inputMode="numeric"
              className="w-11 h-12 text-center text-xl font-bold p-0"
              autoFocus={i === 0}
            />
          ))}
        </div>

        <Button type="submit" disabled={loading || code.length !== 6} className="w-full gap-2">
          <MailCheck size={15} />
          {loading ? "Verifying…" : "Verify email"}
        </Button>

        <div className="text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending}
            className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={resending ? "animate-spin" : ""} />
            {resending ? "Sending…" : "Resend code"}
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
