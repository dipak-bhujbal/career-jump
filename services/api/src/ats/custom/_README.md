# Custom ATS Adapters

When a company doesn't use a known multi-tenant ATS (Workday/Greenhouse/etc.) — they
host their own custom job board — drop a per-company adapter here.

## When to add a custom adapter

Add a custom adapter when:
- The company appears in `data/seed_registry.json` with `ats: "Custom"` (or null)
- You've manually verified their actual job listing URL (in their site source, not just the careers homepage)
- The site doesn't fit any existing core adapter

## When NOT to add one

- Use **`custom/jsonld.ts`** as a generic fallback first — it parses Schema.org `JobPosting`
  JSON-LD blocks, which Google requires for indexing in Google for Jobs and ~30% of
  custom career sites embed.
- Use **`custom/sitemap.ts`** if the company publishes `/sitemap-jobs.xml` or similar.

These two cover most "Custom" companies without per-company code.

## File template

```typescript
// custom/foocorp.ts
import type { JobPosting } from "../../types";
import { atsJson } from "../shared/http";
import { registerAdapter } from "../shared/types";

const COMPANY_KEY = "foocorp"; // matches normalized company name

async function count() {
  const r = await atsJson<{ items?: unknown[] }>("https://foocorp.example.com/api/jobs");
  return r?.items?.length ?? 0;
}

async function fetchJobs(_, companyName: string): Promise<JobPosting[]> {
  // ... fetch + map to JobPosting[]
  return [];
}

registerAdapter({
  id: `custom:${COMPANY_KEY}`, // PREFIX with "custom:"
  kind: "custom",
  validate: async () => true,
  count,
  fetchJobs,
});
```

Then add `import "./foocorp";` to `custom/index.ts`.

## Convention: keys

- `id` MUST be `custom:<normalized-company-key>` so the registry dispatcher can
  find it (`resolveAdapter` checks custom-keyed adapters first).
- The normalized key is `name.toLowerCase().replace(/[^a-z0-9]/g, "")`. So
  "Tesla, Inc." → `tesla`; "Berkshire Hathaway" → `berkshirehathaway`.

## Maintenance burden

Custom adapters break when companies redesign their career pages. Treat them as
high-maintenance compared to core adapters. Keep them small and well-commented;
reference the actual API/HTML structure inline so future-you can debug fast.
