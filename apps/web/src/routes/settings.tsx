import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bell, BellOff, Mail, Info, ExternalLink } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEmailWebhookSettings, useSaveEmailWebhook } from "@/features/settings/queries";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({ component: SettingsRoute });

interface NotifPrefs {
  newJobsAlert: boolean;
  weeklyDigest: boolean;
  statusUpdate: boolean;
}

const DEFAULT_PREFS: NotifPrefs = { newJobsAlert: true, weeklyDigest: true, statusUpdate: true };
const PREFS_KEY = "cj:notif-prefs";

function loadPrefs(): NotifPrefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") } as NotifPrefs; }
  catch { return DEFAULT_PREFS; }
}

function NotifRow({ enabled, onToggle, title, description, badge }: {
  enabled: boolean; onToggle: () => void; title: string; description: string; badge?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3 min-w-0">
        <span className={cn("flex items-center justify-center h-8 w-8 rounded-lg shrink-0",
          enabled ? "bg-blue-500/10 text-blue-500" : "bg-[hsl(var(--secondary))] text-[hsl(var(--muted-foreground))]")}>
          {enabled ? <Bell size={15} /> : <BellOff size={15} />}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{title}</span>
            {badge && <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500">{badge}</span>}
          </div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">{description}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={enabled}
        className={cn("relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          enabled ? "bg-blue-500" : "bg-[hsl(var(--secondary))]")}
      >
        <span className={cn("pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          enabled ? "translate-x-4" : "translate-x-0")} />
      </button>
    </div>
  );
}

function SettingsRoute() {
  const { user } = useAuth();
  const { data: webhookData } = useEmailWebhookSettings();
  const saveWebhook = useSaveEmailWebhook();
  const [prefs, setPrefs] = useState<NotifPrefs>(loadPrefs);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [sharedSecret, setSharedSecret] = useState("");
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    if (webhookData?.webhookUrl != null) setWebhookUrl(webhookData.webhookUrl);
  }, [webhookData?.webhookUrl]);

  function toggle(key: keyof NotifPrefs) { setPrefs((p) => ({ ...p, [key]: !p[key] })); }

  async function handleSavePrefs() {
    setSavingPrefs(true);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      try { await api.post("/api/user/notification-prefs", prefs); } catch { /* backend may not have this yet */ }
      toast("Notification preferences saved");
    } finally { setSavingPrefs(false); }
  }

  function handleSaveWebhook() {
    const payload: { webhookUrl?: string; sharedSecret?: string } = { webhookUrl: webhookUrl.trim() || undefined };
    if (sharedSecret.trim()) payload.sharedSecret = sharedSecret.trim();
    saveWebhook.mutate(payload, {
      onSuccess: () => { toast("Webhook saved"); setSharedSecret(""); },
      onError: (err) => toast(err instanceof Error ? err.message : "Save failed", "error"),
    });
  }

  return (
    <>
      <Topbar title="Settings" subtitle="Notification and integration preferences" />
      <div className="p-6 max-w-2xl space-y-5">

        {/* Email notifications */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="px-6 py-5 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-2.5">
              <Mail size={16} className="text-[hsl(var(--muted-foreground))]" />
              <div>
                <div className="font-semibold text-sm">Email notifications</div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  Sent to <strong>{user?.email || "your verified email"}</strong> via Amazon SES
                </div>
              </div>
            </div>
          </div>
          <div className="px-6 py-2 divide-y divide-[hsl(var(--border))]">
            <NotifRow
              enabled={prefs.newJobsAlert}
              onToggle={() => toggle("newJobsAlert")}
              title="New jobs alert"
              description="Sent after each scan when new matching jobs are discovered"
              badge="After each scan"
            />
            <NotifRow
              enabled={prefs.weeklyDigest}
              onToggle={() => toggle("weeklyDigest")}
              title="Weekly digest"
              description="Pipeline summary with available jobs, applications, and interview activity — every Monday"
              badge="Weekly"
            />
            <NotifRow
              enabled={prefs.statusUpdate}
              onToggle={() => toggle("statusUpdate")}
              title="Application status updates"
              description="Notified when an applied job status changes (interview, offer, rejection)"
            />
          </div>
          <div className="px-6 py-4 border-t border-[hsl(var(--border))] flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              <Info size={12} />
              Verification and password reset emails cannot be disabled.
            </div>
            <Button size="sm" onClick={() => void handleSavePrefs()} disabled={savingPrefs} className="shrink-0">
              {savingPrefs ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        </div>

        {/* Legacy webhook */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="px-6 py-5 border-b border-[hsl(var(--border))]">
            <div className="font-semibold text-sm">Custom webhook <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">— advanced</span></div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">Forward scan results to any HTTPS endpoint (Google Sheets, Zapier, Make)</div>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Webhook URL</label>
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Shared secret</label>
              <Input type="password" value={sharedSecret} onChange={(e) => setSharedSecret(e.target.value)} placeholder="Leave blank to keep existing" />
              {webhookData?.sharedSecretConfigured && <p className="text-xs text-[hsl(var(--muted-foreground))]">A shared secret is already configured.</p>}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={handleSaveWebhook} disabled={saveWebhook.isPending}>
                {saveWebhook.isPending ? "Saving…" : "Save webhook"}
              </Button>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
          <div className="px-6 py-5 border-b border-[hsl(var(--border))]">
            <div className="font-semibold text-sm">About</div>
          </div>
          <div className="px-6 py-5 space-y-2.5 text-sm text-[hsl(var(--muted-foreground))]">
            {[
              ["Version", "v5.0.0-alpha · React rebuild"],
              ["Infrastructure", "AWS Lambda · DynamoDB · Cognito · SES"],
              ["Log retention", "6 hours"],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between">
                <span>{label}</span>
                <span className="font-mono text-xs">{value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <span>Data compliance</span>
              <a href="/privacy" className="text-blue-500 hover:text-blue-400 inline-flex items-center gap-1 text-xs">
                CCPA Privacy Policy <ExternalLink size={11} />
              </a>
            </div>
            {user && (
              <div className="flex items-center justify-between">
                <span>Your tenant ID</span>
                <span className="font-mono text-xs truncate max-w-[220px]" title={user.sub}>{user.sub}</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </>
  );
}
