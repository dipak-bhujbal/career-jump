/**
 * Applied Jobs route — review jobs you've applied to and move them
 * through the pipeline (Applied → Interview → Negotiations → Offered
 * / Rejected). Status changes hit /api/jobs/status and refresh both
 * applied + dashboard caches.
 *
 * Layout: prominent status tabs at the top (one per pipeline stage,
 * with live counts), collapsible advanced filters, then grouped lists.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, CheckSquare, LayoutList, LayoutGrid, Bookmark, BookmarkCheck, Trash2, ArrowUpRight } from "lucide-react";
import { FilterToolbar } from "@/components/filter-toolbar";
import { MultiSelect } from "@/components/ui/multi-select";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { CompanyHoverCard } from "@/features/companies/CompanyHoverCard";
import { AppliedKanban } from "@/features/applied/AppliedKanban";
import { JobDetailsDrawer, type DrawerSource } from "@/features/jobs/JobDetailsDrawer";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { UpgradeBanner, UpgradePrompt } from "@/features/billing/upgrade";
import { useApplied, useAppliedKanban, useUpdateStatus, type AppliedFilter } from "@/features/applied/queries";
import { useMe } from "@/features/session/queries";
import { type AppliedStatus, type AppliedJob } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { slugify } from "@/lib/job-filters";
import { toast } from "@/components/ui/toast";
import { useSavedFilters, useSaveFilter, useDeleteFilter, type SavedFilter } from "@/features/filters/queries";

const STATUSES: AppliedStatus[] = ["Applied", "Interview", "Negotiations", "Offered", "Rejected"];

const statusVariant: Record<AppliedStatus, "default" | "warning" | "success" | "danger" | "secondary"> = {
  Applied: "secondary",
  Interview: "warning",
  Negotiations: "default",
  Offered: "success",
  Rejected: "danger",
};

interface AppliedSearch { status?: string; jobKey?: string }

export const Route = createFileRoute("/applied")({
  component: AppliedRoute,
  validateSearch: (s: Record<string, unknown>): AppliedSearch => ({
    status: typeof s.status === "string" ? s.status : undefined,
    jobKey: typeof s.jobKey === "string" ? s.jobKey : undefined,
  }),
});

function AppliedRoute() {
  const search = Route.useSearch();
  const { data: me } = useMe();
  // Hydrate the multi-select status filter from a `?status=Rejected`
  // URL param so dashboard tiles can deep-link into specific stages.
  const initialStatuses = search.status && STATUSES.includes(search.status as AppliedStatus)
    ? [search.status as AppliedStatus]
    : [];
  const [filter, setFilter] = useState<AppliedFilter>({ companies: [], keyword: "", statuses: initialStatuses });
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });
  const [location, setLocation] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(initialStatuses.length > 0);
  const [view, setView] = useState<"list" | "board">("board");
  const [drawerJobKey, setDrawerJobKey] = useState<string | null>(search.jobKey ?? null);
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);

  // React to URL changes — status filter deep-link from dashboard tiles,
  // jobKey deep-link from Recent Activity widget.
  useEffect(() => {
    if (search.status && STATUSES.includes(search.status as AppliedStatus)) {
      setFilter((f) => ({ ...f, statuses: [search.status as AppliedStatus] }));
      setAdvancedOpen(true);
    }
  }, [search.status]);

  useEffect(() => {
    if (search.jobKey) setDrawerJobKey(search.jobKey);
  }, [search.jobKey]);
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterOpen, setSaveFilterOpen] = useState(false);

  const { data, isLoading } = useApplied(filter);
  const kanbanQuery = useAppliedKanban({ enabled: view === "board" });
  const updateStatus = useUpdateStatus();
  // Saved filters only matter once the advanced drawer is expanded, so defer
  // the request until the user actually opens that surface.
  const savedFiltersQuery = useSavedFilters("applied_jobs", { enabled: advancedOpen });
  const saveFilterMutation = useSaveFilter();
  const deleteFilterMutation = useDeleteFilter();
  // Normalize optional API arrays once so empty states cannot crash on `.length`.
  const appliedJobs = useMemo(() => data?.jobs ?? [], [data?.jobs]);
  const companyOptions = useMemo(() => data?.companyOptions ?? [], [data?.companyOptions]);
  const savedFilters = savedFiltersQuery.data?.filters ?? [];

  function handleLoadFilter(sf: SavedFilter) {
    const f = sf.filter as Record<string, unknown>;
    setFilter({
      companies: (f.companies as string[]) ?? [],
      keyword: (f.keyword as string) ?? "",
      statuses: (f.statuses as AppliedStatus[]) ?? [],
    });
    setLocation((f.location as string) ?? "");
    if (f.dateFrom || f.dateTo) {
      setDateRange({
        from: f.dateFrom ? new Date(f.dateFrom as string) : null,
        to: f.dateTo ? new Date(f.dateTo as string) : null,
      });
    }
    toast(`Loaded filter "${sf.name}"`);
  }

  function handleSaveFilter(name: string) {
    saveFilterMutation.mutate(
      {
        name,
        scope: "applied_jobs",
        filter: {
          companies: filter.companies,
          keyword: filter.keyword,
          statuses: filter.statuses,
          location,
          dateFrom: dateRange.from?.toISOString() ?? null,
          dateTo: dateRange.to?.toISOString() ?? null,
        },
      },
      {
        onSuccess: () => {
          toast(`Filter "${name}" saved`);
          setSaveFilterName("");
          setSaveFilterOpen(false);
        },
      },
    );
  }

  function handleDeleteFilter(id: string) {
    deleteFilterMutation.mutate(id, { onSuccess: () => toast("Filter deleted") });
  }
  // Stabilize the empty fallback so downstream memoized filters do not rerun
  // just because `filter.statuses` is currently undefined.
  const selectedStatuses = useMemo(() => filter.statuses ?? [], [filter.statuses]);

  // Resolve drawer from live query data so note/status mutations are reflected
  // immediately without requiring the user to close and reopen the drawer.
  const drawerAppl = drawerJobKey ? appliedJobs.find((j) => j.jobKey === drawerJobKey) ?? null : null;
  const drawer: DrawerSource | null = drawerAppl ? { type: "applied", appl: drawerAppl } : null;

  function toggleStatus(s: AppliedStatus) {
    setFilter((f) => {
      const cur = f.statuses ?? [];
      return { ...f, statuses: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] };
    });
  }

  const groups = useMemo(() => {
    const out: Record<AppliedStatus, AppliedJob[]> = {
      Applied: [], Interview: [], Negotiations: [], Offered: [], Rejected: [],
    };
    for (const job of appliedJobs) {
      const k = (STATUSES.includes(job.status) ? job.status : "Applied") as AppliedStatus;
      out[k].push(job);
    }
    return out;
  }, [appliedJobs]);

  const filteredJobs = useMemo(() => {
    let list = appliedJobs.filter((j) => j.job != null);
    if (filter.keyword?.trim()) {
      const keyword = filter.keyword.trim().toLowerCase();
      list = list.filter((j) => {
        const title = j.job.jobTitle?.toLowerCase() ?? "";
        const company = j.job.company?.toLowerCase() ?? "";
        return title.includes(keyword) || company.includes(keyword);
      });
    }
    if ((filter.companies?.length ?? 0) > 0) {
      const selectedCompanies = new Set((filter.companies ?? []).map((company) => company.toLowerCase()));
      list = list.filter((j) => selectedCompanies.has(j.job.company.toLowerCase()));
    }
    if (selectedStatuses.length > 0) list = list.filter((j) => selectedStatuses.includes(j.status));
    if (location.trim()) {
      const loc = location.trim().toLowerCase();
      list = list.filter((j) => (j.job.location ?? "").toLowerCase().includes(loc));
    }
    if (dateRange.from) {
      const fromMs = dateRange.from.getTime();
      list = list.filter((j) => new Date(j.appliedAt).getTime() >= fromMs);
    }
    if (dateRange.to) {
      const toMs = dateRange.to.getTime() + 86_399_999;
      list = list.filter((j) => new Date(j.appliedAt).getTime() <= toMs);
    }
    return list;
  }, [appliedJobs, selectedStatuses, dateRange, location]);

  const advancedFiltersActive = Boolean(
    (filter.companies?.length ?? 0) || filter.keyword || selectedStatuses.length || dateRange.from || dateRange.to || location,
  );
  const serverBoardJobs = useMemo(
    () => (kanbanQuery.data?.columns ?? []).flatMap((column) => column.jobs),
    [kanbanQuery.data?.columns],
  );
  // Use the dedicated kanban endpoint for the default board so the UI follows
  // the new backend ordering/count contract, but fall back to the richer local
  // filtered dataset whenever the user turns on advanced filters.
  const boardJobs = advancedFiltersActive ? filteredJobs : (serverBoardJobs.length > 0 ? serverBoardJobs : filteredJobs);
  const totalCount = appliedJobs.length;
  const currentPlan = me?.billing?.plan ?? me?.profile?.plan ?? "free";
  const showUpgradeBanner = currentPlan === "free";

  function handleStatusChange(jobKey: string, status: AppliedStatus) {
    updateStatus.mutate({ jobKey, status }, {
      onSuccess: () => toast(`Marked ${status}`),
      onError: (e) => toast(e instanceof Error ? e.message : "Update failed", "error"),
    });
  }

  return (
    <>
      <Topbar
        title="Applied Jobs"
        subtitle={`${totalCount} application${totalCount === 1 ? "" : "s"} across the pipeline`}
      />
      <div className="p-6 space-y-4">
        {showUpgradeBanner ? (
          <UpgradeBanner
            title="Upgrade for more application tracking headroom"
            message="Free accounts can track the essentials, but upgrading gives you more room for applications, richer search coverage, and a bigger active pipeline."
            cta={() => setUpgradePromptOpen(true)}
          />
        ) : null}
        <FilterToolbar
          label={
            <span className="inline-flex items-center gap-2">
              <CheckSquare size={14} />
              {totalCount} application{totalCount === 1 ? "" : "s"}
              {selectedStatuses.length > 0 && (
                <span className="text-[hsl(var(--muted-foreground))]">· {filteredJobs.length} match selected stages</span>
              )}
            </span>
          }
          advanced={advancedOpen}
          onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
          advancedActive={advancedFiltersActive}
          onClearAdvanced={() => {
            setFilter({ companies: [], keyword: "", statuses: [] });
            setDateRange({ from: null, to: null });
            setLocation("");
          }}
          rightSlot={
            <div className="inline-flex rounded-md border border-[hsl(var(--border))] overflow-hidden">
              <button
                type="button"
                onClick={() => setView("board")}
                className={"inline-flex items-center gap-1.5 h-9 px-3 text-sm transition-colors " + (view === "board" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "hover:bg-[hsl(var(--accent))]")}
                aria-pressed={view === "board"}
                title="Board view"
              >
                <LayoutGrid size={14} /> Board
              </button>
              <button
                type="button"
                onClick={() => setView("list")}
                className={"inline-flex items-center gap-1.5 h-9 px-3 text-sm transition-colors border-l border-[hsl(var(--border))] " + (view === "list" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "hover:bg-[hsl(var(--accent))]")}
                aria-pressed={view === "list"}
                title="List view"
              >
                <LayoutList size={14} /> List
              </button>
            </div>
          }
        />

        {advancedOpen && (
          <Card>
            <CardContent className="space-y-5 pt-5">
              {/* Pipeline-stage chips — full width, the most prominent control */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Pipeline stage <span className="text-[hsl(var(--muted-foreground))] font-normal">(select multiple)</span></label>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map((s) => {
                    const active = selectedStatuses.includes(s);
                    const count = groups[s].length;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleStatus(s)}
                        className={
                          "inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border text-sm font-medium transition-all " +
                          (active
                            ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]"
                            : "border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 hover:bg-[hsl(var(--accent))]")
                        }
                        aria-pressed={active}
                      >
                        {s}
                        <span
                          className={
                            "inline-flex items-center justify-center h-5 min-w-5 rounded-full px-1.5 text-xs font-semibold tabular-nums " +
                            (active ? "bg-white/25 text-white" : "bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]")
                          }
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Consistent 4-field row: Job title · Companies · Location · Date range. */}
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Job title</label>
                  <Input
                    value={filter.keyword}
                    onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
                    placeholder="e.g. Senior, Platform, Infra"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Companies</label>
                  {companyOptions.length === 0 ? (
                    <div className="h-9 flex items-center text-sm text-[hsl(var(--muted-foreground))] italic">No companies yet</div>
                  ) : (
                    <MultiSelect
                      options={companyOptions}
                      value={filter.companies ?? []}
                      onChange={(next) => setFilter((f) => ({ ...f, companies: next }))}
                      placeholder="All companies"
                      noun="companies"
                    />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Location</label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="USA, Remote, NY…"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Applied between</label>
                  <DateRangePicker value={dateRange} onChange={setDateRange} placeholder="Any date" />
                </div>
              </div>
              <AppliedSavedFiltersPanel
                savedFilters={savedFilters}
                currentFilter={filter}
                location={location}
                dateRange={dateRange}
                onLoad={handleLoadFilter}
                onDelete={handleDeleteFilter}
                onSave={handleSaveFilter}
                saveFilterName={saveFilterName}
                onSaveFilterNameChange={setSaveFilterName}
                saveFilterOpen={saveFilterOpen}
                onSaveFilterOpenChange={setSaveFilterOpen}
                isSaving={saveFilterMutation.isPending}
              />
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 rounded-md bg-[hsl(var(--muted))] animate-pulse" />)}
          </div>
        )}

        {!isLoading && filteredJobs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              {selectedStatuses.length
                ? `Nothing in ${selectedStatuses.join(" / ")} yet. Apply or move a job to one of these stages.`
                : "No applications yet. Apply from the Available Jobs tab and they'll appear here."}
            </CardContent>
          </Card>
        )}

        {/* Board view = drag-and-drop kanban. List view = grouped lists. */}
        {!isLoading && filter.companies?.length === 1 && (
          <Card>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium">Focused company pipeline</div>
                <div className="text-sm text-[hsl(var(--muted-foreground))]">
                  Open a company-only board and list view for {filter.companies[0]}.
                </div>
              </div>
              <a
                href={`/companies/${slugify(filter.companies[0])}/applied`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[hsl(var(--border))] px-4 text-sm font-medium transition-all duration-100 ease-out shadow-sm hover:-translate-y-px hover:bg-[hsl(var(--accent))] hover:shadow-md"
              >
                Open company view <ArrowUpRight size={14} />
              </a>
            </CardContent>
          </Card>
        )}
        {!isLoading && boardJobs.length > 0 && view === "board" && (
          <AppliedKanban jobs={boardJobs} onSelect={(appl) => setDrawerJobKey(appl.jobKey)} />
        )}
        {!isLoading && filteredJobs.length > 0 && view === "list" && STATUSES.map((status) => {
          const list = filteredJobs.filter((j) => j.status === status);
          if (list.length === 0) return null;
          return (
            <ApplicationList
              key={status}
              status={status}
              applications={list}
              onStatusChange={handleStatusChange}
              onSelect={(appl) => setDrawerJobKey(appl.jobKey)}
            />
          );
        })}
      </div>
      <JobDetailsDrawer source={drawer} onClose={() => setDrawerJobKey(null)} />
      <UpgradePrompt
        open={upgradePromptOpen}
        onClose={() => setUpgradePromptOpen(false)}
        currentPlan={currentPlan}
        title="Upgrade to track more of your search"
        body="Move beyond the free tier to raise application and job limits so your pipeline can scale with the rest of your search."
      />
    </>
  );
}

function ApplicationList({ status, applications, onStatusChange, onSelect }: {
  status: AppliedStatus;
  applications: AppliedJob[];
  onStatusChange: (jobKey: string, status: AppliedStatus) => void;
  onSelect: (appl: AppliedJob) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Badge variant={statusVariant[status]}>{status}</Badge>
          <span className="text-sm font-normal text-[hsl(var(--muted-foreground))]">
            {applications.length} {applications.length === 1 ? "application" : "applications"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 border-t border-[hsl(var(--border))]">
        <div className="divide-y divide-[hsl(var(--border))]">
          {applications.map((appl) => (
            <div
              key={appl.jobKey}
              onClick={() => onSelect(appl)}
              className="grid grid-cols-12 gap-3 px-5 py-3 items-center cursor-pointer hover:bg-[hsl(var(--accent))]/40 transition-colors"
            >
              <div className="col-span-3 min-w-0">
                <div className="text-sm text-[hsl(var(--muted-foreground))]">
                  <CompanyHoverCard company={appl.job.company}>
                    <a
                      href={`/companies/${slugify(appl.job.company)}/applied`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {appl.job.company}
                    </a>
                  </CompanyHoverCard>
                </div>
                <div className="font-medium text-base truncate">{appl.job.jobTitle}</div>
              </div>
              <div className="col-span-2 text-sm text-[hsl(var(--muted-foreground))]">
                <div>Applied</div>
                <div>{formatShortDate(appl.appliedAt)}</div>
              </div>
              <div className="col-span-2 text-sm text-[hsl(var(--muted-foreground))]">
                {appl.job.postedAtDate || appl.job.postedAt ? (
                  <>
                    <div>Posted</div>
                    <div>{formatShortDate((appl.job.postedAtDate ?? appl.job.postedAt)!)}</div>
                  </>
                ) : (
                  <span className="text-[hsl(var(--muted-foreground))]/50">—</span>
                )}
              </div>
              <div className="col-span-3" onClick={(e) => e.stopPropagation()}>
                <Select
                  value={appl.status}
                  onChange={(e) => onStatusChange(appl.jobKey, e.target.value as AppliedStatus)}
                  className="h-9 text-sm"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div className="col-span-2 flex justify-end">
                <a href={appl.job.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                   className="inline-flex items-center gap-1 text-[hsl(var(--primary))] text-sm hover:underline">
                  <ExternalLink size={13} /> Open
                </a>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AppliedSavedFiltersPanel({
  savedFilters, currentFilter, location, dateRange,
  onLoad, onDelete, onSave,
  saveFilterName, onSaveFilterNameChange,
  saveFilterOpen, onSaveFilterOpenChange,
  isSaving,
}: {
  savedFilters: SavedFilter[];
  currentFilter: AppliedFilter;
  location: string;
  dateRange: DateRangeValue;
  onLoad: (f: SavedFilter) => void;
  onDelete: (id: string) => void;
  onSave: (name: string) => void;
  saveFilterName: string;
  onSaveFilterNameChange: (v: string) => void;
  saveFilterOpen: boolean;
  onSaveFilterOpenChange: (v: boolean) => void;
  isSaving: boolean;
}) {
  const hasActiveFilter = Boolean(
    (currentFilter.companies?.length ?? 0) || currentFilter.keyword ||
    (currentFilter.statuses?.length ?? 0) || location || dateRange.from || dateRange.to,
  );

  return (
    <div className="border-t border-[hsl(var(--border))] pt-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">Saved filters</span>
        {hasActiveFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSaveFilterOpenChange(!saveFilterOpen)}
            className="gap-1.5 h-7 text-xs"
          >
            <Bookmark size={12} /> Save current
          </Button>
        )}
      </div>

      {saveFilterOpen && (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={saveFilterName}
            onChange={(e) => onSaveFilterNameChange(e.target.value)}
            placeholder="Filter name…"
            className="h-8 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && saveFilterName.trim()) onSave(saveFilterName.trim());
              if (e.key === "Escape") onSaveFilterOpenChange(false);
            }}
          />
          <Button size="sm" className="h-8" disabled={!saveFilterName.trim() || isSaving} onClick={() => onSave(saveFilterName.trim())}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => onSaveFilterOpenChange(false)}>Cancel</Button>
        </div>
      )}

      {savedFilters.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] italic">No saved filters yet. Set filters and click "Save current".</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {savedFilters.map((sf) => (
            <div key={sf.id} className="inline-flex items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 text-sm pl-2.5 pr-1 h-8">
              <BookmarkCheck size={12} className="text-[hsl(var(--primary))] shrink-0" />
              <button type="button" className="hover:underline" onClick={() => onLoad(sf)}>{sf.name}</button>
              <button
                type="button"
                className="ml-1 p-1 rounded hover:bg-rose-500/10 text-[hsl(var(--muted-foreground))] hover:text-rose-400 transition-colors"
                onClick={() => onDelete(sf.id)}
                title="Delete filter"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
