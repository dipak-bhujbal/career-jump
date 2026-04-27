# ATS API Fixtures

Snapshot responses from each ATS provider. Used by `__tests__/ats-schema.test.ts`
to detect schema drift before it breaks production scrapers.

## Refreshing fixtures

Re-run from a known-good representative slug per ATS:

```bash
npm run ats:refresh-fixtures
```

(or invoke `scripts/refresh-ats-fixtures.ts` directly).

## What's tested

For each fixture we assert:

1. **Required top-level keys exist** (e.g., Greenhouse: `meta`, `jobs`).
2. **Job-shape keys exist on first item** (e.g., `id`, `title`, `absolute_url`).
3. **Total count is a number** when the API exposes one.

If any of those fail, the test breaks in CI — alerting us that the ATS API
shape has drifted before the scraper silently returns empty arrays.

## File naming

`{ats}-{slug}.json` — keep one canonical per ATS for stable diffs.
