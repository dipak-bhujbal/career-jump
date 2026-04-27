/**
 * Dashboard widget layout store — persisted list of widget IDs to
 * render, in user-chosen order. Stored in localStorage so it survives
 * reloads. The widget registry (see ./widgets.tsx) maps each ID to a
 * concrete component.
 */
import { useEffect } from "react";
import { create } from "zustand";

const KEY = "career-jump-dashboard-layout";

const DEFAULT_LAYOUT: string[] = [
  "kpi-pipeline",
  "kpi-conversion",
  "funnel",
  "kpi-stages",
  "top-companies",
  "recent-activity",
  "status-breakdown",
  "keyword-cloud",
];

function readStored(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : null;
  } catch {
    return null;
  }
}

interface WidgetStore {
  layout: string[];
  customizing: boolean;
  setLayout: (next: string[]) => void;
  add: (id: string) => void;
  remove: (id: string) => void;
  reset: () => void;
  toggleCustomizing: () => void;
}

export const useWidgetStore = create<WidgetStore>((set, get) => ({
  layout: readStored() ?? [...DEFAULT_LAYOUT],
  customizing: false,
  setLayout: (next) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    set({ layout: next });
  },
  add: (id) => {
    const cur = get().layout;
    if (cur.includes(id)) return;
    get().setLayout([...cur, id]);
  },
  remove: (id) => {
    get().setLayout(get().layout.filter((x) => x !== id));
  },
  reset: () => {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    set({ layout: [...DEFAULT_LAYOUT] });
  },
  toggleCustomizing: () => set((s) => ({ customizing: !s.customizing })),
}));

/** Run once on app start so the layout is hydrated synchronously. */
export function useEnsureLayout() {
  useEffect(() => undefined, []);
}
