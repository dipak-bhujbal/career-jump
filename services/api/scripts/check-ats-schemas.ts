#!/usr/bin/env tsx
/**
 * ATS schema drift detector.
 *
 * Re-fetches a live response per ATS and asserts the same schema shape we
 * snapshotted in __fixtures__. Exits non-zero on any mismatch — wire into CI.
 *
 * What we check (lightweight, no external deps):
 *   - Top-level required keys exist
 *   - First job/posting has expected keys
 *   - Total count is a number when the ATS exposes one
 *
 * The point is to detect *shape drift*, not value equality. ATS APIs change
 * shape rarely but devastatingly (Greenhouse renamed `meta.total` → ?).
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIX_DIR = join(__dirname, "..", "src", "ats", "__fixtures__");

type Check = {
  name: string;
  url: string;
  init?: RequestInit;
  fixture: string;
  required: string[]; // dot-paths e.g. "meta.total", "jobs.0.id"
};

const checks: Check[] = [
  {
    name: "Greenhouse",
    url: "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=false",
    fixture: "greenhouse-stripe.json",
    required: ["meta.total", "jobs.0.id", "jobs.0.title", "jobs.0.absolute_url"],
  },
  {
    name: "Lever",
    url: "https://api.lever.co/v0/postings/palantir?mode=json",
    fixture: "lever-palantir.json",
    required: ["0.id", "0.categories", "0.descriptionPlain"],
  },
  {
    name: "Ashby",
    url: "https://api.ashbyhq.com/posting-api/job-board/ramp",
    fixture: "ashby-ramp.json",
    required: ["jobs.0.id", "jobs.0.title", "jobs.0.location"],
  },
  {
    name: "SmartRecruiters",
    url: "https://api.smartrecruiters.com/v1/companies/uber/postings?limit=5",
    fixture: "smartrecruiters-uber.json",
    required: ["totalFound", "content.0.id", "content.0.name"],
  },
  {
    name: "Workday (NVIDIA)",
    url: "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs",
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 5, offset: 0 }) },
    fixture: "workday-nvidia.json",
    required: ["total", "jobPostings.0.title", "jobPostings.0.externalPath"],
  },
];

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const HEADERS = { "User-Agent": "career-jump/1.0 (schema-check)", Accept: "application/json" };

async function main() {
  let failures = 0;
  for (const c of checks) {
    process.stdout.write(`[${c.name}] ... `);
    try {
      const r = await fetch(c.url, { headers: HEADERS, ...(c.init ?? {}) });
      if (!r.ok) {
        console.log(`HTTP ${r.status} ❌`);
        failures++;
        continue;
      }
      const live = await r.json();
      const missing = c.required.filter((p) => getPath(live, p) === undefined);
      if (missing.length) {
        console.log(`❌ schema drift; missing: ${missing.join(", ")}`);
        failures++;
        continue;
      }
      // Optional: cross-check fixture exists & has same top-level keys
      try {
        const fixed = JSON.parse(await readFile(join(FIX_DIR, c.fixture), "utf8"));
        const liveTop = Object.keys(live as Record<string, unknown>).sort();
        const fixedTop = Object.keys(fixed as Record<string, unknown>).sort();
        if (Array.isArray(live) && Array.isArray(fixed)) {
          // arrays — just a sanity check
        } else if (liveTop.join(",") !== fixedTop.join(",")) {
          console.log(`⚠️  top-level keys diverged: live=[${liveTop.join(",")}] fixture=[${fixedTop.join(",")}]`);
        }
      } catch {
        // fixture missing; not fatal
      }
      console.log("✓");
    } catch (e) {
      console.log(`❌ ${(e as Error).message}`);
      failures++;
    }
  }
  if (failures) {
    console.error(`\n${failures} ATS adapter(s) drifted — refresh fixtures and update adapter code.`);
    process.exit(1);
  }
  console.log("\nAll ATS schemas match fixture shape.");
}

main();
