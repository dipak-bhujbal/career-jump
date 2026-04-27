/**
 * Available-jobs table.
 *
 * Features:
 *   - Click a row → opens drawer
 *   - Checkbox column for multi-select; shift-click range select
 *   - j / k navigation when no input is focused (handled in Jobs route)
 *   - Highlights the currently focused row
 *   - Sortable columns — click header to sort, click again to flip direction
 */
import { type Job } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { ExternalLink, Sparkles, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CompanyHoverCard } from "@/features/companies/CompanyHoverCard";
import { cn } from "@/lib/utils";

export type SortCol = "company" | "title" | "location" | "posted" | "source";
export type SortDir = "asc" | "desc";

interface JobsTableProps {
  jobs: Job[];
  onSelect: (job: Job) => void;
  selectedKey?: string;
  /** keys of jobs in the multi-select set. */
  checked: Set<string>;
  onToggleChecked: (key: string, options?: { range?: boolean }) => void;
  /** Index that hotkeys are pointing at — gets a focus ring. */
  focusedIndex?: number;
  isLoading?: boolean;
  sortBy?: SortCol;
  sortDir?: SortDir;
  onSort?: (col: SortCol) => void;
}

function SortIcon({ col, sortBy, sortDir }: { col: SortCol; sortBy?: SortCol; sortDir?: SortDir }) {
  if (sortBy !== col) return <ChevronsUpDown size={12} className="ml-1 opacity-30 inline-block" />;
  return sortDir === "asc"
    ? <ChevronUp size={12} className="ml-1 text-[hsl(var(--primary))] inline-block" />
    : <ChevronDown size={12} className="ml-1 text-[hsl(var(--primary))] inline-block" />;
}

export function JobsTable({
  jobs, onSelect, selectedKey, checked, onToggleChecked,
  focusedIndex, isLoading, sortBy, sortDir, onSort,
}: JobsTableProps) {
  if (isLoading && jobs.length === 0) {
    return (
      <div className="p-6 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 rounded-md bg-[hsl(var(--muted))] animate-pulse" />
        ))}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="p-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
        No jobs match your filters. Try widening the search or running a fresh scan.
      </div>
    );
  }

  function thClass(col: SortCol) {
    return cn(
      "text-left px-4 py-3 font-medium select-none whitespace-nowrap",
      onSort && "cursor-pointer hover:text-[hsl(var(--foreground))] transition-colors",
      sortBy === col && "text-[hsl(var(--foreground))]",
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
          <tr className="border-b border-[hsl(var(--border))]">
            <th className="w-10 px-3 py-3" />
            <th className={thClass("company")} onClick={() => onSort?.("company")}>
              Company <SortIcon col="company" sortBy={sortBy} sortDir={sortDir} />
            </th>
            <th className={thClass("title")} onClick={() => onSort?.("title")}>
              Title <SortIcon col="title" sortBy={sortBy} sortDir={sortDir} />
            </th>
            <th className={thClass("location")} onClick={() => onSort?.("location")}>
              Location <SortIcon col="location" sortBy={sortBy} sortDir={sortDir} />
            </th>
            <th className={thClass("posted")} onClick={() => onSort?.("posted")}>
              Posted <SortIcon col="posted" sortBy={sortBy} sortDir={sortDir} />
            </th>
            <th className={thClass("source")} onClick={() => onSort?.("source")}>
              Source <SortIcon col="source" sortBy={sortBy} sortDir={sortDir} />
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job, idx) => (
            <tr
              key={job.jobKey}
              data-job-row={job.jobKey}
              onClick={() => onSelect(job)}
              className={cn(
                "border-b border-[hsl(var(--border))] cursor-pointer transition-colors",
                selectedKey === job.jobKey && "bg-[hsl(var(--accent))]",
                focusedIndex === idx && "ring-2 ring-inset ring-[hsl(var(--ring))]",
                job.isNew && "animate-fresh-pulse",
                selectedKey !== job.jobKey && focusedIndex !== idx && "hover:bg-[hsl(var(--accent))]/50",
              )}
            >
              <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))] cursor-pointer"
                  checked={checked.has(job.jobKey)}
                  onClick={(e) => onToggleChecked(job.jobKey, { range: e.shiftKey })}
                  onChange={() => undefined}
                  aria-label={`Select ${job.jobTitle}`}
                />
              </td>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <CompanyHoverCard company={job.company}>
                  <span className="hover:underline cursor-default">{job.company || "—"}</span>
                </CompanyHoverCard>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{job.jobTitle || "—"}</span>
                  {job.isNew && (
                    <Badge variant="success" title="New in latest scan"><Sparkles size={10} className="mr-1" />New</Badge>
                  )}
                  {job.isUpdated && !job.isNew && (
                    <span className="relative group/diff inline-flex">
                      <Badge variant="warning"><RefreshCw size={10} className="mr-1" />Updated</Badge>
                      {job.changes && job.changes.length > 0 && (
                        <div className="absolute left-0 top-full mt-1.5 z-30 hidden group-hover/diff:block w-64 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-lg p-2.5 space-y-1.5 text-xs pointer-events-none">
                          <div className="text-[hsl(var(--muted-foreground))] font-medium mb-1">What changed</div>
                          {job.changes.map((c) => (
                            <div key={c.field} className="grid grid-cols-[52px_1fr] gap-x-2 items-baseline">
                              <span className="text-[hsl(var(--muted-foreground))] font-medium">{c.field}</span>
                              <span className="space-x-1">
                                <span className="line-through text-rose-500/80">{c.from}</span>
                                <span className="text-[hsl(var(--muted-foreground))]">→</span>
                                <span className="text-emerald-500">{c.to}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))]">{job.location || "—"}</td>
              <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))] whitespace-nowrap">{formatShortDate(job.postedAtDate)}</td>
              <td className="px-4 py-2.5 text-[hsl(var(--muted-foreground))] capitalize">{job.source || "—"}</td>
              <td className="px-4 py-2.5">
                <a href={job.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                   className="inline-flex items-center gap-1 text-[hsl(var(--primary))] text-xs hover:underline">
                  <ExternalLink size={12} /> Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
