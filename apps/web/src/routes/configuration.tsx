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
  useRegistryMeta,
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

export const Route = createFileRoute("/configuration")({ component: ConfigurationRoute });

import { ALL_ATS_ADAPTERS } from "@/lib/job-filters";

// All adapter IDs the backend can handle (registry-driven + legacy scan path).
const ALL_ATS_IDS = new Set(ALL_ATS_ADAPTERS.map((a) => a.id));

/** Normalise a registry ATS string to the canonical adapter ID, or "" if unknown. */
function normalizeRegistryAts(ats: string | null | undefined): string {
  const id = String(ats ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return ALL_ATS_IDS.has(id as never) ? id : "";
}

function ConfigurationRoute() {
  const config = useConfig();
  const registryMeta = useRegistryMeta();
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
          // Backfill: infer registry status from any available signal because
          // career-jump-aws doesn't persist isRegistry/registryAts/registryTier.
          // Using OR across all three signals covers old entries where source or
          // sampleUrl may be null (e.g. companies added before source was normalised).
          isRegistry: Boolean(c.registryAts || c.source || c.sampleUrl),
          registryAts: c.registryAts || (c.source ? formatAtsLabel(c.source) : ""),
        }));
      }
      return current;
    });
    setDraftKeywords(config.data?.config?.jobtitles ?? { includeKeywords: [], excludeKeywords: [] });
  }, [config.data]);

  const baseline = useMemo(() => config.data?.config?.companies ?? [], [config.data]);
  const baselineKeywords = useMemo(() => config.data?.config?.jobtitles ?? { includeKeywords: [], excludeKeywords: [] }, [config.data]);

  const isDirty = useMemo(
    () =>
      JSON.stringify(normalize(baseline)) !== JSON.stringify(normalize(draftCompanies)) ||
      JSON.stringify(baselineKeywords) !== JSON.stringify(draftKeywords),
    [baseline, draftCompanies, baselineKeywords, draftKeywords],
  );

  // A company is "auto-tracked" if it came from the registry picker.
  // Check isRegistry first; fall back to registryAts/registryTier since
  // some backends don't persist the isRegistry boolean but do persist the
  // registry metadata fields.
  const isFromRegistry = (c: { isRegistry?: boolean; registryAts?: string; registryTier?: string }) =>
    !!(c.isRegistry || c.registryAts || c.registryTier);
  const trackedFromCatalog = draftCompanies.filter(isFromRegistry).length;
  const trackedCustom = draftCompanies.filter((c) => !isFromRegistry(c) && c.company).length;
  void registryMeta;

  const visibleCompanies = useMemo(() => {
    const scanOverrides = config.data?.companyScanOverrides ?? {};
    let list = draftCompanies;
    if (tab === "registry") list = list.filter(isFromRegistry);
    else if (tab === "custom") list = list.filter((c) => !isFromRegistry(c));
    if (companySearch.trim()) {
      const q = companySearch.trim().toLowerCase();
      list = list.filter((c) => c.company.toLowerCase().includes(q));
    }
    if (atsFilter) {
      list = list.filter((c) => {
        const src = (c.registryAts || c.source || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
        return src === atsFilter;
      });
    }
    if (statusFilter === "paused") {
      list = list.filter((c) => c.company && scanOverrides[companyKey(c.company)]?.paused);
    } else if (statusFilter === "enabled") {
      list = list.filter((c) => !c.company || !scanOverrides[companyKey(c.company)]?.paused);
    }
    return list;
  }, [draftCompanies, tab, companySearch, atsFilter, statusFilter, config.data]);

  /** Add a registry-backed company. Stores the registry's ATS + sample URL
   *  on the row so the picker can show "already added" and the table can
   *  render the auto-discovered badge. */
  function handleAddRegistry(entry: RegistryEntry) {
    const key = companyKey(entry.company);
    if (draftCompanies.some((c) => companyKey(c.company) === key)) {
      toast(`${entry.company} is already tracked`, "info");
      return;
    }
    setDraftCompanies((prev) => [
      ...prev,
      {
        company: entry.company,
        enabled: true,
        // normalizeRegistryAts returns "" for unknown ATS types; fall back to
        // the raw lowercased ID so source is never saved as empty for registry entries.
        source: normalizeRegistryAts(entry.ats) || String(entry.ats ?? "").toLowerCase().replace(/[^a-z0-9]+/g, ""),
        sampleUrl: entry.sample_url || entry.board_url || "",
        isRegistry: true,
        registryAts: entry.ats ?? "",
        registryTier: entry.tier ?? "",
      },
    ]);
    toast(`Added ${entry.company}`);
  }

  /** Add a blank custom row. Closes the picker and lets the user fill
   *  in name + ATS + sampleUrl directly in the table. */
  function handleAddCustom() {
    setPickerOpen(false);
    setDraftCompanies((prev) => [
      ...prev,
      { company: "", enabled: true, source: "", sampleUrl: "", isRegistry: false },
    ]);
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

  function handleSave() {
    // Validation: registry rows skip sampleUrl/source checks since registry
    // resolves them; custom rows must supply both.
    for (const row of draftCompanies) {
      if (!row.company.trim()) {
        toast("Company name is required for every row", "error");
        return;
      }
      if (!row.isRegistry) {
        if (!row.source) return toast(`ATS is required for ${row.company}`, "error");
        if (!row.sampleUrl) return toast(`Sample URL is required for ${row.company}`, "error");
      }
    }
    saveConfig.mutate(
      {
        companies: draftCompanies,
        jobtitles: draftKeywords,
      },
      {
        onSuccess: () => toast("Companies saved"),
        onError: (err) => toast(err instanceof Error ? err.message : "Save failed", "error"),
      },
    );
  }

  function handleCancel() {
    setDraftCompanies(baseline.map((c) => ({ ...c })));
    setDraftKeywords({ ...baselineKeywords });
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
              <Button variant="success" size="sm" onClick={handleSave} disabled={saveConfig.isPending}>
                <Save size={14} /> {saveConfig.isPending ? "Saving…" : "Save changes"}
              </Button>
            </>
          ) : null
        }
      />
      <div className="p-6 space-y-4">
        <FilterToolbar
          tabs={[
            { label: "All companies", icon: <Building2 size={16} />, count: draftCompanies.length },
            { label: "Auto-tracked", icon: <Sparkles size={16} />, count: trackedFromCatalog, tone: "cyan" },
            { label: "Custom", icon: <PencilLine size={16} />, count: trackedCustom, tone: "violet" },
          ]}
          activeTabIndex={tab === "all" ? 0 : tab === "registry" ? 1 : 2}
          onTabChange={(i) => setTab(["all", "registry", "custom"][i] as typeof tab)}
          rightSlot={
            <Button onClick={() => setPickerOpen(true)}>
              <Plus size={14} /> Add company
            </Button>
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
                companies={visibleCompanies}
                scanOverrides={config.data?.companyScanOverrides ?? {}}
                onChange={(idx, patch) => handleEdit(draftCompanies.indexOf(visibleCompanies[idx]), patch)}
                onRemove={(idx) => handleRemove(draftCompanies.indexOf(visibleCompanies[idx]))}
                onToggleScan={handleToggleScan}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job title filters</CardTitle>
            <CardDescription>Filter jobs by keywords in the job title</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Include keywords</label>
              <textarea
                className="w-full min-h-[100px] rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                placeholder={"e.g. engineer\nplatform\ninfra"}
                value={draftKeywords.includeKeywords.join("\n")}
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
    </>
  );
}

/** Infer registry status the same way the display hydration does, so raw
 *  backend rows and enriched draft rows compare equal after load/save. */
function inferredRegistryStatus(row: CompanyConfig): boolean {
  return Boolean(row.isRegistry || row.registryAts || row.source || row.sampleUrl);
}

/** Drop registry-only metadata before equality checks so display backfills
 *  never make the form look edited on first load. */
function normalize(rows: CompanyConfig[]): Array<Partial<CompanyConfig>> {
  return rows.map((r) => ({
    company: r.company.trim(),
    enabled: r.enabled !== false,
    source: r.source ?? "",
    sampleUrl: r.sampleUrl ?? "",
    isRegistry: inferredRegistryStatus(r),
  }));
}
