import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  type?: string;
  event: string;
  message: string;
  level: LogLevel;
  tenantId?: string;
  source?: string;
  company?: string;
  route?: string;
  runId?: string;
  timestamp: string;
  fetched?: number;
  matched?: number;
  new?: number;
  updated?: number;
  discarded?: number;
  durationMs?: number;
};

export type LogsEnvelope = {
  ok: boolean;
  logs: LogEntry[];
  total: number;
  retentionHours: number;
  companyOptions: string[];
  runOptions: string[];
};

export type LogsFilter = {
  q?: string;
  tenantId?: string;
  reason?: string;
  level?: string;
  type?: string;
  runId?: string;
  companies?: string[];
  limit?: number;
};

function buildLogsParams(filter: LogsFilter): string {
  const p = new URLSearchParams();
  if (filter.q) p.set("q", filter.q);
  if (filter.tenantId) p.set("tenantId", filter.tenantId);
  if (filter.reason) p.set("reason", filter.reason);
  if (filter.level) p.set("level", filter.level);
  if (filter.type) p.set("type", filter.type);
  if (filter.runId) p.set("runId", filter.runId);
  for (const c of filter.companies ?? []) if (c) p.append("company", c);
  if (filter.limit) p.set("limit", String(filter.limit));
  p.set("compact", "false");
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

export const logsKey = (f: LogsFilter) => ["logs", f] as const;

export function useLogsQuery(filter: LogsFilter) {
  return useQuery({
    queryKey: logsKey(filter),
    queryFn: () => api.get<LogsEnvelope>(`/api/logs${buildLogsParams(filter)}`),
    enabled: Boolean(filter.tenantId?.trim()) && Boolean(filter.reason?.trim()),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}
