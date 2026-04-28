import { countJobs, type RegistryEntry } from "../ats/registry";
import { registryTableName, putRow } from "../aws/dynamo";
import { canonicalBoardUrlForCompany } from "../config";
import { hyphenSlug, nowISO } from "../lib/utils";
import { loadRegistryCache } from "./registry-cache";
import type { CompanyInput } from "../types";

type PromotionResult = {
  promoted: boolean;
  entry?: RegistryEntry;
  reason?: string;
};

function companyRegistryKey(company: string): string {
  return `COMPANY#${hyphenSlug(company) || company.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown-company"}`;
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
    sample_url: company.sampleUrl ?? null,
    last_checked: nowISO(),
  };
}

/**
 * Promote validated custom companies into the shared registry so later users
 * can pick them from the catalog instead of manually re-entering sample URLs.
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
    const verifiedEntry: RegistryEntry = {
      ...entry,
      total_jobs: Number.isFinite(totalJobs) ? totalJobs : 0,
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
