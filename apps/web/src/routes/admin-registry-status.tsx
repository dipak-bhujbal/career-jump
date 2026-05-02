import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/features/session/queries";
import { useAdminRegistryStatus } from "@/features/support/queries";

export const Route = createFileRoute("/admin-registry-status")({ component: AdminRegistryStatusRoute });

export function AdminRegistryStatusRoute() {
  const { data: me } = useMe();
  const isAdmin = me?.actor?.isAdmin === true;
  const { data, isLoading } = useAdminRegistryStatus(isAdmin);
  const location = useLocation();

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Registry Status" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Registry Status" subtitle="Per-company raw inventory coverage and freshness." />
      <AdminPageFrame
        currentLabel="Registry Status"
        currentPath={location.pathname}
        eyebrow="Registry Operations"
        title="Inspect the shared registry scan inventory"
        description="Review how many jobs each registry company currently has in Dynamo, which companies have an active raw snapshot, and when each company was last refreshed."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Registry companies"
            value={(data?.totals.totalCompanies ?? 0).toLocaleString()}
            meta="Total companies tracked in the registry table"
          />
          <StatCard
            label="Currently scanned"
            value={(data?.totals.currentCompanies ?? 0).toLocaleString()}
            meta="Companies with a current raw snapshot in Dynamo"
          />
          <StatCard
            label="Current raw jobs"
            value={(data?.totals.currentJobs ?? 0).toLocaleString()}
            meta={data?.totals.lastScannedAt ? `Latest refresh ${new Date(data.totals.lastScannedAt).toLocaleString()}` : "No scans recorded yet"}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database size={16} />
              Company scan status
            </CardTitle>
            <CardDescription>
              Each row shows the registry identifier, current shared job count, and last successful scan timestamp for that company.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                    <th className="px-3 py-2">Registry ID</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">ATS</th>
                    <th className="px-3 py-2">Current Jobs</th>
                    <th className="px-3 py-2">Last Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.rows ?? []).map((row) => (
                    <tr key={row.registryId} className="border-b border-[hsl(var(--border))]/60 align-top">
                      <td className="px-3 py-2 font-mono text-[12px] text-[hsl(var(--muted-foreground))]">{row.registryId}</td>
                      <td className="px-3 py-2 font-medium">{row.company}</td>
                      <td className="px-3 py-2">{row.ats ?? "Unknown"}</td>
                      <td className="px-3 py-2">{row.totalJobs.toLocaleString()}</td>
                      <td className="px-3 py-2">{row.lastScannedAt ? new Date(row.lastScannedAt).toLocaleString() : "Not scanned yet"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isLoading && (data?.rows.length ?? 0) === 0 ? (
              <div className="px-3 py-6 text-sm text-[hsl(var(--muted-foreground))]">
                No registry companies are available yet.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </AdminPageFrame>
    </>
  );
}

function StatCard({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-[hsl(var(--muted-foreground))]">
        {meta}
      </CardContent>
    </Card>
  );
}
