import { createFileRoute, Link } from "@tanstack/react-router";
import { Shield, Users, LifeBuoy, Flag } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminSummary } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/admin")({ component: AdminRoute });

function AdminRoute() {
  const { data: me } = useMe();
  const { data } = useAdminSummary();
  if (!me?.actor?.isAdmin) {
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
  ];

  return (
    <>
      <Topbar title="Admin Workspace" subtitle="Operations, support, and audit controls." />
      <div className="p-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
    </>
  );
}

