/**
 * Floating bulk-action bar — appears at the bottom of the screen when
 * one or more jobs are selected. Provides Apply / Discard / Clear with
 * an undo toast on each destructive action.
 */
import { useState } from "react";
import { Send, Trash2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UpgradePrompt } from "@/features/billing/upgrade";
import { useMe } from "@/features/session/queries";
import { ApiError } from "@/lib/api";
import { useApplyJob, useDiscardJob } from "./queries";
import { toast } from "@/components/ui/toast";

interface BulkActionBarProps {
  selected: Set<string>;
  onClear: () => void;
}

export function BulkActionBar({ selected, onClear }: BulkActionBarProps) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const apply = useApplyJob();
  const discard = useDiscardJob();
  const count = selected.size;
  const { data: me } = useMe();

  if (count === 0) return null;

  async function bulkApply() {
    const keys = Array.from(selected);
    let okCount = 0;
    for (const jobKey of keys) {
      try {
        await apply.mutateAsync({ jobKey });
        okCount++;
      } catch (error) {
        if (error instanceof ApiError && error.status === 402 && (error.data as { error?: string }).error === "applied_jobs_limit_reached") {
          setUpgradeOpen(true);
          break;
        }
      }
    }
    toast(`Applied to ${okCount}/${keys.length} jobs`);
    onClear();
  }

  async function bulkDiscard() {
    const keys = Array.from(selected);
    let okCount = 0;
    for (const jobKey of keys) {
      try { await discard.mutateAsync(jobKey); okCount++; } catch { /* skip */ }
    }
    toast(`Discarded ${okCount}/${keys.length} jobs`, "info");
    onClear();
  }

  return (
    <>
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-3 py-2 shadow-2xl animate-in slide-in-from-bottom-4"
      >
        <span className="text-sm font-medium px-2">{count} selected</span>
        <div className="h-5 w-px bg-[hsl(var(--border))]" />
        <Button size="sm" onClick={bulkApply} disabled={apply.isPending}>
          {apply.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Apply
        </Button>
        <Button size="sm" variant="outline" onClick={bulkDiscard} disabled={discard.isPending}>
          {discard.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Discard
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
          <X size={13} />
        </Button>
      </div>
      <UpgradePrompt
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentPlan={me?.billing?.plan ?? me?.profile?.plan ?? "free"}
        title="Upgrade to track more applications"
        body="Your current plan has reached the applied-jobs limit. Upgrade with Stripe Checkout to keep applying."
      />
    </>
  );
}
