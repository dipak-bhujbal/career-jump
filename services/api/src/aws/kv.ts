import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

type KvListOptions = {
  prefix?: string;
  limit?: number;
  cursor?: string;
};

type KvListWithValuesResult = {
  entries: Array<{ name: string; value: string }>;
  list_complete: boolean;
  cursor?: string;
};

type KvPutOptions = {
  expirationTtl?: number;
};

type ConditionalLockPutOptions = {
  expirationTtl: number;
  lastHeartbeatAt: string;
  runId: string;
  staleAfterSeconds: number;
};

type KvRow = {
  pk: string;
  sk: string;
  value: string;
  expiresAtEpoch?: number;
  lastHeartbeatAtEpoch?: number;
  runId?: string;
};

const client = new DynamoDBClient({});

function tableName(): string {
  const value = process.env.AWS_STATE_TABLE;
  if (!value) throw new Error("AWS_STATE_TABLE is not configured");
  return value;
}

function encodeCursor(value: unknown): string | undefined {
  if (!value) return undefined;
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value?: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function isExpired(row: KvRow): boolean {
  return typeof row.expiresAtEpoch === "number" && row.expiresAtEpoch <= Math.floor(Date.now() / 1000);
}

function toEpochSeconds(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Math.floor(Date.now() / 1000);
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException
    || (typeof error === "object" && error !== null && (error as Error).name === "ConditionalCheckFailedException");
}

export class DynamoKvNamespace {
  constructor(private readonly namespace: string) {}

  async get(key: string, type?: "text" | "json" | "arrayBuffer" | "stream"): Promise<unknown> {
    const response = await client.send(new GetItemCommand({
      TableName: tableName(),
      Key: marshall({ pk: `KV#${this.namespace}`, sk: key }),
    }));
    if (!response.Item) return null;
    const row = unmarshall(response.Item) as KvRow;
    if (isExpired(row)) {
      await this.delete(key);
      return null;
    }
    if (type === "json") {
      try {
        return JSON.parse(row.value);
      } catch {
        return null;
      }
    }
    if (type === "arrayBuffer") return Buffer.from(row.value).buffer;
    if (type === "stream") return new Response(row.value).body;
    return row.value;
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: KvPutOptions): Promise<void> {
    const text = typeof value === "string"
      ? value
      : Buffer.from(value instanceof ArrayBuffer ? value : value.buffer).toString("utf8");
    const expiresAtEpoch = options?.expirationTtl
      ? Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(options.expirationTtl))
      : undefined;
    await client.send(new PutItemCommand({
      TableName: tableName(),
      Item: marshall({
        pk: `KV#${this.namespace}`,
        sk: key,
        value: text,
        ...(expiresAtEpoch ? { expiresAtEpoch } : {}),
      }, { removeUndefinedValues: true }),
    }));
  }

  async putActiveRunLockIfAvailable(
    key: string,
    value: string,
    options: ConditionalLockPutOptions
  ): Promise<boolean> {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const expiresAtEpoch = nowEpoch + Math.max(1, Math.floor(options.expirationTtl));
    const staleCutoffEpoch = nowEpoch - Math.max(1, Math.floor(options.staleAfterSeconds));
    const legacyStaleExpiresAtCutoffEpoch = nowEpoch
      + Math.max(1, Math.floor(options.expirationTtl))
      - Math.max(1, Math.floor(options.staleAfterSeconds));
    const lastHeartbeatAtEpoch = toEpochSeconds(options.lastHeartbeatAt);

    try {
      await client.send(new PutItemCommand({
        TableName: tableName(),
        Item: marshall({
          pk: `KV#${this.namespace}`,
          sk: key,
          value,
          expiresAtEpoch,
          lastHeartbeatAtEpoch,
          runId: options.runId,
        }),
        ConditionExpression: [
          "attribute_not_exists(pk)",
          "expiresAtEpoch <= :nowEpoch",
          "lastHeartbeatAtEpoch <= :staleCutoffEpoch",
          "(attribute_not_exists(runId) AND expiresAtEpoch <= :legacyStaleExpiresAtCutoffEpoch)",
          "runId = :runId",
        ].join(" OR "),
        ExpressionAttributeValues: marshall({
          ":nowEpoch": nowEpoch,
          ":staleCutoffEpoch": staleCutoffEpoch,
          ":legacyStaleExpiresAtCutoffEpoch": legacyStaleExpiresAtCutoffEpoch,
          ":runId": options.runId,
        }),
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  async putIfAbsent(key: string, value: string, options?: KvPutOptions): Promise<boolean> {
    const text = value;
    const expiresAtEpoch = options?.expirationTtl
      ? Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(options.expirationTtl))
      : undefined;

    try {
      await client.send(new PutItemCommand({
        TableName: tableName(),
        Item: marshall({
          pk: `KV#${this.namespace}`,
          sk: key,
          value: text,
          ...(expiresAtEpoch ? { expiresAtEpoch } : {}),
        }, { removeUndefinedValues: true }),
        ConditionExpression: "attribute_not_exists(pk)",
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  async deleteActiveRunLockIfOwned(key: string, runId: string): Promise<boolean> {
    try {
      await client.send(new DeleteItemCommand({
        TableName: tableName(),
        Key: marshall({ pk: `KV#${this.namespace}`, sk: key }),
        ConditionExpression: "runId = :runId",
        ExpressionAttributeValues: marshall({
          ":runId": runId,
        }),
      }));
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await client.send(new DeleteItemCommand({
      TableName: tableName(),
      Key: marshall({ pk: `KV#${this.namespace}`, sk: key }),
    }));
  }

  async list(options: KvListOptions = {}): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const response = await client.send(new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: marshall({
        ":pk": `KV#${this.namespace}`,
        ":prefix": options.prefix ?? "",
      }),
      Limit: options.limit,
      ExclusiveStartKey: decodeCursor(options.cursor) as never,
    }));
    const rows = (response.Items ?? [])
      .map((item) => unmarshall(item) as KvRow)
      .filter((row) => !isExpired(row));

    return {
      keys: rows.map((row) => ({ name: row.sk })),
      list_complete: !response.LastEvaluatedKey,
      cursor: encodeCursor(response.LastEvaluatedKey),
    };
  }

  async listWithValues(options: KvListOptions = {}): Promise<KvListWithValuesResult> {
    const response = await client.send(new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: marshall({
        ":pk": `KV#${this.namespace}`,
        ":prefix": options.prefix ?? "",
      }),
      Limit: options.limit,
      ExclusiveStartKey: decodeCursor(options.cursor) as never,
    }));
    const rows = (response.Items ?? [])
      .map((item) => unmarshall(item) as KvRow)
      .filter((row) => !isExpired(row));

    return {
      entries: rows.map((row) => ({ name: row.sk, value: row.value })),
      list_complete: !response.LastEvaluatedKey,
      cursor: encodeCursor(response.LastEvaluatedKey),
    };
  }
}
