import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { BellRing, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  useAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useUpdateAnnouncement,
} from "@/features/support/queries";
import { useMe } from "@/features/session/queries";
import type { AnnouncementRecord, AnnouncementSeverity, AnnouncementTargetPlan, CreateAnnouncementRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-announcements")({ component: AdminAnnouncementsRoute });

type AnnouncementFormState = {
  id: string | null;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  active: boolean;
  dismissible: boolean;
  activeFrom: string;
  activeTo: string;
  targetPlans: AnnouncementTargetPlan[];
  targetTenantIds: string;
};

const announcementPlans: AnnouncementTargetPlan[] = ["all", "free", "starter", "pro", "power"];

function toDateTimeInput(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultFormState(): AnnouncementFormState {
  const now = new Date();
  const defaultActiveFrom = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return {
    id: null,
    title: "",
    body: "",
    severity: "info",
    active: true,
    dismissible: false,
    activeFrom: defaultActiveFrom.toISOString().slice(0, 16),
    activeTo: "",
    targetPlans: ["all"],
    targetTenantIds: "",
  };
}

function toFormState(record: AnnouncementRecord): AnnouncementFormState {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    severity: record.severity,
    active: record.active,
    dismissible: record.dismissible,
    activeFrom: toDateTimeInput(record.activeFrom),
    activeTo: record.activeTo ? toDateTimeInput(record.activeTo) : "",
    targetPlans: record.targetPlans,
    targetTenantIds: record.targetTenantIds?.join(", ") ?? "",
  };
}

function parseFormState(form: AnnouncementFormState): CreateAnnouncementRequest {
  const title = form.title.trim();
  const body = form.body.trim();
  if (!title) throw new Error("Title is required");
  if (!body) throw new Error("Body is required");
  if (!form.targetPlans.length) throw new Error("Select at least one target plan");

  const targetTenantIds = form.targetTenantIds
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    title,
    body,
    severity: form.severity,
    active: form.active,
    dismissible: form.dismissible,
    activeFrom: new Date(form.activeFrom).toISOString(),
    activeTo: form.activeTo ? new Date(form.activeTo).toISOString() : null,
    targetPlans: form.targetPlans,
    targetTenantIds: targetTenantIds.length ? targetTenantIds : null,
  };
}

function toggleButtonClass(active: boolean): string {
  return active
    ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70 text-[hsl(var(--foreground))]"
    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]";
}

function planPillClass(active: boolean): string {
  return cn(
    "rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] transition-colors",
    active
      ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70 text-[hsl(var(--foreground))]"
      : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/35",
  );
}

function severityChipClass(severity: AnnouncementSeverity): string {
  switch (severity) {
    case "critical":
      return "border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-200";
    case "warning":
      return "border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-200";
    default:
      return "border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-200";
  }
}

function AnnouncementEditor({
  form,
  onChange,
  onReset,
  onSave,
  savePending,
}: {
  form: AnnouncementFormState;
  onChange: (next: Partial<AnnouncementFormState>) => void;
  onReset: () => void;
  onSave: () => void;
  savePending: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pencil size={16} />
          {form.id ? "Edit announcement" : "Create announcement"}
        </CardTitle>
        <CardDescription>
          Keep this admin surface aligned with the backend contract so operators can target plans and tenants without editing storage directly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <div className="text-sm font-medium">Title</div>
            <Input value={form.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Planned maintenance window" />
          </label>
          <label className="space-y-2">
            <div className="text-sm font-medium">Severity</div>
            <div className="flex gap-2">
              {(["info", "warning", "critical"] as AnnouncementSeverity[]).map((severity) => (
                <button
                  key={severity}
                  type="button"
                  className={planPillClass(form.severity === severity)}
                  onClick={() => onChange({ severity })}
                >
                  {severity}
                </button>
              ))}
            </div>
          </label>
        </div>

        <label className="space-y-2">
          <div className="text-sm font-medium">Body</div>
          <textarea
            value={form.body}
            onChange={(event) => onChange({ body: event.target.value })}
            placeholder="Tell the user exactly what changed, why it matters, and what they should do next."
            className="min-h-28 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <div className="text-sm font-medium">Active from</div>
            <Input type="datetime-local" value={form.activeFrom} onChange={(event) => onChange({ activeFrom: event.target.value })} />
          </label>
          <label className="space-y-2">
            <div className="text-sm font-medium">Active to</div>
            <Input type="datetime-local" value={form.activeTo} onChange={(event) => onChange({ activeTo: event.target.value })} />
          </label>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Target plans</div>
          <div className="flex flex-wrap gap-2">
            {announcementPlans.map((plan) => {
              const active = form.targetPlans.includes(plan);
              return (
                <button
                  key={plan}
                  type="button"
                  className={planPillClass(active)}
                  onClick={() => {
                    if (plan === "all") {
                      onChange({ targetPlans: active ? [] : ["all"] });
                      return;
                    }
                    const next = form.targetPlans.filter((current) => current !== "all");
                    const targetPlans = active
                      ? next.filter((current) => current !== plan)
                      : [...next, plan];
                    onChange({ targetPlans });
                  }}
                >
                  {plan}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">
            Use <span className="font-semibold">all</span> for one banner across the entire product, or pick exact plans for a narrower rollout.
          </div>
        </div>

        <label className="space-y-2">
          <div className="text-sm font-medium">Target tenant IDs</div>
          <Input
            value={form.targetTenantIds}
            onChange={(event) => onChange({ targetTenantIds: event.target.value })}
            placeholder="Leave blank for all tenants, or enter comma-separated tenant IDs"
          />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-sm font-medium">Active state</div>
            <div className="flex gap-2">
              <button type="button" className={`rounded-md border px-3 py-2 text-sm ${toggleButtonClass(form.active)}`} onClick={() => onChange({ active: true })}>Active</button>
              <button type="button" className={`rounded-md border px-3 py-2 text-sm ${toggleButtonClass(!form.active)}`} onClick={() => onChange({ active: false })}>Paused</button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Dismissibility</div>
            <div className="flex gap-2">
              <button type="button" className={`rounded-md border px-3 py-2 text-sm ${toggleButtonClass(form.dismissible)}`} onClick={() => onChange({ dismissible: true })}>Dismissible</button>
              <button type="button" className={`rounded-md border px-3 py-2 text-sm ${toggleButtonClass(!form.dismissible)}`} onClick={() => onChange({ dismissible: false })}>Persistent</button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[hsl(var(--border))] pt-4">
          <Button variant="outline" onClick={onReset}>Reset</Button>
          <Button variant="success" onClick={onSave} disabled={savePending}>
            <Save size={14} />
            {savePending ? "Saving…" : form.id ? "Save announcement" : "Create announcement"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminAnnouncementsRoute() {
  const { data: me } = useMe();
  const location = useLocation();
  const announcementsQuery = useAnnouncements();
  const createAnnouncement = useCreateAnnouncement();
  const updateAnnouncement = useUpdateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();
  const [form, setForm] = useState<AnnouncementFormState>(() => defaultFormState());

  useEffect(() => {
    if (!form.id && !form.title && !form.body) {
      setForm(defaultFormState());
    }
  }, [form.body, form.id, form.title]);

  const sortedAnnouncements = useMemo(() => {
    return [...(announcementsQuery.data?.announcements ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [announcementsQuery.data?.announcements]);

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Announcements" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  function patch(next: Partial<AnnouncementFormState>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function resetEditor() {
    setForm(defaultFormState());
  }

  function selectAnnouncement(record: AnnouncementRecord) {
    setForm(toFormState(record));
  }

  function saveAnnouncement() {
    try {
      const payload = parseFormState(form);
      if (form.id) {
        updateAnnouncement.mutate(
          { id: form.id, body: payload },
          {
            onSuccess: () => toast("Announcement updated"),
            onError: (error) => toast(error instanceof Error ? error.message : "Update failed", "error"),
          },
        );
      } else {
        createAnnouncement.mutate(payload, {
          onSuccess: () => {
            toast("Announcement created");
            resetEditor();
          },
          onError: (error) => toast(error instanceof Error ? error.message : "Create failed", "error"),
        });
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Invalid announcement payload", "error");
    }
  }

  function removeAnnouncement(id: string) {
    deleteAnnouncement.mutate(id, {
      onSuccess: () => {
        toast("Announcement deleted");
        if (form.id === id) resetEditor();
      },
      onError: (error) => toast(error instanceof Error ? error.message : "Delete failed", "error"),
    });
  }

  return (
    <>
      <Topbar title="Announcements" subtitle="Persistent user-facing banners and targeted operational messaging." />
      <AdminPageFrame
        currentLabel="Announcements"
        currentPath={location.pathname}
        eyebrow="Wave B"
        title="Control persistent in-product announcements"
        description="Create and target persistent banners without shipping code. This UI stays tightly coupled to the backend contract Claude froze in Wave 1."
        actions={(
          <Button variant="outline" onClick={resetEditor}>
            <Plus size={14} />
            New announcement
          </Button>
        )}
      >
        <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BellRing size={16} />
                Live inventory
              </CardTitle>
              <CardDescription>
                {announcementsQuery.data?.total ?? 0} announcement(s) across all plans and tenants.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {announcementsQuery.isLoading ? (
                <div className="text-sm text-[hsl(var(--muted-foreground))]">Loading announcements…</div>
              ) : null}
              {announcementsQuery.error ? (
                <div className="text-sm text-rose-600">Failed to load announcements: {announcementsQuery.error.message}</div>
              ) : null}
              {sortedAnnouncements.map((announcement) => (
                <button
                  key={announcement.id}
                  type="button"
                  onClick={() => selectAnnouncement(announcement)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-3 text-left transition-colors hover:bg-[hsl(var(--accent))]/35",
                    form.id === announcement.id ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/60" : "border-[hsl(var(--border))]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-2">
                      <div className="font-medium">{announcement.title}</div>
                      <div className="line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">{announcement.body}</div>
                    </div>
                    <div className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${severityChipClass(announcement.severity)}`}>
                      {announcement.severity}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{announcement.active ? "Active" : "Paused"}</span>
                    <span>•</span>
                    <span>{announcement.dismissible ? "Dismissible" : "Persistent"}</span>
                    <span>•</span>
                    <span>{announcement.targetPlans.join(", ")}</span>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeAnnouncement(announcement.id);
                      }}
                      disabled={deleteAnnouncement.isPending}
                    >
                      <Trash2 size={13} />
                      Delete
                    </Button>
                  </div>
                </button>
              ))}
              {!announcementsQuery.isLoading && !sortedAnnouncements.length ? (
                <div className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-sm text-[hsl(var(--muted-foreground))]">
                  No announcements yet. Create the first persistent product banner from the editor.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <AnnouncementEditor
            form={form}
            onChange={patch}
            onReset={resetEditor}
            onSave={saveAnnouncement}
            savePending={createAnnouncement.isPending || updateAnnouncement.isPending}
          />
        </div>
      </AdminPageFrame>
    </>
  );
}
