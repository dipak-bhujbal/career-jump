import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWorkdayJobs } from "../../src/ats/core/workday";

function makePosting(index: number) {
  return {
    title: `Role ${index}`,
    externalPath: `/job/Cambridge-MA/Role-${index}_REQ${index}`,
    locationsText: "Cambridge, MA",
    postedOn: "Posted Today",
    remoteType: "Hybrid",
    bulletFields: [`REQ${index}`],
    jobReqId: `REQ${index}`,
  };
}

describe("workday pagination", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.unstubAllEnvs();
    vi.stubEnv("WORKDAY_CF_WORKER_URL", "");
    vi.stubEnv("WORKDAY_CF_WORKER_SECRET", "");
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { offset?: number; limit?: number };
      const offset = Number(payload.offset ?? 0);

      if (offset === 0) {
        return new Response(JSON.stringify({
          total: 256,
          jobPostings: Array.from({ length: 20 }, (_, index) => makePosting(index)),
        }), { status: 200 });
      }

      if (offset === 20) {
        return new Response(JSON.stringify({
          total: 0,
          jobPostings: Array.from({ length: 20 }, (_, index) => makePosting(index + 20)),
        }), { status: 200 });
      }

      if (offset === 40) {
        return new Response(JSON.stringify({
          total: 0,
          jobPostings: Array.from({ length: 5 }, (_, index) => makePosting(index + 40)),
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        total: 0,
        jobPostings: [],
      }), { status: 200 });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps paging when later Workday pages regress total to zero", async () => {
    const promise = fetchWorkdayJobs("Biogen", {
      host: "biibhr.wd3.myworkdayjobs.com",
      tenant: "biibhr",
      site: "external",
      workdayBaseUrl: "https://biibhr.wd3.myworkdayjobs.com/external",
    });

    await vi.runAllTimersAsync();
    const jobs = await promise;

    expect(jobs).toHaveLength(45);
    expect(jobs[0]?.title).toBe("Role 0");
    expect(jobs.at(-1)?.title).toBe("Role 44");
  });
});
