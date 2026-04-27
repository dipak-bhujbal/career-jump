/**
 * Run-progress banner shown at the top of the main content area while
 * a scan is active. Pulls live state from /api/run/status (polled by
 * useRunStatus) so it appears as soon as a scan starts and disappears
 * when it completes.
 */
import { useRunStatus } from "@/features/run/queries";
import { Loader2 } from "lucide-react";

export function RunProgress() {
  const { data } = useRunStatus();
  if (!data?.active) return null;

  const fetched = data.fetchedCompanies ?? 0;
  const total = data.totalCompanies ?? 0;
  const percent = typeof data.percent === "number"
    ? Math.max(0, Math.min(100, Math.round(data.percent * (data.percent <= 1 ? 100 : 1))))
    : total > 0 ? Math.round((fetched / total) * 100) : 0;

  return (
    <div className="mx-6 mt-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-sm font-semibold inline-flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-[hsl(var(--primary))]" />
            Scan in progress
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            {fetched}/{total} companies {data.currentCompany ? `· ${data.currentCompany}` : ""}
          </div>
        </div>
        <strong className="text-sm">{percent}%</strong>
      </div>
      <div className="h-1.5 rounded-full bg-[hsl(var(--secondary))] overflow-hidden">
        <div
          className="h-full bg-[hsl(var(--primary))] transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      {data.detail && (
        <div className="mt-2 text-[12.5px] text-[hsl(var(--muted-foreground))]">{data.detail}</div>
      )}
    </div>
  );
}
