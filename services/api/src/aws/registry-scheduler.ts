import { queryDueRegistryCompanies } from "../storage/registry-scan-state";
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

export async function handler(): Promise<SchedulerResult> {
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
