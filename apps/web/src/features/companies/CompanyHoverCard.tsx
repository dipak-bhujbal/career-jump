/**
 * CompanyHoverCard — hover any company name to see logo + ATS + tier
 * + a link to the careers page.
 *
 * Logo source: Clearbit Logo API (free, no auth needed). We optimistically
 * try `https://logo.clearbit.com/{slug}.com`, falling back to the company
 * initials if the request fails.
 *
 * Wraps any child in a HoverCardTrigger; the popover lazy-loads from
 * `/api/registry/companies/<name>` only when the user hovers, so the
 * cost is zero on render.
 */
import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { TierTag } from "@/components/ui/tier-tag";
import { registryApi, type RegistryEntry } from "@/lib/api";
import { formatAtsLabel, companyKey } from "@/lib/utils";
import { relativeTime } from "@/lib/format";

interface CompanyHoverCardProps {
  company: string;
  children: ReactNode;
}

function clearbitDomain(company: string): string {
  // Heuristic: collapse spaces, lowercase, strip non-alnum, append .com.
  const slug = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${slug}.com`;
}

export function CompanyHoverCard({ company, children }: CompanyHoverCardProps) {
  const [open, setOpen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const entry = useQuery({
    queryKey: ["registry", "company", companyKey(company)],
    queryFn: () => registryApi.get<{ ok: boolean; entry: RegistryEntry }>(`/api/registry/companies/${encodeURIComponent(company)}`).then((r) => r.entry).catch(() => null),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <HoverCard openDelay={250} closeDelay={120} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent>
        <div className="flex items-start gap-3">
          {logoFailed ? (
            <div className="h-10 w-10 shrink-0 rounded-md bg-gradient-to-br from-blue-500/20 to-purple-500/20 grid place-items-center text-sm font-semibold">
              {company.slice(0, 2).toUpperCase()}
            </div>
          ) : (
            <img
              src={`https://logo.clearbit.com/${clearbitDomain(company)}`}
              alt=""
              onError={() => setLogoFailed(true)}
              className="h-10 w-10 rounded-md bg-white object-contain p-0.5 shrink-0"
              loading="lazy"
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-base truncate">{company}</div>
            {entry.data ? (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                {entry.data.ats && <Badge variant="default">{formatAtsLabel(entry.data.ats)}</Badge>}
                <TierTag tier={entry.data.tier} />
              </div>
            ) : (
              <div className="text-xs text-[hsl(var(--muted-foreground))]">{entry.isFetching ? "Loading…" : "Not in catalog"}</div>
            )}
          </div>
        </div>
        {entry.data && (
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))] space-y-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            {entry.data.total_jobs != null && (
              <div><span className="font-medium text-[hsl(var(--foreground))]">{entry.data.total_jobs.toLocaleString()}</span> open roles tracked</div>
            )}
            {entry.data.last_checked && (
              <div>Last scanned {relativeTime(entry.data.last_checked)}</div>
            )}
            {entry.data.board_url && (
              <a
                href={entry.data.board_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[hsl(var(--primary))] hover:underline truncate"
              >
                <ExternalLink size={11} /> Open careers page
              </a>
            )}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
