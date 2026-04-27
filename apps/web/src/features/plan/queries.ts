import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ActionPlanEnvelope } from "@/lib/api";

export const actionPlanKey = ["actionPlan"] as const;

export function useActionPlan() {
  return useQuery({
    queryKey: actionPlanKey,
    queryFn: () => api.get<ActionPlanEnvelope>("/api/action-plan"),
    staleTime: 15_000,
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
