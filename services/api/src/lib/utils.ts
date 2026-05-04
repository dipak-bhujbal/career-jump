import { NON_US_HINTS, NON_US_TITLE_HINTS, US_STATE_CODES, VALID_STATUSES } from "../constants";
import {
  US_MAJOR_LOCALITY_ALIAS_TO_CANONICAL,
  US_STATE_ALIAS_TO_CODE,
  US_STRONG_LOCALITY_ALIASES,
  US_WEAK_LOCALITY_ALIASES,
} from "./us-geo.generated";
import type { AppliedJobStatus, CompanyInput, GeoConfidence, GeoDecision, JobPosting, JobTitleConfig } from "../types";

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
const US_STRONG_LOCALITY_ALIAS_SET = new Set(US_STRONG_LOCALITY_ALIASES);
const US_WEAK_LOCALITY_ALIAS_SET = new Set(US_WEAK_LOCALITY_ALIASES);
const US_STATE_NAME_ALIAS_SET = new Set(
  Object.keys(US_STATE_ALIAS_TO_CODE).filter((alias) => alias.length > 2 || alias.includes(" ")),
);
const US_LOCALITY_CANONICAL_BY_ALIAS = new Map(Object.entries(US_MAJOR_LOCALITY_ALIAS_TO_CANONICAL));
const MAX_LOCALITY_PHRASE_TOKENS = 8;
const NON_US_COUNTRY_CODE_HINTS = new Set([
  "ar", "at", "au", "be", "bg", "br", "ch", "cl", "cz", "de", "dk", "ee", "es", "fi", "fr",
  "gb", "gr", "hk", "hr", "hu", "ie", "il", "it", "jp", "kr", "lt", "lu", "lv", "mx",
  "my", "nl", "no", "nz", "ph", "pl", "pt", "ro", "rs", "se", "sg", "si", "sk", "th",
  "tr", "tw", "ua", "uk", "za",
]);
const AMBIGUOUS_US_STATE_CODES = new Set(["ar", "de", "in", "or", "me", "hi"]);

type USLocationStrength = "none" | "weak" | "strong";
type NonUSStrength = "none" | "weak" | "strong";

export type JobGeographyAssessment = {
  decision: GeoDecision;
  confidence: GeoConfidence;
  score: number;
  reasons: string[];
  detectedCountry: string;
  isUSLikely: boolean | null;
  hasUS: boolean;
  hasNonUS: boolean;
  isMixed: boolean;
  matchedUsLocality?: string;
  matchedUsState?: string;
};

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
    .flatMap((part) => part.split(/\s+\bor\b\s+/i))
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

/**
 * Build normalized location phrases so alias lookups can stay set-based.
 * This is much cheaper than scanning thousands of aliases for every job.
 */
function collectNormalizedLocationPhrases(rawSegment: string): Set<string> {
  const normalized = normalizeText(rawSegment);
  const phrases = new Set<string>();
  if (!normalized) return phrases;

  phrases.add(normalized);

  const tokens = normalized.split(" ").filter(Boolean);
  const maxTokens = Math.min(tokens.length, MAX_LOCALITY_PHRASE_TOKENS);
  for (let width = 1; width <= maxTokens; width += 1) {
    for (let start = 0; start + width <= tokens.length; start += 1) {
      phrases.add(tokens.slice(start, start + width).join(" "));
    }
  }

  return phrases;
}

function hasAliasPhraseMatch(phrases: Set<string>, aliases: Set<string>): boolean {
  for (const phrase of phrases) {
    if (aliases.has(phrase)) return true;
  }
  return false;
}

function hasUSStateNameHint(rawSegment: string): boolean {
  return hasAliasPhraseMatch(collectNormalizedLocationPhrases(rawSegment), US_STATE_NAME_ALIAS_SET);
}

function findMatchingAlias(phrases: Set<string>, aliases: Set<string>): string | null {
  for (const phrase of phrases) {
    if (aliases.has(phrase)) return phrase;
  }
  return null;
}

function findMatchedUSState(rawSegment: string): string | undefined {
  const phrases = collectNormalizedLocationPhrases(rawSegment);
  for (const phrase of phrases) {
    const code = US_STATE_ALIAS_TO_CODE[phrase];
    if (code) return code;
  }

  const rawParts = rawSegment
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of rawParts) {
    const upper = part.toUpperCase();
    if (US_STATE_CODES.has(upper)) return upper;
  }

  const trailingStatePattern = new RegExp(`\\b(${[...US_STATE_CODES].join("|")})$`, "i");
  const match = rawSegment.match(trailingStatePattern);
  return match?.[1]?.toUpperCase();
}

function findMatchedUSLocality(rawSegment: string): string | undefined {
  const phrases = collectNormalizedLocationPhrases(rawSegment);
  const matchedStrongAlias = findMatchingAlias(phrases, US_STRONG_LOCALITY_ALIAS_SET);
  if (matchedStrongAlias) return US_LOCALITY_CANONICAL_BY_ALIAS.get(matchedStrongAlias);

  const matchedWeakAlias = findMatchingAlias(phrases, US_WEAK_LOCALITY_ALIAS_SET);
  if (matchedWeakAlias) return US_LOCALITY_CANONICAL_BY_ALIAS.get(matchedWeakAlias);

  return undefined;
}

/**
 * Classify U.S. geography strength.
 * Strong signals can safely beat sparse ATS location text.
 * Weak signals keep ambiguous U.S. city-only rows, but they should not
 * override an explicit foreign-country signal like "Cambridge, UK".
 */
function detectUSStrengthFromSegment(rawSegment: string): {
  strength: USLocationStrength;
  matchedUsState?: string;
  matchedUsLocality?: string;
} {
  const normalized = normalizeText(rawSegment);
  if (!normalized) return { strength: "none" };

  const phrases = collectNormalizedLocationPhrases(rawSegment);
  const matchedUsState = findMatchedUSState(rawSegment);
  const matchedUsLocality = findMatchedUSLocality(rawSegment);

  if (hasExplicitUSHint(normalized)) {
    return { strength: "strong", matchedUsState, matchedUsLocality };
  }
  if (hasUSStateNameHint(rawSegment)) {
    return { strength: "strong", matchedUsState, matchedUsLocality };
  }
  if (hasAliasPhraseMatch(phrases, US_STRONG_LOCALITY_ALIAS_SET)) {
    return { strength: "strong", matchedUsState, matchedUsLocality };
  }

  if (hasUSStatePattern(rawSegment)) {
    const trailingToken = rawSegment
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const lastToken = trailingToken[trailingToken.length - 1]?.toLowerCase();

    // Keep Delaware / Arkansas only when some other U.S. signal is present.
    if (lastToken && AMBIGUOUS_US_STATE_CODES.has(lastToken)) {
      if (hasAliasPhraseMatch(phrases, US_WEAK_LOCALITY_ALIAS_SET)) {
        return { strength: "strong", matchedUsState, matchedUsLocality };
      }
      return { strength: "none" };
    }
    return { strength: "strong", matchedUsState, matchedUsLocality };
  }

  if (hasAliasPhraseMatch(phrases, US_WEAK_LOCALITY_ALIAS_SET)) {
    return { strength: "weak", matchedUsState, matchedUsLocality };
  }
  return { strength: "none" };
}

function detectNonUSHint(rawSegment: string): { hint: string | null; strength: NonUSStrength } {
  const normalized = normalizeText(rawSegment);
  if (!normalized) return { hint: null, strength: "none" };

  for (const hint of NON_US_HINTS) {
    if (hasWholeHint(normalized, hint)) {
      return { hint, strength: "strong" };
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
    if (NON_US_COUNTRY_CODE_HINTS.has(normalizedLastToken)) {
      return { hint: normalizedLastToken, strength: "weak" };
    }
  }

  return { hint: null, strength: "none" };
}

function detectNonUSUrlHint(url?: string): { hint: string | null; strength: NonUSStrength } {
  const raw = String(url ?? "").trim();
  if (!raw) return { hint: null, strength: "none" };

  try {
    const parsed = new URL(raw);
    const candidate = decodeURIComponent(`${parsed.hostname} ${parsed.pathname}`.replace(/[/_-]+/g, " "));
    return detectNonUSHint(candidate);
  } catch {
    return { hint: null, strength: "none" };
  }
}

function detectUSUrlHint(url?: string): boolean {
  const raw = String(url ?? "").trim();
  if (!raw) return false;

  try {
    const parsed = new URL(raw);
    const candidate = decodeURIComponent(`${parsed.hostname} ${parsed.pathname}`.replace(/[/_-]+/g, " "));
    return hasExplicitUSHint(normalizeText(candidate));
  } catch {
    return false;
  }
}

function detectNonUSTitleHint(title: string): { hint: string | null; strength: NonUSStrength } {
  const normalized = normalizeText(title);
  if (!normalized) return { hint: null, strength: "none" };

  if (/\beu\b/i.test(title)) return { hint: "eu", strength: "strong" };

  for (const hint of NON_US_TITLE_HINTS) {
    if (hasWholeHint(normalized, hint)) {
      return { hint, strength: "strong" };
    }
  }

  return { hint: null, strength: "none" };
}

function detectUSTitleHint(title: string): boolean {
  const normalized = normalizeText(title);
  if (!normalized) return false;
  return hasExplicitUSHint(normalized);
}

function structuredLocationString(job: Pick<JobPosting, "locationCity" | "locationState" | "locationCountry">): string {
  return [job.locationCity, job.locationState, job.locationCountry].filter(Boolean).join(", ");
}

/**
 * Build a scored geography assessment. Only confident non-U.S. rows are
 * dropped; ambiguous rows stay in "review" to avoid false negatives.
 */
export function assessJobGeography(job: Pick<JobPosting,
  "location" | "title" | "url" | "locationCity" | "locationState" | "locationCountry" | "isRemote" | "isHybrid"
>): JobGeographyAssessment {
  const rawLocation = String(job.location ?? "").trim();
  const title = String(job.title ?? "");
  const url = String(job.url ?? "");
  const segments = rawLocation ? splitLocationSegments(rawLocation) : [];
  const candidates = rawLocation ? [rawLocation, ...segments] : [];
  const structuredLocation = structuredLocationString(job);
  if (structuredLocation) candidates.push(structuredLocation);

  let score = 0;
  const reasons = new Set<string>();
  let hasStrongUS = false;
  let hasWeakUS = false;
  let hasStrongNonUS = false;
  let hasWeakNonUS = false;
  let firstNonUS: string | null = null;
  let matchedUsState: string | undefined;
  let matchedUsLocality: string | undefined;

  for (const candidate of candidates) {
    const us = detectUSStrengthFromSegment(candidate);
    if (us.matchedUsState) matchedUsState ??= us.matchedUsState;
    if (us.matchedUsLocality) matchedUsLocality ??= us.matchedUsLocality;
    if (us.strength === "strong") {
      hasStrongUS = true;
      score += 6;
      reasons.add("location_us_strong");
    } else if (us.strength === "weak") {
      hasWeakUS = true;
      score += 2;
      reasons.add("location_us_weak");
    }

    const nonUs = detectNonUSHint(candidate);
    if (nonUs.hint && !firstNonUS) firstNonUS = nonUs.hint;
    if (nonUs.strength === "strong") {
      hasStrongNonUS = true;
      score -= 7;
      reasons.add(`location_non_us_strong:${nonUs.hint}`);
    } else if (nonUs.strength === "weak") {
      hasWeakNonUS = true;
      score -= 3;
      reasons.add(`location_non_us_weak:${nonUs.hint}`);
    }
  }

  const normalizedCountry = normalizeText(String(job.locationCountry ?? ""));
  if (normalizedCountry) {
    if (normalizedCountry === "us" || normalizedCountry === "usa" || normalizedCountry === "united states" || normalizedCountry === "united states of america") {
      score += 8;
      hasStrongUS = true;
      reasons.add("structured_country_us");
    } else {
      score -= 8;
      hasStrongNonUS = true;
      firstNonUS ??= normalizedCountry;
      reasons.add(`structured_country_non_us:${normalizedCountry}`);
    }
  }

  const normalizedState = normalizeText(String(job.locationState ?? ""));
  const mappedState = normalizedState ? US_STATE_ALIAS_TO_CODE[normalizedState] ?? normalizedState.toUpperCase() : undefined;
  if (mappedState && US_STATE_CODES.has(mappedState)) {
    matchedUsState ??= mappedState;
    score += 5;
    hasStrongUS = true;
    reasons.add("structured_state_us");
  }

  const titleUsHint = detectUSTitleHint(title);
  const titleNonUsHint = detectNonUSTitleHint(title);
  const urlUsHint = detectUSUrlHint(url);
  const urlNonUsHint = detectNonUSUrlHint(url);

  if (titleUsHint) {
    score += 3;
    reasons.add("title_us_hint");
  }
  if (urlUsHint) {
    score += 3;
    reasons.add("url_us_hint");
  }
  if (titleNonUsHint.strength === "strong") {
    score -= 5;
    hasStrongNonUS = true;
    firstNonUS ??= titleNonUsHint.hint;
    reasons.add(`title_non_us_hint:${titleNonUsHint.hint}`);
  }
  if (urlNonUsHint.strength !== "none") {
    score -= urlNonUsHint.strength === "strong" ? 5 : 2;
    if (urlNonUsHint.strength === "strong") hasStrongNonUS = true;
    if (urlNonUsHint.strength === "weak") hasWeakNonUS = true;
    firstNonUS ??= urlNonUsHint.hint;
    reasons.add(`url_non_us_hint:${urlNonUsHint.hint}`);
  }

  if (job.isRemote && (titleUsHint || urlUsHint || hasStrongUS || matchedUsState)) {
    score += 2;
    reasons.add("remote_with_us_scope");
  }

  const hasUS = hasStrongUS || (hasWeakUS && !hasStrongNonUS);
  const hasNonUS = hasStrongNonUS || hasWeakNonUS;
  const isMixed = hasUS && hasNonUS;

  let decision: GeoDecision = "review";
  if (isMixed || score >= 5) {
    decision = "keep";
  } else if (hasStrongNonUS && score <= -5 && !hasStrongUS) {
    decision = "drop";
  } else if (!rawLocation && !titleUsHint && !urlUsHint && !mappedState && !normalizedCountry) {
    decision = "review";
  }

  const confidence: GeoConfidence =
    Math.abs(score) >= 8 ? "high" : Math.abs(score) >= 4 ? "medium" : "low";
  const detectedCountry =
    decision === "keep"
      ? isMixed ? "Mixed" : "United States"
      : firstNonUS || (decision === "review" ? "Unknown" : "Non-US");

  return {
    decision,
    confidence,
    score,
    reasons: [...reasons].sort((a, b) => a.localeCompare(b)),
    detectedCountry,
    isUSLikely: decision === "keep" ? true : decision === "drop" ? false : null,
    hasUS,
    hasNonUS,
    isMixed,
    matchedUsLocality,
    matchedUsState,
  };
}

export function annotateJobGeography(job: JobPosting): JobPosting {
  const assessment = assessJobGeography(job);
  return {
    ...job,
    detectedCountry: assessment.detectedCountry,
    isUSLikely: assessment.isUSLikely,
    matchedUsLocality: assessment.matchedUsLocality,
    matchedUsState: assessment.matchedUsState,
    geoDecision: assessment.decision,
    geoConfidence: assessment.confidence,
    geoScore: assessment.score,
    geoReasons: assessment.reasons,
  };
}

export function analyzeJobLocation(location: string): {
  isUSLikely: boolean | null;
  detectedCountry: string;
  hasUS: boolean;
  hasNonUS: boolean;
  isMixed: boolean;
} {
  const assessment = assessJobGeography({ location, title: "", url: "" });
  return {
    isUSLikely: assessment.isUSLikely,
    detectedCountry: assessment.detectedCountry,
    hasUS: assessment.hasUS,
    hasNonUS: assessment.hasNonUS,
    isMixed: assessment.isMixed,
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
 * Backward-compatible wrapper for call sites that only have free-text fields.
 * Confident non-U.S. rows are dropped; review rows are kept to avoid false
 * negatives for U.S. jobs with sparse ATS location metadata.
 */
export function shouldKeepJobForUSInventory(location: string, title = "", url = ""): boolean {
  return assessJobGeography({ location, title, url }).decision !== "drop";
}

export function shouldKeepJobPostingForUSInventory(job: JobPosting): boolean {
  return assessJobGeography(job).decision !== "drop";
}

/**
 * Add derived fields such as geography and matched keywords.
 */
export function enrichJob(job: JobPosting, rules: JobTitleConfig): JobPosting {
  const geography = annotateJobGeography(job);
  return {
    ...geography,
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
