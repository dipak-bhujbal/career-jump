import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Search, UserX, UserCheck } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAdminUser, useAdminUsers, useSetAdminUserStatus } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/admin-users")({ component: AdminUsersRoute });

function AdminUsersRoute() {
  const { data: me } = useMe();
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { data } = useAdminUsers(query);
  const { data: selected } = useAdminUser(selectedUserId);
  const setStatus = useSetAdminUserStatus(selectedUserId);

  if (!me?.actor?.isAdmin) {
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
      <div className="p-6 grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
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
                    <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">{user.accountStatus}</div>
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
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-[hsl(var(--border))] p-4">
                    <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">Account</div>
                    <div className="mt-2 text-sm">Plan: {selected.profile.plan}</div>
                    <div className="text-sm">Status: {selected.profile.accountStatus}</div>
                    <div className="text-sm">Joined: {relativeTime(selected.profile.joinedAt)}</div>
                    <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Tenant ID</div>
                    <button
                      type="button"
                      className="font-mono text-xs text-[hsl(var(--foreground))] hover:underline cursor-copy"
                      onClick={() => navigator.clipboard.writeText(selected.profile.tenantId)}
                      title="Click to copy"
                    >
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
    </>
  );
}

