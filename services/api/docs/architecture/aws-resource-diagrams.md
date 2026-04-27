# AWS Resource Diagrams

## Infrastructure Overview

Full system with all AWS services, external integrations, and data flows.

![Infrastructure Overview](./diagrams/infrastructure-overview.svg)

---

## Parallel Scan Pipeline

Lambda fanout architecture: one orchestrator invokes one scanner per enabled company in parallel, then a single finalizer merges results.

![Scan Fanout](./diagrams/scan-fanout.svg)

---

## Job Lifecycle

State transitions from raw ATS fetch through to Applied, Interview, or end-of-life removal.

![Job Lifecycle](./diagrams/job-lifecycle.svg)

---

## Resource Map

### Frontend & CDN

| AWS Service | Stack Resource | Key Configuration |
| --- | --- | --- |
| Amazon CloudFront | `FrontendDistribution` | OAC to private S3. HSTS 63072000s. CSP. `X-Frame-Options: DENY`. Response headers policy. |
| Amazon S3 | `FrontendBucket` | All public access blocked. CloudFront OAC principal only in bucket policy. |
| — | `FrontendOAC` | `sigv4` signing, `always` mode. |
| — | `FrontendResponseHeadersPolicy` | HSTS + CSP + `XContentTypeOptions` + `FrameOptions` + `XSSProtection`. |

### Authentication

| AWS Service | Stack Resource | Key Configuration |
| --- | --- | --- |
| Amazon Cognito | `UserPool` | Email-only. Admin-created accounts. No self-registration. |
| — | `UserPoolClient` | PKCE. `code` grant. Callback: `FrontendCloudFrontUrl/`. |
| — | `UserPoolDomain` | Hosted UI at `careerjump-poc-{AccountId}.auth.us-east-1.amazoncognito.com`. |

### Compute

| AWS Service | Stack Resource | Key Configuration |
| --- | --- | --- |
| AWS Lambda | `ApiFunction` | Node 22. ARM64. Function URL `AuthType: NONE`. Concurrency: 20. `CORS_ALLOWED_ORIGIN` = CloudFront domain. |
| AWS Lambda | `RunOrchestratorFunction` | Node 22. ARM64. Timeout: 300s. Async invoked by API and EventBridge. |
| AWS Lambda | `ScanCompanyFunction` | Node 22. ARM64. Timeout: 180s. Memory: 256 MB. One invoke per company per run. |
| AWS Lambda | `FinalizeRunFunction` | Node 22. ARM64. Merges company fragments, saves inventory, sends notification, releases lock. |

### State

| AWS Service | Stack Resource | Key Configuration |
| --- | --- | --- |
| Amazon DynamoDB | `StateTable` | On-demand billing. PK: `pk` (String). TTL attribute: `ttl`. App logs TTL: 6h. |

### Scheduling & Observability

| AWS Service | Stack Resource | Key Configuration |
| --- | --- | --- |
| Amazon EventBridge Scheduler | `WeekdayEtScan` | `cron(0 6,9,12,15,18,21 ? * MON-FRI *)`. Timezone: `America/New_York`. State: `ENABLED`. |
| Amazon CloudWatch Logs | 4 log groups | Retention: 1 day. One group per Lambda. |
| Amazon CloudWatch | 4 metric filters | `ERROR` pattern per Lambda log group. |
| Amazon CloudWatch | 4 alarms | Threshold: 1 error per 5 min. Alarm action: SNS. |
| Amazon SNS | `LambdaErrorTopic` | Email subscription to owner address on any Lambda error. |
| AWS Budgets | `MonthlyBudget` | Monthly cost guardrail. Email alert on threshold breach. |
