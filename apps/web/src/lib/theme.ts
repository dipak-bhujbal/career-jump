/**
 * Theme store — light / dark toggle persisted to localStorage.
 *
 * The vanilla app stores under "career-jump-theme"; we reuse the same
 * key so that switching between vanilla and React doesn't reset the
 * preference.
 */
import { create } from "zustand";

const KEY = "career-jump-theme";
type Theme = "light" | "dark";

function readStored(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "light") return "light";
    return "dark";
  } catch {
    return "dark";
  }
}

function applyToDocument(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") root.classList.add("light");
  else root.classList.remove("light");
}

interface ThemeStore { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void }

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: readStored(),
  setTheme: (theme) => {
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
    applyToDocument(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

// Apply on first import so the initial render matches the stored preference.
applyToDocument(readStored());
