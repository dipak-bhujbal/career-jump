import type {
  CompanyInput,
  DetectedConfig,
  JobPosting,
  WorkdayFailureReason,
  WorkdayJobPosting,
  WorkdayScanFailure,
  WorkdayScanLayer,
  WorkdayScanResult,
  WorkdaySearchResponse,
} from "../../types";
import { parseWorkdaySampleUrl } from "../../config";
import { normalizePostedAtValue } from "../../lib/utils";

const WORKDAY_PAGE_SIZE = 20;
const MAX_PAGES_PER_QUERY = 3;
const WORKDAY_RETRY_DELAYS_MS = [1000, 2500];
const WORKDAY_PAGE_DELAY_MS = 250;
const WORKDAY_QUERY_DELAY_MS = 400;
const WORKDAY_REQUEST_JITTER_MIN_MS = 500;
const WORKDAY_REQUEST_JITTER_MAX_MS = 5000;
const WORKDAY_HEADLESS_NAVIGATION_TIMEOUT_MS = 15_000;
const WORKDAY_HEADLESS_PAGE_IDLE_WAIT_MS = 750;

type WorkdayFields = {
  host: string;
  tenant: string;
  site: string;
  workdayBaseUrl?: string;
};

type UserAgentProfile = {
  userAgent: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
};

type WorkdayTransportResponse = {
  status: number;
  retryAfter?: string | null;
  bodyText: string;
};

type HeadlessRuntime = {
  chromium: {
    args: string[];
    executablePath(): Promise<string>;
  };
  playwright: {
    chromium: {
      launch(options: {
        args: string[];
        executablePath: string;
        headless: boolean;
      }): Promise<{
        newContext(options: {
          userAgent: string;
          locale: string;
          extraHTTPHeaders: Record<string, string>;
        }): Promise<{
          addInitScript(script: () => void): Promise<void>;
          newPage(): Promise<{
            goto(
              url: string,
              options: { waitUntil: "domcontentloaded"; timeout: number }
            ): Promise<void>;
            waitForTimeout(ms: number): Promise<void>;
            evaluate<Result, Arg>(
              pageFunction: (arg: Arg) => Promise<Result>,
              arg: Arg
            ): Promise<Result>;
          }>;
        }>;
        close(): Promise<void>;
      }>;
    };
  };
};

type WorkdayPageSuccess = {
  ok: true;
  layerUsed: WorkdayScanLayer;
  retryAfter?: string | null;
  response: WorkdaySearchResponse;
};

type WorkdayPageResult = WorkdayPageSuccess | WorkdayScanFailure;

const USER_AGENT_POOL: UserAgentProfile[] = [
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"135\", \"Google Chrome\";v=\"135\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"134\", \"Google Chrome\";v=\"134\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"133\", \"Google Chrome\";v=\"133\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"132\", \"Google Chrome\";v=\"132\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Linux\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"131\", \"Google Chrome\";v=\"131\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    secChUa: "\"Safari\";v=\"17\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
  {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    secChUa: "\"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Windows\"",
  },
  {
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
    secChUa: "\"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"Linux\"",
  },
  {
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    secChUa: "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not.A/Brand\";v=\"24\"",
    secChUaMobile: "?0",
    secChUaPlatform: "\"macOS\"",
  },
];

export class WorkdayScanFailureError extends Error {
  readonly result: WorkdayScanFailure;

  constructor(result: WorkdayScanFailure) {
    super(result.message);
    this.name = "WorkdayScanFailureError";
    this.result = result;
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function toWorkdaySearchText(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).join("+");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUserAgent(): UserAgentProfile {
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
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

function summarizeWorkdayErrorBody(text: string): string {
  const compact = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact.slice(0, 240) || text.slice(0, 240);
}

function isTransientWorkdayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function detectFailureReason(status: number, bodyText: string): WorkdayFailureReason {
  const loweredBody = bodyText.toLowerCase();
  if (status === 429) return "throttled";
  if (status === 403) return "blocked";
  if (
    loweredBody.includes("captcha") ||
    loweredBody.includes("attention required") ||
    loweredBody.includes("verify you are human") ||
    loweredBody.includes("cf-chl") ||
    loweredBody.includes("challenge-platform")
  ) {
    return "captcha";
  }
  return "parse_error";
}

function normalizeFailure(
  layerUsed: WorkdayScanLayer,
  message: string,
  status?: number,
  bodyText = "",
  retryAfter?: string | null,
  details?: Record<string, unknown>
): WorkdayScanFailure {
  return {
    ok: false,
    layerUsed,
    failureReason: detectFailureReason(status ?? 0, bodyText),
    message,
    status,
    retryAfter: retryAfter ?? null,
    details,
  };
}

function parseWorkdayJson(text: string): WorkdaySearchResponse {
  try {
    return JSON.parse(text) as WorkdaySearchResponse;
  } catch {
    throw new Error(`Invalid Workday JSON: ${text.slice(0, 240)}`);
  }
}

function workerUrl(): string | null {
  const value = process.env.WORKDAY_CLOUDFLARE_WORKER_URL?.trim();
  return value ? value : null;
}

function workerSecret(): string | null {
  const value = process.env.WORKDAY_CLOUDFLARE_WORKER_SECRET?.trim();
  return value ? value : null;
}

function scraperApiKey(): string | null {
  const value = process.env.SCRAPERAPI_KEY?.trim();
  return value ? value : null;
}

export function isScraperApiConfigured(): boolean {
  return Boolean(scraperApiKey());
}

async function loadHeadlessRuntime(): Promise<HeadlessRuntime> {
  // Use runtime-only require so SAM/esbuild does not try to crawl Playwright's
  // optional browser internals during Lambda bundling. Layer 2 is feature-
  // flagged and only loads when a promoted Workday board actually needs it.
  const runtimeRequire = Function("return require")() as NodeRequire;
  const chromiumModule = runtimeRequire("@sparticuz/chromium") as {
    default: HeadlessRuntime["chromium"];
  };
  const playwrightModule = runtimeRequire("playwright-core") as HeadlessRuntime["playwright"];
  return {
    chromium: chromiumModule.default,
    playwright: playwrightModule,
  };
}

function buildRequestHeaders(fields: WorkdayFields, profile: UserAgentProfile): Record<string, string> {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Content-Type": "application/json",
    Origin: `https://${fields.host}`,
    Pragma: "no-cache",
    Referer: buildBoardBaseUrl(fields),
    "Sec-CH-UA": profile.secChUa,
    "Sec-CH-UA-Mobile": profile.secChUaMobile,
    "Sec-CH-UA-Platform": profile.secChUaPlatform,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": profile.userAgent,
  };
}

async function requestThroughCloudflareWorker(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<WorkdayTransportResponse> {
  const cfWorkerUrl = workerUrl();
  const cfWorkerSecret = workerSecret();
  if (!cfWorkerUrl || !cfWorkerSecret) {
    throw new Error("Cloudflare worker credentials are not configured.");
  }

  const response = await fetch(cfWorkerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Secret": cfWorkerSecret,
    },
    body: JSON.stringify({
      url,
      method: "POST",
      payload,
      headers,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      status: response.status,
      retryAfter: response.headers.get("Retry-After"),
      bodyText: text,
    };
  }

  const parsed = JSON.parse(text) as {
    status?: number;
    retryAfter?: string | null;
    data?: unknown;
    bodyText?: string | null;
  };

  return {
    status: Number(parsed.status ?? 500),
    retryAfter: parsed.retryAfter ?? null,
    bodyText: parsed.data ? JSON.stringify(parsed.data) : String(parsed.bodyText ?? ""),
  };
}

async function requestDirectly(
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<WorkdayTransportResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  return {
    status: response.status,
    retryAfter: response.headers.get("Retry-After"),
    bodyText: await response.text(),
  };
}

async function requestLayer1(
  fields: WorkdayFields,
  payload: Record<string, unknown>,
  layerUsed: WorkdayScanLayer
): Promise<WorkdayTransportResponse> {
  await sleep(randomBetween(WORKDAY_REQUEST_JITTER_MIN_MS, WORKDAY_REQUEST_JITTER_MAX_MS));

  const url = buildJobsEndpoint(fields);
  const headers = buildRequestHeaders(fields, randomUserAgent());

  if (workerUrl() && workerSecret()) {
    try {
      return await requestThroughCloudflareWorker(url, payload, headers);
    } catch (error) {
      // Keep Layer 1 resilient while the worker is being rolled out. A worker
      // outage should not break scans that can still complete directly.
      console.warn("[workday] cloudflare worker request failed, falling back to direct fetch", JSON.stringify({
        host: fields.host,
        site: fields.site,
        layerUsed,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return requestDirectly(url, payload, headers);
}

async function requestLayer2(
  fields: WorkdayFields,
  payload: Record<string, unknown>
): Promise<WorkdayTransportResponse> {
  const { chromium, playwright } = await loadHeadlessRuntime();
  const profile = randomUserAgent();
  const browser = await playwright.chromium.launch({
    args: [
      ...chromium.args,
      "--disable-blink-features=AutomationControlled",
    ],
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const context = await browser.newContext({
      userAgent: profile.userAgent,
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    // Hide webdriver so the browser context looks less synthetic before the
    // board page establishes cookies and fetches the JSON API.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    });

    const page = await context.newPage();
    await page.goto(buildBoardBaseUrl(fields), {
      waitUntil: "domcontentloaded",
      timeout: WORKDAY_HEADLESS_NAVIGATION_TIMEOUT_MS,
    });
    await page.waitForTimeout(WORKDAY_HEADLESS_PAGE_IDLE_WAIT_MS);

    return page.evaluate(async ({ jobsUrl, requestPayload }) => {
      const response = await fetch(jobsUrl, {
        method: "POST",
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      return {
        status: response.status,
        retryAfter: response.headers.get("Retry-After"),
        bodyText: await response.text(),
      };
    }, {
      jobsUrl: buildJobsEndpoint(fields),
      requestPayload: payload,
    });
  } finally {
    await browser.close();
  }
}

async function requestLayer3(
  fields: WorkdayFields,
  payload: Record<string, unknown>
): Promise<WorkdayTransportResponse> {
  const key = scraperApiKey();
  if (!key) {
    throw new Error("ScraperAPI key is not configured.");
  }

  const response = await fetch("https://api.scraperapi.com/", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: key,
      url: buildJobsEndpoint(fields),
      method: "POST",
      post_data: JSON.stringify(payload),
      render: false,
    }),
  });

  return {
    status: response.status,
    retryAfter: response.headers.get("Retry-After"),
    bodyText: await response.text(),
  };
}

function requestForLayer(
  layerUsed: WorkdayScanLayer,
  fields: WorkdayFields,
  payload: Record<string, unknown>
): Promise<WorkdayTransportResponse> {
  switch (layerUsed) {
    case "layer1":
      return requestLayer1(fields, payload, layerUsed);
    case "layer2":
      return requestLayer2(fields, payload);
    case "layer3":
      return requestLayer3(fields, payload);
    default: {
      const exhaustiveLayer: never = layerUsed;
      throw new Error(`Unknown Workday layer: ${String(exhaustiveLayer)}`);
    }
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
  searchText: string,
  layerUsed: WorkdayScanLayer = "layer1"
): Promise<WorkdayPageResult> {
  const fields = ensureWorkdayFields(cfg);
  const payload = {
    appliedFacets: {},
    limit,
    offset,
    searchText,
  };

  for (let attempt = 0; attempt <= WORKDAY_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const transport = await requestForLayer(layerUsed, fields, payload);
      if (transport.status >= 200 && transport.status < 300) {
        try {
          return {
            ok: true,
            layerUsed,
            retryAfter: transport.retryAfter ?? null,
            response: parseWorkdayJson(transport.bodyText),
          };
        } catch (error) {
          return normalizeFailure(
            layerUsed,
            error instanceof Error ? error.message : "Invalid Workday JSON response.",
            transport.status,
            transport.bodyText,
            transport.retryAfter,
            { host: fields.host, site: fields.site, searchText, offset, limit }
          );
        }
      }

      const bodySummary = summarizeWorkdayErrorBody(transport.bodyText);
      if (isTransientWorkdayStatus(transport.status) && attempt < WORKDAY_RETRY_DELAYS_MS.length) {
        console.warn("[workday] transient fetch failure, retrying", JSON.stringify({
          host: fields.host,
          site: fields.site,
          searchText,
          offset,
          limit,
          status: transport.status,
          attempt: attempt + 1,
        }));
        await sleep(WORKDAY_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      return normalizeFailure(
        layerUsed,
        `Workday fetch failed for ${buildJobsEndpoint(fields)}: ${transport.status} ${bodySummary}`,
        transport.status,
        transport.bodyText,
        transport.retryAfter,
        { host: fields.host, site: fields.site, searchText, offset, limit }
      );
    } catch (error) {
      if (attempt < WORKDAY_RETRY_DELAYS_MS.length) {
        console.warn("[workday] network failure, retrying", JSON.stringify({
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

      return normalizeFailure(
        layerUsed,
        error instanceof Error ? error.message : "Workday network failure.",
        undefined,
        "",
        null,
        { host: fields.host, site: fields.site, searchText, offset, limit }
      );
    }
  }

  return normalizeFailure(layerUsed, "Workday fetch exhausted retries.");
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
  searchText: string,
  layerUsed: WorkdayScanLayer
): Promise<WorkdayScanResult> {
  const all: JobPosting[] = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_QUERY; pageIndex += 1) {
    if (pageIndex > 0) {
      await sleep(WORKDAY_PAGE_DELAY_MS);
    }

    const page = await fetchWorkdayPage(cfg, offset, WORKDAY_PAGE_SIZE, searchText, layerUsed);
    if (!page.ok) {
      return page;
    }

    const postings = Array.isArray(page.response.jobPostings) ? page.response.jobPostings : [];
    if (postings.length === 0) {
      break;
    }

    for (const posting of postings) {
      all.push(normalizeWorkdayJob(companyName, cfg, posting));
    }

    offset += postings.length;
    if (postings.length < WORKDAY_PAGE_SIZE) {
      break;
    }
  }

  return {
    ok: true,
    layerUsed,
    jobs: all,
  };
}

/**
 * Layer-aware Workday scan entrypoint. This keeps Layer 1 transport details in
 * one place so the higher-level scan pipeline can respond to typed outcomes
 * instead of guessing from free-form error messages.
 */
export async function scanWorkdayJobs(
  companyName: string,
  cfg: {
    sampleUrl?: string;
    workdayBaseUrl?: string;
    host?: string;
    tenant?: string;
    site?: string;
  },
  includeKeywords: string[] = [],
  layerUsed: WorkdayScanLayer = "layer1"
): Promise<WorkdayScanResult> {
  const searchTerms = uniqueNonEmpty(includeKeywords);
  const collected: JobPosting[] = [];

  if (searchTerms.length === 0) {
    const result = await fetchWorkdayJobsForSearchText(companyName, cfg, "", layerUsed);
    if (!result.ok) return result;
    collected.push(...result.jobs);
  } else {
    for (let index = 0; index < searchTerms.length; index += 1) {
      const term = searchTerms[index];
      if (index > 0) {
        await sleep(WORKDAY_QUERY_DELAY_MS);
      }

      const result = await fetchWorkdayJobsForSearchText(companyName, cfg, toWorkdaySearchText(term), layerUsed);
      if (!result.ok) return result;
      collected.push(...result.jobs);
    }
  }

  const deduped = new Map<string, JobPosting>();
  for (const job of collected) {
    const key = `${job.company}::${job.id}::${job.url}`;
    if (!deduped.has(key)) {
      deduped.set(key, job);
    }
  }

  return {
    ok: true,
    layerUsed,
    jobs: [...deduped.values()],
  };
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
  const result = await scanWorkdayJobs(companyName, cfg, includeKeywords, "layer1");
  if (!result.ok) {
    throw new WorkdayScanFailureError(result);
  }
  return result.jobs;
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
    const page = await fetchWorkdayPage(fields, 0, 1, "", "layer1");
    if (!page.ok) return null;
    const hasShape = Array.isArray(page.response.jobPostings) || typeof page.response.total === "number";

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
