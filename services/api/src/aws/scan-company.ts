import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { INVENTORY_KEY } from "../constants";
import { loadRuntimeConfig } from "../config";
import { jobStateKv } from "../lib/bindings";
import { logErrorEvent } from "../lib/logger";
import { tenantScopedKey } from "../lib/tenant";
import { buildInventory } from "../services/inventory";
import { heartbeatActiveRun } from "../storage";
import type { InventorySnapshot } from "../types";
import { makeAwsEnv } from "./env";
import {
  companyResultKey,
  failedCompanyResultKey,
  getRunMeta,
  markCompanyFinished,
  tryStartFinalize,
  type AwsRunMeta,
} from "./run-state";

type ScanCompanyEvent = {
  runId: string;
  tenantId?: string;
  companyName: string;
  isAdmin?: boolean;
};

const lambda = new LambdaClient({});

async function loadPreviousInventory(tenantId?: string): Promise<InventorySnapshot | null> {
  const env = makeAwsEnv();
  const data = await jobStateKv(env).get(tenantScopedKey(tenantId, INVENTORY_KEY), "json")
    ?? (tenantId ? await jobStateKv(env).get(INVENTORY_KEY, "json") : null);
  return data && typeof data === "object" ? (data as InventorySnapshot) : null;
}

async function maybeInvokeFinalize(
  runId: string,
  meta: AwsRunMeta,
  shouldStartFinalize: boolean,
  tenantId?: string
): Promise<void> {
  const shouldFinalize = shouldStartFinalize ? await tryStartFinalize(runId, meta) : false;
  const functionName = process.env.FINALIZE_RUN_FUNCTION_NAME;
  if (!shouldFinalize || !functionName) return;
  await lambda.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify({ runId, tenantId })),
  }));
}

async function publishAwsRunHeartbeat(
  runId: string,
  tenantId: string | undefined,
  patch: {
    currentCompany: string;
    currentSource?: string;
    currentStage: string;
    lastEvent: string;
  }
): Promise<void> {
  const env = makeAwsEnv();
  const meta = await getRunMeta(runId);
  if (!meta) return;

  try {
    // AWS runs fan out one company per Lambda, so progress must come from the
    // shared run meta counters instead of the local one-company inventory loop.
    await heartbeatActiveRun(env, tenantId, runId, {
      totalCompanies: meta.expectedCompanies,
      fetchedCompanies: meta.totalFinishedCompanies ?? (meta.completedCompanies + meta.failedCompanies),
      currentCompany: patch.currentCompany,
      currentSource: patch.currentSource,
      currentStage: patch.currentStage,
      lastEvent: patch.lastEvent,
    });
  } catch {
    // Finalize or manual abort can release the run lock between worker steps.
    // Heartbeats are best-effort progress updates, so losing the lock should
    // not convert a finished company scan into a failed Lambda invocation.
  }
}

export async function handler(event: ScanCompanyEvent): Promise<{ ok: boolean; runId: string; companyName: string }> {
  const env = makeAwsEnv();
  const { runId, tenantId, companyName } = event;
  if (!runId || !companyName) throw new Error("runId and companyName are required");

  let failed = false;
  try {
    const meta = await getRunMeta(runId);
    const config = await loadRuntimeConfig(env, tenantId, {
      isAdmin: event.isAdmin === true || meta?.isAdmin === true,
      updatedByUserId: meta?.userId,
    });
    const company = config.companies.find((entry) => entry.company === companyName);
    if (!company) throw new Error(`Company ${companyName} was not found in runtime config`);

    await publishAwsRunHeartbeat(runId, tenantId, {
      currentCompany: company.company,
      currentSource: company.source,
      currentStage: "scanning_company",
      lastEvent: "company_scan_started",
    });

    const previousInventory = await loadPreviousInventory(tenantId);
    const inventory = await buildInventory(
      env,
      { ...config, companies: [company] },
      previousInventory,
      runId,
      tenantId,
      {
        preserveUnscannedJobs: false,
        // The shared AWS run lock is updated from run meta counters instead of
        // the local single-company loop so progress stays 0/N -> N/N while
        // ownership checks can still stop work immediately after an abort.
        disableActiveRunHeartbeat: true,
        isAdmin: event.isAdmin === true || meta?.isAdmin === true,
      }
    );

    await jobStateKv(env).put(companyResultKey(runId, companyName), JSON.stringify({
      companyName,
      inventory,
      completedAt: new Date().toISOString(),
    }), { expirationTtl: 60 * 60 * 24 * 7 });
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    await jobStateKv(env).put(failedCompanyResultKey(runId, companyName), JSON.stringify({
      companyName,
      error: message,
      failedAt: new Date().toISOString(),
    }), { expirationTtl: 60 * 60 * 24 * 7 });
    await logErrorEvent(env, {
      event: "aws_company_scan_failed",
      message,
      tenantId,
      runId,
      company: companyName,
      route: "aws/scan-company",
      error,
    });
  } finally {
    const finish = await markCompanyFinished({ runId, failed });
    await publishAwsRunHeartbeat(runId, tenantId, {
      currentCompany: companyName,
      currentStage: failed ? "company_failed" : "company_completed",
      lastEvent: failed ? "company_scan_failed" : "company_scan_completed",
    });
    await maybeInvokeFinalize(runId, finish.meta, finish.shouldStartFinalize, tenantId);
  }

  return { ok: !failed, runId, companyName };
}
