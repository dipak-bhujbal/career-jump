import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type AdminSummaryEnvelope,
  type AdminUserEnvelope,
  type AdminUsersEnvelope,
  type FeatureFlagsEnvelope,
  type SupportTicketEnvelope,
  type SupportTicketsEnvelope,
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

export function useAdminSummary() {
  return useQuery({
    queryKey: ["admin-summary"],
    queryFn: () => api.get<AdminSummaryEnvelope>("/api/admin/summary"),
    staleTime: 10_000,
  });
}

export function useAdminUsers(query: string) {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  return useQuery({
    queryKey: ["admin-users", query],
    queryFn: () => api.get<AdminUsersEnvelope>(`/api/admin/users${qs}`),
    staleTime: 10_000,
  });
}

export function useAdminUser(userId: string | null) {
  return useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => api.get<AdminUserEnvelope>(`/api/admin/users/${userId}`),
    enabled: Boolean(userId),
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
