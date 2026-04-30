import { createHash, randomInt } from "node:crypto";
import { ConditionalCheckFailedException, stateTableName } from "../aws/dynamo";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { PASSWORD_RESET_PREFIX } from "../constants";
import { deleteRow, getRow, putRow } from "../aws/dynamo";

export type PasswordResetScope = "user" | "admin";

type PasswordResetRow = {
  pk: string;
  sk: "CODE";
  email: string;
  scope: PasswordResetScope;
  codeHash: string;
  expiresAt: string;
  expiresAtEpoch: number;
  attempts: number;
  createdAt: string;
  usedAt?: string;
};

type PasswordResetThrottleRow = {
  pk: string;
  sk: string;
  attempts: number;
  createdAt: string;
  expiresAtEpoch: number;
};

const MAX_PASSWORD_RESET_ATTEMPTS = 5;
const MAX_PASSWORD_RESET_CONFIRM_ATTEMPTS_PER_MINUTE = 10;
const client = new DynamoDBClient({});

function resetPk(email: string): string {
  return `${PASSWORD_RESET_PREFIX}${email.trim().toLowerCase()}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function confirmThrottleKey(email: string, scope: PasswordResetScope, ipAddress: string): { pk: string; sk: string } {
  const safeIp = ipAddress.trim() || "unknown-ip";
  const minuteBucket = Math.floor(Date.now() / 60_000);
  return {
    pk: `${resetPk(email)}#THROTTLE#${scope}`,
    sk: `CONFIRM#${safeIp}#${minuteBucket}`,
  };
}

export function createResetCode(): string {
  // Six-digit numeric codes keep the UI familiar and easy to type on mobile.
  return String(randomInt(100000, 1000000));
}

export async function storePasswordResetCode(email: string, scope: PasswordResetScope, code: string): Promise<void> {
  const createdAt = new Date().toISOString();
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + (15 * 60);
  await putRow(stateTableName(), {
    pk: resetPk(email),
    sk: "CODE",
    email: email.trim().toLowerCase(),
    scope,
    codeHash: hashCode(code),
    expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
    expiresAtEpoch,
    attempts: 0,
    createdAt,
  } satisfies PasswordResetRow);
}

export async function verifyPasswordResetCode(
  email: string,
  code: string,
  scope: PasswordResetScope
): Promise<"ok" | "expired" | "invalid" | "locked"> {
  const row = await getRow<PasswordResetRow>(stateTableName(), { pk: resetPk(email), sk: "CODE" }, true);
  if (!row || row.scope !== scope) return "invalid";
  if ((row.expiresAtEpoch ?? 0) < Math.floor(Date.now() / 1000)) {
    await clearPasswordResetCode(email);
    return "expired";
  }
  if (row.usedAt) return "invalid";
  if ((row.attempts ?? 0) >= MAX_PASSWORD_RESET_ATTEMPTS) {
    await clearPasswordResetCode(email);
    return "locked";
  }
  if (row.codeHash !== hashCode(code.trim())) {
    const nextAttempts = (row.attempts ?? 0) + 1;
    await putRow(stateTableName(), {
      ...row,
      attempts: nextAttempts,
    } satisfies PasswordResetRow);
    if (nextAttempts >= MAX_PASSWORD_RESET_ATTEMPTS) {
      await clearPasswordResetCode(email);
      return "locked";
    }
    return "invalid";
  }
  return "ok";
}

export async function consumePasswordResetCode(
  email: string,
  code: string,
  scope: PasswordResetScope
): Promise<"ok" | "expired" | "invalid" | "locked"> {
  const verification = await verifyPasswordResetCode(email, code, scope);
  if (verification !== "ok") return verification;

  try {
    // Claim the reset code before calling Cognito so concurrent confirm
    // attempts cannot both spend the same code.
    await client.send(new UpdateItemCommand({
      TableName: stateTableName(),
      Key: marshall({ pk: resetPk(email), sk: "CODE" }),
      UpdateExpression: "SET usedAt = :usedAt",
      ConditionExpression: "attribute_exists(pk) AND attribute_not_exists(usedAt) AND codeHash = :codeHash AND #scope = :scope AND expiresAtEpoch >= :nowEpoch AND (attribute_not_exists(attempts) OR attempts < :maxAttempts)",
      ExpressionAttributeNames: {
        "#scope": "scope",
      },
      ExpressionAttributeValues: marshall({
        ":usedAt": new Date().toISOString(),
        ":codeHash": hashCode(code.trim()),
        ":scope": scope,
        ":nowEpoch": Math.floor(Date.now() / 1000),
        ":maxAttempts": MAX_PASSWORD_RESET_ATTEMPTS,
      }),
    }));
    return "ok";
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    // Re-read the row so the caller gets a stable user-facing answer when the
    // first verification succeeded but a concurrent request consumed the code.
    return verifyPasswordResetCode(email, code, scope);
  }
}

export async function recordPasswordResetConfirmAttempt(
  email: string,
  scope: PasswordResetScope,
  ipAddress: string,
): Promise<boolean> {
  const key = confirmThrottleKey(email, scope, ipAddress);
  const now = new Date().toISOString();
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + (5 * 60);
  const response = await client.send(new UpdateItemCommand({
    TableName: stateTableName(),
    Key: marshall(key),
    UpdateExpression: "ADD attempts :one SET createdAt = if_not_exists(createdAt, :createdAt), expiresAtEpoch = if_not_exists(expiresAtEpoch, :expiresAtEpoch)",
    ExpressionAttributeValues: marshall({
      ":one": 1,
      ":createdAt": now,
      ":expiresAtEpoch": expiresAtEpoch,
    }),
    ReturnValues: "ALL_NEW",
  }));

  const row = response.Attributes ? (unmarshall(response.Attributes) as PasswordResetThrottleRow) : null;
  return (row?.attempts ?? 0) <= MAX_PASSWORD_RESET_CONFIRM_ATTEMPTS_PER_MINUTE;
}

export async function clearPasswordResetCode(email: string): Promise<void> {
  await deleteRow(stateTableName(), { pk: resetPk(email), sk: "CODE" });
}
