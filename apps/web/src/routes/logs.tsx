import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, ChevronDown, X } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select } from "@/components/ui/select";
import { useLogsQuery, type LogsFilter, type LogLevel, type LogEntry } from "@/features/logs/queries";
import { useMe } from "@/features/session/queries";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/logs")({ component: LogsRoute });

function levelVariant(level: LogLevel) {
  if (level === "error") return "danger";
  if (level === "warn") return "warning";
  return "secondary";
}

/** Format vanilla runId: "manual-{epochMs}-{rand6}" → "manual · rand6 · Apr 26 08:00" */
function shortRunId(runId: string): string {
  const m = runId.match(/^(manual|scheduled)-(\d+)-([a-z0-9]+)$/);
  if (!m) return runId;
  const ts = new Date(Number(m[2]));
  const datePart = ts.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timePart = ts.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${m[1]} · ${m[3]} · ${datePart} ${timePart}`;
}

function LogRow({ log, onFilterRunId, runIdFiltered }: {
  log: LogEntry;
  onFilterRunId: (runId: string) => void;
  runIdFiltered: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = log.type === "company_scan_done" || log.durationMs != null || log.source || log.runId;
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="px-5 py-3 text-sm hover:bg-[hsl(var(--accent))]/40">
      <div className="flex items-start gap-2">
        {/* Expand arrow — always reserve space, only interactive when there's detail */}
        <button
          type="button"
          onClick={() => hasDetail && setExpanded((v) => !v)}
          className={`mt-0.5 shrink-0 transition-colors ${hasDetail ? "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] cursor-pointer" : "text-transparent cursor-default"}`}
          aria-label={expanded ? "Collapse" : "Expand"}
          tabIndex={hasDetail ? 0 : -1}
        >
          <ChevronIcon size={13} />
        </button>

        <span className="text-[hsl(var(--muted-foreground))] tabular-nums shrink-0 w-16 text-xs mt-0.5">
          {relativeTime(log.timestamp)}
        </span>

        <Badge variant={levelVariant(log.level)} className="shrink-0 mt-0.5">
          {log.level}
        </Badge>

        <span className="text-[hsl(var(--muted-foreground))] shrink-0 text-xs mt-0.5 font-mono w-44 truncate" title={log.type ?? log.event}>
          {log.type ?? log.event}
        </span>

        <span className="flex-1 min-w-0 break-words">{log.message}</span>

        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {log.runId && !runIdFiltered && (
            <button
              type="button"
              title={`Filter to run ${log.runId}`}
              onClick={() => log.runId && onFilterRunId(log.runId)}
              className="inline-flex items-center rounded border border-[hsl(var(--border))] px-1.5 py-0.5 text-[11px] font-mono text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--foreground))] transition-colors"
            >
              {shortRunId(log.runId)}
            </button>
          )}
          {log.company && (
            <span className="inline-flex items-center rounded-full bg-[hsl(var(--secondary))] px-2 py-0.5 text-xs">
              {log.company}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && hasDetail && (
        <div className="mt-2 ml-[calc(13px+theme(spacing.2)+4rem+theme(spacing.2)+theme(spacing.14)+theme(spacing.2))] space-y-1.5 text-xs font-mono text-[hsl(var(--muted-foreground))]">
          {log.runId && (
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0">runId</span>
              <span className="text-[hsl(var(--foreground))] break-all">{log.runId}</span>
            </div>
          )}
          {log.source && (
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0">source</span>
              <span className="text-[hsl(var(--foreground))]">{log.source}</span>
            </div>
          )}
          {log.durationMs != null && (
            <div className="flex items-center gap-2">
              <span className="w-20 shrink-0">duration</span>
              <span className="text-[hsl(var(--foreground))]">{(log.durationMs / 1000).toFixed(2)}s</span>
            </div>
          )}
          {log.type === "company_scan_done" && log.fetched != null && (
            <div className="flex items-center gap-4 flex-wrap">
              <span>fetched <strong className="text-[hsl(var(--foreground))]">{log.fetched}</strong></span>
              <span>matched <strong className="text-[hsl(var(--foreground))]">{log.matched}</strong></span>
              <span className="text-green-600 dark:text-green-400">+{log.new} new</span>
              {(log.updated ?? 0) > 0 && <span className="text-blue-600 dark:text-blue-400">~{log.updated} updated</span>}
              {(log.discarded ?? 0) > 0 && <span>−{log.discarded} discarded</span>}
            </div>
          )}
          <div className="flex items-center gap-2 text-[10px] text-[hsl(var(--muted-foreground))]/60">
            <span className="w-20 shrink-0">timestamp</span>
            <span>{log.timestamp}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function LogsRoute() {
  const { data: me } = useMe();
  const [filter, setFilter] = useState<LogsFilter>({
    q: "",
    tenantId: "",
    reason: "",
    level: "",
    type: "",
    runId: "",
    companies: [],
    limit: 200,
  });

  const { data, isLoading } = useLogsQuery(filter);

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const retentionHours = data?.retentionHours ?? 6;
  const companyOptions = data?.companyOptions ?? [];
  const runOptions = data?.runOptions ?? [];

  const DEFAULT_FILTER: LogsFilter = { q: "", tenantId: "", reason: "", level: "", type: "", runId: "", companies: [], limit: 200 };
  const hasActiveFilter = Boolean(filter.q || filter.tenantId || filter.reason || filter.level || filter.type || filter.runId || (filter.companies?.length ?? 0) > 0);
  const breakGlassReady = Boolean(filter.tenantId?.trim()) && Boolean(filter.reason?.trim());

  function clearAll() { setFilter(DEFAULT_FILTER); }

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Logs" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">
          Logs are restricted to admins because they can contain operational and user-linked diagnostic data.
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Scan Logs" />
      <div className="p-6 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Break-Glass Customer Logs</CardTitle>
            <CardDescription>
              Admin log access is limited to one customer at a time and requires a justification. Broad cross-customer browsing is intentionally blocked.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            {/* Row 1: search + run ID + event type */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Search</label>
                <Input
                  value={filter.q ?? ""}
                  onChange={(e) => setFilter((f: LogsFilter) => ({ ...f, q: e.target.value }))}
                  placeholder="message, event, company…"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">User / Tenant</label>
                <Input
                  value={filter.tenantId ?? ""}
                  onChange={(e) => setFilter((f: LogsFilter) => ({ ...f, tenantId: e.target.value }))}
                  placeholder="user ID or tenant ID"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Justification</label>
                <Input
                  value={filter.reason ?? ""}
                  onChange={(e) => setFilter((f: LogsFilter) => ({ ...f, reason: e.target.value }))}
                  placeholder="Why are you opening this customer log view?"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Run ID</label>
                <div className="flex items-center gap-1">
                  <Select
                    value={filter.runId ?? ""}
                    onChange={(e) => setFilter((f: LogsFilter) => ({ ...f, runId: e.target.value }))}
                    className="flex-1"
                  >
                    <option value="">All runs</option>
                    {runOptions.map((rid) => (
                      <option key={rid} value={rid}>{shortRunId(rid)}</option>
                    ))}
                  </Select>
                  {filter.runId && (
                    <button
                      type="button"
                      title="Clear run filter"
                      onClick={() => setFilter((f: LogsFilter) => ({ ...f, runId: "" }))}
                      className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Event Type</label>
                <div className="flex items-center gap-1">
                  <Select
                    value={filter.type ?? ""}
                    onChange={(e) => setFilter((f: LogsFilter) => ({ ...f, type: e.target.value }))}
                    className="flex-1"
                  >
                    <option value="">All types</option>
                    <option value="run_started">run_started</option>
                    <option value="company_scan_start">company_scan_start</option>
                    <option value="company_scan_done">company_scan_done</option>
                    <option value="company_scan_error">company_scan_error</option>
                    <option value="run_completed">run_completed</option>
                    <option value="email_sent">email_sent</option>
                  </Select>
                  {filter.type && (
                    <button
                      type="button"
                      title="Clear event type filter"
                      onClick={() => setFilter((f: LogsFilter) => ({ ...f, type: "" }))}
                      className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            {!breakGlassReady && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                Enter a customer `userId` or `tenantId` and a short reason to unlock this log view.
              </div>
            )}
            {/* Row 2: level + companies + limit + clear all */}
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Level</label>
                <div className="flex items-center gap-1">
                  <Select
                    value={filter.level ?? ""}
                    onChange={(e) => setFilter((f: LogsFilter) => ({ ...f, level: e.target.value }))}
                    className="flex-1"
                  >
                    <option value="">All levels</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                  </Select>
                  {filter.level && (
                    <button
                      type="button"
                      title="Clear level filter"
                      onClick={() => setFilter((f: LogsFilter) => ({ ...f, level: "" }))}
                      className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--accent))] transition-colors"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 lg:col-span-2">
                <label className="text-sm font-medium">Companies</label>
                <MultiSelect
                  options={companyOptions}
                  value={filter.companies ?? []}
                  onChange={(next) => setFilter((f: LogsFilter) => ({ ...f, companies: next }))}
                  placeholder="All companies"
                  noun="companies"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Limit</label>
                <Select
                  value={String(filter.limit ?? 200)}
                  onChange={(e) => setFilter((f: LogsFilter) => ({ ...f, limit: Number(e.target.value) }))}
                >
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="500">500</option>
                </Select>
              </div>
            </div>
            {/* Active filters summary + clear all */}
            {hasActiveFilter && (
              <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-[hsl(var(--border))]">
                <span className="text-xs text-[hsl(var(--muted-foreground))]">Active:</span>
                {filter.runId && (
                  <span className="inline-flex items-center gap-1 text-xs rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1">
                    Run: {shortRunId(filter.runId)}
                    <button type="button" onClick={() => setFilter((f: LogsFilter) => ({ ...f, runId: "" }))} className="hover:text-[hsl(var(--foreground))] ml-0.5"><X size={11} /></button>
                  </span>
                )}
                {filter.type && (
                  <span className="inline-flex items-center gap-1 text-xs rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1">
                    Type: {filter.type}
                    <button type="button" onClick={() => setFilter((f: LogsFilter) => ({ ...f, type: "" }))} className="hover:text-[hsl(var(--foreground))] ml-0.5"><X size={11} /></button>
                  </span>
                )}
                {filter.level && (
                  <span className="inline-flex items-center gap-1 text-xs rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1">
                    Level: {filter.level}
                    <button type="button" onClick={() => setFilter((f: LogsFilter) => ({ ...f, level: "" }))} className="hover:text-[hsl(var(--foreground))] ml-0.5"><X size={11} /></button>
                  </span>
                )}
                {filter.q && (
                  <span className="inline-flex items-center gap-1 text-xs rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1">
                    Search: "{filter.q}"
                    <button type="button" onClick={() => setFilter((f: LogsFilter) => ({ ...f, q: "" }))} className="hover:text-[hsl(var(--foreground))] ml-0.5"><X size={11} /></button>
                  </span>
                )}
                {(filter.companies?.length ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1">
                    {filter.companies!.length} {filter.companies!.length === 1 ? "company" : "companies"}
                    <button type="button" onClick={() => setFilter((f: LogsFilter) => ({ ...f, companies: [] }))} className="hover:text-[hsl(var(--foreground))] ml-0.5"><X size={11} /></button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearAll}
                  className="ml-auto text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] flex items-center gap-1 underline underline-offset-2"
                >
                  Clear all
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="border-b border-[hsl(var(--border))] flex-row items-center justify-between">
            <div>
              <CardTitle>Log entries</CardTitle>
              <CardDescription>
                Last {retentionHours}h of scan activity · click ▶ on any row for details
              </CardDescription>
            </div>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{total.toLocaleString()} entries</p>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="divide-y divide-[hsl(var(--border))]">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3 animate-pulse">
                    <div className="h-4 w-4 rounded bg-[hsl(var(--muted))]" />
                    <div className="h-4 w-16 rounded bg-[hsl(var(--muted))]" />
                    <div className="h-4 w-20 rounded bg-[hsl(var(--muted))]" />
                    <div className="h-4 flex-1 rounded bg-[hsl(var(--muted))]" />
                  </div>
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[hsl(var(--muted-foreground))] text-sm">No log entries match the current filters.</p>
              </div>
            ) : (
              <div className="divide-y divide-[hsl(var(--border))]">
                {logs.map((log: LogEntry, i: number) => (
                  <LogRow
                    key={`${log.runId ?? ""}-${log.timestamp}-${i}`}
                    log={log}
                    onFilterRunId={(rid) => setFilter((f: LogsFilter) => ({ ...f, runId: rid }))}
                    runIdFiltered={Boolean(filter.runId)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
