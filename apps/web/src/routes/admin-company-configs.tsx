import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Database, RefreshCw, Save, Trash2 } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/features/session/queries";
import {
  useAdminRegistryCompanyConfig,
  useAdminRegistryCompanyConfigs,
  useDeleteAdminRegistryCompanyConfig,
  useSaveAdminRegistryCompanyConfig,
} from "@/features/support/queries";
import { ALL_ATS_ADAPTERS } from "@/lib/job-filters";
import type { AdminRegistryCompanyConfig, AdminRegistryCompanyConfigSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-company-configs")({ component: AdminCompanyConfigsRoute });

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
const REGISTRY_TIER_OPTIONS = [
  { value: "TIER1_VERIFIED", label: "Tier 1 verified" },
  { value: "TIER2_MEDIUM", label: "Tier 2 medium" },
  { value: "TIER3_LOW", label: "Tier 3 low" },
  { value: "NEEDS_REVIEW", label: "Needs review" },
] as const;
const SUPPORTED_ATS_REFERENCE = ALL_ATS_ADAPTERS.map((adapter) => ({
  id: adapter.id,
  label: adapter.label,
}));

function validateRegistryConfigJson(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Config JSON must be an object.";
  }

  const record = value as Record<string, unknown>;
  const company = typeof record.company === "string" ? record.company.trim() : "";
  if (!company) return "company is required.";

  const tier = typeof record.tier === "string" ? record.tier.trim() : "";
  if (!["TIER1_VERIFIED", "TIER2_MEDIUM", "TIER3_LOW", "NEEDS_REVIEW"].includes(tier)) {
    return "tier must be one of TIER1_VERIFIED, TIER2_MEDIUM, TIER3_LOW, NEEDS_REVIEW.";
  }

  const numberFields = ["rank", "total_jobs"] as const;
  for (const field of numberFields) {
    const current = record[field];
    if (current !== undefined && current !== null && current !== "" && !Number.isFinite(Number(current))) {
      return `${field} must be a number or null.`;
    }
  }

  const stringFields = ["sheet", "board_url", "ats", "source", "from", "adapterId", "sample_url", "last_checked"] as const;
  for (const field of stringFields) {
    const current = record[field];
    if (current !== undefined && current !== null && typeof current !== "string") {
      return `${field} must be a string or null.`;
    }
  }

  if (typeof record.ats === "string" && record.ats.trim()) {
    const normalized = record.ats.trim().toLowerCase();
    const matchesKnownAts = SUPPORTED_ATS_REFERENCE.some((adapter) => adapter.id === normalized);
    const matchesKnownAlias = ["oracle cloud hcm", "oracle cloud", "smartrecruiters"].includes(normalized);
    if (!matchesKnownAts && !matchesKnownAlias) {
      return "ats must use a supported adapter id. See the ATS reference legend below the editor.";
    }
  }

  if (record.boards !== undefined) {
    if (!Array.isArray(record.boards)) {
      return "boards must be an array when provided.";
    }
    for (const [index, board] of record.boards.entries()) {
      if (!board || typeof board !== "object" || Array.isArray(board)) {
        return `boards[${index}] must be an object.`;
      }
      const boardRecord = board as Record<string, unknown>;
      if (typeof boardRecord.ats !== "string" || !boardRecord.ats.trim()) {
        return `boards[${index}].ats is required.`;
      }
      if (typeof boardRecord.url !== "string" || !boardRecord.url.trim()) {
        return `boards[${index}].url is required.`;
      }
      if (
        boardRecord.total_jobs !== undefined
        && boardRecord.total_jobs !== null
        && boardRecord.total_jobs !== ""
        && !Number.isFinite(Number(boardRecord.total_jobs))
      ) {
        return `boards[${index}].total_jobs must be a number or null.`;
      }
    }
  }

  return null;
}

function AdminCompanyConfigsRoute() {
  const { data: me } = useMe();
  const isAdmin = me?.actor?.isAdmin === true;
  const location = useLocation();
  const { data, isLoading, isFetching, refetch } = useAdminRegistryCompanyConfigs(isAdmin);
  const [companyFilter, setCompanyFilter] = useState("");
  const [atsFilter, setAtsFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(0);
  const [selectedRegistryId, setSelectedRegistryId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [companyNameValue, setCompanyNameValue] = useState("");
  const [tierValue, setTierValue] = useState<string>("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const detailQuery = useAdminRegistryCompanyConfig(selectedRegistryId, isAdmin);
  const saveMutation = useSaveAdminRegistryCompanyConfig(selectedRegistryId);
  const deleteMutation = useDeleteAdminRegistryCompanyConfig(selectedRegistryId);

  const filteredRows = useMemo(() => {
    const normalizedCompanyFilter = companyFilter.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      if (atsFilter && (row.ats ?? "").toLowerCase() !== atsFilter) return false;
      if (tierFilter && row.tier !== tierFilter) return false;
      if (normalizedCompanyFilter && !row.company.toLowerCase().includes(normalizedCompanyFilter)) return false;
      return true;
    });
  }, [atsFilter, companyFilter, data?.rows, tierFilter]);

  const atsOptions = useMemo(() => (
    [...new Set((data?.rows ?? []).map((row) => (row.ats ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  ), [data?.rows]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = filteredRows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage]);

  useEffect(() => {
    // Auto-select the first visible company so admins land directly in the
    // editor instead of seeing an empty detail panel on first open.
    if (!selectedRegistryId && filteredRows.length) {
      setSelectedRegistryId(filteredRows[0]?.registryId ?? null);
    }
  }, [filteredRows, selectedRegistryId]);

  useEffect(() => {
    if (detailQuery.data?.config) {
      setEditorValue(JSON.stringify(detailQuery.data.config, null, 2));
      setCompanyNameValue(detailQuery.data.config.company ?? "");
      setTierValue(detailQuery.data.config.tier ?? "");
      setParseError(null);
      setSaveMessage(null);
    }
  }, [detailQuery.data?.config, selectedRegistryId]);

  const selectedSummary = useMemo(() => (
    (data?.rows ?? []).find((row) => row.registryId === selectedRegistryId) ?? null
  ), [data?.rows, selectedRegistryId]);

  async function handleSave() {
    if (!selectedRegistryId) return;
    setSaveMessage(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(editorValue);
      setParseError(null);
    } catch {
      setParseError("Config JSON is invalid. Fix the JSON before saving.");
      return;
    }

    const validationError = validateRegistryConfigJson(parsed);
    if (validationError) {
      setParseError(validationError);
      return;
    }

    try {
      const result = await saveMutation.mutateAsync(parsed as AdminRegistryCompanyConfig);
      const nextRegistryId = result.nextRegistryId ?? selectedRegistryId;
      setSelectedRegistryId(nextRegistryId);
      setSaveMessage(`Saved ${result.config.company}. JSON validation passed.`);
      toast(`${result.config.company} config saved`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save company config";
      setSaveMessage(message);
      toast(message, "error");
    }
  }

  async function handleDelete() {
    if (!selectedRegistryId || !selectedSummary) return;
    const confirmed = window.confirm(`Delete ${selectedSummary.company} from the live registry?`);
    if (!confirmed) return;

    try {
      const result = await deleteMutation.mutateAsync();
      setSaveMessage(`Deleted ${result.deletedCompany}`);
      setSelectedRegistryId(null);
      setEditorValue("");
      setParseError(null);
      toast(`${result.deletedCompany} deleted`, "info");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to delete company config";
      setSaveMessage(message);
      toast(message, "error");
    }
  }

  /**
   * Keep the dedicated company-name input and the raw JSON editor in sync so
   * admins can rename a record without having to hand-edit the JSON blob.
   */
  function handleCompanyNameChange(nextCompanyName: string) {
    setCompanyNameValue(nextCompanyName);
    setSaveMessage(null);
    setParseError(null);

    try {
      const parsed = JSON.parse(editorValue) as Record<string, unknown>;
      const nextConfig = {
        ...parsed,
        company: nextCompanyName,
      };
      setEditorValue(JSON.stringify(nextConfig, null, 2));
    } catch {
      // Leave the raw editor untouched when the JSON is currently invalid.
    }
  }

  /**
   * Tier changes are common operational edits, so keep a dedicated control in
   * sync with the raw JSON editor just like the company-name field.
   */
  function handleTierChange(nextTier: string) {
    setTierValue(nextTier);
    setSaveMessage(null);
    setParseError(null);

    try {
      const parsed = JSON.parse(editorValue) as Record<string, unknown>;
      const nextConfig = {
        ...parsed,
        tier: nextTier,
      };
      setEditorValue(JSON.stringify(nextConfig, null, 2));
    } catch {
      // Leave the raw editor untouched when the JSON is currently invalid.
    }
  }

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Company Configs" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Company Configs" subtitle="Retrieve and edit the full registry config for any company." />
      <AdminPageFrame
        currentLabel="Company Configs"
        currentPath={location.pathname}
        eyebrow="Registry Operations"
        title="Edit live registry company configs"
        description="Search the registry catalog, load the full live company config, and save company-level ATS, board URL, tier, and metadata changes without editing Dynamo by hand."
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(360px,460px)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <Database size={16} />
                    Registry companies
                  </CardTitle>
                  <CardDescription>
                    Filter the live registry list, then open a company row to inspect and edit its full persisted config.
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                  className="md:self-start"
                >
                  <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  value={companyFilter}
                  onChange={(event) => {
                    setCompanyFilter(event.target.value);
                    setPage(0);
                  }}
                  placeholder="Filter by company name"
                />
                <Select
                  value={atsFilter}
                  onChange={(event) => {
                    setAtsFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All ATS</option>
                  {atsOptions.map((ats) => (
                    <option key={ats} value={ats.toLowerCase()}>{ats}</option>
                  ))}
                </Select>
                <Select
                  value={tierFilter}
                  onChange={(event) => {
                    setTierFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All tiers</option>
                  <option value="TIER1_VERIFIED">Tier 1 verified</option>
                  <option value="TIER2_MEDIUM">Tier 2 medium</option>
                  <option value="TIER3_LOW">Tier 3 low</option>
                  <option value="NEEDS_REVIEW">Needs review</option>
                </Select>
                <Select
                  value={String(pageSize)}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value) || 10);
                    setPage(0);
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option} / page</option>
                  ))}
                </Select>
              </div>

              <div className="rounded-md border border-[hsl(var(--border))]">
                <div className="grid grid-cols-[minmax(0,1fr)_120px_140px] gap-3 border-b border-[hsl(var(--border))] px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                  <div>Company</div>
                  <div>ATS</div>
                  <div>Tier</div>
                </div>
                <div className="max-h-[560px] overflow-y-auto">
                  {isLoading ? (
                    <div className="p-4 text-sm text-[hsl(var(--muted-foreground))]">Loading registry companies...</div>
                  ) : pagedRows.length ? (
                    pagedRows.map((row) => (
                      <CompanyRow
                        key={row.registryId}
                        row={row}
                        active={row.registryId === selectedRegistryId}
                        onSelect={() => {
                          setSelectedRegistryId(row.registryId);
                          setSaveMessage(null);
                        }}
                      />
                    ))
                  ) : (
                    <div className="p-4 text-sm text-[hsl(var(--muted-foreground))]">No companies match the current filters.</div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-sm text-[hsl(var(--muted-foreground))]">
                <div>
                  Page {safePage + 1} of {totalPages} · {filteredRows.length.toLocaleString()} matching companies
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages - 1}
                    onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <CardTitle>Full company config</CardTitle>
                  <CardDescription>
                    Edit the live registry row as JSON. Save writes directly to the shared registry table and refreshes the in-memory registry cache.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedRegistryId || detailQuery.isFetching}
                    onClick={() => void detailQuery.refetch()}
                  >
                    <RefreshCw size={14} className={cn(detailQuery.isFetching && "animate-spin")} />
                    Reload selected
                  </Button>
                  <Button
                    type="button"
                    variant="warning"
                    size="sm"
                    disabled={!selectedRegistryId || deleteMutation.isPending}
                    onClick={() => void handleDelete()}
                  >
                    <Trash2 size={14} />
                    {deleteMutation.isPending ? "Deleting..." : "Delete company"}
                  </Button>
                  <Button
                    type="button"
                    variant="success"
                    size="sm"
                    disabled={!selectedRegistryId || saveMutation.isPending}
                    onClick={() => void handleSave()}
                  >
                    <Save size={14} />
                    {saveMutation.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedSummary ? (
                <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--accent))]/20 px-4 py-3 text-sm">
                  <div className="font-medium">{selectedSummary.company}</div>
                  <div className="mt-1 text-[hsl(var(--muted-foreground))]">
                    {(selectedSummary.ats ?? "Unknown ATS")} · {selectedSummary.tier} · {selectedSummary.board_url ?? "No board URL"}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[hsl(var(--border))] px-4 py-8 text-sm text-[hsl(var(--muted-foreground))]">
                  Select a registry company to load its config.
                </div>
              )}

              <div className="grid gap-2">
                <label htmlFor="company-config-company-name" className="text-sm font-medium">
                  Company name
                </label>
                <Input
                  id="company-config-company-name"
                  value={companyNameValue}
                  onChange={(event) => handleCompanyNameChange(event.target.value)}
                  placeholder="Enter company name"
                  disabled={!selectedRegistryId}
                />
                <div className="text-xs text-[hsl(var(--muted-foreground))]">
                  Editing this field updates the <code>company</code> value in the JSON below before save.
                </div>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">
                  Registry tier
                </label>
                <Select
                  value={tierValue}
                  onChange={(event) => handleTierChange(event.target.value)}
                  disabled={!selectedRegistryId}
                >
                  <option value="">Select tier</option>
                  {REGISTRY_TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <div className="text-xs text-[hsl(var(--muted-foreground))]">
                  Updating this control writes the canonical <code>tier</code> value into the JSON below before save.
                </div>
              </div>

              <textarea
                value={editorValue}
                onChange={(event) => {
                  setEditorValue(event.target.value);
                  try {
                    const parsed = JSON.parse(event.target.value) as Record<string, unknown>;
                    if (typeof parsed.company === "string") {
                      setCompanyNameValue(parsed.company);
                    }
                    if (typeof parsed.tier === "string") {
                      setTierValue(parsed.tier);
                    }
                  } catch {
                    // Keep the dedicated input stable while admins are in the
                    // middle of editing invalid JSON.
                  }
                  setParseError(null);
                  setSaveMessage(null);
                }}
                spellCheck={false}
                className="min-h-[560px] w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                placeholder={selectedRegistryId ? "Loading full registry config..." : "Select a company to view its config JSON"}
              />

              {parseError ? <div className="text-sm text-red-600">{parseError}</div> : null}
              {saveMessage ? <div className="text-sm text-[hsl(var(--muted-foreground))]">{saveMessage}</div> : null}
              <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--accent))]/20 px-4 py-3">
                <div className="text-sm font-medium">ATS reference</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  Use canonical adapter ids in JSON. Friendly values like "Oracle Cloud HCM" are normalized to <code>oracle</code> on save.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUPPORTED_ATS_REFERENCE.map((adapter) => (
                    <span
                      key={adapter.id}
                      className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2.5 py-1 text-xs"
                    >
                      <code>{adapter.id}</code>
                      <span className="text-[hsl(var(--muted-foreground))]">= {adapter.label}</span>
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </AdminPageFrame>
    </>
  );
}

function CompanyRow({
  row,
  active,
  onSelect,
}: {
  row: AdminRegistryCompanyConfigSummary;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_120px_140px] gap-3 border-b border-[hsl(var(--border))]/60 px-4 py-3 text-left text-sm transition-colors last:border-b-0",
        active ? "bg-[hsl(var(--accent))]/45" : "hover:bg-[hsl(var(--accent))]/20",
      )}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{row.company}</div>
        <div className="truncate text-xs text-[hsl(var(--muted-foreground))]">{row.board_url ?? "No board URL"}</div>
      </div>
      <div className="truncate">{row.ats ?? "Unknown"}</div>
      <div className="truncate">{row.tier}</div>
    </button>
  );
}
