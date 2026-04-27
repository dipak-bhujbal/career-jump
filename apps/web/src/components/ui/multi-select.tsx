/**
 * MultiSelect — Excel/Sheets-style filter dropdown with checkboxes.
 *
 *   <MultiSelect
 *     options={["Stripe","Anthropic","Walmart"]}
 *     value={selected}
 *     onChange={setSelected}
 *     placeholder="All companies"
 *     allLabel="All companies"   // optional label for the "(all selected)" state
 *   />
 *
 * Features:
 *   - Search / typeahead within the dropdown
 *   - "Select all" / "Clear" actions at the top
 *   - Checkbox per option — click the row or the box to toggle
 *   - Trigger shows a summary: placeholder, single-name, or "N selected"
 *   - Always opens BELOW the trigger (consistent with our Select)
 */
import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MultiSelectProps {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Singular noun for the count summary, e.g. "company" → "3 companies". */
  noun?: string;
  className?: string;
  disabled?: boolean;
  emptyText?: string;
}

export function MultiSelect({
  options, value, onChange,
  placeholder = "Select…",
  noun = "selected",
  className,
  disabled,
  emptyText = "No options",
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selectedSet.has(o));

  function toggle(option: string) {
    if (selectedSet.has(option)) onChange(value.filter((v) => v !== option));
    else onChange([...value, option]);
  }

  function selectAllFiltered() {
    const merged = Array.from(new Set([...value, ...filtered]));
    onChange(merged);
  }

  function clearFiltered() {
    onChange(value.filter((v) => !filtered.includes(v)));
  }

  function clearAll() {
    onChange([]);
  }

  const summary =
    value.length === 0 ? placeholder
    : value.length === 1 ? value[0]
    : `${value.length} ${noun}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-all hover:bg-[hsl(var(--accent))]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("truncate", value.length === 0 && "text-[hsl(var(--muted-foreground))]")}>
            {summary}
          </span>
          <ChevronDown size={14} className="opacity-50 ml-2 shrink-0" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          avoidCollisions={false}
          className="z-50 min-w-[var(--radix-popover-trigger-width)] w-[var(--radix-popover-trigger-width)] max-h-[60vh] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg animate-in fade-in-80 zoom-in-95"
        >
          <div className="p-2 border-b border-[hsl(var(--border))] space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                autoFocus
                className="h-8 w-full rounded-md border border-[hsl(var(--input))] bg-transparent pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={selectAllFiltered}
                disabled={filtered.length === 0 || allFilteredSelected}
                className="px-2 py-1 rounded-md hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Select all{query ? " (filtered)" : ""}
              </button>
              <button
                type="button"
                onClick={clearFiltered}
                disabled={!filtered.some((o) => selectedSet.has(o))}
                className="px-2 py-1 rounded-md hover:bg-[hsl(var(--accent))] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Unselect{query ? " (filtered)" : ""}
              </button>
              {value.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-amber-400 hover:bg-amber-500/15"
                >
                  <X size={12} /> Clear all
                </button>
              )}
            </div>
          </div>
          <ul className="max-h-[260px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-3 text-center text-sm text-[hsl(var(--muted-foreground))]">{emptyText}</li>
            ) : (
              filtered.map((option) => {
                const checked = selectedSet.has(option);
                return (
                  <li key={option}>
                    <button
                      type="button"
                      onClick={() => toggle(option)}
                      className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))]"
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          checked
                            ? "bg-[hsl(var(--primary))] border-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                            : "border-[hsl(var(--input))]",
                        )}
                      >
                        {checked && <Check size={12} />}
                      </span>
                      <span className="truncate">{option}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {value.length > 0 && (
            <div className="border-t border-[hsl(var(--border))] px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              {value.length} {noun}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
