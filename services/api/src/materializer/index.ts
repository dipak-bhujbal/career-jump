import { startMaterializerTimer } from "./instrumentation";
import { upsertReadModelRow } from "./writer";
import { actionsNeededBuilder } from "./builders/actions-needed";
import { companyIndexBuilder } from "./builders/company-index";
import { dashboardBuilder } from "./builders/dashboard";
import { registryStatusBuilder } from "./builders/registry-status";
import { visibleJobsBuilder } from "./builders/visible-jobs";
import type { MaterializerBuilder, MaterializerBuilderResult, MaterializerMessage } from "./types";

const BUILDERS: Record<string, MaterializerBuilder> = {
  visible_jobs: visibleJobsBuilder,
  dashboard_summary: dashboardBuilder,
  registry_status: registryStatusBuilder,
  registry_actions_needed: actionsNeededBuilder,
  company_index: companyIndexBuilder,
};

export function materializerBuilders(): MaterializerBuilder[] {
  return Object.values(BUILDERS);
}

/**
 * The materializer module is the only write boundary for CQRS read models.
 * Route handlers and one-off scripts should enqueue work, not write rows
 * directly, so idempotency and freshness rules stay centralized here.
 */
export async function runMaterializerMessage(
  message: MaterializerMessage,
): Promise<MaterializerBuilderResult> {
  const builder = BUILDERS[message.entityType];
  if (!builder) {
    throw new Error(`No materializer builder registered for entityType=${message.entityType}`);
  }

  const timer = startMaterializerTimer(message);

  try {
    const result = await builder.build({
      message,
      upsertReadModelRow,
    });
    timer.finishSuccess(result);
    return result;
  } catch (error) {
    timer.finishError(error);
    throw error;
  }
}

export * from "./queue";
export * from "./types";
export * from "./writer";
export * from "./dual-build";
export * from "./config-snapshot";
