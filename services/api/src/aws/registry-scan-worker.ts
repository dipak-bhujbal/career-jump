import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { getRow, registryTableName } from "./dynamo";
import { sanitizeCompanies, companyToDetectedConfig } from "../config";
import { inferAtsIdFromUrl, normalizeAtsId } from "../ats/shared/normalize";
import "../ats/shared/init-core";
import "../ats/custom";
import { fetchJobsForDetectedConfig } from "../services/discovery";
import { saveRawScan } from "../storage/raw-scans";
import {
  markRegistryCompanyScanFailure,
  markRegistryCompanyScanMisconfigured,
  markRegistryCompanyScanSuccess,
} from "../storage/registry-scan-state";
import type { RegistryEntry } from "../ats/registry";
import type { RegistryScanMessage } from "./registry-scheduler";
import {
  enqueueDualBuildMessages,
  registryScanCompleteMessages,
  versionFromIso,
} from "../materializer";

type RegistryRow = RegistryEntry & { pk: string; sk: string };

async function loadRegistryEntryBySlug(companySlug: string): Promise<RegistryEntry | null> {
  const row = await getRow<RegistryRow>(registryTableName(), {
    pk: "REGISTRY",
    sk: `COMPANY#${companySlug}`,
  });
  if (!row) return null;
  return {
    rank: row.rank ?? null,
    sheet: row.sheet ?? "Registry",
    company: row.company,
    board_url: row.board_url ?? null,
    ats: row.ats ?? null,
    total_jobs: row.total_jobs ?? null,
    source: row.source ?? null,
    tier: row.tier ?? "NEEDS_REVIEW",
    sample_url: row.sample_url ?? null,
    last_checked: row.last_checked ?? null,
  };
}

function entryToRawInput(entry: RegistryEntry): Record<string, unknown> {
  return {
    company: entry.company,
    enabled: true,
    isRegistry: true,
    registryAts: entry.ats ?? undefined,
    registryTier: entry.tier,
    boardUrl: entry.board_url ?? undefined,
    sampleUrl: entry.sample_url ?? undefined,
    source:
      (entry.ats ? normalizeAtsId(entry.ats) : undefined) ||
      inferAtsIdFromUrl(entry.board_url) ||
      inferAtsIdFromUrl(entry.sample_url) ||
      undefined,
  };
}

async function processMessage(msg: RegistryScanMessage): Promise<void> {
  const entry = await loadRegistryEntryBySlug(msg.companySlug);
  if (!entry) {
    await markRegistryCompanyScanMisconfigured(msg.company, {
      adapterId: msg.adapterId,
      failureReason: `Registry entry not found for slug: ${msg.companySlug}`,
      scanPool: msg.scanPool,
      priority: msg.priority,
    });
    const triggeredAt = new Date().toISOString();
    // Even misconfigured and failed scans should refresh the registry read
    // models so actions-needed/status stay aligned with current scan state.
    void enqueueDualBuildMessages(registryScanCompleteMessages({
      triggeredAt,
      inventoryVersion: versionFromIso(triggeredAt),
      jobIdPrefix: `registry-scan-${msg.companySlug}-${Date.now()}`,
      companySlug: msg.companySlug,
    })).catch((error) => {
      console.warn(JSON.stringify({
        component: "materializer.dual-build",
        event: "registry_scan_complete_enqueue_failed",
        companySlug: msg.companySlug,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    return;
  }

  const [normalized] = sanitizeCompanies([entryToRawInput(entry)]);
  const detected = companyToDetectedConfig(normalized);

  if (!detected) {
    await markRegistryCompanyScanMisconfigured(msg.company, {
      adapterId: msg.adapterId,
      failureReason: "No DetectedConfig resolved from registry entry",
      scanPool: msg.scanPool,
      priority: msg.priority,
    });
    const triggeredAt = new Date().toISOString();
    void enqueueDualBuildMessages(registryScanCompleteMessages({
      triggeredAt,
      inventoryVersion: versionFromIso(triggeredAt),
      jobIdPrefix: `registry-scan-${msg.companySlug}-${Date.now()}`,
      companySlug: msg.companySlug,
    })).catch((error) => {
      console.warn(JSON.stringify({
        component: "materializer.dual-build",
        event: "registry_scan_complete_enqueue_failed",
        companySlug: msg.companySlug,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
    return;
  }

  try {
    const jobs = await fetchJobsForDetectedConfig(msg.company, detected);
    await saveRawScan(msg.company, detected, jobs);
    await markRegistryCompanyScanSuccess(msg.company, {
      adapterId: detected.source,
      fetchedCount: jobs.length,
      scanPool: msg.scanPool,
      priority: msg.priority,
    });
    const triggeredAt = new Date().toISOString();
    void enqueueDualBuildMessages(registryScanCompleteMessages({
      triggeredAt,
      inventoryVersion: versionFromIso(triggeredAt),
      jobIdPrefix: `registry-scan-${msg.companySlug}-${Date.now()}`,
      companySlug: msg.companySlug,
    })).then(() => {
      console.log(JSON.stringify({
        component: "materializer.dual-build",
        event: "registry_scan_complete_enqueued",
        companySlug: msg.companySlug,
      }));
    }).catch((error) => {
      console.warn(JSON.stringify({
        component: "materializer.dual-build",
        event: "registry_scan_complete_enqueue_failed",
        companySlug: msg.companySlug,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await markRegistryCompanyScanFailure(msg.company, {
      adapterId: detected.source,
      failureReason,
      scanPool: msg.scanPool,
      priority: msg.priority,
    });
    const triggeredAt = new Date().toISOString();
    void enqueueDualBuildMessages(registryScanCompleteMessages({
      triggeredAt,
      inventoryVersion: versionFromIso(triggeredAt),
      jobIdPrefix: `registry-scan-${msg.companySlug}-${Date.now()}`,
      companySlug: msg.companySlug,
    })).catch((enqueueError) => {
      console.warn(JSON.stringify({
        component: "materializer.dual-build",
        event: "registry_scan_complete_enqueue_failed",
        companySlug: msg.companySlug,
        error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
      }));
    });
    throw error;
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  await Promise.all(
    event.Records.map(async (record) => {
      try {
        const msg = JSON.parse(record.body) as RegistryScanMessage;
        await processMessage(msg);
      } catch (error) {
        console.error("[registry-scan-worker] failed", JSON.stringify({
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        }));
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures };
}
