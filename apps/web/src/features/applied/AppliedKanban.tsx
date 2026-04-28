/**
 * AppliedKanban — drag-and-drop kanban view of applied jobs.
 *
 * Each column is a pipeline stage (Applied / Interview / Negotiations /
 * Offered / Rejected). Cards can be dragged across columns; on drop we
 * fire the status-update mutation and the column re-organizes via
 * cache invalidation.
 *
 * Built on `@dnd-kit/core` (industry-standard for accessible DnD,
 * keyboard support included).
 */
import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, useDroppable, useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import confetti from "canvas-confetti";
import { ExternalLink, GripVertical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyHoverCard } from "@/features/companies/CompanyHoverCard";
import { type AppliedJob, type AppliedStatus } from "@/lib/api";
import { useUpdateStatus } from "./queries";
import { formatShortDate } from "@/lib/format";
import { slugify } from "@/lib/job-filters";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

const STATUSES: AppliedStatus[] = ["Applied", "Interview", "Negotiations", "Offered", "Rejected"];

const COLUMN_TONE: Record<AppliedStatus, string> = {
  Applied: "border-blue-500/30 bg-blue-500/5",
  Interview: "border-cyan-500/30 bg-cyan-500/5",
  Negotiations: "border-amber-500/30 bg-amber-500/5",
  Offered: "border-emerald-500/30 bg-emerald-500/5",
  Rejected: "border-rose-500/30 bg-rose-500/5",
};

interface AppliedKanbanProps {
  jobs: AppliedJob[];
  onSelect?: (job: AppliedJob) => void;
}

export function AppliedKanban({ jobs, onSelect }: AppliedKanbanProps) {
  const updateStatus = useUpdateStatus();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Local optimistic copy of jobs so cards "stick" in their dropped
  // column instantly; the server invalidate refreshes shortly after.
  const [localJobs, setLocalJobs] = useState<AppliedJob[]>(jobs);
  useEffect(() => { setLocalJobs(jobs); }, [jobs]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const groups = useMemo(() => {
    const out: Record<AppliedStatus, AppliedJob[]> = {
      Applied: [], Interview: [], Negotiations: [], Offered: [], Rejected: [],
    };
    for (const j of localJobs) {
      const k = (STATUSES.includes(j.status) ? j.status : "Applied") as AppliedStatus;
      out[k].push(j);
    }
    return out;
  }, [localJobs]);

  const activeJob = activeId ? localJobs.find((j) => j.jobKey === activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const overId = e.over?.id;
    if (!overId) return;
    const target = String(overId) as AppliedStatus;
    if (!STATUSES.includes(target)) return;
    const jobKey = String(e.active.id);
    const job = localJobs.find((j) => j.jobKey === jobKey);
    if (!job || job.status === target) return;
    // Optimistic local move.
    setLocalJobs((prev) => prev.map((j) => (j.jobKey === jobKey ? { ...j, status: target } : j)));
    updateStatus.mutate(
      { jobKey, status: target },
      {
        onSuccess: () => {
          const celebrations: Record<string, { msg: string; particles: number }> = {
            Applied:      { msg: "Applied ✨ Best of luck!", particles: 80 },
            Interview:    { msg: "Interview time 💫", particles: 100 },
            Negotiations: { msg: "Momentum building 💵", particles: 100 },
            Offered:      { msg: "Amazing news 🍾", particles: 120 },
            Rejected:     { msg: "Keep going 👍", particles: 0 },
          };
          const c = celebrations[target] ?? { msg: `Moved to ${target}`, particles: 0 };
          toast(c.msg);
          if (c.particles) confetti({ particleCount: c.particles, spread: 70, origin: { y: 0.6 } });
        },
        onError: (err) => {
          // Rollback on failure.
          setLocalJobs(jobs);
          toast(err instanceof Error ? err.message : "Move failed", "error");
        },
      },
    );
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 lg:grid-cols-5">
        {STATUSES.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            jobs={groups[status]}
            tone={COLUMN_TONE[status]}
            onSelect={onSelect}
          />
        ))}
      </div>
      <DragOverlay>
        {activeJob ? <KanbanCard job={activeJob} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({ status, jobs, tone, onSelect }: {
  status: AppliedStatus; jobs: AppliedJob[]; tone: string; onSelect?: (job: AppliedJob) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-[hsl(var(--card))]/60 backdrop-blur-sm flex flex-col min-h-[200px] transition-colors",
        tone,
        isOver && "ring-2 ring-[hsl(var(--ring))]",
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[hsl(var(--border))]">
        <Badge>{status}</Badge>
        <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{jobs.length}</span>
      </div>
      <div className="flex-1 p-2 space-y-2">
        {jobs.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-[hsl(var(--muted-foreground))] italic">
            Drop a card here
          </div>
        ) : jobs.map((job) => <KanbanCard key={job.jobKey} job={job} onSelect={onSelect} />)}
      </div>
    </div>
  );
}

function KanbanCard({ job, dragging, onSelect }: { job: AppliedJob; dragging?: boolean; onSelect?: (job: AppliedJob) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.jobKey });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <Card
      ref={setNodeRef}
      style={style}
      onClick={(e) => { if (!isDragging && !dragging) { e.stopPropagation(); onSelect?.(job); } }}
      className={cn(
        "select-none touch-none transition-shadow",
        (isDragging || dragging) && "opacity-90 shadow-xl ring-2 ring-[hsl(var(--ring))] cursor-grabbing",
        !isDragging && !dragging && "cursor-grab hover:shadow-md",
      )}
      {...attributes}
      {...listeners}
    >
      <CardContent className="p-3 space-y-1.5">
        <div className="flex items-start gap-2">
          <GripVertical size={14} className="text-[hsl(var(--muted-foreground))] mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">
              <CompanyHoverCard company={job.job.company}>
                <a
                  href={`/companies/${slugify(job.job.company)}/applied`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="hover:underline"
                >
                  {job.job.company}
                </a>
              </CompanyHoverCard>
            </div>
            <div className="font-medium text-sm leading-snug">{job.job.jobTitle}</div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-[hsl(var(--muted-foreground))] pl-5">
          <span>Applied {formatShortDate(job.appliedAt)}</span>
          <a
            href={job.job.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[hsl(var(--primary))] hover:underline"
          >
            <ExternalLink size={11} />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
