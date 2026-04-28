import Stripe from "stripe";
import { loadStripeConfig } from "../storage/stripe-config";
import { billingTableName, putRow } from "../aws/dynamo";
import { nowISO } from "../lib/utils";
import type { UserPlan } from "../types";

function makeStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
}

export type CheckoutSessionResult = {
  url: string;
  sessionId: string;
};

export async function createCheckoutSession(
  tenantId: string,
  userId: string,
  email: string,
  plan: Exclude<UserPlan, "free">,
  successUrl: string,
  cancelUrl: string,
): Promise<CheckoutSessionResult> {
  const config = await loadStripeConfig();
  if (!config) throw new Error("Stripe is not configured");

  const priceId = config.priceIds[plan];
  if (!priceId) throw new Error(`No price configured for plan: ${plan}`);

  const stripe = makeStripeClient(config.secretKey);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    client_reference_id: tenantId,
    metadata: { tenantId, userId, plan },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url, sessionId: session.id };
}

export async function handleStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<{ handled: boolean; event: string }> {
  const config = await loadStripeConfig();
  if (!config) throw new Error("Stripe is not configured");

  const stripe = makeStripeClient(config.secretKey);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.webhookSecret);
  } catch {
    throw new Error("Webhook signature verification failed");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const tenantId = session.metadata?.tenantId;
    const plan = session.metadata?.plan as UserPlan | undefined;
    const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
    const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : null;

    if (tenantId && plan) {
      await putRow(billingTableName(), {
        pk: `USER#${tenantId}`,
        sk: "SUBSCRIPTION",
        userId: tenantId,
        plan,
        status: "active",
        provider: "stripe",
        stripeCustomerId: stripeCustomerId ?? undefined,
        stripeSubscriptionId: stripeSubscriptionId ?? undefined,
        updatedAt: nowISO(),
      });
    }
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const tenantId = sub.metadata?.tenantId;
    if (tenantId) {
      const status = event.type === "customer.subscription.deleted" ? "canceled"
        : sub.status === "trialing" ? "trialing"
        : sub.status === "active" ? "active"
        : "canceled";
      await putRow(billingTableName(), {
        pk: `USER#${tenantId}`,
        sk: "SUBSCRIPTION",
        userId: tenantId,
        plan: (sub.metadata?.plan as UserPlan) ?? "free",
        status,
        provider: "stripe",
        stripeCustomerId: typeof sub.customer === "string" ? sub.customer : undefined,
        stripeSubscriptionId: sub.id,
        currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
        updatedAt: nowISO(),
      });
    }
  }

  return { handled: true, event: event.type };
}
