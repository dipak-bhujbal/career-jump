# CQRS Cleanup Gate

This document defines the executable cleanup boundary for the CQRS migration.

Phase 6 does **not** delete legacy code by default. It introduces a concrete
gate that must pass before any future phase is allowed to remove fallback
reads, legacy rebuild logic, or migration-only scaffolding.

## Current Rule

Legacy deletion is deferred until all of the following are true:

1. `CQRS_REGISTRY_READ` is enabled at runtime.
2. The registry read model fully covers the current registry catalog.
3. `CQRS_JOBS_READ` is enabled at runtime.
4. The tenant jobs ready marker exists and matches the current runtime config
   version.
5. `CQRS_DASHBOARD_READ` is enabled at runtime.
6. The tenant dashboard summary row exists (row presence is the readiness gate —
   the builder writes it only after a complete build).

The executable check for conditions 1–4 is the
`materializer-cleanup-gate` Lambda. Condition 5–6 must be verified
manually until the gate Lambda is extended to assert them.

## Cleanup Gate Lambda

Invoke manually before any future deletion script or code-removal phase:

```bash
aws lambda invoke \
  --function-name <app>-<stage>-materializer-cleanup-gate \
  /tmp/materializer-cleanup-gate.json
```

The handler throws on any failed assertion, so the invocation exits non-zero
instead of quietly logging a warning.

Assertions (conditions 1–4):

- `CQRS_REGISTRY_READ === "1"`
- `queryRegistryStatusRows().length >= listAll().length`
- `CQRS_JOBS_READ === "1"`
- `queryCqrsJobsReadyRow(tenantId)` exists and its `configVersion` matches the
  current `loadRuntimeConfig(...).updatedAt` version

If any assertion fails, legacy path deletion remains blocked.

Conditions 5–6 (dashboard) are not yet asserted by the gate Lambda. Verify
manually before removing the dashboard legacy path:

- `CQRS_DASHBOARD_READ === "1"`
- `queryDashboardSummaryRow(tenantId)` returns a non-null row

## Surviving Legacy Paths

The following paths remain intentionally live after Phase 6.

| Legacy path | Why it must stay |
| --- | --- |
| `/api/dashboard` legacy path via `buildDashboardPayload`, `resolveDashboardInventory`, and the KV-backed dashboard cache | Still serves traffic whenever `CQRS_DASHBOARD_READ` is `"0"` or the `DashboardSummaryRow` does not yet exist for the tenant. |
| `/api/jobs/details` via `loadDerivedAvailableInventory` | Job details still read KV-backed inventory directly. No VISIBLEJOB read-model cutover covers this endpoint yet. |
| `/api/jobs` legacy list path via `streamAvailableJobsPage` | Still serves traffic whenever `CQRS_JOBS_READ` is `"0"` or the jobs readiness gate fails. |
| `/api/admin/registry-status` fallback block | Still serves traffic whenever `CQRS_REGISTRY_READ` is `"0"` or registry row coverage is incomplete. |
| `/api/admin/actions-needed` fallback block | Still serves traffic whenever `CQRS_REGISTRY_READ` is `"0"` or registry status coverage is incomplete. |
| `resolveEffectiveRegistrySnapshot`, `deriveRegistryLastScanStatus`, `categorizeRegistryFailure` in `routes.ts` | Private helpers for the admin fallback blocks above. They remain live until those fallback blocks are removed in a future phase. |
| KV-backed inventory mutation helpers used by `/api/jobs/manual-add`, `/api/jobs/apply`, `/api/jobs/discard`, `/api/jobs/status`, and `/api/jobs/remove-broken-links` | These workflows still mutate or inspect the legacy inventory/application state directly. Phase 5 only cut over the read path for `/api/jobs`. |

## Durable Observability That Stays

These signals are **not** migration scaffolding and must survive cleanup:

- `dual_build_validation_failed`
- `post_build_validation_error`

They are durable operational signals for read-model drift and validation
execution failures.

## Future Deletion Conditions

Deletion can only happen in a later phase, and only after the gate passes.

### Registry fallback deletion

Safe only when:

- `CQRS_REGISTRY_READ === "1"`
- cleanup gate passes
- the fallback blocks in `/api/admin/registry-status` and
  `/api/admin/actions-needed` are intentionally removed in the same change

After that, the private legacy helpers
`resolveEffectiveRegistrySnapshot`, `deriveRegistryLastScanStatus`, and
`categorizeRegistryFailure` become deletion candidates.

### Jobs list fallback deletion

Safe only when:

- `CQRS_JOBS_READ === "1"`
- cleanup gate passes
- the legacy `/api/jobs` fallback path is intentionally removed in the same
  change

At that point `streamAvailableJobsPage` becomes a deletion candidate only if no
other endpoint still depends on it.

### Dashboard fallback deletion

Safe only when:

- `CQRS_DASHBOARD_READ === "1"`
- `DashboardSummaryRow` exists for all active tenants (row presence proves build completed)
- the legacy `/api/dashboard` fallback path (`resolveDashboardInventory`,
  `buildDashboardPayload`, `loadCachedDashboardPayload`, `saveCachedDashboardPayload`)
  is intentionally removed in the same change

### jobs-details deletion

Not eligible in this phase.

- `/api/jobs/details` still depends on KV-backed inventory reads.

Any future deletion work for that path requires a separate cutover phase
first, then a new cleanup-gate evaluation.
