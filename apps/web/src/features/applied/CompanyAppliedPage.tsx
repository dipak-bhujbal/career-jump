/**
 * CompanyAppliedPage renders the dedicated company pipeline surface for Wave D.
 *
 * Keeping the component outside the route file preserves route code-splitting
 * while still making the page easy to test directly.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, Building2, ExternalLink, LayoutGrid, LayoutList } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { AppliedKanban } from "@/features/applied/AppliedKanban";
import { useCompanyAppliedJobs, useUpdateStatus } from "@/features/applied/queries";
import { CompanyHoverCard } from "@/features/companies/CompanyHoverCard";
import { JobDetailsDrawer, type DrawerSource } from "@/features/jobs/JobDetailsDrawer";
import { type AppliedJob, type AppliedStatus } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { toast } from "@/components/ui/toast";

const STATUSES: AppliedStatus[] = ["Applied", "Interview", "Negotiations", "Offered", "Rejected"];

const STATUS_VARIANT: Record<AppliedStatus, "default" | "warning" | "success" | "danger" | "secondary"> = {
  Applied: "secondary",
  Interview: "warning",
  Negotiations: "default",
  Offered: "success",
  Rejected: "danger",
};

export function CompanyAppliedPage({ company }: { company: string }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [drawerJobKey, setDrawerJobKey] = useState<string | null>(null);
  const companyAppliedQuery = useCompanyAppliedJobs(company);
  const updateStatus = useUpdateStatus();

  const jobs = companyAppliedQuery.data?.jobs ?? [];
  const displayCompany = companyAppliedQuery.data?.company ?? company;
  const drawerAppl = drawerJobKey ? jobs.find((job) => job.jobKey === drawerJobKey) ?? null : null;
  const drawer: DrawerSource | null = drawerAppl ? { type: "applied", appl: drawerAppl } : null;
  const groupedJobs = useMemo(() => {
    const groups: Record<AppliedStatus, AppliedJob[]> = {
      Applied: [],
      Interview: [],
      Negotiations: [],
      Offered: [],
      Rejected: [],
    };
    for (const job of jobs) groups[job.status].push(job);
    return groups;
  }, [jobs]);

  function handleStatusChange(jobKey: string, status: AppliedStatus) {
    updateStatus.mutate(
      { jobKey, status },
      {
        onSuccess: () => toast(`Marked ${status}`),
        onError: (error) => toast(error instanceof Error ? error.message : "Update failed", "error"),
      },
    );
  }

  return (
    <>
      <Topbar
        title={companyAppliedQuery.isLoading ? "Company pipeline" : displayCompany}
        subtitle={`${jobs.length} application${jobs.length === 1 ? "" : "s"} in this company view`}
        actions={
          <a
            href="/applied"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-[hsl(var(--border))] px-3 text-xs font-medium transition-all duration-100 ease-out shadow-sm hover:-translate-y-px hover:bg-[hsl(var(--accent))] hover:shadow-md"
          >
            <ArrowLeft size={14} /> Back to Applied Jobs
          </a>
        }
      />
      <div className="space-y-4 p-6">
        <Card className="overflow-hidden">
          <CardContent className="flex flex-col gap-4 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--muted-foreground))]">
                <Building2 size={14} />
                Company view
              </div>
              <div className="text-lg font-semibold">
                <CompanyHoverCard company={displayCompany}>
                  <span className="hover:underline">{displayCompany}</span>
                </CompanyHoverCard>
              </div>
              <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
                This view stays pinned to one company and reflects the new `/api/companies/:company/applied` backend contract directly.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {STATUSES.map((status) => (
                <div key={status} className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2">
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{status}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">{groupedJobs[status].length}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            Track this company's pipeline as a board or a grouped list.
          </div>
          <div className="inline-flex overflow-hidden rounded-md border border-[hsl(var(--border))]">
            <button
              type="button"
              onClick={() => setView("board")}
              className={"inline-flex h-9 items-center gap-1.5 px-3 text-sm transition-colors " + (view === "board" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "hover:bg-[hsl(var(--accent))]")}
              aria-pressed={view === "board"}
            >
              <LayoutGrid size={14} /> Board
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={"inline-flex h-9 items-center gap-1.5 border-l border-[hsl(var(--border))] px-3 text-sm transition-colors " + (view === "list" ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" : "hover:bg-[hsl(var(--accent))]")}
              aria-pressed={view === "list"}
            >
              <LayoutList size={14} /> List
            </button>
          </div>
        </div>

        {companyAppliedQuery.isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
            ))}
          </div>
        )}

        {!companyAppliedQuery.isLoading && jobs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No applied jobs are tracked for this company yet.
            </CardContent>
          </Card>
        )}

        {!companyAppliedQuery.isLoading && jobs.length > 0 && view === "board" && (
          <AppliedKanban jobs={jobs} onSelect={(job) => setDrawerJobKey(job.jobKey)} />
        )}

        {!companyAppliedQuery.isLoading && jobs.length > 0 && view === "list" && (
          <div className="space-y-4">
            {STATUSES.map((status) => {
              const statusJobs = groupedJobs[status];
              if (statusJobs.length === 0) return null;
              return (
                <Card key={status}>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
                      <span className="text-sm font-normal text-[hsl(var(--muted-foreground))]">
                        {statusJobs.length} {statusJobs.length === 1 ? "application" : "applications"}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="border-t border-[hsl(var(--border))] p-0">
                    <div className="divide-y divide-[hsl(var(--border))]">
                      {statusJobs.map((job) => (
                        <div
                          key={job.jobKey}
                          onClick={() => setDrawerJobKey(job.jobKey)}
                          className="grid cursor-pointer grid-cols-12 items-center gap-3 px-5 py-3 transition-colors hover:bg-[hsl(var(--accent))]/40"
                        >
                          <div className="col-span-4 min-w-0">
                            <div className="text-sm text-[hsl(var(--muted-foreground))]">{displayCompany}</div>
                            <div className="truncate text-base font-medium">{job.job.jobTitle}</div>
                          </div>
                          <div className="col-span-2 text-sm text-[hsl(var(--muted-foreground))]">
                            <div>Applied</div>
                            <div>{formatShortDate(job.appliedAt)}</div>
                          </div>
                          <div className="col-span-2 text-sm text-[hsl(var(--muted-foreground))]">
                            {job.job.postedAtDate || job.job.postedAt ? (
                              <>
                                <div>Posted</div>
                                <div>{formatShortDate(job.job.postedAtDate ?? job.job.postedAt)}</div>
                              </>
                            ) : (
                              <span className="text-[hsl(var(--muted-foreground))]/50">—</span>
                            )}
                          </div>
                          <div className="col-span-2" onClick={(event) => event.stopPropagation()}>
                            <Select
                              value={job.status}
                              onChange={(event) => handleStatusChange(job.jobKey, event.target.value as AppliedStatus)}
                              className="h-9 text-sm"
                            >
                              {STATUSES.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="col-span-2 flex justify-end">
                            <a
                              href={job.job.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                              className="inline-flex items-center gap-1 text-sm text-[hsl(var(--primary))] hover:underline"
                            >
                              <ExternalLink size={13} /> Open
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <JobDetailsDrawer source={drawer} onClose={() => setDrawerJobKey(null)} />
    </>
  );
}
