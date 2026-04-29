/**
 * Tiny fetch-interceptor that serves seed data for the demo build.
 *
 * Enabled only on localhost when `VITE_USE_MOCKS=true` or `?demo=1`.
 * Wraps `window.fetch` and intercepts our app's API calls; everything
 * else passes through unchanged. No service worker needed.
 *
 * Mutations (apply / discard / status / save / etc.) update an
 * in-memory copy of the seed so the UI feels live: drag a card across
 * the kanban and the new column sticks; click Apply on a job and it
 * disappears from Available and shows up in Applied.
 */
import {
  buildAppliedJobs, buildConfig, buildDashboard,
  buildJobs, buildRegistryEntries, buildRegistryMeta,
} from "./data";
import type { AppliedJob, Job, RuntimeConfig } from "@/lib/api";
import { isInterestingTitle, enrichJob, shouldKeepJobForUSInventory } from "@/lib/job-filters";
import { envValue, isLocalDevHost } from "@/lib/runtime-config";
import { companyKey } from "@/lib/utils";

interface SavedFilter {
  id: string;
  name: string;
  scope: "available_jobs" | "applied_jobs" | "dashboard" | "logs";
  filter: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MockState {
  jobs: Job[];
  applied: AppliedJob[];
  config: RuntimeConfig;
  scanOverrides: Record<string, { company: string; paused: boolean; updatedAt: string }>;
  runActive: boolean;
  runId: string | null;
  runStartedAt: number;    // epoch ms — progress derived from elapsed time, not poll count
  runTotal: number;
  runCompanies: string[];  // only the non-paused companies for this run
  liveScansUsed: number;
  emailWebhook: { webhookUrl: string | null; sharedSecretConfigured: boolean };
  savedFilters: SavedFilter[];
}

let state: MockState | null = null;

function ensureState(): MockState {
  if (state) return state;
  state = {
    jobs: buildJobs(),
    applied: buildAppliedJobs(),
    config: buildConfig(),
    scanOverrides: {},
    runActive: false,
    runId: null,
    runStartedAt: 0,
    runTotal: 0,
    runCompanies: [],
    liveScansUsed: 0,
    emailWebhook: { webhookUrl: null, sharedSecretConfigured: false },
    savedFilters: [],
  };
  return state;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readBody<T = Record<string, unknown>>(init?: RequestInit): Promise<T> {
  if (!init?.body) return {} as T;
  if (typeof init.body === "string") {
    try { return JSON.parse(init.body) as T; } catch { return {} as T; }
  }
  return {} as T;
}

async function handle(url: URL, init?: RequestInit): Promise<Response | null> {
  const s = ensureState();
  const path = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();

  // -- Reads ------------------------------------------------------------
  if (method === "GET" && path === "/api/dashboard") return json(buildDashboard());
  if (method === "GET" && path === "/api/registry/meta") return json(buildRegistryMeta());

  if (method === "GET" && path === "/api/registry/companies") {
    const search = url.searchParams.get("search") ?? "";
    const ats = url.searchParams.get("ats") ?? "";
    const tier = url.searchParams.get("tier") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "50");
    const entries = buildRegistryEntries(search, ats, tier);
    return json({ ok: true, total: entries.length, entries: entries.slice(0, limit) });
  }

  if (method === "GET" && path.startsWith("/api/registry/companies/")) {
    const name = decodeURIComponent(path.slice("/api/registry/companies/".length));
    const entry = buildRegistryEntries(name).find((e) => e.company.toLowerCase() === name.toLowerCase());
    if (!entry) return json({ ok: false, error: "Not found" }, 404);
    return json({ ok: true, entry });
  }

  if (method === "GET" && path === "/api/jobs") {
    const newOnly = url.searchParams.get("newOnly") === "true";
    const updatedOnly = url.searchParams.get("updatedOnly") === "true";
    const usOnly = url.searchParams.get("usOnly") === "true";
    const keyword = (url.searchParams.get("keyword") ?? "").toLowerCase();
    const location = (url.searchParams.get("location") ?? "").toLowerCase();
    const source = (url.searchParams.get("source") ?? "").toLowerCase();
    const companies = url.searchParams.getAll("company");
    const duration = url.searchParams.get("duration") ?? "";
    const jobtitles = s.config.jobtitles ?? { includeKeywords: [], excludeKeywords: [] };

    // Resolve duration to max-age in milliseconds (same shorthand map as vanilla).
    const DURATION_HOURS: Record<string, number> = {
      "1h": 1, "3h": 3, "1d": 24, "3d": 72, "1w": 168, "2w": 336, "1m": 720, "2m": 1440, "3m": 2160,
    };
    const maxAgeMs = duration && DURATION_HOURS[duration] ? DURATION_HOURS[duration] * 3_600_000 : null;
    const now = Date.now();

    let list = s.jobs
      .filter((j) => !s.applied.some((a) => a.jobKey === j.jobKey))
      .map((j) => {
        const jobForEnrich = { title: j.jobTitle, location: j.location ?? "", url: j.url, company: j.company };
        const enriched = enrichJob(jobForEnrich, jobtitles);
        return { ...j, matchedKeywords: enriched.matchedKeywords, isUSLikely: enriched.isUSLikely, detectedCountry: enriched.detectedCountry };
      })
      .filter((j) => jobtitles.includeKeywords.length === 0 || isInterestingTitle(j.jobTitle, jobtitles))
      .filter((j) => shouldKeepJobForUSInventory(j.location ?? "", j.jobTitle, j.url));

    if (newOnly) list = list.filter((j) => j.isNew);
    if (updatedOnly) list = list.filter((j) => j.isUpdated);
    if (usOnly) list = list.filter((j) => j.usLikely !== false);
    if (source) list = list.filter((j) => j.source.toLowerCase() === source);
    if (keyword) list = list.filter((j) => j.jobTitle.toLowerCase().includes(keyword) || j.company.toLowerCase().includes(keyword));
    if (location) list = list.filter((j) => (j.location ?? "").toLowerCase().includes(location));
    if (companies.length > 0) list = list.filter((j) => companies.includes(j.company));
    if (maxAgeMs !== null) {
      list = list.filter((j) => {
        if (!j.postedAt) return false;
        const ageMs = now - new Date(j.postedAt).getTime();
        return ageMs >= 0 && ageMs <= maxAgeMs;
      });
    }

    const totals = {
      availableJobs: s.jobs.filter((j) => !s.applied.some((a) => a.jobKey === j.jobKey)).length,
      newJobs: s.jobs.filter((j) => j.isNew).length,
      updatedJobs: s.jobs.filter((j) => j.isUpdated).length,
    };
    const companyOptions = Array.from(new Set(s.jobs.map((j) => j.company))).sort();
    return json({
      ok: true,
      runAt: new Date().toISOString(),
      total: list.length,
      pagination: { offset: 0, limit: 100, nextOffset: list.length, hasMore: false },
      totals,
      companyOptions,
      jobs: list,
    });
  }

  if (method === "GET" && path === "/api/applied-jobs") {
    const companies = url.searchParams.getAll("company").map((c) => c.toLowerCase());
    const statuses = url.searchParams.getAll("status").map((s) => s.toLowerCase());
    const keyword = (url.searchParams.get("keyword") ?? "").trim().toLowerCase();
    const appliedFrom = url.searchParams.get("appliedFrom");
    const appliedTo = url.searchParams.get("appliedTo");
    const fromMs = appliedFrom ? new Date(appliedFrom).getTime() : null;
    const toMs = appliedTo ? new Date(appliedTo).getTime() + 86_399_999 : null;
    let list = s.applied;
    if (companies.length) list = list.filter((a) => companies.includes(a.job.company.toLowerCase()));
    if (statuses.length) list = list.filter((a) => statuses.includes(a.status.toLowerCase()));
    if (keyword) list = list.filter((a) => a.job.jobTitle.toLowerCase().includes(keyword) || a.job.company.toLowerCase().includes(keyword));
    if (fromMs !== null) list = list.filter((a) => new Date(a.appliedAt).getTime() >= fromMs);
    if (toMs !== null) list = list.filter((a) => new Date(a.appliedAt).getTime() <= toMs);
    const companyOptions = Array.from(new Set(s.applied.map((a) => a.job.company))).sort();
    return json({ ok: true, jobs: list, companyOptions });
  }

  if (method === "GET" && path === "/api/action-plan") {
    // Derive the action plan from the live in-memory `applied` list so
    // round add/edit/delete mutations are reflected immediately.
    const planJobs = s.applied
      .filter((j) => j.status === "Interview" || j.status === "Negotiations")
      .map((j) => ({
        jobKey: j.jobKey,
        company: j.job.company,
        jobTitle: j.job.jobTitle,
        notes: j.notes ?? "",
        noteRecords: j.noteRecords ?? [],
        appliedAt: j.appliedAt,
        appliedAtDate: j.appliedAt.slice(0, 10),
        interviewAt: j.interviewRounds?.[j.interviewRounds.length - 1]?.scheduledAt ?? null,
        interviewAtDate: j.interviewRounds?.[j.interviewRounds.length - 1]?.scheduledAt?.slice(0, 10) ?? null,
        outcome: j.interviewRounds?.[j.interviewRounds.length - 1]?.outcome ?? "Pending",
        currentRoundId: j.interviewRounds?.[j.interviewRounds.length - 1]?.id ?? "",
        currentRoundNumber: j.interviewRounds?.length ?? 0,
        interviewRounds: j.interviewRounds,
        timeline: j.timeline,
        url: j.job.url,
        location: j.job.location,
        source: j.job.source,
        postedAt: j.job.postedAt,
      }));
    return json({ ok: true, jobs: planJobs });
  }

  if (method === "GET" && path === "/api/config") {
    return json({ ok: true, config: s.config, companyScanOverrides: s.scanOverrides });
  }

  if (method === "GET" && path === "/api/run/status") {
    if (!s.runActive) return json({ ok: true, active: false });
    // Derive progress from wall-clock time so even a 1-company run shows the bar.
    // Each company takes ~3 s to scan in the mock; minimum visible duration = 3 s.
    const MS_PER_COMPANY = 3_000;
    const elapsed = Date.now() - s.runStartedAt;
    const fetched = Math.min(s.runTotal, Math.floor(elapsed / MS_PER_COMPANY));
    if (fetched >= s.runTotal) {
      s.runActive = false;
      return json({ ok: true, active: false });
    }
    return json({
      ok: true,
      active: true,
      runId: s.runId ?? "manual-demo",
      triggerType: "manual",
      startedAt: new Date(s.runStartedAt).toISOString(),
      totalCompanies: s.runTotal,
      fetchedCompanies: fetched,
      currentCompany: s.runCompanies[fetched] ?? "",
      detail: `Scanning ${s.runCompanies[fetched] ?? "…"}`,
      percent: s.runTotal === 0 ? 0 : fetched / s.runTotal,
    });
  }

  if (method === "GET" && path === "/api/scan-quota") {
    const DAILY_LIVE_SCANS = 2;
    return json({
      ok: true,
      liveScansUsed: s.liveScansUsed,
      remainingLiveScansToday: Math.max(0, DAILY_LIVE_SCANS - s.liveScansUsed),
      lastLiveScanAt: s.liveScansUsed > 0 ? new Date(s.runStartedAt || Date.now()).toISOString() : null,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  if (method === "GET" && path === "/api/settings/email-webhook") {
    return json({ ok: true, ...s.emailWebhook });
  }

  if (method === "GET" && path === "/api/logs") {
    const level = url.searchParams.get("level") ?? "";
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const companies = url.searchParams.getAll("company");
    const limit = Number(url.searchParams.get("limit") ?? "200");
    const typeFilter = url.searchParams.get("type") ?? "";
    const runIdFilter = url.searchParams.get("runId") ?? "";
    const compact = url.searchParams.get("compact") !== "false";

    const NOW_MS = Date.now();
    const HOUR_MS = 60 * 60 * 1000;

    // Seed data matching vanilla's DynamoDB app-log schema (observability-and-logging.md)
    // runId format matches vanilla: manual-{epochMs}-{random6}
    // Use a stable seed per calendar day so IDs are consistent within a session
    // but look realistic (different timestamps per run).
    const dayMs = Math.floor(NOW_MS / 86_400_000) * 86_400_000;
    function stableRandom(salt: number) {
      const x = Math.sin(dayMs / 1e9 + salt) * 10000;
      return (x - Math.floor(x)).toString(36).slice(2, 8);
    }
    const seedRuns = [
      { runId: `manual-${dayMs - 0 * HOUR_MS}-${stableRandom(1)}`, startOffset: 0 },
      { runId: `manual-${dayMs - 24 * HOUR_MS}-${stableRandom(2)}`, startOffset: 24 },
      { runId: `manual-${dayMs - 48 * HOUR_MS}-${stableRandom(3)}`, startOffset: 48 },
    ];
    const seedComp = [
      { company: "Stripe", source: "greenhouse", boardToken: "stripe" },
      { company: "Anthropic", source: "greenhouse", boardToken: "anthropic" },
      { company: "OpenAI", source: "greenhouse", boardToken: "openai" },
      { company: "Vercel", source: "lever", leverSite: "vercel" },
      { company: "Linear", source: "ashby", companySlug: "linear" },
      { company: "Figma", source: "greenhouse", boardToken: "figma" },
    ];

    const allLogs: Array<Record<string, unknown>> = [];

    for (const run of seedRuns) {
      const runStart = new Date(NOW_MS - run.startOffset * HOUR_MS);
      allLogs.push({
        type: "run_started",
        event: "run_started",
        level: "info",
        runId: run.runId,
        message: `Run started — ${seedComp.length} companies queued`,
        timestamp: runStart.toISOString(),
      });

      let cursor = runStart.getTime() + 500;
      for (const c of seedComp) {
        const scanDuration = 3000 + Math.floor(Math.random() * 5000);
        const fetched = 20 + Math.floor(Math.random() * 60);
        const matched = Math.floor(fetched * 0.3);
        const newJobs = Math.floor(matched * 0.4);
        const updated = Math.floor(matched * 0.2);
        const discarded = fetched - matched;
        const hasError = c.company === "OpenAI" && run.startOffset === 24;

        allLogs.push({
          type: "company_scan_start",
          event: "scan_start",
          level: "info",
          runId: run.runId,
          company: c.company,
          source: c.source,
          message: `Scanning ${c.company} via ${c.source}`,
          timestamp: new Date(cursor).toISOString(),
        });
        cursor += scanDuration;

        if (hasError) {
          allLogs.push({
            type: "company_scan_error",
            event: "scan_error",
            level: "error",
            runId: run.runId,
            company: c.company,
            source: c.source,
            message: `Scan failed for ${c.company}: rate limit exceeded`,
            timestamp: new Date(cursor).toISOString(),
          });
        } else {
          allLogs.push({
            type: "company_scan_done",
            event: "scan_complete",
            level: matched > 0 ? "info" : "warn",
            runId: run.runId,
            company: c.company,
            source: c.source,
            fetched,
            matched,
            new: newJobs,
            updated,
            discarded,
            durationMs: scanDuration,
            message: `${c.company}: fetched=${fetched} matched=${matched} new=${newJobs} updated=${updated} discarded=${discarded}`,
            timestamp: new Date(cursor).toISOString(),
          });
        }
        cursor += 200;
      }

      const totalNew = allLogs
        .filter((l) => l.type === "company_scan_done" && l.runId === run.runId)
        .reduce((sum, l) => sum + ((l.new as number) ?? 0), 0);
      allLogs.push({
        type: "run_completed",
        event: "scan_complete",
        level: "info",
        runId: run.runId,
        message: `Run completed — ${totalNew} new jobs found`,
        timestamp: new Date(cursor).toISOString(),
      });

      if (totalNew > 0) {
        allLogs.push({
          type: "email_sent",
          event: "email_sent",
          level: "info",
          runId: run.runId,
          message: `Email digest sent — ${totalNew} new jobs`,
          timestamp: new Date(cursor + 300).toISOString(),
        });
      }
    }

    // Sort descending by timestamp (most recent first) — matches vanilla KV scan order
    allLogs.sort((a, b) => new Date(b.timestamp as string).getTime() - new Date(a.timestamp as string).getTime());

    // Compact mode: one row per company per run — only scan_done, run events, errors, email
    const COMPACT_TYPES = new Set(["run_started", "company_scan_done", "company_scan_error", "run_completed", "email_sent"]);
    const compacted = compact
      ? allLogs.filter((l) => COMPACT_TYPES.has(l.type as string))
      : allLogs;

    let filtered = compacted;
    if (level) filtered = filtered.filter((l) => l.level === level);
    if (typeFilter) filtered = filtered.filter((l) => (l.type as string) === typeFilter || (l.event as string) === typeFilter);
    if (q) filtered = filtered.filter((l) =>
      (l.message as string)?.toLowerCase().includes(q) ||
      (l.company as string)?.toLowerCase().includes(q) ||
      (l.type as string)?.toLowerCase().includes(q) ||
      (l.event as string)?.toLowerCase().includes(q),
    );
    if (companies.length > 0) filtered = filtered.filter((l) => companies.includes(l.company as string));
    if (runIdFilter) filtered = filtered.filter((l) => (l.runId as string) === runIdFilter);

    const companyOptions = Array.from(
      new Set(allLogs.filter((l) => l.company).map((l) => l.company as string))
    ).sort();

    const runOptions = Array.from(
      new Set(allLogs.filter((l) => l.runId).map((l) => l.runId as string))
    ).sort().reverse();

    return json({
      ok: true,
      total: filtered.length,
      storage: "kv",
      retentionHours: 6,
      companyOptions,
      runOptions,
      logs: filtered.slice(0, limit),
    });
  }

  // -- Mutations --------------------------------------------------------
  if (method === "PUT" && path === "/api/settings/email-webhook") {
    const { webhookUrl, sharedSecret } = await readBody<{ webhookUrl?: string; sharedSecret?: string }>(init);
    if (webhookUrl !== undefined) s.emailWebhook.webhookUrl = webhookUrl || null;
    if (sharedSecret) s.emailWebhook.sharedSecretConfigured = true;
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/run") {
    // Only scan companies that are enabled and not paused — same as vanilla backend.
    s.runCompanies = s.config.companies
      .filter((c) => c.company && c.enabled !== false)
      .filter((c) => !s.scanOverrides[companyKey(c.company)]?.paused)
      .map((c) => c.company);
    const newRunId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const DAILY_LIVE_SCANS = 2;
    const remainingBefore = Math.max(0, DAILY_LIVE_SCANS - s.liveScansUsed);
    const quotaBlockedCompanies = remainingBefore > 0 ? [] : s.runCompanies.slice(1, Math.min(3, s.runCompanies.length));
    const staleCacheHits = remainingBefore > 0 ? 0 : Math.min(1, s.runCompanies.length);
    const liveFetchCompanies = remainingBefore > 0
      ? s.runCompanies.length
      : 0;
    s.runId = newRunId;
    s.runStartedAt = Date.now();
    s.runActive = true;
    s.runTotal = s.runCompanies.length;
    if (remainingBefore > 0) s.liveScansUsed += 1;
    return json({
      ok: true,
      active: true,
      runId: newRunId,
      runAt: new Date().toISOString(),
      totalNewMatches: 4,
      totalUpdatedMatches: 2,
      totalMatched: 24,
      totalFetched: 48,
      byCompany: Object.fromEntries(s.runCompanies.slice(0, 4).map((company) => [company, 6])),
      emailedJobs: [],
      emailedUpdatedJobs: [],
      emailStatus: "skipped",
      emailError: null,
      scanMeta: {
        // Model the real backend contract: once quota is exhausted, stale cache
        // can still satisfy some companies, while companies without cache are skipped.
        cacheHits: remainingBefore > 0 ? 1 : staleCacheHits,
        liveFetchCompanies,
        quotaBlockedCompanies,
        remainingLiveScansToday: Math.max(0, DAILY_LIVE_SCANS - s.liveScansUsed),
      },
    });
  }
  if (method === "POST" && path === "/api/run/abort") {
    s.runActive = false;
    return json({ ok: true });
  }
  if (method === "POST" && path === "/api/cache/clear") return json({ ok: true });
  if (method === "POST" && path === "/api/data/clear") {
    s.jobs = []; s.applied = []; return json({ ok: true });
  }
  if (method === "POST" && path === "/api/jobs/remove-broken-links") return json({ ok: true, removed: 0 });
  if (method === "POST" && path === "/api/companies/toggle-all") {
    const { paused } = await readBody<{ paused: boolean }>(init);
    if (paused) {
      for (const c of s.config.companies) {
        if (!c.company) continue;
        const key = c.company.toLowerCase().replace(/[^a-z0-9]+/g, "");
        s.scanOverrides[key] = { company: c.company, paused: true, updatedAt: new Date().toISOString() };
      }
    } else {
      s.scanOverrides = {};
    }
    return json({ ok: true, companyScanOverrides: s.scanOverrides });
  }

  if (method === "POST" && path === "/api/jobs/apply") {
    const { jobKey, notes } = await readBody<{ jobKey: string; notes?: string }>(init);
    const job = s.jobs.find((j) => j.jobKey === jobKey);
    if (!job) return json({ ok: false, error: "Not found" }, 404);
    s.applied.push({
      jobKey, job, appliedAt: new Date().toISOString(), status: "Applied",
      notes: notes ?? "", noteRecords: [], interviewRounds: [], timeline: [], lastStatusChangedAt: new Date().toISOString(),
    });
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/jobs/discard") {
    const { jobKey } = await readBody<{ jobKey: string }>(init);
    s.jobs = s.jobs.filter((j) => j.jobKey !== jobKey);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/jobs/notes") {
    const { jobKey, notes } = await readBody<{ jobKey: string; notes: string }>(init);
    const job = s.jobs.find((j) => j.jobKey === jobKey);
    if (job) job.notes = notes;
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    if (appl) appl.notes = notes;
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/notes/add") {
    const { jobKey, text } = await readBody<{ jobKey: string; text: string }>(init);
    const record = { id: `note-${Date.now()}`, text, createdAt: new Date().toISOString() };
    const job = s.jobs.find((j) => j.jobKey === jobKey);
    if (job) { if (!job.noteRecords) job.noteRecords = []; job.noteRecords.push(record); }
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    if (appl) { if (!appl.noteRecords) appl.noteRecords = []; appl.noteRecords.push(record); }
    return json({ ok: true, record });
  }

  if (method === "POST" && path === "/api/notes/update") {
    const { jobKey, noteId, text } = await readBody<{ jobKey: string; noteId: string; text: string }>(init);
    const patch = (records: { id: string; text: string; updatedAt?: string }[]) => {
      const r = records.find((n) => n.id === noteId);
      if (r) { r.text = text; r.updatedAt = new Date().toISOString(); }
    };
    const job = s.jobs.find((j) => j.jobKey === jobKey);
    if (job?.noteRecords) patch(job.noteRecords);
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    if (appl?.noteRecords) patch(appl.noteRecords);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/notes/delete") {
    const { jobKey, noteId } = await readBody<{ jobKey: string; noteId: string }>(init);
    const job = s.jobs.find((j) => j.jobKey === jobKey);
    if (job?.noteRecords) job.noteRecords = job.noteRecords.filter((n) => n.id !== noteId);
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    if (appl?.noteRecords) appl.noteRecords = appl.noteRecords.filter((n) => n.id !== noteId);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/jobs/manual-add") {
    const { company, jobTitle, url: jobUrl, location, notes } =
      await readBody<{ company: string; jobTitle: string; url?: string; location?: string; notes?: string }>(init);
    const job: Job = {
      jobKey: `manual-${Date.now()}`,
      company, jobTitle, url: jobUrl ?? "", source: "manual", location: location ?? "",
      postedAt: new Date().toISOString(), postedAtDate: new Date().toISOString().slice(0, 10),
      isNew: true, isUpdated: false, notes: notes ?? "",
    };
    s.jobs.unshift(job);
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/jobs/status") {
    const { jobKey, status } = await readBody<{ jobKey: string; status: AppliedJob["status"] }>(init);
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    if (appl) {
      const prev = appl.status;
      appl.status = status;
      appl.lastStatusChangedAt = new Date().toISOString();
      if (status === "Interview" && prev !== "Interview") {
        appl.interviewRounds = appl.interviewRounds ?? [];
        appl.interviewRounds.push({
          id: `${jobKey}-r${appl.interviewRounds.length + 1}-${Date.now()}`,
          number: appl.interviewRounds.length + 1,
          designation: "",
          scheduledAt: null as string | null,
          outcome: "Pending" as const,
          notes: "",
        });
      }
    }
    return json({ ok: true });
  }

  // -- Interview rounds (Action Plan) ---------------------------------
  if (method === "POST" && path === "/api/action-plan/interview/add") {
    const { jobKey, number } = await readBody<{ jobKey: string; number?: number }>(init);
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    if (!appl) return json({ ok: false, error: "Not found" }, 404);
    appl.interviewRounds = appl.interviewRounds ?? [];
    const round = {
      id: `${jobKey}-r${appl.interviewRounds.length + 1}-${Date.now()}`,
      number: number ?? appl.interviewRounds.length + 1,
      designation: "",
      scheduledAt: null as string | null,
      outcome: "Pending" as const,
      notes: "",
    };
    appl.interviewRounds.push(round);
    return json({ ok: true, round });
  }

  if (method === "POST" && path === "/api/action-plan/interview") {
    const body = await readBody<Record<string, unknown>>(init);
    const jobKey = String(body.jobKey ?? "");
    const roundId = String(body.roundId ?? "");
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    const round = appl?.interviewRounds?.find((r) => r.id === roundId);
    if (round) {
      if ("designation" in body) round.designation = String(body.designation ?? "");
      if ("scheduledAt" in body) round.scheduledAt = body.scheduledAt as string | null;
      if ("outcome" in body) round.outcome = body.outcome as typeof round.outcome;
      if ("notes" in body) round.notes = String(body.notes ?? "");
    }
    return json({ ok: true });
  }

  if (method === "POST" && path === "/api/action-plan/interview/delete") {
    const { jobKey, roundId } = await readBody<{ jobKey: string; roundId: string }>(init);
    const appl = s.applied.find((a) => a.jobKey === jobKey);
    if (appl?.interviewRounds) {
      appl.interviewRounds = appl.interviewRounds.filter((r) => r.id !== roundId);
    }
    return json({ ok: true });
  }

  // -- Saved filters ----------------------------------------------------
  if (method === "GET" && path === "/api/filters") {
    const scope = url.searchParams.get("scope") ?? "";
    const filters = scope ? s.savedFilters.filter((f) => f.scope === scope) : s.savedFilters;
    return json({ ok: true, total: filters.length, filters });
  }

  if (method === "POST" && path === "/api/filters") {
    const body = await readBody<{ name?: string; scope?: string; filter?: Record<string, unknown>; isDefault?: boolean; id?: string }>(init);
    const name = String(body.name ?? "").trim();
    const scope = String(body.scope ?? "").trim();
    if (!name) return json({ ok: false, error: "name is required" }, 400);
    const validScopes = ["available_jobs", "applied_jobs", "dashboard", "logs"];
    if (!validScopes.includes(scope)) return json({ ok: false, error: "Valid scope is required" }, 400);
    if (!body.filter) return json({ ok: false, error: "filter is required" }, 400);
    const now = new Date().toISOString();
    const existing = body.id ? s.savedFilters.find((f) => f.id === body.id) : null;
    if (existing) {
      existing.name = name;
      existing.filter = body.filter;
      existing.isDefault = body.isDefault === true;
      existing.updatedAt = now;
      return json({ ok: true, filter: existing });
    }
    const same = s.savedFilters.find((f) => f.name === name && f.scope === scope);
    if (same) return json({ ok: false, error: `Filter '${name}' already exists for this scope` }, 409);
    const entry: SavedFilter = {
      id: `filter-${Date.now()}`,
      name, scope: scope as SavedFilter["scope"],
      filter: body.filter,
      isDefault: body.isDefault === true,
      createdAt: now, updatedAt: now,
    };
    s.savedFilters.push(entry);
    return json({ ok: true, filter: entry });
  }

  if (method === "DELETE" && path.startsWith("/api/filters/")) {
    const filterId = decodeURIComponent(path.slice("/api/filters/".length)).trim();
    const idx = s.savedFilters.findIndex((f) => f.id === filterId);
    if (idx === -1) return json({ ok: false, error: "Saved filter not found" }, 404);
    s.savedFilters.splice(idx, 1);
    return json({ ok: true, deleted: filterId });
  }

  if (method === "POST" && path === "/api/config/save") {
    const body = await readBody<RuntimeConfig>(init);
    s.config = { ...s.config, ...body, updatedAt: new Date().toISOString() };
    return json({ ok: true, config: s.config });
  }

  const toggleMatch = path.match(/^\/api\/companies\/([^/]+)\/toggle$/);
  if (method === "POST" && toggleMatch) {
    const company = decodeURIComponent(toggleMatch[1]);
    const { paused } = await readBody<{ paused: boolean }>(init);
    const key = company.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (paused) s.scanOverrides[key] = { company, paused: true, updatedAt: new Date().toISOString() };
    else delete s.scanOverrides[key];
    return json({ ok: true, companyScanOverrides: s.scanOverrides });
  }

  return null; // pass through
}

/** Reset in-memory state — only used by unit tests. */
export function _resetMockState() {
  state = null;
}

/** Should we install mocks? Only local/dev builds can opt into mock data. */
export function shouldUseMocks(): boolean {
  if (!isLocalDevHost()) return false;
  if (envValue("VITE_USE_MOCKS") === "true") return true;
  try {
    return new URLSearchParams(window.location.search).get("demo") === "1";
  } catch {
    return false;
  }
}

export function installMocks() {
  if (typeof window === "undefined") return;
  ensureState();
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? new URL(input, window.location.origin)
      : input instanceof URL
        ? input
        : new URL(input.url, window.location.origin);
    if (url.pathname.startsWith("/api/")) {
      // Small artificial delay so loading states are visible.
      await new Promise((r) => setTimeout(r, 120));
      const handled = await handle(url, init);
      if (handled) return handled;
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof window.fetch;
  console.info("[mocks] installed — serving seed data for /api/* endpoints");
}
