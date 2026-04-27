# Release & Deploy Runbook

You (the human) handle git push, tagging, and AWS deploy yourself.
This document is the step-by-step you can follow without re-deriving
state each time.

## One-time setup (do once, today)

### 1. Create the GitHub repo

```bash
cd ~/career-jump-web
git add .
git commit -m "feat: initial scaffold — Vite + React + TanStack + Tailwind"

# On github.com, create a NEW empty repo named `career-jump-web`
# (private OR public — Actions is free for both on the free plan).

git remote add origin git@github.com:<your-username>/career-jump-web.git
git branch -M main
git push -u origin main
```

### 2. Tag your isolation conventions

Decide once and stick to it. For the new AWS resources:

| Resource | Naming | Tag |
|---|---|---|
| S3 bucket | `cj-web-static-poc-<account-id>` | `App=career-jump-web Stack=react-rebuild Env=poc` |
| CloudFront distribution | `cj-web-poc` | same tags |
| ACM certificate | `cj-web-poc-cert` | same tags |
| CloudFormation stack | `career-jump-web-poc` | (stack-level tags propagate) |

The vanilla app's resources stay untouched and continue serving
traffic at the existing URL.

## Per-release flow

### Local checks (always run before you push)

```bash
cd ~/career-jump-web

# 1. Type-check + production build
npm run build

# 2. Tests
npm test

# 3. Smoke test the production bundle locally
npm run preview        # opens at http://localhost:4173

# 4. (Optional) Manual exercise of the Configuration flow:
#    - Open the picker, search "Stripe" / "Walmart" / "Anthropic"
#    - Add a registry company
#    - Add a custom company
#    - Save, refresh, confirm persistence
#    - Toggle scan pause, confirm toast
```

### Cut a release

```bash
# Bump version in package.json, e.g. 0.1.0 -> 0.2.0
# (You can also use `npm version minor` to do this + commit + tag in one shot.)

git add package.json
git commit -m "chore: release v0.2.0 — <one-line summary>"
git tag v0.2.0
git push origin main --follow-tags
```

If you set up a GitHub Release page, copy the relevant section from
your CHANGELOG into the release body.

### Deploy to AWS (manual, until automation lands)

You do not have CI yet — these are the commands to run by hand.

#### First-time infra (run once)

The SAM template additions for the React frontend live in
`~/career-jump-aws/template.yaml` (the same SAM stack that already
manages your Lambda) but with isolated logical names. You will deploy
them under a *different stack name* so the existing prod stack is not
disturbed:

```bash
cd ~/career-jump-aws

# After the React infra is added to template.yaml:
sam build
sam deploy \
  --stack-name career-jump-web-poc \
  --capabilities CAPABILITY_IAM \
  --tags App=career-jump-web Stack=react-rebuild Env=poc \
  --parameter-overrides ReactSiteEnabled=true \
  --resolve-s3 \
  --no-confirm-changeset
```

CloudFormation outputs the new CloudFront distribution domain
(`d1234abcd.cloudfront.net`). Save it.

#### Subsequent deploys (every release)

```bash
cd ~/career-jump-web
npm run build                              # produces dist/

# Sync to S3 with cache-busting headers.
# - Long cache for hashed assets (JS/CSS): they're immutable.
# - Short cache for index.html: must always reflect latest deploy.
aws s3 sync dist/ s3://cj-web-static-poc-<account-id>/ \
  --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 cp dist/index.html s3://cj-web-static-poc-<account-id>/index.html \
  --cache-control "public, max-age=0, must-revalidate"

# Atomic flip: invalidate index.html only.
# Hashed asset URLs differ per build, so no need to invalidate them.
aws cloudfront create-invalidation \
  --distribution-id <DIST_ID> \
  --paths "/index.html"
```

If anything goes wrong, **rollback** is just re-deploying the previous
git tag:

```bash
git checkout v0.1.0
npm install
npm run build
# ...rerun the sync + invalidate steps above
git checkout main
```

### Cutover from vanilla to React (when you're ready)

1. Final QA against the CloudFront distribution URL.
2. (If you have a domain) update Route53 to point the apex / `app.`
   subdomain at the new CloudFront distribution.
3. Keep the vanilla app's Lambda-served `public/` deployed for a week
   as a fallback — the URLs differ, so both can coexist.
4. Once stable, you can stop bundling `public/` from the
   career-jump-aws Lambda (drop the static-asset routes in
   `src/routes.ts`). The Lambda becomes API-only.

## Action plan checklist (for today's milestone)

After local dev preview looks good:

- [ ] `cd ~/career-jump-web && git init` (already done)
- [ ] Create empty `career-jump-web` repo on GitHub
- [ ] `git remote add origin …` and `git push -u origin main`
- [ ] Tag the initial scaffold: `git tag v0.0.1` then `git push --tags`
- [ ] Open an issue in GitHub titled "Wire registry-driven scanning
      into the backend" so the open scope item is tracked
- [ ] Defer AWS infra deploy until after the Configuration page is
      polished (week 1 milestone is local-only).
