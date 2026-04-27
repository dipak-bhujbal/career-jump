import { LayoutList, AlignJustify, Rows3 } from "lucide-react";
import { useDensity } from "@/lib/density";

export function DensityToggle() {
  const { density, cycle } = useDensity();
  const Icon = density === "compact" ? Rows3 : density === "spacious" ? LayoutList : AlignJustify;
  const label = density.charAt(0).toUpperCase() + density.slice(1);
  return (
    <button
      type="button"
      onClick={cycle}
      title={`Density: ${label} (click to cycle)`}
      aria-label={`Density: ${label}`}
      className="inline-flex items-center justify-center h-10 w-10 rounded-md border border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))] transition-colors"
    >
      <Icon size={18} />
    </button>
  );
}
