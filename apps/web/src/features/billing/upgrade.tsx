import { CreditCard, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useStartCheckout } from "./queries";
import { toast } from "@/components/ui/toast";

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
    <Dialog open={open} onClose={onClose} size="sm">
      <div className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 text-amber-500" size={18} />
          <div className="space-y-1">
            <div className="text-lg font-semibold">{title}</div>
            <div className="text-sm text-[hsl(var(--muted-foreground))]">{body}</div>
          </div>
        </div>
        <div className="grid gap-3">
          {[
            { plan: "starter" as const, label: "Upgrade to Starter" },
            { plan: "pro" as const, label: "Upgrade to Pro" },
            { plan: "power" as const, label: "Upgrade to Power" },
          ].map((option) => (
            <Button
              key={option.plan}
              onClick={() => handleUpgrade(option.plan)}
              disabled={checkout.isPending || currentPlan === option.plan}
              className="w-full justify-between"
            >
              <span>{currentPlan === option.plan ? `${option.label} (Current)` : option.label}</span>
              <CreditCard size={14} />
            </Button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>Maybe later</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function UpgradeBanner({
  message,
  cta,
}: {
  message: string;
  cta: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-100">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-2">
          <Sparkles size={16} className="mt-0.5 text-amber-400" />
          <span>{message}</span>
        </div>
        <Button size="sm" onClick={cta}>Upgrade now</Button>
      </div>
    </div>
  );
}
