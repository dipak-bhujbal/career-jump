import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { tenantScopedKey } from "../lib/tenant";
import { slugify } from "../lib/utils";

export type AwsRunTriggerType = "manual" | "scheduled";

export type AwsRunMeta = {
  pk: string;
  sk: string;
  runId: string;
  triggerType: AwsRunTriggerType;
  userId?: string;
  tenantId?: string;
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  expectedCompanies: number;
  completedCompanies: number;
  failedCompanies: number;
  totalFinishedCompanies?: number;
  startedAt: string;
  updatedAt: string;
  finalizeStartedAt?: string;
  finalizedAt?: string;
};

const client = new DynamoDBClient({});

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException
    || (typeof error === "object" && error !== null && (error as Error).name === "ConditionalCheckFailedException");
}

function tableName(): string {
  const value = process.env.AWS_STATE_TABLE;
  if (!value) throw new Error("AWS_STATE_TABLE is not configured");
  return value;
}

function metaKey(runId: string) {
  return {
    pk: `RUN#${runId}`,
    sk: "META",
  };
}

export function companyResultKey(runId: string, company: string): string {
  return tenantScopedKey(undefined, `aws:run:${runId}:company:${company.toLowerCase()}`);
}

export function companyResultPrefix(runId: string): string {
  return tenantScopedKey(undefined, `aws:run:${runId}:company:`);
}

export function failedCompanyResultKey(runId: string, company: string): string {
  return tenantScopedKey(undefined, `${companyResultPrefix(runId)}__failed__${slugify(company)}`);
}

export async function createRunMeta(input: {
  runId: string;
  triggerType: AwsRunTriggerType;
  expectedCompanies: number;
  userId?: string;
  tenantId?: string;
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
}): Promise<void> {
  const now = new Date().toISOString();
  await client.send(new PutItemCommand({
    TableName: tableName(),
    Item: marshall({
      ...metaKey(input.runId),
      runId: input.runId,
      triggerType: input.triggerType,
      userId: input.userId,
      tenantId: input.tenantId,
      email: input.email,
      displayName: input.displayName,
      isAdmin: input.isAdmin === true,
      expectedCompanies: input.expectedCompanies,
      completedCompanies: 0,
      failedCompanies: 0,
      totalFinishedCompanies: 0,
      startedAt: now,
      updatedAt: now,
    }),
    ConditionExpression: "attribute_not_exists(pk)",
  }));
}

export async function getRunMeta(runId: string): Promise<AwsRunMeta | null> {
  const response = await client.send(new GetItemCommand({
    TableName: tableName(),
    Key: marshall(metaKey(runId)),
  }));
  return response.Item ? (unmarshall(response.Item) as AwsRunMeta) : null;
}

export async function markCompanyFinished(input: {
  runId: string;
  failed: boolean;
}): Promise<{ meta: AwsRunMeta; shouldStartFinalize: boolean }> {
  const counterName = input.failed ? "failedCompanies" : "completedCompanies";
  let response;
  try {
    response = await client.send(new UpdateItemCommand({
      TableName: tableName(),
      Key: marshall(metaKey(input.runId)),
      UpdateExpression: "ADD #counter :one, totalFinishedCompanies :one SET updatedAt = :updatedAt",
      ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(finalizeStartedAt) AND (attribute_not_exists(totalFinishedCompanies) OR totalFinishedCompanies < expectedCompanies)",
      ExpressionAttributeNames: {
        "#counter": counterName,
      },
      ExpressionAttributeValues: marshall({
        ":one": 1,
        ":updatedAt": new Date().toISOString(),
      }),
      ReturnValues: "ALL_NEW",
    }));
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
    const meta = await getRunMeta(input.runId);
    if (!meta) throw new Error(`Run ${input.runId} was not found`);
    return { meta, shouldStartFinalize: false };
  }
  if (!response.Attributes) throw new Error(`Run ${input.runId} was not found`);
  const meta = unmarshall(response.Attributes) as AwsRunMeta;
  const totalFinished = meta.totalFinishedCompanies ?? (meta.completedCompanies + meta.failedCompanies);
  return { meta, shouldStartFinalize: totalFinished === meta.expectedCompanies };
}

export function isRunReadyToFinalize(meta: AwsRunMeta): boolean {
  return meta.completedCompanies + meta.failedCompanies >= meta.expectedCompanies;
}

export async function tryStartFinalize(runId: string, meta?: AwsRunMeta): Promise<boolean> {
  const currentMeta = meta ?? await getRunMeta(runId);
  if (!currentMeta || !isRunReadyToFinalize(currentMeta) || currentMeta.finalizeStartedAt) return false;
  try {
    await client.send(new UpdateItemCommand({
      TableName: tableName(),
      Key: marshall(metaKey(runId)),
      UpdateExpression: "SET finalizeStartedAt = :now, updatedAt = :now",
      ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(finalizeStartedAt) AND (totalFinishedCompanies >= expectedCompanies OR completedCompanies >= expectedCompanies OR failedCompanies >= expectedCompanies)",
      ExpressionAttributeValues: marshall({
        ":now": new Date().toISOString(),
      }),
    }));
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    throw error;
  }
}

export async function markFinalized(runId: string): Promise<void> {
  const now = new Date().toISOString();
  await client.send(new UpdateItemCommand({
    TableName: tableName(),
    Key: marshall(metaKey(runId)),
    UpdateExpression: "SET finalizedAt = :now, updatedAt = :now",
    ExpressionAttributeValues: marshall({ ":now": now }),
  }));
}
