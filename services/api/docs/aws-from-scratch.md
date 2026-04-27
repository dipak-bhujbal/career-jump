# AWS From Scratch Deployment

This document lists the AWS and GitHub-era prerequisites required to recreate Career Jump AWS from an empty AWS account or after deleting the existing POC stack.

## What `sam deploy` Recreates

Running `sam deploy` from the developer terminal deploys the application with AWS SAM / CloudFormation. From a clean AWS account it recreates:

- CloudFormation stack: `career-jump-aws-poc`
- Lambda API function URL
- Lambda run orchestrator
- Lambda scan-company worker
- Lambda finalizer
- DynamoDB state table with TTL
- S3 frontend bucket
- CloudFront distribution
- Cognito user pool, app client, hosted UI domain, and owner user
- EventBridge Scheduler schedules, running weekday scans every 3 hours
- CloudWatch log groups with one-day retention
- AWS Budget guardrail
- SAM artifact bucket if SAM needs one

The first deploy will create a new CloudFront domain and new Cognito hosted UI domain values. The frontend sync step writes those values into `aws-config.js` automatically.

## AWS Account Prerequisites

Use a personal AWS account where you are allowed to create and delete resources.

Required account details:

- AWS account ID: `561303652551`, or your replacement account ID.
- Region: `us-east-1`.
- Owner email for login: `dipak.bhujbal23@gmail.com`, or your replacement owner email.
- Budget email: usually the same owner email.

Required AWS services must be enabled:

- AWS CloudFormation
- AWS SAM deploy support
- AWS Lambda
- AWS Lambda Function URLs
- Amazon DynamoDB
- Amazon S3
- Amazon CloudFront
- Amazon Cognito
- Amazon EventBridge Scheduler
- Amazon CloudWatch Logs
- AWS Budgets
- IAM

## IAM Permissions for Deployment

Create or reuse a deployer IAM user/access key for local terminal deployments.

The deployer needs permissions to create, update, and delete this stack's resources. For a POC, the simplest path is temporary broad deploy permissions in the personal AWS account:

- CloudFormation full access for this stack
- S3 access for SAM artifacts and the frontend bucket
- CloudFront create/update/delete distribution and invalidation access
- Lambda create/update/delete/invoke access
- IAM role create/update/delete/pass-role access for SAM-generated Lambda roles
- DynamoDB create/update/delete/read/write access
- Cognito user pool/client/domain/user access
- EventBridge Scheduler create/update/delete access
- CloudWatch Logs create/update/delete access
- AWS Budgets create/update/delete access

Minimum practical managed-policy set for a personal POC deployer:

- `AWSCloudFormationFullAccess`
- `AmazonS3FullAccess`
- `CloudFrontFullAccess`
- `AWSLambda_FullAccess`
- `AmazonDynamoDBFullAccess`
- `AmazonCognitoPowerUser`
- `CloudWatchLogsFullAccess`
- `AmazonEventBridgeSchedulerFullAccess`, or equivalent Scheduler permissions
- Budgets permissions, such as `budgets:*`
- IAM permissions for role creation and `iam:PassRole`

For a hardened account, replace broad policies with stack-scoped custom IAM later. Do not use your company AWS SSO account for this personal POC unless your company explicitly allows it.

## Environment Variables for Deploy

Set these in your terminal session before running `sam deploy`:

```bash
export AWS_ACCESS_KEY_ID=your-deployer-access-key
export AWS_SECRET_ACCESS_KEY=your-deployer-secret-key
export AWS_DEFAULT_REGION=us-east-1
```

Optional variables for email notifications — pass as SAM parameter overrides when present:
- `APPS_SCRIPT_WEBHOOK_URL` — Apps Script notification endpoint
- `APPS_SCRIPT_SHARED_SECRET` — shared secret for Apps Script

Apps Script properties:
- `TO_EMAIL` — recommended fixed recipient for notification emails so webhook executions do not rely on `Session.getActiveUser().getEmail()`

See [docs/release-runbook.md](./release-runbook.md) for the full deploy command with parameter overrides.

## Deploy Steps

See [docs/release-runbook.md](./release-runbook.md) for the full release and deploy process. The short form:

```bash
export AWS_DEFAULT_REGION=us-east-1
sam build
sam deploy --config-env poc --no-confirm-changeset
AWS_REGION=us-east-1 npm run aws:sync-frontend
```

## What `sam deploy` Runs

Important behavior:

- `sam deploy` creates or updates the CloudFormation stack.
- `resolve_s3 = true` lets SAM create/manage a deployment artifact bucket if needed.
- `aws:unpark` restores the runtime if it was parked: Lambda concurrency, S3 website hosting/public read policy, and CloudFront enabled state.
- `aws:sync-frontend` reads stack outputs, uploads static frontend assets, writes `aws-config.js`, uploads `/docs`, and invalidates CloudFront.

## Historical: Cloudflare-to-AWS Data Migration

> This section documents the one-time migration from the legacy Cloudflare runtime. It is kept for historical reference only.

To move current production data from Cloudflare KV into the AWS DynamoDB state table, export the durable runtime keys and import them with the checked-in helper.

Cloudflare KV namespace IDs:

| Binding | Namespace ID |
| --- | --- |
| `CONFIG_STORE` | `4414b1d59f9f4d3d9ec17c560779c997` |
| `JOB_STATE` | `0cac4e3260b64de6a53e47f36a9d27be` |

Durable keys to migrate:

- `CONFIG_STORE/runtime:config`
- `CONFIG_STORE/runtime:company_scan_overrides`
- `CONFIG_STORE/runtime:saved_filters`, if present
- `JOB_STATE/runtime:latest_inventory`
- `JOB_STATE/runtime:applied_jobs`
- `JOB_STATE/runtime:job_notes`
- `JOB_STATE/runtime:discarded_job_keys`
- `JOB_STATE/runtime:trend_points`
- `JOB_STATE/runtime:last_new_jobs_count`
- `JOB_STATE/runtime:last_new_job_keys`
- `JOB_STATE/runtime:last_updated_jobs_count`
- `JOB_STATE/runtime:last_updated_job_keys`

Import into AWS:

```bash
AWS_PROFILE=career-jump-personal-deployer \
AWS_REGION=us-east-1 \
AWS_STATE_TABLE=career-jump-aws-poc-state \
npm run aws:import-cloudflare-runtime -- /tmp/career-jump-cf-export
```

The importer skips missing or invalid optional exports instead of overwriting AWS state with a failed export message.

## First Deploy Verification

After the deploy completes:

1. Open CloudFormation stack `career-jump-aws-poc`.
2. Copy output `FrontendCloudFrontUrl`.
3. Open the CloudFront URL.
4. Sign in with the configured owner email.
5. Confirm the footer shows the current release version.
6. Open `/docs`.
7. Open `/logs.html`.
8. Run a scan manually from the app.
9. Confirm `/logs.html` shows:
   - one `scan_started` row
   - one `company_scan_summary` row per company
   - one `inventory_final_built` row

## Cognito First Login

CloudFormation creates the owner user in the Cognito user pool. Cognito may send a temporary password email to the owner address.

If no email arrives:

1. Open Cognito in `us-east-1`.
2. Open user pool `career-jump-aws-poc`.
3. Find the owner user.
4. Use `Reset password` or `Resend invitation`.

## Cost Notes

The stack is designed to stay low cost:

- No API Gateway
- No NAT Gateway
- No RDS
- No EC2
- No ALB
- No Fargate
- No OpenSearch
- No Step Functions
- DynamoDB on-demand billing
- Lambda ARM64
- S3 + CloudFront for static frontend
- CloudWatch log retention: one day
- App logs in DynamoDB: six-hour TTL

CloudFront and AWS Budgets may have small ongoing account-level effects. Delete the stack when not using the POC.

## Full Teardown

To delete the current AWS resources:

1. Empty the frontend S3 bucket.
2. Delete the CloudFormation stack `career-jump-aws-poc`.
3. Wait for CloudFormation deletion to complete.
4. Delete any SAM managed artifact stack or bucket if you also want to remove deploy tooling artifacts.

After teardown, the next `sam deploy` run recreates the stack and frontend from the repository.

## Parking Without Deleting

If you want to pause usage without deleting the stack:

- Set app Lambda reserved concurrency to `0`.
- Disable any EventBridge Scheduler schedules.
- Delete S3 website configuration.
- Enable S3 public access block.
- Delete the public frontend bucket policy.
- Disable the CloudFront distribution.

Running `sam deploy` also runs `npm run aws:unpark`, so a later deployment can restore these parked resources before syncing the frontend.
