import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { applyCompanyScanOverrides, loadRuntimeConfig } from "../config";
import { resolveSystemTenantContext, type AuthenticatedTenantContext } from "../lib/tenant";
import { logAppEvent, logErrorEvent } from "../lib/logger";
import { acquireActiveRunLock, releaseActiveRunLock } from "../storage";
import { makeAwsEnv } from "./env";
import { createRunMeta, type AwsRunTriggerType } from "./run-state";

type OrchestratorEvent = {
  runId?: string;
  triggerType?: AwsRunTriggerType;
  userId?: string;
  tenantId?: string;
  email?: string;
  displayName?: string;
  scope?: "user" | "admin";
  isAdmin?: boolean;
};

const lambda = new LambdaClient({});

function makeRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function eventTenantContext(event: OrchestratorEvent): AuthenticatedTenantContext | null {
  if (!event.tenantId || !event.userId || !event.email) return null;
  return {
    userId: event.userId,
    tenantId: event.tenantId,
    email: event.email,
    displayName: event.displayName || event.email,
    scope: event.scope === "admin" ? "admin" : "user",
    isAdmin: event.isAdmin === true,
  };
}

export async function handler(event: OrchestratorEvent = {}): Promise<{ ok: boolean; runId: string; expectedCompanies?: number }> {
  const env = makeAwsEnv();
  const triggerType = event.triggerType ?? "scheduled";
  const runId = event.runId ?? makeRunId(triggerType);
  const scanFunctionName = process.env.SCAN_COMPANY_FUNCTION_NAME;
  if (!scanFunctionName) throw new Error("SCAN_COMPANY_FUNCTION_NAME is not configured");

  const lockResult = await acquireActiveRunLock(env, { runId, triggerType });
  if (!lockResult.ok) {
    await logAppEvent(env, {
      level: "warn",
      event: "aws_run_skipped_active_lock",
      message: "AWS run skipped because another run is already in progress",
      runId,
      route: "aws/orchestrator",
      details: {
        activeRunId: lockResult.lock.runId,
        activeTriggerType: lockResult.lock.triggerType,
      },
    });
    return { ok: false, runId };
  }

  try {
    const tenantContext = eventTenantContext(event) ?? await resolveSystemTenantContext(env);
    const config = await applyCompanyScanOverrides(env, await loadRuntimeConfig(env, tenantContext.tenantId), tenantContext.tenantId);
    const companies = config.companies.filter((company) => company.enabled !== false);
    // Persist the triggering actor on the run meta so the async finalize step
    // can still send notifications to the right user after fan-out completes.
    await createRunMeta({
      runId,
      triggerType,
      expectedCompanies: companies.length,
      userId: tenantContext.userId,
      tenantId: tenantContext.tenantId,
      email: tenantContext.email,
      displayName: tenantContext.displayName,
    });

    await logAppEvent(env, {
      level: "info",
      event: "aws_run_fanout_started",
      message: `Started AWS fanout run for ${companies.length} companies`,
      tenantId: tenantContext.tenantId,
      runId,
      route: "aws/orchestrator",
      details: { companies: companies.map((company) => company.company) },
    });

    if (!companies.length) {
      await releaseActiveRunLock(env, runId);
      return { ok: true, runId, expectedCompanies: 0 };
    }

    await Promise.all(companies.map((company) => lambda.send(new InvokeCommand({
      FunctionName: scanFunctionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({
        runId,
        tenantId: tenantContext.tenantId,
        companyName: company.company,
      })),
    }))));

    return { ok: true, runId, expectedCompanies: companies.length };
  } catch (error) {
    await releaseActiveRunLock(env, runId);
    await logErrorEvent(env, {
      event: "aws_orchestrator_failed",
      message: error instanceof Error ? error.message : String(error),
      runId,
      route: "aws/orchestrator",
      error,
    });
    throw error;
  }
}
