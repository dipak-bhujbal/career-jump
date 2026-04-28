import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
} from "@aws-sdk/client-sqs";

const client = new SQSClient({});

type SqsMessage = {
  id: string;
  body: Record<string, unknown>;
};

export async function sendSqsBatch(queueUrl: string, messages: SqsMessage[]): Promise<void> {
  if (!messages.length) return;
  const BATCH_SIZE = 10;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    const entries: SendMessageBatchRequestEntry[] = chunk.map((msg) => ({
      Id: msg.id,
      MessageBody: JSON.stringify(msg.body),
    }));
    const result = await client.send(new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: entries,
    }));
    if (result.Failed?.length) {
      const failed = result.Failed.map((f: { Id?: string; Message?: string }) => `${f.Id}:${f.Message}`).join(", ");
      throw new Error(`SQS batch had ${result.Failed.length} failures: ${failed}`);
    }
  }
}
