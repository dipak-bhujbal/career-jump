import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/tenant", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/tenant")>("../../src/lib/tenant");
  return {
    ...actual,
    resolveRequestTenantContext: vi.fn(),
  };
});

import { saveRuntimeConfig } from "../../src/config";
import { saveInventory } from "../../src/services/inventory";
import { resolveRequestTenantContext } from "../../src/lib/tenant";
import { jobKey as buildJobKey } from "../../src/lib/utils";
import { handleRequest } from "../../src/routes";
import { userActor } from "../_helpers/actors";
import type { Env, InventorySnapshot, RuntimeConfig } from "../../src/types";

const resolveTenantContextMock = vi.mocked(resolveRequestTenantContext);

function makeKv(): KVNamespace {
  const store = new Map<string, string>();

  return {
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string, type?: string) => {
      const value = store.get(key) ?? null;
      if (value === null) return null;
      return type === "json" ? JSON.parse(value) : value;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async ({ prefix = "", limit = 1000 } = {}) => {
      const keys = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .slice(0, limit)
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: "" };
    }),
  } as unknown as KVNamespace;
}

function makeEnv(): Env {
  return {
    JOB_STATE: makeKv(),
    ATS_CACHE: makeKv(),
    CONFIG_STORE: makeKv(),
    DB: {} as D1Database,
    ASSETS: {
      fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
    },
  } as unknown as Env;
}

async function request(env: Env, pathname: string, init?: RequestInit): Promise<Response> {
  return handleRequest(new Request(`http://localhost${pathname}`, init), env);
}

async function post(env: Env, pathname: string, body: unknown): Promise<Response> {
  return request(env, pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedAppliedJob(env: Env): Promise<{ jobKey: string }> {
  const config: RuntimeConfig = {
    companies: [
      {
        company: "Cigna Group",
        enabled: true,
        source: "greenhouse",
        boardUrl: "https://job-boards.greenhouse.io/cigna",
      },
    ],
    jobtitles: { includeKeywords: ["manager"], excludeKeywords: [] },
  };

  const inventory: InventorySnapshot = {
    runAt: "2026-04-28T13:00:00.000Z",
    jobs: [
      {
        source: "greenhouse",
        company: "Cigna Group",
        id: "job-1",
        title: "Manager, Legal",
        location: "Remote",
        url: "https://job-boards.greenhouse.io/cigna/jobs/1",
        postedAt: "2026-04-28T12:00:00.000Z",
      },
    ],
    stats: {
      totalJobsMatched: 1,
      totalCompaniesConfigured: 1,
      totalCompaniesDetected: 1,
      totalFetched: 1,
      bySource: { greenhouse: 1 },
      byCompany: { "Cigna Group": 1 },
      keywordCounts: { manager: 1 },
    },
  };

  await saveRuntimeConfig(env, config, userActor.tenantId);
  await saveInventory(env, inventory, userActor.tenantId);

  const jobKey = buildJobKey(inventory.jobs[0]!);
  const response = await post(env, "/api/jobs/apply", { jobKey, notes: "Initial recruiter note" });
  expect(response.status).toBe(200);

  return { jobKey };
}

describe("api smoke applied note routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantContextMock.mockResolvedValue(userActor);
  });

  it("creates an initial note record when a job is applied with notes", async () => {
    const env = makeEnv();
    const { jobKey } = await seedAppliedJob(env);

    const response = await request(env, "/api/applied-jobs");
    expect(response.status).toBe(200);

    const payload = await response.json() as {
      jobs: Array<{ jobKey: string; notes: string; noteRecords: Array<{ id: string; text: string }> }>;
    };
    const applied = payload.jobs.find((job) => job.jobKey === jobKey);

    expect(applied?.notes).toBe("Initial recruiter note");
    expect(applied?.noteRecords).toHaveLength(1);
    expect(applied?.noteRecords[0]?.text).toBe("Initial recruiter note");
  });

  it("supports add, edit, and delete for applied-job note records", async () => {
    const env = makeEnv();
    const { jobKey } = await seedAppliedJob(env);

    const initialPayload = await (await request(env, "/api/applied-jobs")).json() as {
      jobs: Array<{ jobKey: string; noteRecords: Array<{ id: string; text: string }> }>;
    };
    const initialJob = initialPayload.jobs.find((job) => job.jobKey === jobKey)!;
    const originalNoteId = initialJob.noteRecords[0].id;

    const addResponse = await post(env, "/api/notes/add", { jobKey, text: "Follow-up scheduled" });
    expect(addResponse.status).toBe(200);
    const addPayload = await addResponse.json() as { record: { id: string; text: string } };
    expect(addPayload.record.text).toBe("Follow-up scheduled");

    const updateResponse = await post(env, "/api/notes/update", {
      jobKey,
      noteId: originalNoteId,
      text: "Initial recruiter note (edited)",
    });
    expect(updateResponse.status).toBe(200);

    const deleteResponse = await post(env, "/api/notes/delete", {
      jobKey,
      noteId: addPayload.record.id,
    });
    expect(deleteResponse.status).toBe(200);

    const finalPayload = await (await request(env, "/api/applied-jobs")).json() as {
      jobs: Array<{ jobKey: string; notes: string; noteRecords: Array<{ id: string; text: string }> }>;
    };
    const finalJob = finalPayload.jobs.find((job) => job.jobKey === jobKey)!;

    expect(finalJob.noteRecords).toHaveLength(1);
    expect(finalJob.noteRecords[0]?.id).toBe(originalNoteId);
    expect(finalJob.noteRecords[0]?.text).toBe("Initial recruiter note (edited)");
    expect(finalJob.notes).toContain("Initial recruiter note (edited)");
  });
});
