import { recordAppLog } from "../storage";
import type { AppLogEntry, AppLogLevel, Env } from "../types";
import { nowISO } from "./utils";

type StructuredLogInput = Omit<AppLogEntry, "id" | "timestamp" | "level"> & {
  level?: AppLogLevel;
  timestamp?: string;
};

function normalizeLevel(level: AppLogLevel | undefined): AppLogLevel {
  return level === "warn" || level === "error" ? level : "info";
}

function cloudWatchLevel(level: AppLogLevel): "INFO" | "WARN" | "ERROR" {
  if (level === "error") return "ERROR";
  if (level === "warn") return "WARN";
  return "INFO";
}

function writeCloudWatchLog(level: AppLogLevel, payload: Record<string, unknown>): void {
  const serialized = JSON.stringify(payload);

  // Lambda JSON logging uses the console method to set the top-level CloudWatch `level` field.
  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

export async function logAppEvent(env: Env, input: StructuredLogInput): Promise<AppLogEntry> {
  const level = normalizeLevel(input.level);
  const timestamp = input.timestamp ?? nowISO();
  const details = input.details ?? {};
  const cloudWatchPayload = {
    timestamp,
    level: cloudWatchLevel(level),
    event: input.event,
    message: input.message,
    tenantId: input.tenantId,
    route: input.route,
    company: input.company,
    source: input.source,
    runId: input.runId,
    details,
  };

  writeCloudWatchLog(level, cloudWatchPayload);

  // Persist the same business event for the browser `/api/logs` poller.
  return recordAppLog(env, {
    ...input,
    level,
    timestamp,
    details,
  });
}

export async function logErrorEvent(
  env: Env,
  input: Omit<StructuredLogInput, "level"> & { error?: unknown }
): Promise<AppLogEntry> {
  const errorDetails = input.error instanceof Error
    ? { error: input.error.message, stack: input.error.stack }
    : input.error === undefined
      ? {}
      : { error: String(input.error) };

  // Keep caller-provided details while standardizing exception fields for filtering.
  return logAppEvent(env, {
    ...input,
    level: "error",
    details: {
      ...input.details,
      ...errorDetails,
    },
  });
}
