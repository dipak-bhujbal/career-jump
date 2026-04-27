import type { JobPosting } from "../../types";
import { atsText } from "../shared/http";

/**
 * Oracle Taleo (legacy) adapter.
 *
 * No public JSON API. The careersection page renders job rows in HTML — we
 * parse them. URL form:
 *   https://{tenant}.taleo.net/careersection/{section}/jobsearch.ftl
 *
 * For deeper data we'd need to fetch each posting page individually, but for
 * count + list this is sufficient.
 */

const HEADERS = { Accept: "text/html,*/*" };

export type TaleoConfig = { host: string; section: string };

export function parseTaleoBoardUrl(url: string): TaleoConfig | null {
  try {
    const u = new URL(url);
    if (!/\.taleo\.net$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/careersection\/([^/]+)/);
    if (!m) return null;
    return { host: u.hostname, section: m[1] };
  } catch {
    return null;
  }
}

function listUrl(cfg: TaleoConfig): string {
  return `https://${cfg.host}/careersection/${cfg.section}/jobsearch.ftl?lang=en&showSearchSubmit=true&searchSubmit=true`;
}

export async function validateTaleoConfig(cfg: TaleoConfig): Promise<boolean> {
  const html = await atsText(listUrl(cfg), { headers: HEADERS });
  return html !== null && /taleo|jobsearch/i.test(html);
}

export async function countTaleoJobs(cfg: TaleoConfig): Promise<number> {
  const html = await atsText(listUrl(cfg), { headers: HEADERS });
  if (!html) return 0;
  // Taleo usually renders "X Jobs found" or similar
  const m = html.match(/(\d{1,5})\s*(?:Jobs?|Position|Opening)/i);
  return m ? Number(m[1]) : (html.match(/jobdetail\.ftl\?job=/g)?.length ?? 0);
}

export async function fetchTaleoJobs(cfg: TaleoConfig, companyName: string): Promise<JobPosting[]> {
  const html = await atsText(listUrl(cfg), { headers: HEADERS });
  if (!html) return [];
  // Each row: <a href="/careersection/{section}/jobdetail.ftl?job={id}" ...>{title}</a>
  const re = /<a[^>]+href="(\/careersection\/[^"]+jobdetail\.ftl\?job=([A-Za-z0-9-]+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const out: JobPosting[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    const id = m[2];
    const title = m[3].replace(/<[^>]+>/g, "").trim();
    if (!title || out.some((j) => j.id === id)) continue;
    out.push({
      id,
      title,
      company: companyName,
      location: "",
      url: `https://${cfg.host}${path}`,
      source: "taleo" as never,
    } as JobPosting);
  }
  return out;
}
