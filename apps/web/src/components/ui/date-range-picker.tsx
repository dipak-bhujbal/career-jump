/**
 * DateRangePicker — compact version (per user request).
 *
 * Layout (~360 × 250 px):
 *   ┌──────────────────────┬──────────────┐
 *   │  Calendar (compact)  │ QUICK        │
 *   │  26 px day cells     │ Last 1h      │
 *   │                      │ Last 6h      │
 *   │                      │ Last 24h     │
 *   │                      │ Last 7d      │
 *   │                      │ Last 30d     │
 *   │                      │ Last 3mo     │
 *   ├─────────────────────────────────────┤
 *   │  Start              End             │
 *   │  ┌──────────┐    ┌──────────┐       │
 *   │  │ 📅 yyyy… │    │ 📅 yyyy… │       │
 *   │  └──────────┘    └──────────┘       │
 *   ├─────────────────────────────────────┤
 *   │              Clear      Apply        │
 *   └─────────────────────────────────────┘
 *
 * Start / End are plain text inputs with the placeholder
 * "yyyy-MM-dd HH:mm" — parsed on blur. NOT datetime-local (the user
 * does not want the native calendar popup to open from those fields,
 * since the calendar is already in the popover above).
 */
import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker, type DateRange } from "react-day-picker";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

import "react-day-picker/style.css";

export interface DateRangeValue {
  from: Date | null;
  to: Date | null;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  className?: string;
  placeholder?: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const PRESETS: { label: string; getRange: () => DateRangeValue }[] = [
  { label: "Last 1h",  getRange: () => ({ from: new Date(Date.now() - HOUR), to: new Date() }) },
  { label: "Last 6h",  getRange: () => ({ from: new Date(Date.now() - 6 * HOUR), to: new Date() }) },
  { label: "Last 24h", getRange: () => ({ from: new Date(Date.now() - 24 * HOUR), to: new Date() }) },
  { label: "Last 7d",  getRange: () => ({ from: new Date(Date.now() - 7 * DAY), to: new Date() }) },
  { label: "Last 30d", getRange: () => ({ from: new Date(Date.now() - 30 * DAY), to: new Date() }) },
  { label: "Last 3mo", getRange: () => ({ from: new Date(Date.now() - 90 * DAY), to: new Date() }) },
];

function fmtTrigger(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTextInput(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a "yyyy-MM-dd HH:mm" string. Returns null on bad input so the
 *  field can keep showing whatever the user typed without erasing the
 *  current value. */
function parseTextInput(s: string): Date | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh ?? 0), Number(mm ?? 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function DateRangePicker({ value, onChange, className, placeholder = "Pick dates" }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const summary = value.from && value.to
    ? `${fmtTrigger(value.from)} – ${fmtTrigger(value.to)}`
    : value.from
    ? `${fmtTrigger(value.from)} –`
    : placeholder;

  const dpRange: DateRange | undefined = (value.from || value.to)
    ? { from: value.from ?? undefined, to: value.to ?? undefined }
    : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-start gap-2 rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-all hover:bg-[hsl(var(--accent))]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
            className,
          )}
        >
          <Calendar size={14} className="text-[hsl(var(--muted-foreground))] shrink-0" />
          <span className={cn("truncate", !value.from && "text-[hsl(var(--muted-foreground))]")}>{summary}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={4}
          collisionPadding={16}
          className="z-50 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-lg p-0 animate-in fade-in-80 zoom-in-95 max-w-[calc(100vw-32px)]"
        >
          <div className="flex">
            <div className="py-2 px-1.5 border-r border-[hsl(var(--border))] shrink-0">
              <DayPicker
                mode="range"
                numberOfMonths={1}
                selected={dpRange}
                onSelect={(r) => onChange({ from: r?.from ?? null, to: r?.to ?? null })}
                styles={{
                  root: { fontSize: "12px" },
                  day_button: { width: 26, height: 26, fontSize: 12 },
                  weekday: { fontSize: 11, fontWeight: 500 },
                  caption_label: { fontSize: 13, fontWeight: 600 },
                  month_caption: { padding: "0 4px", marginBottom: 4 },
                  nav: { gap: 4 },
                  chevron: { width: 14, height: 14 },
                  weeks: { gap: 0 },
                }}
              />
            </div>
            <div className="flex flex-col gap-0.5 py-2 px-2 w-[140px] shrink-0">
              <div className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Quick</div>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onChange(p.getRange())}
                  className="text-left text-sm px-2.5 py-1.5 rounded-md hover:bg-[hsl(var(--accent))] whitespace-nowrap"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {/* Editable Start / End plain text fields with format hint. */}
          <div className="grid grid-cols-2 gap-2 px-3 pt-2.5 pb-2 border-t border-[hsl(var(--border))]">
            <DateTextInput
              label="Start"
              value={value.from}
              onChange={(d) => onChange({ ...value, from: d })}
            />
            <DateTextInput
              label="End"
              value={value.to}
              onChange={(d) => onChange({ ...value, to: d })}
            />
          </div>
          <div className="flex items-center justify-end gap-2 px-2.5 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))]/30">
            <button
              type="button"
              onClick={() => onChange({ from: null, to: null })}
              className="text-sm px-2.5 py-1 rounded-md text-amber-400 hover:bg-amber-500/15"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm px-3 py-1 rounded-md bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90"
            >
              Apply
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Plain text input with **live mask** — the format `yyyy-MM-dd HH:mm`
 *  stays visible as a faded ghost behind the user's input, so they
 *  always know what character to type next.
 *
 *  Behaviour:
 *    - Auto-inserts separators (`-`, ` `, `:`) as the user types digits.
 *      Typing "20260415" becomes "2026-04-15".
 *    - The remaining format characters (e.g. " HH:mm") are rendered
 *      in muted color directly after the typed prefix.
 *    - Parses the value on blur or Enter; bad input restores the last
 *      good value.
 */
const MASK_TEMPLATE = "yyyy-MM-dd HH:mm";
const MASK_DIGIT_POSITIONS = [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15];

function applyMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, MASK_DIGIT_POSITIONS.length);
  if (digits.length === 0) return "";
  let out = "";
  let di = 0;
  for (let i = 0; i < MASK_TEMPLATE.length && di < digits.length; i++) {
    const ch = MASK_TEMPLATE[i];
    const isPlaceholder = /[ymdhM]/.test(ch);
    if (isPlaceholder) { out += digits[di++]; }
    else { out += ch; }
  }
  return out;
}

function DateTextInput({ label, value, onChange }: { label: string; value: Date | null; onChange: (d: Date | null) => void }) {
  const [draft, setDraft] = useState(fmtTextInput(value));
  // Resync when the parent updates value (e.g. preset clicked / calendar selection).
  useEffect(() => { setDraft(fmtTextInput(value)); }, [value]);

  function commit() {
    const parsed = parseTextInput(draft);
    if (parsed) {
      onChange(parsed);
      setDraft(fmtTextInput(parsed));
    } else if (draft.trim() === "") {
      onChange(null);
    } else {
      setDraft(fmtTextInput(value));
    }
  }

  // Show what's been typed in foreground + the rest of the format mask
  // in muted color directly after, like a ghost guide.
  const ghostSuffix = MASK_TEMPLATE.slice(draft.length);

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1">{label}</div>
      <div className="flex items-center h-7 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus-within:ring-2 focus-within:ring-[hsl(var(--ring))] overflow-hidden">
        <Calendar size={11} className="text-[hsl(var(--muted-foreground))] shrink-0 ml-2" />
        <div className="relative flex-1 h-full flex items-center">
          {/* Ghost layer — typed text is hidden via transparent color, but
              its width holds the visual position of the suffix. */}
          <div className="absolute inset-0 pointer-events-none flex items-center px-2 text-xs tabular-nums whitespace-pre">
            <span className="invisible">{draft}</span>
            <span className="text-[hsl(var(--muted-foreground))]/70">{ghostSuffix}</span>
          </div>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(applyMask(e.target.value))}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            maxLength={MASK_TEMPLATE.length}
            className="bg-transparent outline-none text-xs px-2 h-full w-full tabular-nums relative z-10"
          />
        </div>
      </div>
    </div>
  );
}
