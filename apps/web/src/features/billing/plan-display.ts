/**
 * Billing display helpers.
 *
 * These values are intentionally placeholders for the current UX pass so the
 * upgrade surfaces can communicate a pricing ladder before admin-managed public
 * pricing is exposed from the backend.
 */
export const planPricePlaceholders = {
  free: "$0",
  starter: "$19",
  pro: "$49",
  power: "$99",
} as const;

export const planIntervalLabel = "/mo";

export const planUpgradeBlurb: Record<"starter" | "pro" | "power", string> = {
  starter: "For focused solo tracking with more companies and richer scans.",
  pro: "For higher-volume searching with deeper monitoring and more headroom.",
  power: "For the most aggressive search cadence and the largest active pipeline.",
};
