import { type ReactNode, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { CreditCard, Mail, Save, ShieldCheck, Tag } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useStripeConfig, useSaveStripeConfig } from "@/features/billing/queries";
import { useAdminEmailWebhookSettings, useSaveAdminEmailWebhook } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";
import { planIntervalLabel, planPricePlaceholders } from "@/features/billing/plan-display";

export const Route = createFileRoute("/admin-stripe-config")({ component: AdminStripeConfigRoute });

type StripeFormState = {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  starterPriceId: string;
  proPriceId: string;
  powerPriceId: string;
};

type EmailWebhookFormState = {
  webhookUrl: string;
  sharedSecret: string;
};

function toFormState(config: {
  publishableKey: string;
  priceIds: { starter: string; pro: string; power: string };
} | null): StripeFormState {
  return {
    publishableKey: config?.publishableKey ?? "",
    secretKey: "",
    webhookSecret: "",
    starterPriceId: config?.priceIds.starter ?? "",
    proPriceId: config?.priceIds.pro ?? "",
    powerPriceId: config?.priceIds.power ?? "",
  };
}

export function AdminStripeConfigRoute() {
  const { data: me } = useMe();
  const location = useLocation();
  const { data, isLoading, error } = useStripeConfig();
  const { data: webhookData, isLoading: webhookLoading, error: webhookError } = useAdminEmailWebhookSettings();
  const saveStripeConfig = useSaveStripeConfig();
  const saveEmailWebhook = useSaveAdminEmailWebhook();
  const [form, setForm] = useState<StripeFormState>(() => toFormState(null));
  const [webhookForm, setWebhookForm] = useState<EmailWebhookFormState>({ webhookUrl: "", sharedSecret: "" });

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Stripe Config" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  const resolved = data?.config ?? null;
  const active = (form.publishableKey || form.secretKey || form.webhookSecret || form.starterPriceId || form.proPriceId || form.powerPriceId)
    ? form
    : toFormState(resolved);
  const activeWebhook = (webhookForm.webhookUrl || webhookForm.sharedSecret)
    ? webhookForm
    : { webhookUrl: webhookData?.webhookUrl ?? "", sharedSecret: "" };

  function patch(next: Partial<StripeFormState>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function patchWebhook(next: Partial<EmailWebhookFormState>) {
    setWebhookForm((current) => ({ ...current, ...next }));
  }

  function save() {
    if (!active.publishableKey.trim() || !active.secretKey.trim()) {
      toast("Publishable key and secret key are required", "error");
      return;
    }
    saveStripeConfig.mutate({
      publishableKey: active.publishableKey.trim(),
      secretKey: active.secretKey.trim(),
      webhookSecret: active.webhookSecret.trim(),
      priceIds: {
        starter: active.starterPriceId.trim(),
        pro: active.proPriceId.trim(),
        power: active.powerPriceId.trim(),
      },
    }, {
      onSuccess: () => {
        toast("Stripe config saved");
        setForm(toFormState(null));
      },
      onError: (mutationError) => toast(mutationError instanceof Error ? mutationError.message : "Save failed", "error"),
    });
  }

  function saveWebhookConfig() {
    const payload: { webhookUrl?: string; sharedSecret?: string } = {
      webhookUrl: activeWebhook.webhookUrl.trim() || undefined,
    };
    if (activeWebhook.sharedSecret.trim()) payload.sharedSecret = activeWebhook.sharedSecret.trim();
    saveEmailWebhook.mutate(payload, {
      onSuccess: () => {
        toast("Email webhook saved");
        setWebhookForm({ webhookUrl: "", sharedSecret: "" });
      },
      onError: (mutationError) => toast(mutationError instanceof Error ? mutationError.message : "Save failed", "error"),
    });
  }

  return (
    <>
      <Topbar title="Stripe Config" subtitle="Configure checkout keys, webhook state, and per-plan Stripe price IDs." />
      <AdminPageFrame
        currentLabel="Stripe Config"
        currentPath={location.pathname}
        eyebrow="Billing Operations"
        title="Configure checkout and subscription plumbing"
        description="Treat Stripe setup as an operator workflow, not a bag of hidden environment variables. This page owns key presence, webhook state, and price mapping."
      >
        <div className="space-y-4">
          {isLoading ? <Card><CardContent className="py-6 text-sm text-[hsl(var(--muted-foreground))]">Loading Stripe billing config…</CardContent></Card> : null}
          {error ? <Card><CardContent className="py-6 text-sm text-rose-600">Failed to load Stripe config: {error.message}</CardContent></Card> : null}
          <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Setup checklist</CardTitle>
                <CardDescription>
                  Keep operators focused on the next missing billing dependency instead of reading raw JSON.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-xl border border-[hsl(var(--border))] px-3 py-3">
                  Publishable key: <span className="font-medium">{resolved?.publishableKey ? "present" : "missing"}</span>
                </div>
                <div className="rounded-xl border border-[hsl(var(--border))] px-3 py-3">
                  Secret key: <span className="font-medium">{resolved ? "write-only after save" : "not configured"}</span>
                </div>
                <div className="rounded-xl border border-[hsl(var(--border))] px-3 py-3">
                  Webhook: <span className="font-medium">{resolved?.webhookConfigured ? "configured" : "missing"}</span>
                </div>
                <div className="rounded-xl border border-[hsl(var(--border))] px-3 py-3">
                  Price IDs: <span className="font-medium">{data?.configured ? "ready to review" : "not configured"}</span>
                </div>
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-3 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck size={14} />
                    Customer-facing pricing preview
                  </div>
                  <div className="mt-3 space-y-2">
                    {(["starter", "pro", "power"] as const).map((plan) => (
                      <div key={plan} className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2">
                        <span className="font-medium capitalize">{plan}</span>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">
                          {planPricePlaceholders[plan]}{planIntervalLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><CreditCard size={16} /> Stripe checkout</CardTitle>
                  <CardDescription>
                    Secrets are write-only. Existing secret values are never returned from the backend after save.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Publishable key">
                      <Input value={active.publishableKey} onChange={(event) => patch({ publishableKey: event.target.value })} placeholder="pk_live_..." />
                    </Field>
                    <Field label="Secret key">
                      <Input value={active.secretKey} onChange={(event) => patch({ secretKey: event.target.value })} placeholder={resolved ? "Leave blank only if replacing the full config now" : "sk_live_..."} />
                    </Field>
                    <Field label="Webhook secret" hint={resolved?.webhookConfigured ? "Webhook secret is configured in the backend." : "Optional until the Stripe webhook is connected."}>
                      <Input value={active.webhookSecret} onChange={(event) => patch({ webhookSecret: event.target.value })} placeholder="whsec_..." />
                    </Field>
                    <Field label="Starter price ID">
                      <Input value={active.starterPriceId} onChange={(event) => patch({ starterPriceId: event.target.value })} placeholder="price_..." />
                      <PriceHint plan="starter" />
                    </Field>
                    <Field label="Pro price ID">
                      <Input value={active.proPriceId} onChange={(event) => patch({ proPriceId: event.target.value })} placeholder="price_..." />
                      <PriceHint plan="pro" />
                    </Field>
                    <Field label="Power price ID">
                      <Input value={active.powerPriceId} onChange={(event) => patch({ powerPriceId: event.target.value })} placeholder="price_..." />
                      <PriceHint plan="power" />
                    </Field>
                  </div>
                  <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                    Current status: {data?.configured ? "configured" : "not configured"} · Webhook: {resolved?.webhookConfigured ? "configured" : "missing"} · Placeholder prices are frontend-only until public pricing is exposed.
                  </div>
                  <div className="flex justify-end">
                    <Button variant="success" onClick={save} disabled={saveStripeConfig.isPending}>
                      <Save size={14} /> {saveStripeConfig.isPending ? "Saving…" : "Save Stripe config"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Mail size={16} /> Notification email webhook</CardTitle>
                  <CardDescription>
                    Configure the global outbound email webhook for the entire user base. This is the shared delivery path the app uses before any SES fallback.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {webhookLoading ? <div className="text-sm text-[hsl(var(--muted-foreground))]">Loading webhook config…</div> : null}
                  {webhookError ? <div className="text-sm text-rose-600">Failed to load webhook config: {webhookError.message}</div> : null}
                  <Field label="Webhook URL">
                    <Input
                      value={activeWebhook.webhookUrl}
                      onChange={(event) => patchWebhook({ webhookUrl: event.target.value })}
                      placeholder="https://script.google.com/macros/s/…/exec"
                    />
                  </Field>
                  <Field
                    label="Shared secret"
                    hint={webhookData?.sharedSecretConfigured ? "A shared secret is already configured. Leave blank to keep it." : "Optional but recommended for request verification."}
                  >
                    <Input
                      type="password"
                      value={activeWebhook.sharedSecret}
                      onChange={(event) => patchWebhook({ sharedSecret: event.target.value })}
                      placeholder="Leave blank to keep existing"
                    />
                  </Field>
                  <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                    Current status: {webhookData?.webhookUrl ? "configured" : "missing"} · Shared secret: {webhookData?.sharedSecretConfigured ? "configured" : "missing"}
                  </div>
                  <div className="flex justify-end">
                    <Button variant="success" onClick={saveWebhookConfig} disabled={saveEmailWebhook.isPending}>
                      <Save size={14} /> {saveEmailWebhook.isPending ? "Saving…" : "Save email webhook"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </AdminPageFrame>
    </>
  );
}

function PriceHint({ plan }: { plan: "starter" | "pro" | "power" }) {
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
      <Tag size={12} />
      Display placeholder: {planPricePlaceholders[plan]}{planIntervalLabel}
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
