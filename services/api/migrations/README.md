# D1 Migrations

This directory holds the Worker's D1 schema migrations.

Environment layout:

- local/default database: local Wrangler D1 state
- production database: `career-jump-prod`

Typical commands:

```bash
# Apply to the local/default D1 database
npx wrangler d1 migrations apply DB

# Apply to production
npx wrangler d1 migrations apply DB --env prod
```

Recommended rollout order:

1. Apply migrations locally first.
2. Build and test D1-backed reads/writes locally.
3. Apply the same migrations to prod only after local validation looks healthy.
