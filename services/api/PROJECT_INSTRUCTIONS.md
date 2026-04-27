# Career Jump — Project Instructions for LLM Agents

> This file provides full context for LLMs (including agentchattr and similar multi-agent frameworks)
> working inside the `career-jump-aws` repository. Read this before touching any code.

---
## LLM Operating Rules

When working in this repository:

- Work only in `career-jump-aws`
- Do not reference or modify the sibling `career-jump` Cloudflare repo
- Prefer the smallest safe change that solves the problem
- Do not propose rewrites unless explicitly requested
- Do not increase AWS monthly cost without strong justification
- Preserve current external behavior unless the task explicitly requires behavior change
- Call out impacted files before suggesting code edits
- Favor incremental refactors over architectural redesign
- If a change affects deployment, auth, storage, or scan orchestration, explicitly state the risk

---

## 1. What This Product Is

**Career Jump** is a personal job-monitoring application that:

- Scans configured companies across multiple ATS (Applicant Tracking System) providers
- Normalizes job postings into a common schema
- Filters jobs by title, geography, and custom keyword rules
- Tracks available jobs, applied jobs, and interview pipeline state
- Sends email notifications when new or updated jobs are found
- Exposes a browser UI for managing the entire job workflow

The app is built and operated by a single user (Dipak Bhujbal) as a personal productivity tool.

---

## 2. The Two Deployments — Critical Distinction

There are **two separate repositories** for this product. They share the same product logic but run on completely different infrastructure.

### 2a. `career-jump` — Cloudflare Production (DO NOT TOUCH)

| Property | Value |
|----------|-------|
| Repository | `career-jump` (sibling directory, not this repo) |
| Platform | Cloudflare Workers + KV + D1 |
| Auth | Cloudflare Access / Zero Trust |
| Storage | Cloudflare KV (runtime) + D1 (archived checkpoint) |
| CI/CD | GitHub Actions |
| Status | **Live MVP — stable production** |

**This deployment is the shipped product.** It works, it is actively used, and it must not be modified as part of AWS work. It is referenced here only so you understand the relationship between the two repos.

### 2b. `career-jump-aws` — AWS POC (THIS REPO)

| Property | Value |
|----------|-------|
| Repository | `career-jump-aws` (this repo) |
| Platform | AWS Serverless (Lambda + DynamoDB + S3 + CloudFront + Cognito) |
| Auth | Amazon Cognito hosted UI with PKCE + Cognito ID-token validation in Lambda |
| Storage | Amazon DynamoDB (single table, KV-compatible adapter) |
| CI/CD | GitHub (manual `sam deploy` from terminal) |
| Status | **Active production — primary runtime** |
| Current version | `v2.2.18` |
| Target monthly cost | Under $5 USD |

**This is the active working codebase.** All development, bug fixes, and feature additions happen here.

---

## 3. AWS Architecture — Full Detail

### 3a. Infrastructure Stack

Defined in `template.yaml` using AWS SAM (Serverless Application Model), deployed via CloudFormation to `us-east-1`, stack name `career-jump-aws-poc`.

#### Services in Use

| AWS Service | Resource Name | Purpose |
|-------------|--------------|---------|
| Amazon CloudFront | `FrontendDistribution` | HTTPS entrypoint for the browser; redirects HTTP → HTTPS |
| Amazon S3 | `FrontendBucket` | Hosts static frontend assets (HTML, JS, CSS, docs, generated `aws-config.js`) |
| Amazon Cognito User Pool | `UserPool` | Admin-created-only user pool; single allowed user |
| Amazon Cognito User Pool Client | `UserPoolClient` | OAuth2 PKCE flow for browser login |
| Amazon Cognito User Pool Domain | `UserPoolDomain` | Hosted login UI at `careerjump-poc-<accountId>.auth.us-east-1.amazoncognito.com` |
| AWS Lambda (API) | `career-jump-aws-poc-api` | HTTP API handler; validates Cognito ID tokens in code |
| AWS Lambda (Orchestrator) | `career-jump-aws-poc-run-orchestrator` | Triggered by `/api/run` or EventBridge; fans out per-company scan invocations |
| AWS Lambda (Scanner) | `career-jump-aws-poc-scan-company` | One invocation per company; fetches from ATS, filters, writes fragments |
| AWS Lambda (Finalizer) | `career-jump-aws-poc-finalize-run` | Merges company results, updates inventory, sends notifications, releases run lock |
| AWS Lambda Function URL | `ApiFunctionUrl` | Direct HTTPS endpoint for the API Lambda; no API Gateway cost |
| Amazon DynamoDB | `career-jump-aws-poc-state` | Single-table design; all runtime state: config, inventory, logs, run metadata |
| Amazon EventBridge Scheduler | Weekday schedules | Weekday scans every 3 hours, 6am–9pm ET (ENABLED) |
| Amazon CloudWatch Logs | Four log groups | One per Lambda, 1-day retention, JSON format |
| AWS Budgets | Monthly budget | Alerts at 60% and 100% of $5/month limit |

#### Services Intentionally Excluded (Cost Guardrails)

API Gateway, Step Functions, NAT Gateway, RDS, ALB, EC2, Fargate, OpenSearch, ElastiCache.

### 3b. Lambda Function Details

| Function | Handler | Timeout | Memory | Concurrency | Role |
|----------|---------|---------|--------|-------------|------|
| API | `src/aws/api.ts` | 30s | 512 MB | 20 reserved | HTTP handler; authenticates every request |
| Run Orchestrator | `src/aws/orchestrator.ts` | 60s | 256 MB | 1 reserved | Fans out scans; one Lambda per company |
| Scan Company | `src/aws/scan-company.ts` | 180s | 256 MB | 40 reserved | Fetches ATS data; timeout sized for Workday |
| Finalize Run | `src/aws/finalize-run.ts` | 300s | 512 MB | 1 reserved | Merges results; sends notifications; releases lock |

All Lambdas run Node.js 22.x on arm64, built with esbuild (CJS output, es2022 target, minified).

### 3c. Run Flow

```
Browser
  → POST /api/run
    → API Lambda
      → invokes Run Orchestrator (async)
        → reads enabled companies from DynamoDB
        → invokes Scan Company Lambda (one per company, concurrent)
          → fetches raw jobs from ATS
          → filters by title/geography/keywords
          → writes company fragment to DynamoDB
          → if last company: invokes Finalize Run Lambda
            → merges all fragments
            → writes current inventory to DynamoDB
            → sends email notification (if configured)
            → releases run lock
```

### 3d. Authentication Flow

```
Browser
  → redirects to Cognito Hosted UI (PKCE)
    → user logs in with email + password
      → Cognito issues ID token
        → browser stores token in localStorage
          → every API request sends Authorization: Bearer <id-token>
            → API Lambda validates token with aws-jwt-verify
              → checks email == ALLOWED_USER_EMAIL env var
```

There is no API Gateway JWT authorizer — validation is done in application code in the API Lambda.

### 3e. DynamoDB Table Design

Single table `career-jump-aws-poc-state` with composite key `pk` (string) + `sk` (string). All state types share this table:

- Runtime config: `pk=config#<userId>`, `sk=config`
- Available job inventory: `pk=inventory#<userId>`, `sk=job#<jobId>`
- Applied jobs: `pk=applied#<userId>`, `sk=job#<jobId>`
- App logs: `pk=log#<runId>`, `sk=<timestamp>#<companyId>` (6-hour TTL)
- Run metadata and lock: `pk=run#<userId>`, `sk=state`
- Company scan fragments: `pk=fragment#<runId>`, `sk=company#<companyId>` (ephemeral)
- Saved filters: `pk=filter#<userId>`, `sk=filter#<filterId>`

The storage adapter in `src/aws/kv.ts` provides a KV-compatible interface over DynamoDB, matching the Cloudflare KV API used in the original production codebase.

### 3f. Frontend

Static files in `public/` are synced to S3 and served through CloudFront. The deployment script generates `aws-config.js` containing the Cognito user pool ID, client ID, and API Function URL — injected at deploy time, not hardcoded.

Key frontend files:
- `public/index.html` — main app shell
- `public/app.js` — all client-side logic (dashboard, jobs, filters, config, logs UI)
- `public/styles.css` — shared styles
- `public/logs.html` — operational logs view
- `public/swagger.html` — OpenAPI docs

---

## 4. Source Code Layout

```
career-jump-aws/
├── src/
│   ├── aws/                    # AWS-specific runtime adapters
│   │   ├── api.ts              # Lambda Function URL HTTP handler + router
│   │   ├── auth.ts             # Cognito ID token validation (aws-jwt-verify)
│   │   ├── env.ts              # Typed Lambda environment variable access
│   │   ├── finalize-run.ts     # Finalize run Lambda handler
│   │   ├── kv.ts               # DynamoDB KV-compatible adapter
│   │   ├── orchestrator.ts     # Run orchestrator Lambda handler
│   │   ├── run-state.ts        # Run lock, heartbeat, and state helpers
│   │   └── scan-company.ts     # Per-company scan Lambda handler
│   ├── ats/                    # ATS provider clients (shared with Cloudflare version)
│   │   ├── greenhouse.ts
│   │   ├── ashby.ts
│   │   ├── lever.ts
│   │   ├── smartrecruiters.ts
│   │   └── workday.ts
│   ├── services/               # Business logic (shared with Cloudflare version)
│   │   ├── inventory.ts        # Job inventory management
│   │   ├── dashboard.ts        # Dashboard KPIs and metrics
│   │   ├── discovery.ts        # ATS provider auto-detection
│   │   ├── email.ts            # Notification via Google Apps Script webhook
│   │   └── broken-links.ts     # Stale job cleanup
│   ├── lib/                    # Shared helpers and utilities
│   ├── config.ts               # Runtime config load/save
│   ├── constants.ts            # App-wide constants
│   ├── index.ts                # Entrypoint (shared/compat shim)
│   ├── openapi.ts              # OpenAPI document builder
│   ├── routes.ts               # HTTP route definitions
│   ├── storage.ts              # Storage abstraction layer
│   └── types.ts                # Shared TypeScript types
├── public/                     # Static frontend assets
├── apps-script/                # Google Apps Script email adapter
├── scripts/                    # Deployment helper scripts
│   ├── import-cloudflare-runtime-to-aws.mjs   # Migrate KV state from Cloudflare
│   ├── sync-frontend.sh        # S3 frontend sync + CloudFront invalidation
│   └── unpark-aws.sh           # Restore parked AWS resources
├── docs/
│   ├── aws-poc.md              # AWS POC architecture reference
│   ├── aws-from-scratch.md     # Full from-scratch deployment guide
│   ├── release-runbook.md      # Release and deploy process for agents and developers
│   ├── source-change-to-production-runbook.md
│   └── architecture/           # Architecture diagrams
├── releases/                   # Per-release changelog files (v*.md)
├── template.yaml               # AWS SAM / CloudFormation template
├── samconfig.toml              # SAM deployment config (poc env)
├── package.json                # Dependencies and npm scripts
├── tsconfig.json               # TypeScript config
└── wrangler.jsonc              # Present for type-sharing with Cloudflare; not deployed
```

---

## 5. Supported ATS Providers

| Provider | Module | Notes |
|----------|--------|-------|
| Workday | `src/ats/workday.ts` | Slowest; scan Lambda timeout sized at 8 min for this |
| Greenhouse | `src/ats/greenhouse.ts` | |
| Ashby | `src/ats/ashby.ts` | |
| Lever | `src/ats/lever.ts` | |
| SmartRecruiters | `src/ats/smartrecruiters.ts` | |

---

## 6. API Surfaces

### Product Routes (handled by API Lambda)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (no auth required) |
| GET | `/api/dashboard` | Dashboard KPIs and summary metrics |
| POST | `/api/run` | Trigger a new scan run |
| GET | `/api/config` | Get runtime configuration |
| POST | `/api/config/save` | Save configuration changes |
| POST | `/api/config/apply` | Apply configuration and re-scan |
| GET | `/api/jobs` | List available jobs |
| GET | `/api/applied-jobs` | List applied jobs |
| POST | `/api/jobs/apply` | Apply to a job |
| POST | `/api/jobs/status` | Update job status |
| GET | `/api/logs` | Operational logs (add `?compact=false` for full detail) |
| GET | `/api/filters` | List saved keyword filters |
| POST | `/api/filters` | Create a filter |
| DELETE | `/api/filters/:id` | Delete a filter |
| GET | `/api/openapi.json` | OpenAPI spec |

### Static Pages

| Path | Description |
|------|-------------|
| `/` | Main dashboard and job workflow |
| `/logs.html` | Compact operational logs (one row per company per run) |
| `/docs` | Swagger/OpenAPI documentation |

---

## 7. CI/CD and Release Process

### Version Control

- Source control: **GitHub** (`git@github.com:dipak-bhujbal/career-jump-aws.git`)
- Primary branch: `main`
- Release branches: `release-<major>.<minor>` (e.g. `release-2.2`)

### Release Flow

See [docs/release-runbook.md](./docs/release-runbook.md) for the full process. Short form:

1. Cut or update a release branch from `main`
2. Run: `npm run check` and `sam validate --lint --region us-east-1`
3. Bump version in `public/index.html` (script tags + footer) and `public/app.js`
4. Commit, tag, push: `git tag vX.Y.Z && git push origin release-X.Y && git push origin vX.Y.Z`
5. Developer runs from terminal: `sam build && sam deploy --config-env poc --no-confirm-changeset && npm run aws:sync-frontend`

There is no CI/CD pipeline — all deploys are manual from the developer terminal.

### Local Commands

```bash
npm run check                  # TypeScript validation (tsc --noEmit)
npm run aws:build              # SAM build
npm run aws:deploy             # SAM deploy (use for releases from terminal)
npm run aws:sync-frontend      # Sync public/ to S3 + invalidate CloudFront
npm run aws:import-cloudflare-runtime  # One-time: migrate KV state from Cloudflare to DynamoDB
npm run aws:unpark             # Restore parked (suspended) AWS resources
```

---

## 8. Storage and Data Lifecycle Rules

These are business rules that constrain how jobs are stored. Do not change these without understanding the implications.

- **Only filtered jobs are persisted.** Jobs that fail title, geography, or keyword checks are counted by discard reason but never written as job records.
- **Available inventory is current-only.** It reflects what is available today on the ATS. Jobs removed from the ATS are removed from inventory.
- **Applying a job moves it.** Applying moves a job from available inventory to applied-job state, preserving lifecycle notes.
- **Interview state is additive.** Changing an applied job to `Interview` keeps the applied record and adds interview-round state, making it appear in Action Plan.
- **App logs expire after 6 hours** via DynamoDB TTL. They are operational diagnostics, not audit records.
- **Paused-company inventory is retained** until that company is active and scanned again.
- **Repeated trend points with unchanged counts are recycled,** not appended indefinitely.

---

## 9. Security Defaults

- Cognito user pool is **admin-created only** — no self-registration.
- Only `dipak.bhujbal23@gmail.com` is allowed by default (controlled via `ALLOWED_USER_EMAIL` env var).
- Lambda Function URL uses `AuthType: NONE` — but all non-health API requests must include a valid Cognito ID token validated in application code.
- App secrets (`APPS_SCRIPT_WEBHOOK_URL`, `APPS_SCRIPT_SHARED_SECRET`) are SAM parameters / Lambda environment variables — never committed to source.
- CloudFront enforces HTTPS. S3 bucket is fully private (CloudFront OAC-only access) — direct S3 URL access is blocked. CloudFront adds HSTS, X-Frame-Options, and CSP security headers.
- Monthly budget alert is set at $5 with notifications at 60% and 100%.

---

## 10. Relationship Between AWS and Cloudflare Codebases

The two repos share the same product logic with different infrastructure adapters:

| Layer | Cloudflare (`career-jump`) | AWS (`career-jump-aws`) |
|-------|---------------------------|------------------------|
| ATS fetchers | `src/ats/` | `src/ats/` (same logic) |
| Business logic | `src/services/` | `src/services/` (same logic) |
| Storage adapter | Cloudflare KV/D1 bindings | `src/aws/kv.ts` (DynamoDB KV adapter) |
| HTTP handler | Cloudflare Worker `fetch` handler | Lambda Function URL handler (`src/aws/api.ts`) |
| Auth | Cloudflare Access | Amazon Cognito PKCE + ID token validation |
| Scheduled scans | Cloudflare Worker cron | EventBridge Scheduler → Orchestrator Lambda |
| Parallel scanning | Single Worker execution | Fan-out: one Lambda invocation per company |
| Infrastructure | `wrangler.jsonc` | `template.yaml` (SAM/CloudFormation) |
| CI/CD | GitHub Actions | GitHub + manual `sam deploy` from terminal |

A migration script (`scripts/import-cloudflare-runtime-to-aws.mjs`) handles one-time state migration from Cloudflare KV to DynamoDB when needed.

---

## 11. Key Design Decisions (for LLM Context)

1. **No API Gateway.** Lambda Function URLs are used directly to eliminate API Gateway cost and latency for a single-user app.
2. **Fan-out via Lambda invocations, not Step Functions.** The orchestrator invokes one scan Lambda per company using the AWS SDK. This avoids Step Functions cost while still achieving parallel company scanning.
3. **DynamoDB over RDS.** PAY_PER_REQUEST billing with no idle compute cost. The KV-compatible adapter keeps the business logic portable.
4. **CloudFront over direct S3.** Cognito requires HTTPS redirect URLs; S3 website endpoints are HTTP-only. CloudFront provides HTTPS with negligible cost for single-user traffic.
5. **App logs in DynamoDB, not CloudWatch.** Short TTL in DynamoDB is cheaper than CloudWatch for high-volume scan logs. CloudWatch is only for Lambda errors (1-day retention).
6. **esbuild CJS output.** Lambda requires CommonJS; esbuild produces a compact, fast-loading bundle per function.
7. **arm64 architecture.** Lower cost than x86_64 on Lambda for the same memory allocation.

---

## 12. Current Version and State

- **Current release:** `v2.2.18` (released 2026-04-23)
- **Release branch:** `release-2.2`
- **What v2.2.18 includes:** Applied Jobs "Posted at" column, auto-layout column widths, S3 OAC (private bucket), CloudFront security response headers (HSTS/CSP/X-Frame-Options), documentation updated to GitHub and manual deploy workflow.

---

## 13. What LLM Agents Should Know Before Making Changes

- Always run `npm run check` after TypeScript edits
- Always run `sam validate --lint --region us-east-1` after editing `template.yaml`
- Never modify anything in the sibling `career-jump` (Cloudflare) repo — it is the live production MVP
- Never commit `.env` files, AWS credentials, or secrets
- Never hardcode `ALLOWED_USER_EMAIL` — it is a SAM parameter
- The Cloudflare `wrangler.jsonc` file exists in this repo only for shared TypeScript type compatibility — this project does not deploy to Cloudflare
- `worker-configuration.d.ts` is a Cloudflare type artifact — present for type compatibility, not used at AWS runtime
- Production deploys are run by the developer from their terminal using `sam deploy`. See [docs/release-runbook.md](./docs/release-runbook.md) for the full process.
- All logs in `releases/` must follow the pattern `vX.Y.Z.md` and document the release summary and validation steps
