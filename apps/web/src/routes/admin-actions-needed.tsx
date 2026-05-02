import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownAZ, ArrowUpAZ, RefreshCw } from "lucide-react";
import { AdminPageFrame } from "@/components/admin/admin-shell";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { useMe } from "@/features/session/queries";
import { useAdminActionsNeeded } from "@/features/support/queries";
import type { AdminActionsNeededRow } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin-actions-needed")({ component: AdminActionsNeededRoute });

type SortColumn =
  | "company"
  | "ats"
  | "scanPool"
  | "failureCategory"
  | "failureCount"
  | "lastFailureAt"
  | "lastScannedAt"
  | "nextScanAt";
type SortDirection = "asc" | "desc";

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function AdminActionsNeededRoute() {
  const { data: me } = useMe();
  const isAdmin = me?.actor?.isAdmin === true;
  const { data, isLoading, isFetching, refetch } = useAdminActionsNeeded(isAdmin);
  const location = useLocation();
  const [companyFilter, setCompanyFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [atsFilter, setAtsFilter] = useState("");
  const [lastFailureRange, setLastFailureRange] = useState<DateRangeValue>({ from: null, to: null });
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<SortColumn>("lastFailureAt");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  function handleSort(column: SortColumn) {
    setPage(0);
    setSortBy((current) => {
      if (current === column) {
        setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDir(column === "failureCount" || column === "lastFailureAt" || column === "lastScannedAt" || column === "nextScanAt" ? "desc" : "asc");
      return column;
    });
  }

  const filteredRows = useMemo(() => {
    const normalizedCompanyFilter = companyFilter.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => {
      if (tierFilter && row.scanPool !== tierFilter) return false;
      if (atsFilter && (row.ats ?? "").toLowerCase() !== atsFilter) return false;
      if (categoryFilter && row.failureCategory !== categoryFilter) return false;
      if (normalizedCompanyFilter && !row.company.toLowerCase().includes(normalizedCompanyFilter)) return false;
      if (lastFailureRange.from || lastFailureRange.to) {
        if (!row.lastFailureAt) return false;
        const lastFailureMs = Date.parse(row.lastFailureAt);
        if (!Number.isFinite(lastFailureMs)) return false;
        if (lastFailureRange.from && lastFailureMs < lastFailureRange.from.getTime()) return false;
        if (lastFailureRange.to && lastFailureMs > (lastFailureRange.to.getTime() + 86_399_999)) return false;
      }
      return true;
    });
  }, [atsFilter, categoryFilter, companyFilter, data?.rows, lastFailureRange.from, lastFailureRange.to, tierFilter]);

  const atsOptions = useMemo(() => {
    return [...new Set((data?.rows ?? []).map((row) => (row.ats ?? "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }, [data?.rows]);

  const categoryOptions = useMemo(() => {
    return [...new Set((data?.rows ?? []).map((row) => row.failureCategory).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
  }, [data?.rows]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    const direction = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => compareActionRows(a, b, sortBy) * direction);
    return rows;
  }, [filteredRows, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const filteredTotals = useMemo(() => ({
    totalFailures: filteredRows.length,
    pausedCompanies: filteredRows.filter((row) => row.nextScanAt === null).length,
    overdueCompanies: filteredRows.filter((row) => row.lastScannedAt === null && row.nextScanAt !== null).length,
  }), [filteredRows]);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage]);

  if (!isAdmin) {
    return (
      <>
        <Topbar title="Actions Needed" subtitle="Admin access required" />
        <div className="p-6 text-sm text-[hsl(var(--muted-foreground))]">This workspace is only available to admin accounts.</div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Actions Needed" subtitle="Failed registry companies that need operator follow-up." />
      <AdminPageFrame
        currentLabel="Actions Needed"
        currentPath={location.pathname}
        eyebrow="Registry Operations"
        title="Review failed registry companies"
        description="Track companies that are overdue, failing, or automatically unscheduled after repeated scan failures."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Failures" value={filteredTotals.totalFailures.toLocaleString()} meta="Filtered failing registry companies" />
          <StatCard label="Paused" value={filteredTotals.pausedCompanies.toLocaleString()} meta="Removed from the automated scheduler after repeat failures" />
          <StatCard label="Overdue" value={filteredTotals.overdueCompanies.toLocaleString()} meta="Past due with no successful raw snapshot yet" />
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle size={16} />
                  Registry actions queue
                </CardTitle>
                <CardDescription>
                  Filter and sort failed registry companies by category, ATS, tier, and failure timing so admins can see what needs attention first.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isFetching}
                className="md:self-start"
              >
                <RefreshCw size={14} className={cn(isFetching && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_180px_160px_160px_220px_180px]">
              <Input
                value={companyFilter}
                onChange={(event) => {
                  setCompanyFilter(event.target.value);
                  setPage(0);
                }}
                placeholder="Filter by company name"
              />
              <Select
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All categories</option>
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </Select>
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
                value={atsFilter}
                onChange={(event) => {
                  setAtsFilter(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">All ATS</option>
                {atsOptions.map((ats) => (
                  <option key={ats} value={ats.toLowerCase()}>{ats}</option>
                ))}
              </Select>
              <DateRangePicker
                value={lastFailureRange}
                onChange={(next) => {
                  setLastFailureRange(next);
                  setPage(0);
                }}
                placeholder="Last failed between"
              />
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

            {(companyFilter || categoryFilter || tierFilter || atsFilter || lastFailureRange.from || lastFailureRange.to) ? (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCompanyFilter("");
                    setCategoryFilter("");
                    setTierFilter("");
                    setAtsFilter("");
                    setLastFailureRange({ from: null, to: null });
                    setPage(0);
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                    <SortableHeader column="company" label="Company" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="ats" label="ATS" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="scanPool" label="Tier" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="failureCategory" label="Category" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="failureCount" label="Failures" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="lastFailureAt" label="Last Failed" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="lastScannedAt" label="Last Scanned" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <SortableHeader column="nextScanAt" label="Next Scheduled Scan" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={`${row.company}:${row.ats ?? "unknown"}`} className="border-b border-[hsl(var(--border))]/60 align-top">
                      <td className="px-3 py-2 font-medium">{row.company}</td>
                      <td className="px-3 py-2">{row.ats ?? "Unknown"}</td>
                      <td className="px-3 py-2 capitalize">{row.scanPool}</td>
                      <td className="px-3 py-2">{row.failureCategory}</td>
                      <td className="px-3 py-2">{row.failureCount.toLocaleString()}</td>
                      <td className="px-3 py-2">{formatTimestamp(row.lastFailureAt, "No failure recorded")}</td>
                      <td className="px-3 py-2">{formatTimestamp(row.lastScannedAt, "Not scanned yet")}</td>
                      <td className="px-3 py-2">{formatTimestamp(row.nextScanAt, "Removed from scheduler")}</td>
                      <td className="px-3 py-2 text-[hsl(var(--muted-foreground))]">{row.failureReason ?? row.failureCategory}</td>
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
                No failing registry companies match the current filters.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </AdminPageFrame>
    </>
  );
}

function compareActionRows(a: AdminActionsNeededRow, b: AdminActionsNeededRow, sortBy: SortColumn): number {
  switch (sortBy) {
    case "company":
      return a.company.localeCompare(b.company);
    case "ats":
      return (a.ats ?? "").localeCompare(b.ats ?? "");
    case "scanPool":
      return a.scanPool.localeCompare(b.scanPool);
    case "failureCategory":
      return a.failureCategory.localeCompare(b.failureCategory);
    case "failureCount":
      return a.failureCount - b.failureCount;
    case "lastFailureAt":
      return compareIsoDates(a.lastFailureAt, b.lastFailureAt);
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

function formatTimestamp(value: string | null, fallback: string): string {
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
