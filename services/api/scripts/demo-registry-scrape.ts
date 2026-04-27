#!/usr/bin/env tsx
/**
 * End-to-end demo of the registry → adapter → pipeline path.
 *
 * Run:  npx tsx scripts/demo-registry-scrape.ts [companyName]
 *
 * Picks a company from the registry (default: Stripe), routes it through the
 * AtsAdapter dispatcher, runs the default jobs/ pipeline, prints summary +
 * first 3 jobs.
 *
 * No AWS / Lambda — pure local exercise of the new code path.
 */
import { loadRegistryCache, getByCompany } from "../src/storage/registry-cache";
import { scrapeOne } from "../src/services/registry-scraper";
import { registeredAdapterIds } from "../src/ats/registry";
import type { RuntimeConfig } from "../src/types";

async function main() {
  const company = process.argv[2] ?? "Stripe";

  // Stub RuntimeConfig — the demo doesn't need full config.
  const config: RuntimeConfig = {
    companies: [],
    jobtitles: { includeKeywords: ["engineer", "manager"], excludeKeywords: [] },
    updatedAt: new Date().toISOString(),
  };

  console.log(`\n[demo] loading registry cache...`);
  const cache = await loadRegistryCache();
  console.log(`  loaded ${cache.all.length} companies, version=${cache.meta.version}`);
  console.log(`  registered adapters: ${registeredAdapterIds().join(", ")}`);

  console.log(`\n[demo] resolving "${company}"...`);
  const entry = getByCompany(company);
  if (!entry) {
    console.error(`  ✗ no entry for ${company}`);
    console.log(`  hint: try one of the first 5 companies in the registry:`);
    for (const c of cache.all.slice(0, 5)) console.log(`    - ${c.company} (${c.ats})`);
    process.exit(1);
  }
  console.log(`  ✓ found  ats=${entry.ats}  url=${entry.board_url}  tier=${entry.tier}`);

  console.log(`\n[demo] scraping (with default pipeline)...`);
  const t0 = Date.now();
  const result = await scrapeOne(company, config);
  const dt = Date.now() - t0;

  if (!result) { console.error(`  ✗ no result`); process.exit(1); }
  console.log(`  status: ${result.status}`);
  if (result.error) console.log(`  error:  ${result.error}`);
  console.log(`  jobs:   ${result.jobs.length}  (in ${dt}ms; adapter took ${result.ms}ms)`);

  if (result.jobs.length) {
    console.log(`\n[demo] first 3 jobs (after enrichers + dedupe):`);
    for (const j of result.jobs.slice(0, 3)) {
      const enriched = j as typeof j & {
        seniority?: string;
        employmentType?: string;
        salary?: { min?: number; max?: number; currency?: string };
        fingerprint?: string;
        locationCountry?: string;
      };
      console.log(`  - ${j.title}`);
      console.log(`    company: ${j.company}`);
      console.log(`    location: ${j.location} (${enriched.locationCountry ?? "?"})`);
      console.log(`    seniority: ${enriched.seniority ?? "?"}  type: ${enriched.employmentType ?? "?"}`);
      if (enriched.salary) console.log(`    salary: ${enriched.salary.min}-${enriched.salary.max} ${enriched.salary.currency}`);
      console.log(`    fingerprint: ${enriched.fingerprint ?? "?"}`);
      console.log(`    url: ${j.url}`);
    }
  }

  console.log(`\n[demo] done.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
