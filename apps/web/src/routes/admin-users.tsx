import { type ReactNode, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Search, UserX, UserCheck, Crown, Building2, Mail, Copy } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAdminUser, useAdminUsers, useSetAdminUserPlan, useSetAdminUserStatus } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";
import { relativeTime } from "@/lib/format";
import { toast } from "@/components/ui/toast";

export const Route = createFileRoute("/admin-users")({ component: AdminUsersRoute });

const PLAN_OPTIONS = ["free", "starter", "pro", "power"] as const;

export function AdminUsersRoute() {
  const { data: me } = useMe();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const isAdmin = me?.actor?.isAdmin === true;
  // Keep the admin-user queries dormant until the session is confirmed to be
  // an admin so non-admin visits do not spray avoidable 403 traffic.
  const { data } = useAdminUsers(query, isAdmin);
  const { data: selected } = useAdminUser(selectedUserId, isAdmin);
  const setStatus = useSetAdminUserStatus(selectedUserId);
  const setPlan = useSetAdminUserPlan(selectedUserId);

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Users" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="User Management" subtitle="Search by email or user ID and manage account status." />
      <AdminPageFrame
        currentLabel="Users"
        currentPath={location.pathname}
        eyebrow="Account Ops"
        title="Inspect account health and user state quickly"
        description="This page stays tuned for operational debugging: plan, tenant, notification state, and support history in one inspectable admin panel."
      >
        <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Search size={16} /> Search Users</CardTitle>
              <CardDescription>{data?.total ?? 0} result(s)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email or user ID" />
              <div className="space-y-2">
                {(data?.users ?? []).map((user) => (
                  <button
                    key={user.userId}
                    type="button"
                    onClick={() => setSelectedUserId(user.userId)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedUserId === user.userId ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))]/40"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{user.displayName}</div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">{user.email}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">{user.accountStatus}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">{user.plan}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{selected?.profile?.displayName || "Select a user"}</CardTitle>
              <CardDescription>{selected?.profile?.email || "View plan, settings, and support history."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {selected?.profile ? (
                <>
                  {/* Lead with the user summary so the operator can orient
                      before making plan or account-state changes. */}
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <AdminStatCard
                      icon={<Crown size={15} />}
                      label="Current plan"
                      value={selected.billing.plan}
                      hint={`Provider: ${selected.billing.provider}`}
                    />
                    <AdminStatCard
                      icon={<UserCheck size={15} />}
                      label="Account status"
                      value={selected.profile.accountStatus}
                      hint={`Last login ${relativeTime(selected.profile.lastLoginAt)}`}
                    />
                    <AdminStatCard
                      icon={<Building2 size={15} />}
                      label="Tracked companies"
                      value={String(selected.settings.trackedCompanies.length)}
                      hint={selected.settings.weeklyDigest ? "Weekly digest on" : "Weekly digest off"}
                    />
                    <AdminStatCard
                      icon={<Mail size={15} />}
                      label="Notifications"
                      value={selected.settings.emailNotifications ? "Enabled" : "Muted"}
                      hint={`Joined ${relativeTime(selected.profile.joinedAt)}`}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-[hsl(var(--border))] p-4">
                      <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">Account</div>
                      <div className="mt-2 text-sm">Plan: {selected.profile.plan}</div>
                      <div className="text-sm">Billing plan: {selected.billing.plan}</div>
                      <div className="text-sm">Status: {selected.profile.accountStatus}</div>
                      <div className="text-sm">Joined: {relativeTime(selected.profile.joinedAt)}</div>
                      <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Tenant ID</div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-[hsl(var(--foreground))] hover:underline cursor-copy"
                        onClick={() => {
                          navigator.clipboard.writeText(selected.profile.tenantId);
                          toast("Tenant ID copied");
                        }}
                        title="Click to copy"
                      >
                        <Copy size={12} />
                        {selected.profile.tenantId}
                      </button>
                    </div>
                    <div className="rounded-lg border border-[hsl(var(--border))] p-4">
                      <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">Notifications</div>
                      <div className="mt-2 text-sm">Email: {selected.settings.emailNotifications ? "On" : "Off"}</div>
                      <div className="text-sm">Weekly digest: {selected.settings.weeklyDigest ? "On" : "Off"}</div>
                      <div className="text-sm">Tracked companies: {selected.settings.trackedCompanies.length}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--border))] p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">Subscription tier override</div>
                        <div className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                          Move this user between any supported subscription tier without editing records by hand.
                        </div>
                      </div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        Active tier: <span className="font-semibold uppercase tracking-[0.16em] text-[hsl(var(--foreground))]">{selected.billing.plan}</span>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                      {PLAN_OPTIONS.map((plan) => {
                        const active = selected.billing.plan === plan;
                        return (
                          <button
                            key={plan}
                            type="button"
                            disabled={setPlan.isPending}
                            className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                              active
                                ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70 text-[hsl(var(--foreground))]"
                                : "border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))]/35"
                            } ${setPlan.isPending ? "opacity-60" : ""}`}
                            onClick={() => {
                              if (active) return;
                              setPlan.mutate(plan, {
                                onSuccess: () => toast(`User moved to ${plan}`),
                                onError: (error) => toast(error instanceof Error ? error.message : "Plan update failed", "error"),
                              });
                            }}
                          >
                            <div className="text-xs uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">{plan}</div>
                            <div className="mt-2 text-sm font-medium">
                              {active ? "Current subscription tier" : "Set as active tier"}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {selected.profile.accountStatus === "active" ? (
                      <Button variant="warning" onClick={() => setStatus.mutate("suspended")} disabled={setStatus.isPending}>
                        <UserX size={14} /> Suspend account
                      </Button>
                    ) : (
                      <Button variant="success" onClick={() => setStatus.mutate("active")} disabled={setStatus.isPending}>
                        <UserCheck size={14} /> Reactivate account
                      </Button>
                    )}
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--border))] p-4">
                    <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">Tickets</div>
                    <div className="mt-3 space-y-2">
                      {selected.tickets.map((ticket) => (
                        <div key={ticket.ticketId} className="rounded-md bg-[hsl(var(--accent))]/40 px-3 py-2 text-sm">
                          <div className="font-medium">{ticket.subject}</div>
                          <div className="text-xs text-[hsl(var(--muted-foreground))]">{ticket.status} · {relativeTime(ticket.updatedAt)}</div>
                        </div>
                      ))}
                      {!selected.tickets.length && <div className="text-sm text-[hsl(var(--muted-foreground))]">No support tickets for this user.</div>}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-sm text-[hsl(var(--muted-foreground))]">Select a user from the list to inspect their account.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </AdminPageFrame>
    </>
  );
}

function AdminStatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
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
      <div className="mt-2 text-lg font-semibold capitalize">{value}</div>
      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{hint}</div>
    </div>
  );
}
