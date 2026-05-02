import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Database, RefreshCw, Save } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useMe } from "@/features/session/queries";
import {
  useAdminRegistryCompanyConfig,
  useAdminRegistryCompanyConfigs,
  useSaveAdminRegistryCompanyConfig,
} from "@/features/support/queries";
import type { AdminRegistryCompanyConfig, AdminRegistryCompanyConfigSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-company-configs")({ component: AdminCompanyConfigsRoute });

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

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
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const detailQuery = useAdminRegistryCompanyConfig(selectedRegistryId, isAdmin);
  const saveMutation = useSaveAdminRegistryCompanyConfig(selectedRegistryId);

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

    try {
      const result = await saveMutation.mutateAsync(parsed as AdminRegistryCompanyConfig);
      const nextRegistryId = result.nextRegistryId ?? selectedRegistryId;
      setSelectedRegistryId(nextRegistryId);
      setSaveMessage(`Saved ${result.config.company}`);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Failed to save company config");
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
                  <Button type="button" size="sm" disabled={!selectedRegistryId || saveMutation.isPending} onClick={() => void handleSave()}>
                    <Save size={14} />
                    Save changes
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

              <textarea
                value={editorValue}
                onChange={(event) => {
                  setEditorValue(event.target.value);
                  setParseError(null);
                  setSaveMessage(null);
                }}
                spellCheck={false}
                className="min-h-[560px] w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                placeholder={selectedRegistryId ? "Loading full registry config..." : "Select a company to view its config JSON"}
              />

              {parseError ? <div className="text-sm text-red-600">{parseError}</div> : null}
              {saveMessage ? <div className="text-sm text-[hsl(var(--muted-foreground))]">{saveMessage}</div> : null}
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
