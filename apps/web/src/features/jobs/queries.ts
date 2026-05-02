/**
 * Available-jobs hooks. Filters live in component state and feed into
 * the query key so refining filters refetches automatically.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type JobsEnvelope } from "@/lib/api";

export type JobsFilter = {
  companies?: string[];
  location?: string;
  keyword?: string;
  duration?: string;
  source?: string;
  usOnly?: boolean;
  newOnly?: boolean;
  updatedOnly?: boolean;
  limit?: number;
  offset?: number;
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
  p.set("limit", String(f.limit ?? 100));
  p.set("offset", String(f.offset ?? 0));
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
    placeholderData: (prev) => prev,
    staleTime: 15_000,
  });
}

export function useDiscardJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobKey: string) => api.post("/api/jobs/discard", { jobKey }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
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
