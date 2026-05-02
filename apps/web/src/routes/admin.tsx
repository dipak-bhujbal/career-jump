import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { Shield, Users, LifeBuoy, Flag, BarChart3, SlidersHorizontal, CreditCard, BellRing, BookOpen, Database, AlertTriangle } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminSummary } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/admin")({ component: AdminRoute });

function AdminRoute() {
  const { data: me } = useMe();
  const isAdmin = me?.actor?.isAdmin === true;
  const { data } = useAdminSummary(isAdmin);
  const location = useLocation();
  if (!isAdmin) {
    return (
      <>
        <Topbar title="Admin" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  const cards = [
    { to: "/admin-users", title: "Users", value: data?.users.total ?? 0, meta: `${data?.users.active ?? 0} active`, icon: Users },
    { to: "/admin-support", title: "Support Queue", value: data?.support.totalTickets ?? 0, meta: `${data?.support.openTickets ?? 0} open`, icon: LifeBuoy },
    { to: "/logs", title: "Logs", value: "Admin only", meta: "User-filterable audit view", icon: Shield },
    { to: "/admin-flags", title: "Feature Flags", value: data?.featureFlags.length ?? 0, meta: "Rollout controls", icon: Flag },
    // Keep plan policy one click away from the admin workspace so pricing
    // operations do not require a hidden direct route.
    { to: "/admin-plan-config", title: "Plan Config", value: "Policy", meta: "Pricing and entitlement controls", icon: SlidersHorizontal },
    { to: "/admin-stripe-config", title: "Stripe Config", value: "Billing", meta: "Checkout and price IDs", icon: CreditCard },
    { to: "/admin-announcements", title: "Announcements", value: me?.announcements?.length ?? 0, meta: "Live user-facing banner inventory", icon: BellRing },
    { to: "/admin-docs", title: "Docs", value: "OpenAPI", meta: "Embedded Swagger reference for admins", icon: BookOpen },
    { to: "/admin-registry-status", title: "Registry Status", value: data?.registry.currentCompanies ?? 0, meta: "Per-company scan coverage and freshness", icon: Database },
    { to: "/admin-company-configs", title: "Company Configs", value: data?.registry.totalCompanies ?? 0, meta: "Retrieve and edit live registry company rows", icon: Database },
    { to: "/admin-actions-needed", title: "Actions Needed", value: "Review", meta: "Failed registry companies and follow-up queue", icon: AlertTriangle },
    // Keep analytics visible from the main admin workspace so operators do not
    // need to know the direct route to reach the new reporting surface.
    { to: "/admin-analytics", title: "Analytics", value: "30d", meta: "Growth, usage, and health", icon: BarChart3 },
  ];

  return (
    <>
      <Topbar title="Admin Workspace" subtitle="Operations, support, and audit controls." />
      <AdminPageFrame
        currentLabel="Overview"
        currentPath={location.pathname}
        eyebrow="Admin Operations"
        title="Run the product from one place"
        description="Use this workspace as the operational control room for plan policy, billing, support, rollout safety, live announcements, and admin diagnostics."
        actions={(
          <Link
            to="/admin-docs"
            className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--accent))]/35"
          >
            <BookOpen size={15} />
            Open Admin Docs
          </Link>
        )}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.to} to={card.to}>
                <Card className="h-full hover:bg-[hsl(var(--accent))]/40 transition-colors">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Icon size={16} /> {card.title}</CardTitle>
                    <CardDescription>{card.meta}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">{card.value}</div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </AdminPageFrame>
    </>
  );
}
