import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Flag } from "lucide-react";
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
        <div className="grid gap-4 lg:grid-cols-2">
          {(data?.featureFlags ?? []).map((flag) => (
            <Card key={flag.flagName}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Flag size={16} /> {flag.flagName}</CardTitle>
                <CardDescription>{flag.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-[hsl(var(--muted-foreground))]">Rollout: {flag.rolloutPercent}%</div>
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
      </AdminPageFrame>
    </>
  );
}
