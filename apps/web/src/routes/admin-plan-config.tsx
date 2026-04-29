import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { AlertTriangle, Save, SlidersHorizontal } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { usePlanConfigs, useSavePlanConfig } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";
import type { PlanConfig } from "@/lib/api";
import { planIntervalLabel, planPricePlaceholders } from "@/features/billing/plan-display";

export const Route = createFileRoute("/admin-plan-config")({ component: AdminPlanConfigRoute });

type PlanFormState = {
  displayName: string;
  scanCacheAgeHours: string;
  canTriggerLiveScan: boolean;
  dailyLiveScans: string;
  maxCompanies: string;
  maxSessions: string;
  maxVisibleJobs: string;
  maxAppliedJobs: string;
  emailNotificationsEnabled: boolean;
  weeklyDigestEnabled: boolean;
  maxEmailsPerWeek: string;
  enabledFeatures: string;
};

function toFormState(config: PlanConfig): PlanFormState {
  return {
    displayName: config.displayName,
    scanCacheAgeHours: String(config.scanCacheAgeHours),
    canTriggerLiveScan: config.canTriggerLiveScan,
    dailyLiveScans: String(config.dailyLiveScans),
    maxCompanies: config.maxCompanies === null ? "" : String(config.maxCompanies),
    maxSessions: String(config.maxSessions),
    maxVisibleJobs: config.maxVisibleJobs === null ? "" : String(config.maxVisibleJobs),
    maxAppliedJobs: config.maxAppliedJobs === null ? "" : String(config.maxAppliedJobs),
    emailNotificationsEnabled: config.emailNotificationsEnabled,
    weeklyDigestEnabled: config.weeklyDigestEnabled,
    maxEmailsPerWeek: String(config.maxEmailsPerWeek),
    enabledFeatures: config.enabledFeatures.join(", "),
  };
}

function parseNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a number`);
  return parsed;
}

function buildPayload(plan: PlanConfig["plan"], form: PlanFormState): PlanConfig {
  const displayName = form.displayName.trim();
  if (!displayName) throw new Error("Display name is required");

  const scanCacheAgeHours = parseNumber(form.scanCacheAgeHours, "Scan cache age");
  const dailyLiveScans = parseNumber(form.dailyLiveScans, "Daily live scans");
  const maxSessions = parseNumber(form.maxSessions, "Max sessions");
  const maxEmailsPerWeek = parseNumber(form.maxEmailsPerWeek, "Max emails per week");
  const maxCompanies = form.maxCompanies.trim() === "" ? null : parseNumber(form.maxCompanies, "Max companies");
  const maxVisibleJobs = form.maxVisibleJobs.trim() === "" ? null : parseNumber(form.maxVisibleJobs, "Max visible jobs");
  const maxAppliedJobs = form.maxAppliedJobs.trim() === "" ? null : parseNumber(form.maxAppliedJobs, "Max applied jobs");

  // Normalize feature flags once here so confirmation saves a clean payload.
  const enabledFeatures = form.enabledFeatures
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);

  return {
    plan,
    displayName,
    scanCacheAgeHours,
    canTriggerLiveScan: form.canTriggerLiveScan,
    dailyLiveScans,
    maxCompanies,
    maxSessions,
    maxVisibleJobs,
    maxAppliedJobs,
    emailNotificationsEnabled: form.emailNotificationsEnabled,
    weeklyDigestEnabled: form.weeklyDigestEnabled,
    maxEmailsPerWeek,
    enabledFeatures,
    // The API overwrites audit fields; placeholders keep the client payload
    // aligned with the shared type without leaking fake audit state into UI.
    updatedAt: "",
    updatedBy: "",
  };
}

const planTone: Record<PlanConfig["plan"], string> = {
  free: "border-slate-300/70 bg-slate-500/5",
  starter: "border-emerald-400/45 bg-emerald-500/8",
  pro: "border-sky-400/45 bg-sky-500/8",
  power: "border-fuchsia-400/45 bg-fuchsia-500/8",
};

function booleanButtonClasses(enabled: boolean): string {
  return enabled
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
    : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]";
}

function TogglePill({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${booleanButtonClasses(value)}`}
          onClick={() => onChange(true)}
        >
          Enabled
        </button>
        <button
          type="button"
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${booleanButtonClasses(!value)}`}
          onClick={() => onChange(false)}
        >
          Disabled
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      {children}
      {hint ? <div className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</div> : null}
    </label>
  );
}

function PlanEditorCard({
  config,
  savingPlan,
  onSave,
}: {
  config: PlanConfig;
  savingPlan: PlanConfig["plan"] | null;
  onSave: (payload: PlanConfig) => void;
}) {
  const [form, setForm] = useState<PlanFormState>(() => toFormState(config));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    setForm(toFormState(config));
  }, [config]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toFormState(config)), [config, form]);
  const isSaving = savingPlan === config.plan;

  function patch(next: Partial<PlanFormState>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function openConfirm() {
    try {
      void buildPayload(config.plan, form);
      setConfirmText("");
      setConfirmOpen(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Invalid plan config", "error");
    }
  }

  function confirmSave() {
    try {
      const payload = buildPayload(config.plan, form);
      onSave(payload);
      setConfirmOpen(false);
      setConfirmText("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Invalid plan config", "error");
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal size={16} />
            {config.displayName}
          </CardTitle>
          <CardDescription>
            Plan key: {config.plan} · Last updated {new Date(config.updatedAt).toLocaleString()} by {config.updatedBy}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Keep the operator summary visible above the raw controls so the
              admin can reason about plan impact before editing individual fields. */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <PlanStatCard label="Member-facing price" value={`${planPricePlaceholders[config.plan]}${planIntervalLabel}`} hint="Placeholder until public pricing is admin-managed." />
            <PlanStatCard label="Company cap" value={config.maxCompanies === null ? "Unlimited" : String(config.maxCompanies)} hint="Tracked company limit." />
            <PlanStatCard label="Visible jobs" value={config.maxVisibleJobs === null ? "Unlimited" : String(config.maxVisibleJobs)} hint="Available jobs cap." />
            <PlanStatCard label="Live scan policy" value={config.canTriggerLiveScan ? `${config.dailyLiveScans}/day` : "Disabled"} hint={`${config.scanCacheAgeHours}h cache window`} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Display name">
              <Input value={form.displayName} onChange={(event) => patch({ displayName: event.target.value })} />
            </Field>
            <Field label="Price placeholder" hint="Display-only for now. Stripe price IDs stay in Stripe Config.">
              <Input value={planPricePlaceholders[config.plan]} readOnly />
            </Field>
            <Field label="Scan cache age hours" hint="0 means live-only reads.">
              <Input value={form.scanCacheAgeHours} onChange={(event) => patch({ scanCacheAgeHours: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Daily live scans" hint="Per-tenant live scan quota before the app falls back to cache/block behavior.">
              <Input value={form.dailyLiveScans} onChange={(event) => patch({ dailyLiveScans: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Max companies" hint="Leave blank for unlimited.">
              <Input value={form.maxCompanies} onChange={(event) => patch({ maxCompanies: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Max sessions">
              <Input value={form.maxSessions} onChange={(event) => patch({ maxSessions: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Max visible jobs" hint="Leave blank for unlimited.">
              <Input value={form.maxVisibleJobs} onChange={(event) => patch({ maxVisibleJobs: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Max applied jobs" hint="Leave blank for unlimited.">
              <Input value={form.maxAppliedJobs} onChange={(event) => patch({ maxAppliedJobs: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Max emails per week">
              <Input value={form.maxEmailsPerWeek} onChange={(event) => patch({ maxEmailsPerWeek: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label="Enabled features" hint="Comma-separated feature slugs.">
              <Input value={form.enabledFeatures} onChange={(event) => patch({ enabledFeatures: event.target.value })} />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <TogglePill label="Live scan" value={form.canTriggerLiveScan} onChange={(next) => patch({ canTriggerLiveScan: next })} />
            <TogglePill label="Email notifications" value={form.emailNotificationsEnabled} onChange={(next) => patch({ emailNotificationsEnabled: next })} />
            <TogglePill label="Weekly digest" value={form.weeklyDigestEnabled} onChange={(next) => patch({ weeklyDigestEnabled: next })} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-4">
            <div className="text-xs text-[hsl(var(--muted-foreground))]">
              {dirty ? "Unsaved changes" : "No local changes"}
            </div>
            <Button variant="success" onClick={openConfirm} disabled={!dirty || isSaving}>
              <Save size={14} /> {isSaving ? "Saving…" : "Save plan"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} size="sm">
        <div className="p-6 space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 text-amber-600" size={18} />
            <div className="space-y-1">
              <div className="text-lg font-semibold">Confirm plan policy update</div>
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                Type <span className="font-semibold">CONFIRM</span> to save pricing, scan, and entitlement changes for the {config.displayName} plan.
              </div>
            </div>
          </div>
          <Input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="CONFIRM" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="success" onClick={confirmSave} disabled={confirmText !== "CONFIRM" || isSaving}>
              {isSaving ? "Saving…" : "Confirm save"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

export function AdminPlanConfigRoute() {
  const { data: me } = useMe();
  const location = useLocation();
  const { data, isLoading, error } = usePlanConfigs();
  const savePlan = useSavePlanConfig();
  const [activePlan, setActivePlan] = useState<PlanConfig["plan"]>("free");

  useEffect(() => {
    if (!data?.configs?.length) return;
    if (!data.configs.some((config) => config.plan === activePlan)) {
      setActivePlan(data.configs[0].plan);
    }
  }, [activePlan, data?.configs]);

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Plan Config" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Plan Config" subtitle="Admin-controlled pricing, scan freshness, and entitlement policy." />
      <AdminPageFrame
        currentLabel="Plan Config"
        currentPath={location.pathname}
        eyebrow="Pricing Control"
        title="Edit plan policy without redeploying code"
        description="Keep plan policy admin-owned. This screen centralizes pricing labels, scan freshness, usage caps, and feature entitlements under the live PlanConfig contract."
      >
        <div className="space-y-4">
          {isLoading ? (
            <Card><CardContent className="py-6 text-sm text-[hsl(var(--muted-foreground))]">Loading plan policy…</CardContent></Card>
          ) : null}
          {error ? (
            <Card><CardContent className="py-6 text-sm text-rose-600">Failed to load plan policy: {error.message}</CardContent></Card>
          ) : null}
          {(data?.configs?.length ?? 0) > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Plans</CardTitle>
                <CardDescription>
                  Switch plans here instead of scrolling through one long stacked admin form. Each chip also carries the current member-facing placeholder price.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {(data?.configs ?? []).map((config) => (
                  <button
                    key={config.plan}
                    type="button"
                    className={`rounded-2xl border px-4 py-4 text-left transition-colors ${planTone[config.plan]} ${
                      activePlan === config.plan
                        ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70 text-[hsl(var(--foreground))]"
                        : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))]/35"
                    }`}
                    onClick={() => setActivePlan(config.plan)}
                  >
                    <div className="text-xs font-semibold uppercase tracking-[0.18em]">{config.displayName}</div>
                    <div className="mt-2 text-2xl font-semibold">{planPricePlaceholders[config.plan]}<span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{planIntervalLabel}</span></div>
                    <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                      {config.maxCompanies === null ? "Unlimited companies" : `${config.maxCompanies} companies`} · {config.canTriggerLiveScan ? `${config.dailyLiveScans}/day live scans` : "Live scan off"}
                    </div>
                  </button>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {(data?.configs ?? [])
            .filter((config) => config.plan === activePlan)
            .map((config) => (
              <PlanEditorCard
                key={config.plan}
                config={config}
                savingPlan={savePlan.variables?.plan ?? null}
                onSave={(payload) => {
                  savePlan.mutate(payload, {
                    onSuccess: () => toast(`${payload.displayName} plan saved`),
                    onError: (mutationError) => toast(mutationError instanceof Error ? mutationError.message : "Save failed", "error"),
                  });
                }}
              />
            ))}
        </div>
      </AdminPageFrame>
    </>
  );
}

function PlanStatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-4">
      <div className="text-xs font-medium uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{hint}</div>
    </div>
  );
}
