import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type AppliedJob,
  type AppliedJobsEnvelope,
  type AppliedKanbanColumn,
  type AppliedKanbanEnvelope,
  type AppliedStatus,
  type CompanyAppliedJobsEnvelope,
  type Job,
} from "@/lib/api";

export type AppliedFilter = {
  companies?: string[];
  /** Free-text search against job title (and company). */
  keyword?: string;
  /** Multi-select: one or more pipeline statuses. Empty array = all. */
  statuses?: string[];
  /** Inclusive date range filter on `appliedAt`. ISO strings. */
  appliedFrom?: string;
  appliedTo?: string;
};

export const appliedKey = (f: AppliedFilter) => ["applied", f] as const;
export const appliedKanbanKey = () => ["applied", "kanban"] as const;
export const companyAppliedKey = (companySlug: string) => ["applied", "company", companySlug] as const;

type RawAppliedJob = Partial<AppliedJob> & {
  company?: string;
  jobTitle?: string;
  source?: string;
  location?: string;
  url?: string;
  originalUrl?: string;
  archivedUrl?: string;
  archiveCapturedAt?: string;
  postedAt?: string;
  postedAtDate?: string;
  isNew?: boolean;
  isUpdated?: boolean;
};

function normalizeAppliedJob(row: RawAppliedJob): AppliedJob {
  const nestedJob = row.job ?? {} as Partial<Job>;
  const jobKey = row.jobKey ?? `${row.source ?? nestedJob.source ?? "manual"}:${row.company ?? nestedJob.company ?? "Unknown"}:${row.url ?? nestedJob.url ?? ""}`;
  const job: Job = {
    jobKey,
    company: nestedJob.company ?? row.company ?? "Unknown",
    source: nestedJob.source ?? row.source ?? "manual",
    jobTitle: nestedJob.jobTitle ?? row.jobTitle ?? "Untitled role",
    postedAt: nestedJob.postedAt ?? row.postedAt,
    postedAtDate: nestedJob.postedAtDate ?? row.postedAtDate,
    location: nestedJob.location ?? row.location,
    // Prefer the archived snapshot URL when present so preserved applied jobs
    // keep opening inside Career Jump even after the source posting disappears.
    url: row.archivedUrl ?? row.url ?? nestedJob.url ?? "",
    originalUrl: row.originalUrl ?? nestedJob.originalUrl,
    archivedUrl: row.archivedUrl ?? nestedJob.archivedUrl,
    archiveCapturedAt: row.archiveCapturedAt ?? nestedJob.archiveCapturedAt,
    isNew: nestedJob.isNew ?? row.isNew,
    isUpdated: nestedJob.isUpdated ?? row.isUpdated,
  };

  return {
    ...row,
    jobKey,
    appliedAt: row.appliedAt ?? "",
    status: row.status ?? "Applied",
    job,
    originalUrl: row.originalUrl ?? nestedJob.originalUrl,
    archivedUrl: row.archivedUrl ?? nestedJob.archivedUrl,
    archiveCapturedAt: row.archiveCapturedAt ?? nestedJob.archiveCapturedAt,
    notes: row.notes,
    noteRecords: row.noteRecords ?? [],
    interviewRounds: row.interviewRounds ?? [],
    timeline: row.timeline ?? [],
    lastStatusChangedAt: row.lastStatusChangedAt,
  };
}

function normalizeAppliedJobs(rows: RawAppliedJob[] | undefined): AppliedJob[] {
  return (rows ?? []).map((row) => normalizeAppliedJob(row));
}

function normalizeAppliedEnvelope(data: AppliedJobsEnvelope): AppliedJobsEnvelope {
  // The AWS API currently returns flattened application rows; the React UI
  // consumes a nested `job` object. Normalize once at the query boundary so all
  // pages/widgets share the same applied-jobs source of truth.
  const jobs = normalizeAppliedJobs(data.jobs as RawAppliedJob[] | undefined);
  const companyOptions = data.companyOptions?.length
    ? data.companyOptions
    : Array.from(new Set(jobs.map((job) => job.job.company))).sort();
  return { ...data, jobs, companyOptions };
}

function normalizeAppliedKanbanEnvelope(data: AppliedKanbanEnvelope): AppliedKanbanEnvelope {
  // Normalize each column once so the dedicated kanban endpoint can share the
  // same nested job shape as the rest of the applied-jobs UI.
  const columns: AppliedKanbanColumn[] = (data.columns ?? []).map((column) => ({
    ...column,
    jobs: normalizeAppliedJobs(column.jobs as RawAppliedJob[] | undefined),
    count: column.count ?? column.jobs?.length ?? 0,
  }));
  const total = data.total ?? columns.reduce((sum, column) => sum + column.jobs.length, 0);
  return { ...data, total, columns };
}

function normalizeCompanyAppliedEnvelope(data: CompanyAppliedJobsEnvelope): CompanyAppliedJobsEnvelope {
  return { ...data, jobs: normalizeAppliedJobs(data.jobs as RawAppliedJob[] | undefined) };
}

export function useApplied(_filter: AppliedFilter) {
  return useQuery({
    // Applied Jobs is now cheap enough to fetch once and refine locally so
    // stage/company/keyword filters feel instant instead of refetching the
    // whole page payload on every control change.
    queryKey: appliedKey({}),
    queryFn: () => api.get<AppliedJobsEnvelope>("/api/applied-jobs").then(normalizeAppliedEnvelope),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });
}

export function useAppliedKanban(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: appliedKanbanKey(),
    queryFn: () => api.get<AppliedKanbanEnvelope>("/api/applied-jobs/kanban").then(normalizeAppliedKanbanEnvelope),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
    enabled: options?.enabled ?? true,
  });
}

export function useCompanyAppliedJobs(companySlug: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: companyAppliedKey(companySlug),
    queryFn: () => api.get<CompanyAppliedJobsEnvelope>(`/api/companies/${encodeURIComponent(companySlug)}/applied`).then(normalizeCompanyAppliedEnvelope),
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? Boolean(companySlug),
  });
}

export function useUpdateStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { jobKey: string; status: AppliedStatus }) => api.post("/api/jobs/status", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applied"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["actionPlan"] });
      qc.invalidateQueries({ queryKey: appliedKanbanKey() });
    },
  });
}
