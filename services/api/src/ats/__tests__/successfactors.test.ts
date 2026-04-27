import { describe, it, expect } from "vitest";
import { stubFetch } from "./_helpers";
import {
  countSuccessfactorsJobs,
  fetchSuccessfactorsJobs,
  parseSuccessfactorsBoardUrl,
  validateSuccessfactorsConfig,
} from "../core/successfactors";

const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>FooCorp Jobs</title>
    <item>
      <title><![CDATA[Senior Software Engineer]]></title>
      <link>https://career5.successfactors.com/sfcareer/jobreqcareerpv?jobId=12345</link>
      <pubDate>Wed, 01 Apr 2026 12:00:00 GMT</pubDate>
      <description>Location: Boston, MA, USA</description>
    </item>
    <item>
      <title>Product Manager</title>
      <link>https://career5.successfactors.com/sfcareer/jobreqcareerpv?jobId=67890</link>
      <pubDate>Tue, 31 Mar 2026 09:00:00 GMT</pubDate>
      <description>Location: Remote</description>
    </item>
  </channel>
</rss>`;

describe("successfactors adapter", () => {
  it("parses board URL", () => {
    const cfg = parseSuccessfactorsBoardUrl("https://career5.successfactors.com/career?company=FOOCORP");
    expect(cfg).toEqual({ host: "career5.successfactors.com", company: "FOOCORP" });
  });

  it("returns null for non-SF URLs", () => {
    expect(parseSuccessfactorsBoardUrl("https://example.com/careers")).toBeNull();
  });

  it("validates", async () => {
    stubFetch([{ text: SAMPLE_RSS }]);
    expect(await validateSuccessfactorsConfig({ host: "career5.successfactors.com", company: "FOOCORP" })).toBe(true);
  });

  it("counts items", async () => {
    stubFetch([{ text: SAMPLE_RSS }]);
    expect(await countSuccessfactorsJobs({ host: "career5.successfactors.com", company: "FOOCORP" })).toBe(2);
  });

  it("parses items into JobPosting", async () => {
    stubFetch([{ text: SAMPLE_RSS }]);
    const jobs = await fetchSuccessfactorsJobs(
      { host: "career5.successfactors.com", company: "FOOCORP" },
      "FooCorp",
    );
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe("Senior Software Engineer");
    expect(jobs[0].id).toBe("12345");
    expect(jobs[0].location).toBe("Boston, MA, USA");
  });
});
