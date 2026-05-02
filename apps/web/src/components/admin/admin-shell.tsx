import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  BellRing,
  BarChart3,
  BookOpen,
  CreditCard,
  Database,
  Flag,
  AlertTriangle,
  LayoutDashboard,
  LifeBuoy,
  ScrollText,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AdminNavItem = {
  to: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
};

export const adminNavItems: AdminNavItem[] = [
  {
    to: "/admin",
    label: "Overview",
    description: "Operational landing page and shortcuts.",
    icon: LayoutDashboard,
  },
  {
    to: "/admin-plan-config",
    label: "Plan Config",
    description: "Pricing, scan, and entitlement policy.",
    icon: SlidersHorizontal,
  },
  {
    to: "/admin-stripe-config",
    label: "Stripe Config",
    description: "Billing keys, webhooks, and price IDs.",
    icon: CreditCard,
  },
  {
    to: "/admin-announcements",
    label: "Announcements",
    description: "Persistent user-facing banners and targeting.",
    icon: BellRing,
  },
  {
    to: "/admin-docs",
    label: "Docs",
    description: "Admin-facing Swagger and API reference.",
    icon: BookOpen,
  },
  {
    to: "/admin-registry-status",
    label: "Registry Status",
    description: "Per-company current job counts and last scan time.",
    icon: Database,
  },
  {
    to: "/admin-actions-needed",
    label: "Actions Needed",
    description: "Failed registry companies that need operator follow-up.",
    icon: AlertTriangle,
  },
  {
    to: "/admin-analytics",
    label: "Analytics",
    description: "Growth, usage, and scan-health reporting.",
    icon: BarChart3,
  },
  {
    to: "/admin-users",
    label: "Users",
    description: "Account review and lifecycle controls.",
    icon: Users,
  },
  {
    to: "/admin-support",
    label: "Support",
    description: "Ticket response workflow.",
    icon: LifeBuoy,
  },
  {
    to: "/logs",
    label: "Logs",
    description: "Audit trail and run-level evidence.",
    icon: ScrollText,
  },
  {
    to: "/admin-flags",
    label: "Flags",
    description: "Feature rollout controls.",
    icon: Flag,
  },
];

function normalizePath(pathname: string): string {
  if (pathname === "/logs") return "/logs";
  return pathname.replace(/\/+$/, "") || "/";
}

export function AdminBreadcrumb({
  currentLabel,
  currentPath,
}: {
  currentLabel: string;
  currentPath: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
      <Link to="/admin" className="font-medium text-[hsl(var(--foreground))] hover:underline">
        Admin
      </Link>
      <span>/</span>
      <span>{currentLabel}</span>
      <span className="rounded-full border border-[hsl(var(--border))] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]">
        {normalizePath(currentPath)}
      </span>
    </div>
  );
}

export function AdminSectionNav({ currentPath }: { currentPath: string }) {
  const normalizedCurrentPath = normalizePath(currentPath);

  return (
    <div className="flex flex-wrap gap-2">
      {adminNavItems.map((item) => {
        const active = normalizePath(item.to) === normalizedCurrentPath;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.16em] transition-colors",
              active
                ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70 text-[hsl(var(--foreground))]"
                : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/35",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function AdminPageFrame({
  currentLabel,
  currentPath,
  title,
  description,
  eyebrow,
  actions,
  children,
}: {
  currentLabel: string;
  currentPath: string;
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-6 space-y-6">
      <Card className="overflow-hidden border-[hsl(var(--border))] bg-[linear-gradient(135deg,hsla(var(--accent),0.22),transparent_68%)]">
        <CardContent className="space-y-5 p-6">
          <AdminBreadcrumb currentLabel={currentLabel} currentPath={currentPath} />
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              {eyebrow ? (
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[hsl(var(--muted-foreground))]">
                  {eyebrow}
                </div>
              ) : null}
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
                <p className="max-w-3xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                  {description}
                </p>
              </div>
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
          <AdminSectionNav currentPath={currentPath} />
        </CardContent>
      </Card>

      {children}
    </div>
  );
}
