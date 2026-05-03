import { countJobs, type RegistryEntry } from "../ats/registry";
import { getAdapter } from "../ats/shared/types";
import { normalizeAtsId } from "../ats/shared/normalize";
import { deleteRow, getRow, registryTableName, putRow } from "../aws/dynamo";
import { canonicalBoardUrlForCompany } from "../config";
import { hyphenSlug, nowISO } from "../lib/utils";
import { listAll, loadRegistryCache } from "./registry-cache";
import { syncRegistryCompanyScanPolicy } from "./registry-scan-state";
import type { CompanyInput } from "../types";
import type { RegistryScanPool } from "../types";

type PromotionResult = {
  promoted: boolean;
  entry?: RegistryEntry;
  reason?: string;
};

export type CompanyValidationResult = {
  company: CompanyInput;
  entry: RegistryEntry;
  totalJobs: number;
};

export function companyRegistryKey(company: string): string {
  return `COMPANY#${hyphenSlug(company) || company.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown-company"}`;
}

export type RegistryCompanyConfig = {
  rank: number | null;
  sheet: string;
  company: string;
  board_url: string | null;
  ats: string | null;
  total_jobs: number | null;
  source: string | null;
  tier: RegistryEntry["tier"];
  scan_pool?: RegistryScanPool | null;
  from?: string;
  adapterId?: string | null;
  boards?: Array<{ ats: string; url: string; total_jobs?: number }>;
  sample_url?: string | null;
  last_checked?: string | null;
} & Record<string, unknown>;

const VALID_REGISTRY_TIERS = new Set([
  "TIER1_VERIFIED",
  "TIER2_MEDIUM",
  "TIER3_LOW",
  "NEEDS_REVIEW",
]);
const VALID_SCAN_POOLS = new Set<RegistryScanPool>(["hot", "warm", "cold"]);

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function preferredRegistryTier(company: CompanyInput): RegistryEntry["tier"] {
  if (company.registryTier === "TIER1_VERIFIED" || company.registryTier === "TIER2_MEDIUM" || company.registryTier === "TIER3_LOW") {
    return company.registryTier;
  }
  // User-submitted companies that successfully validate are useful to others,
  // but still lower confidence than the curated tier-1 catalog.
  return "TIER3_LOW";
}

function toPromotableRegistryEntry(company: CompanyInput): RegistryEntry | null {
  if (!company.company.trim() || !company.source) return null;
  const boardUrl = canonicalBoardUrlForCompany(company)?.trim();
  if (!boardUrl) return null;
  return {
    rank: null,
    sheet: "User Added",
    company: company.company.trim(),
    board_url: boardUrl,
    ats: company.source,
    total_jobs: null,
    source: "user_verified",
    tier: preferredRegistryTier(company),
    // Custom promotions store the canonical board URL only. Scans should not
    // depend on a single sample posting once the board itself is known.
    sample_url: null,
    last_checked: nowISO(),
  };
}

/**
 * Promote custom companies into the shared registry only after a successful
 * scan so later users can pick a verified board URL from the catalog.
 */
export async function promoteCustomCompaniesToRegistry(companies: CompanyInput[]): Promise<PromotionResult[]> {
  const promotions: PromotionResult[] = [];

  for (const company of companies) {
    if (company.isRegistry === true) continue;
    const entry = toPromotableRegistryEntry(company);
    if (!entry?.ats || !entry.board_url) {
      promotions.push({ promoted: false, reason: `No canonical board URL for ${company.company}` });
      continue;
    }

    const totalJobs = await countJobs(entry);
    // Only promote a custom company into the shared registry after the board
    // proves it has a real, non-empty inventory. Zero-job scans should remain
    // tenant-local so we do not pollute the canonical registry with dead rows.
    if (!Number.isFinite(totalJobs) || totalJobs <= 0) {
      promotions.push({
        promoted: false,
        reason: `No non-zero job inventory found for ${company.company}`,
      });
      continue;
    }

    const verifiedEntry: RegistryEntry = {
      ...entry,
      total_jobs: totalJobs,
      last_checked: nowISO(),
    };

    await putRow(registryTableName(), {
      pk: "REGISTRY",
      sk: companyRegistryKey(verifiedEntry.company),
      ...verifiedEntry,
      updatedAt: nowISO(),
    });

    promotions.push({ promoted: true, entry: verifiedEntry });
  }

  if (promotions.some((result) => result.promoted)) {
    await loadRegistryCache({ force: true });
  }

  return promotions;
}

function normalizeRegistryCompanyConfig(input: Record<string, unknown>): RegistryCompanyConfig {
  assertRecord(input, "config");
  const company = typeof input.company === "string" ? input.company.trim() : "";
  if (!company) throw new Error("company is required");

  const tier = typeof input.tier === "string" ? input.tier.trim() : "";
  if (!VALID_REGISTRY_TIERS.has(tier)) {
    throw new Error("tier must be one of TIER1_VERIFIED, TIER2_MEDIUM, TIER3_LOW, NEEDS_REVIEW");
  }
  if (input.scan_pool !== undefined && input.scan_pool !== null && typeof input.scan_pool !== "string") {
    throw new Error("scan_pool must be a string or null when provided");
  }
  const scanPool = typeof input.scan_pool === "string" ? input.scan_pool.trim() : "";
  if (scanPool && !VALID_SCAN_POOLS.has(scanPool as RegistryScanPool)) {
    throw new Error("scan_pool must be one of hot, warm, cold when provided");
  }

  const coerceNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) throw new Error("numeric fields must be numbers or null");
    return parsed;
  };

  const coerceString = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") throw new Error("string fields must be strings or null");
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const next: Record<string, unknown> = { ...input };
  delete next.pk;
  delete next.sk;
  delete next.updatedAt;

  let boards: RegistryCompanyConfig["boards"] | undefined;
  if (input.boards !== undefined) {
    if (!Array.isArray(input.boards)) {
      throw new Error("boards must be an array when provided");
    }
    boards = input.boards.map((board, index) => {
      assertRecord(board, `boards[${index}]`);
      const ats = coerceString(board.ats);
      const url = coerceString(board.url);
      const totalJobs = coerceNumber(board.total_jobs);
      if (!ats) throw new Error(`boards[${index}].ats is required`);
      if (!url) throw new Error(`boards[${index}].url is required`);
      return {
        ats,
        url,
        total_jobs: totalJobs ?? undefined,
      };
    });
  }

  const normalizedAts = coerceString(input.ats);
  const canonicalAts = normalizedAts ? normalizeAtsId(normalizedAts) : null;
  if (normalizedAts && !canonicalAts) {
    throw new Error("ats must use a supported adapter id such as greenhouse, ashby, workday, lever, or oracle");
  }

  return {
    ...next,
    rank: coerceNumber(input.rank),
    sheet: typeof input.sheet === "string" && input.sheet.trim() ? input.sheet.trim() : "Registry",
    company,
    board_url: coerceString(input.board_url),
    ats: canonicalAts,
    total_jobs: coerceNumber(input.total_jobs),
    source: coerceString(input.source),
    tier: tier as RegistryEntry["tier"],
    scan_pool: scanPool ? (scanPool as RegistryScanPool) : null,
    from: coerceString(input.from) ?? undefined,
    adapterId: coerceString(input.adapterId),
    boards,
    sample_url: coerceString(input.sample_url),
    last_checked: coerceString(input.last_checked),
  };
}

/**
 * Validate a user-supplied ATS board URL against the selected adapter, then
 * immediately promote the canonical row into the shared registry once it
 * proves both shape and non-zero inventory.
 */
export async function validateAndPromoteCustomCompany(company: CompanyInput): Promise<CompanyValidationResult> {
  const entry = toPromotableRegistryEntry(company);
  if (!entry?.ats || !entry.board_url) {
    throw new Error("Company, ATS, and a canonical job board URL are required.");
  }

  const adapterId = normalizeAtsId(entry.ats);
  const adapter = adapterId ? getAdapter(adapterId) : null;
  if (!adapter) {
    throw new Error(`Unsupported ATS '${entry.ats}'.`);
  }

  const isValid = await adapter.validate({ boardUrl: entry.board_url });
  if (!isValid) {
    throw new Error(`The URL does not match the expected ${adapter.id} board format or could not be validated.`);
  }

  const totalJobs = await adapter.count({ boardUrl: entry.board_url });
  if (!Number.isFinite(totalJobs) || totalJobs <= 0) {
    throw new Error("Validation succeeded, but the board returned zero jobs so it was not added.");
  }

  const verifiedEntry: RegistryEntry = {
    ...entry,
    ats: adapter.id,
    total_jobs: totalJobs,
    last_checked: nowISO(),
  };

  await putRow(registryTableName(), {
    pk: "REGISTRY",
    sk: companyRegistryKey(verifiedEntry.company),
    ...verifiedEntry,
    updatedAt: nowISO(),
  });
  await loadRegistryCache({ force: true });

  return {
    company: {
      ...company,
      enabled: true,
      isRegistry: true,
      source: adapter.id as CompanyInput["source"],
      boardUrl: verifiedEntry.board_url ?? company.boardUrl,
      sampleUrl: verifiedEntry.board_url ?? company.sampleUrl,
      registryAts: adapter.id,
      registryTier: verifiedEntry.tier,
    },
    entry: verifiedEntry,
    totalJobs,
  };
}

/**
 * Admin registry editing needs a stable list view plus a full-row loader so
 * operators can inspect and change the canonical company config without
 * guessing which attributes are persisted in Dynamo today.
 */
export async function listRegistryCompanyConfigs(force = false): Promise<Array<RegistryCompanyConfig & { registryId: string }>> {
  // Admin edits need to reflect immediately even when the next read lands on a
  // different warm Lambda instance. Allow callers to force a fresh registry
  // reload instead of trusting a potentially stale in-memory cache.
  await loadRegistryCache({ force });
  return listAll().map((entry) => ({
    registryId: companyRegistryKey(entry.company),
    rank: entry.rank,
    sheet: entry.sheet,
    company: entry.company,
    board_url: entry.board_url,
    ats: entry.ats,
    total_jobs: entry.total_jobs,
    source: entry.source,
    tier: entry.tier,
    scan_pool: entry.scan_pool ?? null,
    from: entry.from,
    sample_url: entry.sample_url,
    last_checked: entry.last_checked,
  }));
}

export async function loadRegistryCompanyConfigByRegistryId(registryId: string, force = false): Promise<RegistryCompanyConfig | null> {
  if (!process.env.AWS_REGISTRY_TABLE && !process.env.REGISTRY_TABLE) {
    await loadRegistryCache({ force });
    const fallback = listAll().find((entry) => companyRegistryKey(entry.company) === registryId);
    return fallback ? normalizeRegistryCompanyConfig(fallback as unknown as Record<string, unknown>) : null;
  }
  const row = await getRow<Record<string, unknown>>(registryTableName(), { pk: "REGISTRY", sk: registryId });
  if (!row) return null;
  return normalizeRegistryCompanyConfig(row);
}

/**
 * Saving by registry id allows admins to rename companies while keeping a
 * deterministic lookup key for the row they opened in the editor.
 */
export async function saveRegistryCompanyConfig(
  registryId: string,
  input: Record<string, unknown>,
): Promise<{ config: RegistryCompanyConfig; previousCompany?: string | null }> {
  const next = normalizeRegistryCompanyConfig(input);
  const previous = await loadRegistryCompanyConfigByRegistryId(registryId);
  if (!previous) throw new Error("Registry company not found");

  const nextRegistryId = companyRegistryKey(next.company);
  const timestamp = nowISO();

  await putRow(registryTableName(), {
    pk: "REGISTRY",
    sk: nextRegistryId,
    ...next,
    updatedAt: timestamp,
  });

  if (nextRegistryId !== registryId) {
    await deleteRow(registryTableName(), { pk: "REGISTRY", sk: registryId });
  }

  // Refresh the scan-state policy right away so registry status and the
  // scheduler pick up ATS/cadence changes immediately after an admin save.
  await loadRegistryCache({ force: true });
  await syncRegistryCompanyScanPolicy(next.company, next.ats);

  return {
    config: next,
    previousCompany: previous.company,
  };
}

/**
 * Admin deletes must operate on the exact registry row they selected so a
 * typed company-name variant cannot accidentally target the wrong record.
 */
export async function deleteRegistryCompanyConfig(
  registryId: string,
): Promise<{ deletedCompany: string }> {
  const existing = await loadRegistryCompanyConfigByRegistryId(registryId);
  if (!existing) throw new Error("Registry company not found");

  await deleteRow(registryTableName(), { pk: "REGISTRY", sk: registryId });
  await loadRegistryCache({ force: true });

  return { deletedCompany: existing.company };
}
