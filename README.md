# Career Jump

Career Jump is a clean monorepo for the React web app and AWS serverless backend.

## Layout

- `apps/web` contains the React/Vite frontend.
- `services/api` contains the AWS Lambda API, scan orchestration, ATS integrations, tests, and SAM template.
- `backups/registry` contains the preserved DynamoDB registry backup.
- `scripts` contains repo-level operational scripts.

## Local Validation

Run the full validation gate from the repo root:

```bash
npm run validate
```

Run individual lanes when iterating:

```bash
npm run build:web
npm run lint:web
npm run check:api
npm run test:api
```

## AWS Deployment

AWS deployment is intentionally paused until the target AWS account/profile is confirmed.

```bash
npm run aws:build
```

After the fresh stack creates `career-jump-prod-registry`, restore the preserved registry backup:

```bash
npm run registry:restore -- --table career-jump-prod-registry --dry-run
npm run registry:restore -- --table career-jump-prod-registry
```

Do not delete legacy AWS resources until the fresh consolidated stack is deployed, verified, and explicitly approved for cutover cleanup.
