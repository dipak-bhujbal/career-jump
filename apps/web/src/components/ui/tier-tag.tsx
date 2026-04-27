import { cn } from "@/lib/utils";

interface TierTagProps {
  tier: string | null | undefined;
  className?: string;
}

const styles: Record<string, string> = {
  TIER1_VERIFIED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  TIER2_MEDIUM: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  TIER3_LOW: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  NEEDS_REVIEW: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

const labels: Record<string, string> = {
  TIER1_VERIFIED: "Tier 1",
  TIER2_MEDIUM: "Tier 2",
  TIER3_LOW: "Tier 3",
  NEEDS_REVIEW: "Review",
};

export function TierTag({ tier, className }: TierTagProps) {
  const key = tier ?? "";
  const style = styles[key] ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  const label = labels[key] ?? "—";
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[12px] font-medium uppercase tracking-wide", style, className)}>
      {label}
    </span>
  );
}
