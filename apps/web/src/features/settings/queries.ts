import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type EmailWebhookSettings = {
  ok: boolean;
  webhookUrl: string | null;
  sharedSecretConfigured: boolean;
};

export type SaveEmailWebhookPayload = {
  webhookUrl?: string;
  sharedSecret?: string;
};

export const emailWebhookKey = ["settings", "email-webhook"] as const;

export function useEmailWebhookSettings() {
  return useQuery({
    queryKey: emailWebhookKey,
    queryFn: () => api.get<EmailWebhookSettings>("/api/settings/email-webhook"),
    staleTime: 30_000,
  });
}

export function useSaveEmailWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SaveEmailWebhookPayload) =>
      api.put<{ ok: boolean }>("/api/settings/email-webhook", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: emailWebhookKey }),
  });
}
