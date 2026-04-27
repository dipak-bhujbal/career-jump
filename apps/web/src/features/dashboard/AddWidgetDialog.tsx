/**
 * Add-widget picker — lists every widget *not* currently on the
 * dashboard, with a category filter dropdown and a search box.
 */
import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { REGISTRY, WIDGET_IDS, type WidgetCategory, type WidgetKind } from "./widgets";
import { useWidgetStore } from "./widget-store";

interface Props { open: boolean; onClose: () => void }

const CATEGORIES: ("All" | WidgetCategory)[] = ["All", "Pipeline", "Conversion", "Stages", "Companies", "Coverage", "Activity", "Interviews"];
export function AddWidgetDialog({ open, onClose }: Props) {
  const { layout, add } = useWidgetStore();
  const [category, setCategory] = useState<"All" | WidgetCategory>("All");
  const [kind, setKind] = useState<"All" | WidgetKind>("All");
  const [query, setQuery] = useState("");

  const available = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WIDGET_IDS
      .filter((id) => !layout.includes(id))
      .filter((id) => category === "All" || REGISTRY[id].category === category)
      .filter((id) => kind === "All" || REGISTRY[id].kind === kind)
      .filter((id) => {
        if (!q) return true;
        const w = REGISTRY[id];
        return w.title.toLowerCase().includes(q) || w.description.toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => REGISTRY[a].title.localeCompare(REGISTRY[b].title));
  }, [layout, category, kind, query]);

  return (
    <Dialog open={open} onClose={onClose} size="md">
      <div className="p-5 space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Add widget</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Pick a widget to add to your dashboard.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_140px] gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search widgets…"
              className="pl-8"
            />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === "All" ? "All categories" : `${c} (${WIDGET_IDS.filter((id) => REGISTRY[id].category === c && !layout.includes(id)).length})`}
              </option>
            ))}
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="All">All types</option>
            <option value="Single">Single ({WIDGET_IDS.filter((id) => REGISTRY[id].kind === "Single" && !layout.includes(id)).length})</option>
            <option value="Grouped">Grouped ({WIDGET_IDS.filter((id) => REGISTRY[id].kind === "Grouped" && !layout.includes(id)).length})</option>
          </Select>
        </div>

        {available.length === 0 ? (
          <div className="rounded-md border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            {WIDGET_IDS.every((id) => layout.includes(id))
              ? "All widgets are already on your dashboard."
              : "No widgets match this filter."}
          </div>
        ) : (
          <ul className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
            {available.map((id) => {
              const w = REGISTRY[id];
              return (
                <li key={id} className="flex items-center gap-3 rounded-md border border-[hsl(var(--border))] px-3 py-2.5">
                  <div className="h-9 w-9 rounded-md grid place-items-center bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]">
                    {w.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                      {w.title}
                      <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] bg-[hsl(var(--secondary))] rounded px-1.5 py-0.5">{w.category}</span>
                      <span className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] bg-[hsl(var(--secondary))] rounded px-1.5 py-0.5">{w.kind}</span>
                    </div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">{w.description}</div>
                  </div>
                  <Button size="sm" onClick={() => { add(id); }}>
                    <Plus size={13} /> Add
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
