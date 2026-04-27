import type {
  CompanyInput,
  DetectedConfig,
  JobPosting,
  WorkdayJobPosting,
  WorkdaySearchResponse,
} from "../../types";
import { parseWorkdaySampleUrl } from "../../config";
import { normalizePostedAtValue } from "../../lib/utils";

const WORKDAY_PAGE_SIZE = 20;
const MAX_PAGES_PER_QUERY = 12;
const WORKDAY_RETRY_DELAYS_MS = [500, 1500, 3000];
const WORKDAY_PAGE_DELAY_MS = 250;
const WORKDAY_QUERY_DELAY_MS = 400;

type WorkdayFields = {
  host: string;
  tenant: string;
  site: string;
  workdayBaseUrl?: string;
};

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function toWorkdaySearchText(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join("+");
}

function ensureWorkdayFields(input: {
  sampleUrl?: string;
  workdayBaseUrl?: string;
  host?: string;
  tenant?: string;
  site?: string;
}): WorkdayFields {
  if (input.host && input.tenant && input.site) {
    return {
      host: input.host,
      tenant: input.tenant,
      site: input.site,
      workdayBaseUrl: input.workdayBaseUrl,
    };
  }

  if (input.sampleUrl) {
    const parsed = parseWorkdaySampleUrl(input.sampleUrl);
    if (parsed.host && parsed.tenant && parsed.site) {
      return {
        host: parsed.host,
        tenant: parsed.tenant,
        site: parsed.site,
        workdayBaseUrl: parsed.workdayBaseUrl,
      };
    }
  }

  if (input.workdayBaseUrl) {
    const url = new URL(input.workdayBaseUrl);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const site = parts.length >= 2 ? parts[1] : "";
    const tenant = host.split(".wd")[0].split(".")[0];

    if (host && tenant && site) {
      return {
        host,
        tenant,
        site,
        workdayBaseUrl: input.workdayBaseUrl,
      };
    }
  }

  throw new Error("Missing Workday configuration. Need sampleUrl or host/tenant/site.");
}

function buildJobsEndpoint(fields: WorkdayFields): string {
  return `https://${fields.host}/wday/cxs/${fields.tenant}/${fields.site}/jobs`;
}

function buildBoardBaseUrl(fields: WorkdayFields): string {
  return `https://${fields.host}/en-US/${fields.site}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientWorkdayStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function summarizeWorkdayErrorBody(text: string): string {
  const compact = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact.slice(0, 240) || text.slice(0, 240);
}

async function parseWorkdayJson(response: Response): Promise<WorkdaySearchResponse> {
  const text = await response.text();

  try {
    return JSON.parse(text) as WorkdaySearchResponse;
  } catch {
    throw new Error(`Invalid Workday JSON: ${text.slice(0, 240)}`);
  }
}

async function fetchWorkdayPage(
  cfg: {
    sampleUrl?: string;
    workdayBaseUrl?: string;
    host?: string;
    tenant?: string;
    site?: string;
  },
  offset: number,
  limit: number,
  searchText: string
): Promise<WorkdaySearchResponse> {
  const fields = ensureWorkdayFields(cfg);
  const url = buildJobsEndpoint(fields);

  for (let attempt = 0; attempt <= WORKDAY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "Content-Type": "application/json",
          Origin: `https://${fields.host}`,
          Pragma: "no-cache",
          Referer: buildBoardBaseUrl(fields),
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit,
          offset,
          searchText,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        const summary = summarizeWorkdayErrorBody(text);
        if (isTransientWorkdayStatus(response.status) && attempt < WORKDAY_RETRY_DELAYS_MS.length) {
          console.warn("[workday] transient fetch failure, retrying", JSON.stringify({
            host: fields.host,
            site: fields.site,
            searchText,
            offset,
            limit,
            status: response.status,
            attempt: attempt + 1,
          }));
          await sleep(WORKDAY_RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(`Workday fetch failed for ${url}: ${response.status} ${summary}`);
      }

      return parseWorkdayJson(response);
    } catch (error) {
      if (attempt < WORKDAY_RETRY_DELAYS_MS.length) {
        console.warn("[workday] network/json failure, retrying", JSON.stringify({
          host: fields.host,
          site: fields.site,
          searchText,
          offset,
          limit,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        }));
        await sleep(WORKDAY_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Workday fetch failed for ${url}: exhausted retries`);
}

/**
 * Workday job URLs are inconsistent across boards.
 * externalPath can be:
 * - full absolute URL
 * - /en-US/SITE/job/...
 * - /job/...
 * - job/...
 * - some other relative path
 *
 * This keeps the final job link valid across those shapes.
 */
function buildWorkdayJobUrl(
  cfg: {
    sampleUrl?: string;
    workdayBaseUrl?: string;
    host?: string;
    tenant?: string;
    site?: string;
  },
  job: WorkdayJobPosting
): string {
  const fields = ensureWorkdayFields(cfg);
  const origin = `https://${fields.host}`;
  const boardBase = buildBoardBaseUrl(fields).replace(/\/$/, "");
  const externalPath = String(job.externalPath ?? "").trim();

  if (!externalPath) return boardBase;
  if (externalPath.startsWith("http://") || externalPath.startsWith("https://")) return externalPath;

  if (externalPath.startsWith(`/en-US/${fields.site}/`)) {
    return `${origin}${externalPath}`;
  }

  if (/^\/[a-z]{2}-[A-Z]{2}\//.test(externalPath)) {
    return `${origin}${externalPath}`;
  }

  if (externalPath.startsWith("/job/")) {
    return `${boardBase}${externalPath}`;
  }

  if (externalPath.startsWith("job/")) {
    return `${boardBase}/${externalPath}`;
  }

  if (externalPath.startsWith("/")) {
    return `${origin}${externalPath}`;
  }

  return `${boardBase}/${externalPath}`;
}

function buildWorkdayLocation(job: WorkdayJobPosting): string {
  if (job.locationsText && job.locationsText.trim()) {
    return job.locationsText.trim();
  }

  if (Array.isArray(job.bulletFields) && job.bulletFields.length > 0) {
    const values = job.bulletFields
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && typeof item.value === "string") {
          return item.value.trim();
        }
        return "";
      })
      .filter(Boolean);

    if (values.length > 0) return values.join(" | ");
  }

  return "Unknown";
}

function normalizeWorkdayJob(
  companyName: string,
  cfg: {
    sampleUrl?: string;
    workdayBaseUrl?: string;
    host?: string;
    tenant?: string;
    site?: string;
  },
  job: WorkdayJobPosting
): JobPosting {
  return {
    source: "workday",
    company: companyName,
    id: String(job.jobReqId ?? job.externalPath ?? job.title ?? ""),
    title: String(job.title ?? ""),
    location: buildWorkdayLocation(job),
    url: buildWorkdayJobUrl(cfg, job),
    postedAt: normalizePostedAtValue(job.postedOn),
  };
}

async function fetchWorkdayJobsForSearchText(
  companyName: string,
  cfg: {
    sampleUrl?: string;
    workdayBaseUrl?: string;
    host?: string;
    tenant?: string;
    site?: string;
  },
  searchText: string
): Promise<JobPosting[]> {
  const all: JobPosting[] = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_QUERY; pageIndex += 1) {
    if (pageIndex > 0) {
      await sleep(WORKDAY_PAGE_DELAY_MS);
    }
    const page = await fetchWorkdayPage(cfg, offset, WORKDAY_PAGE_SIZE, searchText);
    const postings = Array.isArray(page.jobPostings) ? page.jobPostings : [];

    if (postings.length === 0) break;

    for (const posting of postings) {
      all.push(normalizeWorkdayJob(companyName, cfg, posting));
    }

    offset += postings.length;

    if (postings.length < WORKDAY_PAGE_SIZE) {
      break;
    }
  }

  return all;
}

export async function fetchWorkdayJobs(
  companyName: string,
  cfg: {
    sampleUrl?: string;
    workdayBaseUrl?: string;
    host?: string;
    tenant?: string;
    site?: string;
  },
  includeKeywords: string[] = []
): Promise<JobPosting[]> {
  const searchTerms = uniqueNonEmpty(includeKeywords);
  const collected: JobPosting[] = [];

  if (searchTerms.length === 0) {
    collected.push(...(await fetchWorkdayJobsForSearchText(companyName, cfg, "")));
  } else {
    for (let index = 0; index < searchTerms.length; index += 1) {
      const term = searchTerms[index];
      if (index > 0) {
        await sleep(WORKDAY_QUERY_DELAY_MS);
      }
      collected.push(...(await fetchWorkdayJobsForSearchText(companyName, cfg, toWorkdaySearchText(term))));
    }
  }

  const deduped = new Map<string, JobPosting>();

  for (const job of collected) {
    const key = `${job.company}::${job.id}::${job.url}`;
    if (!deduped.has(key)) {
      deduped.set(key, job);
    }
  }

  return [...deduped.values()];
}

export async function validateWorkdayConfig(
  cfg: {
    sampleUrl?: string;
    workdayBaseUrl?: string;
    host?: string;
    tenant?: string;
    site?: string;
  }
): Promise<DetectedConfig | null> {
  try {
    const fields = ensureWorkdayFields(cfg);
    const page = await fetchWorkdayPage(fields, 0, 1, "");
    const hasShape = Array.isArray(page.jobPostings) || typeof page.total === "number";

    return hasShape
      ? {
          source: "workday",
          sampleUrl: cfg.sampleUrl,
          workdayBaseUrl: fields.workdayBaseUrl,
          host: fields.host,
          tenant: fields.tenant,
          site: fields.site,
        }
      : null;
  } catch {
    return null;
  }
}

export async function detectWorkday(company: CompanyInput): Promise<DetectedConfig | null> {
  if (company.source !== "workday") return null;

  return validateWorkdayConfig({
    sampleUrl: company.sampleUrl,
    workdayBaseUrl: company.workdayBaseUrl,
    host: company.host,
    tenant: company.tenant,
    site: company.site,
  });
}
