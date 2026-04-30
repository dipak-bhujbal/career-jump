import { NON_US_HINTS, NON_US_TITLE_HINTS, US_STATE_CODES, VALID_STATUSES } from "../constants";
import type { AppliedJobStatus, CompanyInput, JobPosting, JobTitleConfig } from "../types";

/**
 * Current timestamp in ISO format.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Normalize text for fuzzy matching.
 * Removes punctuation-like separators, lowercases, and compresses whitespace.
 */
export function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

/**
 * Slugify to a compact token-like form.
 */
export function slugify(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

/**
 * Slugify to hyphenated form.
 */
export function hyphenSlug(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Format date/time in Eastern Time for UI display.
 */
export function formatET(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

/**
 * Format date only in Eastern Time for display in tables.
 */
export function formatDateOnly(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Convert mixed ATS postedAt values into ISO.
 */
export function normalizePostedAtValue(value?: string): string | undefined {
  if (!value) return undefined;

  const raw = String(value).trim();
  if (!raw) return undefined;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const normalized = raw.toLowerCase().trim();
  const now = new Date();

  if (normalized === "today" || normalized === "posted today") {
    return now.toISOString();
  }

  if (normalized === "yesterday" || normalized === "posted yesterday") {
    const date = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return date.toISOString();
  }

  const relativeMatch = normalized.match(
    /^posted\s+(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago$|^(\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago$/
  );

  if (relativeMatch) {
    const amount = Number(relativeMatch[1] || relativeMatch[3]);
    const unit = String(relativeMatch[2] || relativeMatch[4] || "");

    if (Number.isFinite(amount) && amount >= 0) {
      const date = new Date(now.getTime());

      if (unit.startsWith("minute")) {
        date.setMinutes(date.getMinutes() - amount);
      } else if (unit.startsWith("hour")) {
        date.setHours(date.getHours() - amount);
      } else if (unit.startsWith("day")) {
        date.setDate(date.getDate() - amount);
      } else if (unit.startsWith("week")) {
        date.setDate(date.getDate() - amount * 7);
      } else if (unit.startsWith("month")) {
        date.setMonth(date.getMonth() - amount);
      }

      return date.toISOString();
    }
  }

  return undefined;
}

/**
 * Stable internal key for a job row.
 */
export function jobKey(job: JobPosting): string {
  return `${job.source}:${job.company}:${job.id}`;
}

function normalizeFingerprintUrl(url?: string, title = ""): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";

  const titleTokens = new Set(normalizeText(title).split(" ").filter(Boolean));
  const ignoredTokens = new Set([
    "apply",
    "career",
    "careers",
    "detail",
    "details",
    "job",
    "jobs",
    "opening",
    "openings",
    "position",
    "positions",
    "posting",
    "postings",
    "role",
    "roles",
    "view",
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

export function jobStableFingerprint(job: JobPosting): string {
  const source = slugify(job.source);
  const company = slugify(job.company);
  const title = hyphenSlug(job.title) || "unknown-title";
  const urlSignature = normalizeFingerprintUrl(job.url, job.title);
  return `${source}:${company}:${title}${urlSignature ? `:u:${urlSignature}` : ""}`;
}

/**
 * Normalize applied status from user input.
 */
export function normalizeAppliedStatus(value: unknown): AppliedJobStatus {
  const text = String(value ?? "Applied").trim();
  return (VALID_STATUSES as string[]).includes(text) ? (text as AppliedJobStatus) : "Applied";
}

/**
 * Returns true if a job title should be included.
 */
export function isInterestingTitle(title: string, rules: JobTitleConfig): boolean {
  const normalized = normalizeText(title);
  const included = rules.includeKeywords.some((keyword) => normalized.includes(normalizeText(keyword)));
  const excluded = rules.excludeKeywords.some((keyword) => normalized.includes(normalizeText(keyword)));
  return included && !excluded;
}

/**
 * Return matched include keywords for a title unless excluded.
 */
export function matchedKeywords(title: string, rules: JobTitleConfig): string[] {
  const normalized = normalizeText(title);
  const included = rules.includeKeywords.filter((keyword) => normalized.includes(normalizeText(keyword)));
  const excluded = rules.excludeKeywords.some((keyword) => normalized.includes(normalizeText(keyword)));
  return excluded ? [] : included;
}

/**
 * Generate company naming variants to improve ATS detection.
 */
export function buildCompanyCandidates(company: CompanyInput): string[] {
  const raw = [company.company, ...(company.aliases ?? [])].filter(Boolean);
  const variants = new Set<string>();

  for (const item of raw) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    variants.add(trimmed);
    variants.add(trimmed.replace(/\s*&\s*/g, " and "));
    variants.add(trimmed.replace(/\band\b/gi, "&"));
    variants.add(trimmed.replace(/[.'’]/g, ""));
  }

  return [...variants];
}

const US_EXPLICIT_HINTS = [
  "united states",
  "usa",
  "u s a",
  "u s",
  "us remote",
  "remote us",
  "remote - us",
  "remote, us",
  "remote united states",
  "remote, united states",
];

const LOCATION_SPLIT_PATTERN = /\s*(?:\||\/|;|\n)+\s*/i;

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
  return raw
    .split(LOCATION_SPLIT_PATTERN)
    .map((part) => part.trim())
    .filter(Boolean);
}

function hasExplicitUSHint(locationText: string): boolean {
  return US_EXPLICIT_HINTS.some((hint) => hasWholeHint(locationText, hint));
}

function hasUSStatePattern(rawSegment: string): boolean {
  const stateAlternation = [...US_STATE_CODES].join("|");

  const commaStatePattern = new RegExp(`(?:^|,\\s*)(${stateAlternation})(?:\\s*(?:,|$))`, "i");
  if (commaStatePattern.test(rawSegment)) return true;

  const trailingStatePattern = new RegExp(`\\b(${stateAlternation})$`, "i");
  if (trailingStatePattern.test(rawSegment)) return true;

  return false;
}

function detectUSFromSegment(rawSegment: string): boolean {
  const normalized = normalizeText(rawSegment);
  if (!normalized) return false;

  // ATS location feeds often end with ISO country codes like ", DE" or ", AR".
  // Those collide with Delaware / Arkansas, so guard them before the US-state
  // detector can classify the segment as a US location.
  const trailingToken = rawSegment
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const lastToken = trailingToken[trailingToken.length - 1]?.toLowerCase();
  const explicitNonUsCountryCodes = new Set(["ar", "de"]);
  if (lastToken && explicitNonUsCountryCodes.has(lastToken)) return false;

  if (hasExplicitUSHint(normalized)) return true;
  if (hasUSStatePattern(rawSegment)) return true;

  return false;
}

function detectNonUSHint(rawSegment: string): string | null {
  const normalized = normalizeText(rawSegment);
  if (!normalized) return null;

  for (const hint of NON_US_HINTS) {
    if (hasWholeHint(normalized, hint)) {
      return hint;
    }
  }

  // Many ATS feeds emit lowercase ISO country codes such as ", ch" or ", de".
  // Treat those as non-US hints while avoiding uppercase US state abbreviations.
  const trailingToken = rawSegment
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const lastToken = trailingToken[trailingToken.length - 1];
  const normalizedLastToken = lastToken?.toLowerCase();
  if (lastToken && normalizedLastToken && /^[a-z]{2}$/i.test(lastToken)) {
    const nonUsCountryCodes = new Set([
      "ar", "at", "au", "be", "bg", "br", "ch", "cl", "cz", "de", "dk", "ee", "es", "fi", "fr",
      "gb", "gr", "hk", "hr", "hu", "ie", "il", "it", "jp", "kr", "lt", "lu", "lv", "mx",
      "my", "nl", "no", "nz", "ph", "pl", "pt", "ro", "rs", "se", "sg", "si", "sk", "th",
      "tr", "tw", "ua", "uk", "za",
    ]);
    if (nonUsCountryCodes.has(normalizedLastToken)) {
      return normalizedLastToken;
    }
  }

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
    if (hasWholeHint(normalized, hint)) {
      return hint;
    }
  }

  return null;
}

export function analyzeJobLocation(location: string): {
  isUSLikely: boolean | null;
  detectedCountry: string;
  hasUS: boolean;
  hasNonUS: boolean;
  isMixed: boolean;
} {
  const raw = String(location || "").trim();
  if (!raw) {
    return {
      isUSLikely: null,
      detectedCountry: "Unknown",
      hasUS: false,
      hasNonUS: false,
      isMixed: false,
    };
  }

  const segments = splitLocationSegments(raw);
  const candidates = segments.length ? [raw, ...segments] : [raw];

  let hasUS = false;
  let firstNonUS: string | null = null;

  for (const candidate of candidates) {
    if (!hasUS && detectUSFromSegment(candidate)) {
      hasUS = true;
    }

    if (!firstNonUS) {
      firstNonUS = detectNonUSHint(candidate);
    }
  }

  const hasNonUS = Boolean(firstNonUS);
  const isMixed = hasUS && hasNonUS;

  if (isMixed) {
    return {
      isUSLikely: true,
      detectedCountry: "Mixed",
      hasUS: true,
      hasNonUS: true,
      isMixed: true,
    };
  }

  if (hasUS) {
    return {
      isUSLikely: true,
      detectedCountry: "United States",
      hasUS: true,
      hasNonUS: false,
      isMixed: false,
    };
  }

  if (hasNonUS) {
    return {
      isUSLikely: false,
      detectedCountry: firstNonUS || "Non-US",
      hasUS: false,
      hasNonUS: true,
      isMixed: false,
    };
  }

  return {
    isUSLikely: null,
    detectedCountry: "Unknown",
    hasUS: false,
    hasNonUS: false,
    isMixed: false,
  };
}

/**
 * Lightweight country/US detection from location text.
 * Mixed US + non-US locations are preserved as US-likely.
 */
export function detectUSLikely(location: string): { isUSLikely: boolean | null; detectedCountry: string } {
  const result = analyzeJobLocation(location);
  return {
    isUSLikely: result.isUSLikely,
    detectedCountry: result.detectedCountry,
  };
}

/**
 * Exclude only clearly non-US locations.
 * Keep mixed locations such as:
 * - Pune, India / Boston, MA
 * - Mexico City / San Francisco, CA
 * - Canada / Remote US
 */
export function shouldKeepJobForUSInventory(location: string, title = "", url = ""): boolean {
  const result = analyzeJobLocation(location);
  const titleNonUSHint = detectNonUSTitleHint(title);
  const urlNonUSHint = detectNonUSUrlHint(url);
  if (!result.hasUS && (titleNonUSHint || urlNonUSHint)) return false;
  return !(result.hasNonUS && !result.hasUS);
}

/**
 * Add derived fields such as geography and matched keywords.
 */
export function enrichJob(job: JobPosting, rules: JobTitleConfig): JobPosting {
  const locationGeography = analyzeJobLocation(job.location);
  const urlNonUSHint = detectNonUSUrlHint(job.url);
  const geography = !locationGeography.hasUS && urlNonUSHint
    ? { isUSLikely: false, detectedCountry: urlNonUSHint }
    : {
        isUSLikely: locationGeography.isUSLikely,
        detectedCountry: locationGeography.detectedCountry,
      };
  return {
    ...job,
    detectedCountry: geography.detectedCountry,
    isUSLikely: geography.isUSLikely,
    matchedKeywords: matchedKeywords(job.title, rules),
  };
}

/**
 * Deduplicate an array by a stable key selector.
 */
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

/**
 * Decode a few common HTML entities used in search result pages.
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
