import { type ReactNode, useState } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { CreditCard, Save } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useStripeConfig, useSaveStripeConfig } from "@/features/billing/queries";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/admin-stripe-config")({ component: AdminStripeConfigRoute });

type StripeFormState = {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  starterPriceId: string;
  proPriceId: string;
  powerPriceId: string;
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
  const saveStripeConfig = useSaveStripeConfig();
  const [form, setForm] = useState<StripeFormState>(() => toFormState(null));

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

  function patch(next: Partial<StripeFormState>) {
    setForm((current) => ({ ...current, ...next }));
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
              </CardContent>
            </Card>
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
                  </Field>
                  <Field label="Pro price ID">
                    <Input value={active.proPriceId} onChange={(event) => patch({ proPriceId: event.target.value })} placeholder="price_..." />
                  </Field>
                  <Field label="Power price ID">
                    <Input value={active.powerPriceId} onChange={(event) => patch({ powerPriceId: event.target.value })} placeholder="price_..." />
                  </Field>
                </div>
                <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3 text-xs text-[hsl(var(--muted-foreground))]">
                  Current status: {data?.configured ? "configured" : "not configured"} · Webhook: {resolved?.webhookConfigured ? "configured" : "missing"}
                </div>
                <div className="flex justify-end">
                  <Button onClick={save} disabled={saveStripeConfig.isPending}>
                    <Save size={14} /> {saveStripeConfig.isPending ? "Saving…" : "Save Stripe config"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </AdminPageFrame>
    </>
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
