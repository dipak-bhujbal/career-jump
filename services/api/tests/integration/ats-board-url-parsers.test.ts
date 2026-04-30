import { afterEach, describe, expect, it, vi } from "vitest";
import { countIcimsJobs, fetchIcimsJobs } from "../../src/ats/core/icims";
import { countPhenomJobs, fetchPhenomJobs } from "../../src/ats/core/phenom";

describe("board-url ATS parsers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows the iCIMS iframe listing flow and paginates through rel=next links", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body><iframe src="/jobs/search?ss=1&amp;in_iframe=1"></iframe></body></html>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html>
            <head><link rel="next" href="/jobs/search?pr=1&amp;in_iframe=1"></head>
            <body>
              <div>Showing 1 - 25 of 63 Jobs</div>
              <a href="/jobs/101/manager-role/job">Senior Manager</a>
              <a href="/jobs/102/program-manager/job"><span>Program</span> Manager</a>
            </body>
          </html>
        `,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => `
          <html>
            <body>
              <a href="/jobs/103/ops-manager/job">Operations Manager</a>
            </body>
          </html>
        `,
      });
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchIcimsJobs("https://career-celanese.icims.com/jobs/search?ss=1", "Celanese", { maxPages: 2 });

    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.id)).toEqual(["101", "102", "103"]);
    expect(jobs[0].url).toBe("https://career-celanese.icims.com/jobs/101/manager-role/job");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://career-celanese.icims.com/jobs/search?ss=1",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://career-celanese.icims.com/jobs/search?ss=1&in_iframe=1",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://career-celanese.icims.com/jobs/search?pr=1&in_iframe=1",
      expect.any(Object),
    );
  });

  it("normalizes iCIMS landing pages like /jobs/intro back to /jobs/search", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "<html><body>Showing 1 - 25 of 10 Jobs</body></html>",
      });
    vi.stubGlobal("fetch", fetchMock);

    await countIcimsJobs("https://us-careers-rivian.icims.com/jobs/intro");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://us-careers-rivian.icims.com/jobs/search?ss=1",
      expect.any(Object),
    );
  });

  it("tries same-origin custom-domain Phenom API candidates before giving up", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalHits: 1,
          jobs: [
            {
              jobId: "9001",
              title: "Senior Manager",
              location: "Charlotte, NC",
              url: "/job/9001",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ totalHits: 1, jobs: [{ jobId: "9001", title: "Senior Manager" }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchPhenomJobs("https://jobs.centene.com/us/en/jobs/", "Centene", { maxPages: 1 });
    const total = await countPhenomJobs("https://jobs.centene.com/us/en/jobs/");

    expect(jobs).toHaveLength(1);
    expect(jobs[0].url).toBe("https://jobs.centene.com/job/9001");
    expect(total).toBe(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://jobs.centene.com/us/en/api/jobs?from=0&size=50");
    expect(fetchMock.mock.calls[1][0]).toBe("https://jobs.centene.com/us/en/jobs/api/jobs?from=0&size=50");
  });
});
