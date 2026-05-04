import type {
  MaterializerBuilderResult,
  MaterializerMessage,
  MaterializerMetric,
  MaterializerMetricStatus,
} from "./types";

function baseMetric(
  message: MaterializerMessage,
  status: MaterializerMetricStatus,
  durationMs: number,
  rowsWritten: number,
  details?: Record<string, unknown>,
): MaterializerMetric {
  return {
    metricName: "materializer_run",
    entityType: message.entityType,
    triggerType: message.triggerType,
    scope: message.scope,
    status,
    rowsWritten,
    durationMs,
    jobId: message.jobId,
    tenantId: message.scope === "tenant" ? message.tenantId : undefined,
    companySlug: message.companySlug,
    details,
  };
}

/**
 * Phase 2 uses structured CloudWatch logs as the baseline metrics surface.
 * That keeps instrumentation alive from the first scaffolded run, before any
 * higher-level dashboards or metric filters are added in later phases.
 */
export function emitMaterializerMetric(metric: MaterializerMetric): void {
  console.log(JSON.stringify({
    component: "materializer",
    ...metric,
  }));
}

export function startMaterializerTimer(message: MaterializerMessage): {
  finishSuccess(result: MaterializerBuilderResult): void;
  finishError(error: unknown): void;
} {
  const startedAt = Date.now();

  return {
    finishSuccess(result: MaterializerBuilderResult): void {
      emitMaterializerMetric(
        baseMetric(
          message,
          "success",
          Date.now() - startedAt,
          result.rowsWritten,
          result.details,
        ),
      );
    },
    finishError(error: unknown): void {
      emitMaterializerMetric(
        baseMetric(
          message,
          "error",
          Date.now() - startedAt,
          0,
          {
            error: error instanceof Error ? error.message : String(error),
          },
        ),
      );
    },
  };
}
