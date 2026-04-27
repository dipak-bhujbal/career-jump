/**
 * FilterToolbar + QuickTab — shared filter UI used on Jobs / Applied /
 * Action Plan / Configuration so the filter pattern is visually
 * identical everywhere.
 *
 * Usage:
 *   <FilterToolbar
 *     tabs={[{label:"All",count:42}, {label:"New",count:3,tone:"cyan"}]}
 *     activeTabIndex={0}
 *     onTabChange={(i) => …}
 *     advanced={advancedOpen}
 *     onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
 *     advancedActive={someFilterIsSet}
 *     onClearAdvanced={resetAdvancedFilters}
 *   />
 */
import { ChevronDown, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type QuickTabTone = "primary" | "cyan" | "amber" | "emerald" | "rose" | "violet";

export interface QuickTabSpec {
  label: string;
  icon?: React.ReactNode;
  count?: number;
  tone?: QuickTabTone;
}

interface FilterToolbarProps {
  /** Tabs to render. Pass empty `[]` for a "filter-only" toolbar with no tabs. */
  tabs?: QuickTabSpec[];
  activeTabIndex?: number;
  onTabChange?: (index: number) => void;
  /** Left-side label when there are no tabs (e.g. "42 applications"). */
  label?: React.ReactNode;
  /** Optional advanced-filter section toggling. Pass undefined to hide. */
  advanced?: boolean;
  onAdvancedToggle?: () => void;
  advancedActive?: boolean;
  onClearAdvanced?: () => void;
  /** Extra controls rendered on the right (e.g. Refresh button). */
  rightSlot?: React.ReactNode;
}

export function FilterToolbar({
  tabs = [], activeTabIndex = 0, onTabChange,
  label,
  advanced, onAdvancedToggle, advancedActive, onClearAdvanced,
  rightSlot,
}: FilterToolbarProps) {
  return (
    /* `sticky top-0` keeps the filter toolbar pinned at the top of the
     * scroll container as the user scrolls down through long lists.
     * z-20 sits above the table but below modal overlays. */
    <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-[hsl(var(--background))]/90 backdrop-blur-sm border-b border-[hsl(var(--border))]/0 flex flex-wrap items-center gap-2">
      {tabs.length > 0
        ? tabs.map((tab, i) => (
            <QuickTab
              key={`${tab.label}-${i}`}
              active={i === activeTabIndex}
              onClick={() => onTabChange?.(i)}
              icon={tab.icon}
              label={tab.label}
              count={tab.count}
              tone={tab.tone ?? "primary"}
            />
          ))
        : label && (
            <span className="text-sm font-medium text-[hsl(var(--muted-foreground))] px-1">{label}</span>
          )}
      <div className="ml-auto flex items-center gap-2">
        {rightSlot}
        {onAdvancedToggle && (
          <button
            type="button"
            onClick={onAdvancedToggle}
            className={
              "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-[hsl(var(--border))] text-sm transition-colors " +
              (advanced ? "bg-[hsl(var(--accent))]" : "hover:bg-[hsl(var(--accent))]")
            }
            aria-expanded={advanced}
          >
            <Filter size={14} />
            Filters
            {advancedActive && <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-xs font-semibold px-1.5">●</span>}
            <ChevronDown size={14} className={"transition-transform " + (advanced ? "rotate-180" : "")} />
          </button>
        )}
        {advancedActive && onClearAdvanced && (
          <Button variant="warning" size="sm" onClick={onClearAdvanced}>
            <X size={13} /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}

interface QuickTabProps {
  active?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  count?: number;
  tone?: QuickTabTone;
}

/**
 * One consistent active state across the entire app — selected tab uses
 * the primary blue (filled, with a clear ring) so it's instantly
 * recognizable from any unselected tab regardless of label or icon.
 * The `tone` prop is kept for backwards-compat but ignored.
 */
export function QuickTab({ active, onClick, icon, label, count }: QuickTabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 h-10 px-4 rounded-lg border text-sm font-medium transition-all " +
        (active
          ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border-[hsl(var(--primary))] shadow-sm"
          : "border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))]")
      }
      aria-pressed={active}
    >
      {icon && <span className={active ? "opacity-90" : "text-[hsl(var(--muted-foreground))]"}>{icon}</span>}
      <span>{label}</span>
      {typeof count === "number" && count > 0 && (
        <span
          className={
            "inline-flex items-center justify-center h-5 min-w-5 rounded-full px-1.5 text-xs font-semibold tabular-nums " +
            (active
              ? "bg-white/25 text-white"
              : "bg-[hsl(var(--secondary))] text-[hsl(var(--foreground))]")
          }
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}
