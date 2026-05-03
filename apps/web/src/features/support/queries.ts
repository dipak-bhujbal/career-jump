import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type AnnouncementEnvelope,
  type AnnouncementsEnvelope,
  type AdminAnalyticsEnvelope,
  type AdminActionsNeededEnvelope,
  type ResumeAdminActionEnvelope,
  type AdminRegistryCompanyConfig,
  type AdminRegistryCompanyConfigDeleteEnvelope,
  type AdminRegistryCompanyConfigEnvelope,
  type AdminRegistryCompanyConfigsEnvelope,
  type AdminRegistryStatusEnvelope,
  type FeatureUsageAnalytics,
  type GrowthAnalytics,
  type AdminSummaryEnvelope,
  type EmailWebhookSettings,
  type PlanConfig,
  type PlanConfigEnvelope,
  type PlanConfigsEnvelope,
  type AdminUserEnvelope,
  type AdminUsersEnvelope,
  type FeatureFlagsEnvelope,
  type MarketIntelAnalytics,
  type ScanQuotaAnalytics,
  type CreateAnnouncementRequest,
  type SupportTicketEnvelope,
  type SupportTicketsEnvelope,
  type SystemHealthAnalytics,
  type UpdateAnnouncementRequest,
} from "@/lib/api";
import { meKey } from "@/features/session/queries";

export const supportTicketsKey = ["support-tickets"] as const;

export function useSupportTickets() {
  return useQuery({
    queryKey: supportTicketsKey,
    queryFn: () => api.get<SupportTicketsEnvelope>("/api/support/tickets"),
    staleTime: 10_000,
  });
}

export function useSupportTicket(ticketId: string | null) {
  return useQuery({
    queryKey: ["support-ticket", ticketId],
    queryFn: () => api.get<SupportTicketEnvelope>(`/api/support/tickets/${ticketId}`),
    enabled: Boolean(ticketId),
    staleTime: 10_000,
  });
}

export function useCreateSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      subject: string;
      body: string;
      priority?: "low" | "normal" | "high" | "urgent";
      tags?: Array<"bug" | "enhancement" | "subscription_assistance" | "other" | "billing" | "scan" | "account">;
    }) =>
      api.post("/api/support/tickets", body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: supportTicketsKey });
    },
  });
}

export function useCreateSupportMessage(ticketId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; internal?: boolean }) =>
      api.post(`/api/support/tickets/${ticketId}/messages`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: supportTicketsKey });
      await queryClient.invalidateQueries({ queryKey: ["support-ticket", ticketId] });
    },
  });
}

export function useAdminSummary(enabled = true) {
  return useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => api.get<AdminSummaryEnvelope>("/api/admin/summary"),
    enabled,
    staleTime: 10_000,
  });
}

export function useAdminRegistryStatus(enabled = true) {
  return useQuery({
    queryKey: ["admin-registry-status"],
    queryFn: () => api.get<AdminRegistryStatusEnvelope>("/api/admin/registry-status"),
    enabled,
    staleTime: 30_000,
  });
}

export function useAdminActionsNeeded(enabled = true) {
  return useQuery({
    queryKey: ["admin-actions-needed"],
    queryFn: () => api.get<AdminActionsNeededEnvelope>("/api/admin/actions-needed"),
    enabled,
    staleTime: 30_000,
  });
}

export function useResumeAdminAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (company: string) =>
      api.post<ResumeAdminActionEnvelope>(`/api/admin/actions-needed/${encodeURIComponent(company)}/resume`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-actions-needed"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-registry-status"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
    },
  });
}

export function useAdminRegistryCompanyConfigs(enabled = true) {
  return useQuery({
    queryKey: ["admin-registry-company-configs"],
    queryFn: () => api.get<AdminRegistryCompanyConfigsEnvelope>("/api/admin/registry/company-configs"),
    enabled,
    staleTime: 30_000,
  });
}

export function useAdminRegistryCompanyConfig(registryId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["admin-registry-company-config", registryId],
    queryFn: () => api.get<AdminRegistryCompanyConfigEnvelope>(`/api/admin/registry/company-configs/${encodeURIComponent(registryId ?? "")}`),
    enabled: enabled && Boolean(registryId),
    staleTime: 10_000,
  });
}

export function useSaveAdminRegistryCompanyConfig(registryId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: AdminRegistryCompanyConfig) =>
      api.put<AdminRegistryCompanyConfigEnvelope & { nextRegistryId?: string | null }>(
        `/api/admin/registry/company-configs/${encodeURIComponent(registryId ?? "")}`,
        { config },
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-registry-company-configs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-registry-status"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-registry-company-config", registryId] });
      if (result.nextRegistryId && result.nextRegistryId !== registryId) {
        await queryClient.invalidateQueries({ queryKey: ["admin-registry-company-config", result.nextRegistryId] });
      }
    },
  });
}

export function useDeleteAdminRegistryCompanyConfig(registryId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.del<AdminRegistryCompanyConfigDeleteEnvelope>(
        `/api/admin/registry/company-configs/${encodeURIComponent(registryId ?? "")}`,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-registry-company-configs"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-registry-status"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-registry-company-config", registryId] });
    },
  });
}

export function useAdminUsers(query: string, enabled = true) {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  return useQuery({
    queryKey: ["admin-users", query],
    queryFn: () => api.get<AdminUsersEnvelope>(`/api/admin/users${qs}`),
    enabled,
    staleTime: 10_000,
  });
}

export function useAdminUser(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => api.get<AdminUserEnvelope>(`/api/admin/users/${userId}`),
    enabled: enabled && Boolean(userId),
    staleTime: 10_000,
  });
}

export function useSetAdminUserStatus(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountStatus: "active" | "suspended") =>
      api.post(`/api/admin/users/${userId}/status`, { accountStatus }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-user", userId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
    },
  });
}

export function useSetAdminUserPlan(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (plan: "free" | "starter" | "pro" | "power") =>
      api.put(`/api/admin/users/${userId}/plan`, { plan }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-user", userId] });
      await queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useAdminSupportTickets(status: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return useQuery({
    queryKey: ["admin-support-tickets", status],
    queryFn: () => api.get<SupportTicketsEnvelope>(`/api/admin/support/tickets${qs}`),
    staleTime: 10_000,
  });
}

export function useFeatureFlags() {
  return useQuery({
    queryKey: ["admin-feature-flags"],
    queryFn: () => api.get<FeatureFlagsEnvelope>("/api/admin/feature-flags"),
    staleTime: 10_000,
  });
}

export function useAnnouncements() {
  return useQuery({
    queryKey: ["admin-announcements"],
    queryFn: () => api.get<AnnouncementsEnvelope>("/api/admin/announcements"),
    staleTime: 10_000,
  });
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAnnouncementRequest) =>
      api.post<AnnouncementEnvelope>("/api/admin/announcements", body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useUpdateAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAnnouncementRequest }) =>
      api.put<AnnouncementEnvelope>(`/api/admin/announcements/${id}`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean; deleted: true }>(`/api/admin/announcements/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function usePlanConfigs() {
  return useQuery({
    queryKey: ["admin-plan-config"],
    queryFn: () => api.get<PlanConfigsEnvelope>("/api/admin/plan-config"),
    staleTime: 10_000,
  });
}

export function useSavePlanConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    // Keep the payload typed so the editor cannot drift away from the API
    // contract while we are still using hand-written fetch wrappers.
    mutationFn: (body: PlanConfig) => api.put<PlanConfigEnvelope>(`/api/admin/plan-config/${body.plan}`, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-plan-config"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}

// Keep each analytics panel on its own cache key so tabs can refetch
// independently without invalidating the whole admin analytics screen.
export function useAdminAnalyticsGrowth() {
  return useQuery({
    queryKey: ["admin-analytics", "growth"],
    queryFn: () => api.get<AdminAnalyticsEnvelope<GrowthAnalytics>>("/api/admin/analytics/growth"),
    staleTime: 60_000,
  });
}

export function useAdminAnalyticsMarketIntel() {
  return useQuery({
    queryKey: ["admin-analytics", "market-intel"],
    queryFn: () => api.get<AdminAnalyticsEnvelope<MarketIntelAnalytics>>("/api/admin/analytics/market-intel"),
    staleTime: 60_000,
  });
}

export function useAdminAnalyticsFeatureUsage() {
  return useQuery({
    queryKey: ["admin-analytics", "feature-usage"],
    queryFn: () => api.get<AdminAnalyticsEnvelope<FeatureUsageAnalytics>>("/api/admin/analytics/feature-usage"),
    staleTime: 60_000,
  });
}

export function useAdminAnalyticsSystemHealth() {
  return useQuery({
    queryKey: ["admin-analytics", "system-health"],
    queryFn: () => api.get<AdminAnalyticsEnvelope<SystemHealthAnalytics>>("/api/admin/analytics/system-health"),
    staleTime: 60_000,
  });
}

export function useAdminAnalyticsScanQuota() {
  return useQuery({
    queryKey: ["admin-analytics", "scan-quota"],
    queryFn: () => api.get<AdminAnalyticsEnvelope<ScanQuotaAnalytics>>("/api/admin/analytics/scan-quota"),
    staleTime: 60_000,
  });
}

export function useSaveFeatureFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put("/api/admin/feature-flags", body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-feature-flags"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-summary"] });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
  });
}

export const adminEmailWebhookKey = ["admin-email-webhook"] as const;

export function useAdminEmailWebhookSettings() {
  return useQuery({
    queryKey: adminEmailWebhookKey,
    queryFn: () => api.get<EmailWebhookSettings>("/api/admin/email-webhook"),
    staleTime: 30_000,
  });
}

export function useSaveAdminEmailWebhook() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { webhookUrl?: string; sharedSecret?: string }) =>
      api.put<{ ok: boolean }>("/api/admin/email-webhook", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: adminEmailWebhookKey });
    },
  });
}
