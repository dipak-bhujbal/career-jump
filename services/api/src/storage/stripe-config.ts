import { billingTableName, getRow, putRow } from "../aws/dynamo";
import { nowISO } from "../lib/utils";

const STRIPE_CONFIG_PK = "STRIPE_CONFIG";
const STRIPE_CONFIG_SK = "CONFIG";

export type StripeConfig = {
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  priceIds: {
    starter: string;
    pro: string;
    power: string;
  };
  updatedAt: string;
  updatedBy: string;
};

// Shape returned to frontend/admin (never exposes secretKey or webhookSecret)
export type StripeConfigPublic = {
  publishableKey: string;
  webhookConfigured: boolean;
  priceIds: StripeConfig["priceIds"];
  updatedAt: string;
  updatedBy: string;
};

type StripeConfigRow = StripeConfig & { pk: string; sk: string };

export async function loadStripeConfig(): Promise<StripeConfig | null> {
  return getRow<StripeConfigRow>(billingTableName(), { pk: STRIPE_CONFIG_PK, sk: STRIPE_CONFIG_SK });
}

export async function loadStripeConfigPublic(): Promise<StripeConfigPublic | null> {
  const config = await loadStripeConfig();
  if (!config) return null;
  return {
    publishableKey: config.publishableKey,
    webhookConfigured: Boolean(config.webhookSecret),
    priceIds: config.priceIds,
    updatedAt: config.updatedAt,
    updatedBy: config.updatedBy,
  };
}

export async function saveStripeConfig(
  updatedBy: string,
  input: Omit<StripeConfig, "updatedAt" | "updatedBy">,
): Promise<StripeConfigPublic> {
  const full: StripeConfigRow = {
    ...input,
    pk: STRIPE_CONFIG_PK,
    sk: STRIPE_CONFIG_SK,
    updatedAt: nowISO(),
    updatedBy,
  };
  await putRow(billingTableName(), full);
  return {
    publishableKey: full.publishableKey,
    webhookConfigured: Boolean(full.webhookSecret),
    priceIds: full.priceIds,
    updatedAt: full.updatedAt,
    updatedBy: full.updatedBy,
  };
}
