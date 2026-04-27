/**
 * Action Plan route — interview-ready jobs in a compact, scrollable
 * table that scales to hundreds of rows. Click a row → opens the
 * shared JobDetailsDrawer.
 *
 * Filter set is consistent with Available Jobs and Applied Jobs:
 *   Job title (text) · Companies (multi-select) · Location (text) · Date range
 * plus a page-specific Outcome (Pending / Passed / Failed / Follow-up).
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Calendar, Target } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useActionPlan } from "@/features/plan/queries";
import { formatShortDate, relativeTime } from "@/lib/format";
import { FilterToolbar } from "@/components/filter-toolbar";
import { MultiSelect } from "@/components/ui/multi-select";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { CompanyHoverCard } from "@/features/companies/CompanyHoverCard";
import { JobDetailsDrawer, type DrawerSource } from "@/features/jobs/JobDetailsDrawer";
import { companyKey, cn } from "@/lib/utils";
import type { ActionPlanRow } from "@/lib/api";

const OUTCOMES = ["Pending", "Passed", "Failed", "Follow-up"];

const OUTCOME_VARIANT: Record<string, "default" | "warning" | "success" | "danger" | "secondary"> = {
  Pending: "secondary",
  Passed: "success",
  Failed: "danger",
  "Follow-up": "warning",
};

export const Route = createFileRoute("/plan")({ component: ActionPlanRoute });

function ActionPlanRoute() {
  const { data, isLoading } = useActionPlan();
  // Stabilize the empty fallback so memoized filters/sorts do not see a new
  // array on every render before the action-plan query resolves.
  const rows = useMemo(() => data?.jobs ?? [], [data?.jobs]);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [companies, setCompanies] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);
  // Drawer holds just the jobKey; the actual ActionPlanRow is looked
  // up from the live list each render so when rounds are added/edited/
  // deleted the drawer re-renders with the latest data.
  const [drawerJobKey, setDrawerJobKey] = useState<string | null>(null);
  const drawer: DrawerSource | null = drawerJobKey
    ? (() => {
        const row = rows.find((r) => r.jobKey === drawerJobKey);
        return row ? { type: "plan", row } : null;
      })()
    : null;
  const [sortBy, setSortBy] = useState<"interview" | "applied" | "company">("interview");

  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.company) set.add(r.company);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const loc = location.trim().toLowerCase();
    const fromMs = dateRange.from?.getTime() ?? -Infinity;
    const toMs = dateRange.to ? dateRange.to.getTime() + 86_399_999 : Infinity;
    const compKeys = new Set(companies.map(companyKey));
    const list = rows.filter((r) => {
      if (kw && !r.jobTitle.toLowerCase().includes(kw)) return false;
      if (loc && !(r.location ?? "").toLowerCase().includes(loc)) return false;
      if (compKeys.size > 0 && !compKeys.has(companyKey(r.company))) return false;
      if (selectedOutcomes.length > 0) {
        const o = String(r.outcome ?? "Pending");
        if (!selectedOutcomes.includes(o)) return false;
      }
      const t = r.interviewAt ? new Date(r.interviewAt).getTime() : NaN;
      if ((dateRange.from || dateRange.to) && (Number.isNaN(t) || t < fromMs || t > toMs)) return false;
      return true;
    });
    // Sort
    const sorted = [...list];
    if (sortBy === "interview") {
      sorted.sort((a, b) => {
        const at = a.interviewAt ? new Date(a.interviewAt).getTime() : Infinity;
        const bt = b.interviewAt ? new Date(b.interviewAt).getTime() : Infinity;
        return at - bt; // soonest first
      });
    } else if (sortBy === "applied") {
      sorted.sort((a, b) => new Date(b.appliedAt ?? 0).getTime() - new Date(a.appliedAt ?? 0).getTime());
    } else {
      sorted.sort((a, b) => a.company.localeCompare(b.company));
    }
    return sorted;
  }, [rows, keyword, location, companies, dateRange, selectedOutcomes, sortBy]);

  const advancedActive = Boolean(
    keyword || location || companies.length || dateRange.from || dateRange.to || selectedOutcomes.length,
  );

  function toggleOutcome(o: string) {
    setSelectedOutcomes((cur) => cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
  }

  return (
    <>
      <Topbar
        title="Action Plan"
        subtitle={`${rows.length} active opportunit${rows.length === 1 ? "y" : "ies"} to prep for`}
      />
      <div className="p-6 space-y-4">
        <FilterToolbar
          label={
            <span className="inline-flex items-center gap-2">
              <Target size={14} />
              {filtered.length} of {rows.length} matching
            </span>
          }
          advanced={advancedOpen}
          onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
          advancedActive={advancedActive}
          onClearAdvanced={() => {
            setKeyword(""); setLocation(""); setCompanies([]);
            setDateRange({ from: null, to: null }); setSelectedOutcomes([]);
          }}
        />

        {advancedOpen && (
          <Card>
            <CardContent className="space-y-5 pt-5">
              <div className="space-y-2">
                <label className="text-sm font-medium">Outcome <span className="text-[hsl(var(--muted-foreground))] font-normal">(select multiple)</span></label>
                <div className="flex flex-wrap gap-2">
                  {OUTCOMES.map((o) => {
                    const active = selectedOutcomes.includes(o);
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => toggleOutcome(o)}
                        className={
                          "inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border text-sm font-medium transition-all " +
                          (active
                            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]"
                            : "border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 hover:bg-[hsl(var(--accent))]")
                        }
                        aria-pressed={active}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Job title</label>
                  <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="e.g. Senior, Platform" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Companies</label>
                  {companyOptions.length === 0 ? (
                    <div className="h-9 flex items-center text-sm text-[hsl(var(--muted-foreground))] italic">No data</div>
                  ) : (
                    <MultiSelect
                      options={companyOptions}
                      value={companies}
                      onChange={setCompanies}
                      placeholder="All companies"
                      noun="companies"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Location</label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="USA, Remote, NY…" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Interview between</label>
                  <DateRangePicker value={dateRange} onChange={setDateRange} placeholder="Any date" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Compact table — scales to hundreds of rows. Click any row
            for full details in the side drawer. */}
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                <tr className="border-b border-[hsl(var(--border))]">
                  <SortHeader label="Company" active={sortBy === "company"} onClick={() => setSortBy("company")} />
                  <th className="text-left px-4 py-3 font-medium">Role</th>
                  <SortHeader label="Next interview" active={sortBy === "interview"} onClick={() => setSortBy("interview")} />
                  <th className="text-left px-4 py-3 font-medium">Outcome</th>
                  <SortHeader label="Applied" active={sortBy === "applied"} onClick={() => setSortBy("applied")} />
                  <th className="text-left px-4 py-3 font-medium">Rounds</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[hsl(var(--border))]">
                    <td colSpan={6} className="px-4 py-3"><div className="h-6 rounded bg-[hsl(var(--muted))] animate-pulse" /></td>
                  </tr>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
                      {advancedActive
                        ? "No matches for your filters. Clear them to see everything."
                        : "No action items yet. Once an application moves to Interview, it'll show up here."}
                    </td>
                  </tr>
                )}
                {!isLoading && filtered.map((row) => (
                  <PlanRow key={row.jobKey} row={row} onSelect={() => setDrawerJobKey(row.jobKey)} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <JobDetailsDrawer source={drawer} onClose={() => setDrawerJobKey(null)} />
    </>
  );
}

function SortHeader({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <th className="text-left px-4 py-3 font-medium">
      <button
        type="button"
        onClick={onClick}
        className={cn("inline-flex items-center gap-1 hover:text-[hsl(var(--foreground))]", active && "text-[hsl(var(--foreground))]")}
      >
        {label}{active && <span aria-hidden> ↓</span>}
      </button>
    </th>
  );
}

function PlanRow({ row, onSelect }: { row: ActionPlanRow; onSelect: () => void }) {
  const isSoon = row.interviewAt && (new Date(row.interviewAt).getTime() - Date.now()) <= 7 * 86_400_000 && new Date(row.interviewAt).getTime() > Date.now();
  return (
    <tr
      onClick={onSelect}
      className={cn("border-b border-[hsl(var(--border))] cursor-pointer hover:bg-[hsl(var(--accent))]/40 transition-colors")}
    >
      <td className="px-4 py-2.5 whitespace-nowrap">
        <CompanyHoverCard company={row.company}>
          <span className="hover:underline cursor-default">{row.company}</span>
        </CompanyHoverCard>
      </td>
      <td className="px-4 py-2.5 font-medium">{row.jobTitle}</td>
      <td className="px-4 py-2.5">
        {row.interviewAt ? (
          <span className={cn("inline-flex items-center gap-1.5", isSoon ? "text-amber-400 font-medium" : "")}>
            <Calendar size={12} />
            {formatShortDate(row.interviewAt)}
            <span className="text-[hsl(var(--muted-foreground))] font-normal">· {relativeTime(row.interviewAt)}</span>
          </span>
        ) : (
          <span className="text-[hsl(var(--muted-foreground))]">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {row.outcome ? <Badge variant={OUTCOME_VARIANT[row.outcome] ?? "secondary"}>{row.outcome}</Badge> : "—"}
      </td>
      <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))] whitespace-nowrap">
        {row.appliedAt ? formatShortDate(row.appliedAt) : "—"}
      </td>
      <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))]">
        {row.interviewRounds?.length ? `${row.interviewRounds.length} round${row.interviewRounds.length === 1 ? "" : "s"}` : "—"}
      </td>
    </tr>
  );
}
