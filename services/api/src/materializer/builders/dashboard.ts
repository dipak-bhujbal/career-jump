import { queryRows, jobsTableName } from "../../aws/dynamo";
import { nowISO, slugify } from "../../lib/utils";
import {
  DASHBOARD_SUMMARY_SK,
  DASHBOARD_SUMMARY_SCHEMA_VERSION,
  ENTITY_TYPE_DASHBOARD_SUMMARY,
  dashboardSummaryPk,
} from "../../storage/read-models";
import type { DashboardSummaryRow } from "../../storage/read-models";
import type { AppliedJobStatus } from "../../types";
import { queryAllVisibleJobRows } from "../readers";
import type { MaterializerBuilder } from "../types";

type TenantJobRow = {
  jobKey: string;
  status: AppliedJobStatus;
  company: string;
  appliedAt: string;
  lastStatusChangedAt?: string;
  record: {
    job?: { title?: string; company?: string; location?: string };
  };
};

function normalizeRatio(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

function summarizeCountItems(
  values: string[],
  limit: number,
): Array<{ label: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const v of values) {
    const key = v.trim() || "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

const STALE_APPLICATION_MS = 14 * 24 * 60 * 60 * 1000;

export const dashboardBuilder: MaterializerBuilder = {
  entityType: "dashboard_summary",

  async build(context): Promise<{ rowsWritten: number; details: Record<string, unknown> }> {
    const { message, upsertReadModelRow } = context;

    if (message.scope !== "tenant") {
      throw new Error("dashboard_summary builder requires scope=tenant");
    }

    const { tenantId } = message;
    const configVersion = message.configVersion ?? 1;
    const inventoryVersion = message.inventoryVersion ?? 1;
    const builtAt = nowISO();

    const tenantPk = `TENANT#${tenantId}`;
    const [appliedRows, visibleRows] = await Promise.all([
      queryRows<TenantJobRow>(
        jobsTableName(),
        "pk = :pk",
        { ":pk": tenantPk },
        { consistentRead: true },
      ).then((rows) => rows.filter((r) => r.status && r.appliedAt)),
      queryAllVisibleJobRows(tenantId),
    ]);

    // Applied-job metrics
    const appliedCount = appliedRows.length;
    const interviewCount = appliedRows.filter((r) => r.status === "Interview").length;
    const negotiationsCount = appliedRows.filter((r) => r.status === "Negotiations").length;
    const offeredCount = appliedRows.filter((r) => r.status === "Offered").length;
    const rejectedCount = appliedRows.filter((r) => r.status === "Rejected").length;
    const activeApplications = appliedCount - rejectedCount;
    const responseRate = normalizeRatio(
      interviewCount + negotiationsCount + offeredCount,
      appliedCount,
    );

    const appliedKeySet = new Set(appliedRows.map((r) => r.jobKey));

    // Inventory-derived metrics
    const availableJobs = visibleRows.filter((r) => !appliedKeySet.has(r.jobKey)).length;
    const totalFetched = visibleRows.length;
    const companiesDetected = new Set(visibleRows.map((r) => r.companyLower)).size;
    const newJobsLatestRun = visibleRows.filter((r) => r.isNew).length;
    const updatedJobsLatestRun = visibleRows.filter((r) => r.isUpdated).length;

    // Keyword counts from visible rows
    const keywordCounts: Record<string, number> = {};
    for (const r of visibleRows) {
      for (const kw of r.matchedKeywords) {
        keywordCounts[kw] = (keywordCounts[kw] ?? 0) + 1;
      }
    }

    // Companies by ATS (source) from visible rows
    const atsCounts: Record<string, number> = {};
    for (const r of visibleRows) {
      const ats = r.sourceLower || "unknown";
      atsCounts[ats] = (atsCounts[ats] ?? 0) + 1;
    }
    const companiesByAts = Object.entries(atsCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([ats, count]) => ({ ats, count }));

    // Top companies and locations from applied rows
    const topCompanies = summarizeCountItems(
      appliedRows.map((r) => r.company || r.record?.job?.company || "Unknown"),
      7,
    ).map(({ label, count }) => ({ company: label, count }));

    const topLocations = summarizeCountItems(
      appliedRows.map((r) => r.record?.job?.location || "Unknown"),
      6,
    );

    // Recent activity (last 6 by mutation timestamp)
    const sortedByRecent = [...appliedRows].sort((a, b) => {
      const at = Date.parse(a.lastStatusChangedAt ?? a.appliedAt) || 0;
      const bt = Date.parse(b.lastStatusChangedAt ?? b.appliedAt) || 0;
      return bt - at;
    });
    const recentActivity = sortedByRecent.slice(0, 6).map((r) => ({
      jobKey: r.jobKey,
      company: r.company || r.record?.job?.company || "",
      jobTitle: r.record?.job?.title || "",
      eventType: r.status,
      eventAt: r.lastStatusChangedAt ?? r.appliedAt,
    }));

    // Stale applications (active, not updated in 14 days)
    const nowMs = Date.now();
    const staleApplications = appliedRows
      .filter((r) => r.status !== "Offered" && r.status !== "Rejected")
      .filter((r) => nowMs - (Date.parse(r.lastStatusChangedAt ?? r.appliedAt) || 0) > STALE_APPLICATION_MS)
      .sort((a, b) => {
        const at = Date.parse(a.lastStatusChangedAt ?? a.appliedAt) || 0;
        const bt = Date.parse(b.lastStatusChangedAt ?? b.appliedAt) || 0;
        return at - bt;
      })
      .slice(0, 6)
      .map((r) => ({
        jobKey: r.jobKey,
        company: r.company || r.record?.job?.company || "",
        jobTitle: r.record?.job?.title || "",
        eventType: r.status,
        eventAt: r.lastStatusChangedAt ?? r.appliedAt,
      }));

    const statusBreakdown: Record<string, number> = {
      Applied: appliedRows.filter((r) => r.status === "Applied").length,
      Interview: interviewCount,
      Negotiations: negotiationsCount,
      Offered: offeredCount,
      Rejected: rejectedCount,
    };

    const builtInventoryRunAt = visibleRows.length > 0
      ? visibleRows.reduce((latest, r) => r.builtAt > latest ? r.builtAt : latest, "")
      : builtAt;

    const row: DashboardSummaryRow = {
      pk: dashboardSummaryPk(tenantId),
      sk: DASHBOARD_SUMMARY_SK,
      entityType: ENTITY_TYPE_DASHBOARD_SUMMARY,
      tenantId,
      kpis: {
        totalApplied: appliedCount,
        activeApplications,
        interviews: interviewCount,
        offers: offeredCount,
        responseRate,
        availableJobs,
        totalFetched,
        companiesDetected,
        newJobsLatestRun,
        updatedJobsLatestRun,
      },
      stageBreakdown: {
        applied: appliedRows.filter((r) => r.status === "Applied").length,
        interview: interviewCount,
        negotiations: negotiationsCount,
        offered: offeredCount,
        rejected: rejectedCount,
      },
      topCompanies,
      topLocations,
      recentActivity,
      staleApplications,
      companiesByAts,
      keywordCounts,
      statusBreakdown,
      builtInventoryRunAt,
      configVersion,
      inventoryVersion,
      rowSchemaVersion: DASHBOARD_SUMMARY_SCHEMA_VERSION,
      builtAt,
      sourceUpdatedAt: builtAt,
    };

    const written = await upsertReadModelRow({ row, table: "summaries" });

    return {
      rowsWritten: written ? 1 : 0,
      details: {
        appliedCount,
        availableJobs,
        totalFetched,
        companiesDetected,
        newJobsLatestRun,
        updatedJobsLatestRun,
      },
    };
  },
};
