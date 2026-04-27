import { useQuery } from "@tanstack/react-query";
import { api, type MeEnvelope } from "@/lib/api";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.get<MeEnvelope>("/api/me"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

