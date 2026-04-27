import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, registryApi, type ConfigEnvelope, type RegistryEntry, type RegistryMeta, type CompanyConfig } from "@/lib/api";
import { REGISTRY_META } from "@/data/companies-registry";

function localRegistryMeta(): RegistryMeta {
  return {
    ok: true,
    meta: { version: REGISTRY_META.version, total: REGISTRY_META.total },
    loadedAt: Date.now(),
    adapters: [...REGISTRY_META.adapters],
    counts: {
      total: REGISTRY_META.total,
      tier1: REGISTRY_META.tier1,
      tier2: REGISTRY_META.tier2,
      tier3: REGISTRY_META.tier3,
      needsReview: REGISTRY_META.needsReview,
    },
  };
}

export const configKey = ["config"] as const;
export const registryMetaKey = ["registry", "meta"] as const;
export const registrySearchKey = (q: { search?: string; ats?: string; tier?: string; limit?: number }) =>
  ["registry", "search", q.search ?? "", q.ats ?? "", q.tier ?? "", q.limit ?? 50] as const;

export type RegistrySearchResult = { ok: boolean; total: number; entries: RegistryEntry[] };

function normalizeRegistryEntries(result: Partial<RegistrySearchResult> & Record<string, unknown>): RegistryEntry[] {
  // Accept a few response aliases so old/new registry Lambdas cannot blank the picker.
  const rawEntries = result.entries ?? result.companies ?? result.items ?? result.results;
  return Array.isArray(rawEntries) ? rawEntries as RegistryEntry[] : [];
}

export function useConfig() {
  return useQuery({
    queryKey: configKey,
    queryFn: () => api.get<ConfigEnvelope>("/api/config"),
    staleTime: 30_000,
  });
}

export function useRegistryMeta() {
  return useQuery({
    queryKey: registryMetaKey,
    queryFn: async () => {
      try {
        const result = await registryApi.get<RegistryMeta>("/api/registry/meta");
        if ((result.counts?.total ?? 0) < 100) return localRegistryMeta();
        return result;
      } catch {
        return localRegistryMeta();
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useRegistrySearch(q: { search?: string; ats?: string; tier?: string; limit?: number; enabled?: boolean }) {
  return useQuery({
    queryKey: registrySearchKey(q),
    queryFn: async () => {
      const p = new URLSearchParams();
      if (q.search) p.set("search", q.search);
      if (q.ats) p.set("ats", q.ats);
      if (q.tier) p.set("tier", q.tier);
      p.set("limit", String(q.limit ?? 50));
      const result = await registryApi.get<Partial<RegistrySearchResult> & Record<string, unknown>>(`/api/registry/companies?${p.toString()}`);
      // Normalize sparse registry responses so picker UI can always read arrays safely.
      const entries = normalizeRegistryEntries(result);
      return { ok: result.ok !== false, total: result.total ?? entries.length, entries };
    },
    enabled: q.enabled !== false,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { companies: CompanyConfig[]; jobtitles: { includeKeywords: string[]; excludeKeywords: string[] } }) =>
      api.post<{ ok: boolean; config: unknown }>("/api/config/save", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: configKey }),
  });
}

export function useToggleCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ company, paused }: { company: string; paused: boolean }) =>
      api.post<{ ok: boolean; companyScanOverrides?: Record<string, unknown> }>(
        `/api/companies/${encodeURIComponent(company)}/toggle`,
        { paused },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: configKey }),
  });
}
