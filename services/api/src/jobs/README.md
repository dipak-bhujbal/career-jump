# Jobs Pipeline

Pipes-and-filters transformation pipeline for raw JobPosting[] coming out of
ATS adapters. **Adapters fetch; this layer transforms.**

## Layout

```
src/jobs/
├── pipeline.ts                pipe(jobs, ctx, ...stages) composer
├── types.ts                   Filter/Enricher/Reducer/StatefulStage + FilterContext
├── filters/                   Drop jobs that don't match
│   ├── byCountry.ts
│   ├── byLocation.ts          (remoteOnly, excludeRemote, byCity, byState)
│   ├── byKeywords.ts          generic (include + exclude title keywords)
│   ├── byJobTitle.ts          uses RuntimeConfig.jobtitles
│   ├── byPostedDate.ts
│   └── byDepartment.ts
├── enrichers/                 Add fields to jobs (don't drop)
│   ├── normalizeLocation.ts   parses location → {city, state, country, isRemote}
│   ├── extractSeniority.ts    title → "junior" | "senior" | "staff" | ...
│   ├── extractCompType.ts     title → "fulltime" | "contract" | "intern" | ...
│   ├── extractSalary.ts       description → {min, max, currency, period}
│   └── computeFingerprint.ts  hash(title+location+desc) → 16-hex (for dedupe)
├── reducers/                  N → fewer (or reorder)
│   ├── dedupeByFingerprint.ts
│   ├── dedupeByApplyUrl.ts
│   └── rankByRelevance.ts
└── index.ts                   Barrel: filters / enrichers / reducers
```

## Usage

```typescript
import { pipe, filters, enrichers, reducers } from "../jobs";
import { fetchJobsForEntry } from "../ats";

const raw = await fetchJobsForEntry(registryEntry);
if (!raw) return [];

const ctx = { config: runtimeConfig, now: new Date().toISOString() };

const out = await pipe(raw, ctx,
  enrichers.normalizeLocation,
  filters.byCountry(["US", "Canada"]),
  filters.byJobTitle,                        // uses ctx.config.jobtitles
  enrichers.extractSeniority,
  enrichers.extractCompType,
  enrichers.extractSalary,
  enrichers.computeFingerprint,              // adds `fingerprint`
  reducers.dedupeByFingerprint,              // uses `fingerprint`
  reducers.rankByRelevance,
);
```

## Stage contract

Every stage is a single function:

```typescript
type Stage = (jobs: JobPosting[], ctx: FilterContext) => JobPosting[] | Promise<JobPosting[]>;
```

Rules:
1. **Pure**: don't mutate the input array — return a new one.
2. **Stateless** between invocations (use `FilterContext` for dynamic state).
3. **Async-safe**: return value or Promise; the runner awaits.

## When to use StatefulStage

For per-run setup/teardown:
- DB-backed dedup (table connection)
- LLM enrichment (client warmup, prompt cache)
- Cross-batch state

```typescript
import { runStateful } from "../jobs";

const out = await runStateful(jobs, ctx, {
  init: async (ctx) => { /* connect, prefetch */ },
  process: (jobs, ctx) => { /* ... */ },
  finalize: async (ctx) => { /* close, flush */ },
});
```

## Multitenancy (Phase 2 prep)

`FilterContext.tenantId` and `FilterContext.user` are plumbed through every
stage. Stages can read them today but most don't yet. Phase 2 will add a
per-tenant `pipelineOverrides` mechanism (see `TenantSettings` in `types.ts`).

## Adding a new stage

1. Drop a new file in `filters/` / `enrichers/` / `reducers/`.
2. Export a `Filter` / `Enricher` / `Reducer` (just a function or a builder).
3. Re-export from `index.ts` under `filters` / `enrichers` / `reducers` namespace.
4. No central registration needed — the barrel takes care of it.
