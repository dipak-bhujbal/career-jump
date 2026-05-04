import { validateRegistryStatusRows, validateTenantVisibleJobs } from "./validation";
import type { MaterializerMessage } from "./types";

export async function runPostBuildValidation(message: MaterializerMessage): Promise<void> {
  if (message.triggerType !== "scan_complete" && message.triggerType !== "config_change") {
    return;
  }

  if (message.entityType === "visible_jobs" && message.scope === "tenant") {
    const result = await validateTenantVisibleJobs(
      message.tenantId,
      message.configVersion ?? 1,
      message.inventoryVersion ?? 1,
    );

    if (!result.passed) {
      // Validation is an observability surface for dual-build drift; it should
      // not poison the queue and cause endless retries of an otherwise valid
      // projection write.
      console.error(JSON.stringify({
        component: "materializer.validation",
        event: "dual_build_validation_failed",
        entityType: message.entityType,
        triggerType: message.triggerType,
        tenantId: message.tenantId,
        jobId: message.jobId,
        countMismatch: result.countMismatch,
        missingKeys: result.missingKeys.length,
        versionMismatches: result.versionMismatches.length,
        staleSourceUpdatedAt: result.staleSourceUpdatedAt.length,
      }));
    }
    return;
  }

  if (message.entityType === "registry_status") {
    const result = await validateRegistryStatusRows();
    if (!result.passed) {
      // Keep registry mismatch reporting visible without changing queue
      // semantics during the additive rollout.
      console.error(JSON.stringify({
        component: "materializer.validation",
        event: "dual_build_validation_failed",
        entityType: message.entityType,
        triggerType: message.triggerType,
        jobId: message.jobId,
        missingCompanies: result.missingCompanySlugs.length,
      }));
    }
  }
}
