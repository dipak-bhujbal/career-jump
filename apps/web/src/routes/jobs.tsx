/**
 * Available Jobs route.
 *
 * Adds Wave-1 power-user features on top of the standard table+filters:
 *   - j / k navigation through visible rows
 *   - enter opens drawer for the focused row
 *   - e applies the focused row, x discards
 *   - / focuses the keyword filter
 *   - Multi-select via checkboxes (shift-click for range)
 *   - BulkActionBar floats at the bottom while selection is active
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw, Sparkles, Plus, Briefcase, Globe, Clock, X, ChevronLeft, ChevronRight } from "lucide-react";
import { FilterToolbar } from "@/components/filter-toolbar";
import { Select } from "@/components/ui/select";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MultiSelect } from "@/components/ui/multi-select";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { JobsTable, type SortCol, type SortDir } from "@/features/jobs/JobsTable";
import { JobDetailsDrawer } from "@/features/jobs/JobDetailsDrawer";
import { BulkActionBar } from "@/features/jobs/BulkActionBar";
import { useApplyJob, useDiscardJob, useJobs, useManualAddJob, type JobsFilter } from "@/features/jobs/queries";
import { useSavedFilters, useSaveFilter, useDeleteFilter } from "@/features/filters/queries";
import { Dialog } from "@/components/ui/dialog";
import { ApiError, type Job } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useHotkey } from "@/lib/hotkeys";
import { UpgradeBanner, UpgradePrompt } from "@/features/billing/upgrade";
import { useMe } from "@/features/session/queries";

interface JobsSearch { new?: string; updated?: string; q?: string }

export const Route = createFileRoute("/jobs")({
  component: JobsRoute,
  validateSearch: (s: Record<string, unknown>): JobsSearch => ({
    new: typeof s.new === "string" ? s.new : undefined,
    updated: typeof s.updated === "string" ? s.updated : undefined,
    q: typeof s.q === "string" ? s.q : undefined,
  }),
});

function JobsRoute() {
  const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
  const search = Route.useSearch();
  const [filter, setFilter] = useState<JobsFilter>({
    companies: [],
    location: "",
    keyword: search.q ?? "",
    duration: "",
    source: "",
    usOnly: false,
    newOnly: search.new === "1",
    updatedOnly: search.updated === "1",
  });
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(0);

  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });
  const [selected, setSelected] = useState<Job | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(search.new === "1" || search.updated === "1" || search.q));

  // Re-sync filter state from URL changes — e.g. dashboard tile click
  // navigates here while we're already mounted.
  useEffect(() => {
    setFilter((f) => ({
      ...f,
      keyword: search.q ?? f.keyword,
      newOnly: search.new === "1",
      updatedOnly: search.updated === "1",
    }));
    if (search.new === "1" || search.updated === "1" || search.q) setAdvancedOpen(true);
  }, [search.new, search.updated, search.q]);
  const [sortBy, setSortBy] = useState<SortCol>("posted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const lastCheckedIndexRef = useRef<number | null>(null);
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { data: me } = useMe();

  // Resizable split pane — persists list-pane width across sessions.
  const [listPaneWidth, setListPaneWidth] = useState(() => Number(localStorage.getItem("cj_split_width")) || 620);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = listPaneWidth;
    e.preventDefault();
  }, [listPaneWidth]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const next = Math.max(320, Math.min(window.innerWidth - 340, dragStartW.current + e.clientX - dragStartX.current));
      setListPaneWidth(next);
    }
    function onMouseUp() { isDragging.current = false; }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => { document.removeEventListener("mousemove", onMouseMove); document.removeEventListener("mouseup", onMouseUp); };
  }, []);

  useEffect(() => { localStorage.setItem("cj_split_width", String(listPaneWidth)); }, [listPaneWidth]);

  const jobsQueryFilter = useMemo(
    () => ({
      ...filter,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [filter, page, pageSize],
  );
  const { data, isLoading, isFetching } = useJobs(jobsQueryFilter);
  const apply = useApplyJob();
  const discard = useDiscardJob();
  // Saved filters only matter while the advanced drawer is open, so defer the
  // request until the user actually expands that surface.
  const savedFiltersQuery = useSavedFilters("available_jobs", { enabled: advancedOpen });
  const saveFilter = useSaveFilter();
  const deleteFilter = useDeleteFilter();
  const [saveFilterName, setSaveFilterName] = useState("");
  const [saveFilterOpen, setSaveFilterOpen] = useState(false);

  const total = data?.total ?? 0;
  const totals = data?.totals;
  const pagination = data?.pagination;
  const companyOptions = data?.companyOptions ?? [];
  // Client-side date filter on the loaded page. Server-side
  // postedFrom/postedTo support is a backend follow-up.
  const allJobs = data?.jobs ?? [];
  const filteredJobs = useMemoFilter(allJobs, dateRange);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Client-side column sort — default: newest posted first.
  const jobs = useMemo(() => {
    const arr = [...filteredJobs];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let cmp: number;
      switch (sortBy) {
        case "company":  cmp = (a.company ?? "").localeCompare(b.company ?? ""); break;
        case "title":    cmp = (a.jobTitle ?? "").localeCompare(b.jobTitle ?? ""); break;
        case "location": cmp = (a.location ?? "").localeCompare(b.location ?? ""); break;
        case "source":   cmp = (a.source ?? "").localeCompare(b.source ?? ""); break;
        case "posted":
        default:
          cmp = (new Date(a.postedAtDate ?? 0).getTime()) - (new Date(b.postedAtDate ?? 0).getTime());
      }
      return cmp * dir;
    });
    return arr;
  }, [filteredJobs, sortBy, sortDir]);
  const pageStart = total === 0 ? 0 : page * pageSize + 1;
  const pageEnd = total === 0 ? 0 : Math.min(total, page * pageSize + jobs.length);

  function handleSort(col: SortCol) {
    setSortBy((prev) => {
      if (prev === col) { setSortDir((d) => d === "asc" ? "desc" : "asc"); return col; }
      setSortDir(col === "posted" ? "desc" : "asc");
      return col;
    });
  }

  // Always resolve the selected job from live query data so note/round mutations
  // are reflected immediately without requiring the user to re-click the row.
  const freshSelected = selected ? (allJobs.find((j) => j.jobKey === selected.jobKey) ?? selected) : null;

  // Reset focus when filters change.
  useEffect(() => { setFocusedIndex(0); }, [data?.jobs?.length]);
  useEffect(() => {
    // Filter changes can dramatically shrink the result set. Jump back to the
    // first page so the user does not land on an empty offset from the old
    // broader query.
    setPage(0);
  }, [
    filter.companies,
    filter.duration,
    filter.keyword,
    filter.location,
    filter.newOnly,
    filter.source,
    filter.updatedOnly,
    filter.usOnly,
    dateRange.from,
    dateRange.to,
  ]);
  useEffect(() => {
    // Changing page size invalidates the prior offset math, so restart from
    // page one to keep the visible slice predictable.
    setPage(0);
  }, [pageSize]);
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);
  useEffect(() => {
    // Multi-select and drawer state should follow the visible page rather than
    // pointing at jobs that are no longer mounted.
    setChecked(new Set());
    setSelected(null);
  }, [page, pageSize]);

  function openUpgrade() {
    setUpgradeOpen(true);
  }

  function handleApplyError(err: unknown) {
    if (err instanceof ApiError && err.status === 402 && (err.data as { error?: string }).error === "applied_jobs_limit_reached") {
      setUpgradeOpen(true);
      return;
    }
    toast(err instanceof Error ? err.message : "Apply failed", "error");
  }

  // Hotkeys.
  useHotkey({ id: "jobs-down", description: "Move focus down", category: "Jobs", key: "j" }, () => setFocusedIndex((i) => Math.min(jobs.length - 1, i + 1)));
  useHotkey({ id: "jobs-up", description: "Move focus up", category: "Jobs", key: "k" }, () => setFocusedIndex((i) => Math.max(0, i - 1)));
  useHotkey({ id: "jobs-open", description: "Open focused job", category: "Jobs", key: "Enter" }, () => {
    const job = jobs[focusedIndex];
    if (job) setSelected(job);
  });
  useHotkey({ id: "jobs-apply", description: "Apply to focused job", category: "Jobs", key: "e" }, () => {
    const job = jobs[focusedIndex];
    if (!job) return;
    apply.mutate({ jobKey: job.jobKey }, {
      onSuccess: () => toast(`Applied to ${job.jobTitle}`),
      onError: handleApplyError,
    });
  });
  useHotkey({ id: "jobs-discard", description: "Discard focused job", category: "Jobs", key: "x" }, () => {
    const job = jobs[focusedIndex];
    if (!job) return;
    discard.mutate(job.jobKey, {
      onSuccess: () => toast("Discarded", "info"),
      onError: (err) => toast(err instanceof Error ? err.message : "Discard failed", "error"),
    });
  });
  useHotkey({ id: "jobs-search", description: "Focus keyword filter", category: "Jobs", key: "/" }, () => {
    keywordInputRef.current?.focus();
    keywordInputRef.current?.select();
  });
  useHotkey({ id: "jobs-clear-sel", description: "Clear selection", category: "Jobs", key: "Escape" }, () => setChecked(new Set()));

  // Scroll focused row into view when j/k moves it.
  useEffect(() => {
    const job = jobs[focusedIndex];
    if (!job) return;
    const row = document.querySelector(`[data-job-row="${job.jobKey}"]`);
    row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedIndex, jobs]);

  function refresh() { qc.invalidateQueries({ queryKey: ["jobs"] }); }

  function toggleChecked(key: string, options?: { range?: boolean }) {
    const idx = jobs.findIndex((j) => j.jobKey === key);
    setChecked((prev) => {
      const next = new Set(prev);
      if (options?.range && lastCheckedIndexRef.current !== null) {
        const [a, b] = [lastCheckedIndexRef.current, idx].sort((x, y) => x - y);
        const wantsCheck = !next.has(key);
        for (let i = a; i <= b; i++) {
          const k = jobs[i]?.jobKey;
          if (!k) continue;
          if (wantsCheck) next.add(k); else next.delete(k);
        }
      } else {
        if (next.has(key)) next.delete(key); else next.add(key);
      }
      return next;
    });
    lastCheckedIndexRef.current = idx;
  }

  return (
    <>
      <Topbar
        title="Available Jobs"
        subtitle={
          totals
            ? `${total.toLocaleString()} matching · ${totals.newJobs} new · ${totals.updatedJobs} updated`
            : "Fresh listings from your tracked companies"
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setManualOpen(true)}>
              <Plus size={13} /> Add manually
            </Button>
          </>
        }
      />
      <div className={selected ? "flex min-h-0 flex-1 overflow-hidden" : "p-6 space-y-4"}>
        {/* Left pane: filters + table */}
        <div
          className={selected ? "flex flex-col overflow-y-auto p-6 space-y-4 flex-shrink-0" : "contents"}
          style={selected ? { width: listPaneWidth } : undefined}
        >
        <FilterToolbar
          label={
            <span className="inline-flex items-center gap-2">
              <Briefcase size={14} />
              {jobs.length.toLocaleString()} of {total.toLocaleString()} matching
            </span>
          }
          advanced={advancedOpen}
          onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
          advancedActive={Boolean((filter.companies?.length ?? 0) || filter.location || filter.keyword || filter.duration || filter.source || filter.usOnly || filter.newOnly || filter.updatedOnly || dateRange.from || dateRange.to)}
          onClearAdvanced={() => {
            setFilter({ companies: [], location: "", keyword: "", duration: "", source: "", usOnly: false, newOnly: false, updatedOnly: false });
            setDateRange({ from: null, to: null });
          }}
        />

        {totals?.jobsCapped ? (
          <UpgradeBanner
            message={`${(totals.totalAvailableJobs ?? total).toLocaleString()} jobs matched, but your current plan only shows ${totals.jobCapLimit ?? total}. Upgrade to unlock the rest.`}
            cta={openUpgrade}
          />
        ) : null}

        {/* Advanced filters card — page-specific quick filters at the top
            (New/Updated chips), then the consistent 4-field row below. */}
        {advancedOpen && (
          <Card>
            <CardContent className="space-y-5 pt-5">
              <div className="space-y-2">
                <label className="text-sm font-medium">Show <span className="text-[hsl(var(--muted-foreground))] font-normal">(quick filter)</span></label>
                <div className="flex flex-wrap gap-2">
                  <ChipToggle
                    active={!filter.newOnly && !filter.updatedOnly}
                    onClick={() => setFilter((f) => ({ ...f, newOnly: false, updatedOnly: false }))}
                    icon={<Briefcase size={15} />}
                    label="All jobs"
                    count={total}
                  />
                  <ChipToggle
                    active={filter.newOnly === true}
                    onClick={() => setFilter((f) => ({ ...f, newOnly: !f.newOnly, updatedOnly: false }))}
                    icon={<Sparkles size={15} />}
                    label="New"
                    count={totals?.newJobs}
                  />
                  <ChipToggle
                    active={filter.updatedOnly === true}
                    onClick={() => setFilter((f) => ({ ...f, updatedOnly: !f.updatedOnly, newOnly: false }))}
                    icon={<RefreshCw size={15} />}
                    label="Updated"
                    count={totals?.updatedJobs}
                  />
                  <ChipToggle
                    active={filter.usOnly === true}
                    onClick={() => setFilter((f) => ({ ...f, usOnly: !f.usOnly }))}
                    icon={<Globe size={15} />}
                    label="US only"
                  />
                </div>
              </div>

              {/* Filter grid — 6 fields: title, companies, location, date range, duration, source */}
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Job title</label>
                  <Input
                    ref={keywordInputRef}
                    value={filter.keyword}
                    onChange={(e) => setFilter((f) => ({ ...f, keyword: e.target.value }))}
                    placeholder="e.g. Senior, Platform, Infra"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Companies</label>
                  {companyOptions.length === 0 ? (
                    <div className="h-9 flex items-center text-sm text-[hsl(var(--muted-foreground))] italic">No companies tracked yet</div>
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
                    value={filter.location}
                    onChange={(e) => setFilter((f) => ({ ...f, location: e.target.value }))}
                    placeholder="USA, Remote, NY…"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5"><Clock size={13} /> Posted within</label>
                  <div className="flex items-center gap-1">
                    <Select
                      value={filter.duration ?? ""}
                      onChange={(e) => setFilter((f) => ({ ...f, duration: e.target.value }))}
                      className="h-9 text-sm flex-1"
                    >
                      <option value="">Any time</option>
                      <option value="1h">Last 1 hour</option>
                      <option value="3h">Last 3 hours</option>
                      <option value="1d">Last 24 hours</option>
                      <option value="3d">Last 3 days</option>
                      <option value="1w">Last week</option>
                      <option value="2w">Last 2 weeks</option>
                      <option value="1m">Last month</option>
                      <option value="3m">Last 3 months</option>
                    </Select>
                    {filter.duration && (
                      <button
                        type="button"
                        title="Clear duration filter"
                        onClick={() => setFilter((f) => ({ ...f, duration: "" }))}
                        className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">ATS / Source</label>
                  <div className="flex items-center gap-1">
                    <Select
                      value={filter.source ?? ""}
                      onChange={(e) => setFilter((f) => ({ ...f, source: e.target.value }))}
                      className="h-9 text-sm flex-1"
                    >
                      <option value="">All sources</option>
                      <option value="workday">Workday</option>
                      <option value="greenhouse">Greenhouse</option>
                      <option value="ashby">Ashby</option>
                      <option value="lever">Lever</option>
                      <option value="smartrecruiters">SmartRecruiters</option>
                      <option value="manual">Manual</option>
                    </Select>
                    {filter.source && (
                      <button
                        type="button"
                        title="Clear source filter"
                        onClick={() => setFilter((f) => ({ ...f, source: "" }))}
                        className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Posted between</label>
                  <DateRangePicker value={dateRange} onChange={setDateRange} placeholder="Any date" />
                </div>
              </div>

              {/* Saved filters — load a preset or save the current filter state */}
              <SavedFiltersPanel
                savedFilters={savedFiltersQuery.data?.filters ?? []}
                currentFilter={filter}
                dateRange={dateRange}
                onLoad={(sf) => {
                  const f = sf.filter as Partial<JobsFilter & { dateFrom?: string; dateTo?: string }>;
                  setFilter((prev) => ({
                    ...prev,
                    keyword: f.keyword ?? "",
                    location: f.location ?? "",
                    duration: f.duration ?? "",
                    source: f.source ?? "",
                    usOnly: f.usOnly ?? false,
                    newOnly: f.newOnly ?? false,
                    updatedOnly: f.updatedOnly ?? false,
                    companies: (f.companies as string[]) ?? [],
                  }));
                  if (f.dateFrom || f.dateTo) {
                    setDateRange({ from: f.dateFrom ? new Date(f.dateFrom) : null, to: f.dateTo ? new Date(f.dateTo) : null });
                  }
                }}
                onDelete={(id) => deleteFilter.mutate(id)}
                onSave={(name) => {
                  saveFilter.mutate({
                    name,
                    scope: "available_jobs",
                    filter: {
                      ...filter,
                      dateFrom: dateRange.from?.toISOString(),
                      dateTo: dateRange.to?.toISOString(),
                    },
                  }, {
                    onSuccess: () => { toast("Filter saved"); setSaveFilterOpen(false); setSaveFilterName(""); },
                    onError: (e) => toast(e instanceof Error ? e.message : "Save failed", "error"),
                  });
                }}
                saveFilterName={saveFilterName}
                onSaveFilterNameChange={setSaveFilterName}
                saveFilterOpen={saveFilterOpen}
                onSaveFilterOpenChange={setSaveFilterOpen}
                isSaving={saveFilter.isPending}
              />
            </CardContent>
          </Card>
        )}

        <Card className="p-0">
          <CardHeader className="border-b border-[hsl(var(--border))] flex-row items-center justify-between">
            <CardTitle>
              {filter.newOnly ? "New jobs" : filter.updatedOnly ? "Updated jobs" : "All jobs"}
            </CardTitle>
            <CardDescription className="text-sm">
              Showing {pageStart.toLocaleString()}-{pageEnd.toLocaleString()} of {total.toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <JobsTable
              jobs={jobs}
              onSelect={setSelected}
              selectedKey={selected?.jobKey}
              checked={checked}
              onToggleChecked={toggleChecked}
              focusedIndex={focusedIndex}
              isLoading={isLoading}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={handleSort}
            />
            <div className="flex flex-col gap-3 border-t border-[hsl(var(--border))] px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                Page {Math.min(page + 1, totalPages).toLocaleString()} of {totalPages.toLocaleString()}
                {pagination?.hasMore ? " · more results available" : ""}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                  <span>Jobs per page</span>
                  <Select
                    value={String(pageSize)}
                    onChange={(e) => setPageSize(Number(e.target.value) || 10)}
                    className="w-[92px]"
                  >
                    {PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </Select>
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                    disabled={page === 0}
                  >
                    <ChevronLeft size={14} />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => (current + 1 < totalPages ? current + 1 : current))}
                    disabled={page + 1 >= totalPages}
                  >
                    Next
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        </div>{/* end left pane */}

        {/* Drag divider + inline right pane (split mode only) */}
        {freshSelected && (
          <>
            <div
              className="w-1.5 flex-shrink-0 cursor-col-resize bg-[hsl(var(--border))] hover:bg-[hsl(var(--primary))]/40 transition-colors"
              onMouseDown={onDividerMouseDown}
            />
            <div className="flex-1 min-w-0 overflow-hidden">
              <JobDetailsDrawer
                source={{ type: "available", job: freshSelected }}
                onClose={() => setSelected(null)}
                inline
              />
            </div>
          </>
        )}
      </div>

      {/* Overlay drawer (no-split fallback — never used when selected is set) */}
      {!selected && (
        <JobDetailsDrawer
          source={null}
          onClose={() => setSelected(null)}
        />
      )}
      <BulkActionBar selected={checked} onClear={() => setChecked(new Set())} />
      <ManualAddJobDialog open={manualOpen} onClose={() => setManualOpen(false)} />
      <UpgradePrompt
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentPlan={me?.billing?.plan ?? me?.profile?.plan ?? "free"}
        title="Upgrade to unlock more jobs"
        body="Your current plan has reached its visible or applied job limit. Upgrade with Stripe Checkout to keep moving."
      />
    </>
  );
}


/** Quick-filter chip with count — used for page-specific filters
 *  (New / Updated on Jobs, Outcome on Plan, Pipeline stage on Applied). */
function ChipToggle({ active, onClick, icon, label, count }: {
  active?: boolean; onClick: () => void; icon?: React.ReactNode; label: string; count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-sm font-medium transition-all " +
        (active
          ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 hover:bg-[hsl(var(--accent))]")
      }
    >
      {icon && <span className={active ? "" : "text-[hsl(var(--muted-foreground))]"}>{icon}</span>}
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span className={
          "inline-flex items-center justify-center h-5 min-w-5 rounded-full px-1.5 text-xs font-semibold tabular-nums " +
          (active ? "bg-white/25 text-white" : "bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]")
        }>
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

/** Client-side date range filter on the loaded jobs page. The job's
 *  `postedAt` field is an ET-formatted string from the backend; we parse
 *  it as a Date and inclusively filter by the chosen range. */
function useMemoFilter(jobs: Job[], range: DateRangeValue): Job[] {
  return useMemo(() => {
    if (!range.from && !range.to) return jobs;
    const fromMs = range.from ? range.from.getTime() : -Infinity;
    const toMs = range.to ? range.to.getTime() + 86_399_999 : Infinity;
    return jobs.filter((j) => {
      const t = j.postedAt ? new Date(j.postedAt).getTime() : NaN;
      if (Number.isNaN(t)) return true; // keep entries with unparseable dates
      return t >= fromMs && t <= toMs;
    });
  }, [jobs, range]);
}

function ManualAddJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ company: "", jobTitle: "", url: "", location: "", notes: "" });
  const add = useManualAddJob();
  function reset() { setForm({ company: "", jobTitle: "", url: "", location: "", notes: "" }); }
  function submit() {
    if (!form.company.trim() || !form.jobTitle.trim()) {
      toast("Company and Title are required", "error");
      return;
    }
    add.mutate(form, {
      onSuccess: () => { toast("Job added"); reset(); onClose(); },
      onError: (e) => toast(e instanceof Error ? e.message : "Add failed", "error"),
    });
  }
  return (
    <Dialog open={open} onClose={onClose} size="md">
      <div className="p-6 space-y-5">
        <div>
          <h3 className="text-xl font-semibold">Add job manually</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">For postings the scanner missed or links from email.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company *"><Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} /></Field>
          <Field label="Title *"><Input value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} /></Field>
          <Field label="URL" className="col-span-2"><Input type="url" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} /></Field>
          <Field label="Location"><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></Field>
        </div>
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="w-full min-h-[100px] rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="warning" onClick={onClose}>Cancel</Button>
          <Button variant="success" onClick={submit} disabled={add.isPending}>{add.isPending ? "Adding…" : "Add job"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-sm font-medium block mb-1.5">{label}</label>
      {children}
    </div>
  );
}

import type { SavedFilter } from "@/features/filters/queries";
import { Bookmark, BookmarkCheck, Trash2 } from "lucide-react";

function SavedFiltersPanel({
  savedFilters, currentFilter, dateRange,
  onLoad, onDelete, onSave,
  saveFilterName, onSaveFilterNameChange,
  saveFilterOpen, onSaveFilterOpenChange,
  isSaving,
}: {
  savedFilters: SavedFilter[];
  currentFilter: JobsFilter;
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
    (currentFilter.companies?.length ?? 0) || currentFilter.keyword || currentFilter.location ||
    currentFilter.duration || currentFilter.source || currentFilter.usOnly ||
    currentFilter.newOnly || currentFilter.updatedOnly || dateRange.from || dateRange.to
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
