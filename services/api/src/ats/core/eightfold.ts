import type { JobPosting } from "../../types";

/**
 * Eightfold AI ATS adapter.
 *
 * Two API paths are supported:
 *   Standard:    https://{slug}.eightfold.ai/api/apply/v2/jobs
 *   White-label: https://{careersHost}/api/pcsx/search?domain={domainParam}
 *
 * White-label detection: boardUrl does NOT contain ".eightfold.ai".
 * Config: boardUrl = careers base URL, companySlug = domain= param value.
 */

type EightfoldJob = {
  id?: string | number;
  name?: string;
  display_job_title?: string;
  location?: string;
  locations?: string[];
  canonicalPositionUrl?: string;
  ats_job_id?: string;
  business_unit?: string;
  description?: string;
  date_posted?: string;
  posting_date?: string;
};

type EightfoldResponse = {
  count?: number;
  positions?: EightfoldJob[];
};

// White-label pcsx response shape
type PcsxJob = {
  id?: string | number;
  displayJobId?: string;
  atsJobId?: string;
  name?: string;
  locations?: string[];
  standardizedLocations?: string[];
  postedTs?: number;
  creationTs?: number;
  department?: string;
  workLocationOption?: string;
  positionUrl?: string;
};

type PcsxResponse = {
  status?: number;
  data?: {
    positions?: PcsxJob[];
    count?: number;
  };
};

const HEADERS = { "User-Agent": "career-jump/1.0", Accept: "application/json" };

function apiUrl(slug: string, start = 0, num = 50): string {
  const domain = `${slug}.eightfold.ai`;
  return `https://${domain}/api/apply/v2/jobs?domain=${domain}&start=${start}&num=${num}&pid=&Function=&location=`;
}

function pcsxApiUrl(careersBaseUrl: string, domainParam: string, start = 0, num = 50): string {
  const base = careersBaseUrl.replace(/\/+$/, "");
  return `${base}/api/pcsx/search?domain=${domainParam}&query=&location=&start=${start}&num=${num}&sort_by=hot`;
}

function unixTsToIso(ts?: number): string | undefined {
  if (!ts || !Number.isFinite(ts)) return undefined;
  return new Date(ts * 1000).toISOString();
}

export function isEightfoldWhitelabel(boardUrl: string): boolean {
  return Boolean(boardUrl) && !boardUrl.includes(".eightfold.ai");
}

/**
 * Parse a board URL to determine which fetch path to use.
 * White-label board URLs contain "/api/pcsx/search" with a "domain=" param.
 * Standard board URLs are on *.eightfold.ai.
 */
export function parseEightfoldBoardUrl(
  boardUrl: string,
): { type: "standard"; slug: string } | { type: "whitelabel"; careersBaseUrl: string; domainParam: string } | null {
  try {
    const u = new URL(boardUrl);
    if (u.hostname.endsWith(".eightfold.ai")) {
      const slug = u.hostname.replace(/\.eightfold\.ai$/, "");
      return slug ? { type: "standard", slug } : null;
    }
    // White-label: expect /api/pcsx/search?domain=...
    const domainParam = u.searchParams.get("domain");
    if (domainParam) {
      const careersBaseUrl = u.origin;
      return { type: "whitelabel", careersBaseUrl, domainParam };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate an Eightfold slug and return DetectedConfig-style payload.
 */
export async function validateEightfoldSlug(
  companySlug: string
): Promise<{ source: "eightfold"; companySlug: string } | null> {
  try {
    const r = await fetch(apiUrl(companySlug, 0, 1), { headers: HEADERS });
    if (!r.ok) return null;
    const data = (await r.json()) as EightfoldResponse;
    if (typeof data.count !== "number" && !Array.isArray(data.positions)) return null;
    return { source: "eightfold", companySlug };
  } catch {
    return null;
  }
}

/**
 * Get total job count for a board.
 */
export async function countEightfoldJobs(companySlug: string): Promise<number> {
  try {
    const r = await fetch(apiUrl(companySlug, 0, 1), { headers: HEADERS });
    if (!r.ok) return 0;
    const data = (await r.json()) as EightfoldResponse;
    return data.count ?? data.positions?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch all jobs for a white-label Eightfold board (pcsx endpoint).
 * careersBaseUrl: e.g. "https://careers.lamresearch.com"
 * domainParam:    e.g. "lamresearch.com"
 */
export async function fetchEightfoldWhitelabelJobs(
  careersBaseUrl: string,
  domainParam: string,
  companyName: string,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<JobPosting[]> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 40;
  const careersBase = careersBaseUrl.replace(/\/+$/, "");
  const out: JobPosting[] = [];

  for (let page = 0; page < maxPages; page++) {
    const r = await fetch(pcsxApiUrl(careersBase, domainParam, page * pageSize, pageSize), { headers: HEADERS });
    if (!r.ok) break;
    const envelope = (await r.json()) as PcsxResponse;
    const positions = envelope.data?.positions ?? [];
    if (!positions.length) break;
    for (const job of positions) {
      const id = String(job.id ?? job.displayJobId ?? job.atsJobId ?? "");
      if (!id) continue;
      const relPath = job.positionUrl ?? `/careers/job/${id}`;
      const url = relPath.startsWith("http") ? relPath : `${careersBase}${relPath}`;
      const location = (job.standardizedLocations?.[0] ?? job.locations?.[0] ?? "").replace(/\s*\(.*?\)\s*$/, "").trim();
      out.push({
        id,
        title: job.name ?? "",
        company: companyName,
        location,
        url,
        source: "eightfold" as never,
        postedAt: unixTsToIso(job.postedTs ?? job.creationTs),
      } as JobPosting);
    }
    const total = envelope.data?.count ?? Number.MAX_SAFE_INTEGER;
    if ((page + 1) * pageSize >= total) break;
  }

  return out;
}

/**
 * Fetch all jobs for a standard Eightfold board (eightfold.ai subdomain).
 */
export async function fetchEightfoldJobs(
  companySlug: string,
  companyName: string,
  options: { pageSize?: number; maxPages?: number } = {}
): Promise<JobPosting[]> {
  const pageSize = options.pageSize ?? 50;
  const maxPages = options.maxPages ?? 20;
  const out: JobPosting[] = [];

  for (let page = 0; page < maxPages; page++) {
    const r = await fetch(apiUrl(companySlug, page * pageSize, pageSize), { headers: HEADERS });
    if (!r.ok) break;
    const data = (await r.json()) as EightfoldResponse;
    const positions = data.positions ?? [];
    if (!positions.length) break;
    for (const job of positions) {
      const id = String(job.id ?? job.ats_job_id ?? "");
      if (!id) continue;
      const url = job.canonicalPositionUrl ?? `https://${companySlug}.eightfold.ai/careers?pid=${id}`;
      const title = job.display_job_title ?? job.name ?? "";
      const location = job.location ?? (job.locations && job.locations[0]) ?? "";
      out.push({
        id,
        title,
        company: companyName,
        location,
        url,
        source: "eightfold" as never,
        department: job.business_unit,
        postedAt: job.posting_date ?? job.date_posted,
      } as JobPosting);
    }
    const total = data.count ?? Number.MAX_SAFE_INTEGER;
    if ((page + 1) * pageSize >= total) break;
  }

  return out;
}
