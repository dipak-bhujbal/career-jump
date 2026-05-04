import { useQuery } from "@tanstack/react-query";
import { ApiError, api, type MeEnvelope } from "@/lib/api";

export const meKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.get<MeEnvelope>("/api/me"),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    // Lambda/edge throttles return 429 even when the next retry a moment later
    // would succeed. Keep this narrowly scoped to a single retry so we smooth
    // transient bursts without reintroducing noisy infinite polling.
    retry: (failureCount, error) => error instanceof ApiError && error.status === 429 && failureCount < 1,
    retryDelay: 750,
  });
}
