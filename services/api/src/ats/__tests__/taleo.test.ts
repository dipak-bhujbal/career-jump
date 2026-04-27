import { describe, it, expect } from "vitest";
import { stubFetch } from "./_helpers";
import { countTaleoJobs, fetchTaleoJobs, parseTaleoBoardUrl, validateTaleoConfig } from "../core/taleo";

const SAMPLE_HTML = `<html><body>
  <div class="taleo-jobsearch">
  <h1>FooCorp Careers</h1>
  <table>
    <tr>
      <td><a href="/careersection/foocorpext/jobdetail.ftl?job=ABC123&lang=en">Senior Software Engineer</a></td>
    </tr>
    <tr>
      <td><a href="/careersection/foocorpext/jobdetail.ftl?job=DEF456">Product Manager</a></td>
    </tr>
  </table>
  <p>Showing 2 Jobs</p>
</body></html>`;

describe("taleo adapter", () => {
  it("parses board URL", () => {
    const cfg = parseTaleoBoardUrl("https://foocorp.taleo.net/careersection/foocorpext/jobsearch.ftl");
    expect(cfg).toEqual({ host: "foocorp.taleo.net", section: "foocorpext" });
  });

  it("returns null for non-Taleo URLs", () => {
    expect(parseTaleoBoardUrl("https://example.com/jobs")).toBeNull();
  });

  it("validates", async () => {
    stubFetch([{ text: SAMPLE_HTML }]);
    expect(await validateTaleoConfig({ host: "foocorp.taleo.net", section: "foocorpext" })).toBe(true);
  });

  it("counts via 'X Jobs' regex", async () => {
    stubFetch([{ text: SAMPLE_HTML }]);
    expect(await countTaleoJobs({ host: "foocorp.taleo.net", section: "foocorpext" })).toBe(2);
  });

  it("extracts jobs from HTML", async () => {
    stubFetch([{ text: SAMPLE_HTML }]);
    const jobs = await fetchTaleoJobs({ host: "foocorp.taleo.net", section: "foocorpext" }, "FooCorp");
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      id: "ABC123",
      title: "Senior Software Engineer",
      url: "https://foocorp.taleo.net/careersection/foocorpext/jobdetail.ftl?job=ABC123&lang=en",
    });
  });
});
