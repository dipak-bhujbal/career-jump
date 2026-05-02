/**
 * CompanyTable
 * ------------
 * Renders the list of companies the user is tracking.
 *
 * Two row "modes":
 *   - registry-backed (`isRegistry: true`): ATS + URL came from the seed
 *     registry, both shown as read-only badges/text.
 *   - custom: editable ATS dropdown + board-URL input. The parser derives
 *     boardToken / companySlug / etc. from the canonical board URL itself.
 *
 * The component is "controlled" — it never mutates the parent state.
 * It calls the supplied callbacks on edit / remove / toggle and lets
 * the page own the draft state and dirty tracking.
 */
import { Pencil, Trash2, ExternalLink, PauseCircle, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TierTag } from "@/components/ui/tier-tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { type CompanyConfig } from "@/lib/api";
import { cn, companyKey, formatAtsLabel } from "@/lib/utils";
import { ALL_ATS_ADAPTERS } from "@/lib/job-filters";

const ATS_OPTIONS = [
  { value: "", label: "Select ATS" },
  ...ALL_ATS_ADAPTERS.map((a) => ({ value: a.id, label: a.label })),
];

interface CompanyTableProps {
  companies: CompanyConfig[];
  rowIndexes?: number[];
  scanOverrides: Record<string, { paused: boolean }>;
  onChange: (index: number, patch: Partial<CompanyConfig>) => void;
  onRemove: (index: number) => void;
  onToggleScan: (company: string, currentlyPaused: boolean) => void;
}

export function CompanyTable({ companies, rowIndexes, scanOverrides, onChange, onRemove, onToggleScan }: CompanyTableProps) {
  if (companies.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No companies tracked yet. Click <strong className="text-[hsl(var(--foreground))]">Add company</strong> to start.
      </div>
    );
  }
  return (
    <div className="divide-y divide-[hsl(var(--border))]">
      {companies.map((company, index) => {
        // Configuration pagination/filtering keeps rendering a subset of rows, so
        // preserve the original draft index when mutating the parent state.
        const rowIndex = rowIndexes?.[index] ?? index;
        const paused = scanOverrides?.[companyKey(company.company)]?.paused === true;
        return (
          <CompanyRow
            key={`${rowIndex}-${company.company}`}
            company={company}
            index={rowIndex}
            paused={paused}
            onChange={onChange}
            onRemove={onRemove}
            onToggleScan={onToggleScan}
          />
        );
      })}
    </div>
  );
}

function CompanyRow({
  company, index, paused, onChange, onRemove, onToggleScan,
}: {
  company: CompanyConfig; index: number; paused: boolean;
  onChange: CompanyTableProps["onChange"];
  onRemove: CompanyTableProps["onRemove"];
  onToggleScan: CompanyTableProps["onToggleScan"];
}) {
  // Treat as registry-backed if explicitly flagged OR if registryAts is present
  // (real backend may not persist isRegistry but always returns registryAts for picker-added companies)
  const isRegistry = company.isRegistry === true || Boolean(company.registryAts);
  return (
    <div className={cn("grid grid-cols-12 gap-3 items-center px-5 py-3", paused && "opacity-60")}>
      {/* Avatar + name (col-span 4) */}
      <div className="col-span-4 flex items-center gap-2.5 min-w-0">
        <div className="h-7 w-7 shrink-0 rounded-md bg-gradient-to-br from-blue-500/20 to-purple-500/20 grid place-items-center text-[12px] font-semibold">
          {(company.company || "?").slice(0, 2).toUpperCase()}
        </div>
        {isRegistry ? (
          <span className="font-medium text-sm truncate">{company.company}</span>
        ) : (
          <Input
            value={company.company}
            onChange={(e) => onChange(index, { company: e.target.value })}
            placeholder="Company name"
            className="h-8"
          />
        )}
      </div>

      {/* ATS (col-span 2) */}
      <div className="col-span-2 min-w-0">
        {isRegistry ? (
          <Badge variant="default">{formatAtsLabel(company.registryAts || company.source)}</Badge>
        ) : (
          <Select
            value={company.source}
            onChange={(e) => onChange(index, { source: e.target.value })}
            className="h-8 text-xs"
          >
            {ATS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        )}
      </div>

      {/* Source / URL (col-span 4) */}
      <div className="col-span-4 min-w-0">
        {isRegistry ? (
          <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
            <span>Auto-discovered</span>
            {company.registryTier && <TierTag tier={company.registryTier} />}
            {(company.boardUrl || company.sampleUrl) && (
              <a href={company.boardUrl || company.sampleUrl} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 hover:text-[hsl(var(--foreground))] truncate">
                <ExternalLink size={11} />
                <span className="truncate">{company.boardUrl || company.sampleUrl}</span>
              </a>
            )}
          </div>
        ) : (
          <Input
            value={company.boardUrl ?? company.sampleUrl ?? ""}
            onChange={(e) => onChange(index, { boardUrl: e.target.value, sampleUrl: "" })}
            placeholder="https://… job board URL"
            className="h-8 text-xs"
          />
        )}
      </div>

      {/* Actions (col-span 2) */}
      <div className="col-span-2 flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          title={paused ? "Resume scans" : "Pause scans"}
          aria-label={paused ? "Resume scans" : "Pause scans"}
          onClick={() => onToggleScan(company.company, paused)}
          disabled={!company.company}
        >
          {paused ? <PlayCircle size={16} className="text-amber-400" /> : <PauseCircle size={16} />}
        </Button>
        {!isRegistry && (
          <Button variant="ghost" size="icon" title="Edit row" aria-label="Edit">
            <Pencil size={14} />
          </Button>
        )}
        <Button variant="ghost" size="icon" title="Remove" aria-label="Remove" onClick={() => onRemove(index)}>
          <Trash2 size={14} className="text-rose-400" />
        </Button>
      </div>
    </div>
  );
}
