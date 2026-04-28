import { registryTableName, scanAllRows } from "./dynamo";
import type { RegistryCompanyScanState } from "../types";

type RegistryCompanyRow = {
  pk: "REGISTRY";
  sk: string;
};

type RegistryScanStateRow = RegistryCompanyScanState & {
  pk: string;
  sk: "REGISTRY-SCAN-STATE";
};

export type RegistryOpsDashboardSummary = {
  generatedAt: string;
  total: number;
  routable: number;
  neverScanned: number;
  pending: number;
  fresh: number;
  stale: number;
  failing: number;
  paused: number;
  misconfigured: number;
  scheduled: number;
};

function deriveDashboardStatus(state: RegistryCompanyScanState, nowMs: number): RegistryCompanyScanState["status"] {
  // The pipeline does not persist "stale" back to DynamoDB. We must derive it
  // from the same timestamp fields the runtime uses so the dashboard matches
  // live scheduler semantics.
  if (state.status === "misconfigured") return "misconfigured";
  if (state.status === "paused") return "paused";
  if (state.status === "failing") return "failing";
  if (!state.lastSuccessAt) return "pending";

  const staleAfterMs = state.staleAfterAt ? Date.parse(state.staleAfterAt) : NaN;
  if (Number.isFinite(staleAfterMs) && staleAfterMs <= nowMs) return "stale";
  return "healthy";
}

function isScheduled(state: RegistryCompanyScanState, nowMs: number): boolean {
  const nextScanAtMs = state.nextScanAt ? Date.parse(state.nextScanAt) : NaN;
  return Number.isFinite(nextScanAtMs) && nextScanAtMs > nowMs;
}

export async function buildRegistryOpsDashboardSummary(
  nowIso = new Date().toISOString(),
): Promise<RegistryOpsDashboardSummary> {
  const nowMs = Date.parse(nowIso);

  // Step 6 intentionally scans both the canonical registry partition and the
  // derived scan-state rows in parallel. That gives us an honest denominator
  // for coverage while keeping the live state picture sourced from scan-state.
  const [registryRows, stateRows] = await Promise.all([
    scanAllRows<RegistryCompanyRow>(registryTableName(), {
      filterExpression: "pk = :pk AND begins_with(sk, :companyPrefix)",
      expressionAttributeValues: {
        ":pk": "REGISTRY",
        ":companyPrefix": "COMPANY#",
      },
    }),
    scanAllRows<RegistryScanStateRow>(registryTableName(), {
      filterExpression: "sk = :sk",
      expressionAttributeValues: {
        ":sk": "REGISTRY-SCAN-STATE",
      },
    }),
  ]);

  const total = registryRows.length;
  const neverScanned = Math.max(0, total - stateRows.length);

  let pending = 0;
  let fresh = 0;
  let stale = 0;
  let failing = 0;
  let paused = 0;
  let misconfigured = 0;
  let scheduled = 0;

  for (const row of stateRows) {
    const status = deriveDashboardStatus(row, nowMs);
    if (status === "pending") pending += 1;
    if (status === "healthy") fresh += 1;
    if (status === "stale") stale += 1;
    if (status === "failing") failing += 1;
    if (status === "paused") paused += 1;
    if (status === "misconfigured") misconfigured += 1;
    if (isScheduled(row, nowMs)) scheduled += 1;
  }

  return {
    generatedAt: nowIso,
    total,
    // "Routable" is the coverage view after excluding rows explicitly marked
    // misconfigured by the pipeline. Companies with no scan-state row yet are
    // still part of the routable denominator until proven otherwise.
    routable: Math.max(0, total - misconfigured),
    neverScanned,
    pending,
    fresh,
    stale,
    failing,
    paused,
    misconfigured,
    scheduled,
  };
}

export async function handler() {
  const summary = await buildRegistryOpsDashboardSummary();
  // Emit the full aggregate so the scheduled Lambda itself acts as a cheap
  // operational breadcrumb even before any dedicated admin UI consumes it.
  console.log("[registry-ops-dashboard] summary", JSON.stringify(summary));
  return summary;
}
