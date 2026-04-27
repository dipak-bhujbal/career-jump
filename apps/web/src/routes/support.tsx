import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy, MessageSquarePlus, Send } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCreateSupportMessage, useCreateSupportTicket, useSupportTicket, useSupportTickets } from "@/features/support/queries";
import { relativeTime } from "@/lib/format";

export const Route = createFileRoute("/support")({ component: SupportRoute });

function SupportRoute() {
  const { data, isLoading } = useSupportTickets();
  const tickets = data?.tickets ?? [];
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState("");
  const createTicket = useCreateSupportTicket();
  const createMessage = useCreateSupportMessage(selectedTicketId);
  const { data: ticketData } = useSupportTicket(selectedTicketId);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.ticketId === selectedTicketId) ?? ticketData?.ticket ?? null,
    [selectedTicketId, ticketData?.ticket, tickets]
  );

  async function handleCreateTicket() {
    if (!subject.trim() || !body.trim()) return;
    await createTicket.mutateAsync({ subject: subject.trim(), body: body.trim(), priority: "normal", tags: ["account"] });
    setSubject("");
    setBody("");
  }

  async function handleReply() {
    if (!selectedTicketId || !reply.trim()) return;
    await createMessage.mutateAsync({ body: reply.trim() });
    setReply("");
  }

  return (
    <>
      <Topbar title="Support" subtitle="Open tickets and replies stay tied to your account." />
      <div className="p-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquarePlus size={16} /> New Ticket</CardTitle>
              <CardDescription>Send product, account, billing, or scan issues to support.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe the issue"
                className="min-h-32 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              />
              <Button onClick={() => void handleCreateTicket()} disabled={createTicket.isPending || !subject.trim() || !body.trim()}>
                {createTicket.isPending ? "Sending…" : "Create ticket"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your Tickets</CardTitle>
              <CardDescription>{isLoading ? "Loading…" : `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {tickets.map((ticket) => (
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
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{relativeTime(ticket.updatedAt)}</div>
                </button>
              ))}
              {!tickets.length && <div className="text-sm text-[hsl(var(--muted-foreground))]">No tickets yet.</div>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LifeBuoy size={16} /> {selectedTicket?.subject || "Select a ticket"}</CardTitle>
            <CardDescription>
              {selectedTicket ? `Status: ${selectedTicket.status} · Updated ${relativeTime(selectedTicket.updatedAt)}` : "Replies from admins will appear here."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ticketData?.messages?.map((message) => (
              <div key={`${message.sender}-${message.createdAt}`} className="rounded-lg border border-[hsl(var(--border))] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{message.senderType === "admin" ? "Support" : "You"}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{relativeTime(message.createdAt)}</div>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm">{message.body}</div>
              </div>
            ))}
            {selectedTicket && (
              <div className="space-y-3 border-t border-[hsl(var(--border))] pt-4">
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Reply to this ticket"
                  className="min-h-28 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                />
                <Button onClick={() => void handleReply()} disabled={createMessage.isPending || !reply.trim()}>
                  <Send size={14} /> {createMessage.isPending ? "Sending…" : "Send reply"}
                </Button>
              </div>
            )}
            {!selectedTicket && <div className="text-sm text-[hsl(var(--muted-foreground))]">Choose a ticket to view the thread.</div>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

