import { queryDueRegistryCompanies } from "../storage/registry-scan-state";
import { loadSystemRegistryScanFlag } from "../storage/accounts";
import { sendSqsBatch } from "./sqs";
import type { RegistryCompanyScanState, RegistryScanPool, RegistryScanPriority } from "../types";

export type RegistryScanMessage = {
  company: string;
  companySlug: string;
  adapterId: string | null;
  scanPool: RegistryScanPool;
  priority: RegistryScanPriority;
  isReprobe: boolean;
};

const WORKDAY_ADAPTER_IDS = new Set(["workday"]);

const ENTERPRISE_ADAPTER_IDS = new Set([
  "oracle",
  "successfactors",
  "taleo",
  "icims",
  "phenom",
  "eightfold",
]);

function resolveQueueUrl(adapterId: string | null | undefined): string | null {
  if (!adapterId) return publicApiQueueUrl();
  if (WORKDAY_ADAPTER_IDS.has(adapterId)) return workdayQueueUrl();
  if (ENTERPRISE_ADAPTER_IDS.has(adapterId)) return enterpriseQueueUrl();
  return publicApiQueueUrl();
}

function workdayQueueUrl(): string | null {
  return process.env.WORKDAY_QUEUE_URL ?? null;
}

function enterpriseQueueUrl(): string | null {
  return process.env.ENTERPRISE_QUEUE_URL ?? null;
}

function publicApiQueueUrl(): string | null {
  return process.env.PUBLIC_API_QUEUE_URL ?? null;
}

function messageId(company: RegistryCompanyScanState): string {
  return company.companySlug.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "company";
}

function toScanMessage(company: RegistryCompanyScanState): RegistryScanMessage {
  return {
    company: company.company,
    companySlug: company.companySlug,
    adapterId: company.adapterId ?? null,
    scanPool: company.scanPool,
    priority: company.priority,
    isReprobe: company.status === "paused",
  };
}

type SchedulerResult = {
  dispatched: number;
  skipped: number;
  byQueue: { workday: number; enterprise: number; publicApi: number };
};

const ET_WEEKDAY_WINDOW = {
  startHour: 6,
  endHourExclusive: 23,
};

function currentEtParts(now: Date): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "-1");
  return { weekday, hour };
}

function isEtWeekdayDispatchWindow(now: Date): boolean {
  const { weekday, hour } = currentEtParts(now);
  const isWeekday = weekday !== "Sat" && weekday !== "Sun";
  const isInsideHourWindow = hour >= ET_WEEKDAY_WINDOW.startHour && hour < ET_WEEKDAY_WINDOW.endHourExclusive;
  return isWeekday && isInsideHourWindow;
}

export async function handler(): Promise<SchedulerResult> {
  const scansEnabled = await loadSystemRegistryScanFlag();
  if (!scansEnabled) {
    console.log("[registry-scheduler] registry_scans_enabled=false — all scans paused by admin");
    return { dispatched: 0, skipped: 0, byQueue: { workday: 0, enterprise: 0, publicApi: 0 } };
  }

  // Hot / warm / cold still control nextScanAt spacing. This guard only blocks
  // dispatch outside the allowed ET business window so companies become due at
  // night/weekend and then release on the next valid weekday morning.
  if (!isEtWeekdayDispatchWindow(new Date())) {
    console.log("[registry-scheduler] outside ET weekday dispatch window — skipping scan fanout");
    return { dispatched: 0, skipped: 0, byQueue: { workday: 0, enterprise: 0, publicApi: 0 } };
  }

  const now = new Date().toISOString();
  const due = await queryDueRegistryCompanies(now);

  const byQueue: Record<string, Array<{ id: string; body: Record<string, unknown> }>> = {};
  let skipped = 0;

  for (const company of due) {
    const queueUrl = resolveQueueUrl(company.adapterId);
    if (!queueUrl) {
      skipped++;
      continue;
    }
    if (!byQueue[queueUrl]) byQueue[queueUrl] = [];
    byQueue[queueUrl].push({
      id: messageId(company),
      body: toScanMessage(company) as unknown as Record<string, unknown>,
    });
  }

  await Promise.all(
    Object.entries(byQueue).map(([url, messages]) => sendSqsBatch(url, messages)),
  );

  const dispatched = Object.values(byQueue).reduce((sum, msgs) => sum + msgs.length, 0);

  return {
    dispatched,
    skipped,
    byQueue: {
      workday: byQueue[workdayQueueUrl() ?? ""] ?.length ?? 0,
      enterprise: byQueue[enterpriseQueueUrl() ?? ""] ?.length ?? 0,
      publicApi: byQueue[publicApiQueueUrl() ?? ""] ?.length ?? 0,
    },
  };
}
