import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ActionPlanEnvelope } from "@/lib/api";

export const actionPlanKey = ["actionPlan"] as const;

export function useActionPlan() {
  return useQuery({
    queryKey: actionPlanKey,
    queryFn: () => api.get<ActionPlanEnvelope>("/api/action-plan"),
    // Action Plan filters are local-only, so keep the dataset warm across page
    // visits instead of refetching while the user tweaks chips and date ranges.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
  });
}

export function useScheduleInterview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post("/api/action-plan/interview", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: actionPlanKey }),
  });
}

export function useAddInterviewRound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post("/api/action-plan/interview/add", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: actionPlanKey }),
  });
}

export function useDeleteInterviewRound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post("/api/action-plan/interview/delete", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: actionPlanKey }),
  });
}
