import { enqueueMaterializerMessages } from "./queue";
import type { MaterializerMessage } from "./types";

export function versionFromIso(value?: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

export function tenantConfigChangeMessages(input: {
  tenantId: string;
  triggeredAt: string;
  configVersion: number;
  inventoryVersion?: number;
  jobIdPrefix: string;
}): MaterializerMessage[] {
  // Config changes should immediately refresh the tenant-facing read models
  // even when no fresh inventory run has occurred yet.
  const inventoryVersion = input.inventoryVersion ?? input.configVersion;
  return [
    {
      scope: "tenant",
      tenantId: input.tenantId,
      jobId: `${input.jobIdPrefix}-visible-jobs`,
      entityType: "visible_jobs",
      triggerType: "config_change",
      triggeredAt: input.triggeredAt,
      configVersion: input.configVersion,
      inventoryVersion,
    },
    {
      scope: "tenant",
      tenantId: input.tenantId,
      jobId: `${input.jobIdPrefix}-dashboard`,
      entityType: "dashboard_summary",
      triggerType: "config_change",
      triggeredAt: input.triggeredAt,
      configVersion: input.configVersion,
      inventoryVersion,
    },
  ];
}

export function tenantScanCompleteMessages(input: {
  tenantId: string;
  triggeredAt: string;
  configVersion: number;
  inventoryVersion: number;
  jobIdPrefix: string;
}): MaterializerMessage[] {
  return [
    {
      scope: "tenant",
      tenantId: input.tenantId,
      jobId: `${input.jobIdPrefix}-visible-jobs`,
      entityType: "visible_jobs",
      triggerType: "scan_complete",
      triggeredAt: input.triggeredAt,
      configVersion: input.configVersion,
      inventoryVersion: input.inventoryVersion,
    },
    {
      scope: "tenant",
      tenantId: input.tenantId,
      jobId: `${input.jobIdPrefix}-dashboard`,
      entityType: "dashboard_summary",
      triggerType: "scan_complete",
      triggeredAt: input.triggeredAt,
      configVersion: input.configVersion,
      inventoryVersion: input.inventoryVersion,
    },
  ];
}

export function registryScanCompleteMessages(input: {
  triggeredAt: string;
  inventoryVersion: number;
  jobIdPrefix: string;
  companySlug?: string;
}): MaterializerMessage[] {
  // Global registry projections do not have tenant config, so they share a
  // fixed configVersion and advance only on registry scan state changes.
  return [
    {
      scope: "global",
      companySlug: input.companySlug,
      jobId: `${input.jobIdPrefix}-registry-status`,
      entityType: "registry_status",
      triggerType: "scan_complete",
      triggeredAt: input.triggeredAt,
      configVersion: 1,
      inventoryVersion: input.inventoryVersion,
    },
    {
      scope: "global",
      companySlug: input.companySlug,
      jobId: `${input.jobIdPrefix}-actions-needed`,
      entityType: "registry_actions_needed",
      triggerType: "scan_complete",
      triggeredAt: input.triggeredAt,
      configVersion: 1,
      inventoryVersion: input.inventoryVersion,
    },
  ];
}

export async function enqueueDualBuildMessages(messages: MaterializerMessage[]): Promise<number> {
  await enqueueMaterializerMessages(messages);
  return messages.length;
}
