import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  registryApi,
  ApiError,
  type ConfigEnvelope,
  type RegistryEntry,
  type RegistryMeta,
  type CompanyConfig,
  type ValidateCompanyEnvelope,
  type ValidateCompanyRequest,
} from "@/lib/api";
import { REGISTRY_META } from "@/data/companies-registry";
import { isLocalDevHost } from "@/lib/runtime-config";

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

type ConfigQueryOptions = {
  enabled?: boolean;
};

type RegistryMetaQueryOptions = {
  enabled?: boolean;
};

export type RegistrySearchResult = { ok: boolean; total: number; entries: RegistryEntry[] };

function normalizeRegistryEntries(result: Partial<RegistrySearchResult> & Record<string, unknown>): RegistryEntry[] {
  // Accept a few response aliases so old/new registry Lambdas cannot blank the picker.
  const rawEntries = result.entries ?? result.companies ?? result.items ?? result.results;
  return Array.isArray(rawEntries) ? rawEntries as RegistryEntry[] : [];
}

export function useConfig(options: ConfigQueryOptions = {}) {
  return useQuery({
    queryKey: configKey,
    queryFn: () => api.get<ConfigEnvelope>("/api/config"),
    // Some app-shell surfaces only need config while actively visible. Let
    // those call sites opt out of eager background reads to reduce burst load.
    enabled: options.enabled !== false,
    staleTime: 30_000,
    // Config is the source of truth for the page. Retry a lone throttle once
    // so a temporary Lambda burst does not blank the entire configuration UI.
    retry: (failureCount, error) => error instanceof ApiError && error.status === 429 && failureCount < 1,
    retryDelay: 750,
  });
}

export function useRegistryMeta(options: RegistryMetaQueryOptions = {}) {
  return useQuery({
    queryKey: registryMetaKey,
    queryFn: async () => {
      try {
        const result = await registryApi.get<RegistryMeta>("/api/registry/meta");
        // Only fake the large catalog count for local/demo environments. In
        // production we need the UI to reflect the real registry table state
        // so an empty or un-restored catalog is visible instead of misleading.
        if ((result.counts?.total ?? 0) < 100 && isLocalDevHost()) return localRegistryMeta();
        return result;
      } catch {
        // The bundled registry metadata is only a local/dev convenience. In
        // production, falling back to it lies about the real registry size and
        // makes throttles look like "1230 available" counts. Return an empty
        // shape instead so prod stays honest when the registry endpoint fails.
        return isLocalDevHost()
          ? localRegistryMeta()
          : {
              ok: false,
              meta: { version: "unavailable", total: 0 },
              loadedAt: Date.now(),
              adapters: [],
              counts: {
                total: 0,
                tier1: 0,
                tier2: 0,
                tier3: 0,
                needsReview: 0,
              },
            } satisfies RegistryMeta;
      }
    },
    enabled: options.enabled !== false,
    // Registry meta is informational for the picker badge, so keep it quiet
    // and tolerant under transient throttles instead of hammering the API.
    staleTime: 5 * 60_000,
    retry: (failureCount, error) => error instanceof ApiError && error.status === 429 && failureCount < 1,
    retryDelay: 750,
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
    mutationFn: (payload: {
      companies: CompanyConfig[];
      jobtitles: { includeKeywords: string[]; excludeKeywords: string[] };
    }) =>
      api.post<ConfigEnvelope>("/api/config/save", payload),
    onSuccess: async (result) => {
      // Update the local cache immediately so Save/Cancel controls disappear as
      // soon as the backend accepts the draft instead of waiting for a later
      // refetch or a manual browser refresh.
      qc.setQueryData<ConfigEnvelope | undefined>(configKey, (current) => ({
        ok: true,
        config: result.config,
        companyScanOverrides: current?.companyScanOverrides ?? {},
      }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: configKey }),
        // Config changes can immediately alter tenant-visible jobs and the
        // dashboard summary once the Phase 3.5 rebuild lands, so refresh both
        // surfaces instead of leaving the prior cache warm.
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
}

export function useValidateCompany() {
  return useMutation({
    mutationFn: (payload: ValidateCompanyRequest) =>
      api.post<ValidateCompanyEnvelope>("/api/config/validate-company", payload),
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
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: configKey }),
        qc.invalidateQueries({ queryKey: ["jobs"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
}
