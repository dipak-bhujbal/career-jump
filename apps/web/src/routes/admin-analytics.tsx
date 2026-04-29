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
  useAdminAnalyticsScanQuota,
  useAdminAnalyticsSystemHealth,
} from "@/features/support/queries";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/admin-analytics")({ component: AdminAnalyticsRoute });

type AnalyticsTab = "growth" | "market-intel" | "feature-usage" | "system-health" | "scan-quota";

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

function formatShortDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

function SegmentedRateBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; tone: string }>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-[hsl(var(--secondary))]">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.tone}
            style={{ width: `${Math.max(0, Math.min(100, segment.value * 100))}%` }}
            title={`${segment.label}: ${formatPercent(segment.value)}`}
          />
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {segments.map((segment) => (
          <div key={segment.label} className="rounded-md border border-[hsl(var(--border))]/60 bg-[hsl(var(--secondary))]/35 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">{segment.label}</div>
            <div className="mt-1 text-sm font-semibold">{formatPercent(segment.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({
  points,
}: {
  points: Array<{ date: string; count: number }>;
}) {
  if (points.length === 0) {
    return <div className="text-sm text-[hsl(var(--muted-foreground))]">No daily quota usage in the current window.</div>;
  }

  const width = 320;
  const height = 72;
  const max = Math.max(...points.map((point) => point.count), 1);
  const stepX = points.length === 1 ? 0 : width / (points.length - 1);
  const path = points.map((point, index) => {
    const x = index * stepX;
    const y = height - (point.count / max) * (height - 8) - 4;
    return `${index === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-20 w-full overflow-visible rounded-md border border-[hsl(var(--border))]/60 bg-[hsl(var(--secondary))]/25 p-2">
        {/* Keep the sparkline intentionally simple so it remains readable
            without bringing in a charting dependency for one admin panel. */}
        <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex items-center justify-between text-[12px] text-[hsl(var(--muted-foreground))]">
        <span>{formatShortDate(points[0]!.date)}</span>
        <span>Peak {formatNumber(max)} scans</span>
        <span>{formatShortDate(points[points.length - 1]!.date)}</span>
      </div>
    </div>
  );
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

function ScanQuotaPanel() {
  const query = useAdminAnalyticsScanQuota();
  const envelope = query.data;
  const perPlanUsage = [...(envelope?.data.perPlanUsage ?? [])]
    .sort((a, b) => b.totalLiveScansUsed - a.totalLiveScansUsed);
  const usagePerDay = [...(envelope?.data.quotaUsagePerDay ?? [])]
    .sort((a, b) => a.date.localeCompare(b.date));
  const rateSegments = envelope ? [
    { label: "Cache hit", value: envelope.data.cacheHitRate, tone: "bg-emerald-500/80" },
    { label: "Live fetch", value: envelope.data.liveFetchRate, tone: "bg-sky-500/80" },
    { label: "Quota blocked", value: envelope.data.quotaBlockRate, tone: "bg-amber-500/85" },
  ] : [];

  return (
    <PanelState isLoading={query.isLoading} error={query.error}>
      {envelope ? (
        <div className="space-y-4">
          <EnvelopeMeta envelope={envelope} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Runs Analyzed" value={formatNumber(envelope.data.totalRunsAnalyzed)} />
            <StatCard title="Cache Hits" value={formatNumber(envelope.data.totalCacheHits)} />
            <StatCard title="Live Fetches" value={formatNumber(envelope.data.totalLiveFetches)} />
            <StatCard title="Quota Blocked" value={formatNumber(envelope.data.totalQuotaBlocked)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Scan Outcome Mix</CardTitle>
              <CardDescription>
                Breakdown of cache hits, live fetches, and quota-blocked companies emitted by the run summary events.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SegmentedRateBar segments={rateSegments} />
            </CardContent>
          </Card>
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <TableCard
              title="Per-Plan Live Scan Usage"
              description="How quota consumption is distributed across subscription tiers."
              headers={["Plan", "Live Scans Used", "Tenants", "Avg / Tenant"]}
              rows={perPlanUsage.map((row) => [
                row.plan,
                formatNumber(row.totalLiveScansUsed),
                formatNumber(row.tenantCount),
                row.avgPerTenant.toFixed(2),
              ])}
              emptyMessage="No plan-level quota usage was recorded in the current window."
            />
            <Card>
              <CardHeader>
                <CardTitle>Quota Usage Per Day</CardTitle>
                <CardDescription>
                  Daily live-scan consumption trend for the rolling analytics window.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Sparkline points={usagePerDay} />
              </CardContent>
            </Card>
          </div>
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
              <TabButton active={activeTab === "scan-quota"} label="Scan Quota" onClick={() => setActiveTab("scan-quota")} />
            </CardContent>
          </Card>

          {activeTab === "growth" ? <GrowthPanel /> : null}
          {activeTab === "market-intel" ? <MarketIntelPanel /> : null}
          {activeTab === "feature-usage" ? <FeatureUsagePanel /> : null}
          {activeTab === "system-health" ? <SystemHealthPanel /> : null}
          {activeTab === "scan-quota" ? <ScanQuotaPanel /> : null}
        </div>
      </AdminPageFrame>
    </>
  );
}
