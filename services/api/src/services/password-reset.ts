import {
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { Env } from "../types";
import {
  clearPasswordResetCode,
  createResetCode,
  storePasswordResetCode,
  type PasswordResetScope,
  verifyPasswordResetCode,
} from "../storage/password-reset";

const cognito = new CognitoIdentityProviderClient({});
const ses = new SESv2Client({});

type ResetTarget = {
  email: string;
  scope: PasswordResetScope;
  userPoolId: string;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function userPoolIdForScope(scope: PasswordResetScope): string {
  return scope === "admin"
    ? (process.env.ADMIN_COGNITO_USER_POOL_ID ?? "")
    : (process.env.COGNITO_USER_POOL_ID ?? "");
}

async function lookupUserInPool(email: string, scope: PasswordResetScope): Promise<ResetTarget | null> {
  const userPoolId = userPoolIdForScope(scope);
  if (!userPoolId) return null;
  try {
    await cognito.send(new AdminGetUserCommand({
      UserPoolId: userPoolId,
      Username: email,
    }));
    return { email, scope, userPoolId };
  } catch {
    return null;
  }
}

export async function resolvePasswordResetTarget(
  email: string,
  preferredScope?: PasswordResetScope
): Promise<ResetTarget | null> {
  const normalizedEmail = normalizeEmail(email);
  if (preferredScope) {
    return lookupUserInPool(normalizedEmail, preferredScope);
  }
  return (
    await lookupUserInPool(normalizedEmail, "user")
    ?? await lookupUserInPool(normalizedEmail, "admin")
  );
}

async function sendPasswordResetEmail(env: Env, email: string, code: string, scope: PasswordResetScope): Promise<void> {
  const sender = env.SES_FROM_EMAIL || process.env.SES_FROM_EMAIL || "";
  if (!sender) throw new Error("SES_FROM_EMAIL is not configured");
  const appArea = scope === "admin" ? "admin workspace" : "account";
  await ses.send(new SendEmailCommand({
    FromEmailAddress: sender,
    Destination: { ToAddresses: [email] },
    Content: {
      Simple: {
        Subject: { Data: `Career Jump password reset code` },
        Body: {
          Text: {
            Data: [
              `Your Career Jump ${appArea} password reset code is: ${code}`,
              "",
              "This code expires in 15 minutes.",
              "If you did not request this change, you can ignore this email.",
            ].join("\n"),
          },
        },
      },
    },
  }));
}

function sanitizePasswordResetError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  // Keep the UI message generic so we do not leak SES region/account details
  // or raw provider diagnostics back to end users.
  if (
    /identity/i.test(message)
    || /not verified/i.test(message)
    || /failed the check/i.test(message)
    || /ses/i.test(message)
    || /email address is not verified/i.test(message)
  ) {
    return new Error("We could not send the reset code email right now. Please try again shortly or contact support.");
  }
  return new Error(message);
}

export async function requestPasswordReset(
  env: Env,
  email: string,
  preferredScope?: PasswordResetScope
): Promise<{ ok: true }> {
  const target = await resolvePasswordResetTarget(email, preferredScope);
  // Return success even when no account is found so we do not leak which
  // emails exist in which pool.
  if (!target) return { ok: true };
  const code = createResetCode();
  await storePasswordResetCode(target.email, target.scope, code);
  try {
    await sendPasswordResetEmail(env, target.email, code, target.scope);
  } catch (error) {
    throw sanitizePasswordResetError(error);
  }
  return { ok: true };
}

export async function confirmPasswordReset(
  _env: Env,
  email: string,
  code: string,
  newPassword: string,
  preferredScope?: PasswordResetScope
): Promise<void> {
  const target = await resolvePasswordResetTarget(email, preferredScope);
  if (!target) throw new Error("Invalid or expired reset code");
  const verification = await verifyPasswordResetCode(target.email, code, target.scope);
  if (verification === "expired") throw new Error("Reset code expired. Request a new code.");
  if (verification !== "ok") throw new Error("Invalid reset code");
  await cognito.send(new AdminSetUserPasswordCommand({
    UserPoolId: target.userPoolId,
    Username: target.email,
    Password: newPassword,
    Permanent: true,
  }));
  await clearPasswordResetCode(target.email);
}
