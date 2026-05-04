/**
 * JobDetailsDrawer — single drawer used everywhere a job is selected.
 *
 * Adapts to the source of the job:
 *   - "available"  : the job is in the Available Jobs inventory
 *                    → primary actions Apply / Discard, editable notes
 *   - "applied"    : the job has an applied-jobs record
 *                    → status change select, editable notes, interview rounds
 *   - "plan"       : the job is on the Action Plan
 *                    → notes + interview rounds (read-only here)
 *
 * Mounted per-page; pages own the selected source and call onClose to clear.
 */
import { useEffect, useState } from "react";
import confetti from "canvas-confetti";
import { ExternalLink, Send, Trash2, Loader2, Calendar, Tag, MapPin, Plus, X, ChevronDown, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { UpgradePrompt } from "@/features/billing/upgrade";
import { CompanyHoverCard } from "@/features/companies/CompanyHoverCard";
import { ApiError, type Job, type AppliedJob, type AppliedStatus, type ActionPlanRow, type InterviewRound, type NoteRecord } from "@/lib/api";
import { useMe } from "@/features/session/queries";
import { useAddNote, useApplyJob, useDeleteNote, useDiscardJob, useSaveJobNotes, useUpdateNote } from "./queries";
import { useUpdateStatus } from "@/features/applied/queries";
import { useAddInterviewRound, useDeleteInterviewRound, useScheduleInterview } from "@/features/plan/queries";
import { toast } from "@/components/ui/toast";
import { formatShortDate, relativeTime } from "@/lib/format";

const CELEBRATION: Record<string, { message: string; particles: number }> = {
  Applied:      { message: "Applied ✨ Best of luck!", particles: 80 },
  Interview:    { message: "Interview time 💫", particles: 100 },
  Negotiations: { message: "Momentum building 💵", particles: 100 },
  Offered:      { message: "Amazing news 🍾", particles: 120 },
  Rejected:     { message: "Keep going 👍", particles: 0 },
};
function celebrationFor(status: string) {
  return CELEBRATION[status] ?? { message: `Marked ${status}`, particles: 0 };
}

export type DrawerSource =
  | { type: "available"; job: Job }
  | { type: "applied"; appl: AppliedJob }
  | { type: "plan"; row: ActionPlanRow };

interface JobDetailsDrawerProps {
  source: DrawerSource | null;
  onClose: () => void;
  /** When true renders inline (no backdrop/fixed overlay) — used in split-pane layout. */
  inline?: boolean;
}

const STATUSES: AppliedStatus[] = ["Applied", "Interview", "Negotiations", "Offered", "Rejected"];

interface DetailField { label: string; value: React.ReactNode }
interface TimelineEvt { date?: string | null; label: string; detail?: string }

interface DrawerMeta {
  jobKey: string;
  company: string;
  title: string;
  url: string;
  location?: string;
  source?: string;
  status?: AppliedStatus;
  appliedAt?: string;
  notes: string;
  noteRecords: NoteRecord[];
  rounds?: AppliedJob["interviewRounds"];
  statusBadge: React.ReactNode;
  details: DetailField[];
  timelineEvents: TimelineEvt[];
}

/**
 * InterviewRoundsEditor — editable list of interview rounds for the
 * Action Plan drawer. Add, edit (designation, scheduled time, notes,
 * outcome), or delete each round. Read-only fallback for the Applied
 * drawer where rounds are display-only.
 */
const OUTCOMES: NonNullable<InterviewRound["outcome"]>[] = ["Pending", "Passed", "Failed", "Follow-up"];
const DESIGNATIONS = ["Recruiter", "Aptitude Tests", "Hiring Manager", "Loop Interview", "Skip Manager", "Onsite"];

function InterviewRoundsEditor({ jobKey, rounds, editable }: { jobKey: string; rounds: InterviewRound[]; editable: boolean }) {
  const addRound = useAddInterviewRound();
  const deleteRound = useDeleteInterviewRound();
  const updateRound = useScheduleInterview();
  const [editingId, setEditingId] = useState<string | null>(null);

  function handleField(round: InterviewRound, patch: Partial<InterviewRound>) {
    updateRound.mutate(
      { jobKey, roundId: round.id, ...round, ...patch },
      { onError: (e) => toast(e instanceof Error ? e.message : "Update failed", "error") },
    );
  }

  function handleAdd() {
    addRound.mutate(
      { jobKey, number: rounds.length + 1 },
      {
        onSuccess: () => toast("Round added"),
        onError: (e) => toast(e instanceof Error ? e.message : "Add failed", "error"),
      },
    );
  }

  function handleDelete(round: InterviewRound) {
    deleteRound.mutate(
      { jobKey, roundId: round.id },
      {
        onSuccess: () => { toast("Round deleted"); if (editingId === round.id) setEditingId(null); },
        onError: (e) => toast(e instanceof Error ? e.message : "Delete failed", "error"),
      },
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Interview rounds</label>
        {editable && (
          <Button size="sm" variant="outline" onClick={handleAdd} disabled={addRound.isPending}>
            <Plus size={13} /> Add round
          </Button>
        )}
      </div>
      {rounds.length === 0 ? (
        <div className="rounded-md border border-dashed border-[hsl(var(--border))] px-3 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No rounds yet{editable ? ". Click Add round to schedule the first one." : "."}
        </div>
      ) : (
        <div className="space-y-2">
          {rounds.map((rd) => {
            const isEditing = editable && editingId === rd.id;
            return (
              <div key={rd.id} className="rounded-md border border-[hsl(var(--border))] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Round {rd.number}</span>
                  {editable && (
                    <div className="flex items-center gap-1">
                      {isEditing ? (
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="h-7 w-7 grid place-items-center rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                          title="Done editing"
                          aria-label="Done editing"
                        >
                          <Check size={13} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingId(rd.id)}
                          className="h-7 w-7 grid place-items-center rounded-md hover:bg-[hsl(var(--accent))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          title="Edit round"
                          aria-label="Edit round"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(rd)}
                        className="h-7 w-7 grid place-items-center rounded-md hover:bg-rose-500/15 text-[hsl(var(--muted-foreground))] hover:text-rose-300"
                        title="Delete round"
                        aria-label="Delete round"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] block mb-1">Designation</label>
                      <Select value={rd.designation ?? ""} onChange={(e) => handleField(rd, { designation: e.target.value })}>
                        <option value="">—</option>
                        {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </Select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] block mb-1">Outcome</label>
                      <Select value={rd.outcome ?? "Pending"} onChange={(e) => handleField(rd, { outcome: e.target.value as InterviewRound["outcome"] })}>
                        {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] block mb-1">Scheduled at</label>
                      <Input
                        type="datetime-local"
                        value={rd.scheduledAt ? new Date(rd.scheduledAt).toISOString().slice(0, 16) : ""}
                        onChange={(e) => handleField(rd, { scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] block mb-1">Notes</label>
                      <Input
                        value={rd.notes ?? ""}
                        onChange={(e) => handleField(rd, { notes: e.target.value })}
                        placeholder="Interviewer name, prep notes, feedback…"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[hsl(var(--muted-foreground))]">
                    {rd.designation && <span className="text-[hsl(var(--foreground))] font-medium">{rd.designation}</span>}
                    {rd.scheduledAt && <span>{formatShortDate(rd.scheduledAt)} · {relativeTime(rd.scheduledAt)}</span>}
                    {rd.outcome && <Badge variant={rd.outcome === "Passed" ? "success" : rd.outcome === "Failed" ? "danger" : "secondary"}>{rd.outcome}</Badge>}
                    {rd.notes && <div className="w-full text-[hsl(var(--foreground))] mt-0.5">{rd.notes}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function statusVariant(s: AppliedStatus): "default" | "secondary" | "success" | "warning" | "danger" {
  switch (s) {
    case "Applied": return "secondary";
    case "Interview": return "warning";
    case "Negotiations": return "default";
    case "Offered": return "success";
    case "Rejected": return "danger";
  }
}

/** Project the source union into a single shape the drawer renders from.
 *  Splits attributes into:
 *    - details[] — static facts (Source, Country, Location, etc.)
 *    - timelineEvents[] — chronological events (Posted, Applied, Status
 *      changed, Round 1 scheduled, …) shown sorted by date.
 */
function project(source: DrawerSource): DrawerMeta {
  if (source.type === "available") {
    const j = source.job;
    const details: DetailField[] = [
      { label: "Source", value: j.source ? <span className="capitalize">{j.source}</span> : "—" },
      { label: "Country", value: j.detectedCountry ?? "—" },
      { label: "US-likely", value: j.usLikely === true ? "Yes" : j.usLikely === false ? "No" : "Unknown" },
      { label: "Location", value: j.location ?? "—" },
      { label: "Job key", value: <code className="text-xs">{j.jobKey}</code> },
    ];
    const timelineEvents: TimelineEvt[] = [];
    if (j.postedAt) timelineEvents.push({ date: j.postedAt, label: "Posted by company" });
    if (j.isNew) timelineEvents.push({ label: "Found in latest scan" });
    if (j.isUpdated) {
      // Give the drawer a human explanation even when the compact jobs table
      // only has the generic updated badge copy available.
      timelineEvents.push({
        label: "Detected as updated",
        detail: j.updatedReason ?? "Tracked fields changed since the previous snapshot.",
      });
    }
    return {
      jobKey: j.jobKey, company: j.company, title: j.jobTitle, url: j.url,
      location: j.location, source: j.source, notes: j.notes ?? "",
      noteRecords: j.noteRecords ?? [],
      statusBadge: (
        <>
          {j.isNew && <Badge variant="success">New</Badge>}
          {j.isUpdated && !j.isNew && <Badge variant="warning">Updated</Badge>}
        </>
      ),
      details, timelineEvents,
    };
  }

  if (source.type === "applied") {
    const a = source.appl;
    const j = a.job;
    const details: DetailField[] = [
      { label: "Source", value: j.source ? <span className="capitalize">{j.source}</span> : "—" },
      { label: "Country", value: j.detectedCountry ?? "—" },
      { label: "Location", value: j.location ?? "—" },
      { label: "Rounds", value: String(a.interviewRounds?.length ?? 0) },
      { label: "Status", value: a.status },
      { label: "Job key", value: <code className="text-xs">{a.jobKey}</code> },
    ];
    const timelineEvents: TimelineEvt[] = [];
    if (j.postedAt) timelineEvents.push({ date: j.postedAt, label: "Posted by company" });
    if (a.appliedAt) timelineEvents.push({ date: a.appliedAt, label: "Applied" });
    if (a.lastStatusChangedAt && a.lastStatusChangedAt !== a.appliedAt) {
      timelineEvents.push({ date: a.lastStatusChangedAt, label: `Status → ${a.status}` });
    }
    for (const rd of a.interviewRounds ?? []) {
      if (rd.scheduledAt) timelineEvents.push({ date: rd.scheduledAt, label: `Round ${rd.number}${rd.designation ? ` · ${rd.designation}` : ""}`, detail: rd.outcome ? `Outcome: ${rd.outcome}` : undefined });
    }
    for (const tl of a.timeline ?? []) timelineEvents.push({ date: tl.at, label: tl.message });
    timelineEvents.sort((x, y) => new Date(x.date ?? 0).getTime() - new Date(y.date ?? 0).getTime());
    return {
      jobKey: a.jobKey, company: j.company, title: j.jobTitle, url: j.url,
      location: j.location, source: j.source, status: a.status, appliedAt: a.appliedAt,
      notes: a.notes ?? "", noteRecords: a.noteRecords ?? [], rounds: a.interviewRounds,
      statusBadge: <Badge variant={statusVariant(a.status)}>{a.status}</Badge>,
      details, timelineEvents,
    };
  }

  const r = source.row;
  const details: DetailField[] = [
    { label: "Outcome", value: r.outcome ?? "—" },
    { label: "Current round", value: r.currentRoundNumber ? `Round ${r.currentRoundNumber}` : "—" },
    { label: "Source", value: r.source ? <span className="capitalize">{r.source}</span> : "—" },
    { label: "Location", value: r.location ?? "—" },
    { label: "Total rounds", value: String(r.interviewRounds?.length ?? 0) },
    { label: "Job key", value: <code className="text-xs">{r.jobKey}</code> },
  ];
  const timelineEvents: TimelineEvt[] = [];
  if (r.postedAt) timelineEvents.push({ date: r.postedAt, label: "Posted by company" });
  if (r.appliedAt) timelineEvents.push({ date: r.appliedAt, label: "Applied" });
  if (r.interviewAt) timelineEvents.push({ date: r.interviewAt, label: "Next interview" });
  for (const rd of r.interviewRounds ?? []) {
    if (rd.scheduledAt) timelineEvents.push({ date: rd.scheduledAt, label: `Round ${rd.number}${rd.designation ? ` · ${rd.designation}` : ""}`, detail: rd.outcome ? `Outcome: ${rd.outcome}` : undefined });
  }
  for (const tl of r.timeline ?? []) timelineEvents.push({ date: tl.at, label: tl.message });
  timelineEvents.sort((x, y) => new Date(x.date ?? 0).getTime() - new Date(y.date ?? 0).getTime());
  return {
    jobKey: r.jobKey, company: r.company, title: r.jobTitle, url: r.url,
    location: r.location, source: r.source, appliedAt: r.appliedAt ?? undefined,
    notes: r.notes ?? "", noteRecords: r.noteRecords ?? [], rounds: r.interviewRounds,
    statusBadge: <Badge variant="warning">Action plan</Badge>,
    details, timelineEvents,
  };
}

export function JobDetailsDrawer({ source, onClose, inline = false }: JobDetailsDrawerProps) {
  if (!source) return null;
  return <DrawerInner source={source} onClose={onClose} inline={inline} />;
}

function DrawerInner({ source, onClose, inline = false }: { source: DrawerSource; onClose: () => void; inline?: boolean }) {
  const meta = project(source);
  const [notes, setNotes] = useState(meta.notes);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const apply = useApplyJob();
  const discard = useDiscardJob();
  const saveNotes = useSaveJobNotes();
  const addNote = useAddNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const updateStatus = useUpdateStatus();
  const { data: me } = useMe();

  useEffect(() => { setNotes(meta.notes); }, [meta.notes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleApply() {
    apply.mutate({ jobKey: meta.jobKey, notes }, {
      onSuccess: () => {
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
        toast(`Applied to ${meta.title} ✨ Best of luck!`);
        onClose();
      },
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
    discard.mutate(meta.jobKey, {
      onSuccess: () => { toast("Discarded", "info"); onClose(); },
      onError: (e) => toast(e instanceof Error ? e.message : "Discard failed", "error"),
    });
  }

  function handleStatus(next: AppliedStatus) {
    updateStatus.mutate({ jobKey: meta.jobKey, status: next }, {
      onSuccess: () => {
        const { message, particles } = celebrationFor(next);
        toast(message);
        if (particles) confetti({ particleCount: particles, spread: 70, origin: { y: 0.6 } });
      },
      onError: (e) => toast(e instanceof Error ? e.message : "Update failed", "error"),
    });
  }

  const innerContent = (
    <>
      <div className="px-5 py-4 border-b border-[hsl(var(--border))] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            <CompanyHoverCard company={meta.company}>
              <span className="hover:underline">{meta.company}</span>
            </CompanyHoverCard>
          </div>
          <h3 className="text-lg font-semibold leading-snug">{meta.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {meta.statusBadge}
            {meta.location && <span className="inline-flex items-center gap-1 text-[hsl(var(--muted-foreground))]"><MapPin size={11} />{meta.location}</span>}
            {meta.source && <span className="inline-flex items-center gap-1 text-[hsl(var(--muted-foreground))] capitalize"><Tag size={11} />{meta.source}</span>}
            {meta.appliedAt && <span className="inline-flex items-center gap-1 text-[hsl(var(--muted-foreground))]"><Calendar size={11} />Applied {formatShortDate(meta.appliedAt)}</span>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <div>
          <a href={meta.url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--primary))] hover:underline">
            <ExternalLink size={14} /> Open job posting
          </a>
        </div>

        {source.type !== "available" && (
          <div>
            <label className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-1.5 block">Pipeline status</label>
            <Select
              value={meta.status ?? "Applied"}
              onChange={(e) => handleStatus(e.target.value as AppliedStatus)}
            >
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        )}

        <details open className="group rounded-md border border-[hsl(var(--border))]">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium hover:bg-[hsl(var(--accent))]/40 rounded-t-md">
            <span className="inline-flex items-center gap-2">
              <Tag size={13} className="text-[hsl(var(--muted-foreground))]" />
              Details
              <span className="text-xs text-[hsl(var(--muted-foreground))] font-normal">({meta.details.length})</span>
            </span>
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
          </summary>
          <table className="w-full text-sm border-t border-[hsl(var(--border))]">
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {meta.details.map((d) => (
                <tr key={d.label}>
                  <th scope="row" className="text-left font-normal text-[hsl(var(--muted-foreground))] px-3 py-2 align-top w-[140px]">{d.label}</th>
                  <td className="px-3 py-2 break-words">{d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <details open={Boolean(meta.timelineEvents.length)} className="group rounded-md border border-[hsl(var(--border))]">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium hover:bg-[hsl(var(--accent))]/40 rounded-t-md">
            <span className="inline-flex items-center gap-2">
              <Calendar size={13} className="text-[hsl(var(--muted-foreground))]" />
              Timeline
              <span className="text-xs text-[hsl(var(--muted-foreground))] font-normal">({meta.timelineEvents.length})</span>
            </span>
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
          </summary>
          {meta.timelineEvents.length === 0 ? (
            <div className="border-t border-[hsl(var(--border))] px-3 py-3 text-xs text-[hsl(var(--muted-foreground))] italic">No events yet.</div>
          ) : (
            <table className="w-full text-sm border-t border-[hsl(var(--border))]">
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {meta.timelineEvents.map((e, i) => (
                  <tr key={i}>
                    <th scope="row" className="text-left font-normal text-[hsl(var(--muted-foreground))] px-3 py-2 align-top w-[140px] whitespace-nowrap">
                      {e.date ? formatShortDate(e.date) : "—"}
                      {e.date && <div className="text-[10px] text-[hsl(var(--muted-foreground))]/70">{relativeTime(e.date)}</div>}
                    </th>
                    <td className="px-3 py-2">
                      <div className="font-medium">{e.label}</div>
                      {e.detail && <div className="text-xs text-[hsl(var(--muted-foreground))]">{e.detail}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>

        {(meta.rounds || source.type === "plan") && (
          <InterviewRoundsEditor
            jobKey={meta.jobKey}
            rounds={meta.rounds ?? []}
            editable={source.type === "plan"}
          />
        )}

        {source.type === "available" ? (
          <SimpleNotesSection
            jobKey={meta.jobKey}
            initialNotes={notes}
            saveNotes={saveNotes}
          />
        ) : (
          <NotesSection
            jobKey={meta.jobKey}
            records={meta.noteRecords}
            addNote={addNote}
            updateNote={updateNote}
            deleteNote={deleteNote}
          />
        )}
      </div>

      {source.type === "available" && (
        <div className="px-5 py-3 border-t border-[hsl(var(--border))] flex items-center justify-end gap-2">
          <Button variant="warning" onClick={handleDiscard} disabled={discard.isPending}>
            {discard.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Discard
          </Button>
          <Button variant="success" onClick={handleApply} disabled={apply.isPending}>
            {apply.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Apply
          </Button>
        </div>
      )}
    </>
  );

  if (inline) {
    return (
      <>
        <aside className="flex flex-col h-full bg-[hsl(var(--popover))] overflow-hidden">
          {innerContent}
        </aside>
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

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40 animate-in fade-in" onClick={onClose} aria-hidden />
      <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-lg border-l border-[hsl(var(--border))] bg-[hsl(var(--popover))] shadow-2xl flex flex-col animate-in slide-in-from-right">
        {innerContent}
      </aside>
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

// ---------- WhatsApp-style notes section ----------

interface SimpleNotesSectionProps {
  jobKey: string;
  initialNotes: string;
  saveNotes: ReturnType<typeof useSaveJobNotes>;
}

function SimpleNotesSection({ jobKey, initialNotes, saveNotes }: SimpleNotesSectionProps) {
  // Available jobs still use the lightweight single-notes field until the user
  // applies. Applied jobs switch to the record-style thread below.
  const [notes, setNotes] = useState(initialNotes);

  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  function handleSave() {
    if (notes === initialNotes) return;
    saveNotes.mutate({ jobKey, notes }, {
      onSuccess: () => toast("Notes saved"),
      onError: (e) => {
        setNotes(initialNotes);
        toast(e instanceof Error ? e.message : "Save failed", "error");
      },
    });
  }

  return (
    <details open className="group rounded-md border border-[hsl(var(--border))]">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium hover:bg-[hsl(var(--accent))]/40 rounded-t-md">
        <span className="inline-flex items-center gap-2">
          <Pencil size={13} className="text-[hsl(var(--muted-foreground))]" />
          Notes
        </span>
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-[hsl(var(--border))] px-3 py-2.5 space-y-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={handleSave}
          placeholder="Recruiter updates, interview prep, follow-ups…"
          className="w-full min-h-[96px] rounded-md border border-[hsl(var(--input))] bg-transparent px-2.5 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        />
        <div className="flex items-center justify-between gap-2 text-[10px] text-[hsl(var(--muted-foreground))]">
          <span>Saved on blur using the current applied-job notes API.</span>
          <Button size="sm" variant="success" onClick={handleSave} disabled={saveNotes.isPending || notes === initialNotes}>
            <Check size={12} /> Save
          </Button>
        </div>
      </div>
    </details>
  );
}

interface NotesSectionProps {
  jobKey: string;
  records: NoteRecord[];
  addNote: ReturnType<typeof useAddNote>;
  updateNote: ReturnType<typeof useUpdateNote>;
  deleteNote: ReturnType<typeof useDeleteNote>;
}

function NotesSection({ jobKey, records, addNote, updateNote, deleteNote }: NotesSectionProps) {
  // Keep the note thread responsive locally while React Query refreshes the
  // authoritative applied-job payload after each mutation.
  const [localRecords, setLocalRecords] = useState<NoteRecord[]>(records);
  useEffect(() => { setLocalRecords(records); }, [records]);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  function handleAdd() {
    const text = draft.trim();
    if (!text) return;
    const optimistic: NoteRecord = { id: `tmp-${Date.now()}`, text, createdAt: new Date().toISOString() };
    setLocalRecords((prev) => [...prev, optimistic]);
    setDraft("");
    setAdding(false);
    addNote.mutate({ jobKey, text }, {
      onSuccess: () => toast("Note added"),
      onError: (e) => {
        setLocalRecords(records);
        toast(e instanceof Error ? e.message : "Add failed", "error");
      },
    });
  }

  function handleStartEdit(record: NoteRecord) {
    setEditingId(record.id);
    setEditText(record.text);
  }

  function handleSaveEdit(record: NoteRecord) {
    const text = editText.trim();
    if (!text || text === record.text) {
      setEditingId(null);
      return;
    }
    setLocalRecords((prev) => prev.map((item) => (
      item.id === record.id ? { ...item, text, updatedAt: new Date().toISOString() } : item
    )));
    setEditingId(null);
    updateNote.mutate({ jobKey, noteId: record.id, text }, {
      onSuccess: () => toast("Note updated"),
      onError: (e) => {
        setLocalRecords(records);
        toast(e instanceof Error ? e.message : "Update failed", "error");
      },
    });
  }

  function handleDelete(noteId: string) {
    setLocalRecords((prev) => prev.filter((record) => record.id !== noteId));
    deleteNote.mutate({ jobKey, noteId }, {
      onSuccess: () => toast("Note deleted", "info"),
      onError: (e) => {
        setLocalRecords(records);
        toast(e instanceof Error ? e.message : "Delete failed", "error");
      },
    });
  }

  return (
    <details open className="group rounded-md border border-[hsl(var(--border))]">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium hover:bg-[hsl(var(--accent))]/40 rounded-t-md">
        <span className="inline-flex items-center gap-2">
          <Pencil size={13} className="text-[hsl(var(--muted-foreground))]" />
          Notes
          <span className="text-xs text-[hsl(var(--muted-foreground))] font-normal">({localRecords.length})</span>
        </span>
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-[hsl(var(--border))]">
        {localRecords.length === 0 && !adding && (
          <div className="px-3 py-3 text-xs text-[hsl(var(--muted-foreground))] italic">No notes yet.</div>
        )}

        {localRecords.map((record) => (
          <div key={record.id} className="px-3 py-2.5 border-b border-[hsl(var(--border))]/60 last:border-b-0 group/note">
            {editingId === record.id ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  value={editText}
                  onChange={(event) => setEditText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) handleSaveEdit(record);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                  className="w-full min-h-[72px] rounded-md border border-[hsl(var(--input))] bg-transparent px-2.5 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                />
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="success" onClick={() => handleSaveEdit(record)} disabled={updateNote.isPending}>
                    <Check size={12} /> Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap break-words">{record.text}</p>
                <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[hsl(var(--muted-foreground))]">
                  <span>{relativeTime(record.createdAt)}</span>
                  {record.updatedAt && <span className="italic">edited</span>}
                  <span className="ml-auto flex items-center gap-2 opacity-0 group-hover/note:opacity-100 transition-opacity">
                    <button type="button" onClick={() => handleStartEdit(record)} className="hover:text-[hsl(var(--foreground))] transition-colors">
                      <Pencil size={11} />
                    </button>
                    <button type="button" onClick={() => handleDelete(record.id)} className="hover:text-rose-500 transition-colors">
                      <X size={11} />
                    </button>
                  </span>
                </div>
              </>
            )}
          </div>
        ))}

        {adding ? (
          <div className="px-3 py-2.5 space-y-2 border-t border-[hsl(var(--border))]/60">
            <textarea
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) handleAdd();
                if (event.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              placeholder="Write a note… (Cmd/Ctrl+Enter to save)"
              className="w-full min-h-[72px] rounded-md border border-[hsl(var(--input))] bg-transparent px-2.5 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="success" onClick={handleAdd} disabled={addNote.isPending || !draft.trim()}>
                <Check size={12} /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setAdding(false); setDraft(""); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full px-3 py-2 text-left text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/40 flex items-center gap-1.5 transition-colors border-t border-[hsl(var(--border))]/60"
          >
            <Plus size={12} /> Add note
          </button>
        )}
      </div>
    </details>
  );
}
