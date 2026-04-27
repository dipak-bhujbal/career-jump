import type { Env } from "../types";

type AnalyticsPayload = {
  event: string;
  indexes?: Array<string | null | undefined>;
  blobs?: Array<string | null | undefined>;
  doubles?: number[];
};

function safeString(value: unknown): string {
  return String(value ?? "").slice(0, 255);
}

export function writeAnalytics(env: Env, payload: AnalyticsPayload): void {
  try {
    env.ANALYTICS_ENGINE?.writeDataPoint({
      indexes: [safeString(payload.event), ...(payload.indexes ?? []).map((value) => value == null ? null : safeString(value))],
      blobs: (payload.blobs ?? []).map((value) => value == null ? null : safeString(value)),
      doubles: payload.doubles ?? [],
    });
  } catch (error) {
    console.warn("[analytics] write failed", error instanceof Error ? error.message : String(error));
  }
}

export function trackRequestAnalytics(
  env: Env,
  request: Request,
  response: Response,
  startedAt: number
): void {
  const url = new URL(request.url);
  writeAnalytics(env, {
    event: "request_completed",
    indexes: [request.method, url.pathname],
    blobs: [url.hostname, response.statusText || ""],
    doubles: [response.status, Date.now() - startedAt],
  });
}
