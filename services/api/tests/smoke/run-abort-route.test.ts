import { beforeEach, describe, expect, it, vi } from "vitest";
import { userActor } from "../_helpers/actors";
import type { Env } from "../../src/types";

const {
  loadActiveRunLockMock,
  clearActiveRunLockMock,
  requestRunAbortMock,
  recordAppLogMock,
} = vi.hoisted(() => ({
  loadActiveRunLockMock: vi.fn(),
  clearActiveRunLockMock: vi.fn(),
  requestRunAbortMock: vi.fn(),
  recordAppLogMock: vi.fn(),
}));

vi.mock("../../src/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/tenant")>("../../src/lib/tenant");
  return {
    ...actual,
    resolveRequestTenantContext: vi.fn(),
  };
});

vi.mock("../../src/storage", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage")>("../../src/storage");
  return {
    ...actual,
    loadActiveRunLock: loadActiveRunLockMock,
    clearActiveRunLock: clearActiveRunLockMock,
    requestRunAbort: requestRunAbortMock,
    recordAppLog: recordAppLogMock,
  };
});

import { resolveRequestTenantContext } from "../../src/lib/tenant";
import { handleRequest } from "../../src/routes";

const resolveTenantContextMock = vi.mocked(resolveRequestTenantContext);

const mockEnv = {
  JOB_STATE: {} as KVNamespace,
  ATS_CACHE: {} as KVNamespace,
  CONFIG_STORE: {} as KVNamespace,
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
} as unknown as Env;

async function requestAbort(body: Record<string, unknown>): Promise<Response> {
  return handleRequest(new Request("http://localhost/api/run/abort", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), mockEnv);
}

describe("api smoke run abort route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Route tests pin tenant auth at the seam so abort behavior is verified
    // without depending on Cognito/session setup.
    resolveTenantContextMock.mockResolvedValue(userActor);
  });

  it("marks queued runs aborted even before the active lock exists", async () => {
    loadActiveRunLockMock.mockResolvedValue(null);

    const response = await requestAbort({ runId: "run-queued-1" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      cleared: false,
      aborted: true,
      runId: "run-queued-1",
    });
    expect(requestRunAbortMock).toHaveBeenCalledWith(mockEnv, "run-queued-1");
    expect(clearActiveRunLockMock).not.toHaveBeenCalled();
  });

  it("clears the lock and records the abort for active runs", async () => {
    loadActiveRunLockMock.mockResolvedValue({
      runId: "run-active-1",
      triggerType: "manual",
      startedAt: "2026-04-30T00:00:00.000Z",
      totalCompanies: 5,
      fetchedCompanies: 2,
    });

    const response = await requestAbort({});

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      cleared: true,
      aborted: true,
      runId: "run-active-1",
    });
    expect(requestRunAbortMock).toHaveBeenCalledWith(mockEnv, "run-active-1");
    expect(clearActiveRunLockMock).toHaveBeenCalledWith(mockEnv);
    expect(recordAppLogMock).toHaveBeenCalledWith(mockEnv, expect.objectContaining({
      event: "manual_run_aborted",
      runId: "run-active-1",
    }));
  });
});
