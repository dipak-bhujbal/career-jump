/**
 * Available-jobs hooks. Filters stay in the query key so both admin and
 * non-admin sessions get the same server-side/global filtering behavior
 * instead of only refining the current loaded page locally.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type JobDetailEnvelope, type JobsEnvelope } from "@/lib/api";

export type JobsFilter = {
  companies?: string[];
  location?: string;
  keyword?: string;
  duration?: string;
  source?: string;
  usOnly?: boolean;
  newOnly?: boolean;
  updatedOnly?: boolean;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  cursor?: string | null;
  fetchAll?: boolean;
};

type JobsQueryOptions = {
  enabled?: boolean;
};

function buildJobsParams(f: JobsFilter): URLSearchParams {
  const p = new URLSearchParams();
  for (const c of f.companies ?? []) if (c) p.append("company", c);
  if (f.location) p.set("location", f.location);
  if (f.keyword) p.set("keyword", f.keyword);
  if (f.duration) p.set("duration", f.duration);
  if (f.source) p.set("source", f.source);
  if (f.usOnly) p.set("usOnly", "true");
  if (f.newOnly) p.set("newOnly", "true");
  if (f.updatedOnly) p.set("updatedOnly", "true");
  if (f.dateFrom) p.set("dateFrom", f.dateFrom);
  if (f.dateTo) p.set("dateTo", f.dateTo);
  p.set("limit", String(f.limit ?? 100));
  if (f.cursor) p.set("cursor", f.cursor);
  if (f.fetchAll) p.set("all", "true");
  return p;
}

export const jobsKey = (f: JobsFilter) => ["jobs", f] as const;

export function useJobs(filter: JobsFilter, options: JobsQueryOptions = {}) {
  return useQuery({
    queryKey: jobsKey(filter),
    queryFn: () => {
      const params = buildJobsParams(filter);
      return api.get<JobsEnvelope>(`/api/jobs?${params.toString()}`);
    },
    // Callers such as the global command palette can disable background job
    // lookups while hidden so the app shell does not duplicate `/api/jobs`
    // traffic on every page load.
    enabled: options.enabled !== false,
    // Users often bounce between Dashboard, Configuration, and Available Jobs
    // within a single session. Keep the last successful page warm so revisits
    // feel instant and the user can still force a fresh read with the explicit
    // Refresh button.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });
}

export function useJobDetails(jobKey: string | null, enabled = true) {
  return useQuery({
    queryKey: ["job-details", jobKey],
    queryFn: () => api.get<JobDetailEnvelope>(`/api/jobs/details?jobKey=${encodeURIComponent(jobKey ?? "")}`),
    enabled: enabled && Boolean(jobKey),
    staleTime: 60_000,
  });
}

export function useDiscardJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobKey: string) => api.post("/api/jobs/discard", { jobKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["job-details"] });
    },
  });
}

export function useApplyJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { jobKey: string; notes?: string }) => api.post("/api/jobs/apply", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["applied"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["job-details"] });
    },
  });
}

export function useSaveJobNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { jobKey: string; notes: string }) => api.post("/api/jobs/notes", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["applied"] });
      // The shared drawer edits notes for action-plan rows too, so refresh
      // that surface alongside available/applied job lists.
      qc.invalidateQueries({ queryKey: ["actionPlan"] });
      qc.invalidateQueries({ queryKey: ["job-details"] });
    },
  });
}

export function useAddNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { jobKey: string; text: string }) => api.post("/api/notes/add", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["applied"] });
      qc.invalidateQueries({ queryKey: ["actionPlan"] });
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { jobKey: string; noteId: string; text: string }) => api.post("/api/notes/update", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["applied"] });
      qc.invalidateQueries({ queryKey: ["actionPlan"] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { jobKey: string; noteId: string }) => api.post("/api/notes/delete", payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["applied"] });
      qc.invalidateQueries({ queryKey: ["actionPlan"] });
    },
  });
}

export function useManualAddJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { company: string; jobTitle: string; url?: string; location?: string; notes?: string }) =>
      api.post("/api/jobs/manual-add", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}
