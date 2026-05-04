import { sendSqsBatch } from "../aws/sqs";
import type { MaterializerMessage } from "./types";

function materializerQueueUrl(): string {
  const queueUrl = process.env.MATERIALIZER_QUEUE_URL;
  if (!queueUrl) throw new Error("MATERIALIZER_QUEUE_URL is not configured");
  return queueUrl;
}

function queueMessageId(message: MaterializerMessage): string {
  const scopeToken = message.scope === "tenant"
    ? `${message.tenantId}-${message.companySlug ?? "all"}`
    : message.companySlug ?? "global";
  return `${message.entityType}-${scopeToken}-${message.jobId}`
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80) || "materializer";
}

/**
 * Queue fanout stays centralized so future producers cannot bypass the shared
 * message shape, dedupe strategy, or DLQ-backed worker lane.
 */
export async function enqueueMaterializerMessages(
  messages: MaterializerMessage[],
): Promise<void> {
  await sendSqsBatch(
    materializerQueueUrl(),
    messages.map((message) => ({
      id: queueMessageId(message),
      body: message as unknown as Record<string, unknown>,
    })),
  );
}
