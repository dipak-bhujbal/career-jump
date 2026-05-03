import { useQuery } from "@tanstack/react-query";
import { api, type Dashboard } from "@/lib/api";

export const dashboardKey = ["dashboard"] as const;

/** Polls every 30s while the tab is active so KPIs stay roughly fresh. */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKey,
    queryFn: () => api.get<Dashboard>("/api/dashboard"),
    // Dashboard now has its own short-lived summary cache, so the client can
    // also back off and stop hammering the endpoint on every quick revisit.
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
