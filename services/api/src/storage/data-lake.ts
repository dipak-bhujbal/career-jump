import { scanAllRows, registryTableName } from "../aws/dynamo";
import { loadAppliedJobs } from "./core";
import type { AppliedJobRecord, Env, RegistryCompanyScanState } from "../types";

type ScanStateRow = RegistryCompanyScanState & { pk: string; sk: string };

export async function exportAppliedJobRecords(env: Env, tenantId?: string): Promise<AppliedJobRecord[]> {
  const jobs = await loadAppliedJobs(env, tenantId);
  return Object.values(jobs).sort((a, b) => (a.appliedAt < b.appliedAt ? 1 : -1));
}

export async function exportScanStateRecords(): Promise<RegistryCompanyScanState[]> {
  const rows = await scanAllRows<ScanStateRow>(registryTableName(), {
    filterExpression: "sk = :sk",
    expressionAttributeValues: { ":sk": "REGISTRY-SCAN-STATE" },
  });
  return rows.map(({ pk: _pk, sk: _sk, ...state }) => state as RegistryCompanyScanState);
}

export function toNdjson(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}
