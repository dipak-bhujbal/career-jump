import { beforeEach, describe, expect, it, vi } from "vitest";

const ConditionalCheckFailedExceptionMock = class ConditionalCheckFailedException extends Error {};
const getRowMock = vi.fn();
const putRowMock = vi.fn();
const loadRegistryCacheMock = vi.fn();
const getByCompanyMock = vi.fn();
const listAllMock = vi.fn();

vi.mock("../../src/aws/dynamo", () => ({
  ConditionalCheckFailedException: ConditionalCheckFailedExceptionMock,
  registryTableName: vi.fn(() => "registry-table"),
  getRow: getRowMock,
  putRow: putRowMock,
  scanAllRows: vi.fn(),
}));

vi.mock("../../src/storage/registry-cache", () => ({
  loadRegistryCache: loadRegistryCacheMock,
  getByCompany: getByCompanyMock,
  listAll: listAllMock,
}));

describe("integration registry scan state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    loadRegistryCacheMock.mockResolvedValue(undefined);
    listAllMock.mockReturnValue([]);
  });

  it("loads a pending default state for unseen companies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce(null);
    getByCompanyMock.mockReturnValue({
      company: "Airtable",
      ats: "greenhouse",
      board_url: "https://boards.greenhouse.io/airtable",
      sample_url: null,
      rank: 50,
      tier: "TIER1_VERIFIED",
      total_jobs: null,
      sheet: "Registry",
      source: "curated",
      last_checked: null,
    });
    const { loadRegistryCompanyScanState } = await import("../../src/storage/registry-scan-state");

    await expect(loadRegistryCompanyScanState("Airtable", "greenhouse")).resolves.toMatchObject({
      company: "Airtable",
      adapterId: "greenhouse",
      scanPool: "warm",
      priority: "normal",
      status: "pending",
      failureCount: 0,
      lastFetchedCount: 0,
      nextScanAt: "2026-04-28T11:15:00.000Z",
      staleAfterAt: "2026-04-28T11:15:00.000Z",
    });
    expect(putRowMock).toHaveBeenCalledWith("registry-table", expect.objectContaining({
      pk: "COMPANY#airtable",
      sk: "REGISTRY-SCAN-STATE",
      status: "pending",
    }), expect.objectContaining({
      conditionExpression: "attribute_not_exists(pk)",
    }));
  });

  it("marks success with next-scan metadata based on the scan pool", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce(null);
    const { markRegistryCompanyScanSuccess } = await import("../../src/storage/registry-scan-state");

    await markRegistryCompanyScanSuccess("Airtable", {
      adapterId: "greenhouse",
      fetchedCount: 42,
      scanPool: "warm",
      priority: "high",
    });

    expect(putRowMock).toHaveBeenLastCalledWith("registry-table", expect.objectContaining({
      pk: "COMPANY#airtable",
      sk: "REGISTRY-SCAN-STATE",
      adapterId: "greenhouse",
      scanPool: "warm",
      priority: "high",
      status: "healthy",
      failureCount: 0,
      lastFetchedCount: 42,
      lastScanAt: "2026-04-28T11:15:00.000Z",
      lastSuccessAt: "2026-04-28T11:15:00.000Z",
      nextScanAt: "2026-04-28T17:15:00.000Z",
      staleAfterAt: "2026-04-28T23:15:00.000Z",
    }));
  });

  it("marks failures with incremental backoff and 24h-window failure counts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce({
      company: "Airtable",
      companySlug: "airtable",
      adapterId: "greenhouse",
      scanPool: "cold",
      priority: "normal",
      status: "healthy",
      nextScanAt: "2026-04-28T11:15:00.000Z",
      staleAfterAt: "2026-04-28T11:15:00.000Z",
      lastScanAt: "2026-04-28T10:00:00.000Z",
      lastSuccessAt: "2026-04-28T10:00:00.000Z",
      lastFailureAt: "2026-04-28T09:00:00.000Z",
      lastFailureReason: "blocked",
      failureCount: 1,
      lastFetchedCount: 5,
      updatedAt: "2026-04-28T10:00:00.000Z",
    });
    const { markRegistryCompanyScanFailure } = await import("../../src/storage/registry-scan-state");

    await markRegistryCompanyScanFailure("Airtable", {
      adapterId: "greenhouse",
      failureReason: "upstream timeout",
    });

    expect(putRowMock).toHaveBeenLastCalledWith("registry-table", expect.objectContaining({
      adapterId: "greenhouse",
      status: "failing",
      failureCount: 2,
      lastFailureReason: "upstream timeout",
      lastFailureAt: "2026-04-28T11:15:00.000Z",
      nextScanAt: "2026-04-28T13:15:00.000Z",
    }));
  });

  it("resets failureCount when the previous failure is outside the 24h window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce({
      company: "Airtable",
      companySlug: "airtable",
      adapterId: "greenhouse",
      scanPool: "cold",
      priority: "normal",
      status: "failing",
      nextScanAt: "2026-04-28T11:15:00.000Z",
      staleAfterAt: "2026-04-29T03:15:00.000Z",
      lastScanAt: "2026-04-27T09:00:00.000Z",
      lastSuccessAt: "2026-04-27T09:00:00.000Z",
      lastFailureAt: "2026-04-27T09:00:00.000Z",
      lastFailureReason: "blocked",
      failureCount: 3,
      lastFetchedCount: 5,
      updatedAt: "2026-04-27T09:00:00.000Z",
    });
    const { markRegistryCompanyScanFailure } = await import("../../src/storage/registry-scan-state");

    await markRegistryCompanyScanFailure("Airtable", {
      adapterId: "greenhouse",
      failureReason: "upstream timeout",
    });

    expect(putRowMock).toHaveBeenLastCalledWith("registry-table", expect.objectContaining({
      status: "failing",
      failureCount: 1,
      lastFailureReason: "upstream timeout",
      nextScanAt: "2026-04-28T12:15:00.000Z",
    }));
  });

  it("moves companies into paused after repeated failures and schedules a 24h re-probe from the latest failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce({
      company: "Airtable",
      companySlug: "airtable",
      adapterId: "greenhouse",
      scanPool: "cold",
      priority: "normal",
      status: "failing",
      nextScanAt: "2026-04-28T11:15:00.000Z",
      staleAfterAt: "2026-04-29T03:15:00.000Z",
      lastScanAt: "2026-04-28T10:00:00.000Z",
      lastSuccessAt: "2026-04-28T08:00:00.000Z",
      lastFailureAt: "2026-04-28T09:00:00.000Z",
      lastFailureReason: "blocked",
      failureCount: 4,
      lastFetchedCount: 5,
      updatedAt: "2026-04-28T10:00:00.000Z",
    });
    const { markRegistryCompanyScanFailure } = await import("../../src/storage/registry-scan-state");

    await markRegistryCompanyScanFailure("Airtable", {
      adapterId: "greenhouse",
      failureReason: "upstream timeout",
    });

    expect(putRowMock).toHaveBeenLastCalledWith("registry-table", expect.objectContaining({
      status: "paused",
      failureCount: 5,
      lastFailureAt: "2026-04-28T11:15:00.000Z",
      nextScanAt: "2026-04-29T11:15:00.000Z",
    }));
  });

  it("resets failureCount to zero on success after a paused state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce({
      company: "Airtable",
      companySlug: "airtable",
      adapterId: "greenhouse",
      scanPool: "cold",
      priority: "normal",
      status: "paused",
      nextScanAt: "2026-04-29T11:15:00.000Z",
      staleAfterAt: "2026-04-29T03:15:00.000Z",
      lastScanAt: "2026-04-28T11:15:00.000Z",
      lastSuccessAt: "2026-04-28T08:00:00.000Z",
      lastFailureAt: "2026-04-28T11:15:00.000Z",
      lastFailureReason: "blocked",
      failureCount: 5,
      lastFetchedCount: 5,
      updatedAt: "2026-04-28T11:15:00.000Z",
    });
    const { markRegistryCompanyScanSuccess, markRegistryCompanyScanFailure } = await import("../../src/storage/registry-scan-state");

    await markRegistryCompanyScanSuccess("Airtable", {
      adapterId: "greenhouse",
      fetchedCount: 10,
      scanPool: "cold",
    });
    expect(putRowMock).toHaveBeenLastCalledWith("registry-table", expect.objectContaining({
      status: "healthy",
      failureCount: 0,
      lastFailureReason: null,
      lastFetchedCount: 10,
    }));

    getRowMock.mockResolvedValueOnce({
      company: "Airtable",
      companySlug: "airtable",
      adapterId: "greenhouse",
      scanPool: "cold",
      priority: "normal",
      status: "healthy",
      nextScanAt: "2026-04-30T03:15:00.000Z",
      staleAfterAt: "2026-04-30T19:15:00.000Z",
      lastScanAt: "2026-04-29T11:15:00.000Z",
      lastSuccessAt: "2026-04-29T11:15:00.000Z",
      lastFailureAt: "2026-04-28T11:15:00.000Z",
      lastFailureReason: null,
      failureCount: 0,
      lastFetchedCount: 10,
      updatedAt: "2026-04-29T11:15:00.000Z",
    });
    await markRegistryCompanyScanFailure("Airtable", {
      adapterId: "greenhouse",
      failureReason: "upstream timeout",
    });
    expect(putRowMock).toHaveBeenLastCalledWith("registry-table", expect.objectContaining({
      status: "failing",
      failureCount: 1,
      nextScanAt: "2026-04-29T12:15:00.000Z",
    }));
  });

  it("treats conditional first-write races as a no-op", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce(null);
    putRowMock.mockRejectedValueOnce(new ConditionalCheckFailedExceptionMock("already initialized"));
    const { loadRegistryCompanyScanState } = await import("../../src/storage/registry-scan-state");

    await expect(loadRegistryCompanyScanState("Airtable", "greenhouse")).resolves.toMatchObject({
      company: "Airtable",
      status: "pending",
    });
  });

  it("marks misconfigured companies as unschedulable until repaired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T11:15:00.000Z"));
    getRowMock.mockResolvedValueOnce(null);
    const { markRegistryCompanyScanMisconfigured } = await import("../../src/storage/registry-scan-state");

    await markRegistryCompanyScanMisconfigured("Broken Co", {
      adapterId: "greenhouse",
      failureReason: "No ATS mapping was resolved for this company.",
    });

    expect(putRowMock).toHaveBeenCalledWith("registry-table", expect.objectContaining({
      pk: "COMPANY#broken-co",
      sk: "REGISTRY-SCAN-STATE",
      adapterId: "greenhouse",
      status: "misconfigured",
      nextScanAt: null,
      lastFailureReason: "No ATS mapping was resolved for this company.",
      failureCount: 1,
    }));
  });
});
