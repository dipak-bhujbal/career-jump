import { useState, type ReactNode } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useAdminAnalyticsFeatureUsage,
  useAdminAnalyticsGrowth,
  useAdminAnalyticsMarketIntel,
  useAdminAnalyticsSystemHealth,
} from "@/features/support/queries";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/admin-analytics")({ component: AdminAnalyticsRoute });

type AnalyticsTab = "growth" | "market-intel" | "feature-usage" | "system-health";

type AnalyticsEnvelopeLike = {
  cachedAt: string;
  cacheExpiresAt: string;
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return Intl.NumberFormat("en-US").format(value);
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-sm transition-colors ${
        active
          ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]"
          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/50"
      }`}
    >
      {label}
    </button>
  );
}

function StatCard({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {detail ? <CardDescription>{detail}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function TableCard({
  title,
  description,
  headers,
  rows,
  emptyMessage,
}: {
  title: string;
  description: string;
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-left text-[hsl(var(--muted-foreground))]">
                  {headers.map((header) => (
                    <th key={header} className="px-3 py-2 font-medium">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${title}-${index}`} className="border-b border-[hsl(var(--border))]/60 last:border-b-0">
                    {row.map((cell, cellIndex) => (
                      <td key={`${title}-${index}-${cellIndex}`} className="px-3 py-2 align-top">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-[hsl(var(--muted-foreground))]">{emptyMessage}</div>
        )}
      </CardContent>
    </Card>
  );
}

function EnvelopeMeta({ envelope }: { envelope: AnalyticsEnvelopeLike }) {
  return (
    <div className="text-xs text-[hsl(var(--muted-foreground))]">
      Cached {formatDateTime(envelope.cachedAt)} · Expires {formatDateTime(envelope.cacheExpiresAt)}
    </div>
  );
}

function PanelState({
  isLoading,
  error,
  children,
}: {
  isLoading: boolean;
  error: Error | null;
  children: ReactNode;
}) {
  if (isLoading) {
    return <Card><CardContent className="py-6 text-sm text-[hsl(var(--muted-foreground))]">Loading analytics…</CardContent></Card>;
  }
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-rose-600">Failed to load analytics: {error.message}</CardContent></Card>;
  }
  return <>{children}</>;
}

function GrowthPanel() {
  const query = useAdminAnalyticsGrowth();
  const envelope = query.data;
  const signups = [...(envelope?.data.signupsPerDay ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <PanelState isLoading={query.isLoading} error={query.error}>
      {envelope ? (
        <div className="space-y-4">
          <EnvelopeMeta envelope={envelope} />
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard title="Activation Rate" value={formatPercent(envelope.data.activationRate)} />
            <StatCard title="Median Hours To First Scan" value={formatNumber(envelope.data.medianHoursToFirstScan)} />
            <StatCard title="Churn Signal Count" value={formatNumber(envelope.data.churnSignalCount)} />
          </div>
          <TableCard
            title="Signups Per Day"
            description="Most recent signups in the rolling 30-day window."
            headers={["Date", "Count"]}
            rows={signups.map((row) => [row.date, formatNumber(row.count)])}
            emptyMessage="No signup events in the current analytics window."
          />
        </div>
      ) : null}
    </PanelState>
  );
}

function MarketIntelPanel() {
  const query = useAdminAnalyticsMarketIntel();
  const envelope = query.data;
  const companies = (envelope?.data.mostScannedCompanies ?? []).slice(0, 20);
  const volume = [...(envelope?.data.scanVolumePerDay ?? [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <PanelState isLoading={query.isLoading} error={query.error}>
      {envelope ? (
        <div className="space-y-4">
          <EnvelopeMeta envelope={envelope} />
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard title="Scan Failure Rate" value={formatPercent(envelope.data.scanFailureRate)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <TableCard
              title="Most Scanned Companies"
              description="Top 20 company demand signals from admin analytics."
              headers={["Rank", "Company", "Views"]}
              rows={companies.map((row, index) => [String(index + 1), row.company, formatNumber(row.scanCount)])}
              emptyMessage="No company demand signals were recorded in the current window."
            />
            <TableCard
              title="Scan Volume Per Day"
              description="Completed run counts by day."
              headers={["Date", "Runs"]}
              rows={volume.map((row) => [row.date, formatNumber(row.count)])}
              emptyMessage="No completed runs were recorded in the current window."
            />
          </div>
        </div>
      ) : null}
    </PanelState>
  );
}

function FeatureUsagePanel() {
  const query = useAdminAnalyticsFeatureUsage();
  const envelope = query.data;

  return (
    <PanelState isLoading={query.isLoading} error={query.error}>
      {envelope ? (
        <div className="space-y-4">
          <EnvelopeMeta envelope={envelope} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Total Runs Last 30d" value={formatNumber(envelope.data.totalRunsLast30d)} />
            <StatCard title="Run Duration P50" value={formatNumber(envelope.data.runDurationP50Ms)} detail="Milliseconds" />
            <StatCard title="Run Duration P95" value={formatNumber(envelope.data.runDurationP95Ms)} detail="Milliseconds" />
            <StatCard title="Job Viewed Count" value={formatNumber(envelope.data.jobViewedCount)} />
          </div>
          <TableCard
            title="Scan Failures By Layer"
            description="Terminal scan failures grouped by Workday layer."
            headers={["Layer", "Count"]}
            rows={envelope.data.scanFailuresByLayer.map((row) => [row.layer, formatNumber(row.count)])}
            emptyMessage="No scan failures were recorded in the current window."
          />
        </div>
      ) : null}
    </PanelState>
  );
}

function SystemHealthPanel() {
  const query = useAdminAnalyticsSystemHealth();
  const envelope = query.data;

  return (
    <PanelState isLoading={query.isLoading} error={query.error}>
      {envelope ? (
        <div className="space-y-4">
          <EnvelopeMeta envelope={envelope} />
          <div className="grid gap-4 xl:grid-cols-2">
            <TableCard
              title="Scan Failures By Reason"
              description="Most common failure categories in the current window."
              headers={["Reason", "Count"]}
              rows={envelope.data.scanFailuresByReason.map((row) => [row.reason, formatNumber(row.count)])}
              emptyMessage="No failure reasons were recorded in the current window."
            />
            <TableCard
              title="Scan Failures By ATS"
              description="ATS families attached to the recorded failures."
              headers={["ATS Type", "Count"]}
              rows={envelope.data.scanFailuresByAts.map((row) => [row.atsType, formatNumber(row.count)])}
              emptyMessage="No ATS failure data was recorded in the current window."
            />
          </div>
          <TableCard
            title="Recent Failures"
            description="Most recent terminal scan failures returned by the admin analytics API."
            headers={["Company", "Reason", "Layer", "Time"]}
            rows={envelope.data.recentFailures.map((row) => [row.company, row.reason, row.layer, formatDateTime(row.at)])}
            emptyMessage="No recent failures were recorded in the current window."
          />
        </div>
      ) : null}
    </PanelState>
  );
}

function AdminAnalyticsRoute() {
  const { data: me } = useMe();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("growth");

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Admin Analytics" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Admin Analytics" subtitle="Operational trends and scan health for the rolling 30-day window." />
      <AdminPageFrame
        currentLabel="Analytics"
        currentPath={location.pathname}
        eyebrow="Ops Reporting"
        title="Read product, growth, and scan-health signals together"
        description="Each panel stays on its own cached endpoint so operators can inspect demand, feature usage, and failure clusters without losing the shared admin navigation context."
      >
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><BarChart3 size={16} /> Analytics</CardTitle>
              <CardDescription>
                Each tab reads its own cached admin analytics endpoint so the page stays simple and debuggable.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <TabButton active={activeTab === "growth"} label="Growth" onClick={() => setActiveTab("growth")} />
              <TabButton active={activeTab === "market-intel"} label="Market Intel" onClick={() => setActiveTab("market-intel")} />
              <TabButton active={activeTab === "feature-usage"} label="Feature Usage" onClick={() => setActiveTab("feature-usage")} />
              <TabButton active={activeTab === "system-health"} label="System Health" onClick={() => setActiveTab("system-health")} />
            </CardContent>
          </Card>

          {activeTab === "growth" ? <GrowthPanel /> : null}
          {activeTab === "market-intel" ? <MarketIntelPanel /> : null}
          {activeTab === "feature-usage" ? <FeatureUsagePanel /> : null}
          {activeTab === "system-health" ? <SystemHealthPanel /> : null}
        </div>
      </AdminPageFrame>
    </>
  );
}
