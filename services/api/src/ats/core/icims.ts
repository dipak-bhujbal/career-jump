import type { JobPosting } from "../../types";

/**
 * iCIMS ATS adapter.
 *
 * iCIMS does NOT publish a public JSON API for posting lists. Strategy:
 *  1. The careers portal at https://{slug}.icims.com/jobs/search?ss=1 returns
 *     a paginated HTML list.
 *  2. Each <a class="iCIMS_JobsTable_..."> has the job title + URL + iCIMS job id.
 *  3. Total count is exposed in the page header text "of N jobs".
 *
 * For this initial cut we just parse the search results page. For full content
 * fetch each job's `/jobs/{id}/` page individually.
 *
 * Slug forms seen in the wild:
 *   https://{slug}.icims.com/jobs/search?ss=1
 *   https://careers-{slug}.icims.com/jobs/search?ss=1
 */

const HEADERS = {
  "User-Agent": "career-jump/1.0",
  Accept: "text/html,application/xhtml+xml",
};

function pageUrl(slug: string, host: "primary" | "careers", page = 1): string {
  const sub = host === "careers" ? `careers-${slug}` : slug;
  return `https://${sub}.icims.com/jobs/search?ss=1&searchPage=${page}`;
}

async function tryHosts(slug: string, page = 1): Promise<{ host: "primary" | "careers"; html: string } | null> {
  for (const host of ["primary", "careers"] as const) {
    try {
      const r = await fetch(pageUrl(slug, host, page), { headers: HEADERS });
      if (!r.ok) continue;
      const html = await r.text();
      // Heuristic check: must contain iCIMS markup
      if (/icims/i.test(html)) return { host, html };
    } catch {
      // fall through
    }
  }
  return null;
}

export async function validateIcimsSlug(
  companySlug: string
): Promise<{ source: "icims"; companySlug: string; host: "primary" | "careers" } | null> {
  const result = await tryHosts(companySlug, 1);
  if (!result) return null;
  return { source: "icims", companySlug, host: result.host };
}

export async function countIcimsJobs(companySlug: string): Promise<number> {
  const result = await tryHosts(companySlug, 1);
  if (!result) return 0;
  // "Showing 1 - 25 of 132 Jobs" or "of N jobs"
  const m =
    result.html.match(/of\s*([\d,]+)\s*Jobs/i) ||
    result.html.match(/(\d+)\s*Open\s*(?:Position|Job)/i) ||
    result.html.match(/Total\s*:\s*([\d,]+)/i);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

export async function fetchIcimsJobs(
  companySlug: string,
  companyName: string,
  options: { maxPages?: number } = {}
): Promise<JobPosting[]> {
  const maxPages = options.maxPages ?? 20;
  const out: JobPosting[] = [];
  let host: "primary" | "careers" = "primary";

  for (let page = 1; page <= maxPages; page++) {
    let html: string | null = null;
    if (page === 1) {
      const r = await tryHosts(companySlug, 1);
      if (!r) break;
      host = r.host;
      html = r.html;
    } else {
      try {
        const r = await fetch(pageUrl(companySlug, host, page), { headers: HEADERS });
        if (!r.ok) break;
        html = await r.text();
      } catch {
        break;
      }
    }

    // Anchor pattern: <a ... href="/jobs/{id}/{slug}/job">{Title}</a>
    const re = /<a[^>]+href="(\/jobs\/(\d+)\/[A-Za-z0-9_\-]+\/job)[^"]*"[^>]*>([^<]+)<\/a>/g;
    let m: RegExpExecArray | null;
    let foundOnPage = 0;
    while ((m = re.exec(html)) !== null) {
      const path = m[1];
      const id = m[2];
      const title = m[3].trim();
      const sub = host === "careers" ? `careers-${companySlug}` : companySlug;
      const url = `https://${sub}.icims.com${path}`;
      if (!out.some((j) => j.id === id)) {
        out.push({
          id,
          title,
          company: companyName,
          location: "",
          url,
          source: "icims" as never,
        } as JobPosting);
        foundOnPage++;
      }
    }
    if (foundOnPage === 0) break;
  }
  return out;
}
