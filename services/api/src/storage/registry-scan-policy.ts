import { inferAtsIdFromUrl, normalizeAtsId } from "../ats/shared/normalize";
import type { RegistryEntry } from "../ats/registry";
import type { RegistryScanPool, RegistryScanPriority } from "../types";

type RegistryScanPolicy = {
  scanPool: RegistryScanPool;
  priority: RegistryScanPriority;
};

function normalizeCompanyKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function companySet(values: string[]): Set<string> {
  return new Set(values.map(normalizeCompanyKey));
}

/**
 * Hand-curated scan tiers anchored to the user's personal target list.
 * These overrides win over generic rank/tier heuristics so the registry
 * scheduler keeps revisiting strategic companies at the intended cadence.
 */
const HOT_COMPANIES = companySet([
  "Datadog",
  "Cloudflare",
  "Snowflake",
  "Snowflake Computing",
  "Databricks",
  "Databricks Inc",
  "Wiz",
  "Palo Alto Networks",
  "Zscaler",
  "Rubrik",
  "Vanta",
  "OneTrust",
  "One Trust",
  "AuditBoard",
  "AuditBoard / Optro",
  "Optro",
  "Veeva",
  "Oracle Health",
  "Oracle Cerner",
  "Cerner",
  "Athenahealth",
  "Tempus",
  "Tempus AI",
  "Hims & Hers",
  "Hims & Hers Health",
  "Hims Hers",
  "Stripe",
  "Ramp",
  "Adyen",
  "Wise",
  "Toast",
  "Chime",
  "Amazon",
  "Amazon.com",
  "Amazon Web Services",
  "AWS",
  "AWS Security",
  "AWS Healthcare",
  "Microsoft",
  "Microsoft Azure",
  "Microsoft Security",
  "Google",
  "Google Cloud",
  "Google Cloud Platform",
  "ServiceNow",
  "Workday",
  "MongoDB",
  "Atlassian",
  "Confluent",
  "Rippling",
  "Deel",
  "Gusto",
  "Notion",
  "Vercel",
  "Retool",
  "OpenAI",
  "Anthropic",
  "Scale AI",
  "xAI",
  "Glean",
  "Perplexity",
]);

const WARM_COMPANIES = companySet([
  "CrowdStrike",
  "CrowdStrike Holdings",
  "Okta",
  "Snyk",
  "1Password",
  "1 Password",
  "SentinelOne",
  "Splunk",
  "Tanium",
  "HashiCorp",
  "Drata",
  "Secureframe",
  "Secure Frame",
  "LogicGate",
  "Epic",
  "Doximity",
  "Komodo Health",
  "Flatiron Health",
  "Ro",
  "Included Health",
  "Lyra Health",
  "Spring Health",
  "Plaid",
  "Block",
  "Brex",
  "Mercury",
  "Modern Treasury",
  "ModernTreasury",
  "Affirm",
  "Klarna",
  "Bill.com",
  "Bill",
  "Billcom",
  "Apple",
  "Apple Health",
  "Box",
  "DocuSign",
  "PagerDuty",
  "Elastic",
  "Twilio",
  "Smartsheet",
  "Airtable",
  "Webflow",
  "Carta",
  "Remote",
  "Lattice",
  "Greenhouse",
  "Hugging Face",
  "Cohere",
  "Mistral",
]);

const COLD_COMPANIES = companySet([
  "Lacework",
  "Sumo Logic",
  "SumoLogic",
  "Hyperproof",
  "Olive AI",
  "Headspace Health",
  "Marqeta",
  "Meta",
  "Meta Platforms",
  "Zendesk",
  "New Relic",
  "Asana",
  "Linear",
  "Loom",
]);

function poolFromCuratedList(entry: RegistryEntry): RegistryScanPool | null {
  const key = normalizeCompanyKey(entry.company);
  if (HOT_COMPANIES.has(key)) return "hot";
  if (WARM_COMPANIES.has(key)) return "warm";
  if (COLD_COMPANIES.has(key)) return "cold";
  return null;
}

/**
 * Generic fallback when a company is not on the hand-curated target list.
 * Rank is the strongest broad proxy we have for importance; registry tier is
 * the safety net for rows that were promoted but never ranked.
 */
function poolFromRegistryMetadata(entry: RegistryEntry): RegistryScanPool {
  const rank = entry.rank ?? Number.POSITIVE_INFINITY;
  if (rank <= 150 || entry.tier === "TIER1_VERIFIED") return "hot";
  if (rank <= 600 || entry.tier === "TIER2_MEDIUM") return "warm";
  return "cold";
}

function priorityForPool(scanPool: RegistryScanPool): RegistryScanPriority {
  if (scanPool === "hot") return "high";
  if (scanPool === "warm") return "normal";
  return "low";
}

export function registryAdapterIdForEntry(entry: RegistryEntry): string | null {
  return normalizeAtsId(entry.ats) ?? normalizeAtsId(inferAtsIdFromUrl(entry.board_url || entry.sample_url || undefined)) ?? null;
}

export function deriveRegistryScanPolicy(entry: RegistryEntry): RegistryScanPolicy {
  const scanPool = poolFromCuratedList(entry) ?? poolFromRegistryMetadata(entry);
  return {
    scanPool,
    priority: priorityForPool(scanPool),
  };
}
