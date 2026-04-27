import type { JobPosting } from "../../types";
import { atsFetch, atsText } from "../shared/http";

/**
 * SAP SuccessFactors adapter.
 *
 * Public RSS feed (legacy but still widely available):
 *   https://career5.successfactors.com/career?company={slug}&career_ns=jobsearch&rss=1
 *
 * The board URL form in our registry is typically:
 *   https://career[N].successfactors.com/career?company={slug}
 * where N is 0..7. We extract `company` from the query string.
 */

const HEADERS = { Accept: "application/rss+xml,application/xml,text/xml,*/*" };

export type SfConfig = { host: string; company: string };

export function parseSuccessfactorsBoardUrl(url: string): SfConfig | null {
  try {
    const u = new URL(url);
    if (!/career[0-9]*\.successfactors\.com/i.test(u.hostname)) return null;
    const company = u.searchParams.get("company");
    if (!company) return null;
    return { host: u.hostname, company };
  } catch {
    return null;
  }
}

function rssUrl(cfg: SfConfig): string {
  return `https://${cfg.host}/career?company=${encodeURIComponent(cfg.company)}&career_ns=jobsearch&rss=1`;
}

export async function validateSuccessfactorsConfig(cfg: SfConfig): Promise<boolean> {
  const r = await atsFetch(rssUrl(cfg), { headers: HEADERS });
  return r.ok;
}

export async function countSuccessfactorsJobs(cfg: SfConfig): Promise<number> {
  const xml = await atsText(rssUrl(cfg), { headers: HEADERS });
  if (!xml) return 0;
  const m = xml.match(/<item[\s>]/g);
  return m ? m.length : 0;
}

export async function fetchSuccessfactorsJobs(cfg: SfConfig, companyName: string): Promise<JobPosting[]> {
  const xml = await atsText(rssUrl(cfg), { headers: HEADERS });
  if (!xml) return [];
  // Lightweight RSS parsing — pull each <item> block and extract title/link/pubDate
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return items
    .map((block, i) => {
      const title = (block.match(/<title>(?:<!\[CDATA\[)?([^<\]]+)/) ?? [, ""])[1].trim();
      const link = (block.match(/<link>([^<]+)/) ?? [, ""])[1].trim();
      const pub = (block.match(/<pubDate>([^<]+)/) ?? [, ""])[1].trim();
      const desc = (block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) ?? [, ""])[1];
      // Extract job id from link
      const idMatch = link.match(/jobReqId=(\d+)/) ?? link.match(/[\/=](\d{4,})$/);
      const id = idMatch ? idMatch[1] : `sf-${cfg.company}-${i}`;
      // Try to parse "City, State, Country" from desc
      const locMatch = desc.match(/Location:\s*([^<\n]+)/);
      return {
        id,
        title,
        company: companyName,
        location: locMatch ? locMatch[1].trim() : "",
        url: link,
        source: "successfactors" as never,
        postedAt: pub || undefined,
      } as JobPosting;
    })
    .filter((j) => j.title && j.url);
}
