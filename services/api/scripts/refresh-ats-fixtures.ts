#!/usr/bin/env tsx
/**
 * Refresh ATS API fixtures.
 * Pulls one live response per ATS adapter and writes to src/ats/__fixtures__/.
 *
 * Slugs chosen for stability (large, public, well-maintained boards):
 *   - greenhouse: stripe
 *   - lever: netflix
 *   - ashby: ramp
 *   - smartrecruiters: bosch
 *   - workday: nvidia (nvidia.wd5.myworkdayjobs.com / NVIDIAExternalCareerSite)
 *   - eightfold: vodafone
 *   - phenom: pwc
 *   - jobvite: cargill
 *   - icims: thermofisher
 *   - oracle: marriott (sample)
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIX_DIR = join(__dirname, "..", "src", "ats", "__fixtures__");

type Job = { url: string; init?: RequestInit; out: string };

const targets: Job[] = [
  { url: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=false", out: "greenhouse-stripe.json" },
  { url: "https://api.lever.co/v0/postings/palantir?mode=json", out: "lever-palantir.json" },
  { url: "https://api.ashbyhq.com/posting-api/job-board/ramp", out: "ashby-ramp.json" },
  { url: "https://api.smartrecruiters.com/v1/companies/uber/postings?limit=5", out: "smartrecruiters-uber.json" },
  {
    url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0 }) },
    out: "workday-nvidia.json",
  },
  { url: "https://vodafone.eightfold.ai/api/apply/v2/jobs?domain=vodafone.eightfold.ai&start=0&num=5", out: "eightfold-vodafone.json" },
  { url: "https://pwc.phenompeople.com/api/jobs?from=0&size=5", out: "phenom-pwc.json" },
  { url: "https://jobs.jobvite.com/cargill/api/jobs?per_page=5", out: "jobvite-cargill.json" },
];

async function main() {
  await mkdir(FIX_DIR, { recursive: true });
  const headers = { "User-Agent": "career-jump/1.0 (fixture-refresh)", Accept: "application/json" };
  for (const t of targets) {
    process.stdout.write(`fetching ${t.url} ... `);
    try {
      const r = await fetch(t.url, { headers, ...(t.init ?? {}) });
      if (!r.ok) {
        console.log(`HTTP ${r.status} — skipping`);
        continue;
      }
      const json = await r.json();
      await writeFile(join(FIX_DIR, t.out), JSON.stringify(json, null, 2));
      console.log(`✓ ${t.out}`);
    } catch (e) {
      console.log(`error: ${(e as Error).message}`);
    }
  }
}

main();
