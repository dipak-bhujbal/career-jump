import { ConditionalCheckFailedException, getRow, putRow, registryTableName, scanAllRows } from "../aws/dynamo";
import { hyphenSlug, nowISO } from "../lib/utils";
import type {
  RegistryCompanyScanState,
  RegistryScanPool,
  RegistryScanPriority,
  RegistryScanStatus,
} from "../types";

type RegistryScanStateRow = RegistryCompanyScanState & {
  pk: string;
  sk: "REGISTRY-SCAN-STATE";
};

const DEFAULT_SCAN_POOL: RegistryScanPool = "low";
const DEFAULT_PRIORITY: RegistryScanPriority = "normal";

function poolFromTrackers(activeTrackers: number): RegistryScanPool {
  if (activeTrackers >= 3) return "hot";
  if (activeTrackers >= 1) return "warm";
  return "low";
}
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAUSED_FAILURE_THRESHOLD = 5;
const SCAN_POOL_INTERVAL_MS: Record<RegistryScanPool, number> = {
  hot: 4 * 60 * 60 * 1000,
  warm: 8 * 60 * 60 * 1000,
  low: 16 * 60 * 60 * 1000,
};

function companySlug(company: string): string {
  return hyphenSlug(company) || company.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown-company";
}

function companyPk(company: string): string {
  return `COMPANY#${companySlug(company)}`;
}

function futureIso(durationMs: number): string {
  return new Date(Date.now() + durationMs).toISOString();
}

function intervalForPool(scanPool: RegistryScanPool): number {
  return SCAN_POOL_INTERVAL_MS[scanPool] ?? SCAN_POOL_INTERVAL_MS.low;
}

function staleWindowForPool(scanPool: RegistryScanPool): number {
  return intervalForPool(scanPool) * 2;
}

function normalizeFailureCount(previous: RegistryCompanyScanState): number {
  const lastFailureAtMs = previous.lastFailureAt ? Date.parse(previous.lastFailureAt) : NaN;
  const insideWindow = Number.isFinite(lastFailureAtMs) && (Date.now() - lastFailureAtMs) <= FAILURE_WINDOW_MS;
  return insideWindow ? previous.failureCount + 1 : 1;
}

function pausedReprobeAt(lastFailureAt: string): string {
  return new Date(Date.parse(lastFailureAt) + FAILURE_WINDOW_MS).toISOString();
}

function deriveStatus(state: RegistryCompanyScanState): RegistryScanStatus {
  if (state.status === "misconfigured") return "misconfigured";
  if (state.status === "paused") return "paused";
  if (state.status === "failing") return "failing";
  if (!state.lastSuccessAt) return "pending";
  const staleAfterMs = state.staleAfterAt ? Date.parse(state.staleAfterAt) : NaN;
  if (Number.isFinite(staleAfterMs) && staleAfterMs <= Date.now()) return "stale";
  return "healthy";
}

function defaultScanHourWeights(): number[] {
  return Array(24).fill(0) as number[];
}

function currentUtcHour(): number {
  return new Date().getUTCHours();
}

function defaultState(company: string, adapterId?: string | null): RegistryCompanyScanState {
  const nextScanAt = nowISO();
  return {
    company,
    companySlug: companySlug(company),
    adapterId: adapterId ?? null,
    scanPool: DEFAULT_SCAN_POOL,
    priority: DEFAULT_PRIORITY,
    status: "pending",
    activeTrackers: 0,
    scanHourWeights: defaultScanHourWeights(),
    nextScanAt,
    staleAfterAt: nextScanAt,
    lastScanAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    failureCount: 0,
    lastFetchedCount: 0,
    updatedAt: nowISO(),
  };
}

export function biasQueryByCurrentHour(
  rows: RegistryCompanyScanState[],
  utcHour: number = currentUtcHour(),
): RegistryCompanyScanState[] {
  const poolOrder: Record<RegistryScanPool, number> = { hot: 0, warm: 1, low: 2 };
  return [...rows].sort((a, b) => {
    const poolDiff = poolOrder[a.scanPool] - poolOrder[b.scanPool];
    if (poolDiff !== 0) return poolDiff;
    const aWeight = (a.scanHourWeights ?? defaultScanHourWeights())[utcHour] ?? 0;
    const bWeight = (b.scanHourWeights ?? defaultScanHourWeights())[utcHour] ?? 0;
    return bWeight - aWeight;
  });
}

function normalizeState(
  company: string,
  state: RegistryCompanyScanState | null,
  adapterId?: string | null,
): RegistryCompanyScanState {
  const merged = {
    ...defaultState(company, adapterId),
    ...state,
    company,
    companySlug: companySlug(company),
    adapterId: adapterId ?? state?.adapterId ?? null,
  };
  return {
    ...merged,
    status: deriveStatus(merged),
  };
}

async function saveState(state: RegistryCompanyScanState): Promise<RegistryCompanyScanState> {
  const next: RegistryCompanyScanState = {
    ...state,
    status: deriveStatus(state),
    updatedAt: nowISO(),
  };

  await putRow(registryTableName(), {
    pk: companyPk(next.company),
    sk: "REGISTRY-SCAN-STATE",
    ...next,
  } satisfies RegistryScanStateRow);

  return next;
}

async function ensureStateInitialized(state: RegistryCompanyScanState): Promise<void> {
  try {
    await putRow(registryTableName(), {
      pk: companyPk(state.company),
      sk: "REGISTRY-SCAN-STATE",
      ...state,
    } satisfies RegistryScanStateRow, {
      conditionExpression: "attribute_not_exists(pk)",
    });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return;
    if (typeof error === "object" && error && "name" in error && error.name === "ConditionalCheckFailedException") return;
    throw error;
  }
}

export async function loadRegistryCompanyScanState(
  company: string,
  adapterId?: string | null,
): Promise<RegistryCompanyScanState> {
  const existing = await getRow<RegistryScanStateRow>(registryTableName(), {
    pk: companyPk(company),
    sk: "REGISTRY-SCAN-STATE",
  }, true);
  const normalized = normalizeState(company, existing, adapterId);
  if (!existing) {
    await ensureStateInitialized(normalized);
  }
  return normalized;
}

export async function markRegistryCompanyScanSuccess(
  company: string,
  input: {
    adapterId?: string | null;
    fetchedCount: number;
    scanPool?: RegistryScanPool;
    priority?: RegistryScanPriority;
  },
): Promise<RegistryCompanyScanState> {
  const previous = await loadRegistryCompanyScanState(company, input.adapterId);
  const scanPool = input.scanPool ?? previous.scanPool;
  const priority = input.priority ?? previous.priority;
  const scannedAt = nowISO();
  const nextScanAt = futureIso(intervalForPool(scanPool));
  const staleAfterAt = futureIso(staleWindowForPool(scanPool));
  const hour = currentUtcHour();
  const weights = [...(previous.scanHourWeights ?? defaultScanHourWeights())];
  weights[hour] = (weights[hour] ?? 0) + 1;

  return saveState({
    ...previous,
    adapterId: input.adapterId ?? previous.adapterId ?? null,
    scanPool,
    priority,
    status: "healthy",
    scanHourWeights: weights,
    nextScanAt,
    staleAfterAt,
    lastScanAt: scannedAt,
    lastSuccessAt: scannedAt,
    lastFailureAt: previous.lastFailureAt,
    lastFailureReason: null,
    failureCount: 0,
    lastFetchedCount: input.fetchedCount,
  });
}

export async function markRegistryCompanyScanFailure(
  company: string,
  input: {
    adapterId?: string | null;
    failureReason: string;
    scanPool?: RegistryScanPool;
    priority?: RegistryScanPriority;
  },
): Promise<RegistryCompanyScanState> {
  const previous = await loadRegistryCompanyScanState(company, input.adapterId);
  const scanPool = input.scanPool ?? previous.scanPool;
  const priority = input.priority ?? previous.priority;
  const scannedAt = nowISO();
  const failureCount = normalizeFailureCount(previous);
  const paused = failureCount >= PAUSED_FAILURE_THRESHOLD;
  const nextScanAt = paused
    ? pausedReprobeAt(scannedAt)
    : futureIso(Math.min(intervalForPool(scanPool), failureCount * 60 * 60 * 1000));

  return saveState({
    ...previous,
    adapterId: input.adapterId ?? previous.adapterId ?? null,
    scanPool,
    priority,
    status: paused ? "paused" : "failing",
    nextScanAt,
    staleAfterAt: previous.staleAfterAt,
    lastScanAt: scannedAt,
    lastFailureAt: scannedAt,
    lastFailureReason: input.failureReason,
    failureCount,
    lastFetchedCount: previous.lastFetchedCount,
  });
}

export async function queryDueRegistryCompanies(
  nowIso: string,
): Promise<RegistryCompanyScanState[]> {
  type Row = RegistryCompanyScanState & { pk: string; sk: string };
  const rows = await scanAllRows<Row>(registryTableName(), {
    filterExpression: "sk = :sk AND #st <> :misconfigured AND #nsa <= :now",
    expressionAttributeNames: { "#st": "status", "#nsa": "nextScanAt" },
    expressionAttributeValues: {
      ":sk": "REGISTRY-SCAN-STATE",
      ":misconfigured": "misconfigured",
      ":now": nowIso,
    },
  });
  return rows.map(({ pk: _pk, sk: _sk, ...state }) => state as RegistryCompanyScanState);
}

export async function markRegistryCompanyScanMisconfigured(
  company: string,
  input: {
    adapterId?: string | null;
    failureReason: string;
    scanPool?: RegistryScanPool;
    priority?: RegistryScanPriority;
  },
): Promise<RegistryCompanyScanState> {
  const previous = await loadRegistryCompanyScanState(company, input.adapterId);
  const scanPool = input.scanPool ?? previous.scanPool;
  const priority = input.priority ?? previous.priority;

  return saveState({
    ...previous,
    adapterId: input.adapterId ?? previous.adapterId ?? null,
    scanPool,
    priority,
    status: "misconfigured",
    nextScanAt: null,
    staleAfterAt: previous.staleAfterAt,
    lastFailureAt: nowISO(),
    lastFailureReason: input.failureReason,
    failureCount: previous.failureCount + 1,
  });
}

export async function updateActiveTrackers(
  company: string,
  delta: 1 | -1,
): Promise<RegistryCompanyScanState> {
  const previous = await loadRegistryCompanyScanState(company);
  const activeTrackers = Math.max(0, (previous.activeTrackers ?? 0) + delta);
  const scanPool = poolFromTrackers(activeTrackers);
  const poolChanged = scanPool !== previous.scanPool;
  const nextScanAt = poolChanged ? nowISO() : previous.nextScanAt;
  const staleAfterAt = poolChanged ? futureIso(staleWindowForPool(scanPool)) : previous.staleAfterAt;

  return saveState({
    ...previous,
    activeTrackers,
    scanPool,
    nextScanAt,
    staleAfterAt,
  });
}
