import {
  AttributeValue,
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

type QueryOptions = {
  indexName?: string;
  limit?: number;
  scanIndexForward?: boolean;
  consistentRead?: boolean;
};

type PutRowOptions = {
  conditionExpression?: string;
  expressionAttributeNames?: Record<string, string>;
  expressionAttributeValues?: Record<string, unknown>;
};

const client = new DynamoDBClient({});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function usersTableName(): string {
  return requiredEnv("AWS_USERS_TABLE");
}

export function stateTableName(): string {
  return requiredEnv("AWS_STATE_TABLE");
}

export function jobsTableName(): string {
  return requiredEnv("AWS_JOBS_TABLE");
}

export function eventsTableName(): string {
  return requiredEnv("AWS_EVENTS_TABLE");
}

export function supportTableName(): string {
  return requiredEnv("AWS_SUPPORT_TABLE");
}

export function billingTableName(): string {
  return requiredEnv("AWS_BILLING_TABLE");
}

export function rawScansTableName(): string {
  return requiredEnv("AWS_RAW_SCANS_TABLE");
}

export function registryTableName(): string {
  return requiredEnv("AWS_REGISTRY_TABLE");
}

/**
 * Small DynamoDB helpers keep the higher-level storage modules readable and
 * avoid repeating marshalling/query boilerplate across admin and support flows.
 */
export async function putRow(
  tableName: string,
  row: Record<string, unknown>,
  options: PutRowOptions = {},
): Promise<void> {
  await client.send(new PutItemCommand({
    TableName: tableName,
    Item: marshall(row, { removeUndefinedValues: true }),
    ConditionExpression: options.conditionExpression,
    ExpressionAttributeNames: options.expressionAttributeNames,
    ExpressionAttributeValues: options.expressionAttributeValues
      ? marshall(options.expressionAttributeValues, { removeUndefinedValues: true })
      : undefined,
  }));
}

export { ConditionalCheckFailedException };

export async function getRow<T>(
  tableName: string,
  key: Record<string, unknown>,
  consistentRead = false
): Promise<T | null> {
  const response = await client.send(new GetItemCommand({
    TableName: tableName,
    Key: marshall(key, { removeUndefinedValues: true }),
    ConsistentRead: consistentRead,
  }));
  return response.Item ? (unmarshall(response.Item) as T) : null;
}

export async function deleteRow(tableName: string, key: Record<string, unknown>): Promise<void> {
  await client.send(new DeleteItemCommand({
    TableName: tableName,
    Key: marshall(key, { removeUndefinedValues: true }),
  }));
}

export async function queryRows<T>(
  tableName: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, unknown>,
  options: QueryOptions = {},
  expressionAttributeNames?: Record<string, string>
): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;
  let remaining = typeof options.limit === "number" ? options.limit : undefined;

  do {
    const pageLimit = typeof remaining === "number" ? Math.max(remaining, 0) : undefined;
    const response = await client.send(new QueryCommand({
      TableName: tableName,
      IndexName: options.indexName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues, { removeUndefinedValues: true }),
      ExpressionAttributeNames: expressionAttributeNames,
      Limit: pageLimit,
      ScanIndexForward: options.scanIndexForward,
      ConsistentRead: options.consistentRead,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    const pageItems = (response.Items ?? []).map((item) => unmarshall(item) as T);
    items.push(...pageItems);

    if (typeof remaining === "number") {
      remaining -= pageItems.length;
      if (remaining <= 0) break;
    }

    // Query-based admin views like registry status need the full result set
    // once the current-row index grows beyond Dynamo's 1 MB page size.
    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
}

export async function scanRows<T>(
  tableName: string,
  filterExpression?: string,
  expressionAttributeValues?: Record<string, unknown>,
  limit?: number
): Promise<T[]> {
  const response = await client.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: filterExpression,
    ExpressionAttributeValues: expressionAttributeValues
      ? marshall(expressionAttributeValues, { removeUndefinedValues: true })
      : undefined,
    Limit: limit,
  }));
  return (response.Items ?? []).map((item) => unmarshall(item) as T);
}

/**
 * Atomically increments a numeric field by 1 and appends a value to a string-set field.
 * Creates the row if it does not exist (using ADD/SET which are idempotent on missing items).
 * Returns the new value of the incremented field.
 */
export async function atomicIncrementAndAppend(
  tableName: string,
  key: Record<string, unknown>,
  incrementField: string,
  appendField: string,
  appendValue: string,
  extraFields: Record<string, unknown> = {},
): Promise<number> {
  const extraNames: Record<string, string> = {};
  const extraValues: Record<string, AttributeValue> = {};
  let setExpr = `#ts = if_not_exists(#ts, :zero) + :one`;
  extraNames["#ts"] = incrementField;
  extraValues[":zero"] = { N: "0" };
  extraValues[":one"] = { N: "1" };

  for (const [k, v] of Object.entries(extraFields)) {
    const nameKey = `#f_${k}`;
    const valKey = `:f_${k}`;
    extraNames[nameKey] = k;
    extraValues[valKey] = marshall({ v }, { removeUndefinedValues: true })["v"] as AttributeValue;
    setExpr += `, ${nameKey} = if_not_exists(${nameKey}, ${valKey})`;
  }

  const response = await client.send(new UpdateItemCommand({
    TableName: tableName,
    Key: marshall(key, { removeUndefinedValues: true }),
    UpdateExpression: `SET ${setExpr} ADD #app :appVal`,
    ExpressionAttributeNames: { ...extraNames, "#app": appendField },
    ExpressionAttributeValues: {
      ...extraValues,
      ":appVal": { SS: [appendValue] },
    },
    ReturnValues: "UPDATED_NEW",
  }));
  const newVal = response.Attributes?.[incrementField];
  return newVal ? Number(unmarshall({ v: newVal })["v"]) : 1;
}

/**
 * Atomically consume one slot from a numeric counter, only if the current
 * value is strictly less than the given quota. Returns `true` if the slot was
 * consumed, `false` if quota was already exhausted (ConditionalCheckFailed).
 * Also appends `appendValue` to a string-set field and sets `extraFields` on
 * first write (via if_not_exists so they don't overwrite later updates).
 */
export async function atomicConsumeIfUnderQuota(
  tableName: string,
  key: Record<string, unknown>,
  counterField: string,
  quota: number,
  appendField: string,
  appendValue: string,
  extraFields: Record<string, unknown> = {},
): Promise<boolean> {
  const extraNames: Record<string, string> = {};
  const extraValues: Record<string, AttributeValue> = {};
  let setExpr = `#ctr = if_not_exists(#ctr, :zero) + :one`;
  extraNames["#ctr"] = counterField;
  extraValues[":zero"] = { N: "0" };
  extraValues[":one"] = { N: "1" };
  extraValues[":quota"] = { N: String(quota) };

  for (const [k, v] of Object.entries(extraFields)) {
    const nameKey = `#f_${k}`;
    const valKey = `:f_${k}`;
    extraNames[nameKey] = k;
    extraValues[valKey] = marshall({ v }, { removeUndefinedValues: true })["v"] as AttributeValue;
    setExpr += `, ${nameKey} = if_not_exists(${nameKey}, ${valKey})`;
  }

  try {
    await client.send(new UpdateItemCommand({
      TableName: tableName,
      Key: marshall(key, { removeUndefinedValues: true }),
      UpdateExpression: `SET ${setExpr} ADD #app :appVal`,
      ConditionExpression: "attribute_not_exists(#ctr) OR #ctr < :quota",
      ExpressionAttributeNames: { ...extraNames, "#app": appendField },
      ExpressionAttributeValues: {
        ...extraValues,
        ":appVal": { SS: [appendValue] },
      },
    }));
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

export async function scanAllRows<T>(
  tableName: string,
  options: {
    filterExpression?: string;
    expressionAttributeValues?: Record<string, unknown>;
    expressionAttributeNames?: Record<string, string>;
  } = {},
): Promise<T[]> {
  const results: T[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const response = await client.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: options.filterExpression,
      ExpressionAttributeValues: options.expressionAttributeValues
        ? marshall(options.expressionAttributeValues, { removeUndefinedValues: true })
        : undefined,
      ExpressionAttributeNames: options.expressionAttributeNames,
      ExclusiveStartKey: lastKey,
    }));
    for (const item of response.Items ?? []) {
      results.push(unmarshall(item) as T);
    }
    lastKey = response.LastEvaluatedKey;
  } while (lastKey);
  return results;
}
