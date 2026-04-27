/**
 * Shared shell for all auth pages (login, signup, verify, forgot-password).
 * Keeps branding consistent and centered.
 */
import { Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

interface AuthShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md";
}

export function AuthShell({ title, description, children, footer, width = "sm" }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-purple-600/5 pointer-events-none" />

      <div className={cn("w-full relative z-10", width === "sm" ? "max-w-sm" : "max-w-md")}>
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Link to="/login" className="flex items-center gap-2.5 group">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white shadow-lg group-hover:shadow-blue-500/25 transition-shadow">
              <Sparkles size={22} />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">Career Jump</div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">Private job radar</div>
            </div>
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl overflow-hidden">
          <div className="px-7 pt-7 pb-5 border-b border-[hsl(var(--border))]">
            <h1 className="text-xl font-bold">{title}</h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">{description}</p>
          </div>
          <div className="px-7 py-6">
            {children}
          </div>
        </div>

        {/* Footer links */}
        {footer && (
          <div className="mt-5 text-center text-sm text-[hsl(var(--muted-foreground))]">
            {footer}
          </div>
        )}

        {/* Legal */}
        <p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]/60">
          By continuing, you agree to our{" "}
          <Link to="/privacy" className="underline hover:text-[hsl(var(--foreground))]">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
