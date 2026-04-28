import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  User, Lock, LogOut, Save, Trash2, DatabaseZap, KeyRound, AlertTriangle,
  ChevronRight, Briefcase, CheckCircle2, ClipboardList, ShieldCheck, Eye,
  EyeOff, Info, Download, LifeBuoy, MessageSquarePlus, Send,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useProfile } from "@/features/profile/useProfile";
import { useResetData } from "@/features/run/queries";
import { useAuth } from "@/features/auth/AuthContext";
import { api, type JobsEnvelope } from "@/lib/api";
import { useJobs } from "@/features/jobs/queries";
import { useApplied } from "@/features/applied/queries";
import { useActionPlan } from "@/features/plan/queries";
import { getAuthDisplayEmail, getAuthDisplayName } from "@/features/auth/display";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { useCreateSupportMessage, useCreateSupportTicket, useSupportTicket, useSupportTickets } from "@/features/support/queries";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/profile")({ component: ProfileRoute });

type Section = "account" | "password" | "support" | "danger";

const NAV: { id: Section; label: string; icon: React.ReactNode; danger?: boolean }[] = [
  { id: "account", label: "Account", icon: <User size={14} /> },
  { id: "password", label: "Password", icon: <KeyRound size={14} /> },
  { id: "support", label: "Support", icon: <LifeBuoy size={14} /> },
  { id: "danger", label: "Danger zone", icon: <AlertTriangle size={14} />, danger: true },
];

const SUPPORT_CATEGORIES = [
  { value: "bug", label: "Bug" },
  { value: "enhancement", label: "Enhancement request" },
  { value: "subscription_assistance", label: "Subscription assistance" },
  { value: "other", label: "Other" },
] as const;

function supportCategoryLabel(tag?: string | null): string {
  return SUPPORT_CATEGORIES.find((option) => option.value === tag)?.label ?? "General";
}

function supportCategoryBadgeClass(tag?: string | null): string {
  switch (tag) {
    case "bug":
      return "bg-rose-500/10 text-rose-300 border-rose-500/30";
    case "enhancement":
      return "bg-sky-500/10 text-sky-300 border-sky-500/30";
    case "subscription_assistance":
      return "bg-amber-500/10 text-amber-300 border-amber-500/30";
    default:
      return "bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]";
  }
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function SectionCard({ title, description, danger, children }: { title: string; description: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border bg-[hsl(var(--card))] overflow-hidden flex flex-col", danger ? "border-rose-500/40" : "border-[hsl(var(--border))]")}>
      <div className={cn("px-7 py-5 border-b", danger ? "border-rose-500/20 bg-rose-500/5" : "border-[hsl(var(--border))]")}>
        <div className={cn("font-semibold text-base", danger && "text-rose-500")}>{title}</div>
        <div className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">{description}</div>
      </div>
      <div className="px-7 py-6 flex-1">{children}</div>
    </div>
  );
}

function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-4 py-3.5">
      <div className="mt-0.5 text-[hsl(var(--muted-foreground))]">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-[hsl(var(--muted-foreground))] font-medium truncate">{label}</div>
        <div className="text-xl font-bold leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

function SecurityTip({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0 text-[hsl(var(--muted-foreground))]">{icon}</div>
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}

function AccountSection({ profile, updateProfile }: ReturnType<typeof useProfile>) {
  const { user } = useAuth();
  const authDisplayName = getAuthDisplayName(user, "User");
  const authEmail = getAuthDisplayEmail(user);
  const baselineUsername = profile.username !== "User" ? profile.username : authDisplayName;
  const baselineEmail = profile.email || authEmail;
  const [username, setUsername] = useState(baselineUsername);
  const [email, setEmail] = useState(baselineEmail);

  const jobs = useJobs({ limit: 1 });
  const applied = useApplied({});
  const plan = useActionPlan();

  useEffect(() => {
    // Auth user data resolves asynchronously, so hydrate the form once it
    // arrives if the profile store is still using its default placeholders.
    if (profile.username === "User") {
      setUsername((current) => (current === "User" ? baselineUsername : current));
    }
  }, [baselineUsername, profile.username]);

  useEffect(() => {
    if (!profile.email) {
      setEmail((current) => current || baselineEmail);
    }
  }, [baselineEmail, profile.email]);

  const totalJobs = jobs.data?.totals.availableJobs ?? 0;
  const newJobs = jobs.data?.totals.newJobs ?? 0;
  // API envelopes can omit arrays when empty, so keep profile KPIs defensive.
  const totalApplied = applied.data?.jobs?.length ?? 0;
  const activeInPlan = plan.data?.jobs?.filter((j) => !j.outcome || j.outcome === "Pending").length ?? 0;

  const dirty = username !== baselineUsername || email !== baselineEmail;

  function save() {
    if (!username.trim()) { toast("Username is required", "error"); return; }
    updateProfile({ username: username.trim(), email: email.trim() });
    toast("Profile updated");
  }

  return (
    <div className="grid grid-cols-5 gap-6 items-start">
      {/* Left: form */}
      <div className="col-span-3">
        <SectionCard title="Account details" description="Your display name and contact email address">
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="Username">
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Your display name" />
              </FieldGroup>
              <FieldGroup label="Email address">
                <Input
                  type="email"
                  value={email}
                  readOnly
                  placeholder="you@example.com"
                  className="bg-[hsl(var(--muted))]/40 cursor-default"
                />
              </FieldGroup>
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Email is used for job alert notifications and webhook delivery.
            </p>
            <div className="flex justify-end pt-1">
              <Button onClick={save} disabled={!dirty} size="sm" className="gap-2">
                <Save size={13} /> Save changes
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Right: stats */}
      <div className="col-span-2 flex flex-col gap-4">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
            <div className="font-semibold text-sm">Activity snapshot</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Current data across your account</div>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            <StatTile icon={<Briefcase size={15} />} label="Available jobs" value={totalJobs} sub={newJobs ? `${newJobs} new` : undefined} />
            <StatTile icon={<CheckCircle2 size={15} />} label="Applied" value={totalApplied} sub="tracked applications" />
            <StatTile icon={<ClipboardList size={15} />} label="In action plan" value={activeInPlan} sub="active entries" />
            <StatTile icon={<ShieldCheck size={15} />} label="Account status" value="Active" sub="all systems normal" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordSection() {
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const strength = newPwd.length === 0 ? null : newPwd.length < 8 ? "weak" : newPwd.length < 12 ? "fair" : "strong";

  function changePassword() {
    if (!currentPwd) { toast("Current password is required", "error"); return; }
    if (!newPwd) { toast("New password is required", "error"); return; }
    if (newPwd !== confirmPwd) { toast("Passwords do not match", "error"); return; }
    if (newPwd.length < 8) { toast("Password must be at least 8 characters", "error"); return; }
    toast("Password change will be applied when backend auth is connected");
    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
  }

  return (
    <div className="grid grid-cols-5 gap-6 items-start">
      {/* Left: form */}
      <div className="col-span-3">
        <SectionCard title="Change password" description="Update your login credentials">
          <div className="space-y-5">
            <div className="rounded-lg bg-[hsl(var(--secondary))]/60 px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))] flex gap-2 items-start">
              <Info size={13} className="mt-0.5 shrink-0" />
              Backend auth integration pending — changes will apply when connected.
            </div>
            <FieldGroup label="Current password">
              <Input type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} placeholder="••••••••" />
            </FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <FieldGroup label="New password">
                <div className="relative">
                  <Input type={showNew ? "text" : "password"} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="Min 8 characters" className="pr-9" />
                  <button type="button" onClick={() => setShowNew((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                    {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {strength && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="flex gap-1 flex-1">
                      {(["weak", "fair", "strong"] as const).map((s, i) => (
                        <div key={s} className={cn("h-1 flex-1 rounded-full transition-colors", i <= (strength === "weak" ? 0 : strength === "fair" ? 1 : 2) ? (strength === "weak" ? "bg-rose-500" : strength === "fair" ? "bg-amber-400" : "bg-emerald-500") : "bg-[hsl(var(--border))]")} />
                      ))}
                    </div>
                    <span className={cn("text-xs capitalize", strength === "weak" ? "text-rose-500" : strength === "fair" ? "text-amber-400" : "text-emerald-500")}>{strength}</span>
                  </div>
                )}
              </FieldGroup>
              <FieldGroup label="Confirm new password">
                <div className="relative">
                  <Input type={showConfirm ? "text" : "password"} value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} placeholder="Repeat" className="pr-9" />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
                    {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {confirmPwd && newPwd !== confirmPwd && (
                  <p className="text-xs text-rose-500 mt-1">Passwords don't match</p>
                )}
                {confirmPwd && newPwd === confirmPwd && newPwd.length >= 8 && (
                  <p className="text-xs text-emerald-500 mt-1">Passwords match</p>
                )}
              </FieldGroup>
            </div>
            <div className="flex justify-end pt-1">
              <Button onClick={changePassword} variant="outline" size="sm" className="gap-2">
                <Lock size={13} /> Update password
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Right: tips */}
      <div className="col-span-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
            <div className="font-semibold text-sm">Password tips</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Keep your account secure</div>
          </div>
          <div className="p-5 space-y-5">
            <SecurityTip
              icon={<ShieldCheck size={15} />}
              title="Use a strong password"
              body="At least 12 characters mixing uppercase, lowercase, numbers, and symbols."
            />
            <SecurityTip
              icon={<Eye size={15} />}
              title="Avoid reuse"
              body="Don't reuse passwords from other sites. A unique password limits exposure if another service is breached."
            />
            <SecurityTip
              icon={<KeyRound size={15} />}
              title="Use a password manager"
              body="Tools like 1Password or Bitwarden generate and store strong passwords securely."
            />
            <SecurityTip
              icon={<Lock size={15} />}
              title="Change regularly"
              body="Rotate your password every few months, especially if you suspect any compromise."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SupportSection() {
  const { data, isLoading } = useSupportTickets();
  const tickets = data?.tickets ?? [];
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<(typeof SUPPORT_CATEGORIES)[number]["value"]>("bug");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const createTicket = useCreateSupportTicket();
  const createMessage = useCreateSupportMessage(selectedTicketId);
  const { data: ticketData } = useSupportTicket(selectedTicketId);

  useEffect(() => {
    if (!selectedTicketId && tickets.length > 0) {
      setSelectedTicketId(tickets[0]?.ticketId ?? null);
    }
  }, [selectedTicketId, tickets]);

  const selectedTicket = ticketData?.ticket ?? tickets.find((ticket) => ticket.ticketId === selectedTicketId) ?? null;
  const selectedCategory = selectedTicket?.tags?.[0] ?? null;

  async function handleCreateTicket() {
    if (!subject.trim() || !body.trim()) return;
    const created = await createTicket.mutateAsync({
      subject: subject.trim(),
      body: body.trim(),
      priority: "normal",
      tags: [category],
    });
    const ticket = (created as { ticket?: { ticketId?: string } }).ticket;
    const ticketId = ticket?.ticketId ?? null;
    if (ticketId) {
      setSelectedTicketId(ticketId);
      toast(`Support ticket created: ${ticketId}`);
    } else {
      toast("Support ticket created");
    }
    setSubject("");
    setBody("");
    setCategory("bug");
  }

  async function handleReply() {
    if (!selectedTicketId || !reply.trim()) return;
    await createMessage.mutateAsync({ body: reply.trim() });
    setReply("");
    toast(`Reply sent for ${selectedTicketId}`);
  }

  return (
    <div className="grid grid-cols-5 gap-6 items-start">
      <div className="col-span-3 space-y-6">
        <SectionCard title="Contact support" description="Open a ticket from your profile and keep the ticket ID for your records.">
          <div className="space-y-4">
            <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-4">
              <FieldGroup label="Subject">
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary of the issue" />
              </FieldGroup>
              <FieldGroup label="Category">
                <Select value={category} onChange={(e) => setCategory(e.target.value as (typeof SUPPORT_CATEGORIES)[number]["value"])}>
                  {SUPPORT_CATEGORIES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </FieldGroup>
            </div>
            <FieldGroup label="Details">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Tell us what happened, what you expected, and anything we should look at."
                className="min-h-32 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              />
            </FieldGroup>
            <div className="rounded-lg bg-[hsl(var(--secondary))]/60 px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">
              You’ll see the support ticket ID in the list below right after submission so you can reference it later.
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void handleCreateTicket()} disabled={createTicket.isPending || !subject.trim() || !body.trim()} className="gap-2">
                <MessageSquarePlus size={14} />
                {createTicket.isPending ? "Creating…" : "Create support ticket"}
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title={selectedTicket ? selectedTicket.subject : "Ticket thread"}
          description={selectedTicket ? `Ticket ID: ${selectedTicket.ticketId} · Status: ${selectedTicket.status}` : "Select a ticket to view the conversation."}
        >
          {selectedTicket ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]">
                <span className={cn("rounded-full border px-2.5 py-1 font-medium", supportCategoryBadgeClass(selectedCategory))}>
                  {supportCategoryLabel(selectedCategory)}
                </span>
                <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1">Ticket ID: {selectedTicket.ticketId}</span>
                <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1">Updated {relativeTime(selectedTicket.updatedAt)}</span>
              </div>
              <div className="space-y-3">
                {ticketData?.messages?.map((message) => (
                  <div key={`${message.sender}-${message.createdAt}`} className="rounded-lg border border-[hsl(var(--border))] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{message.senderType === "admin" ? "Support" : "You"}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">{relativeTime(message.createdAt)}</div>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm">{message.body}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={`Reply to ticket ${selectedTicket.ticketId}`}
                  className="min-h-28 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                />
                <div className="flex justify-end">
                  <Button onClick={() => void handleReply()} disabled={createMessage.isPending || !reply.trim()} className="gap-2">
                    <Send size={14} />
                    {createMessage.isPending ? "Sending…" : "Send reply"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[hsl(var(--muted-foreground))]">
              {isLoading ? "Loading tickets…" : "Create or select a support ticket to view the thread."}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="col-span-2">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="px-5 py-4 border-b border-[hsl(var(--border))]">
            <div className="font-semibold text-sm">Your tickets</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
              {isLoading ? "Loading…" : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"} on your account`}
            </div>
          </div>
          <div className="p-4 space-y-2">
            {tickets.map((ticket) => {
              const primaryCategory = ticket.tags?.[0] ?? null;
              return (
                <button
                  key={ticket.ticketId}
                  type="button"
                  onClick={() => setSelectedTicketId(ticket.ticketId)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                    selectedTicketId === ticket.ticketId
                      ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70"
                      : "border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))]/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{ticket.subject}</div>
                      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Ticket ID: {ticket.ticketId}</div>
                    </div>
                    <div className="text-[11px] uppercase text-[hsl(var(--muted-foreground))]">{ticket.status}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", supportCategoryBadgeClass(primaryCategory))}>
                      {supportCategoryLabel(primaryCategory)}
                    </span>
                    <span className="text-[11px] text-[hsl(var(--muted-foreground))]">{relativeTime(ticket.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
            {!tickets.length && !isLoading && (
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                No tickets yet. Create one on the left and we’ll show the ticket ID here right away.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DangerSection() {
  const { user, signOut, deleteAccount } = useAuth();
  const { profile } = useProfile();
  const [clearExpanded, setClearExpanded] = useState(false);
  const [clearAckd, setClearAckd] = useState(false);
  const [deleteExpanded, setDeleteExpanded] = useState(false);
  const [deleteAgreed, setDeleteAgreed] = useState(false);
  const [deleteAckd, setDeleteAckd] = useState(false);
  const [exporting, setExporting] = useState(false);

  const clearData = useResetData();
  const resetData = useResetData();

  const canClear = clearAckd && !clearData.isPending;
  const canDelete = deleteAgreed && deleteAckd && !resetData.isPending;

  async function handleExport() {
    setExporting(true);
    try {
      const exportedAt = new Date().toISOString();
      const jobs = await fetchAllJobsForExport();
      // Build the privacy export from stable authenticated API routes because
      // the old dedicated export endpoint is not implemented in production.
      const [appliedJobs, actionPlan, config, dashboard] = await Promise.all([
        api.get<unknown>("/api/applied-jobs"),
        api.get<unknown>("/api/action-plan"),
        api.get<unknown>("/api/config"),
        api.get<unknown>("/api/dashboard"),
      ]);
      const data = {
        exportedAt,
        account: {
          email: getAuthDisplayEmail(user),
          username: getAuthDisplayName(user, profile.username || "User"),
          profile,
        },
        jobs,
        appliedJobs,
        actionPlan,
        config,
        dashboard,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `career-jump-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Export downloaded");
    } catch {
      toast("Export failed — try again shortly", "error");
    } finally {
      setExporting(false);
    }
  }

  function handleClearData() {
    clearData.mutate(undefined, {
      onSuccess: () => { setClearExpanded(false); setClearAckd(false); toast("All job data cleared", "info"); },
      onError: (e) => toast(e instanceof Error ? e.message : "Clear failed", "error"),
    });
  }

  async function handleDeleteAccount() {
    try {
      await api.post("/api/data/clear");
    } catch { /* best-effort — continue with account deletion */ }
    try {
      await deleteAccount();
    } catch { /* best-effort */ }
    localStorage.clear();
    toast("Account deleted", "info");
    setTimeout(() => window.location.reload(), 1200);
  }

  return (
    <div className="space-y-4">
      {/* Sign out */}
      <SectionCard title="Sign out" description="End your current session on this device">
        <div className="flex items-center justify-between gap-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            You'll need to sign back in to access Career Jump. Your data is preserved.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-rose-500/40 text-rose-500 hover:bg-rose-500/10 hover:text-rose-500 shrink-0"
            onClick={() => {
              if (!window.confirm("Sign out of Career Jump?")) return;
              signOut();
            }}
          >
            <LogOut size={13} /> Sign out
          </Button>
        </div>
      </SectionCard>

      {/* Export data */}
      <SectionCard title="Export my data" description="Download a copy of everything Career Jump holds about you (CCPA right to access)">
        <div className="flex items-center justify-between gap-6">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Downloads a JSON file with all your jobs, applied jobs, notes, interview rounds, and account info.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={handleExport}
            className="gap-2 shrink-0"
          >
            <Download size={13} />
            {exporting ? "Exporting…" : "Export data"}
          </Button>
        </div>
      </SectionCard>

      {/* Clear job data */}
      <div className="rounded-2xl border border-rose-500/30 bg-[hsl(var(--card))] overflow-hidden">
        <div className="px-7 py-5 border-b border-[hsl(var(--border))]">
          <div className="font-semibold text-base">Clear job data</div>
          <div className="text-sm text-[hsl(var(--muted-foreground))] mt-0.5">Reset all tracked jobs, applications, and notes</div>
        </div>
        <div className="px-7 py-6 space-y-4">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1.5">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Wipes all jobs, applied jobs, notes, interview rounds, and action plan. Your account, settings, and company configuration are untouched.
              </p>
              <ul className="text-xs text-[hsl(var(--muted-foreground))] space-y-0.5 list-disc list-inside">
                <li>Available jobs list</li>
                <li>Applied jobs &amp; application notes</li>
                <li>Interview rounds &amp; outcomes</li>
                <li>Action plan entries</li>
              </ul>
            </div>
            {!clearExpanded && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-rose-500/40 text-rose-500 hover:bg-rose-500/10 hover:text-rose-500 shrink-0"
                onClick={() => setClearExpanded(true)}
              >
                <DatabaseZap size={13} /> Clear data
              </Button>
            )}
          </div>
          {clearExpanded && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearAckd}
                  onChange={(e) => setClearAckd(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-rose-500 cursor-pointer shrink-0"
                />
                <span className="text-sm text-[hsl(var(--foreground))]">I understand this will permanently delete all job data and cannot be undone.</span>
              </label>
              <div className="flex gap-2 pt-1">
                <Button variant="destructive" size="sm" disabled={!canClear} onClick={handleClearData} className="gap-2">
                  <DatabaseZap size={13} />
                  {clearData.isPending ? "Clearing…" : "Yes, clear all data"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setClearExpanded(false); setClearAckd(false); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete account */}
      <SectionCard title="Delete account" description="Permanently erase your account and all associated data" danger>
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1.5">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                This removes all jobs, applications, notes, your login credentials, profile, and preferences. Company configuration is retained.
              </p>
              <ul className="text-xs text-[hsl(var(--muted-foreground))] space-y-0.5 list-disc list-inside">
                <li>All job data (same as Clear data above)</li>
                <li>Login credentials &amp; profile</li>
                <li>Preferences &amp; settings</li>
              </ul>
            </div>
            {!deleteExpanded && (
              <Button variant="destructive" size="sm" className="gap-2 shrink-0" onClick={() => setDeleteExpanded(true)}>
                <Trash2 size={13} /> Delete account
              </Button>
            )}
          </div>
          {deleteExpanded && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-4 space-y-3">
              <p className="text-xs font-medium text-rose-400">Confirm you understand this is permanent and irreversible:</p>
              <div className="space-y-2.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={deleteAgreed} onChange={(e) => setDeleteAgreed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-500 cursor-pointer shrink-0" />
                  <span className="text-sm text-[hsl(var(--foreground))]">I agree and understand Career Jump will permanently delete my account and all data.</span>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={deleteAckd} onChange={(e) => setDeleteAckd(e.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-500 cursor-pointer shrink-0" />
                  <span className="text-sm text-[hsl(var(--foreground))]">I acknowledge deleted data <strong>cannot be recovered</strong>.</span>
                </label>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="destructive" size="sm" disabled={!canDelete} onClick={() => void handleDeleteAccount()} className="gap-2">
                  <Trash2 size={13} />
                  {resetData.isPending ? "Deleting…" : "Yes, delete my account"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setDeleteExpanded(false); setDeleteAgreed(false); setDeleteAckd(false); }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

async function fetchAllJobsForExport(): Promise<JobsEnvelope> {
  const limit = 500;
  let offset = 0;
  const pages: JobsEnvelope[] = [];

  do {
    // Walk every jobs page so export does not silently truncate large scans.
    const page = await api.get<JobsEnvelope>(`/api/jobs?limit=${limit}&offset=${offset}`);
    pages.push(page);
    offset = page.pagination.nextOffset;
  } while (pages.at(-1)?.pagination.hasMore);

  const first = pages[0];
  return {
    ok: true,
    runAt: first?.runAt,
    total: pages.reduce((sum, page) => sum + page.jobs.length, 0),
    pagination: { offset: 0, limit, nextOffset: 0, hasMore: false },
    totals: first?.totals ?? { availableJobs: 0, newJobs: 0, updatedJobs: 0 },
    companyOptions: first?.companyOptions ?? [],
    jobs: pages.flatMap((page) => page.jobs),
  };
}

function ProfileRoute() {
  const profileData = useProfile();
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<Section>("account");
  const releaseVersion = import.meta.env.VITE_APP_VERSION || "0.0.0";

  // Mirror the account form fallback so the profile header never gets stuck
  // on placeholder identity values while auth has the real user info.
  const displayName = profileData.profile.username !== "User"
    ? profileData.profile.username
    : getAuthDisplayName(user, "User");
  const displayEmail = profileData.profile.email || getAuthDisplayEmail(user);
  const initial = (displayName[0] ?? "U").toUpperCase();

  return (
    <>
      <Topbar title="Profile" subtitle="Manage your account and preferences" />
      <div className="flex h-full min-h-0">

        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-[hsl(var(--border))] flex flex-col gap-1 p-4 sticky top-0 self-start">
          <div className="flex flex-col items-center text-center py-6 px-2 mb-2">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 grid place-items-center text-white text-3xl font-bold shadow-lg mb-3">
              {initial}
            </div>
            <div className="font-semibold text-base leading-tight">{displayName}</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1 truncate w-full">{displayEmail || "No email set"}</div>
            {/* Surface the shipped version in the account shell so support and
                product checks can verify the exact deployed release quickly. */}
            <div className="mt-3 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 px-3 py-1 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
              Release v{releaseVersion}
            </div>
          </div>

          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "flex items-center justify-between gap-2 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-colors text-left",
                activeSection === item.id
                  ? item.danger
                    ? "bg-rose-500/10 text-rose-500"
                    : "bg-[hsl(var(--accent))] text-[hsl(var(--foreground))]"
                  : item.danger
                    ? "text-rose-500/70 hover:bg-rose-500/5 hover:text-rose-500"
                    : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/60 hover:text-[hsl(var(--foreground))]"
              )}
            >
              <span className="flex items-center gap-2.5">
                {item.icon}
                {item.label}
              </span>
              {activeSection === item.id && <ChevronRight size={13} className="opacity-50" />}
            </button>
          ))}
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-8">
          {activeSection === "account" && <AccountSection {...profileData} />}
          {activeSection === "password" && <PasswordSection />}
          {activeSection === "support" && <SupportSection />}
          {activeSection === "danger" && <DangerSection />}
        </main>
      </div>
    </>
  );
}
