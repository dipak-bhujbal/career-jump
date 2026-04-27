import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTierLabel(tier: string | null | undefined): string {
  switch (tier) {
    case "TIER1_VERIFIED": return "Tier 1";
    case "TIER2_MEDIUM": return "Tier 2";
    case "TIER3_LOW": return "Tier 3";
    case "NEEDS_REVIEW": return "Needs review";
    default: return tier ?? "—";
  }
}

export function formatAtsLabel(ats: string | null | undefined): string {
  const raw = String(ats ?? "").trim();
  if (!raw) return "Auto";
  if (raw.toLowerCase() === "smartrecruiters") return "SmartRecruiters";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function companyKey(name: string): string {
  return String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
