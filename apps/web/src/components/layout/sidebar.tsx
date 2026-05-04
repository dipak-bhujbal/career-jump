import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { LayoutDashboard, Briefcase, CheckSquare, Target, Settings, Sparkles, User, LogOut, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarActions } from "./sidebar-actions";
import { useAuth } from "@/features/auth/AuthContext";
import { getAuthDisplayName } from "@/features/auth/display";
import { useProfile } from "@/features/profile/useProfile";
import { useMe } from "@/features/session/queries";
import { Button } from "@/components/ui/button";
import { UpgradePrompt } from "@/features/billing/upgrade";
import { planIntervalLabel, planPricePlaceholders } from "@/features/billing/plan-display";

const userItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/jobs", label: "Available Jobs", icon: Briefcase },
  { to: "/applied", label: "Applied Jobs", icon: CheckSquare },
  { to: "/plan", label: "Action Plan", icon: Target },
  // Support now lives inside Profile so the primary nav stays focused on the
  // daily job-tracking workflow.
  { to: "/configuration", label: "Configuration", icon: Settings },
];

const adminItems = [
  { to: "/admin", label: "Admin", icon: Shield },
];

export function Sidebar() {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const { profile } = useProfile();
  const { data: me } = useMe();
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);
  const isAdmin = me?.actor?.isAdmin === true;
  const actorKnown = Boolean(me?.actor);
  const items = isAdmin ? adminItems : actorKnown ? userItems : [];
  const footerTarget = isAdmin ? "/admin" : "/profile";
  const currentPlan = me?.billing?.plan ?? me?.profile?.plan ?? "free";
  const pageHasPrimaryUpgradeBanner = ["/", "/jobs", "/applied", "/plan", "/configuration"].some((routePath) =>
    routePath === "/" ? pathname === routePath : pathname.startsWith(routePath),
  );
  const showUpgradeRail = (currentPlan === "free" || currentPlan === "starter") && !pageHasPrimaryUpgradeBanner;

  // Prefer the user-saved profile username; fall back to auth identity.
  const displayName = profile.username !== "User" ? profile.username : getAuthDisplayName(user);
  const initial = (displayName[0] ?? "U").toUpperCase();

  return (
    <aside className="w-60 shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]/40 backdrop-blur flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-[hsl(var(--border))]">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white shadow-sm shrink-0">
          <Sparkles size={18} />
        </div>
        <div>
          <div className="font-semibold text-sm">Career Jump</div>
          <div className="text-[12.5px] text-[hsl(var(--muted-foreground))]">Private job radar</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="min-h-0 p-2 flex flex-col gap-0.5 flex-1 overflow-y-auto">
        {items.map((it) => {
          const active = pathname === it.to || (it.to !== "/" && pathname.startsWith(it.to));
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--foreground))] font-medium"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/60 hover:text-[hsl(var(--foreground))]",
              )}
            >
              <Icon size={16} />
              {it.label}
            </Link>
          );
        })}
      </nav>

      {showUpgradeRail ? (
        <div className="px-3 pb-3">
          {/* Keep one persistent upgrade entry in the shell so the billing path
              is visible immediately after login on every authenticated route. */}
          <div className="rounded-2xl border border-amber-500/35 bg-[linear-gradient(180deg,rgba(251,191,36,0.18),rgba(255,255,255,0.92))] p-3 text-sm shadow-sm dark:bg-[linear-gradient(180deg,rgba(245,158,11,0.14),rgba(17,24,39,0.95))]">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-50">
              <Sparkles size={15} />
              <span className="font-semibold">Upgrade your search</span>
            </div>
            <p className="mt-2 text-xs leading-5 text-amber-900/85 dark:text-amber-100/85">
              Entry tiers are best for getting started. Unlock more tracked companies, more visible jobs, and a larger applied pipeline.
            </p>
            <div className="mt-3 space-y-1 text-xs text-amber-950/80 dark:text-amber-100/80">
              <div className="flex items-center justify-between">
                <span>Starter</span>
                <span>{planPricePlaceholders.starter}{planIntervalLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pro</span>
                <span>{planPricePlaceholders.pro}{planIntervalLabel}</span>
              </div>
            </div>
            <Button size="sm" className="mt-3 w-full" onClick={() => setUpgradePromptOpen(true)}>
              Compare plans
            </Button>
          </div>
        </div>
      ) : null}

      {actorKnown && !isAdmin ? <SidebarActions /> : null}

      {/* Keep the footer target aligned with the active shell so admins do not
          bounce back into user-only profile flows after the split. */}
      <div className="p-3 border-t border-[hsl(var(--border))]">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 group">
          <Link
            to={footerTarget}
            className="flex items-center gap-2.5 flex-1 min-w-0 hover:opacity-80 transition-opacity"
          >
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white text-xs font-bold shrink-0">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate">{displayName}</div>
              <div className="text-[11px] text-[hsl(var(--muted-foreground))] truncate">{user?.email || ""}</div>
            </div>
            <User size={13} className="shrink-0 text-[hsl(var(--muted-foreground))]" />
          </Link>
          <button
            type="button"
            onClick={() => { if (window.confirm("Sign out?")) signOut(); }}
            title="Sign out"
            className="shrink-0 text-[hsl(var(--muted-foreground))] hover:text-rose-500 transition-colors p-1"
          >
            <LogOut size={13} />
          </button>
        </div>
      </div>
      <UpgradePrompt
        open={upgradePromptOpen}
        onClose={() => setUpgradePromptOpen(false)}
        currentPlan={currentPlan}
        title="Upgrade for more pipeline headroom"
        body="Compare the current pricing tiers and choose the plan that matches the search volume and pipeline size you want to run."
      />
    </aside>
  );
}
