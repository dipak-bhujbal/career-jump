/**
 * Configuration route — Week-1 deliverable, the proof-of-concept page.
 *
 * Big-picture flow:
 *   1. Load the live config + registry meta with TanStack Query.
 *   2. User opens the picker dialog (CompanyPicker) and adds entries
 *      from the registry (1,200+ pre-discovered) or a custom row.
 *   3. The page tracks a local "draft" alongside the server "baseline";
 *      Save and Cancel buttons appear when they diverge.
 *   4. Save posts the draft back via /api/config/save and refreshes.
 *
 * The page intentionally re-implements the dirty / save / cancel UX
 * from the vanilla app rather than auto-saving — same user mental
 * model, less risk of accidental commits.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Save, X, Building2, Sparkles, PencilLine, Search } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CompanyPicker } from "@/features/companies/CompanyPicker";
import { CompanyTable } from "@/features/companies/CompanyTable";
import {
  useConfig,
  useSaveConfig,
  useToggleCompany,
  configKey,
} from "@/features/companies/queries";
import { useToggleAllCompanies } from "@/features/run/queries";
import { useQueryClient } from "@tanstack/react-query";
import { type CompanyConfig, type RegistryEntry } from "@/lib/api";
import { companyKey, formatAtsLabel } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { FilterToolbar } from "@/components/filter-toolbar";
import { Select } from "@/components/ui/select";
import { UpgradeBanner, UpgradePrompt } from "@/features/billing/upgrade";
import { parseConfiguredAts } from "@/lib/job-filters";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/configuration")({ component: ConfigurationRoute });

import { ALL_ATS_ADAPTERS } from "@/lib/job-filters";

// All adapter IDs the backend can handle (registry-driven + legacy scan path).
const ALL_ATS_IDS = new Set(ALL_ATS_ADAPTERS.map((a) => a.id));

/** Normalise a registry ATS string to the canonical adapter ID, or "" if unknown. */
function normalizeRegistryAts(ats: string | null | undefined): string {
  const id = String(ats ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return ALL_ATS_IDS.has(id as never) ? id : "";
}

function canonicalBoardUrlForRegistryEntry(
  entry: RegistryEntry,
  normalizedSource: string,
  parsedAts: ReturnType<typeof parseConfiguredAts>,
): string {
  switch (normalizedSource) {
    case "workday":
      return ("workdayBaseUrl" in parsedAts && parsedAts.workdayBaseUrl) || entry.board_url || entry.sample_url || "";
    case "greenhouse":
      return ("boardToken" in parsedAts && parsedAts.boardToken)
        ? `https://job-boards.greenhouse.io/${parsedAts.boardToken}`
        : entry.board_url || entry.sample_url || "";
    case "ashby":
      return ("companySlug" in parsedAts && parsedAts.companySlug)
        ? `https://jobs.ashbyhq.com/${parsedAts.companySlug}`
        : entry.board_url || entry.sample_url || "";
    case "lever":
      return ("leverSite" in parsedAts && parsedAts.leverSite)
        ? `https://jobs.lever.co/${parsedAts.leverSite}`
        : entry.board_url || entry.sample_url || "";
    case "smartrecruiters":
      return ("smartRecruitersCompanyId" in parsedAts && parsedAts.smartRecruitersCompanyId)
        ? `https://jobs.smartrecruiters.com/${parsedAts.smartRecruitersCompanyId}`
        : entry.board_url || entry.sample_url || "";
    default:
      return entry.board_url || entry.sample_url || "";
  }
}

function ConfigurationRoute() {
  const CONFIG_PAGE_SIZE = 20;
  const { data: me } = useMe();
  const config = useConfig();
  const saveConfig = useSaveConfig();
  const toggleScan = useToggleCompany();
  const toggleAll = useToggleAllCompanies();
  const qc = useQueryClient();

  const [draftCompanies, setDraftCompanies] = useState<CompanyConfig[]>([]);
  const [draftKeywords, setDraftKeywords] = useState<{ includeKeywords: string[]; excludeKeywords: string[] }>({ includeKeywords: [], excludeKeywords: [] });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "registry" | "custom">("all");
  const [companySearch, setCompanySearch] = useState("");
  const [atsFilter, setAtsFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "enabled" | "paused">();
  const [companyPage, setCompanyPage] = useState(0);
  const [editingKeywords, setEditingKeywords] = useState(false);
  const [upgradePromptOpen, setUpgradePromptOpen] = useState(false);
  const [adminRegistryMode, setAdminRegistryMode] = useState<"all" | "none">("all");

  // Reset draft when server config arrives, but only when the draft is
  // still in sync with the server (no unsaved local additions/edits).
  // Without this guard, toggle-scan would invalidate configKey → refetch
  // → useEffect fires → draft reset, discarding unsaved additions.
  useEffect(() => {
    const serverCompanies = config.data?.config?.companies;
    if (!serverCompanies) return;
    setDraftCompanies((current) => {
      if (current.length === 0 ||
          JSON.stringify(normalize(current)) === JSON.stringify(normalize(serverCompanies))) {
        // Backfill registryAts/isRegistry for companies saved before these fields
        // were persisted. If a company has a source but no registryAts it was
        // almost certainly added via the registry picker — infer the display label.
        return serverCompanies.map((c) => ({
          ...c,
          // Respect persisted registry provenance first so custom rows remain
          // editable after a save/refresh round-trip.
          isRegistry: c.isRegistry === true || Boolean(c.registryAts || c.registryTier),
          registryAts: c.registryAts || (c.source ? formatAtsLabel(c.source) : ""),
        }));
      }
      return current;
    });
    setDraftKeywords(config.data?.config?.jobtitles ?? { includeKeywords: [], excludeKeywords: [] });
    setAdminRegistryMode(config.data?.config?.adminRegistryMode === "none" ? "none" : "all");
  }, [config.data]);

  const baseline = useMemo(() => config.data?.config?.companies ?? [], [config.data]);
  const baselineKeywords = useMemo(() => config.data?.config?.jobtitles ?? { includeKeywords: [], excludeKeywords: [] }, [config.data]);
  const keywordsDirty = useMemo(
    () => JSON.stringify(baselineKeywords) !== JSON.stringify(draftKeywords),
    [baselineKeywords, draftKeywords],
  );

  const isDirty = useMemo(
    () =>
      JSON.stringify(normalize(baseline)) !== JSON.stringify(normalize(draftCompanies)) ||
      ((config.data?.config?.adminRegistryMode === "none" ? "none" : "all") !== adminRegistryMode) ||
      JSON.stringify(baselineKeywords) !== JSON.stringify(draftKeywords),
    [baseline, draftCompanies, baselineKeywords, config.data, adminRegistryMode, draftKeywords],
  );

  // A company is "auto-tracked" if it came from the registry picker.
  // Check isRegistry first; fall back to registryAts/registryTier since
  // some backends don't persist the isRegistry boolean but do persist the
  // registry metadata fields.
  const isFromRegistry = (c: { isRegistry?: boolean; registryAts?: string; registryTier?: string }) =>
    !!(c.isRegistry || c.registryAts || c.registryTier);
  const trackedFromCatalog = draftCompanies.filter(isFromRegistry).length;
  const trackedCustom = draftCompanies.filter((c) => !isFromRegistry(c) && c.company).length;
  const currentPlan = me?.billing?.plan ?? me?.profile?.plan ?? "free";
  const showUpgradeBanner = currentPlan === "free";

  const visibleCompanies = useMemo(() => {
    const scanOverrides = config.data?.companyScanOverrides ?? {};
    let list = draftCompanies.map((company, index) => ({ company, index }));
    if (tab === "registry") list = list.filter((row) => isFromRegistry(row.company));
    else if (tab === "custom") list = list.filter((row) => !isFromRegistry(row.company));
    if (companySearch.trim()) {
      const q = companySearch.trim().toLowerCase();
      list = list.filter((row) => row.company.company.toLowerCase().includes(q));
    }
    if (atsFilter) {
      list = list.filter((row) => {
        const src = (row.company.registryAts || row.company.source || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        return src === atsFilter;
      });
    }
    if (statusFilter === "paused") {
      list = list.filter((row) => row.company.company && scanOverrides[companyKey(row.company.company)]?.paused);
    } else if (statusFilter === "enabled") {
      list = list.filter((row) => !row.company.company || !scanOverrides[companyKey(row.company.company)]?.paused);
    }
    return list;
  }, [draftCompanies, tab, companySearch, atsFilter, statusFilter, config.data]);

  const totalVisiblePages = Math.max(1, Math.ceil(visibleCompanies.length / CONFIG_PAGE_SIZE));
  const pagedVisibleCompanies = useMemo(() => {
    const start = companyPage * CONFIG_PAGE_SIZE;
    return visibleCompanies.slice(start, start + CONFIG_PAGE_SIZE);
  }, [visibleCompanies, companyPage]);

  useEffect(() => {
    // Filtering can shrink the table dramatically, so snap back to the first page
    // to avoid landing on an empty slice from a stale page index.
    setCompanyPage(0);
  }, [tab, companySearch, atsFilter, statusFilter]);

  useEffect(() => {
    if (companyPage >= totalVisiblePages) {
      setCompanyPage(Math.max(0, totalVisiblePages - 1));
    }
  }, [companyPage, totalVisiblePages]);

  /** Add a registry-backed company. Stores the registry's ATS + sample URL
   *  on the row so the picker can show "already added" and the table can
   *  render the auto-discovered badge. */
  function handleAddRegistry(entry: RegistryEntry) {
    const key = companyKey(entry.company);
    if (draftCompanies.some((c) => companyKey(c.company) === key)) {
      toast(`${entry.company} is already tracked`, "info");
      return;
    }
    const normalizedSource = normalizeRegistryAts(entry.ats) || String(entry.ats ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const parsedAts = parseConfiguredAts(normalizedSource as never, (entry.board_url || entry.sample_url || undefined));
    const canonicalBoardUrl = canonicalBoardUrlForRegistryEntry(entry, normalizedSource, parsedAts);
    setDraftCompanies((prev) => [
      ...prev,
      {
        company: entry.company,
        enabled: true,
        // normalizeRegistryAts returns "" for unknown ATS types; fall back to
        // the raw lowercased ID so source is never saved as empty for registry entries.
        source: normalizedSource,
        boardUrl: canonicalBoardUrl,
        // Registry-backed companies keep the canonical board URL in both
        // fields so older UI paths cannot fall back to a single posting URL.
        sampleUrl: canonicalBoardUrl,
        isRegistry: true,
        registryAts: entry.ats ?? "",
        registryTier: entry.tier ?? "",
        workdayBaseUrl: "workdayBaseUrl" in parsedAts ? parsedAts.workdayBaseUrl : undefined,
        host: "host" in parsedAts ? parsedAts.host : undefined,
        tenant: "tenant" in parsedAts ? parsedAts.tenant : undefined,
        site: "site" in parsedAts ? parsedAts.site : undefined,
      },
    ]);
    toast(`Added ${entry.company}`);
  }

  /**
   * Add a validated custom company as a registry-backed row immediately so the
   * draft mirrors the shared registry entry the backend just promoted.
   */
  function handleAddCustom(company: CompanyConfig) {
    setPickerOpen(false);
    setTab("all");
    setDraftCompanies((prev) => [...prev, company]);
    toast(`Added ${company.company}`);
  }

  function handleEdit(index: number, patch: Partial<CompanyConfig>) {
    setDraftCompanies((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function handleRemove(index: number) {
    setDraftCompanies((prev) => prev.filter((_, i) => i !== index));
  }

  function handleToggleScan(company: string, currentlyPaused: boolean) {
    if (!company) return;
    toggleScan.mutate(
      { company, paused: !currentlyPaused },
      {
        onSuccess: () => toast(`${company} scan ${currentlyPaused ? "resumed" : "paused"}`),
        onError: (err) => toast(err instanceof Error ? err.message : "Toggle failed", "error"),
      },
    );
  }

  function saveDraft(
    nextCompanies: CompanyConfig[],
    nextKeywords: { includeKeywords: string[]; excludeKeywords: string[] },
    nextAdminRegistryMode: "all" | "none",
    options?: { onSuccess?: () => void; successMessage?: string },
  ) {
    // Validation: registry rows skip board-url/source checks since registry
    // resolves them; custom rows must supply both.
    for (const row of nextCompanies) {
      if (!row.company.trim()) {
        toast("Company name is required for every row", "error");
        return;
      }
      if (!row.isRegistry) {
        if (!row.source) return toast(`ATS is required for ${row.company}`, "error");
        if (!row.boardUrl) return toast(`Job board URL is required for ${row.company}`, "error");
      }
    }
    saveConfig.mutate(
      {
        companies: nextCompanies,
        jobtitles: nextKeywords,
        adminRegistryMode: me?.actor.isAdmin ? nextAdminRegistryMode : undefined,
      },
      {
        onSuccess: (result) => {
          setDraftCompanies(result.config.companies.map((company) => ({
            ...company,
            isRegistry: company.isRegistry === true || Boolean(company.registryAts || company.registryTier),
            registryAts: company.registryAts || (company.source ? formatAtsLabel(company.source) : ""),
          })));
          setDraftKeywords(result.config.jobtitles);
          setAdminRegistryMode(result.config.adminRegistryMode === "none" ? "none" : "all");
          toast(options?.successMessage ?? "Companies saved");
          options?.onSuccess?.();
        },
        onError: (err) => toast(err instanceof Error ? err.message : "Save failed", "error"),
      },
    );
  }

  function handleSave(options?: { onSuccess?: () => void }) {
    saveDraft(draftCompanies, draftKeywords, adminRegistryMode, options);
  }

  function handleCancel() {
    setDraftCompanies(baseline.map((c) => ({ ...c })));
    setDraftKeywords({ ...baselineKeywords });
    setAdminRegistryMode(config.data?.config?.adminRegistryMode === "none" ? "none" : "all");
    setEditingKeywords(false);
  }

  function handleCancelKeywordEdits() {
    setDraftKeywords({ ...baselineKeywords });
    setEditingKeywords(false);
  }

  function handleSaveKeywordEdits() {
    handleSave({ onSuccess: () => setEditingKeywords(false) });
  }

  function handleAdminAddAllCompanies() {
    saveDraft(draftCompanies, draftKeywords, "all", { successMessage: "All registry companies added" });
  }

  function handleAdminRemoveAllCompanies() {
    saveDraft([], draftKeywords, "none", { successMessage: "All companies removed" });
  }

  return (
    <>
      <Topbar
        title="Configuration"
        subtitle="Manage tracked companies and keyword rules"
        actions={
          isDirty ? (
            <>
              <Button variant="warning" size="sm" onClick={handleCancel} disabled={saveConfig.isPending}>
                <X size={14} /> Cancel
              </Button>
              <Button variant="success" size="sm" onClick={() => handleSave()} disabled={saveConfig.isPending}>
                <Save size={14} /> {saveConfig.isPending ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : null
        }
      />
      <div className="p-6 space-y-4">
        {showUpgradeBanner ? (
          <UpgradeBanner
            title="Upgrade for broader company tracking"
            message="Free accounts can configure the basics, but upgrading gives you more room to track companies and expand the search surface behind your scans."
            cta={() => setUpgradePromptOpen(true)}
          />
        ) : null}
        <FilterToolbar
          tabs={[
            { label: "All companies", icon: <Building2 size={16} />, count: draftCompanies.length },
            { label: "Auto-tracked", icon: <Sparkles size={16} />, count: trackedFromCatalog, tone: "cyan" },
            { label: "Custom", icon: <PencilLine size={16} />, count: trackedCustom, tone: "violet" },
          ]}
          activeTabIndex={tab === "all" ? 0 : tab === "registry" ? 1 : 2}
          onTabChange={(i) => setTab(["all", "registry", "custom"][i] as typeof tab)}
          rightSlot={
            <div className="flex items-center gap-2">
              {me?.actor.isAdmin ? (
                <>
                  <Button variant="outline" onClick={handleAdminAddAllCompanies} disabled={saveConfig.isPending}>
                    Add all companies
                  </Button>
                  <Button variant="outline" onClick={handleAdminRemoveAllCompanies} disabled={saveConfig.isPending}>
                    Remove all companies
                  </Button>
                </>
              ) : null}
              <Button onClick={() => setPickerOpen(true)}>
                <Plus size={14} /> Add company
              </Button>
            </div>
          }
        />

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
            <div>
              <CardTitle>Tracked companies</CardTitle>
              <CardDescription>
                {draftCompanies.length} tracked · {trackedFromCatalog} auto-tracked · {trackedCustom} custom
                {visibleCompanies.length !== draftCompanies.length && (
                  <span className="ml-1 text-[hsl(var(--primary))]">· {visibleCompanies.length} shown</span>
                )}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={toggleAll.isPending}
              onClick={() => {
                const scanOverrides = config.data?.companyScanOverrides ?? {};
                const allPaused = draftCompanies.every(
                  (c) => c.company && scanOverrides[companyKey(c.company)]?.paused,
                );
                toggleAll.mutate(!allPaused, {
                  onSuccess: () => qc.invalidateQueries({ queryKey: configKey }),
                });
              }}
            >
              {(() => {
                const scanOverrides = config.data?.companyScanOverrides ?? {};
                const allPaused = draftCompanies.every(
                  (c) => c.company && scanOverrides[companyKey(c.company)]?.paused,
                );
                return allPaused ? "Resume all" : "Pause all";
              })()}
            </Button>
          </CardHeader>

          {/* Company filters — search, ATS, scan status */}
          <div className="px-5 pb-3 flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))]">
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none" />
              <input
                type="text"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Search companies…"
                className="w-full h-8 pl-8 pr-3 text-sm rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              />
            </div>
            <Select
              value={atsFilter}
              onChange={(e) => setAtsFilter(e.target.value)}
              className="h-8 text-sm w-40"
            >
              <option value="">All ATS</option>
              <option value="workday">Workday</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="ashby">Ashby</option>
              <option value="lever">Lever</option>
              <option value="smartrecruiters">SmartRecruiters</option>
              <option value="bamboohr">BambooHR</option>
              <option value="icims">iCIMS</option>
              <option value="jobvite">Jobvite</option>
            </Select>
            <Select
              value={statusFilter ?? ""}
              onChange={(e) => setStatusFilter((e.target.value as "" | "enabled" | "paused") || undefined)}
              className="h-8 text-sm w-36"
            >
              <option value="">All statuses</option>
              <option value="enabled">Scanning</option>
              <option value="paused">Paused</option>
            </Select>
            {(companySearch || atsFilter || statusFilter) && (
              <button
                type="button"
                onClick={() => { setCompanySearch(""); setAtsFilter(""); setStatusFilter(undefined); }}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] flex items-center gap-1"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>

          {/* Scrollable company list — shows ~5 rows, rest scrollable */}
          <CardContent className="p-0 border-t border-[hsl(var(--border))]">
            <div className="max-h-[280px] overflow-y-auto">
              <CompanyTable
                companies={pagedVisibleCompanies.map((row) => row.company)}
                rowIndexes={pagedVisibleCompanies.map((row) => row.index)}
                scanOverrides={config.data?.companyScanOverrides ?? {}}
                onChange={handleEdit}
                onRemove={handleRemove}
                onToggleScan={handleToggleScan}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] px-5 py-3 text-sm text-[hsl(var(--muted-foreground))]">
              <div>
                Page {Math.min(companyPage + 1, totalVisiblePages)} of {totalVisiblePages}
                <span className="ml-2">· 20 companies per page</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCompanyPage((page) => Math.max(0, page - 1))}
                  disabled={companyPage === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCompanyPage((page) => Math.min(totalVisiblePages - 1, page + 1))}
                  disabled={companyPage >= totalVisiblePages - 1}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Job title filters</CardTitle>
              <CardDescription>Filter jobs by keywords in the job title</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {editingKeywords && keywordsDirty && (
                <>
                  <Button variant="outline" size="sm" onClick={handleCancelKeywordEdits} disabled={saveConfig.isPending}>
                    <X size={14} /> Cancel
                  </Button>
                  <Button variant="success" size="sm" onClick={handleSaveKeywordEdits} disabled={saveConfig.isPending}>
                    <Save size={14} /> {saveConfig.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </>
              )}
              {!editingKeywords && (
                <Button variant="outline" size="sm" onClick={() => setEditingKeywords(true)}>
                  <PencilLine size={14} /> Edit filters
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Include keywords</label>
              <textarea
                className="w-full min-h-[100px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder={"e.g. engineer\nplatform\ninfra"}
                value={draftKeywords.includeKeywords.join("\n")}
                readOnly={!editingKeywords}
                onChange={(e) =>
                  setDraftKeywords((prev) => ({
                    ...prev,
                    includeKeywords: e.target.value.split("\n"),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">One keyword or phrase per line. Case-insensitive.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Exclude keywords</label>
              <textarea
                className="w-full min-h-[100px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder={"e.g. intern\nrecruiter\ncontract"}
                value={draftKeywords.excludeKeywords.join("\n")}
                readOnly={!editingKeywords}
                onChange={(e) =>
                  setDraftKeywords((prev) => ({
                    ...prev,
                    excludeKeywords: e.target.value.split("\n"),
                  }))
                }
              />
              <p className="text-xs text-muted-foreground">One keyword or phrase per line. Case-insensitive.</p>
            </div>
          </CardContent>
        </Card>

        {config.error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            Failed to load config: {(config.error as Error).message}. Check that the backend is running and `/api`
            proxy points at it (see vite.config.ts).
          </div>
        )}
      </div>
        <CompanyPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          trackedCompanies={draftCompanies}
          onAddRegistry={handleAddRegistry}
        onAddCustom={handleAddCustom}
      />
      <UpgradePrompt
        open={upgradePromptOpen}
        onClose={() => setUpgradePromptOpen(false)}
        currentPlan={currentPlan}
        title="Upgrade to track more companies"
        body="Move beyond the free tier to raise company limits and unlock a broader search footprint across your saved configuration."
      />
    </>
  );
}

/** Infer registry status the same way the display hydration does, so raw
 *  backend rows and enriched draft rows compare equal after load/save. */
function inferredRegistryStatus(row: CompanyConfig): boolean {
  return row.isRegistry === true || Boolean(row.registryAts || row.registryTier);
}

/** Drop registry-only metadata before equality checks so display backfills
 *  never make the form look edited on first load. */
function normalize(rows: CompanyConfig[]): Array<Partial<CompanyConfig>> {
  return rows.map((r) => ({
    company: r.company.trim(),
    enabled: r.enabled !== false,
    source: r.source ?? "",
    boardUrl: r.boardUrl ?? r.sampleUrl ?? "",
    isRegistry: inferredRegistryStatus(r),
  }));
}
