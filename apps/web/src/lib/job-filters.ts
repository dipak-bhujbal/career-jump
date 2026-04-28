/**
 * Core job filtering and enrichment utilities — ported 1:1 from vanilla career-jump-aws.
 *
 * These are the same functions the backend uses to:
 *   1. Decide whether a job title is interesting (include/exclude keywords)
 *   2. Detect US vs non-US locations with segment-level precision
 *   3. Enrich job objects with matchedKeywords + geography before storing
 *
 * Used by the mock (install.ts) so local dev filtering is identical to the real backend.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobTitleConfig {
  includeKeywords: string[];
  excludeKeywords: string[];
}

export interface JobForFilter {
  title: string;
  location: string;
  url?: string;
  company?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants — exact copy from vanilla src/constants.ts
// ---------------------------------------------------------------------------

export const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA",
  "MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
  "TX","UT","VT","VA","WA","WV","WI","WY","DC",
]);

export const NON_US_HINTS = [
  "afghanistan","albania","algeria","andorra","angola","antigua and barbuda","argentina","armenia","aruba",
  "australia","austria","azerbaijan","bahamas","bahrain","bangladesh","barbados","belarus","belgium","belize",
  "benin","bhutan","bolivia","bosnia and herzegovina","botswana","brazil","brunei","brunei darussalam",
  "bulgaria","burkina faso","burundi","cabo verde","cape verde","cambodia","cameroon","canada","cayman islands",
  "central african republic","chad","chile","china","colombia","columbia","comoros","congo",
  "republic of the congo","democratic republic of the congo","costa rica","cote d ivoire","cote d'ivoire",
  "ivory coast","croatia","cuba","curacao","curaçao","cyprus","czech republic","czechia","denmark",
  "djibouti","dominica","dominican republic","ecuador","egypt","el salvador","equatorial guinea","eritrea",
  "estonia","eswatini","swaziland","ethiopia","fiji","finland","france","gabon","gambia","georgia","germany",
  "ghana","greece","greenland","grenada","guatemala","guinea","guinea bissau","guyana","haiti","honduras",
  "hong kong","hungary","iceland","india","indonesia","iran","iraq","ireland","isle of man","israel","italy",
  "jamaica","japan","jersey","jordan","kazakhstan","kenya","kiribati","kosovo","kuwait","kyrgyzstan","laos",
  "lao pdr","latvia","lebanon","lesotho","liberia","libya","liechtenstein","lithuania","luxembourg","macao",
  "macau","madagascar","malawi","malaysia","maldives","mali","malta","marshall islands","martinique",
  "mauritania","mauritius","mexico","micronesia","federated states of micronesia","moldova","monaco",
  "mongolia","montenegro","morocco","mozambique","myanmar","burma","namibia","nauru","nepal","netherlands",
  "new caledonia","new zealand","nicaragua","niger","nigeria","north macedonia","macedonia",
  "northern mariana islands","norway","oman","pakistan","palau","palestine","panama","papua new guinea",
  "paraguay","peru","philippines","poland","portugal","puerto rico","qatar","romania","russia",
  "russian federation","rwanda","saint kitts and nevis","saint lucia","saint vincent and the grenadines",
  "samoa","san marino","sao tome and principe","saudi arabia","scotland","senegal","serbia","seychelles",
  "sierra leone","singapore","slovakia","slovenia","solomon islands","somalia","south africa","south korea",
  "korea","south sudan","spain","sri lanka","sudan","suriname","sweden","switzerland","syria","taiwan",
  "tajikistan","tanzania","thailand","timor leste","east timor","togo","tonga","trinidad and tobago",
  "tunisia","turkey","turkmenistan","turks and caicos","tuvalu","uganda","uk","ukraine",
  "united arab emirates","uae","united kingdom","uruguay","uzbekistan","vanuatu","vatican city","venezuela",
  "vietnam","virgin islands","british virgin islands","u s virgin islands","wales","yemen","zambia","zimbabwe",
  "mexico city","emirates","taipei","prague","bucharest","warsaw","krakow","wroclaw","amsterdam","rotterdam",
  "berlin","munich","hamburg","paris","barcelona","madrid","lisbon","zurich","geneva","toronto","vancouver",
  "montreal","mississauga","ottawa","bogota","medellin","buenos aires","sao paulo","rio de janeiro",
  "sydney","melbourne","brisbane","auckland","seoul","tokyo","osaka","beijing","shanghai","shenzhen",
  "manila","jakarta","kuala lumpur","bangkok","noida","gurugram","pune","bangalore","banglore","bengaluru",
  "mumbai","hyderabad","chennai","delhi","new delhi","kolkata","yokneam","rawabi","london","dublin",
  "belfast","edinburgh","bern","frankfurt","glattbrugg",
];

export const NON_US_TITLE_HINTS = ["emea","europe","european union","german speaking"];

const US_EXPLICIT_HINTS = [
  "united states","usa","u s a","u s","us remote","remote us","remote - us",
  "remote, us","remote united states","remote, united states",
];

const LOCATION_SPLIT_PATTERN = /\s*(?:\||\/|;|\n)+\s*/i;

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

export function normalizeText(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Title matching
// ---------------------------------------------------------------------------

/** Returns true if title passes include keywords and is not excluded. */
export function isInterestingTitle(title: string, rules: JobTitleConfig): boolean {
  if (!rules.includeKeywords.length) return true;
  const normalized = normalizeText(title);
  const included = rules.includeKeywords.some((kw) => normalized.includes(normalizeText(kw)));
  const excluded = rules.excludeKeywords.some((kw) => normalized.includes(normalizeText(kw)));
  return included && !excluded;
}

/** Returns the include keywords that matched the title (empty if any exclude keyword matches). */
export function matchedKeywords(title: string, rules: JobTitleConfig): string[] {
  if (!rules.includeKeywords.length) return [];
  const normalized = normalizeText(title);
  const included = rules.includeKeywords.filter((kw) => normalized.includes(normalizeText(kw)));
  const excluded = rules.excludeKeywords.some((kw) => normalized.includes(normalizeText(kw)));
  return excluded ? [] : included;
}

// ---------------------------------------------------------------------------
// Location analysis — ported from vanilla lib/utils.ts
// ---------------------------------------------------------------------------

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeHint(text: string, hint: string): boolean {
  const normalizedHint = normalizeText(hint);
  if (!normalizedHint) return false;
  const pattern = new RegExp(`(?:^|\\b)${escapeRegex(normalizedHint)}(?:\\b|$)`, "i");
  return pattern.test(text);
}

function splitLocationSegments(location: string): string[] {
  const raw = String(location || "").trim();
  if (!raw) return [];
  return raw.split(LOCATION_SPLIT_PATTERN).map((p) => p.trim()).filter(Boolean);
}

function hasExplicitUSHint(text: string): boolean {
  return US_EXPLICIT_HINTS.some((hint) => hasWholeHint(text, hint));
}

function hasUSStatePattern(raw: string): boolean {
  const alt = [...US_STATE_CODES].join("|");
  if (new RegExp(`(?:^|,\\s*)(${alt})(?:\\s*(?:,|$))`, "i").test(raw)) return true;
  if (new RegExp(`\\b(${alt})$`, "i").test(raw)) return true;
  return false;
}

function detectUSFromSegment(raw: string): boolean {
  const normalized = normalizeText(raw);
  if (!normalized) return false;
  return hasExplicitUSHint(normalized) || hasUSStatePattern(raw);
}

function detectNonUSHint(raw: string): string | null {
  const normalized = normalizeText(raw);
  if (!normalized) return null;
  for (const hint of NON_US_HINTS) {
    if (hasWholeHint(normalized, hint)) return hint;
  }
  const nonUsCountryCodes = new Set([
    "at","au","be","bg","br","ch","cl","cz","de","dk","ee","es","fi","fr","gb","gr","hk","hr","hu",
    "ie","il","it","jp","kr","lt","lu","lv","mx","my","nl","no","nz","ph","pl","pt","ro","rs","se",
    "sg","si","sk","th","tr","tw","ua","uk","za",
  ]);
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1]?.toLowerCase();
  if (last && /^[a-z]{2}$/i.test(last) && nonUsCountryCodes.has(last)) return last;
  return null;
}

function detectNonUSUrlHint(url?: string): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const candidate = decodeURIComponent(`${parsed.hostname} ${parsed.pathname}`.replace(/[/_-]+/g, " "));
    return detectNonUSHint(candidate);
  } catch {
    return null;
  }
}

function detectNonUSTitleHint(title: string): string | null {
  const normalized = normalizeText(title);
  if (!normalized) return null;
  if (/\beu\b/i.test(title)) return "eu";
  for (const hint of NON_US_TITLE_HINTS) {
    if (hasWholeHint(normalized, hint)) return hint;
  }
  return null;
}

export interface LocationAnalysis {
  isUSLikely: boolean | null;
  detectedCountry: string;
  hasUS: boolean;
  hasNonUS: boolean;
  isMixed: boolean;
}

export function analyzeJobLocation(location: string): LocationAnalysis {
  const raw = String(location || "").trim();
  if (!raw) return { isUSLikely: null, detectedCountry: "Unknown", hasUS: false, hasNonUS: false, isMixed: false };

  const segments = splitLocationSegments(raw);
  const candidates = segments.length ? [raw, ...segments] : [raw];

  let hasUS = false;
  let firstNonUS: string | null = null;
  for (const c of candidates) {
    if (!hasUS && detectUSFromSegment(c)) hasUS = true;
    if (!firstNonUS) firstNonUS = detectNonUSHint(c);
  }

  const hasNonUS = Boolean(firstNonUS);
  const isMixed = hasUS && hasNonUS;
  if (isMixed) return { isUSLikely: true, detectedCountry: "Mixed", hasUS: true, hasNonUS: true, isMixed: true };
  if (hasUS) return { isUSLikely: true, detectedCountry: "United States", hasUS: true, hasNonUS: false, isMixed: false };
  if (hasNonUS) return { isUSLikely: false, detectedCountry: firstNonUS || "Non-US", hasUS: false, hasNonUS: true, isMixed: false };
  return { isUSLikely: null, detectedCountry: "Unknown", hasUS: false, hasNonUS: false, isMixed: false };
}

export function detectUSLikely(location: string): { isUSLikely: boolean | null; detectedCountry: string } {
  const { isUSLikely, detectedCountry } = analyzeJobLocation(location);
  return { isUSLikely, detectedCountry };
}

/** Drop only clearly non-US jobs. Keep mixed/unknown. */
export function shouldKeepJobForUSInventory(location: string, title = "", url = ""): boolean {
  const result = analyzeJobLocation(location);
  const titleHint = detectNonUSTitleHint(title);
  const urlHint = detectNonUSUrlHint(url);
  if (!result.hasUS && (titleHint || urlHint)) return false;
  return !(result.hasNonUS && !result.hasUS);
}

/** Add matchedKeywords + geography fields to a job object. */
export function enrichJob<T extends JobForFilter>(job: T, rules: JobTitleConfig): T & {
  matchedKeywords: string[];
  isUSLikely: boolean | null;
  detectedCountry: string;
} {
  const locGeo = analyzeJobLocation(job.location);
  const urlHint = detectNonUSUrlHint(job.url);
  const geography = !locGeo.hasUS && urlHint
    ? { isUSLikely: false as const, detectedCountry: urlHint }
    : { isUSLikely: locGeo.isUSLikely, detectedCountry: locGeo.detectedCountry };
  return {
    ...job,
    matchedKeywords: matchedKeywords(job.title, rules),
    isUSLikely: geography.isUSLikely,
    detectedCountry: geography.detectedCountry,
  };
}

// ---------------------------------------------------------------------------
// ATS adapter names — full list matching vanilla registry
// ---------------------------------------------------------------------------

export const ALL_ATS_ADAPTERS = [
  // Core adapters
  { id: "workday",         label: "Workday" },
  { id: "greenhouse",      label: "Greenhouse" },
  { id: "ashby",           label: "Ashby" },
  { id: "lever",           label: "Lever" },
  { id: "smartrecruiters", label: "SmartRecruiters" },
  { id: "bamboohr",        label: "BambooHR" },
  { id: "breezy",          label: "Breezy HR" },
  { id: "eightfold",       label: "Eightfold" },
  { id: "icims",           label: "iCIMS" },
  { id: "jobvite",         label: "Jobvite" },
  { id: "oracle",          label: "Oracle HCM" },
  { id: "phenom",          label: "Phenom" },
  { id: "recruitee",       label: "Recruitee" },
  { id: "successfactors",  label: "SAP SuccessFactors" },
  { id: "taleo",           label: "Oracle Taleo" },
  { id: "workable",        label: "Workable" },
  // Custom / crawlers
  { id: "jsonld",          label: "JSON-LD (schema.org)" },
  { id: "sitemap",         label: "Sitemap crawler" },
] as const;

export type AtsId = typeof ALL_ATS_ADAPTERS[number]["id"];

// ---------------------------------------------------------------------------
// Core ATS source types (the 5 adapters with URL parsing support)
// ---------------------------------------------------------------------------

export type AtsSource = "greenhouse" | "ashby" | "smartrecruiters" | "workday" | "lever";

export type DetectedConfig =
  | { source: "greenhouse"; boardToken: string; sampleUrl?: string }
  | { source: "ashby"; companySlug: string }
  | { source: "smartrecruiters"; smartRecruitersCompanyId: string }
  | { source: "lever"; leverSite: string; sampleUrl?: string }
  | { source: "workday"; sampleUrl?: string; workdayBaseUrl?: string; host?: string; tenant?: string; site?: string };

export type CompanyInput = {
  company: string;
  aliases?: string[];
  enabled?: boolean;
  source?: AtsSource;
  sampleUrl?: string;
  boardToken?: string;
  companySlug?: string;
  smartRecruitersCompanyId?: string;
  leverSite?: string;
  workdayBaseUrl?: string;
  host?: string;
  tenant?: string;
  site?: string;
};

// ---------------------------------------------------------------------------
// String utilities
// ---------------------------------------------------------------------------

export function slugify(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

export function hyphenSlug(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Job deduplication
// ---------------------------------------------------------------------------

function normalizeFingerprintUrl(url?: string, title = ""): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  const titleTokens = new Set(normalizeText(title).split(" ").filter(Boolean));
  const ignoredTokens = new Set([
    "apply","career","careers","detail","details","job","jobs",
    "opening","openings","position","positions","posting","postings",
    "role","roles","view",
  ]);
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const semanticTokens = parts
      .flatMap((part) => normalizeText(part).split(" "))
      .filter((token) => {
        if (!token || token.length < 3) return false;
        if (ignoredTokens.has(token)) return false;
        if (/^\d+$/.test(token)) return false;
        if (/^[a-f0-9]{8,}$/i.test(token)) return false;
        if (/^r\d+$/i.test(token)) return false;
        if (titleTokens.has(token)) return false;
        return true;
      });
    return [...new Set(semanticTokens)].slice(-4).join("-");
  } catch {
    return "";
  }
}

export function jobStableFingerprint(job: { source: string; company: string; title: string; url?: string }): string {
  const source = slugify(job.source);
  const company = slugify(job.company);
  const title = hyphenSlug(job.title) || "unknown-title";
  const urlSignature = normalizeFingerprintUrl(job.url, job.title);
  return `${source}:${company}:${title}${urlSignature ? `:u:${urlSignature}` : ""}`;
}

// ---------------------------------------------------------------------------
// Company name variants
// ---------------------------------------------------------------------------

export function buildCompanyCandidates(company: Pick<CompanyInput, "company" | "aliases">): string[] {
  const raw = [company.company, ...(company.aliases ?? [])].filter(Boolean);
  const variants = new Set<string>();
  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    variants.add(trimmed);
    variants.add(trimmed.replace(/\s*&\s*/g, " and "));
    variants.add(trimmed.replace(/\band\b/gi, "&"));
    variants.add(trimmed.replace(/[.'']/g, ""));
  }
  return [...variants];
}

// ---------------------------------------------------------------------------
// Generic deduplication
// ---------------------------------------------------------------------------

export function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

// ---------------------------------------------------------------------------
// HTML entity decoding
// ---------------------------------------------------------------------------

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// ---------------------------------------------------------------------------
// Posted-at normalisation
// ---------------------------------------------------------------------------

export function normalizePostedAtValue(value?: string): string | undefined {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();

  const normalized = raw.toLowerCase().trim();
  const now = new Date();

  if (normalized === "today" || normalized === "posted today") return now.toISOString();
  if (normalized === "yesterday" || normalized === "posted yesterday") {
    return new Date(now.getTime() - 86_400_000).toISOString();
  }

  const rel = normalized.match(
    /^posted\s+(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago$|^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago$/
  );
  if (rel) {
    const amount = Number(rel[1] ?? rel[3]);
    const unit = String(rel[2] ?? rel[4] ?? "");
    if (Number.isFinite(amount) && amount >= 0) {
      const date = new Date(now.getTime());
      if (unit.startsWith("minute")) date.setMinutes(date.getMinutes() - amount);
      else if (unit.startsWith("hour")) date.setHours(date.getHours() - amount);
      else if (unit.startsWith("day")) date.setDate(date.getDate() - amount);
      else if (unit.startsWith("week")) date.setDate(date.getDate() - amount * 7);
      else if (unit.startsWith("month")) date.setMonth(date.getMonth() - amount);
      return date.toISOString();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// ATS sample URL parsers
// ---------------------------------------------------------------------------

export function parseWorkdaySampleUrl(
  sampleUrl: string
): Pick<CompanyInput, "host" | "tenant" | "site" | "workdayBaseUrl"> {
  try {
    const url = new URL(sampleUrl);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    const site = parts.length >= 2 ? parts[1] : "";
    const tenant = host.split(".wd")[0].split(".")[0];
    const workdayBaseUrl = site ? `${url.origin}/en-US/${site}` : undefined;
    if (!host || !tenant || !site) return {};
    return { host, tenant, site, workdayBaseUrl };
  } catch {
    return {};
  }
}

export function parseGreenhouseSampleUrl(sampleUrl: string): Pick<CompanyInput, "boardToken"> {
  try {
    const url = new URL(sampleUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const host = url.hostname.toLowerCase();
    // Many companies keep Greenhouse on their own domain and link to jobs with
    // `gh_jid`, while the real board slug still lives in the first path segment.
    // Accept both the native Greenhouse hosts and custom company domains.
    const nativeGreenhouseHost = host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io";
    const queryBoardToken = url.searchParams.get("for")?.trim();
    if (queryBoardToken) return { boardToken: queryBoardToken };
    const hostedGreenhouseJob = url.searchParams.get("gh_jid")?.trim();
    if (hostedGreenhouseJob && parts[0]) return { boardToken: parts[0] };
    if (!nativeGreenhouseHost) return {};
    const isEmbedPath =
      parts.length >= 2 && parts[0] === "embed" &&
      (parts[1] === "job_board" || parts[1] === "job_board_widget");
    if (isEmbedPath) return {};
    const boardToken = parts[0] || "";
    return boardToken ? { boardToken } : {};
  } catch {
    return {};
  }
}

export function parseAshbySampleUrl(sampleUrl: string): Pick<CompanyInput, "companySlug"> {
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

export function parseSmartRecruitersSampleUrl(
  sampleUrl: string
): Pick<CompanyInput, "smartRecruitersCompanyId"> {
  try {
    const url = new URL(sampleUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const host = url.hostname.toLowerCase();
    if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com") {
      const smartRecruitersCompanyId = parts[0] || "";
      return smartRecruitersCompanyId ? { smartRecruitersCompanyId } : {};
    }
    return {};
  } catch {
    return {};
  }
}

export function parseLeverSampleUrl(sampleUrl: string): Pick<CompanyInput, "leverSite"> {
  try {
    const url = new URL(sampleUrl);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if (host !== "jobs.lever.co") return {};
    const leverSite = String(parts[0] ?? "").trim().toLowerCase();
    return leverSite ? { leverSite } : {};
  } catch {
    return {};
  }
}

export function parseConfiguredAts(
  source: AtsSource | string | undefined,
  sampleUrl: string | undefined
): Partial<CompanyInput> {
  if (!source || !sampleUrl) return {};
  switch (source) {
    case "workday":        return parseWorkdaySampleUrl(sampleUrl);
    case "greenhouse":     return parseGreenhouseSampleUrl(sampleUrl);
    case "ashby":          return parseAshbySampleUrl(sampleUrl);
    case "smartrecruiters":return parseSmartRecruitersSampleUrl(sampleUrl);
    case "lever":          return parseLeverSampleUrl(sampleUrl);
    default:               return {};
  }
}

export function companyToDetectedConfig(company: CompanyInput): DetectedConfig | null {
  switch (company.source) {
    case "workday":
      if (company.host && company.tenant && company.site) {
        return { source: "workday", sampleUrl: company.sampleUrl, workdayBaseUrl: company.workdayBaseUrl, host: company.host, tenant: company.tenant, site: company.site };
      }
      return company.sampleUrl || company.workdayBaseUrl
        ? { source: "workday", sampleUrl: company.sampleUrl, workdayBaseUrl: company.workdayBaseUrl }
        : null;
    case "greenhouse":
      return company.boardToken ? { source: "greenhouse", boardToken: company.boardToken, sampleUrl: company.sampleUrl } : null;
    case "ashby":
      return company.companySlug ? { source: "ashby", companySlug: company.companySlug } : null;
    case "smartrecruiters":
      return company.smartRecruitersCompanyId ? { source: "smartrecruiters", smartRecruitersCompanyId: company.smartRecruitersCompanyId } : null;
    case "lever":
      return company.leverSite ? { source: "lever", leverSite: company.leverSite, sampleUrl: company.sampleUrl } : null;
    default:
      return null;
  }
}
