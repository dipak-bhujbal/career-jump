/**
 * Keyboard cheatsheet — opens with `?`. Lists every hotkey currently
 * registered via useHotkey, grouped by category.
 */
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { useHotkey, useHotkeyList } from "@/lib/hotkeys";

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);
  const bindings = useHotkeyList();

  useHotkey({ id: "help-open", description: "Show keyboard shortcuts", category: "App", key: "?", shift: true }, () => setOpen(true));

  useEffect(() => undefined, []);

  // Group by category.
  const groups = bindings.reduce<Record<string, typeof bindings>>((acc, b) => {
    const cat = b.category ?? "Other";
    (acc[cat] ??= []).push(b);
    return acc;
  }, {});

  return (
    <Dialog open={open} onClose={() => setOpen(false)} size="md">
      <div className="p-5">
        <h3 className="text-lg font-semibold mb-3">Keyboard shortcuts</h3>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat}>
              <div className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-2">{cat}</div>
              <ul className="space-y-1.5">
                {items.map((b) => (
                  <li key={b.id} className="flex items-center justify-between text-sm">
                    <span>{b.description}</span>
                    <KeyChord binding={b} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-4 pt-3 border-t border-[hsl(var(--border))]">
          Press <Kbd>?</Kbd> anywhere to reopen this. Press <Kbd>Esc</Kbd> to close.
        </p>
      </div>
    </Dialog>
  );
}

function KeyChord({ binding }: { binding: ReturnType<typeof useHotkeyList>[number] }) {
  if (binding.sequence) {
    return (
      <span className="flex gap-1">
        {binding.sequence.map((k, i) => <Kbd key={i}>{k}</Kbd>)}
      </span>
    );
  }
  const parts: string[] = [];
  if (binding.meta) parts.push("⌘");
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("⌥");
  if (binding.shift) parts.push("⇧");
  if (binding.key) parts.push(binding.key);
  return (
    <span className="flex gap-1">
      {parts.map((p, i) => <Kbd key={i}>{p}</Kbd>)}
    </span>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-1.5 font-mono text-[12px] font-medium uppercase">
      {children}
    </kbd>
  );
}
