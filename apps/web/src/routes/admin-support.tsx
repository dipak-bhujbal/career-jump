import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy, SendHorizonal } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useAdminSupportTickets, useCreateSupportMessage, useSupportTicket } from "@/features/support/queries";
import { useMe } from "@/features/session/queries";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/admin-support")({ component: AdminSupportRoute });

function AdminSupportRoute() {
  const { data: me } = useMe();
  const [status, setStatus] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const { data } = useAdminSupportTickets(status);
  const { data: selected } = useSupportTicket(selectedTicketId);
  const replyMutation = useCreateSupportMessage(selectedTicketId);

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Support Queue" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  async function handleReply() {
    if (!reply.trim()) return;
    await replyMutation.mutateAsync({ body: reply.trim() });
    setReply("");
  }

  return (
    <>
      <Topbar title="Support Queue" subtitle="Review tickets and answer users without leaving the admin workspace." />
      <div className="p-6 grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LifeBuoy size={16} /> Queue</CardTitle>
            <CardDescription>{data?.total ?? 0} ticket(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </Select>
            <div className="space-y-2">
              {(data?.tickets ?? []).map((ticket) => (
                <button
                  key={ticket.ticketId}
                  type="button"
                  onClick={() => setSelectedTicketId(ticket.ticketId)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition-colors ${selectedTicketId === ticket.ticketId ? "border-[hsl(var(--ring))] bg-[hsl(var(--accent))]/70" : "border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))]/40"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">{ticket.subject}</div>
                    <div className="text-xs uppercase text-[hsl(var(--muted-foreground))]">{ticket.status}</div>
                  </div>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{ticket.priority} · {relativeTime(ticket.updatedAt)}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selected?.ticket?.subject || "Select a ticket"}</CardTitle>
            <CardDescription>{selected?.ticket ? `${selected.ticket.status} · User ${selected.ticket.userId}` : "Ticket thread and admin replies appear here."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected?.messages?.map((message) => (
              <div key={`${message.sender}-${message.createdAt}`} className="rounded-lg border border-[hsl(var(--border))] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{message.senderType === "admin" ? "Admin reply" : "User message"}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{relativeTime(message.createdAt)}</div>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm">{message.body}</div>
              </div>
            ))}
            {selected?.ticket && (
              <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply as admin"
                  className="min-h-28 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                />
                <Button onClick={() => void handleReply()} disabled={replyMutation.isPending || !reply.trim()}>
                  <SendHorizonal size={14} /> {replyMutation.isPending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            )}
            {!selected?.ticket && <div className="text-sm text-[hsl(var(--muted-foreground))]">Choose a support ticket from the queue.</div>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

