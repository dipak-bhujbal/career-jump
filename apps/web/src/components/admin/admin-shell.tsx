import { type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  BellRing,
  BarChart3,
  BookOpen,
  CreditCard,
  Flag,
  LayoutDashboard,
  LifeBuoy,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {adminNavItems.map((item) => {
        const Icon = item.icon;
        const active = normalizePath(item.to) === normalizedCurrentPath;

        return (
          <Link key={item.to} to={item.to}>
            <Card className={cn(
              "h-full border transition-colors",
              active
                ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70"
                : "hover:bg-[hsl(var(--accent))]/35",
            )}>
              <CardHeader className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Icon size={15} />
                  {item.label}
                </div>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
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
