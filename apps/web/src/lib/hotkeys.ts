/**
 * Hotkeys hook + global registry.
 *
 * Goals:
 *   - Single key: 'j' / 'k' / 'e' / 'x' / '/' / '?' fire when not in an input
 *   - Sequence: 'g' then 'd' (within 1.2s) navigates to Dashboard
 *   - Modifier: ⌘K / Ctrl+K opens Command Palette
 *
 * Why a custom hook (not react-hotkeys-hook)?
 *   - We want zero deps and full control over input-element guarding
 *     (sequences would otherwise fire while typing in a textarea).
 *   - It's a single file we own and can extend.
 */
import { useEffect } from "react";
import { create } from "zustand";

type Handler = (e: KeyboardEvent) => void;

interface KeyDescriptor {
  /** Plain key, e.g. "k" — case-insensitive. Required unless `sequence` is provided. */
  key?: string;
  /** Required modifiers. */
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Sequence to match instead of single key, e.g. ["g", "d"]. */
  sequence?: string[];
  /** Allow the binding while focus is in an input. Default false. */
  allowInInputs?: boolean;
}

interface Binding extends KeyDescriptor {
  id: string;
  description: string;
  category?: string;
  handler: Handler;
}

interface HotkeyStore {
  bindings: Binding[];
  add: (b: Binding) => void;
  remove: (id: string) => void;
}

const useHotkeyStore = create<HotkeyStore>((set) => ({
  bindings: [],
  add: (b) => set((s) => ({ bindings: [...s.bindings.filter((x) => x.id !== b.id), b] })),
  remove: (id) => set((s) => ({ bindings: s.bindings.filter((b) => b.id !== id) })),
}));

let pending: { keys: string[]; ts: number } = { keys: [], ts: 0 };
const SEQUENCE_TIMEOUT = 1200;

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function bindingMatches(b: Binding, e: KeyboardEvent): boolean {
  if (!b.allowInInputs && isTextInputTarget(e.target)) return false;
  if (!!b.meta !== e.metaKey) return false;
  if (!!b.ctrl !== e.ctrlKey) return false;
  if (!!b.shift !== e.shiftKey) {
    // Allow shift to be unspecified for printable chars; only enforce when explicitly true.
    if (b.shift) return false;
  }
  if (!!b.alt !== e.altKey) return false;
  if (b.key) return e.key.toLowerCase() === b.key.toLowerCase();
  return false;
}

function sequenceMatches(b: Binding, keys: string[]): boolean {
  if (!b.sequence) return false;
  if (keys.length < b.sequence.length) return false;
  const tail = keys.slice(-b.sequence.length);
  return tail.every((k, i) => k.toLowerCase() === b.sequence![i].toLowerCase());
}

let globalListenerInstalled = false;
function ensureGlobalListener() {
  if (globalListenerInstalled) return;
  globalListenerInstalled = true;
  window.addEventListener("keydown", (e) => {
    const { bindings } = useHotkeyStore.getState();
    if (isTextInputTarget(e.target) && !(e.metaKey || e.ctrlKey)) {
      pending = { keys: [], ts: 0 };
      return;
    }
    // Single-key + modifier bindings.
    for (const b of bindings) {
      if (b.sequence) continue;
      if (bindingMatches(b, e)) {
        e.preventDefault();
        b.handler(e);
        pending = { keys: [], ts: 0 };
        return;
      }
    }
    // Sequence bindings (only printable, no modifier).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const now = Date.now();
    if (now - pending.ts > SEQUENCE_TIMEOUT) pending = { keys: [], ts: now };
    pending.keys.push(e.key);
    pending.ts = now;
    for (const b of bindings) {
      if (sequenceMatches(b, pending.keys)) {
        e.preventDefault();
        b.handler(e);
        pending = { keys: [], ts: 0 };
        return;
      }
    }
    if (pending.keys.length > 5) pending.keys = pending.keys.slice(-5);
  });
}

/** Register a hotkey for the lifetime of the calling component. */
export function useHotkey(descriptor: KeyDescriptor & { id: string; description: string; category?: string }, handler: Handler) {
  const add = useHotkeyStore((s) => s.add);
  const remove = useHotkeyStore((s) => s.remove);
  useEffect(() => {
    ensureGlobalListener();
    add({ ...descriptor, handler });
    return () => remove(descriptor.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor.id]);
}

/** All currently registered bindings (for the help dialog). */
export function useHotkeyList() {
  return useHotkeyStore((s) => s.bindings);
}
