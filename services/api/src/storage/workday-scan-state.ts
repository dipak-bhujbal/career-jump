import { getRow, putRow, registryTableName } from "../aws/dynamo";
import { hyphenSlug, nowISO } from "../lib/utils";
import type {
  WorkdayFailureReason,
  WorkdayRateLimitStatus,
  WorkdayScanLayer,
  WorkdayScanState,
} from "../types";

type WorkdayScanStateRow = WorkdayScanState & {
  pk: string;
  sk: "SCAN-STATE";
};

const DEFAULT_SCAN_LAYER: WorkdayScanLayer = "layer1";
const DEFAULT_FALLBACK_LAYER: WorkdayScanState["fallbackLayer"] = "layer2";
const DEFAULT_BLOCKED_BACKOFF_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CAPTCHA_BACKOFF_MS = 48 * 60 * 60 * 1000;
const DEFAULT_THROTTLED_BACKOFF_MS = 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROMOTION_PROBE_TARGET = 7;

function companySlug(company: string): string {
  return hyphenSlug(company) || company.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown-company";
}

function companyPk(company: string): string {
  return `COMPANY#${companySlug(company)}`;
}

function defaultState(company: string): WorkdayScanState {
  return {
    company,
    companySlug: companySlug(company),
    scanLayer: DEFAULT_SCAN_LAYER,
    fallbackLayer: DEFAULT_FALLBACK_LAYER,
    rateLimitStatus: "ok",
    resumeAfter: null,
    failureCount24h: 0,
    lastFailureReason: null,
    lastFailureAt: null,
    probeSuccessCount: 0,
    updatedAt: nowISO(),
  };
}

function normalizeState(company: string, state: WorkdayScanState | null): WorkdayScanState {
  if (!state) return defaultState(company);
  return {
    ...defaultState(company),
    ...state,
    company,
    companySlug: companySlug(company),
  };
}

function parseRetryAfterToIso(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds)) {
    return new Date(Date.now() + (Math.max(1, asSeconds) * 1000)).toISOString();
  }

  const asDate = Date.parse(trimmed);
  return Number.isFinite(asDate) ? new Date(asDate).toISOString() : null;
}

function futureIsoFromMs(durationMs: number): string {
  return new Date(Date.now() + durationMs).toISOString();
}

function normalizeFailureCount(previous: WorkdayScanState): number {
  const lastFailureAtMs = previous.lastFailureAt ? Date.parse(previous.lastFailureAt) : NaN;
  const insideWindow = Number.isFinite(lastFailureAtMs) && (Date.now() - lastFailureAtMs) <= FAILURE_WINDOW_MS;
  return insideWindow ? previous.failureCount24h + 1 : 1;
}

function toPausedStatus(failureReason: WorkdayFailureReason, failureCount24h: number): WorkdayRateLimitStatus {
  if (failureReason === "captcha") return "captcha";
  if (failureCount24h >= 3) return "paused";
  return failureReason;
}

async function saveState(state: WorkdayScanState): Promise<WorkdayScanState> {
  const next: WorkdayScanState = {
    ...state,
    updatedAt: nowISO(),
  };

  await putRow(registryTableName(), {
    pk: companyPk(next.company),
    sk: "SCAN-STATE",
    ...next,
  } satisfies WorkdayScanStateRow);

  return next;
}

/**
 * Workday routing state lives beside the registry because it is company-level
 * infrastructure state, not tenant state. One successful probe benefits every
 * tenant that tracks that board.
 */
export async function loadWorkdayScanState(company: string): Promise<WorkdayScanState> {
  const existing = await getRow<WorkdayScanStateRow>(registryTableName(), {
    pk: companyPk(company),
    sk: "SCAN-STATE",
  }, true);
  return normalizeState(company, existing);
}

export function shouldBypassLiveWorkdayScan(state: WorkdayScanState, now = Date.now()): boolean {
  if (!state.resumeAfter) return false;
  const resumeAfterMs = Date.parse(state.resumeAfter);
  return Number.isFinite(resumeAfterMs) && resumeAfterMs > now;
}

export async function markWorkdayScanSuccess(
  company: string,
  layerUsed: WorkdayScanLayer,
): Promise<WorkdayScanState> {
  const previous = await loadWorkdayScanState(company);
  const shouldProbeDowngrade = previous.scanLayer !== "layer1" && layerUsed === "layer1";
  const probeSuccessCount = shouldProbeDowngrade ? previous.probeSuccessCount + 1 : 0;
  const downgraded = shouldProbeDowngrade && probeSuccessCount >= PROMOTION_PROBE_TARGET;

  return saveState({
    ...previous,
    scanLayer: downgraded ? "layer1" : previous.scanLayer,
    rateLimitStatus: downgraded ? "ok" : previous.rateLimitStatus === "layer_promoted" ? "layer_promoted" : "ok",
    resumeAfter: null,
    failureCount24h: 0,
    lastFailureReason: null,
    lastFailureAt: null,
    probeSuccessCount: downgraded ? 0 : probeSuccessCount,
  });
}

export async function markWorkdayScanFailure(
  company: string,
  input: {
    layerUsed: WorkdayScanLayer;
    failureReason: WorkdayFailureReason;
    retryAfter?: string | null;
  }
): Promise<WorkdayScanState> {
  const previous = await loadWorkdayScanState(company);
  const failureCount24h = normalizeFailureCount(previous);
  const rateLimitStatus = toPausedStatus(input.failureReason, failureCount24h);

  const resumeAfter =
    input.failureReason === "throttled"
      ? parseRetryAfterToIso(input.retryAfter) ?? futureIsoFromMs(DEFAULT_THROTTLED_BACKOFF_MS)
      : input.failureReason === "blocked"
        ? futureIsoFromMs(DEFAULT_BLOCKED_BACKOFF_MS)
        : input.failureReason === "captcha"
          ? futureIsoFromMs(DEFAULT_CAPTCHA_BACKOFF_MS)
          : previous.resumeAfter ?? null;

  return saveState({
    ...previous,
    scanLayer: previous.scanLayer,
    rateLimitStatus,
    resumeAfter,
    failureCount24h,
    lastFailureReason: input.failureReason,
    lastFailureAt: nowISO(),
    probeSuccessCount: 0,
  });
}

export async function markWorkdayLayerPromotion(
  company: string,
  nextLayer: Exclude<WorkdayScanLayer, "layer1">
): Promise<WorkdayScanState> {
  const previous = await loadWorkdayScanState(company);
  return saveState({
    ...previous,
    scanLayer: nextLayer,
    rateLimitStatus: "layer_promoted",
    resumeAfter: null,
    probeSuccessCount: 0,
  });
}
