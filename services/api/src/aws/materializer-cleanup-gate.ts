import { loadRuntimeConfig } from "../config";
import { versionFromIso } from "../materializer";
import { queryCqrsJobsReadyRow, queryRegistryStatusRows } from "../materializer/readers";
import { loadRegistryCache, listAll } from "../storage/registry-cache";
import { makeAwsEnv } from "./env";

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_EMAIL?.trim().toLowerCase() || "default";

type GateAssertion = {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
};

function buildAssertion(
  name: string,
  passed: boolean,
  details: Record<string, unknown>,
): GateAssertion {
  return { name, passed, details };
}

/**
 * Cleanup gate for the future legacy-code deletion phase.
 *
 * This handler does not delete anything. It only proves that the read cutovers
 * are both enabled and materially ready before any later phase removes the
 * legacy fallback paths.
 *
 * Invoke via: aws lambda invoke --function-name ...-materializer-cleanup-gate
 *
 * Failure mode is intentional: any unmet assertion throws so the Lambda exits
 * non-zero instead of silently logging a warning.
 */
export async function handler(): Promise<{
  overallPassed: true;
  tenantId: string;
  assertions: GateAssertion[];
}> {
  const env = makeAwsEnv();

  const [registryRows, registryEntries, config, readyRow] = await Promise.all([
    queryRegistryStatusRows(),
    loadRegistryCache().then(() => listAll()),
    loadRuntimeConfig(env, DEFAULT_TENANT_ID),
    queryCqrsJobsReadyRow(DEFAULT_TENANT_ID),
  ]);

  const currentConfigVersion = versionFromIso(config.updatedAt);
  const assertions: GateAssertion[] = [
    buildAssertion("cqrs_registry_flag_enabled", process.env.CQRS_REGISTRY_READ === "1", {
      expected: "1",
      actual: process.env.CQRS_REGISTRY_READ ?? null,
    }),
    buildAssertion("registry_rows_cover_catalog", registryRows.length >= registryEntries.length, {
      registryRows: registryRows.length,
      registryEntries: registryEntries.length,
    }),
    buildAssertion("cqrs_jobs_flag_enabled", process.env.CQRS_JOBS_READ === "1", {
      expected: "1",
      actual: process.env.CQRS_JOBS_READ ?? null,
    }),
    buildAssertion(
      "jobs_ready_marker_matches_current_config",
      readyRow !== null && readyRow.configVersion === currentConfigVersion,
      {
        hasReadyRow: readyRow !== null,
        readyConfigVersion: readyRow?.configVersion ?? null,
        currentConfigVersion,
        readyRowCount: readyRow?.rowCount ?? null,
      },
    ),
  ];

  const failedAssertions = assertions.filter((assertion) => !assertion.passed);
  if (failedAssertions.length > 0) {
    console.error(JSON.stringify({
      component: "materializer.cleanup-gate",
      event: "cleanup_gate_failed",
      tenantId: DEFAULT_TENANT_ID,
      failedAssertions,
    }));
    throw new Error(`Cleanup gate failed: ${failedAssertions.map((item) => item.name).join(", ")}`);
  }

  console.log(JSON.stringify({
    component: "materializer.cleanup-gate",
    event: "cleanup_gate_passed",
    tenantId: DEFAULT_TENANT_ID,
    assertions,
  }));

  return {
    overallPassed: true,
    tenantId: DEFAULT_TENANT_ID,
    assertions,
  };
}
