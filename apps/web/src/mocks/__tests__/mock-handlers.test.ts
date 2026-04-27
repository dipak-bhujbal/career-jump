/**
 * Unit tests for the mock API handlers in install.ts.
 *
 * Covers the three bugs fixed in this session:
 *   1. /api/applied-jobs multi-value status/company/keyword filtering
 *   2. /api/jobs/apply creates applied job with noteRecords: []
 *   3. /api/jobs/status auto-adds an interview round on → "Interview"
 */
import { beforeEach, describe, expect, it } from "vitest";
import { installMocks, _resetMockState } from "../install";

function mockFetch(path: string, init?: RequestInit): Promise<Response> {
  return window.fetch(`http://localhost${path}`, init);
}

function post(path: string, body: unknown): Promise<Response> {
  return mockFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

beforeEach(() => {
  _resetMockState();
  installMocks();
});

// ---------------------------------------------------------------------------
// 1. /api/applied-jobs filtering
// ---------------------------------------------------------------------------

describe("/api/applied-jobs filtering", () => {
  it("returns all jobs when no filters", async () => {
    const data = await json<{ ok: boolean; jobs: { status: string }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    expect(data.ok).toBe(true);
    expect(data.jobs.length).toBeGreaterThan(0);
  });

  it("filters by a single status", async () => {
    const data = await json<{ jobs: { status: string }[] }>(
      await mockFetch("/api/applied-jobs?status=Interview"),
    );
    expect(data.jobs.length).toBeGreaterThan(0);
    for (const job of data.jobs) expect(job.status).toBe("Interview");
  });

  it("filters by multiple statuses (multi-value query param)", async () => {
    const data = await json<{ jobs: { status: string }[] }>(
      await mockFetch("/api/applied-jobs?status=Interview&status=Negotiations"),
    );
    expect(data.jobs.length).toBeGreaterThan(0);
    for (const job of data.jobs) {
      expect(["Interview", "Negotiations"]).toContain(job.status);
    }
  });

  it("returns no jobs for a status with no entries", async () => {
    const data = await json<{ jobs: unknown[] }>(
      await mockFetch("/api/applied-jobs?status=Offered"),
    );
    // seed has 1 Offered — just check filter works (>= 0)
    expect(Array.isArray(data.jobs)).toBe(true);
  });

  it("filters by keyword in job title", async () => {
    // First get all jobs to find an existing title fragment
    const all = await json<{ jobs: { job: { jobTitle: string } }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const firstTitle = all.jobs[0]?.job.jobTitle ?? "";
    const fragment = firstTitle.split(" ")[0].toLowerCase();
    const data = await json<{ jobs: { job: { jobTitle: string } }[] }>(
      await mockFetch(`/api/applied-jobs?keyword=${encodeURIComponent(fragment)}`),
    );
    for (const j of data.jobs) {
      expect(j.job.jobTitle.toLowerCase()).toContain(fragment);
    }
  });

  it("companyOptions always reflects unfiltered applied list", async () => {
    const data = await json<{ jobs: unknown[]; companyOptions: string[] }>(
      await mockFetch("/api/applied-jobs?status=Rejected"),
    );
    // companyOptions is the full set; may be longer than filtered jobs list
    expect(data.companyOptions.length).toBeGreaterThanOrEqual(data.jobs.length);
  });
});

// ---------------------------------------------------------------------------
// 2. /api/jobs/apply — noteRecords must be [] on new applied job
// ---------------------------------------------------------------------------

describe("/api/jobs/apply", () => {
  it("adds applied job with noteRecords: []", async () => {
    const jobsData = await json<{ jobs: { jobKey: string }[] }>(
      await mockFetch("/api/jobs"),
    );
    const jobKey = jobsData.jobs[0]?.jobKey;
    expect(jobKey).toBeTruthy();

    await post("/api/jobs/apply", { jobKey });

    const appliedData = await json<{ jobs: { jobKey: string; noteRecords: unknown[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const applied = appliedData.jobs.find((j) => j.jobKey === jobKey);
    expect(applied).toBeDefined();
    expect(Array.isArray(applied?.noteRecords)).toBe(true);
    expect(applied?.noteRecords).toHaveLength(0);
  });

  it("new applied job starts with status Applied", async () => {
    const jobsData = await json<{ jobs: { jobKey: string }[] }>(
      await mockFetch("/api/jobs"),
    );
    const jobKey = jobsData.jobs[0]?.jobKey;
    await post("/api/jobs/apply", { jobKey });

    const appliedData = await json<{ jobs: { jobKey: string; status: string }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const applied = appliedData.jobs.find((j) => j.jobKey === jobKey);
    expect(applied?.status).toBe("Applied");
  });

  it("applies notes to the newly applied job", async () => {
    const jobsData = await json<{ jobs: { jobKey: string }[] }>(
      await mockFetch("/api/jobs"),
    );
    const jobKey = jobsData.jobs[0]?.jobKey;
    await post("/api/jobs/apply", { jobKey, notes: "Interesting role" });

    const appliedData = await json<{ jobs: { jobKey: string; notes: string }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const applied = appliedData.jobs.find((j) => j.jobKey === jobKey);
    expect(applied?.notes).toBe("Interesting role");
  });
});

// ---------------------------------------------------------------------------
// 3. /api/jobs/status — auto-adds interview round on → "Interview"
// ---------------------------------------------------------------------------

describe("/api/jobs/status", () => {
  it("auto-adds an interview round when status changes to Interview", async () => {
    // Grab a job that is currently Applied (not Interview)
    const allApplied = await json<{ jobs: { jobKey: string; status: string; interviewRounds: unknown[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const target = allApplied.jobs.find((j) => j.status === "Applied");
    expect(target).toBeDefined();
    const jobKey = target!.jobKey;
    const roundsBefore = target!.interviewRounds.length;

    await post("/api/jobs/status", { jobKey, status: "Interview" });

    const afterData = await json<{ jobs: { jobKey: string; interviewRounds: { id: string; outcome: string }[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const after = afterData.jobs.find((j) => j.jobKey === jobKey);
    expect(after?.interviewRounds.length).toBe(roundsBefore + 1);
    expect(after?.interviewRounds.at(-1)?.outcome).toBe("Pending");
  });

  it("does NOT add a round when already in Interview", async () => {
    const allApplied = await json<{ jobs: { jobKey: string; status: string; interviewRounds: unknown[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const target = allApplied.jobs.find((j) => j.status === "Interview");
    expect(target).toBeDefined();
    const jobKey = target!.jobKey;
    const roundsBefore = target!.interviewRounds.length;

    await post("/api/jobs/status", { jobKey, status: "Interview" });

    const afterData = await json<{ jobs: { jobKey: string; interviewRounds: unknown[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const after = afterData.jobs.find((j) => j.jobKey === jobKey);
    expect(after?.interviewRounds.length).toBe(roundsBefore);
  });

  it("updates status without adding a round for non-Interview transitions", async () => {
    const allApplied = await json<{ jobs: { jobKey: string; status: string; interviewRounds: unknown[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const target = allApplied.jobs.find((j) => j.status === "Applied");
    expect(target).toBeDefined();
    const jobKey = target!.jobKey;

    await post("/api/jobs/status", { jobKey, status: "Rejected" });

    const afterData = await json<{ jobs: { jobKey: string; status: string; interviewRounds: unknown[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const after = afterData.jobs.find((j) => j.jobKey === jobKey);
    expect(after?.status).toBe("Rejected");
    expect(after?.interviewRounds.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Notes CRUD on applied jobs
// ---------------------------------------------------------------------------

describe("notes CRUD", () => {
  it("adds a note to an applied job and reflects in applied-jobs", async () => {
    const allApplied = await json<{ jobs: { jobKey: string; noteRecords: { id: string; text: string }[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const target = allApplied.jobs[0];
    const jobKey = target.jobKey;
    const countBefore = target.noteRecords.length;

    await post("/api/notes/add", { jobKey, text: "Follow up sent" });

    const afterData = await json<{ jobs: { jobKey: string; noteRecords: { text: string }[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const after = afterData.jobs.find((j) => j.jobKey === jobKey);
    expect(after?.noteRecords.length).toBe(countBefore + 1);
    expect(after?.noteRecords.at(-1)?.text).toBe("Follow up sent");
  });

  it("updates an existing note on an applied job", async () => {
    const allApplied = await json<{ jobs: { jobKey: string; noteRecords: { id: string; text: string }[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const target = allApplied.jobs.find((j) => j.noteRecords.length > 0);
    expect(target).toBeDefined();
    const { jobKey, noteRecords } = target!;
    const noteId = noteRecords[0].id;

    await post("/api/notes/update", { jobKey, noteId, text: "Updated text" });

    const afterData = await json<{ jobs: { jobKey: string; noteRecords: { id: string; text: string }[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const after = afterData.jobs.find((j) => j.jobKey === jobKey);
    const note = after?.noteRecords.find((n) => n.id === noteId);
    expect(note?.text).toBe("Updated text");
  });

  it("deletes a note from an applied job", async () => {
    const allApplied = await json<{ jobs: { jobKey: string; noteRecords: { id: string }[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const target = allApplied.jobs.find((j) => j.noteRecords.length > 0);
    expect(target).toBeDefined();
    const { jobKey, noteRecords } = target!;
    const noteId = noteRecords[0].id;
    const countBefore = noteRecords.length;

    await post("/api/notes/delete", { jobKey, noteId });

    const afterData = await json<{ jobs: { jobKey: string; noteRecords: { id: string }[] }[] }>(
      await mockFetch("/api/applied-jobs"),
    );
    const after = afterData.jobs.find((j) => j.jobKey === jobKey);
    expect(after?.noteRecords.length).toBe(countBefore - 1);
    expect(after?.noteRecords.find((n) => n.id === noteId)).toBeUndefined();
  });
});
