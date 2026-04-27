import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type SavedFilterScope = "available_jobs" | "applied_jobs" | "dashboard" | "logs";

export interface SavedFilter {
  id: string;
  name: string;
  scope: SavedFilterScope;
  filter: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export const filtersKey = (scope?: SavedFilterScope) => ["filters", scope ?? "all"] as const;

export function useSavedFilters(scope?: SavedFilterScope) {
  return useQuery({
    queryKey: filtersKey(scope),
    queryFn: () => {
      const params = scope ? `?scope=${scope}` : "";
      return api.get<{ ok: boolean; total: number; filters: SavedFilter[] }>(`/api/filters${params}`);
    },
    staleTime: 30_000,
  });
}

export function useSaveFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      name: string;
      scope: SavedFilterScope;
      filter: Record<string, unknown>;
      isDefault?: boolean;
      id?: string;
    }) => api.post<{ ok: boolean; filter: SavedFilter }>("/api/filters", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });
}

export function useDeleteFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (filterId: string) => api.del<{ ok: boolean; deleted: string }>(`/api/filters/${encodeURIComponent(filterId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filters"] }),
  });
}
