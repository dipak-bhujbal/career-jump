# Career Jump AWS

Career Jump AWS is the GitHub-hosted AWS serverless runtime for the Career Jump job-monitoring app. It scans configured companies across supported ATS providers, filters roles against saved keyword rules, tracks available and applied jobs, and runs under a low-cost AWS serverless architecture.

## Current Runtime

- Frontend: Amazon CloudFront + Amazon S3.
- Auth: Amazon Cognito hosted UI with PKCE.
- API: AWS Lambda Function URL, with Cognito ID-token validation in application code.
- State: Amazon DynamoDB through a KV-compatible adapter.
- Scans: one orchestrator Lambda invokes one scan-company Lambda per enabled company.
- Finalization: one Lambda merges company results, saves inventory, sends notifications when configured, and releases the active run lock.
- Storage lifecycle: fetched jobs are persisted only when they are currently available; applied jobs are preserved in applied-job state.
- Logs: application logs in DynamoDB with a six-hour TTL; `/logs.html` shows one compact troubleshooting row per company per run.
- Infrastructure: AWS SAM / CloudFormation.
- Version control: GitHub. Production deploy: manual `sam deploy` from developer terminal.

## Supported ATS Providers

- Workday
- Greenhouse
- Ashby
- Lever
- SmartRecruiters

## Product Surfaces

- `/` main dashboard and job workflow.
- `/logs.html` compact operational logs.
- `/docs` Swagger/OpenAPI docs.
- `GET /api/logs?compact=false` raw troubleshooting logs.

## Local Commands

```bash
npm run check
npm run aws:build
```

Command intent:

- `npm run check`: TypeScript validation.
- `npm run aws:build`: SAM build.

For full deploy steps see [docs/release-runbook.md](./docs/release-runbook.md).

## Release Flow

See [docs/release-runbook.md](./docs/release-runbook.md) for the full release process.

Branch model:
- `main`: active development
- `release-X.Y`: release stabilization
- `feature/*` or `fix/*`: short-lived branches

Production deploy is manual — the developer runs `sam deploy` from their terminal after Codex and Claude have validated the release. There is no CI/CD pipeline.

## Documentation Rule

Update docs for every release that changes:

- infrastructure or AWS resources
- release process
- API contracts
- scan flow or run state
- operational logs
- auth or security posture
- frontend behavior that changes operations

Primary docs:

- [AWS POC](./docs/aws-poc.md)
- [AWS From Scratch Deployment](./docs/aws-from-scratch.md)
- [Architecture](./docs/architecture/README.md)
- [Release Runbook](./docs/release-runbook.md)
- [Release Notes](./releases/)

## Cost Guardrails

The POC intentionally avoids:

- API Gateway
- NAT Gateway
- RDS
- EC2
- ALB
- Fargate
- OpenSearch
- Step Functions

CloudWatch log retention is one day. Application logs live in DynamoDB with short retention and compact operator views.

## Storage Guardrails

- Available inventory stores only currently matched, currently available jobs.
- Jobs that fail title, geography, or current-source checks are counted by discard reason but are not stored as job records.
- Applying a job moves it out of Available Jobs and preserves it in Applied Jobs.
- Changing an applied job to `Interview` adds interview-round state, which makes it appear in Action Plan while keeping the applied record.
- Broken links and jobs missing from a new scan are removed from available inventory.
- App logs and scan decision summaries expire after six hours through DynamoDB TTL.
- Repeated trend points with unchanged counts are recycled instead of appended indefinitely.
