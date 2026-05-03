import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Check, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TierTag } from "@/components/ui/tier-tag";
import { useRegistryMeta, useRegistrySearch, useValidateCompany } from "./queries";
import { Select } from "@/components/ui/select";
import { type RegistryEntry, type CompanyConfig } from "@/lib/api";
import { cn, companyKey, formatAtsLabel } from "@/lib/utils";
import { ALL_ATS_ADAPTERS } from "@/lib/job-filters";
import { toast } from "@/components/ui/toast";

interface CompanyPickerProps {
  open: boolean;
  onClose: () => void;
  trackedCompanies: CompanyConfig[];
  onAddRegistry: (entry: RegistryEntry) => void;
  onAddCustom: (company: CompanyConfig) => void;
}

const TIERS = [
  { value: "", label: "All" },
  { value: "TIER1_VERIFIED", label: "Tier 1" },
  { value: "TIER2_MEDIUM", label: "Tier 2" },
  { value: "TIER3_LOW", label: "Tier 3" },
];

const DEFAULT_RESULT_LIMIT = 50;

export function CompanyPicker({ open, onClose, trackedCompanies, onAddRegistry, onAddCustom }: CompanyPickerProps) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tier, setTier] = useState("");
  const [ats, setAts] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customCompany, setCustomCompany] = useState("");
  const [customAts, setCustomAts] = useState("");
  const [customBoardUrl, setCustomBoardUrl] = useState("");
  const validateCompany = useValidateCompany();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebounced("");
      setTier("");
      setAts("");
      setCustomMode(false);
      setCustomCompany("");
      setCustomAts("");
      setCustomBoardUrl("");
    }
  }, [open]);

  const meta = useRegistryMeta();
  const adapters = meta.data?.adapters ?? [];
  const totalRegistry = meta.data?.counts.total ?? 0;

  const activeTierLabel = TIERS.find((t) => t.value === tier)?.label ?? "All";
  const results = useRegistrySearch({ search: debounced, ats, tier, limit: DEFAULT_RESULT_LIMIT, enabled: open });
  const resultEntries = results.data?.entries ?? [];
  const resultTotal = results.data?.total ?? resultEntries.length;

  const trackedKeys = useMemo(() => new Set(trackedCompanies.map((c) => companyKey(c.company))), [trackedCompanies]);
  const customTracked = trackedKeys.has(companyKey(customCompany));
  // Keep already-tracked companies visible, but push them to the bottom so
  // the next actionable companies are always listed first.
  const sortedEntries = useMemo(
    () =>
      [...(results.data?.entries ?? [])].sort((a, b) => {
        const aTracked = trackedKeys.has(companyKey(a.company)) ? 1 : 0;
        const bTracked = trackedKeys.has(companyKey(b.company)) ? 1 : 0;
        return aTracked - bTracked;
      }),
    [results.data?.entries, trackedKeys],
  );

  const renderEntry = (entry: RegistryEntry) => {
    const isTracked = trackedKeys.has(companyKey(entry.company));
    return (
      <li key={entry.company}>
        <button
          type="button"
          disabled={isTracked}
          onClick={() => onAddRegistry(entry)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
            isTracked
              ? "opacity-60 cursor-default"
              : "hover:bg-[hsl(var(--accent))]",
          )}
        >
          <div className="h-9 w-9 shrink-0 rounded-md bg-gradient-to-br from-blue-500/20 to-purple-500/20 grid place-items-center text-sm font-semibold text-[hsl(var(--foreground))]">
            {entry.company.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-base truncate">{entry.company}</span>
              <Badge variant="default">{formatAtsLabel(entry.ats)}</Badge>
              <TierTag tier={entry.tier} />
            </div>
            {entry.board_url && (
              <div className="text-sm text-[hsl(var(--muted-foreground))] truncate mt-0.5" title={entry.board_url}>
                {entry.board_url}
              </div>
            )}
          </div>
          <div className="shrink-0">
            {isTracked ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                <Check size={15} /> Tracked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--primary))] font-medium">
                <Plus size={15} /> Add
              </span>
            )}
          </div>
        </button>
      </li>
    );
  };

  async function handleValidateCustom() {
    if (!customCompany.trim()) {
      toast("Company name is required", "error");
      return;
    }
    if (!customAts) {
      toast("ATS is required", "error");
      return;
    }
    if (!customBoardUrl.trim()) {
      toast("Job board URL is required", "error");
      return;
    }
    if (customTracked) {
      toast(`${customCompany.trim()} is already tracked`, "info");
      return;
    }

    try {
      const result = await validateCompany.mutateAsync({
        company: customCompany.trim(),
        source: customAts,
        boardUrl: customBoardUrl.trim(),
      });
      onAddCustom(result.company);
      setCustomMode(false);
      setCustomCompany("");
      setCustomAts("");
      setCustomBoardUrl("");
      toast(result.message ?? `${result.company.company} validated`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Validation failed", "error");
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" className="overflow-hidden">
      <div className="flex flex-col max-h-[80vh]">
        {customMode ? (
          <>
            <div className="px-6 pt-6 pb-4 border-b border-[hsl(var(--border))]">
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="text-xl font-semibold">Validate company</h2>
                <Badge variant="secondary">Required before add</Badge>
              </div>
              <p className="text-base text-[hsl(var(--muted-foreground))]">
                Enter the company, ATS, and canonical job board URL. We only add it after the selected adapter validates the URL and returns non-zero jobs.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Company</label>
                <Input
                  autoFocus
                  value={customCompany}
                  onChange={(event) => setCustomCompany(event.target.value)}
                  placeholder="Anthropic"
                  className="h-11 text-base"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">ATS</label>
                <Select
                  value={customAts}
                  onChange={(event) => setCustomAts(event.target.value)}
                  className="h-11 text-sm"
                >
                  <option value="">Select ATS</option>
                  {ALL_ATS_ADAPTERS.map((adapter) => (
                    <option key={adapter.id} value={adapter.id}>
                      {adapter.label} ({adapter.id})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Job board URL</label>
                <Input
                  value={customBoardUrl}
                  onChange={(event) => setCustomBoardUrl(event.target.value)}
                  placeholder="https://job-boards.greenhouse.io/embed/job_board?for=airbnb"
                  className="h-11 text-sm"
                />
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Use the canonical board URL for the selected ATS. For example, Greenhouse accepts either the embed URL or the boards-api URL.
                </p>
              </div>

              {customTracked ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
                  {customCompany.trim()} is already tracked in this configuration.
                </div>
              ) : null}
            </div>

            <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex items-center justify-between gap-3 bg-[hsl(var(--card))]/40">
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                Validation also promotes the company into the shared registry once a real job inventory is confirmed.
              </div>
              <div className="flex items-center gap-2">
                <Button variant="warning" onClick={() => setCustomMode(false)} disabled={validateCompany.isPending}>
                  Cancel
                </Button>
                <Button variant="success" onClick={() => void handleValidateCustom()} disabled={validateCompany.isPending}>
                  {validateCompany.isPending ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Validating…
                    </>
                  ) : (
                    <>
                      <Check size={15} /> Validate
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
        <div className="px-6 pt-6 pb-4 border-b border-[hsl(var(--border))]">
          <div className="flex items-center gap-2 mb-1.5">
            <h2 className="text-xl font-semibold">Add company</h2>
            {totalRegistry > 0 && <Badge variant="secondary">{totalRegistry.toLocaleString()} available</Badge>}
          </div>
          <p className="text-base text-[hsl(var(--muted-foreground))]">
            Browse {activeTierLabel === "All" ? "all companies" : activeTierLabel} or search within the selected list.
          </p>
          <div className="mt-4 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <Input
              autoFocus
              placeholder="Search companies — e.g. Stripe, Anthropic, Walmart…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-12 text-base"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {TIERS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTier(t.value)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors border",
                  tier === t.value
                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-transparent"
                    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                )}
              >
                {t.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-[hsl(var(--border))]" />
            <Select value={ats} onChange={(e) => setAts(e.target.value)} className="h-9 w-44 text-sm">
              <option value="">Any ATS</option>
              {adapters.map((a) => (
                <option key={a} value={a}>{formatAtsLabel(a)}</option>
              ))}
            </Select>
            <div className="ml-auto text-sm text-[hsl(var(--muted-foreground))]">
              {results.isFetching ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Searching…</span> :
                results.data ? `${resultEntries.length} of ${resultTotal.toLocaleString()} shown` : ""}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {!results.isError && totalRegistry === 0 && !results.isFetching && (
            <div className="px-4 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              The live company registry is not loaded yet.
              <span className="block mt-1">
                Restore the production registry backup or add a custom company for now.
              </span>
            </div>
          )}
          {results.isError && !results.isFetching && (
            <div className="px-4 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              Search requires a connection to the registry.{" "}
              <button className="underline hover:text-[hsl(var(--foreground))]" onClick={() => setCustomMode(true)}>
                Add a custom company
              </button>{" "}instead.
            </div>
          )}
          {!results.isError && totalRegistry > 0 && resultEntries.length === 0 && !results.isFetching && (
            <div className="px-4 py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No matches in {activeTierLabel}. Try a different search or
              <button className="ml-1 underline hover:text-[hsl(var(--foreground))]" onClick={() => setCustomMode(true)}>
                add a custom company
              </button>.
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {!results.isError && sortedEntries.map(renderEntry)}
          </ul>
        </div>

        <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex items-center justify-between gap-3 bg-[hsl(var(--card))]/40">
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            Don't see your company? Add it manually with a canonical ATS job board URL.
          </div>
          <Button onClick={() => setCustomMode(true)}>
            <Plus size={15} /> Custom company
          </Button>
        </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
