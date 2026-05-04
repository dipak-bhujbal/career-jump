import { validateTenantVisibleJobs, validateRegistryStatusRows } from "../materializer/validation";

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_EMAIL?.trim().toLowerCase() || "default";

/**
 * Runs post-backfill validation after the materializer worker has drained
 * the queue. Invoke separately from the backfill handler.
 *
 * Invoke via: aws lambda invoke --function-name ...-materializer-validate
 *
 * Logs structured pass/fail results to CloudWatch. Returns non-zero exit
 * signal via the response payload when validation fails — safe to check
 * in deployment scripts.
 */
export async function handler(): Promise<{
  tenantPassed: boolean;
  registryPassed: boolean;
  overallPassed: boolean;
  tenantId: string;
}> {
  const [tenantResult, registryResult] = await Promise.all([
    validateTenantVisibleJobs(DEFAULT_TENANT_ID, 1, 1),
    validateRegistryStatusRows(),
  ]);

  const overallPassed = tenantResult.passed && registryResult.passed;

  if (!overallPassed) {
    console.error(JSON.stringify({
      component: "materializer.validate",
      event: "validation_failed",
      tenantPassed: tenantResult.passed,
      registryPassed: registryResult.passed,
      tenantCountMismatch: tenantResult.countMismatch,
      tenantMissingKeys: tenantResult.missingKeys.length,
      tenantVersionMismatches: tenantResult.versionMismatches.length,
      tenantStaleWatermarks: tenantResult.staleSourceUpdatedAt.length,
      registryMissingCompanies: registryResult.missingCompanySlugs.length,
    }));
  }

  return {
    tenantPassed: tenantResult.passed,
    registryPassed: registryResult.passed,
    overallPassed,
    tenantId: DEFAULT_TENANT_ID,
  };
}
