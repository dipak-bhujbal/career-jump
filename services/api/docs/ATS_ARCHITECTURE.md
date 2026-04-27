# ATS + Jobs Pipeline Architecture

This doc covers the post-refactor architecture for fetching jobs from
applicant tracking systems and transforming them downstream.

## TL;DR

```
seed_registry.json (data/)
        │
        ▼
storage/registry-cache.ts ──── loads once per Lambda init
        │
        ▼
ats/registry.ts ─── dispatcher
        │
        ├─► ats/core/<provider>.ts        Multi-tenant ATSes (Workday, GH, Lever, …)
        ├─► ats/custom/<company>.ts       Per-company bespoke (Tesla, Apple, …)
        └─► ats/custom/jsonld.ts          Generic Schema.org JobPosting fallback
                │
                ▼
jobs/pipeline.ts ──── pipe(jobs, ctx, ...stages)
                │
                ├─► jobs/filters/        Drop jobs that don't match
                ├─► jobs/enrichers/      Add structured fields
                └─► jobs/reducers/       Dedupe / rank / collapse
                        │
                        ▼
                JobPosting[] (final)
```

## Module map

| Path | Purpose |
|---|---|
| `data/seed_registry.json` | Source-of-truth registry (1230 companies). Synced from `ats-discovery-agent`. |
| `src/ats/core/<x>.ts` | Multi-tenant ATS adapter. One file per provider. |
| `src/ats/custom/<x>.ts` | Per-company bespoke adapter (Tesla, Apple) or generic fallback (jsonld, sitemap). |
| `src/ats/shared/types.ts` | `AtsAdapter` interface + adapter registry. |
| `src/ats/shared/http.ts` | Shared fetch (UA, timeout, retry+backoff). |
| `src/ats/shared/init-core.ts` | Wraps existing core adapters into the interface and self-registers. |
| `src/ats/shared/normalize.ts` | Normalize ATS labels from registry → adapter ids. |
| `src/ats/shared/slug.ts` | URL/slug parsing helpers. |
| `src/ats/registry.ts` | Dispatcher: `resolveAdapter` / `countJobs` / `fetchJobsForEntry`. |
| `src/ats/index.ts` | Back-compat barrel — existing `import { fetchAshbyJobs } from "../ats/ashby"` keeps working. |
| `src/storage/registry-cache.ts` | Lambda-resident cache: `loadRegistryCache()` + lookups. |
| `src/storage/tenant-keys.ts` | Phase-2 DDB key conventions (already used today; just inert without DB). |
| `src/services/registry-scraper.ts` | `scrapeOne` / `scrapeMany` / `scrapeByAts` / `scrapeAllTier1`. |
| `src/jobs/pipeline.ts` | `pipe(jobs, ctx, ...stages)` + stateful variant. |
| `src/jobs/filters/` | byCountry, byKeywords, byJobTitle, byLocation, byPostedDate, byDepartment |
| `src/jobs/enrichers/` | normalizeLocation, extractSeniority, extractCompType, extractSalary, computeFingerprint |
| `src/jobs/reducers/` | dedupeByFingerprint, dedupeByApplyUrl, rankByRelevance |
| `src/jobs/index.ts` | Barrel: `{ filters, enrichers, reducers, pipe }` |

## HTTP routes (new, additive)

```
GET  /api/registry/meta                            cache stats + adapter list
GET  /api/registry/companies?ats=&tier=&limit=     list registry entries
GET  /api/registry/companies/:name                 single entry
POST /api/registry/scrape    {company,applyPipeline?}    scrape one
POST /api/registry/scrape/ats {ats,limit?}               scrape every entry of an ATS
```

These coexist with the legacy `/api/run` flow. No existing routes were changed.

## Adapters

### Adding a new core adapter

1. `src/ats/core/<name>.ts` exporting `validate<Name>Slug`, `count<Name>Jobs`,
   `fetch<Name>Jobs(slug, companyName)`.
2. Wire into `shared/init-core.ts` adapter array.
3. Add label alias in `shared/normalize.ts` if registry uses an alternate name.
4. Add fixture in `__fixtures__/` and entry in `scripts/check-ats-schemas.ts`.
5. `npm run check && npm test && npm run ats:check-schemas`.

### Adding a custom (per-company) adapter

See `src/ats/custom/_README.md`. TLDR:
- New file `src/ats/custom/<co>.ts`
- `id: "custom:<normalized-key>"` (registry uses `name.toLowerCase().replace(/[^a-z0-9]/g, "")`)
- Add `import "./<co>";` to `src/ats/custom/index.ts`
- Custom-by-company wins over generic ATS in the dispatcher.

## Jobs pipeline

```typescript
import { pipe, filters, enrichers, reducers } from "../jobs";

const out = await pipe(rawJobs, ctx,
  enrichers.normalizeLocation,
  filters.byCountry(["US", "Canada"]),
  filters.byJobTitle,                    // uses ctx.config.jobtitles
  enrichers.extractSeniority,
  enrichers.extractCompType,
  enrichers.extractSalary,
  enrichers.computeFingerprint,
  reducers.dedupeByApplyUrl,
  reducers.dedupeByFingerprint,
  reducers.rankByRelevance,
);
```

Stage rules:
- **Pure**: don't mutate input; return new array.
- **Stateless** between invocations.
- **Async-safe**: return value or Promise.

See `src/jobs/README.md` for `StatefulStage` (DB-backed dedup, LLM enrichment).

## Multitenancy (Phase 2 prep)

Today: single-tenant. Tenant fields plumbed through but inert.

What's already in place:
- `RuntimeConfig.tenantId?: string`
- `TenantSettings` type (per-tenant overrides)
- `AdapterConfig.tenantId` passed to every adapter
- `FilterContext.tenantId` passed to every pipeline stage
- `src/storage/tenant-keys.ts` defines DDB key shape (`tenant#<id>#registry/...`)
- `loadForTenant(tenantId)` in registry-cache filters by tenant

What's NOT in place (deliberate, Phase 2):
- DDB-backed registry storage (file-only today)
- Tenant resolution from request (e.g., subdomain or header)
- Per-tenant config writeback
- Pipeline stage overrides per tenant

## Storage path (file → DDB migration)

Today: `data/seed_registry.json` is read on Lambda cold start.

Migration path:
1. Run `ats-discovery-agent` to publish updated registry → `data/seed_registry.json`.
2. Run `npm run publish:ddb -- --table career-jump-aws-poc-state --tenant default` to upload to DDB.
3. Swap `registry-cache.ts` to read from DDB instead of file (one-file change).
4. Add per-tenant cache eviction (TTL or pub/sub).

## Migrating the legacy inventory flow

The legacy `services/inventory.ts` (1126 lines) orchestrates: fetch → filter →
fingerprint → discard registry → email digest. It hasn't been touched in this
refactor — production traffic still flows through it.

To migrate incrementally:

1. Replace one filter at a time — `isInterestingTitle` → `filters.byJobTitle`,
   `shouldKeepJobForUSInventory` → `filters.usOnly`, `jobStableFingerprint` →
   `enrichers.computeFingerprint`.
2. After each replacement, run the existing tests + a manual `/api/run` to
   confirm the same job count comes through.
3. Once all filters are replaced, the inventory orchestrator becomes a thin
   wrapper around `pipe(...)` and the new path can subsume the legacy one.

The new path (`/api/registry/scrape`) demonstrates the full pipeline already
working end-to-end (see `npm run ats:demo Ramp` — 128 jobs through full pipe).

## Verification

```bash
npm run check               # tsc 0 errors
npm test                    # 32 unit tests
npm run ats:check-schemas   # 5 ATS schema fixtures
npm run ats:demo Ramp       # end-to-end demo (Ramp/Ashby — 128 jobs)
```

## Schema drift

Run `npm run ats:check-schemas` in CI. It re-fetches each ATS with a known-good
slug and asserts the response shape matches the saved fixture. If drift:
1. `npm run ats:refresh-fixtures` to capture the new shape.
2. Update the adapter for the change.
3. Re-run schema check.
