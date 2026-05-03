import type { JobPosting } from "../../types";

/**
 * iCIMS ATS adapter.
 *
 * Modern iCIMS boards often render a lightweight wrapper page first and then
 * load the real listing UI inside an iframe with `in_iframe=1`. The older
 * slug-only implementation fetched the wrapper page directly, which worked for
 * a narrow subset of boards but missed current sites like Celanese.
 *
 * The adapter now uses the canonical board URL directly so it can:
 *   1. normalize `intro` / `login` / `dashboard` URLs back to `/jobs/search`
 *   2. follow the iframe handoff when the first page is only a wrapper shell
 *   3. follow the server-provided `rel="next"` pagination links instead of
 *      guessing page parameters that vary across tenants
 */

const HEADERS = {
  "User-Agent": "career-jump/1.0",
  Accept: "text/html,application/xhtml+xml",
};

function normalizeIcimsBoardUrl(boardUrl: string): string | null {
  try {
    const url = new URL(boardUrl);
    if (!/\.icims\.com$/i.test(url.hostname)) return null;

    // Saved registry rows often point at landing pages like `/jobs/intro` or
    // `/jobs/dashboard`. Normalize those back to the canonical search route so
    // the parser always starts from the jobs listing entrypoint.
    if (!/\/jobs\/search$/i.test(url.pathname)) {
      url.pathname = "/jobs/search";
      url.search = "";
    }

    url.searchParams.set("ss", url.searchParams.get("ss") || "1");
    url.searchParams.delete("searchPage");
    return url.toString();
  } catch {
    return null;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractIframeUrl(html: string, pageUrl: string): string | null {
  const iframeMatch =
    html.match(/<iframe[^>]+src="([^"]*in_iframe=1[^"]*)"/i) ||
    html.match(/<iframe[^>]+src='([^']*in_iframe=1[^']*)'/i);
  if (!iframeMatch?.[1]) return null;
  try {
    return new URL(iframeMatch[1].replace(/&amp;/g, "&"), pageUrl).toString();
  } catch {
    return null;
  }
}

function extractNextPageUrl(html: string, pageUrl: string): string | null {
  const nextMatch =
    html.match(/<link[^>]+rel="next"[^>]+href="([^"]+)"/i) ||
    html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*(?:Next|›|&gt;)\s*<\/a>/i);
  if (!nextMatch?.[1]) return null;
  try {
    return new URL(nextMatch[1].replace(/&amp;/g, "&"), pageUrl).toString();
  } catch {
    return null;
  }
}

function parseCount(html: string): number {
  const match =
    html.match(/of\s*([\d,]+)\s*Jobs/i) ||
    html.match(/(\d+)\s*Open\s*(?:Position|Job)/i) ||
    html.match(/Total\s*:\s*([\d,]+)/i);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function parseJobsFromHtml(html: string, companyName: string, pageUrl: string): JobPosting[] {
  const jobs: JobPosting[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a[^>]+href="([^"]*\/jobs\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1];
    const id = match[2];
    const title = stripHtml(match[3]);
    if (!id || !title || seen.has(id)) continue;

    let url = href;
    try {
      url = new URL(href.replace(/&amp;/g, "&"), pageUrl).toString();
    } catch {
      // Keep the raw href when URL construction fails; the job id/title are
      // still useful for parser coverage and logging.
    }

    seen.add(id);
    jobs.push({
      id,
      title,
      company: companyName,
      location: "",
      url,
      source: "icims" as never,
    } as JobPosting);
  }

  return jobs;
}

async function fetchIcimsPage(pageUrl: string): Promise<{ html: string; resolvedPageUrl: string } | null> {
  try {
    const response = await fetch(pageUrl, { headers: HEADERS });
    if (!response.ok) return null;
    let html = await response.text();
    let resolvedPageUrl = pageUrl;

    // Wrapper pages hand off the actual job-listing UI to an iframe. Follow it
    // once so downstream parsing only sees the real listing markup.
    const iframeUrl = extractIframeUrl(html, pageUrl);
    if (iframeUrl && !/in_iframe=1/i.test(pageUrl)) {
      const iframeResponse = await fetch(iframeUrl, { headers: HEADERS });
      if (!iframeResponse.ok) return null;
      html = await iframeResponse.text();
      resolvedPageUrl = iframeUrl;
    }

    return { html, resolvedPageUrl };
  } catch {
    return null;
  }
}

export async function validateIcimsSlug(boardUrl: string): Promise<{ source: "icims"; boardUrl: string } | null> {
  const normalizedUrl = normalizeIcimsBoardUrl(boardUrl);
  if (!normalizedUrl) return null;
  const result = await fetchIcimsPage(normalizedUrl);
  if (!result) return null;
  return /icims/i.test(result.html) ? { source: "icims", boardUrl: normalizedUrl } : null;
}

export async function countIcimsJobs(boardUrl: string): Promise<number> {
  const normalizedUrl = normalizeIcimsBoardUrl(boardUrl);
  if (!normalizedUrl) return 0;
  const result = await fetchIcimsPage(normalizedUrl);
  if (!result) return 0;
  const parsedCount = parseCount(result.html);
  if (parsedCount > 0) return parsedCount;

  // Some modern iCIMS boards only expose pagination like "Page 1 of 39"
  // without rendering a direct total-job count in the HTML header. Fall back
  // to the real paginated fetch path so validation and registry counts do not
  // incorrectly collapse to zero for boards such as Acadia Healthcare.
  return (await fetchIcimsJobs(normalizedUrl, "iCIMS", { maxPages: 100 })).length;
}

export async function fetchIcimsJobs(
  boardUrl: string,
  companyName: string,
  options: { maxPages?: number } = {}
): Promise<JobPosting[]> {
  const normalizedUrl = normalizeIcimsBoardUrl(boardUrl);
  if (!normalizedUrl) return [];

  // Large healthcare boards regularly exceed 20 listing pages. Use a more
  // generous default so shared raw inventory reflects the real board size.
  const maxPages = options.maxPages ?? 100;
  const jobs: JobPosting[] = [];
  const seen = new Set<string>();
  let nextPageUrl: string | null = normalizedUrl;

  for (let page = 0; page < maxPages && nextPageUrl; page += 1) {
    const result = await fetchIcimsPage(nextPageUrl);
    if (!result) break;

    const pageJobs = parseJobsFromHtml(result.html, companyName, result.resolvedPageUrl);
    for (const job of pageJobs) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
    }

    nextPageUrl = extractNextPageUrl(result.html, result.resolvedPageUrl);
  }

  return jobs;
}
