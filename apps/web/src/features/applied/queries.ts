import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type AppliedJob, type AppliedJobsEnvelope, type AppliedStatus, type Job } from "@/lib/api";

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

type RawAppliedJob = Partial<AppliedJob> & {
  company?: string;
  jobTitle?: string;
  source?: string;
  location?: string;
  url?: string;
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
    url: nestedJob.url ?? row.url ?? "",
    isNew: nestedJob.isNew ?? row.isNew,
    isUpdated: nestedJob.isUpdated ?? row.isUpdated,
  };

  return {
    ...row,
    jobKey,
    appliedAt: row.appliedAt ?? "",
    status: row.status ?? "Applied",
    job,
    notes: row.notes,
    noteRecords: row.noteRecords ?? [],
    interviewRounds: row.interviewRounds ?? [],
    timeline: row.timeline ?? [],
    lastStatusChangedAt: row.lastStatusChangedAt,
  };
}

function normalizeAppliedEnvelope(data: AppliedJobsEnvelope): AppliedJobsEnvelope {
  // The AWS API currently returns flattened application rows; the React UI
  // consumes a nested `job` object. Normalize once at the query boundary so all
  // pages/widgets share the same applied-jobs source of truth.
  const jobs = (data.jobs ?? []).map((row) => normalizeAppliedJob(row as RawAppliedJob));
  const companyOptions = data.companyOptions?.length
    ? data.companyOptions
    : Array.from(new Set(jobs.map((job) => job.job.company))).sort();
  return { ...data, jobs, companyOptions };
}

export function useApplied(filter: AppliedFilter) {
  return useQuery({
    queryKey: appliedKey(filter),
    queryFn: () => {
      const p = new URLSearchParams();
      for (const c of filter.companies ?? []) if (c) p.append("company", c);
      if (filter.keyword) p.set("keyword", filter.keyword);
      for (const s of filter.statuses ?? []) if (s) p.append("status", s);
      const qs = p.toString();
      return api.get<AppliedJobsEnvelope>(`/api/applied-jobs${qs ? `?${qs}` : ""}`).then(normalizeAppliedEnvelope);
    },
    staleTime: 15_000,
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
    },
  });
}
