import type {
  CompanyIndexRow,
  DashboardSummaryRow,
  ReadModelFreshnessFields,
  RegistryActionsNeededRow,
  RegistryStatusRow,
  VisibleJobRow,
} from "../storage/read-models";

export const MATERIALIZER_ENTITY_TYPES = [
  "visible_jobs",
  "dashboard_summary",
  "registry_status",
  "registry_actions_needed",
  "company_index",
] as const;

export type MaterializerEntityType = (typeof MATERIALIZER_ENTITY_TYPES)[number];

export const MATERIALIZER_TRIGGER_TYPES = [
  "backfill",
  "scan_complete",
  "config_change",
  "manual_repair",
] as const;

export type MaterializerTriggerType = (typeof MATERIALIZER_TRIGGER_TYPES)[number];

export type MaterializerScope =
  | {
    scope: "tenant";
    tenantId: string;
    companySlug?: string;
  }
  | {
    scope: "global";
    companySlug?: string;
  };

export type MaterializerMessage = MaterializerScope & {
  jobId: string;
  entityType: MaterializerEntityType;
  triggerType: MaterializerTriggerType;
  triggeredAt: string;
  configVersion?: number;
  inventoryVersion?: number;
};

export type MaterializerMetricStatus = "success" | "error";

export type MaterializerMetric = {
  metricName: string;
  entityType: MaterializerEntityType;
  triggerType: MaterializerTriggerType;
  scope: MaterializerScope["scope"];
  status: MaterializerMetricStatus;
  rowsWritten: number;
  durationMs: number;
  jobId: string;
  tenantId?: string;
  companySlug?: string;
  details?: Record<string, unknown>;
};

export type MaterializerBuilderResult = {
  rowsWritten: number;
  details?: Record<string, unknown>;
};

export type UpsertReadModelRowInput<Row extends MaterializerRow> = {
  row: Row;
  table: "jobs" | "summaries";
};

export type MaterializerBuilderContext = {
  message: MaterializerMessage;
  upsertReadModelRow: <Row extends MaterializerRow>(
    input: UpsertReadModelRowInput<Row>
  ) => Promise<boolean>;
};

export type MaterializerBuilder = {
  entityType: MaterializerEntityType;
  build(context: MaterializerBuilderContext): Promise<MaterializerBuilderResult>;
};

export type MaterializerRow =
  | VisibleJobRow
  | DashboardSummaryRow
  | RegistryStatusRow
  | RegistryActionsNeededRow
  | CompanyIndexRow;

export type MaterializerFreshnessRow = ReadModelFreshnessFields & {
  pk: string;
  sk: string;
  entityType: string;
};
