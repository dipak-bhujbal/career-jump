import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { runMaterializerMessage } from "../materializer";
import type { MaterializerMessage } from "../materializer";
import { runPostBuildValidation } from "../materializer/post-build-validation";

async function processRecord(recordBody: string): Promise<void> {
  const message = JSON.parse(recordBody) as MaterializerMessage;
  await runMaterializerMessage(message);
  // Dual-build validation is intentionally post-write and non-blocking so the
  // additive rollout observes drift without changing delivery semantics.
  try {
    await runPostBuildValidation(message);
  } catch (error) {
    console.error(JSON.stringify({
      component: "materializer.validation",
      event: "post_build_validation_error",
      jobId: message.jobId,
      entityType: message.entityType,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];

  await Promise.all(
    event.Records.map(async (record) => {
      try {
        await processRecord(record.body);
      } catch (error) {
        console.error("[materializer-worker] failed", JSON.stringify({
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        }));
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures };
}
