import { createHash, randomInt } from "node:crypto";
import { PASSWORD_RESET_PREFIX } from "../constants";
import { deleteRow, getRow, putRow, stateTableName } from "../aws/dynamo";

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
};

function resetPk(email: string): string {
  return `${PASSWORD_RESET_PREFIX}${email.trim().toLowerCase()}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
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
): Promise<"ok" | "expired" | "invalid"> {
  const row = await getRow<PasswordResetRow>(stateTableName(), { pk: resetPk(email), sk: "CODE" }, true);
  if (!row || row.scope !== scope) return "invalid";
  if ((row.expiresAtEpoch ?? 0) < Math.floor(Date.now() / 1000)) {
    await clearPasswordResetCode(email);
    return "expired";
  }
  if (row.codeHash !== hashCode(code.trim())) {
    await putRow(stateTableName(), {
      ...row,
      attempts: (row.attempts ?? 0) + 1,
    } satisfies PasswordResetRow);
    return "invalid";
  }
  return "ok";
}

export async function clearPasswordResetCode(email: string): Promise<void> {
  await deleteRow(stateTableName(), { pk: resetPk(email), sk: "CODE" });
}
