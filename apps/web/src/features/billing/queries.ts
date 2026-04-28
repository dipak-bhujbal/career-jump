import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type BillingCheckoutEnvelope,
  type BillingSubscriptionEnvelope,
  type StripeConfigEnvelope,
} from "@/lib/api";

export const stripeConfigKey = ["admin-stripe-config"] as const;
export const billingSubscriptionKey = ["billing-subscription"] as const;

export function useStripeConfig() {
  return useQuery({
    queryKey: stripeConfigKey,
    queryFn: () => api.get<StripeConfigEnvelope>("/api/admin/stripe-config"),
    staleTime: 10_000,
  });
}

export function useSaveStripeConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    // Keep webhook/secret fields write-only in the UI, but still send them in
    // the same payload the backend expects for atomic Stripe config updates.
    mutationFn: (body: {
      publishableKey: string;
      secretKey: string;
      webhookSecret: string;
      priceIds: { starter: string; pro: string; power: string };
    }) => api.put<StripeConfigEnvelope>("/api/admin/stripe-config", body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: stripeConfigKey });
    },
  });
}

export function useBillingSubscription() {
  return useQuery({
    queryKey: billingSubscriptionKey,
    queryFn: () => api.get<BillingSubscriptionEnvelope>("/api/billing/subscription"),
    staleTime: 10_000,
  });
}

export function useStartCheckout() {
  return useMutation({
    mutationFn: (plan: "starter" | "pro" | "power") =>
      api.post<BillingCheckoutEnvelope>("/api/billing/checkout", { plan }),
  });
}
