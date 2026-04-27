/**
 * UI density preference — comfortable / compact / spacious.
 * Stored to localStorage, applied as a `data-density` attr on <html>
 * so any component can opt into density-aware spacing via the
 * `data-density` attribute selector.
 */
import { create } from "zustand";

const KEY = "career-jump-density";
type Density = "comfortable" | "compact" | "spacious";

function read(): Density {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "compact" || raw === "spacious") return raw;
    return "comfortable";
  } catch {
    return "comfortable";
  }
}

function apply(d: Density) {
  document.documentElement.setAttribute("data-density", d);
}

interface DensityStore { density: Density; setDensity: (d: Density) => void; cycle: () => void }

export const useDensity = create<DensityStore>((set, get) => ({
  density: read(),
  setDensity: (density) => {
    try { localStorage.setItem(KEY, density); } catch { /* ignore */ }
    apply(density);
    set({ density });
  },
  cycle: () => {
    const order: Density[] = ["comfortable", "compact", "spacious"];
    const next = order[(order.indexOf(get().density) + 1) % order.length];
    get().setDensity(next);
  },
}));

apply(read());
