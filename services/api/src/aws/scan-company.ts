import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { INVENTORY_KEY } from "../constants";
import { loadRuntimeConfig } from "../config";
import { jobStateKv } from "../lib/bindings";
import { logErrorEvent } from "../lib/logger";
import { tenantScopedKey } from "../lib/tenant";
import { buildInventory } from "../services/inventory";
import type { InventorySnapshot } from "../types";
import { makeAwsEnv } from "./env";
import { companyResultKey, failedCompanyResultKey, markCompanyFinished, tryStartFinalize, type AwsRunMeta } from "./run-state";

type ScanCompanyEvent = {
  runId: string;
  tenantId?: string;
  companyName: string;
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

export async function handler(event: ScanCompanyEvent): Promise<{ ok: boolean; runId: string; companyName: string }> {
  const env = makeAwsEnv();
  const { runId, tenantId, companyName } = event;
  if (!runId || !companyName) throw new Error("runId and companyName are required");

  let failed = false;
  try {
    const config = await loadRuntimeConfig(env, tenantId);
    const company = config.companies.find((entry) => entry.company === companyName);
    if (!company) throw new Error(`Company ${companyName} was not found in runtime config`);

    const previousInventory = await loadPreviousInventory(tenantId);
    const inventory = await buildInventory(
      env,
      { ...config, companies: [company] },
      previousInventory,
      runId,
      tenantId,
      { preserveUnscannedJobs: false }
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
    await maybeInvokeFinalize(runId, finish.meta, finish.shouldStartFinalize, tenantId);
  }

  return { ok: !failed, runId, companyName };
}
