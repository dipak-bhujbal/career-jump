import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DensityToggle } from "@/components/ui/density-toggle";
import { Kbd } from "@/components/keyboard-help";
import { ProfileMenu } from "@/components/layout/profile-menu";

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/80 backdrop-blur px-6 py-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <button
          type="button"
          onClick={() => {
            // Synthesize ⌘K to open the global command palette without
            // duplicating the open/close state. Keeps a single source of truth.
            const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
            window.dispatchEvent(ev);
          }}
          className="hidden md:inline-flex items-center gap-2 h-10 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
          aria-label="Open command palette"
          title="Open command palette"
        >
          <span>Search…</span>
          <span className="flex gap-0.5"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
        </button>
        <DensityToggle />
        <ThemeToggle />
        <ProfileMenu />
      </div>
    </header>
  );
}
