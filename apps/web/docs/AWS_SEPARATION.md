# AWS Separation Plan — v3.0.0

This runbook captures Phases 1-3 for making `career-jump-web` independent from
the older `career-jump-aws` app. The goal is simple: after the React app goes
live on its own backend, deleting old app resources must not break React.

## Phase 1 — Isolated Backend Foundation

Create React-owned backend primitives with the `career-jump-web` name family:

- DynamoDB state table: `career-jump-web-poc-state`
- DynamoDB registry table: `career-jump-web-poc-registry`
- SNS notification topic: `career-jump-web-poc-notifications`
- Ownership tags: `App=career-jump-web`, `Stage=poc`

Implemented in `infra/backend-foundation.yaml` and wired into
`infra/full-stack.yaml`. Tables intentionally use lowercase `pk` and `sk` keys
because the existing AWS storage adapters and Cognito trigger already use that
convention.

## Phase 2 — Separate Config And Naming

React deployments must not reference old resources:

- Do not use `career-jump-aws-poc-state`.
- Do not use the old `career-jump-aws-poc` Cognito pool/client.
- Do not use the old Lambda function URL in production runtime config.
- Keep static frontend resources in the existing `cj-web-*` family.

The v3 full-stack template defaults `AppName` to `career-jump-web` and passes
the new table/topic outputs into Cognito and notification stacks.

## Phase 3 — Backend Tenant/Auth Wiring

Production frontend config now comes from `window.CAREER_JUMP_AWS` in
`public/aws-config.js`, with build-time `VITE_*` values as local/dev fallback:

```js
window.CAREER_JUMP_AWS = {
  apiBaseUrl: "https://<react-api>.lambda-url.us-east-1.on.aws",
  cognitoDomain: "career-jump-web-poc.auth.us-east-1.amazoncognito.com",
  cognitoClientId: "<react-client-id>",
  cognitoUserPoolId: "<react-user-pool-id>",
  redirectUri: window.location.origin,
};
```

Mock/dev mode is intentionally local-only:

- `VITE_USE_MOCKS=true` still enables local mock auth/API behavior.
- `http://localhost:5173/?demo=1` still enables local demo API data.
- CloudFront production ignores both mock triggers, and missing Cognito config
  no longer silently switches the app into dev/mock mode.

## Deploy Order

1. Verify SES sender identity in `us-east-1`.
2. Package/deploy `infra/full-stack.yaml` with `AppName=career-jump-web`.
3. Read outputs: `StateTableName`, `NotificationTopicArn`, `UserPoolId`,
   `UserPoolClientId`, `UserPoolDomain`, `FrontendCloudFrontUrl`.
4. Deploy or point the API backend at the new table and Cognito pool.
5. Publish `public/aws-config.js` with the isolated API and Cognito outputs.
6. Rebuild/sync frontend assets and invalidate CloudFront.

## Deletion Gate For The Older App

Do not delete `career-jump-aws-poc` until all of these are true:

- React login/signup uses the `career-jump-web-poc` Cognito pool.
- React API calls go to the isolated React API URL.
- New user/profile data lands in `career-jump-web-poc-state`.
- Notifications publish through `career-jump-web-poc-notifications`.
- CloudFront `aws-config.js` contains only `career-jump-web` outputs.
