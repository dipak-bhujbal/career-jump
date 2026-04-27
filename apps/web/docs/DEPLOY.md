# Release & Deployment Guide

> **Who deploys:** Dipak handles all git pushes, tagging, and AWS deploys manually. No automated CI yet.

---

## Current State

| App | Hosting | Status |
|-----|---------|--------|
| Vanilla JS app | S3 + CloudFront (`career-jump-aws-poc` stack) | Live |
| React app (`career-jump-web`) | S3 + CloudFront (`career-jump-web-poc` stack) | Live |
| React isolated backend foundation | DynamoDB + SNS + Cognito + notifications (`career-jump-web-*`) | v3.0.0 templates ready |

Current React frontend resources:
- Bucket: `cj-web-static-poc-561303652551`
- Distribution ID: `E2J6YDTMOQ1AQB`
- URL: `https://d3azoqpjm8hivh.cloudfront.net/`

v3.0.0 moves the React app toward full AWS separation. New backend resources
must use the `career-jump-web` name family, not `career-jump-aws-poc`.

---

## Local Pre-Deploy Checklist

Run before every push:

```bash
cd ~/career-jump-web

# 1. Type-check + production build
npm run build

# 2. Smoke test production bundle
npm run preview      # http://localhost:4173/
```

Manual checks to run in the preview:
- Open signup and login pages with real env vars and confirm no console errors.
- Confirm the dashboard loads after authentication.
- Verify the browser is not blocked by CSP on Cognito or Lambda requests.

---

## Versioning

```bash
# Bump package.json version when cutting a release
npm version patch   # or minor / major

# Creates a git commit + tag automatically
git push origin main --follow-tags
```

---

## AWS Deploy — Frontend Stack Updates

Use this flow whenever `infra/frontend-site.yaml` changes. CloudFront response
headers policy updates, CSP fixes, and other stack-level changes do not go live
from an S3 sync alone.

```bash
cd ~/career-jump-web

AWS_PROFILE=career-jump-personal-deployer aws cloudformation deploy \
  --stack-name career-jump-web-poc \
  --template-file infra/frontend-site.yaml \
  --parameter-overrides AppName=cj-web Stage=poc \
  --tags App=career-jump-web Stack=react-rebuild Env=poc
```

---

## AWS Deploy — Frontend Assets

Use real backend and Cognito values for production. Do not deploy with
`VITE_USE_MOCKS=true`; that flag is only for local demo/testing.

```bash
cd ~/career-jump-web

VITE_AWS_REGION=us-east-1 \
VITE_COGNITO_USER_POOL_ID=<user-pool-id> \
VITE_COGNITO_APP_CLIENT_ID=<app-client-id> \
VITE_COGNITO_DOMAIN=<cognito-domain-hostname> \
VITE_API_BASE_URL=<lambda-function-url> \
VITE_USE_MOCKS=false \
npm run build

AWS_PROFILE=career-jump-personal-deployer aws s3 sync dist/ s3://cj-web-static-poc-561303652551/ \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html" \
  --exclude "aws-config.js"

AWS_PROFILE=career-jump-personal-deployer aws s3 cp dist/index.html s3://cj-web-static-poc-561303652551/index.html \
  --cache-control "public,max-age=0,must-revalidate"

AWS_PROFILE=career-jump-personal-deployer aws cloudfront create-invalidation \
  --distribution-id E2J6YDTMOQ1AQB \
  --paths "/index.html"
```

The deployed `public/aws-config.js` file is the preferred production config
surface. Do **not** upload the local placeholder `dist/aws-config.js` during
normal frontend syncs. If runtime config changes are required, upload the
production config separately with no-cache headers and invalidate
`/aws-config.js`. It should contain the isolated React API URL, registry API
URL, and Cognito outputs:

```js
window.CAREER_JUMP_AWS = {
  apiBaseUrl: "https://<react-api>.lambda-url.us-east-1.on.aws",
  registryBaseUrl: "https://<registry-api>.lambda-url.us-east-1.on.aws",
  cognitoDomain: "<career-jump-web-poc>.auth.us-east-1.amazoncognito.com",
  cognitoClientId: "<react-user-pool-client-id>",
  cognitoUserPoolId: "<react-user-pool-id>",
  redirectUri: window.location.origin,
};
```

Local demo mode is still available with `VITE_USE_MOCKS=true` or
`http://localhost:5173/?demo=1`. CloudFront production ignores both mock
triggers, so dev mode cannot be enabled there by URL or by an accidental
mock-enabled production build.

---

## CSP Troubleshooting

If Cognito signup or login fails in the browser with a generic network error,
check the DevTools Console before changing app code.

Example signal:
- `Refused to connect to https://cognito-idp.us-east-1.amazonaws.com/`

That means the frontend stack needs a CloudFront policy deploy, not just a fresh
asset sync.

---

## GitHub Actions (Planned)

A future `deploy.yml` workflow can automate the stack deploy, asset sync, and
CloudFront invalidation on push to `main`. Until then, the manual commands above
are the deploy path.
