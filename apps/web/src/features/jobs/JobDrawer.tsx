/**
 * Side drawer for a single job. Lets the user:
 *   - Read details and matched keywords
 *   - Edit notes (saved on blur via /api/jobs/notes)
 *   - Apply (creates an applied-jobs record)
 *   - Discard (removes from inventory)
 */
import { useEffect, useState } from "react";
import { ExternalLink, Send, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApiError, type Job } from "@/lib/api";
import { UpgradePrompt } from "@/features/billing/upgrade";
import { useMe } from "@/features/session/queries";
import { useApplyJob, useDiscardJob, useSaveJobNotes } from "./queries";
import { toast } from "@/components/ui/toast";

interface JobDrawerProps {
  job: Job | null;
  onClose: () => void;
}

export function JobDrawer({ job, onClose }: JobDrawerProps) {
  const [notes, setNotes] = useState("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const apply = useApplyJob();
  const discard = useDiscardJob();
  const saveNotes = useSaveJobNotes();
  const { data: me } = useMe();

  useEffect(() => {
    if (job) setNotes(job.notes ?? "");
  }, [job]);

  if (!job) return null;

  function handleSaveNotes() {
    if (!job) return;
    if (notes === (job.notes ?? "")) return;
    saveNotes.mutate({ jobKey: job.jobKey, notes }, {
      onSuccess: () => toast("Notes saved"),
      onError: (e) => toast(e instanceof Error ? e.message : "Save failed", "error"),
    });
  }

  function handleApply() {
    if (!job) return;
    apply.mutate({ jobKey: job.jobKey, notes }, {
      onSuccess: () => { toast(`Applied to ${job.jobTitle}`); onClose(); },
      onError: (e) => {
        if (e instanceof ApiError && e.status === 402 && (e.data as { error?: string }).error === "applied_jobs_limit_reached") {
          setUpgradeOpen(true);
          return;
        }
        toast(e instanceof Error ? e.message : "Apply failed", "error");
      },
    });
  }

  function handleDiscard() {
    if (!job) return;
    discard.mutate(job.jobKey, {
      onSuccess: () => { toast("Discarded", "info"); onClose(); },
      onError: (e) => toast(e instanceof Error ? e.message : "Discard failed", "error"),
    });
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-30 w-full max-w-lg border-l border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-2xl flex flex-col animate-in slide-in-from-right">
      <div className="px-5 py-4 border-b border-[hsl(var(--border))] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-[hsl(var(--muted-foreground))]">{job.company}</div>
          <h3 className="text-lg font-semibold leading-snug">{job.jobTitle}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {job.isNew && <Badge variant="success">New</Badge>}
            {job.isUpdated && <Badge variant="warning">Updated</Badge>}
            {job.location && <span className="text-xs text-[hsl(var(--muted-foreground))]">{job.location}</span>}
            {job.source && <span className="text-xs text-[hsl(var(--muted-foreground))] capitalize">· {job.source}</span>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <a href={job.url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--primary))] hover:underline">
            <ExternalLink size={14} /> Open job posting
          </a>
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1 block">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleSaveNotes}
            placeholder="Recruiter, hiring manager, prep notes…"
            className="w-full min-h-[160px] rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          />
        </div>
      </div>

      <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center justify-end gap-2">
        <Button variant="outline" onClick={handleDiscard} disabled={discard.isPending}>
          {discard.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Discard
        </Button>
        <Button onClick={handleApply} disabled={apply.isPending}>
          {apply.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Apply
        </Button>
      </div>
      <UpgradePrompt
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentPlan={me?.billing?.plan ?? me?.profile?.plan ?? "free"}
        title="Upgrade to track more applications"
        body="Your current plan has reached the applied-jobs limit. Upgrade with Stripe Checkout to keep applying."
      />
    </aside>
  );
}
