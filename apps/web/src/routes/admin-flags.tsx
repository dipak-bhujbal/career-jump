import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Flag, Users, ShieldCheck, Gauge } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFeatureFlags, useSaveFeatureFlag } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/admin-flags")({ component: AdminFlagsRoute });

function AdminFlagsRoute() {
  const { data: me } = useMe();
  const location = useLocation();
  const { data } = useFeatureFlags();
  const saveFlag = useSaveFeatureFlag();
  const flags = data?.featureFlags ?? [];
  const enabledCount = flags.filter((flag) => flag.enabled).length;
  const targetedFlags = flags.filter((flag) => flag.enabledForUsers.length > 0 || flag.enabledForPlans.length > 0).length;
  const averageRollout = flags.length > 0
    ? Math.round(flags.reduce((sum, flag) => sum + flag.rolloutPercent, 0) / flags.length)
    : 0;

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Feature Flags" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Feature Flags" subtitle="Launch controls for scan layers and product features." />
      <AdminPageFrame
        currentLabel="Flags"
        currentPath={location.pathname}
        eyebrow="Rollout Safety"
        title="Flip rollout controls from a dedicated launch surface"
        description="Feature flags stay intentionally operational here: a fast on/off view with rollout context so releases do not depend on hidden environment switches."
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FlagSummaryCard
              icon={<Flag size={15} />}
              label="Total flags"
              value={String(flags.length)}
              hint="All launch controls currently defined."
            />
            <FlagSummaryCard
              icon={<ShieldCheck size={15} />}
              label="Enabled now"
              value={String(enabledCount)}
              hint="Flags actively changing runtime behavior."
            />
            <FlagSummaryCard
              icon={<Users size={15} />}
              label="Targeted flags"
              value={String(targetedFlags)}
              hint="Scoped by plans or specific users."
            />
            <FlagSummaryCard
              icon={<Gauge size={15} />}
              label="Avg rollout"
              value={`${averageRollout}%`}
              hint="Simple pulse-check across all flags."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
          {flags.map((flag) => (
            <Card key={flag.flagName}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Flag size={16} /> {flag.flagName}</CardTitle>
                <CardDescription>{flag.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summarize rollout shape before the operator flips the flag so
                    the page reads like a launch console, not just a toggle list. */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">Status</div>
                    <div className="mt-2 text-sm font-semibold">{flag.enabled ? "Enabled" : "Disabled"}</div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">Rollout</div>
                    <div className="mt-2 text-sm font-semibold">{flag.rolloutPercent}%</div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">Audience</div>
                    <div className="mt-2 text-sm font-semibold">
                      {flag.enabledForUsers.length > 0 ? "User-targeted" : flag.enabledForPlans.length > 0 ? "Plan-targeted" : "Global"}
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-3 text-sm">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">Enabled plans</div>
                    <div className="mt-2">
                      {flag.enabledForPlans.length > 0 ? flag.enabledForPlans.join(", ") : "All plans"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-3 text-sm">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">Specific users</div>
                    <div className="mt-2 break-all">
                      {flag.enabledForUsers.length > 0 ? `${flag.enabledForUsers.length} targeted user${flag.enabledForUsers.length === 1 ? "" : "s"}` : "No user-only targeting"}
                    </div>
                  </div>
                </div>
                <Button
                  variant={flag.enabled ? "warning" : "success"}
                  onClick={() => saveFlag.mutate({
                    ...flag,
                    enabled: !flag.enabled,
                    enabledForPlans: flag.enabledForPlans,
                    enabledForUsers: flag.enabledForUsers,
                  })}
                  disabled={saveFlag.isPending}
                >
                  {flag.enabled ? "Disable" : "Enable"}
                </Button>
              </CardContent>
            </Card>
          ))}
          </div>
        </div>
      </AdminPageFrame>
    </>
  );
}

function FlagSummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{hint}</div>
    </div>
  );
}
