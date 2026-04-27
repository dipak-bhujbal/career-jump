import { useQuery } from "@tanstack/react-query";
import { api, type Dashboard } from "@/lib/api";

export const dashboardKey = ["dashboard"] as const;

/** Polls every 30s while the tab is active so KPIs stay roughly fresh. */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: () => api.get<Dashboard>("/api/dashboard"),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
