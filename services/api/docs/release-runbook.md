# Release Runbook

This is the release process for Career Jump AWS. Follow these steps every time a release is cut, whether you are Claude, Codex, or the developer.

## Branch Model

| Branch | Purpose |
|--------|---------|
| `main` | Active development. Features and fixes merge here. |
| `release-X.Y` | Release stabilization branch. Cut from main when a version is ready to ship. |
| `feature/*` or `fix/*` | Short-lived branches for individual changes. |

Branch naming: use `release-2.2`, `release-2.3` etc. (dash not slash, for local compatibility).

## Version Naming

Versions follow `vMAJOR.MINOR.PATCH`:
- MAJOR: architectural or breaking changes
- MINOR: significant feature additions
- PATCH: bug fixes, UI adjustments, small improvements

Frontend version must be updated in three places per release:
- `public/index.html`: script tag query strings `?v=X.Y.Z` and footer label
- `public/app.js`: `CURRENT_APP_VERSION = "vX.Y.Z"`

## Pre-Release Checklist (Codex runs these, architect reviews)

```bash
npm run check          # TypeScript validation — must pass
sam validate --lint --region us-east-1   # SAM template lint — must pass
npm run aws:build      # SAM build — must pass
```

Review before tagging:
- [ ] Version bumped in `public/index.html` (script tags + footer)
- [ ] Version bumped in `public/app.js`
- [ ] `releases/vX.Y.Z.md` release notes written
- [ ] Architecture docs updated if infrastructure, auth, or scan flow changed
- [ ] `template.yaml` validated

## Release Steps

### Step 1 — Stabilize on the release branch

```bash
git checkout main
git pull origin main
git checkout -b release-X.Y   # only for new minor release
# or
git checkout release-X.Y      # for patch on existing release branch
```

### Step 2 — Make changes, bump version, write release notes

All version bumps and release note files go in this step.

### Step 3 — Validate

```bash
npm run check
sam validate --lint --region us-east-1
npm run aws:build
```

### Step 4 — Commit and tag

```bash
git add <files>
git commit -m "Release Career Jump AWS vX.Y.Z"
git tag vX.Y.Z
git push origin release-X.Y
git push origin vX.Y.Z
```

### Step 5 — Deploy (developer runs from terminal)

Codex does NOT run deploy commands. The developer runs these:

```bash
export AWS_DEFAULT_REGION=us-east-1
sam build
sam deploy --config-env poc --no-confirm-changeset
AWS_REGION=us-east-1 npm run aws:sync-frontend
```

The deploy takes 3–8 minutes. Watch for SAM changeset output and S3 sync confirmation.

### Step 6 — Post-deploy verification

- Open the CloudFront URL and sign in through Cognito
- Confirm the footer shows the new version number
- Check Dashboard loads correctly
- Check Available Jobs and Applied Jobs pages
- Check `/logs.html` shows compact run summaries
- Check `/docs` Swagger page loads
- If infrastructure changed: run a manual scan and verify it completes

## Emergency Rollback

To revert to the previous tag:

```bash
git checkout vX.Y.Z-previous
sam build
sam deploy --config-env poc --no-confirm-changeset
AWS_REGION=us-east-1 npm run aws:sync-frontend
```

Frontend rollback only (no infra change):
```bash
AWS_REGION=us-east-1 npm run aws:sync-frontend
```

## Role Boundaries

| Who | Does what |
|-----|-----------|
| Codex | Implements code changes, bumps version, writes release notes, runs `npm run check` and `sam validate` |
| Claude (Architect) | Reviews all changes before tagging, approves release |
| Developer (you) | Gives final approval, runs `sam deploy` and `aws:sync-frontend` from terminal |

## Documentation Update Rule

Update docs on every release that changes:
- AWS infrastructure or resources (`template.yaml`)
- Auth or security posture
- Scan flow or run state
- API contracts (`src/openapi.ts`)
- Release or deploy process
- Frontend behavior that affects operations

Minimum docs to check before every release:
- `README.md`
- `docs/architecture/README.md`
- `docs/architecture/infrastructure.md`
- `docs/architecture/runtime-state.md`
- `docs/release-runbook.md` (this file)
