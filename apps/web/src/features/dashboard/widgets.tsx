/**
 * Dashboard widget registry — large library, organized by category.
 *
 * Each widget is a self-contained component that consumes its own data
 * (via the existing dashboard / applied / config hooks). Adding a new
 * widget = drop a component in here and append to REGISTRY.
 */
import * as React from "react";
import { type ReactNode, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  Briefcase, TrendingUp, Layers, Tag, Hash, Activity, Building2, Award,
  Sparkles, RefreshCw, CheckSquare, Calendar, AlertTriangle,
  MapPin, Target, BarChart3, Send, Globe, Star, Coffee,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDashboard } from "./queries";
import { useApplied } from "@/features/applied/queries";
import { useConfig } from "@/features/companies/queries";
import { useActionPlan } from "@/features/plan/queries";
import { useRunStatus } from "@/features/run/queries";
import { formatNumber, formatPercent, formatShortDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AppliedStatus } from "@/lib/api";

export type WidgetCategory = "Pipeline" | "Conversion" | "Stages" | "Companies" | "Activity" | "Interviews" | "Coverage";

/** Two flavours of widget:
 *   - "Single"  — one number, one tile (small, focused)
 *   - "Grouped"      — multi-stat / chart / list / table (richer)
 *  This is shown as a separate filter in the Add-widget picker so users
 *  who want a sparse dashboard of just numbers can find them quickly. */
export type WidgetKind = "Single" | "Grouped";

interface WidgetSpec {
  id: string;
  title: string;
  description: string;
  category: WidgetCategory;
  kind: WidgetKind;
  icon: ReactNode;
  /** 1-2 column span on lg breakpoint. Most widgets are 1; KPI groups, funnel etc are 2. */
  cols?: number;
  Component: () => React.ReactElement;
}

/** Container card used by every widget so they all share visual style. */
function WidgetCard({ icon, title, link, children, className }: {
  icon: ReactNode; title: string; link?: string; children: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("bg-[hsl(var(--card))]/85 backdrop-blur-sm h-full", className)}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
          <span className="text-[hsl(var(--muted-foreground))]">{icon}</span>
          {title}
        </CardTitle>
        {link && <Link to={link} className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">View →</Link>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Single-KPI widget — one big number + label, optional link.
 *  Used by the dozen+ stat tiles in the library. */
function KpiTile({
  icon, title, value, isLoading, link, color, hint,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  isLoading?: boolean;
  link?: string;
  color?: string;
  hint?: string;
}) {
  const inner = (
    <Card className={cn("bg-[hsl(var(--card))]/85 backdrop-blur-sm h-full", link && "transition-all hover:-translate-y-0.5 hover:shadow-lg")}>
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-medium inline-flex items-center gap-2 text-[hsl(var(--muted-foreground))] uppercase tracking-wide">
          <span>{icon}</span>{title}
        </CardTitle>
        <div className={cn("text-3xl font-semibold tabular-nums", color)}>
          {isLoading ? <span className="inline-block h-7 w-16 rounded bg-[hsl(var(--muted))] animate-pulse" /> : value}
        </div>
        {hint && <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{hint}</div>}
      </CardHeader>
    </Card>
  );
  if (!link) return inner;
  const [path, qs] = link.split("?");
  const search = qs ? Object.fromEntries(new URLSearchParams(qs)) : undefined;
  return <Link to={path} search={search as never} className="block h-full">{inner}</Link>;
}

/* ---------- Single-KPI tiles ---------------------------------------- */

const BLUE = "text-blue-300 [.light_&]:text-blue-700";
const CYAN = "text-cyan-300 [.light_&]:text-cyan-700";
const AMBER = "text-amber-300 [.light_&]:text-amber-700";
const VIOLET = "text-violet-300 [.light_&]:text-violet-700";
const INDIGO = "text-indigo-300 [.light_&]:text-indigo-700";
const EMERALD = "text-emerald-300 [.light_&]:text-emerald-700";
const ROSE = "text-rose-300 [.light_&]:text-rose-700";

const STATUS_ORDER: AppliedStatus[] = ["Applied", "Interview", "Negotiations", "Offered", "Rejected"];

/** Keep dashboard ratios as fractions because formatPercent multiplies by 100. */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Applied-side dashboard widgets use the same source as the Applied Jobs page. */
function useAppliedStats() {
  const applied = useApplied({});
  return useMemo(() => {
    const jobs = applied.data?.jobs ?? [];
    const statusCounts = STATUS_ORDER.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as Record<AppliedStatus, number>);
    for (const job of jobs) {
      const status = job.status as AppliedStatus;
      if (status in statusCounts) statusCounts[status] += 1;
    }
    return {
      jobs,
      isLoading: applied.isLoading,
      total: jobs.length,
      statusCounts,
      interviewLike: statusCounts.Interview + statusCounts.Negotiations + statusCounts.Offered,
    };
  }, [applied.data?.jobs, applied.isLoading]);
}

/** Available jobs come from scan KPIs; applied jobs come from the Applied list. */
function usePipelineStats() {
  const dashboard = useDashboard();
  const applied = useAppliedStats();
  const available = dashboard.data?.kpis?.availableJobs ?? 0;
  const totalTracked = available + applied.total;
  return {
    dashboard,
    applied,
    available,
    totalTracked,
    applicationRatio: ratio(applied.total, totalTracked),
    interviewRatio: ratio(applied.interviewLike, applied.total),
    offerRatio: ratio(applied.statusCounts.Offered, applied.total),
    isLoading: dashboard.isLoading || applied.isLoading,
  };
}

const KpiTotalTracked = () => { const s = usePipelineStats(); return <KpiTile icon={<Briefcase size={13} />} title="Total tracked" value={formatNumber(s.totalTracked)} isLoading={s.isLoading} link="/jobs" color={BLUE} />; };
const KpiAvailable = () => { const q = useDashboard(); return <KpiTile icon={<Briefcase size={13} />} title="Available jobs" value={formatNumber(q.data?.kpis?.availableJobs)} isLoading={q.isLoading} link="/jobs" color={BLUE} />; };
const KpiNew = () => { const q = useDashboard(); return <KpiTile icon={<Sparkles size={13} />} title="New (latest run)" value={formatNumber(q.data?.kpis?.newJobsLatestRun)} isLoading={q.isLoading} link="/jobs?new=1" color={CYAN} />; };
const KpiUpdated = () => { const q = useDashboard(); return <KpiTile icon={<RefreshCw size={13} />} title="Updated jobs" value={formatNumber(q.data?.kpis?.updatedJobsLatestRun)} isLoading={q.isLoading} link="/jobs?updated=1" color={AMBER} />; };
const KpiApplied = () => { const s = useAppliedStats(); return <KpiTile icon={<CheckSquare size={13} />} title="Applied" value={formatNumber(s.total)} isLoading={s.isLoading} link="/applied" color={VIOLET} />; };
const KpiApplicationRatio = () => { const s = usePipelineStats(); return <KpiTile icon={<TrendingUp size={13} />} title="Application ratio" value={formatPercent(s.applicationRatio)} isLoading={s.isLoading} color={INDIGO} hint="applied / tracked" />; };
const KpiInterviewRatio = () => { const s = usePipelineStats(); return <KpiTile icon={<TrendingUp size={13} />} title="Interview ratio" value={formatPercent(s.interviewRatio)} isLoading={s.isLoading} color={CYAN} hint="interview+ / applied" />; };
const KpiOfferRatio = () => { const s = usePipelineStats(); return <KpiTile icon={<TrendingUp size={13} />} title="Offer ratio" value={formatPercent(s.offerRatio)} isLoading={s.isLoading} color={EMERALD} hint="offered / applied" />; };
const KpiInterviewCount = () => { const s = useAppliedStats(); return <KpiTile icon={<Layers size={13} />} title="Interview" value={formatNumber(s.statusCounts.Interview)} isLoading={s.isLoading} link="/applied?status=Interview" color={CYAN} />; };
const KpiNegotiationsCount = () => { const s = useAppliedStats(); return <KpiTile icon={<Layers size={13} />} title="Negotiations" value={formatNumber(s.statusCounts.Negotiations)} isLoading={s.isLoading} link="/applied?status=Negotiations" color={AMBER} />; };
const KpiOfferedCount = () => { const s = useAppliedStats(); return <KpiTile icon={<Award size={13} />} title="Offered" value={formatNumber(s.statusCounts.Offered)} isLoading={s.isLoading} link="/applied?status=Offered" color={EMERALD} />; };
const KpiRejectedCount = () => { const s = useAppliedStats(); return <KpiTile icon={<Layers size={13} />} title="Rejected" value={formatNumber(s.statusCounts.Rejected)} isLoading={s.isLoading} link="/applied?status=Rejected" color={ROSE} />; };
const KpiCompaniesCovered = () => { const q = useDashboard(); const k = q.data?.kpis ?? {}; return <KpiTile icon={<Building2 size={13} />} title="Companies covered" value={`${formatNumber(k.companiesDetected)} / ${formatNumber(k.companiesConfigured)}`} isLoading={q.isLoading} link="/configuration" color={BLUE} />; };
const KpiTotalFetched = () => { const q = useDashboard(); return <KpiTile icon={<Globe size={13} />} title="Total fetched" value={formatNumber(q.data?.kpis?.totalFetched)} isLoading={q.isLoading} color={INDIGO} hint="across all scans" />; };
const KpiMatchRate = () => { const q = useDashboard(); return <KpiTile icon={<Target size={13} />} title="Match rate" value={formatPercent(q.data?.kpis?.matchRate)} isLoading={q.isLoading} color={EMERALD} hint="keyword-matched fraction" />; };

/* ---------- KPI groups (2-column) ----------------------------------- */

function KpiPipeline() {
  const s = usePipelineStats();
  const k = s.dashboard.data?.kpis ?? {};
  const items = [
    { label: "Total tracked", value: formatNumber(s.totalTracked), to: "/jobs", color: BLUE },
    { label: "Available", value: formatNumber(s.available), to: "/jobs", color: BLUE },
    { label: "New", value: formatNumber(k.newJobsLatestRun), to: "/jobs?new=1", color: CYAN },
    { label: "Updated", value: formatNumber(k.updatedJobsLatestRun), to: "/jobs?updated=1", color: AMBER },
  ];
  return (
    <WidgetCard icon={<Briefcase size={14} />} title="Pipeline overview" className="lg:col-span-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((it) => {
          const [path, qs] = it.to.split("?");
          return (
            <Link key={it.label} to={path} search={Object.fromEntries(new URLSearchParams(qs ?? "")) as never}
                  className="group rounded-md border border-[hsl(var(--border))]/50 px-3 py-2 hover:bg-[hsl(var(--accent))] transition-colors">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{it.label}</div>
              <div className={cn("text-2xl font-semibold tabular-nums", it.color)}>
                {s.isLoading ? <span className="inline-block h-6 w-12 rounded bg-[hsl(var(--muted))] animate-pulse" /> : it.value}
              </div>
            </Link>
          );
        })}
      </div>
    </WidgetCard>
  );
}

function KpiConversion() {
  const s = usePipelineStats();
  const items = [
    { label: "Application", value: formatPercent(s.applicationRatio), color: VIOLET },
    { label: "Interview", value: formatPercent(s.interviewRatio), color: CYAN },
    { label: "Offer", value: formatPercent(s.offerRatio), color: EMERALD },
  ];
  return (
    <WidgetCard icon={<TrendingUp size={14} />} title="Conversion ratios" className="lg:col-span-2" link="/applied">
      <div className="grid grid-cols-3 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-md border border-[hsl(var(--border))]/50 px-3 py-2">
            <div className="text-xs text-[hsl(var(--muted-foreground))]">{it.label} ratio</div>
            <div className={cn("text-2xl font-semibold tabular-nums", it.color)}>
              {s.isLoading ? <span className="inline-block h-6 w-12 rounded bg-[hsl(var(--muted))] animate-pulse" /> : it.value}
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

function KpiStages() {
  const s = useAppliedStats();
  const items = [
    { label: "Interview", value: formatNumber(s.statusCounts.Interview), to: "/applied?status=Interview", color: CYAN },
    { label: "Negotiations", value: formatNumber(s.statusCounts.Negotiations), to: "/applied?status=Negotiations", color: AMBER },
    { label: "Offered", value: formatNumber(s.statusCounts.Offered), to: "/applied?status=Offered", color: EMERALD },
    { label: "Rejected", value: formatNumber(s.statusCounts.Rejected), to: "/applied?status=Rejected", color: ROSE },
  ];
  return (
    <WidgetCard icon={<Layers size={14} />} title="Stage breakdown" className="lg:col-span-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {items.map((it) => {
          const [path, qs] = it.to.split("?");
          return (
            <Link key={it.label} to={path} search={Object.fromEntries(new URLSearchParams(qs ?? "")) as never}
                  className="group rounded-md border border-[hsl(var(--border))]/50 px-3 py-2 hover:bg-[hsl(var(--accent))] transition-colors">
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{it.label}</div>
              <div className={cn("text-2xl font-semibold tabular-nums", it.color)}>
                {s.isLoading ? <span className="inline-block h-6 w-12 rounded bg-[hsl(var(--muted))] animate-pulse" /> : it.value}
              </div>
            </Link>
          );
        })}
      </div>
    </WidgetCard>
  );
}

/* ---------- Visual widgets ------------------------------------------ */

function FunnelWidget() {
  const s = usePipelineStats();
  const tracked = s.totalTracked;
  const applied = s.applied.total;
  const interview = s.applied.statusCounts.Interview;
  const offered = s.applied.statusCounts.Offered;
  const max = Math.max(1, tracked, applied, interview, offered);
  const stages = [
    { label: "Tracked",   value: tracked,   color: "bg-blue-500/40",    text: BLUE,    to: "/jobs",   search: {} },
    { label: "Applied",   value: applied,   color: "bg-violet-500/40",  text: VIOLET,  to: "/applied", search: {} },
    { label: "Interview", value: interview, color: "bg-cyan-500/40",    text: CYAN,    to: "/applied", search: { status: "Interview" } },
    { label: "Offered",   value: offered,   color: "bg-emerald-500/40", text: EMERALD, to: "/applied", search: { status: "Offered" } },
  ];
  return (
    <WidgetCard icon={<Activity size={14} />} title="Application funnel" className="lg:col-span-2">
      <div className="space-y-2">
        {stages.map((s) => (
          <Link key={s.label} to={s.to} search={s.search as never}
                className="flex items-center gap-3 rounded-md px-1 -mx-1 hover:bg-[hsl(var(--accent))]/50 transition-colors">
            <div className="w-24 text-xs text-[hsl(var(--muted-foreground))]">{s.label}</div>
            <div className="flex-1 h-7 rounded-md bg-[hsl(var(--secondary))] overflow-hidden">
              <div className={cn("h-full transition-all", s.color)} style={{ width: `${(s.value / max) * 100}%` }} />
            </div>
            <div className={cn("w-12 text-right text-sm font-semibold tabular-nums", s.text)}>{formatNumber(s.value)}</div>
          </Link>
        ))}
      </div>
    </WidgetCard>
  );
}

/** Stacked bar showing the proportion of applications in each pipeline
 *  stage. Click a segment to navigate to the filtered Applied view. */
function PipelineBarWidget() {
  const { statusCounts: counts } = useAppliedStats();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const segs: { status: AppliedStatus; color: string }[] = [
    { status: "Applied", color: "bg-violet-500/60" },
    { status: "Interview", color: "bg-cyan-500/60" },
    { status: "Negotiations", color: "bg-amber-500/60" },
    { status: "Offered", color: "bg-emerald-500/60" },
    { status: "Rejected", color: "bg-rose-500/60" },
  ];
  return (
    <WidgetCard icon={<BarChart3 size={14} />} title="Pipeline distribution" className="lg:col-span-2" link="/applied">
      {total === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No applications yet.</p>
      ) : (
        <>
          <div className="flex h-7 w-full overflow-hidden rounded-md bg-[hsl(var(--secondary))]">
            {segs.map((s) => {
              const v = counts[s.status];
              if (v === 0) return null;
              return (
                <Link key={s.status} to="/applied" search={{ status: s.status } as never}
                      style={{ width: `${(v / total) * 100}%` }}
                      title={`${s.status}: ${v}`}
                      className={cn("transition-opacity hover:opacity-80", s.color)}
                />
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            {segs.map((s) => (
              <div key={s.status} className="flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-sm", s.color)} />
                <span className="text-[hsl(var(--muted-foreground))]">{s.status}</span>
                <span className="ml-auto tabular-nums">{counts[s.status]}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </WidgetCard>
  );
}

/* ---------- Companies ----------------------------------------------- */

function TopCompaniesWidget() {
  const { data: applied } = useApplied({});
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    // This widget ranks actual applications, not merely configured companies.
    for (const a of applied?.jobs ?? []) if (a.job) m[a.job.company] = (m[a.job.company] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [applied]);
  return (
    <WidgetCard icon={<Building2 size={14} />} title="Top companies" link="/configuration">
      {counts.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No applications yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {counts.map(([company, count]) => (
            <li key={company}>
              <Link to="/applied" className="flex items-center justify-between text-sm rounded-md px-2 py-1 -mx-2 hover:bg-[hsl(var(--accent))] transition-colors">
                <span className="truncate">{company}</span>
                <span className="text-[hsl(var(--muted-foreground))] tabular-nums">{count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function AtsBreakdownWidget() {
  const { data: config } = useConfig();
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of config?.config?.companies ?? []) {
      const ats = c.registryAts || c.source || "Unknown";
      m[ats] = (m[ats] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [config]);
  const total = counts.reduce((a, [, v]) => a + v, 0);
  return (
    <WidgetCard icon={<Star size={14} />} title="Companies by ATS">
      {counts.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No tracked companies.</p>
      ) : (
        <ul className="space-y-2">
          {counts.map(([ats, count]) => (
            <li key={ats}>
              <Link to="/configuration" className="block text-sm rounded-md px-2 py-1 -mx-2 hover:bg-[hsl(var(--accent))] transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="capitalize">{ats}</span>
                  <span className="text-[hsl(var(--muted-foreground))] tabular-nums">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
                  <div className="h-full bg-[hsl(var(--primary))]/60" style={{ width: `${(count / Math.max(1, total)) * 100}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function TopLocationsWidget() {
  const { data: applied } = useApplied({});
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of (applied?.jobs ?? []).filter((a) => a.job)) {
      const loc = (a.job.location ?? "Unknown").trim() || "Unknown";
      m[loc] = (m[loc] ?? 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [applied]);
  return (
    <WidgetCard icon={<MapPin size={14} />} title="Top locations">
      {counts.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No applications yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {counts.map(([loc, count]) => (
            <li key={loc}>
              <Link to="/applied" className="flex items-center justify-between text-sm rounded-md px-2 py-1 -mx-2 hover:bg-[hsl(var(--accent))] transition-colors">
                <span className="truncate">{loc}</span>
                <span className="text-[hsl(var(--muted-foreground))] tabular-nums">{count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

/* ---------- Activity ------------------------------------------------ */

function RecentActivityWidget() {
  const { data } = useApplied({});
  const events = useMemo(() => {
    return (data?.jobs ?? []).slice().sort((a, b) =>
      new Date(b.lastStatusChangedAt ?? b.appliedAt).getTime() - new Date(a.lastStatusChangedAt ?? a.appliedAt).getTime()
    ).slice(0, 6);
  }, [data]);
  return (
    <WidgetCard icon={<Activity size={14} />} title="Recent activity">
      {events.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No activity yet.</p>
      ) : (
        <ul className="space-y-1">
          {events.map((j) => (
            <li key={j.jobKey}>
              <Link
                to="/applied"
                search={{ jobKey: j.jobKey }}
                className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-[hsl(var(--accent))] transition-colors group"
              >
                <div className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))]">{j.job?.jobTitle}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-2 mt-0.5">
                  <span className="truncate">{j.job?.company}</span>
                  <Badge variant="secondary">{j.status}</Badge>
                  <span>· {relativeTime(j.lastStatusChangedAt ?? j.appliedAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function StaleApplicationsWidget() {
  const { data } = useApplied({});
  const stale = useMemo(() => {
    const cutoff = Date.now() - 14 * 86_400_000;
    return (data?.jobs ?? [])
      .filter((j) => j.status !== "Offered" && j.status !== "Rejected")
      .filter((j) => new Date(j.lastStatusChangedAt ?? j.appliedAt).getTime() < cutoff)
      .sort((a, b) => new Date(a.lastStatusChangedAt ?? a.appliedAt).getTime() - new Date(b.lastStatusChangedAt ?? b.appliedAt).getTime())
      .slice(0, 6);
  }, [data]);
  return (
    <WidgetCard icon={<AlertTriangle size={14} />} title="Stale applications" link="/applied">
      {stale.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Nothing stale — keep going.</p>
      ) : (
        <ul className="space-y-1">
          {stale.map((j) => (
            <li key={j.jobKey}>
              <Link
                to="/applied"
                search={{ jobKey: j.jobKey }}
                className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-[hsl(var(--accent))] transition-colors group"
              >
                <div className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))]">{j.job?.jobTitle}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  {j.job?.company} · last update {relativeTime(j.lastStatusChangedAt ?? j.appliedAt)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function LastScanWidget() {
  const { data: dashboard } = useDashboard();
  const { data: run } = useRunStatus();
  const isActive = run?.active === true;
  const lastRunAt = dashboard?.lastRunAt;
  return (
    <WidgetCard icon={<RefreshCw size={14} />} title="Last scan" link="/logs">
      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">Status</span>
          <Badge variant={isActive ? "warning" : "secondary"}>{isActive ? "Running" : "Idle"}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[hsl(var(--muted-foreground))]">Last run</span>
          <span>{lastRunAt ? relativeTime(lastRunAt) : "Never"}</span>
        </div>
        {isActive && (
          <div className="flex items-center justify-between">
            <span className="text-[hsl(var(--muted-foreground))]">Progress</span>
            <span className="tabular-nums">{run?.fetchedCompanies ?? 0} / {run?.totalCompanies ?? 0}</span>
          </div>
        )}
      </div>
    </WidgetCard>
  );
}

/* ---------- Interviews ---------------------------------------------- */

function UpcomingInterviewsWidget() {
  const { data } = useActionPlan();
  const upcoming = useMemo(() => {
    const now = Date.now();
    return (data?.jobs ?? [])
      .filter((r) => r.interviewAt && new Date(r.interviewAt).getTime() >= now)
      .sort((a, b) => new Date(a.interviewAt ?? 0).getTime() - new Date(b.interviewAt ?? 0).getTime())
      .slice(0, 5);
  }, [data]);
  return (
    <WidgetCard icon={<Calendar size={14} />} title="Upcoming interviews" link="/plan">
      {upcoming.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No interviews scheduled.</p>
      ) : (
        <ul className="space-y-2">
          {upcoming.map((r) => (
            <li key={r.jobKey}>
              <Link to="/plan" className="block text-sm rounded-md px-2 py-1.5 -mx-2 hover:bg-[hsl(var(--accent))] transition-colors group">
                <div className="font-medium truncate group-hover:text-[hsl(var(--primary))]">{r.jobTitle}</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-2">
                  <span className="truncate">{r.company}</span>
                  <span className="text-amber-400">{formatShortDate(r.interviewAt!)} · {relativeTime(r.interviewAt!)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function ActionPlanCountWidget() {
  const { data } = useActionPlan();
  return <KpiTile icon={<Target size={13} />} title="Action plan" value={formatNumber(data?.jobs?.length ?? 0)} link="/plan" color={AMBER} hint="active opportunities" />;
}

function InterviewOutcomesWidget() {
  const { data } = useActionPlan();
  const counts = useMemo(() => {
    const m: Record<string, number> = { Pending: 0, Passed: 0, Failed: 0, "Follow-up": 0 };
    for (const r of data?.jobs ?? []) {
      for (const rd of r.interviewRounds ?? []) m[rd.outcome ?? "Pending"]++;
    }
    return m;
  }, [data]);
  const tone: Record<string, "secondary" | "success" | "danger" | "warning"> = {
    Pending: "secondary", Passed: "success", Failed: "danger", "Follow-up": "warning",
  };
  return (
    <WidgetCard icon={<Coffee size={14} />} title="Interview outcomes" link="/plan">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(counts).map(([k, v]) => (
          <Link key={k} to="/plan"
                className="flex items-center justify-between text-sm border border-[hsl(var(--border))]/50 rounded-md px-2.5 py-1.5 hover:bg-[hsl(var(--accent))] transition-colors">
            <Badge variant={tone[k]}>{k}</Badge>
            <span className="tabular-nums">{v}</span>
          </Link>
        ))}
      </div>
    </WidgetCard>
  );
}

/* ---------- Tag clouds ---------------------------------------------- */

function StatusBreakdownWidget() {
  const s = useAppliedStats();
  const entries = STATUS_ORDER
    .map((status) => [status, s.statusCounts[status]] as const)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1]);
  return (
    <WidgetCard icon={<Tag size={14} />} title="Status breakdown" link="/applied">
      {entries.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No data yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {entries.map(([label, value]) => (
            <Link key={label} to="/applied" search={{ status: label } as never}
                  className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-3 py-1 text-sm hover:bg-[hsl(var(--accent))] transition-colors">
              <strong className="font-medium">{label}</strong>
              <span className="text-[hsl(var(--muted-foreground))] tabular-nums">{value}</span>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function KeywordCloudWidget() {
  const { data } = useDashboard();
  const entries = Object.entries(data?.keywordCounts ?? {}).filter(([, v]) => Number(v) > 0).sort((a, b) => b[1] - a[1]);
  return (
    <WidgetCard icon={<Hash size={14} />} title="Keyword counts" link="/jobs">
      {entries.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">No data yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {entries.map(([label, value]) => (
            <Link key={label} to="/jobs" search={{ q: label } as never}
                  className="inline-flex items-center gap-2 rounded-full bg-[hsl(var(--secondary))] px-3 py-1 text-sm hover:bg-[hsl(var(--accent))] transition-colors">
              <strong className="font-medium">{label}</strong>
              <span className="text-[hsl(var(--muted-foreground))] tabular-nums">{value}</span>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

/* ---------- Coverage ------------------------------------------------ */

function CoverageWidget() {
  const { data } = useDashboard();
  const k = data?.kpis ?? {};
  return (
    <WidgetCard icon={<Award size={14} />} title="Coverage & match">
      <div className="grid grid-cols-3 gap-3">
        <Link to="/configuration" className="rounded-md px-1 py-0.5 -mx-1 hover:bg-[hsl(var(--accent))] transition-colors">
          <div className="text-xs text-[hsl(var(--muted-foreground))]">Companies</div>
          <div className="text-2xl font-semibold tabular-nums">{formatNumber(k.companiesDetected)}<span className="text-base text-[hsl(var(--muted-foreground))]">/{formatNumber(k.companiesConfigured)}</span></div>
        </Link>
        <Link to="/logs" className="rounded-md px-1 py-0.5 -mx-1 hover:bg-[hsl(var(--accent))] transition-colors">
          <div className="text-xs text-[hsl(var(--muted-foreground))]">Fetched</div>
          <div className="text-2xl font-semibold tabular-nums">{formatNumber(k.totalFetched)}</div>
        </Link>
        <Link to="/logs" className="rounded-md px-1 py-0.5 -mx-1 hover:bg-[hsl(var(--accent))] transition-colors">
          <div className="text-xs text-[hsl(var(--muted-foreground))]">Match rate</div>
          <div className="text-2xl font-semibold tabular-nums">{formatPercent(k.matchRate)}</div>
        </Link>
      </div>
    </WidgetCard>
  );
}

/* ---------- Quick actions ------------------------------------------- */

function QuickLinksWidget() {
  const links: { to: string; label: string; icon: ReactNode }[] = [
    { to: "/jobs", label: "Browse jobs", icon: <Briefcase size={14} /> },
    { to: "/applied", label: "Applied jobs", icon: <Send size={14} /> },
    { to: "/plan", label: "Action plan", icon: <Target size={14} /> },
    { to: "/configuration", label: "Configuration", icon: <Building2 size={14} /> },
  ];
  return (
    <WidgetCard icon={<Sparkles size={14} />} title="Quick links">
      <ul className="space-y-1">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))]">
              <span className="text-[hsl(var(--muted-foreground))]">{l.icon}</span>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}

/* ---------- Registry ------------------------------------------------ */

function spec(s: Omit<WidgetSpec, "id"> & { id: string }): WidgetSpec { return s; }

export const REGISTRY: Record<string, WidgetSpec> = Object.fromEntries([
  // Pipeline (group + tiles)
  spec({ id: "kpi-pipeline",   title: "Pipeline overview",    description: "Total tracked, available, new, updated.",                       category: "Pipeline",   kind: "Grouped",     icon: <Briefcase size={14} />, cols: 2, Component: KpiPipeline }),
  spec({ id: "kpi-total",      title: "Total tracked",        description: "All jobs ever tracked.",                                        category: "Pipeline",   kind: "Single", icon: <Briefcase size={14} />, Component: KpiTotalTracked }),
  spec({ id: "kpi-available",  title: "Available jobs",       description: "Open jobs you haven't applied to or discarded.",                category: "Pipeline",   kind: "Single", icon: <Briefcase size={14} />, Component: KpiAvailable }),
  spec({ id: "kpi-new",        title: "New jobs",             description: "Jobs added in the latest scan.",                                category: "Pipeline",   kind: "Single", icon: <Sparkles size={14} />,  Component: KpiNew }),
  spec({ id: "kpi-updated",    title: "Updated jobs",         description: "Existing jobs whose details changed.",                          category: "Pipeline",   kind: "Single", icon: <RefreshCw size={14} />, Component: KpiUpdated }),

  // Conversion (group + tiles)
  spec({ id: "kpi-conversion", title: "Conversion ratios",    description: "Application / interview / offer ratios.",                       category: "Conversion", kind: "Grouped",     icon: <TrendingUp size={14} />, cols: 2, Component: KpiConversion }),
  spec({ id: "kpi-applied",    title: "Applied",              description: "Total applications.",                                           category: "Conversion", kind: "Single", icon: <CheckSquare size={14} />, Component: KpiApplied }),
  spec({ id: "kpi-app-ratio",  title: "Application ratio",    description: "Applied / tracked.",                                            category: "Conversion", kind: "Single", icon: <TrendingUp size={14} />, Component: KpiApplicationRatio }),
  spec({ id: "kpi-int-ratio",  title: "Interview ratio",      description: "Interview-or-later / applied.",                                category: "Conversion", kind: "Single", icon: <TrendingUp size={14} />, Component: KpiInterviewRatio }),
  spec({ id: "kpi-offer-ratio",title: "Offer ratio",          description: "Offers / applied.",                                             category: "Conversion", kind: "Single", icon: <TrendingUp size={14} />, Component: KpiOfferRatio }),
  spec({ id: "funnel",         title: "Application funnel",   description: "Tracked → Applied → Interview → Offered horizontal bars.",      category: "Conversion", kind: "Grouped",     icon: <Activity size={14} />,   cols: 2, Component: FunnelWidget }),
  spec({ id: "pipeline-bar",   title: "Pipeline distribution",description: "Stacked bar of applications across all stages.",                category: "Conversion", kind: "Grouped",     icon: <BarChart3 size={14} />,  cols: 2, Component: PipelineBarWidget }),

  // Stages (group + tiles)
  spec({ id: "kpi-stages",     title: "Stage breakdown",      description: "Counts in Interview / Negotiations / Offered / Rejected.",     category: "Stages",     kind: "Grouped",     icon: <Layers size={14} />, cols: 2, Component: KpiStages }),
  spec({ id: "kpi-interview",  title: "Interview count",      description: "Applications currently in Interview.",                          category: "Stages",     kind: "Single", icon: <Layers size={14} />, Component: KpiInterviewCount }),
  spec({ id: "kpi-negotiations",title:"Negotiations count",   description: "Applications currently in Negotiations.",                       category: "Stages",     kind: "Single", icon: <Layers size={14} />, Component: KpiNegotiationsCount }),
  spec({ id: "kpi-offered",    title: "Offered count",        description: "Applications with offers.",                                     category: "Stages",     kind: "Single", icon: <Award size={14} />,  Component: KpiOfferedCount }),
  spec({ id: "kpi-rejected",   title: "Rejected count",       description: "Applications that were rejected.",                              category: "Stages",     kind: "Single", icon: <Layers size={14} />, Component: KpiRejectedCount }),

  // Companies
  spec({ id: "top-companies",  title: "Top companies",        description: "Most applied-to companies.",                                    category: "Companies",  kind: "Grouped",     icon: <Building2 size={14} />, Component: TopCompaniesWidget }),
  spec({ id: "ats-breakdown",  title: "Companies by ATS",     description: "Distribution of tracked companies by ATS.",                     category: "Companies",  kind: "Grouped",     icon: <Star size={14} />,      Component: AtsBreakdownWidget }),
  spec({ id: "top-locations",  title: "Top locations",        description: "Most-applied locations across applications.",                   category: "Companies",  kind: "Grouped",     icon: <MapPin size={14} />,    Component: TopLocationsWidget }),
  spec({ id: "kpi-companies",  title: "Companies covered",    description: "Companies returning data vs configured.",                       category: "Companies",  kind: "Single", icon: <Building2 size={14} />, Component: KpiCompaniesCovered }),
  spec({ id: "kpi-fetched",    title: "Total fetched",        description: "Job postings fetched across all scans.",                        category: "Companies",  kind: "Single", icon: <Globe size={14} />,     Component: KpiTotalFetched }),
  spec({ id: "kpi-match-rate", title: "Match rate",           description: "Fraction of fetched jobs that matched your keywords.",          category: "Coverage",   kind: "Single", icon: <Target size={14} />,    Component: KpiMatchRate }),
  spec({ id: "coverage",       title: "Coverage & match",     description: "Companies covered + total fetched + match rate.",               category: "Coverage",   kind: "Grouped",     icon: <Award size={14} />,     Component: CoverageWidget }),

  // Activity
  spec({ id: "recent-activity",title: "Recent activity",      description: "Most recent application status changes.",                       category: "Activity",   kind: "Grouped",     icon: <Activity size={14} />,  Component: RecentActivityWidget }),
  spec({ id: "stale",          title: "Stale applications",   description: "Applications with no status change in 14+ days.",               category: "Activity",   kind: "Grouped",     icon: <AlertTriangle size={14} />, Component: StaleApplicationsWidget }),
  spec({ id: "last-scan",      title: "Last scan",            description: "Status of the most recent scan run.",                           category: "Activity",   kind: "Grouped",     icon: <RefreshCw size={14} />, Component: LastScanWidget }),
  spec({ id: "status-breakdown",title:"Status breakdown",     description: "Tag chips by pipeline status.",                                 category: "Activity",   kind: "Grouped",     icon: <Tag size={14} />,       Component: StatusBreakdownWidget }),
  spec({ id: "keyword-cloud",  title: "Keyword counts",       description: "Top keywords across available jobs.",                           category: "Activity",   kind: "Grouped",     icon: <Hash size={14} />,      Component: KeywordCloudWidget }),

  // Interviews
  spec({ id: "upcoming",       title: "Upcoming interviews",  description: "Next 5 scheduled interview rounds.",                            category: "Interviews", kind: "Grouped",     icon: <Calendar size={14} />,  Component: UpcomingInterviewsWidget }),
  spec({ id: "outcomes",       title: "Interview outcomes",   description: "Pending / Passed / Failed / Follow-up counts.",                 category: "Interviews", kind: "Grouped",     icon: <Coffee size={14} />,    Component: InterviewOutcomesWidget }),
  spec({ id: "kpi-action-plan",title: "Action plan size",     description: "Active opportunities to prep for.",                             category: "Interviews", kind: "Single", icon: <Target size={14} />,    Component: ActionPlanCountWidget }),

  // Quick links
  spec({ id: "quick-links",    title: "Quick links",          description: "Shortcuts to the main pages.",                                  category: "Activity",   kind: "Grouped",     icon: <Sparkles size={14} />,  Component: QuickLinksWidget }),
].map((s) => [s.id, s]));

export const WIDGET_IDS = Object.keys(REGISTRY);
