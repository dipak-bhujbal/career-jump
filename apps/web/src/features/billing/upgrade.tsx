import { CreditCard, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useStartCheckout } from "./queries";
import { toast } from "@/components/ui/toast";
import { planIntervalLabel, planPricePlaceholders, planUpgradeBlurb } from "./plan-display";

const upgradePlanCards = [
  {
    plan: "starter" as const,
    name: "Starter",
    eyebrow: "For focused solo tracking",
    highlights: [
      "Track more companies than the free tier.",
      "Unlock richer scans and more visible jobs.",
      "Best fit for individual weekly search routines.",
    ],
  },
  {
    plan: "pro" as const,
    name: "Pro",
    eyebrow: "For higher-volume searching",
    highlights: [
      "Adds deeper monitoring and more scan headroom.",
      "Supports a broader multi-company pipeline.",
      "Best fit for active interview and application cycles.",
    ],
  },
  {
    plan: "power" as const,
    name: "Power",
    eyebrow: "For the most aggressive search cadence",
    highlights: [
      "Highest scan headroom and active pipeline limits.",
      "Best fit for heavy search volume across many companies.",
      "Keeps power users from hitting entry-tier ceilings.",
    ],
  },
] as const;

export function UpgradePrompt({
  open,
  onClose,
  title,
  body,
  currentPlan,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: string;
  currentPlan: "free" | "starter" | "pro" | "power";
}) {
  const checkout = useStartCheckout();

  function handleUpgrade(plan: "starter" | "pro" | "power") {
    checkout.mutate(plan, {
      onSuccess: (result) => {
        window.location.assign(result.url);
      },
      onError: (error) => {
        toast(error instanceof Error ? error.message : "Checkout failed", "error");
      },
    });
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex items-start gap-3 pr-8">
          <div className="mt-1 rounded-full bg-amber-500/15 p-2 text-amber-500">
            <Sparkles size={18} />
          </div>
          <div className="space-y-2">
            <div className="text-2xl font-semibold tracking-tight">{title}</div>
            <div className="max-w-2xl text-sm leading-7 text-[hsl(var(--muted-foreground))]">{body}</div>
          </div>
        </div>
        {/* Present plans as self-contained cards so prices and value props read
            like a real compare table rather than overflow-prone button rows. */}
        <div className="grid gap-4 lg:grid-cols-3">
          {upgradePlanCards.map((option) => {
            const isCurrent = currentPlan === option.plan;
            return (
              <div
                key={option.plan}
                className="flex h-full flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm"
              >
                <div className="space-y-2">
                  <div className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{option.eyebrow}</div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-2xl font-semibold">{option.name}</div>
                      <div className="mt-2 flex items-end gap-1">
                        <span className="text-4xl font-semibold tracking-tight">{planPricePlaceholders[option.plan]}</span>
                        <span className="pb-1 text-sm text-[hsl(var(--muted-foreground))]">{planIntervalLabel}</span>
                      </div>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-full border border-[hsl(var(--border))] px-2.5 py-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                        Current
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">
                    {planUpgradeBlurb[option.plan]}
                  </p>
                </div>
                <div className="mt-5 flex-1 space-y-3">
                  {option.highlights.map((highlight) => (
                    <div key={highlight} className="flex items-start gap-2 text-sm text-[hsl(var(--foreground))]">
                      <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-[hsl(var(--foreground))]" />
                      <span>{highlight}</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => handleUpgrade(option.plan)}
                  disabled={checkout.isPending || isCurrent}
                  className="mt-6 h-11 w-full justify-between self-start rounded-xl px-4"
                >
                  <span>{isCurrent ? `${option.name} active` : `Upgrade to ${option.name}`}</span>
                  <CreditCard size={14} />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/35 px-4 py-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Prices are placeholder display values for now and can be replaced by admin-managed pricing later.
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Maybe later</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function UpgradeBanner({
  title = "Upgrade available",
  message,
  cta,
}: {
  title?: string;
  message: string;
  cta: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-500/45 bg-[linear-gradient(135deg,rgba(251,191,36,0.22),rgba(255,255,255,0.92))] px-4 py-4 text-sm text-amber-950 shadow-sm dark:bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(17,24,39,0.94))] dark:text-amber-50">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-amber-500/18 p-2 text-amber-700 dark:text-amber-300">
            <Sparkles size={16} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-sm leading-6 text-amber-900/90 dark:text-amber-100/90">{message}</div>
            <div className="flex flex-wrap gap-2 pt-1 text-xs font-medium">
              <span className="rounded-full border border-amber-500/30 bg-white/55 px-2.5 py-1 dark:bg-white/5">
                Starter {planPricePlaceholders.starter}{planIntervalLabel}
              </span>
              <span className="rounded-full border border-amber-500/30 bg-white/55 px-2.5 py-1 dark:bg-white/5">
                Pro {planPricePlaceholders.pro}{planIntervalLabel}
              </span>
              <span className="rounded-full border border-amber-500/30 bg-white/55 px-2.5 py-1 dark:bg-white/5">
                Power {planPricePlaceholders.power}{planIntervalLabel}
              </span>
            </div>
          </div>
        </div>
        <Button size="sm" className="shrink-0" onClick={cta}>Compare plans</Button>
      </div>
    </div>
  );
}
