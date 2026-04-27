import type { JobPosting } from "../../types";
import { atsText } from "../shared/http";
import { registerAdapter } from "../shared/types";

/**
 * Sitemap-based job discovery.
 *
 * Many career sites publish a sitemap-jobs.xml or similar — Google requires
 * indexable URLs for Google for Jobs, so this is more common than people realize.
 *
 * Strategy: try a list of known sitemap paths under the board URL's origin.
 * If found, treat each <loc> as a job posting URL. Title is left blank for
 * downstream enrichment (or you can fetch each URL individually).
 */

const CANDIDATES = [
  "/sitemap-jobs.xml",
  "/sitemap_jobs.xml",
  "/jobs/sitemap.xml",
  "/careers/sitemap.xml",
  "/sitemap-careers.xml",
  "/sitemap.xml",
];

async function discoverSitemap(boardUrl: string): Promise<string | null> {
  let origin: string;
  try {
    origin = new URL(boardUrl).origin;
  } catch {
    return null;
  }
  for (const path of CANDIDATES) {
    const xml = await atsText(`${origin}${path}`, { headers: { Accept: "application/xml,text/xml,*/*" } });
    if (!xml) continue;
    if (/<urlset[\s>]/i.test(xml) || /<sitemapindex[\s>]/i.test(xml)) return xml;
  }
  return null;
}

function extractJobUrls(xml: string): string[] {
  // Heuristic: take any <loc> URL containing "job", "career", "position", "apply"
  const re = /<loc>([^<]+)<\/loc>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const u = m[1].trim();
    if (/\b(job|career|position|apply|opening|vacanc)/i.test(u)) out.push(u);
  }
  return [...new Set(out)];
}

export async function fetchSitemapJobs(boardUrl: string, companyName: string): Promise<JobPosting[]> {
  const xml = await discoverSitemap(boardUrl);
  if (!xml) return [];
  return extractJobUrls(xml).map((url, i) => ({
    id: `sitemap-${i}-${url.split("/").pop() ?? i}`,
    title: "(see posting)",
    company: companyName,
    location: "",
    url,
    source: "custom-sitemap" as never,
  }));
}

export async function countSitemapJobs(boardUrl: string): Promise<number> {
  const xml = await discoverSitemap(boardUrl);
  return xml ? extractJobUrls(xml).length : 0;
}

registerAdapter({
  id: "custom-sitemap",
  kind: "custom",
  async validate(c) {
    return (await discoverSitemap(c.boardUrl)) !== null;
  },
  count(c) {
    return countSitemapJobs(c.boardUrl);
  },
  fetchJobs(c, company) {
    return fetchSitemapJobs(c.boardUrl, company);
  },
});
