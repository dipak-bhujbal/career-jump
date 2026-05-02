import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownAZ, ArrowUpAZ, Database } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useMe } from "@/features/session/queries";
import { useAdminRegistryStatus } from "@/features/support/queries";
import type { AdminRegistryStatusRow } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-registry-status")({ component: AdminRegistryStatusRoute });

type SortColumn = "registryId" | "company" | "ats" | "scanPool" | "totalJobs" | "lastScannedAt" | "nextScanAt";
type SortDirection = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function AdminRegistryStatusRoute() {
  const { data: me } = useMe();
  const isAdmin = me?.actor?.isAdmin === true;
  const { data, isLoading } = useAdminRegistryStatus(isAdmin);
  const location = useLocation();
  const [companyFilter, setCompanyFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortColumn>("lastScannedAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  function handleSort(column: SortColumn) {
    setPage(0);
    setSortBy((current) => {
      if (current === column) {
        setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDir(column === "lastScannedAt" || column === "nextScanAt" || column === "totalJobs" ? "desc" : "asc");
      return column;
    });
  }

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Registry Status" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  const filteredRows = useMemo(() => {
    const normalizedCompanyFilter = companyFilter.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      if (tierFilter && row.scanPool !== tierFilter) return false;
      if (normalizedCompanyFilter && !row.company.toLowerCase().includes(normalizedCompanyFilter)) return false;
      return true;
    });
  }, [companyFilter, data?.rows, tierFilter]);

  const sortedRows = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    const rows = [...filteredRows];
    rows.sort((a, b) => compareRegistryRows(a, b, sortBy) * direction);
    return rows;
  }, [filteredRows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const filteredTotals = useMemo(() => {
    let currentCompanies = 0;
    let currentJobs = 0;
    let lastScannedAt: string | null = null;
    for (const row of filteredRows) {
      if (row.totalJobs > 0) currentCompanies += 1;
      currentJobs += row.totalJobs;
      if (row.lastScannedAt && (!lastScannedAt || row.lastScannedAt.localeCompare(lastScannedAt) > 0)) {
        lastScannedAt = row.lastScannedAt;
      }
    }
    return {
      totalCompanies: filteredRows.length,
      currentCompanies,
      currentJobs,
      lastScannedAt,
    };
  }, [filteredRows]);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage]);

  return (
    <>
      <Topbar title="Registry Status" subtitle="Per-company raw inventory coverage and freshness." />
      <AdminPageFrame
        currentLabel="Registry Status"
        currentPath={location.pathname}
        eyebrow="Registry Operations"
        title="Inspect the shared registry scan inventory"
        description="Review how many jobs each registry company currently has in Dynamo, which companies have an active raw snapshot, and when each company was last refreshed."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard
            label="Registry companies"
            value={filteredTotals.totalCompanies.toLocaleString()}
            meta="Filtered companies tracked in the registry table"
          />
          <StatCard
            label="Currently scanned"
            value={filteredTotals.currentCompanies.toLocaleString()}
            meta="Filtered companies with a current raw snapshot in Dynamo"
          />
          <StatCard
            label="Current raw jobs"
            value={filteredTotals.currentJobs.toLocaleString()}
            meta={filteredTotals.lastScannedAt ? `Latest refresh ${new Date(filteredTotals.lastScannedAt).toLocaleString()}` : "No scans recorded yet"}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database size={16} />
              Company scan status
            </CardTitle>
            <CardDescription>
              Filter, sort, and page through registry coverage. Each row shows the current shared job count, scan tier, and next scheduled refresh for that company.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
              <Input
                value={companyFilter}
                onChange={(event) => {
                  setCompanyFilter(event.target.value);
                  setPage(0);
                }}
                placeholder="Filter by company name"
              />
              <Select
                value={tierFilter}
                onChange={(event) => {
                  setTierFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All tiers</option>
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cold">Cold</option>
              </Select>
              <Select
                value={String(pageSize)}
                onChange={(event) => {
                  setPageSize(Number(event.target.value) || 10);
                  setPage(0);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option} / page</option>
                ))}
              </Select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                    <SortableHeader column="registryId" label="Registry ID" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="company" label="Company" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="ats" label="ATS" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="scanPool" label="Tier" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="totalJobs" label="Current Jobs" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="lastScannedAt" label="Last Scanned" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="nextScanAt" label="Next Scheduled Scan" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={row.registryId} className="border-b border-[hsl(var(--border))]/60 align-top">
                      <td className="px-3 py-2 font-mono text-[12px] text-[hsl(var(--muted-foreground))]">{row.registryId}</td>
                      <td className="px-3 py-2 font-medium">{row.company}</td>
                      <td className="px-3 py-2">{row.ats ?? "Unknown"}</td>
                      <td className="px-3 py-2 capitalize">{row.scanPool}</td>
                      <td className="px-3 py-2">{row.totalJobs.toLocaleString()}</td>
                      <td className="px-3 py-2">{formatScanTimestamp(row.lastScannedAt, "Not scanned yet")}</td>
                      <td className="px-3 py-2">{formatScanTimestamp(row.nextScanAt, "Not scheduled")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-[hsl(var(--muted-foreground))]">
                Showing {sortedRows.length === 0 ? 0 : safePage * pageSize + 1}-{Math.min(sortedRows.length, safePage * pageSize + pagedRows.length)} of {sortedRows.length.toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  Previous
                </Button>
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  Page {(safePage + 1).toLocaleString()} of {totalPages.toLocaleString()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={safePage + 1 >= totalPages}
                  onClick={() => setPage((current) => (current + 1 < totalPages ? current + 1 : current))}
                >
                  Next
                </Button>
              </div>
            </div>

            {!isLoading && sortedRows.length === 0 ? (
              <div className="px-3 py-6 text-sm text-[hsl(var(--muted-foreground))]">
                No registry companies match the current filters.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </AdminPageFrame>
    </>
  );
}

function compareRegistryRows(a: AdminRegistryStatusRow, b: AdminRegistryStatusRow, sortBy: SortColumn): number {
  switch (sortBy) {
    case "registryId":
      return a.registryId.localeCompare(b.registryId);
    case "company":
      return a.company.localeCompare(b.company);
    case "ats":
      return (a.ats ?? "").localeCompare(b.ats ?? "");
    case "scanPool":
      return a.scanPool.localeCompare(b.scanPool);
    case "totalJobs":
      return a.totalJobs - b.totalJobs;
    case "lastScannedAt":
      return compareIsoDates(a.lastScannedAt, b.lastScannedAt);
    case "nextScanAt":
      return compareIsoDates(a.nextScanAt, b.nextScanAt);
    default:
      return 0;
  }
}

function compareIsoDates(a: string | null, b: string | null): number {
  const aMs = a ? Date.parse(a) : Number.NEGATIVE_INFINITY;
  const bMs = b ? Date.parse(b) : Number.NEGATIVE_INFINITY;
  return aMs - bMs;
}

function formatScanTimestamp(value: string | null, fallback: string): string {
  return value ? new Date(value).toLocaleString() : fallback;
}

function SortableHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSort,
}: {
  column: SortColumn;
  label: string;
  sortBy: SortColumn;
  sortDir: SortDirection;
  onSort: (column: SortColumn) => void;
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 hover:text-[hsl(var(--foreground))]",
          sortBy === column && "text-[hsl(var(--foreground))]",
        )}
        onClick={() => onSort(column)}
      >
        {label}
        {sortBy === column ? (sortDir === "asc" ? <ArrowUpAZ size={12} /> : <ArrowDownAZ size={12} />) : null}
      </button>
    </th>
  );
}

function StatCard({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-sm text-[hsl(var(--muted-foreground))]">
        {meta}
      </CardContent>
    </Card>
  );
}
