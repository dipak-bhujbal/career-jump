/**
 * Global command palette (⌘K).
 *
 * Lets users:
 *   - Navigate (Dashboard / Jobs / Applied / Plan / Configuration)
 *   - Search the registry of 1,200+ companies and add to tracked
 *   - Search current available jobs by title or company
 *   - Run app actions (Scan, Toggle theme, Clear cache)
 *
 * The data sources for jobs and registry are queried lazily (only
 * fetched when the palette is open) to keep the rest of the app fast.
 */
import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Briefcase, CheckSquare, Target, Settings,
  Play, Trash2, Sun, Moon, Plus, Search, Sparkles,
} from "lucide-react";
import { useHotkey } from "@/lib/hotkeys";
import { useTheme } from "@/lib/theme";
import { useStartRun, useClearCache } from "@/features/run/queries";
import { confirmLargeScanStart, enabledCompanyCountForScan, formatRunCompletionToast } from "@/features/run/presentation";
import { useRegistrySearch } from "@/features/companies/queries";
import { useConfig } from "@/features/companies/queries";
import { useJobs } from "@/features/jobs/queries";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useMe } from "@/features/session/queries";
import { trackEvent } from "@/lib/analytics";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useHotkey(
    { id: "cmd-k", description: "Open command palette", category: "App", key: "k", meta: true, allowInInputs: true },
    () => setOpen((o) => !o),
  );
  useHotkey(
    { id: "cmd-k-ctrl", description: "Open command palette", category: "App", key: "k", ctrl: true, allowInInputs: true },
    () => setOpen((o) => !o),
  );

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);


  const navigate = useNavigate();
  const { theme, toggle: toggleTheme } = useTheme();
  const startRun = useStartRun();
  const clearCache = useClearCache();
  const config = useConfig({ enabled: open });
  const { data: me } = useMe();

  const registry = useRegistrySearch({ search: debounced, enabled: open && debounced.length >= 2 });
  const jobs = useJobs(
    { keyword: debounced, limit: 8 },
    {
      // Keep the palette read-only until the user is actively searching so it
      // does not duplicate the main Available Jobs query on every route load.
      enabled: open && debounced.length >= 2,
    },
  );
  const enabledCompanyCount = enabledCompanyCountForScan(
    config.data?.config.companies,
    config.data?.companyScanOverrides,
  );
  const isAdmin = me?.actor.isAdmin === true;

  const go = (to: string) => () => { setOpen(false); navigate({ to }); };
  const action = (fn: () => void) => () => { setOpen(false); fn(); };

  const navItems = useMemo(() => [
    { label: "Dashboard", to: "/", icon: LayoutDashboard, hint: "g d" },
    { label: "Available Jobs", to: "/jobs", icon: Briefcase, hint: "g j" },
    { label: "Applied Jobs", to: "/applied", icon: CheckSquare, hint: "g a" },
    { label: "Action Plan", to: "/plan", icon: Target, hint: "g p" },
    { label: "Configuration", to: "/configuration", icon: Settings, hint: "g c" },
  ], []);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:p-8 bg-black/60 backdrop-blur-sm animate-in fade-in"
      onMouseDown={() => setOpen(false)}
    >
      <Command
        loop
        className="w-full max-w-xl rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-2xl mt-12 animate-in zoom-in-95"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 border-b border-[hsl(var(--border))]">
          <Search size={15} className="text-[hsl(var(--muted-foreground))]" />
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search companies, jobs, or run a command…"
            className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-[hsl(var(--muted-foreground))]"
            autoFocus
          />
          <kbd className="hidden sm:inline-flex h-5 items-center px-1.5 rounded border border-[hsl(var(--border))] text-[12px] font-mono">esc</kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1">
          <Command.Empty className="px-3 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No results. Try "Stripe" / "configuration" / "scan".
          </Command.Empty>

          <Command.Group heading="Navigate" className="text-[12px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] px-2 pt-2 pb-1">
            {navItems.map((it) => (
              <Item key={it.to} onSelect={go(it.to)} icon={<it.icon size={14} />} label={it.label} hint={it.hint} />
            ))}
          </Command.Group>

          {(jobs.data?.jobs.length ?? 0) > 0 && (
            <Command.Group heading="Jobs" className="text-[12px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] px-2 pt-2 pb-1">
              {jobs.data!.jobs.slice(0, 8).map((job) => (
                <Item
                  key={job.jobKey}
                  onSelect={() => { setOpen(false); navigate({ to: "/jobs" }); }}
                  icon={<Briefcase size={14} />}
                  label={`${job.company} · ${job.jobTitle}`}
                  hint={job.location ?? ""}
                />
              ))}
            </Command.Group>
          )}

          {(registry.data?.entries.length ?? 0) > 0 && (
            <Command.Group heading="Companies · Add to tracked" className="text-[12px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] px-2 pt-2 pb-1">
              {registry.data!.entries.slice(0, 8).map((entry) => (
                <Item
                  key={entry.company}
                  onSelect={() => { setOpen(false); navigate({ to: "/configuration" }); toast(`Open Configuration → Add "${entry.company}"`, "info"); }}
                  icon={<Plus size={14} />}
                  label={entry.company}
                  hint={entry.ats ?? ""}
                />
              ))}
            </Command.Group>
          )}

          <Command.Group heading="Actions" className="text-[12px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] px-2 pt-2 pb-1">
            <Item
              onSelect={action(() => {
                if (!confirmLargeScanStart(enabledCompanyCount, isAdmin)) return;
                toast("Scan starting", "info");
                // Mirror the sidebar scan event so command-palette launches are
                // attributed to the same product action in GA4.
                trackEvent("run_scan", {
                  enabled_company_count: enabledCompanyCount,
                  actor_role: isAdmin ? "admin" : "user",
                  confirm_large_scan: enabledCompanyCount > 20,
                  trigger_surface: "command_palette",
                });
                startRun.mutate({ confirmLargeScan: enabledCompanyCount > 20 }, {
                  onSuccess: (result) => toast(formatRunCompletionToast(result)),
                  onError: (error) => toast(error instanceof Error ? error.message : "Start failed", "error"),
                });
              })}
              icon={<Play size={14} />}
              label="Run scan"
              hint="immediate"
            />
            <Item
              onSelect={action(toggleTheme)}
              icon={theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            />
            <Item
              onSelect={action(() => clearCache.mutate(undefined, { onSuccess: () => toast("Cache cleared") }))}
              icon={<Trash2 size={14} />}
              label="Clear cache"
            />
            <Item
              onSelect={action(() => navigate({ to: "/configuration" }))}
              icon={<Sparkles size={14} />}
              label="Open company picker"
            />
          </Command.Group>
        </Command.List>
        <div className="px-3 py-2 border-t border-[hsl(var(--border))] flex items-center gap-3 text-[12px] text-[hsl(var(--muted-foreground))]">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
          <span className="ml-auto"><kbd className="font-mono">?</kbd> all shortcuts</span>
        </div>
      </Command>
    </div>
  );
}

function Item({ onSelect, icon, label, hint }: { onSelect: () => void; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer aria-selected:bg-[hsl(var(--accent))] data-[selected=true]:bg-[hsl(var(--accent))]",
      )}
    >
      <span className="text-[hsl(var(--muted-foreground))]">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[12px] text-[hsl(var(--muted-foreground))] font-mono">{hint}</span>}
    </Command.Item>
  );
}
