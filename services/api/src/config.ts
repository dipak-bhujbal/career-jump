import { CONFIG_KEY } from "./constants";
import { inferAtsIdFromUrl, normalizeAtsId } from "./ats/shared/normalize";
import { hyphenSlug, nowISO, slugify } from "./lib/utils";
import { configStoreKv } from "./lib/bindings";
import { tenantScopedKey } from "./lib/tenant";
import { getByCompany, loadRegistryCache } from "./storage/registry-cache";
import { loadCompanyScanOverrides } from "./storage";
import type { CompanyInput, DetectedConfig, Env, JobTitleConfig, RuntimeConfig, Source } from "./types";
import { typedSeedCompanies, typedSeedJobtitles } from "./types";

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).map((x) => x.trim()).filter(Boolean);
}

function normalizeSource(value: unknown): Source | undefined {
  const normalized = normalizeAtsId(typeof value === "string" ? value : null);
  return normalized === "greenhouse" ||
    normalized === "ashby" ||
    normalized === "smartrecruiters" ||
    normalized === "workday" ||
    normalized === "lever" ||
    normalized === "bamboohr" ||
    normalized === "breezy" ||
    normalized === "eightfold" ||
    normalized === "icims" ||
    normalized === "jobvite" ||
    normalized === "oracle" ||
    normalized === "phenom" ||
    normalized === "recruitee" ||
    normalized === "successfactors" ||
    normalized === "taleo" ||
    normalized === "workable" ||
    normalized === "custom-jsonld" ||
    normalized === "sitemap"
    ? normalized
    : undefined;
}

function inferSourceFromUrl(rawUrl: string | undefined): Source | undefined {
  const inferred = normalizeAtsId(inferAtsIdFromUrl(rawUrl));
  return normalizeSource(inferred);
}

/**
 * Parse a Workday sample job URL into the identifiers needed for
 * the real Workday jobs API:
 *   https://<host>/wday/cxs/<tenant>/<site>/jobs
 *
 * Example:
 * https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/Technical-Program-Manager_JR333198
 *
 * becomes:
 * {
 *   host: "salesforce.wd12.myworkdayjobs.com",
 *   tenant: "salesforce",
 *   site: "External_Career_Site",
 *   workdayBaseUrl: "https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site"
 * }
 */
export function parseWorkdaySampleUrl(
  sampleUrl: string
): Pick<CompanyInput, "host" | "tenant" | "site" | "workdayBaseUrl"> {
  try {
    const url = new URL(sampleUrl);
    const host = url.hostname.toLowerCase();

    const parts = url.pathname.split("/").filter(Boolean);
    const firstSegment = parts[0] ?? "";
    const secondSegment = parts[1] ?? "";
    const hasLocalePrefix = /^[a-z]{2}-[A-Z]{2}$/.test(firstSegment);
    /**
     * Workday boards commonly use one of two canonical shapes:
     *   /en-US/<jobboard>
     *   /<jobboard>
     *
     * Posting URLs can also include /job/... which is not enough to recover
     * the board token on its own, so keep site empty in that case.
     */
    const site = hasLocalePrefix
      ? secondSegment
      : firstSegment && firstSegment !== "job"
        ? firstSegment
        : "";

    /**
     * For hosts like:
     * salesforce.wd12.myworkdayjobs.com
     * nvidia.wd5.myworkdayjobs.com
     *
     * tenant is the first hostname label.
     */
    const tenant = host.split(".wd")[0].split(".")[0];

    /**
     * Keep the old workdayBaseUrl too for backward compatibility / debugging.
     */
    const workdayBaseUrl = site
      ? hasLocalePrefix
        ? `${url.origin}/${firstSegment}/${site}`
        : `${url.origin}/${site}`
      : undefined;

    if (!host || !tenant || !site) return {};

    return {
      host,
      tenant,
      site,
      workdayBaseUrl,
    };
  } catch {
    return {};
  }
}

/**
 * Greenhouse sample URLs can come in multiple shapes:
 *
 * 1. Standard board/job URLs
 *    https://boards.greenhouse.io/anthropic/jobs/4989788008
 *    https://job-boards.greenhouse.io/deepmind/jobs/7686685
 *
 * 2. Embedded board URLs
 *    https://job-boards.greenhouse.io/embed/job_board?for=airbnb
 *    https://job-boards.greenhouse.io/embed/job_board?for=coinbase
 *
 * For embedded boards, the real board token is in the `for` query param.
 */
function parseGreenhouseSampleUrl(sampleUrl: string): Pick<CompanyInput, "boardToken"> {
  try {
    const url = new URL(sampleUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const host = url.hostname.toLowerCase();
    const nativeGreenhouseHost = host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io";

    const queryBoardToken = url.searchParams.get("for")?.trim();
    if (queryBoardToken) {
      return { boardToken: queryBoardToken };
    }
    // Custom-domain Greenhouse job URLs often look like
    // https://stripe.com/jobs/search?gh_jid=12345 where the board token still
    // matches the first path segment.
    const hostedGreenhouseJob = url.searchParams.get("gh_jid")?.trim();
    if (hostedGreenhouseJob && parts[0]) {
      return { boardToken: parts[0] };
    }
    // Boards API URLs: boards-api.greenhouse.io/v1/boards/<token>/...
    if (host === "boards-api.greenhouse.io" && parts[0] === "v1" && parts[1] === "boards" && parts[2]) {
      return { boardToken: parts[2] };
    }
    // REST API URLs: api.greenhouse.io/v1/boards/<token>/...
    if (host === "api.greenhouse.io" && parts[0] === "v1" && parts[1] === "boards" && parts[2]) {
      return { boardToken: parts[2] };
    }
    // EU Greenhouse board host: job-boards.eu.greenhouse.io/<token>
    const euGreenhouseHost = host === "job-boards.eu.greenhouse.io";
    if (!nativeGreenhouseHost && !euGreenhouseHost) {
      return {};
    }

    const isEmbedBoardPath =
      parts.length >= 2 &&
      parts[0] === "embed" &&
      (parts[1] === "job_board" || parts[1] === "job_board_widget");

    if (isEmbedBoardPath) {
      return {};
    }

    const boardToken = parts[0] || "";
    return boardToken ? { boardToken } : {};
  } catch {
    return {};
  }
}

function parseAshbySampleUrl(sampleUrl: string): Pick<CompanyInput, "companySlug"> {
  try {
    const url = new URL(sampleUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const host = url.hostname.toLowerCase();

    if (!host.endsWith("ashbyhq.com")) return {};
    const companySlug = parts[0] || "";
    return companySlug ? { companySlug } : {};
  } catch {
    return {};
  }
}

function parseSmartRecruitersSampleUrl(sampleUrl: string): Pick<CompanyInput, "smartRecruitersCompanyId"> {
  try {
    const url = new URL(sampleUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const host = url.hostname.toLowerCase();

    if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
      const smartRecruitersCompanyId = parts[0] || "";
      return smartRecruitersCompanyId ? { smartRecruitersCompanyId } : {};
    }

    // api.smartrecruiters.com/v1/companies/<id>/postings
    if (host === "api.smartrecruiters.com" && parts[0] === "v1" && parts[1] === "companies" && parts[2]) {
      return { smartRecruitersCompanyId: parts[2] };
    }

    return {};
  } catch {
    return {};
  }
}

function parseLeverSampleUrl(sampleUrl: string): Pick<CompanyInput, "leverSite"> {
  try {
    const url = new URL(sampleUrl);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);

    // Standard hosted board: jobs.lever.co/<site>
    if (host === "jobs.lever.co") {
      const leverSite = String(parts[0] ?? "").trim().toLowerCase();
      return leverSite ? { leverSite } : {};
    }
    // Public API: api.lever.co/v0/postings/<site>
    if (host === "api.lever.co" && parts[0] === "v0" && parts[1] === "postings" && parts[2]) {
      return { leverSite: parts[2].toLowerCase() };
    }
    return {};
  } catch {
    return {};
  }
}

export function parseConfiguredAts(
  source: Source | undefined,
  sampleUrl: string | undefined
): Pick<
  CompanyInput,
  "workdayBaseUrl" | "host" | "tenant" | "site" | "boardToken" | "companySlug" | "smartRecruitersCompanyId"
  | "leverSite"
> {
  if (!source || !sampleUrl) return {};

  switch (source) {
    case "workday":
      return parseWorkdaySampleUrl(sampleUrl);
    case "greenhouse":
      return parseGreenhouseSampleUrl(sampleUrl);
    case "ashby":
      return parseAshbySampleUrl(sampleUrl);
    case "smartrecruiters":
      return parseSmartRecruitersSampleUrl(sampleUrl);
    case "lever":
      return parseLeverSampleUrl(sampleUrl);
    default:
      return {};
  }
}

/**
 * Registry-backed companies should keep a canonical board URL so scans do not
 * depend on a fragile sample posting URL once the company has already been
 * discovered and validated.
 */
export function canonicalBoardUrlForCompany(company: CompanyInput): string | undefined {
  switch (company.source) {
    case "workday":
      return company.workdayBaseUrl || company.boardUrl || company.sampleUrl;
    case "greenhouse":
      return company.boardToken ? `https://job-boards.greenhouse.io/${company.boardToken}` : company.boardUrl || company.sampleUrl;
    case "ashby":
      return company.companySlug ? `https://jobs.ashbyhq.com/${company.companySlug}` : company.boardUrl || company.sampleUrl;
    case "lever":
      return company.leverSite ? `https://jobs.lever.co/${company.leverSite}` : company.boardUrl || company.sampleUrl;
    case "smartrecruiters":
      return company.smartRecruitersCompanyId
        ? `https://jobs.smartrecruiters.com/${company.smartRecruitersCompanyId}`
        : company.boardUrl || company.sampleUrl;
    default:
      return company.boardUrl || company.sampleUrl;
  }
}

function buildCanonicalCompanyInput(
  companyName: string,
  source: Source | undefined,
  boardUrl: string | undefined,
  sampleUrl: string | undefined,
  parsed: Pick<
    CompanyInput,
    "workdayBaseUrl" | "host" | "tenant" | "site" | "boardToken" | "companySlug" | "smartRecruitersCompanyId" | "leverSite"
  >,
): CompanyInput {
  return {
    company: companyName,
    enabled: true,
    source,
    boardUrl,
    sampleUrl,
    boardToken: parsed.boardToken,
    companySlug: parsed.companySlug,
    smartRecruitersCompanyId: parsed.smartRecruitersCompanyId,
    leverSite: parsed.leverSite,
    workdayBaseUrl: parsed.workdayBaseUrl,
    host: parsed.host,
    tenant: parsed.tenant,
    site: parsed.site,
  };
}

export function companyToDetectedConfig(company: CompanyInput): DetectedConfig | null {
  switch (company.source) {
    case "workday":
      if (company.host && company.tenant && company.site) {
        return {
          source: "workday",
          sampleUrl: company.boardUrl || company.sampleUrl,
          workdayBaseUrl: company.workdayBaseUrl,
          host: company.host,
          tenant: company.tenant,
          site: company.site,
        };
      }
      return company.boardUrl || company.sampleUrl || company.workdayBaseUrl
        ? {
            source: "workday",
            sampleUrl: company.boardUrl || company.sampleUrl,
            workdayBaseUrl: company.workdayBaseUrl,
          }
        : null;

    case "greenhouse":
      // boardToken must come from the canonical board URL or an explicit stored value.
      // If it cannot be derived, fail closed — never guess from company name or fall back silently.
      return company.boardToken
        ? { source: "greenhouse", boardToken: company.boardToken, sampleUrl: company.boardUrl || company.sampleUrl }
        : null;

    case "ashby":
      return company.companySlug ? { source: "ashby", companySlug: company.companySlug } : null;

    case "smartrecruiters":
      return company.smartRecruitersCompanyId
        ? { source: "smartrecruiters", smartRecruitersCompanyId: company.smartRecruitersCompanyId }
        : null;

    case "lever": {
      if (company.leverSite) {
        return { source: "lever", leverSite: company.leverSite, sampleUrl: company.boardUrl || company.sampleUrl };
      }
      // leverSite could not be extracted (e.g. custom domain or marketing page) —
      // fall back to registry-adapter with the boardUrl.
      const lvrBoardUrl = company.boardUrl || company.sampleUrl;
      return lvrBoardUrl
        ? { source: "registry-adapter", adapterId: "lever", boardUrl: lvrBoardUrl, companyName: company.company }
        : null;
    }

    case "bamboohr":
    case "breezy":
    case "eightfold":
    case "icims":
    case "jobvite":
    case "oracle":
    case "phenom":
    case "recruitee":
    case "successfactors":
    case "taleo":
    case "workable":
    case "custom-jsonld":
    case "sitemap": {
      const boardUrl = canonicalBoardUrlForCompany(company);
      if (!boardUrl) return null;
      return {
        source: "registry-adapter",
        adapterId: company.source,
        boardUrl,
        sampleUrl: company.boardUrl || company.sampleUrl,
        companyName: company.company,
      };
    }

    default:
      return null;
  }
}

function normalizeCompany(input: Record<string, unknown>): CompanyInput {
  const sourceFromInput = normalizeSource(input.source);
  const companyName = String(input.company).trim();
  const rawSampleUrl = typeof input.sampleUrl === "string" && input.sampleUrl.trim() ? input.sampleUrl.trim() : undefined;
  const rawBoardUrl = typeof input.boardUrl === "string" && input.boardUrl.trim() ? input.boardUrl.trim() : undefined;
  const isRegistryBacked = input.isRegistry === true || Boolean(input.registryAts || input.registryTier);
  // Prefer explicit ATS labels, but heal older/missing rows from the URL when
  // the provider is obvious from the host/path.
  // Unknown-but-real registry boards should still be scannable through the
  // generic custom pipeline instead of becoming null runtime configs.
  const source = sourceFromInput ?? inferSourceFromUrl(rawBoardUrl || rawSampleUrl) ?? (rawBoardUrl ? "custom-jsonld" : undefined);
  const atsParsingSource = rawBoardUrl || rawSampleUrl;
  const parsed = parseConfiguredAts(source, atsParsingSource);
  const canonicalBoardUrl = canonicalBoardUrlForCompany(
    buildCanonicalCompanyInput(companyName, source, rawBoardUrl, rawSampleUrl, parsed),
  ) ?? rawBoardUrl ?? rawSampleUrl;
  // Greenhouse boardToken must come from parsing the canonical board URL.
  // Never synthesize from company name — a guessed token scans the wrong board silently.
  const inferredGreenhouseBoardToken = source === "greenhouse" ? (parsed.boardToken || undefined) : undefined;

  // Registry-backed rows should carry only the canonical board URL so scans
  // never depend on a single posting URL saved in seed data.
  const sampleUrl = isRegistryBacked ? canonicalBoardUrl : rawSampleUrl;
  const boardUrl = canonicalBoardUrl;

  return {
    company: companyName,
    aliases: sanitizeStringArray(input.aliases),
    enabled: input.enabled !== false,
    source,
    boardUrl,
    sampleUrl,
    // Preserve registry provenance so custom rows stay editable after save and
    // refresh instead of being reclassified from source/boardUrl alone.
    isRegistry: input.isRegistry === true,
    registryAts:
      typeof input.registryAts === "string" && input.registryAts.trim()
        ? input.registryAts.trim()
        : undefined,
    registryTier:
      typeof input.registryTier === "string" && input.registryTier.trim()
        ? input.registryTier.trim()
        : undefined,

    boardToken:
      typeof input.boardToken === "string" && input.boardToken.trim()
        ? input.boardToken.trim()
        : inferredGreenhouseBoardToken,

    companySlug:
      typeof input.companySlug === "string" && input.companySlug.trim()
        ? input.companySlug.trim()
        : parsed.companySlug,

    smartRecruitersCompanyId:
      typeof input.smartRecruitersCompanyId === "string" && input.smartRecruitersCompanyId.trim()
        ? input.smartRecruitersCompanyId.trim()
        : parsed.smartRecruitersCompanyId,

    leverSite:
      typeof input.leverSite === "string" && input.leverSite.trim()
        ? input.leverSite.trim().toLowerCase()
        : parsed.leverSite,

    workdayBaseUrl:
      typeof input.workdayBaseUrl === "string" && input.workdayBaseUrl.trim()
        ? input.workdayBaseUrl.trim().replace(/\/$/, "")
        : parsed.workdayBaseUrl || (source === "workday" ? boardUrl : undefined),

    host:
      typeof input.host === "string" && input.host.trim()
        ? input.host.trim().toLowerCase()
        : parsed.host,

    tenant:
      typeof input.tenant === "string" && input.tenant.trim()
        ? input.tenant.trim()
        : parsed.tenant,

    site:
      typeof input.site === "string" && input.site.trim()
        ? input.site.trim()
        : parsed.site,
  };
}

export function seedRuntimeConfig(): RuntimeConfig {
  return {
    companies: typedSeedCompanies.map((company) => normalizeCompany(company as unknown as Record<string, unknown>)),
    jobtitles: typedSeedJobtitles,
    updatedAt: nowISO(),
  };
}

export function sanitizeCompanies(input: unknown): CompanyInput[] {
  if (!Array.isArray(input)) throw new Error("Companies must be an array");

  return input
    .filter((c) => c && typeof c === "object")
    .map((c) => c as Record<string, unknown>)
    .filter((c) => typeof c.company === "string" && c.company.trim().length > 0)
    .map(normalizeCompany);
}

async function hydrateRegistryBackedCompanies(companies: CompanyInput[]): Promise<CompanyInput[]> {
  const needsRegistryHydration = companies.some((company) => {
    const isRegistryBacked = company.isRegistry === true || Boolean(company.registryAts || company.registryTier);
    const missingWorkdayFields = company.source === "workday" && !(company.host && company.tenant && company.site);
    // Older saved rows may predate registry provenance fields, so use the
    // company name lookup to heal missing canonical board/base URLs and
    // Workday identifiers even when isRegistry was never persisted.
    return missingWorkdayFields || (isRegistryBacked && !company.boardUrl);
  });
  if (!needsRegistryHydration) return companies;

  await loadRegistryCache();
  return companies.map((company) => {
    const wasMarkedRegistry = company.isRegistry === true || Boolean(company.registryAts || company.registryTier);
    const missingWorkdayFields = company.source === "workday" && !(company.host && company.tenant && company.site);
    const shouldHydrateFromRegistry = wasMarkedRegistry || missingWorkdayFields;
    if (!shouldHydrateFromRegistry) return company;

    const entry = getByCompany(company.company);
    if (!entry?.board_url) return company;

    // Registry ATS labels are helpful but not perfect. If they are absent or
    // too loose, derive the provider from the canonical board/sample URL.
    const normalizedSource =
      company.source ??
      normalizeSource(entry.ats) ??
      inferSourceFromUrl(entry.board_url || entry.sample_url || undefined) ??
      "custom-jsonld";
    if (!normalizedSource) return company;

    const parsingUrl = entry.board_url || entry.sample_url || undefined;
    const parsed = parseConfiguredAts(normalizedSource, parsingUrl);
    const canonicalBoardUrl = canonicalBoardUrlForCompany(
      buildCanonicalCompanyInput(company.company, normalizedSource, entry.board_url || undefined, entry.sample_url || undefined, parsed),
    ) ?? entry.board_url;
    return {
      ...company,
      source: normalizedSource ?? company.source,
      // Registry-backed rows are canonicalized to the board URL so the UI and
      // adapters never drift back to a single job posting URL.
      boardUrl: canonicalBoardUrl,
      sampleUrl: canonicalBoardUrl,
      isRegistry: company.isRegistry === true ? true : undefined,
      registryAts: company.registryAts || entry.ats || undefined,
      registryTier: company.registryTier || entry.tier || undefined,
      workdayBaseUrl:
        typeof parsed.workdayBaseUrl === "string" && parsed.workdayBaseUrl.trim()
          ? parsed.workdayBaseUrl
          : company.workdayBaseUrl || (normalizedSource === "workday" ? canonicalBoardUrl : undefined),
      host: typeof parsed.host === "string" && parsed.host.trim() ? parsed.host : company.host,
      tenant: typeof parsed.tenant === "string" && parsed.tenant.trim() ? parsed.tenant : company.tenant,
      site: typeof parsed.site === "string" && parsed.site.trim() ? parsed.site : company.site,
    };
  });
}

export async function applyCompanyScanOverrides(env: Env, config: RuntimeConfig, tenantId?: string): Promise<RuntimeConfig> {
  const overrides = await loadCompanyScanOverrides(env, tenantId);
  if (!Object.keys(overrides).length) return config;

  return {
    ...config,
    companies: config.companies.map((company) => {
      const override = overrides[slugify(company.company)];
      if (!override?.paused) return company;
      return { ...company, enabled: false };
    }),
  };
}

export function sanitizeJobtitles(input: unknown): JobTitleConfig {
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    includeKeywords: sanitizeStringArray(raw.includeKeywords),
    excludeKeywords: sanitizeStringArray(raw.excludeKeywords),
  };
}

export async function loadRuntimeConfig(env: Env, tenantId?: string): Promise<RuntimeConfig> {
  const kv = configStoreKv(env);
  const scopedKey = tenantScopedKey(tenantId, CONFIG_KEY);
  const legacyKey = tenantScopedKey(undefined, CONFIG_KEY);
  const scopedRaw = await kv.get(scopedKey, "json");
  const legacyRaw = !scopedRaw && tenantId
    // Migrate legacy single-tenant configs forward so existing users keep
    // their saved company lists when tenant scoping is enabled.
    ? await kv.get(legacyKey, "json")
    : null;
  const raw = scopedRaw ?? legacyRaw;
  const usedLegacyFallback = !scopedRaw && Boolean(legacyRaw);

  if (!raw || typeof raw !== "object") {
    const seeded = seedRuntimeConfig();
    await saveRuntimeConfig(env, seeded, tenantId);
    return seeded;
  }

  const obj = raw as Record<string, unknown>;
  const hydratedCompanies = await hydrateRegistryBackedCompanies(sanitizeCompanies(obj.companies));
  const normalized = {
    companies: hydratedCompanies,
    jobtitles: sanitizeJobtitles(obj.jobtitles),
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : nowISO(),
  };
  const serializedRaw = JSON.stringify(raw);
  const serializedNormalized = JSON.stringify(normalized);
  if (serializedNormalized !== serializedRaw) {
    // Persist only when normalization actually repaired or enriched stored config.
    await kv.put(scopedKey, serializedNormalized);
  } else if (tenantId && usedLegacyFallback) {
    // Copy unchanged legacy configs into the tenant key on first read so later
    // scans and edits stay isolated per authenticated user/admin account.
    await kv.put(scopedKey, serializedNormalized);
  }

  return normalized;
}

export async function saveRuntimeConfig(
  env: Env,
  config: RuntimeConfig,
  tenantId?: string,
  _createdByUserId?: string
): Promise<void> {
  const hydratedCompanies = await hydrateRegistryBackedCompanies(sanitizeCompanies(config.companies));
  const normalized: RuntimeConfig = {
    companies: hydratedCompanies,
    jobtitles: sanitizeJobtitles(config.jobtitles),
    updatedAt: nowISO(),
  };

  await configStoreKv(env).put(tenantScopedKey(tenantId, CONFIG_KEY), JSON.stringify(normalized));
}
