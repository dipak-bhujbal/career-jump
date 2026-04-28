import {
  AttributeValue,
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
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
  const response = await client.send(new QueryCommand({
    TableName: tableName,
    IndexName: options.indexName,
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: marshall(expressionAttributeValues, { removeUndefinedValues: true }),
    ExpressionAttributeNames: expressionAttributeNames,
    Limit: options.limit,
    ScanIndexForward: options.scanIndexForward,
    ConsistentRead: options.consistentRead,
  }));
  return (response.Items ?? []).map((item) => unmarshall(item) as T);
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
