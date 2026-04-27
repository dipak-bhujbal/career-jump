# ATS Module

Adapters for fetching raw jobs from Applicant Tracking Systems.

## Layout

```
src/ats/
├── core/                      Multi-tenant ATSes (one adapter, N companies)
│   ├── workday.ts             ─┐
│   ├── greenhouse.ts           │
│   ├── lever.ts                │
│   ├── ashby.ts                │ Existing — pre-refactor
│   ├── smartrecruiters.ts      │
│   ├── eightfold.ts            │
│   ├── phenom.ts               │
│   ├── jobvite.ts              │
│   ├── icims.ts                │
│   ├── oracle.ts              ─┘
│   ├── workable.ts            ─┐
│   ├── breezy.ts               │
│   ├── recruitee.ts            │ New in arch refactor
│   ├── bamboohr.ts             │
│   ├── successfactors.ts       │
│   ├── taleo.ts               ─┘
│   └── __fixtures__/          Schema snapshots (snapshot tests)
│
├── custom/                    Per-company bespoke adapters
│   ├── jsonld.ts              Universal Schema.org JobPosting fallback
│   ├── sitemap.ts             sitemap-jobs.xml fallback
│   ├── tesla.ts               Tesla custom job board
│   ├── apple.ts               Apple jobs API
│   ├── berkshire.ts           Holding company stub
│   ├── index.ts               Side-effect imports (registers all)
│   └── _README.md             How to add a new custom adapter
│
├── shared/                    Cross-cutting plumbing
│   ├── types.ts               AtsAdapter interface + adapter registry
│   ├── http.ts                Shared fetch (UA, timeout, retry)
│   ├── slug.ts                Slug normalization helpers
│   ├── normalize.ts           ATS label → adapter id
│   └── init-core.ts           Wraps existing fetchX functions in AtsAdapter
│
├── registry.ts                Seed registry consumer + dispatcher
└── index.ts                   Back-compat barrel (existing imports keep working)
```

## How it fits together

1. **Seed registry** (`data/seed_registry.json`) is published by the `ats-discovery-agent`
   project. Each entry has `{ company, ats, board_url, total_jobs, tier, ... }`.
2. **Adapters self-register** when imported (via `registerAdapter` in `shared/types.ts`).
   `init-core.ts` wraps existing core adapters; `custom/index.ts` registers customs.
3. **Dispatcher** (`registry.ts → resolveAdapter`) looks up the right adapter:
   - Custom-by-company first (`custom:tesla` for "Tesla, Inc.")
   - Falls back to generic ATS by `ats` label (`workday`, `greenhouse`, ...)
   - "Custom" label routes to `custom-jsonld` fallback
4. **Adapters fetch raw JobPosting[]** — no filtering, no enrichment, no dedup.
   Those concerns live in `src/jobs/` (the pipes-and-filters pipeline).

## Adding a new core adapter

1. Create `src/ats/core/<name>.ts` exporting `validate<Name>Slug`, `count<Name>Jobs`,
   `fetch<Name>Jobs(slug, companyName)`.
2. Add wrapper to `shared/init-core.ts` adapter array.
3. Add an entry to `shared/normalize.ts` if the registry uses an alternate label.
4. Add a fixture in `__fixtures__/` and an entry in `scripts/check-ats-schemas.ts`.
5. Run `npm run check` and `npm run ats:check-schemas`.

## Adding a custom (per-company) adapter

See `custom/_README.md`.

## Schema drift

The 5 most-used core ATSes have schema fixtures. Run `npm run ats:check-schemas`
in CI to detect when an ATS API changes shape before it silently breaks scrapers.
Refresh fixtures with `npm run ats:refresh-fixtures`.

## Multitenancy (Phase 2 prep)

`AdapterConfig.tenantId` is plumbed through the dispatcher but unused at runtime
today. When phase 2 lands, per-tenant overrides plug in here without changes
to adapter code. See `src/storage/tenant-keys.ts` for the DDB key conventions.
