import { createFileRoute, useLocation } from "@tanstack/react-router";
import { BookOpen, ExternalLink } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/features/session/queries";

export const Route = createFileRoute("/admin-docs")({ component: AdminDocsRoute });

export function AdminDocsRoute() {
  const { data: me } = useMe();
  const location = useLocation();

  if (!me?.actor?.isAdmin) {
    return (
      <>
        <Topbar title="Docs" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Admin Docs" subtitle="Swagger/OpenAPI reference for the live admin and billing surface." />
      <AdminPageFrame
        currentLabel="Docs"
        currentPath={location.pathname}
        eyebrow="API Reference"
        title="Inspect the live API contract without leaving admin"
        description="This embeds the shipped Swagger surface so operators can verify routes, payloads, and admin-only endpoints while staying inside the product workspace."
        actions={(
          <a href="/docs" target="_blank" rel="noreferrer">
            <Button variant="outline">
              <ExternalLink size={14} />
              Open in new tab
            </Button>
          </a>
        )}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen size={16} />
              Swagger UI
            </CardTitle>
            <CardDescription>
              The iframe uses the same `/docs` asset the backend already serves, so the admin docs page stays pinned to the live OpenAPI document.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
              <iframe
                title="Career Jump API Docs"
                src="/docs"
                className="h-[75vh] w-full bg-white"
              />
            </div>
          </CardContent>
        </Card>
      </AdminPageFrame>
    </>
  );
}
