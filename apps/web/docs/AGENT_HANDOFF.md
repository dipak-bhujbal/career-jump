# Agent Handoff — Career Jump Multi-Tenancy Production Readiness

**Date:** 2026-04-26  
**Status:** Frontend complete, v3 isolated infra templates ready, backend tenant/API cutover still required
**Goal:** Get real users signing up, using the app, and receiving emails end-to-end

---

## v3.0.0 Separation Update

Use `docs/AWS_SEPARATION.md` as the source of truth for Phases 1-3. The React
app now has templates for its own DynamoDB table, SNS notification topic,
Cognito pool, and notification Lambda wiring under the `career-jump-web` name
family. Do not reuse `career-jump-aws-poc` backend/auth/data resources for the
React production deployment.

## What Has Already Been Built (Do Not Redo)

### Frontend (`career-jump-web` — this repo)
- Full Cognito auth UI: login, signup, email verification, forgot password, route protection
- `src/lib/auth.ts` — real Cognito when env vars set, mock fallback when not (mock code always `123456`)
- `src/features/auth/AuthContext.tsx` — React context, proactive token refresh, auth state machine
- Every `/api/*` call sends `Authorization: Bearer <idToken>` — the `sub` claim is the tenant ID
- Profile: data export (CCPA), clear data, delete account (calls Cognito deleteUser + `/api/data/clear`)
- Settings: per-user email notification preferences (new jobs alert, weekly digest, status updates)
- Privacy policy page at `/privacy`
- Sidebar shows logged-in user name + email, quick sign-out button

### Infrastructure templates (`infra/` — not yet deployed)
- `infra/cognito.yaml` — User Pool + App Client + Post Confirmation Lambda (creates DynamoDB profile + triggers welcome email)
- `infra/ses.yaml` — SES identity + 6 email templates + bounce/complaint handling via SNS
- `infra/notification-lambda.yaml` — Python Lambda that sends all notification types via SES
- `infra/full-stack.yaml` — Orchestrates all stacks

### Backend (`career-jump-aws` — separate repo, partially scaffolded)
The tenant infrastructure is stubbed but not implemented:
- `src/lib/tenant.ts` — `tenantScopedKey()`, `tenantScopedPrefix()`, `resolveRequestTenantContext()` exist but are **no-ops returning `tenantId: undefined`**
- `src/aws/auth.ts` — validates the Bearer token but **does not extract or propagate `sub`**
- `src/routes.ts` — imports tenant resolution from `tenant.ts` but gets undefined back, so all DynamoDB keys are currently unscoped (single-tenant)

**This is the critical gap.** All users share the same data today.

---

## Corrected Deployment Sequence

The previous handoff had the wrong order. `infra/cognito.yaml` requires SES verification, a DynamoDB table, and an SNS topic to already exist before it can deploy. Here is the correct order:

```
1. Prerequisites (manual AWS steps)
2. Deploy SES stack
3. Deploy Cognito stack
4. Update backend: auth.ts + tenant.ts + new endpoints
5. Deploy Notification Lambda stack
6. Wire scan-complete SNS + weekly digest EventBridge
7. E2E test checklist (11 items)
8. Rebuild frontend + deploy to S3/CloudFront
```

---

## STEP 1 — Prerequisites (manual, before any CloudFormation)

### 1a. Verify your SES sending identity
SES must verify the address or domain you'll send from before the stack can reference it.

```bash
# Option A — verify a single address (fine for beta)
aws ses verify-email-identity \
  --email-address noreply@yourdomain.com \
  --region us-east-1

# Check verification status (must be "Success" before proceeding)
aws ses get-identity-verification-attributes \
  --identities noreply@yourdomain.com \
  --region us-east-1
```

Option B (production) — verify the whole domain in the AWS console:  
SES → Verified Identities → Create identity → Domain → add the CNAME/TXT records to your DNS.

### 1b. Create the SNS notification topic
This ARN is required by both the Cognito stack and the notification Lambda stack.

```bash
aws sns create-topic \
  --name career-jump-poc-notifications \
  --region us-east-1

# Save this ARN — you'll use it 3 times in the steps below
# Format: arn:aws:sns:us-east-1:ACCOUNT_ID:career-jump-poc-notifications
```

### 1c. Confirm the DynamoDB table name
The table already exists in `career-jump-aws`. Find its exact name:

```bash
aws dynamodb list-tables --region us-east-1
# Look for something like: career-jump-poc-table or similar
```

---

## STEP 2 — Deploy SES Stack

```bash
cd /path/to/career-jump-web

aws cloudformation deploy \
  --template-file infra/ses.yaml \
  --stack-name career-jump-poc-ses \
  --region us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    AppName=career-jump \
    Stage=poc \
    FromEmail=noreply@yourdomain.com
```

### Request SES production access now (takes ~24 hours)
SES sandbox only allows sending to verified addresses. Request production access in parallel while continuing with other steps:

1. AWS Console → SES → Account dashboard → "Request production access"
2. Mail type: Transactional
3. Use case: SaaS app sending verification, password reset, and job alert notifications to beta users who explicitly signed up
4. Estimated volume: under 1,000/day

**While waiting:** manually verify each beta tester's email so they can receive emails during testing:
```bash
aws ses verify-email-identity \
  --email-address betatester@example.com \
  --region us-east-1
```

---

## STEP 3 — Deploy Cognito Stack

All three prerequisites from Step 1 must be complete before running this.

```bash
aws cloudformation deploy \
  --template-file infra/cognito.yaml \
  --stack-name career-jump-poc-cognito \
  --region us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    AppName=career-jump \
    Stage=poc \
    SESFromEmail=noreply@yourdomain.com \
    DynamoDBTableName=YOUR_ACTUAL_TABLE_NAME \
    NotificationTopicArn=arn:aws:sns:us-east-1:ACCOUNT_ID:career-jump-poc-notifications
```

### Get outputs and write `.env.local`

```bash
aws cloudformation describe-stacks \
  --stack-name career-jump-poc-cognito \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table
```

Create `/path/to/career-jump-web/.env.local` for local testing. Missing Cognito
values no longer force mock mode in production; local mock mode requires
`VITE_USE_MOCKS=true` on localhost.

```env
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_APP_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_COGNITO_DOMAIN=career-jump-poc.auth.us-east-1.amazoncognito.com
VITE_API_BASE_URL=https://YOUR_BACKEND_LAMBDA_URL
VITE_USE_MOCKS=false
VITE_APP_URL=http://localhost:5173
```

> `src/lib/auth.ts` only enables mock auth on localhost when
> `VITE_USE_MOCKS=true`; CloudFront production must use real Cognito config.

### Quick smoke test
```bash
npm run dev
# Sign up with a real email
# You should receive a real 6-digit code from Cognito (not 123456)
# After confirming, check DynamoDB — USER#{sub}#PROFILE record should exist
```

---

## STEP 4 — Update `career-jump-aws` Backend (Critical)

This is the only step that requires writing code in the backend repo.  
**Do not skip or partially implement this — without it, all users share the same DynamoDB data.**

The backend already has the right structure. The work is filling in the two files that are currently stubs.

### File 1: `src/aws/auth.ts` — extract and return `sub`

This file currently validates the Bearer token but throws away the claims. It needs to return the `sub` so the tenant layer can use it.

**Current behavior (broken):**
```typescript
// validates token, returns nothing useful for scoping
export async function validateToken(token: string): Promise<void> { ... }
```

**Required behavior:**
```typescript
import { CognitoJwtVerifier } from "aws-jwt-verify";

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
  tokenUse: "id",
  clientId: process.env.COGNITO_APP_CLIENT_ID!,
});

export interface AuthClaims {
  sub: string;           // stable tenant ID — never changes
  email: string;
  username: string;      // custom:username attribute
}

export async function extractClaims(authHeader: string | undefined): Promise<AuthClaims> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }
  const token = authHeader.slice(7);
  const payload = await verifier.verify(token);

  return {
    sub: payload.sub,
    email: payload.email as string,
    username: (payload["custom:username"] as string) || (payload.email as string).split("@")[0],
  };
}
```

Install the verifier library if not already present:
```bash
cd /path/to/career-jump-aws
npm install aws-jwt-verify
```

Add env vars to every Lambda function definition (SAM template or CDK):
```
COGNITO_USER_POOL_ID: !Ref UserPoolId   # or hard-coded for now
COGNITO_APP_CLIENT_ID: !Ref AppClientId
```

### File 2: `src/lib/tenant.ts` — implement the scoping functions

This file currently returns `tenantId: undefined` from `resolveRequestTenantContext()` and returns unmodified keys from `tenantScopedKey()`. Fill it in:

```typescript
import { extractClaims } from "../aws/auth";

export interface TenantContext {
  tenantId: string;   // = Cognito sub
  email: string;
  username: string;
}

/**
 * Call this at the top of every Lambda handler.
 * Returns the scoped tenant context or throws 401.
 */
export async function resolveRequestTenantContext(
  event: AWSLambda.APIGatewayProxyEvent
): Promise<TenantContext> {
  // If API Gateway Cognito Authorizer is configured, sub is already in context
  const authorizerSub = event.requestContext?.authorizer?.claims?.sub as string | undefined;
  if (authorizerSub) {
    return {
      tenantId: authorizerSub,
      email: event.requestContext.authorizer?.claims?.email as string || "",
      username: event.requestContext.authorizer?.claims?.["custom:username"] as string || "",
    };
  }

  // Fallback: validate token directly (for local dev / non-authorizer routes)
  const claims = await extractClaims(event.headers?.Authorization || event.headers?.authorization);
  return {
    tenantId: claims.sub,
    email: claims.email,
    username: claims.username,
  };
}

/**
 * Prefixes a DynamoDB partition key with the tenant namespace.
 * Example: tenantScopedKey("abc-123", "JOBS") → "USER#abc-123#JOBS"
 */
export function tenantScopedKey(tenantId: string, resource: string): string {
  return `USER#${tenantId}#${resource}`;
}

/**
 * Returns a key prefix for Query operations (scan all records of a type for a tenant).
 * Example: tenantScopedPrefix("abc-123", "JOBS") → "USER#abc-123#JOBS"
 */
export function tenantScopedPrefix(tenantId: string, resource: string): string {
  return `USER#${tenantId}#${resource}`;
}
```

### File 3: `src/routes.ts` — apply tenant context to all handlers

`routes.ts` already imports from `tenant.ts`. The handlers just need to use the resolved context. Pattern to apply everywhere:

```typescript
// BEFORE (broken — tenantId is undefined)
const { tenantId } = await resolveRequestTenantContext(event);
const pk = tenantScopedKey(tenantId, "JOBS"); // → "USER#undefined#JOBS"

// AFTER (correct — once tenant.ts is implemented above)
const { tenantId } = await resolveRequestTenantContext(event);  // throws 401 if no valid token
const pk = tenantScopedKey(tenantId, "JOBS");  // → "USER#a1b2c3-...#JOBS"
```

Because `tenantScopedKey` and `resolveRequestTenantContext` are already called throughout `routes.ts`, **fixing the two files above is sufficient** — you do not need to touch individual handlers.

### Handle 401s from tenant resolution

Add a top-level try/catch in the Lambda handler wrapper (wherever your response formatting lives):

```typescript
try {
  const ctx = await resolveRequestTenantContext(event);
  // ... rest of handler
} catch (e) {
  if (e instanceof Error && e.message.includes("Authorization")) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }
  throw e;
}
```

### Two new endpoints to add to `src/routes.ts`

**`GET /api/user/data-export`** — CCPA right to access
```typescript
router.get("/user/data-export", async (event) => {
  const { tenantId } = await resolveRequestTenantContext(event);

  const resources = ["JOBS", "APPLIED", "CONFIG", "NOTES", "LOGS", "PROFILE"];
  const data: Record<string, unknown[]> = {};

  for (const resource of resources) {
    const result = await table.query({
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": tenantScopedKey(tenantId, resource) },
    });
    data[resource.toLowerCase()] = result.Items ?? [];
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      exportedAt: new Date().toISOString(),
      userId: tenantId,
      data,
    }),
  };
});
```

**`POST /api/user/notification-prefs`** — save email preferences
```typescript
router.post("/user/notification-prefs", async (event) => {
  const { tenantId } = await resolveRequestTenantContext(event);
  const body = JSON.parse(event.body ?? "{}");

  await table.update({
    Key: { pk: tenantScopedKey(tenantId, "PROFILE"), sk: "PROFILE" },
    UpdateExpression: "SET notifPrefs = :prefs, updatedAt = :now",
    ExpressionAttributeValues: {
      ":prefs": {
        newJobsAlert: Boolean(body.newJobsAlert ?? true),
        weeklyDigest: Boolean(body.weeklyDigest ?? true),
        statusUpdate: Boolean(body.statusUpdate ?? true),
      },
      ":now": new Date().toISOString(),
    },
  });

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
});
```

### Migrate existing test data

Existing DynamoDB records have no `USER#` prefix — they'll be invisible to the scoped queries. Since it's test data, wipe it:

```bash
# Scan all items, delete each one
aws dynamodb scan \
  --table-name YOUR_TABLE_NAME \
  --projection-expression "pk,sk" \
  --region us-east-1 \
  --output json | \
jq -c '.Items[]' | while read item; do
  PK=$(echo "$item" | jq -r '.pk.S')
  SK=$(echo "$item" | jq -r '.sk.S')
  aws dynamodb delete-item \
    --table-name YOUR_TABLE_NAME \
    --key "{\"pk\":{\"S\":\"$PK\"},\"sk\":{\"S\":\"$SK\"}}" \
    --region us-east-1
done
```

Or use the "Clear data" button in the app for any user account that already exists.

---

## STEP 5 — Deploy Notification Lambda

```bash
aws cloudformation deploy \
  --template-file infra/notification-lambda.yaml \
  --stack-name career-jump-poc-notification-lambda \
  --region us-east-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    AppName=career-jump \
    Stage=poc \
    UserPoolId=us-east-1_XXXXXXXXX \
    SESFromEmail=noreply@yourdomain.com \
    DynamoDBTableName=YOUR_ACTUAL_TABLE_NAME \
    NotificationTopicArn=arn:aws:sns:us-east-1:ACCOUNT_ID:career-jump-poc-notifications
```

---

## STEP 6 — Wire Email Events in `career-jump-aws`

### New-jobs alert — publish to SNS after each scan
In the scan-complete handler in `career-jump-aws`:

```typescript
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sns = new SNSClient({ region: "us-east-1" });
const TOPIC_ARN = process.env.NOTIFICATION_TOPIC_ARN!;

async function afterScanComplete(tenantId: string, newJobs: Job[]) {
  if (newJobs.length === 0) return;

  // Check user's notification preferences
  const profile = await table.get({
    Key: { pk: tenantScopedKey(tenantId, "PROFILE"), sk: "PROFILE" },
  });
  if (!profile.Item?.notifPrefs?.newJobsAlert) return;

  await sns.send(new PublishCommand({
    TopicArn: TOPIC_ARN,
    Subject: "new_jobs_alert",
    Message: JSON.stringify({
      notification_type: "new_jobs_alert",
      user_sub: tenantId,
      job_count: newJobs.length,
      top_jobs: newJobs.slice(0, 5).map(j => ({ title: j.jobTitle, company: j.company })),
    }),
  }));
}
```

Add `NOTIFICATION_TOPIC_ARN` to the Lambda env vars.

### Weekly digest — EventBridge rule
```bash
# Create the schedule (every Monday 9am UTC)
aws events put-rule \
  --name career-jump-weekly-digest \
  --schedule-expression "cron(0 9 ? * MON *)" \
  --state ENABLED \
  --region us-east-1

# Point it at the notification Lambda
LAMBDA_ARN=$(aws cloudformation describe-stacks \
  --stack-name career-jump-poc-notification-lambda \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaArn`].OutputValue' \
  --output text --region us-east-1)

aws events put-targets \
  --rule career-jump-weekly-digest \
  --targets "Id=NotificationLambda,Arn=$LAMBDA_ARN" \
  --region us-east-1

# Give EventBridge permission to invoke it
aws lambda add-permission \
  --function-name $LAMBDA_ARN \
  --statement-id EventBridgeWeeklyDigest \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn $(aws events describe-rule --name career-jump-weekly-digest \
    --query RuleArn --output text --region us-east-1) \
  --region us-east-1
```

The notification Lambda's handler needs to detect the EventBridge source and fan out to all users. Add this branch to the Lambda in `infra/notification-lambda.yaml` or a deployed version:

```python
# Detect EventBridge invocation (weekly digest fan-out)
if event.get("source") == "aws.events":
    # Scan all USER#*#PROFILE items to get every user
    paginator = dynamodb.meta.client.get_paginator("scan")
    for page in paginator.paginate(
        TableName=TABLE_NAME,
        FilterExpression="sk = :sk AND attribute_exists(notifPrefs)",
        ExpressionAttributeValues={":sk": {"S": "PROFILE"}},
    ):
        for item in page["Items"]:
            user_sub = item.get("userId", {}).get("S")
            prefs = item.get("notifPrefs", {}).get("M", {})
            if user_sub and prefs.get("weeklyDigest", {}).get("BOOL", True):
                send_weekly_digest(user_sub, item.get("email", {}).get("S", ""))
    return {"ok": True}
```

---

## STEP 7 — End-to-End Test Checklist

Run every item before opening to beta users:

```
[ ] 1. Sign up with a real email → receive real Cognito verification email (not mock code 123456)
[ ] 2. Enter code → redirected to login page
[ ] 3. Log in → app loads, sidebar shows your name + email address
[ ] 4. Settings page → your verified email shown under "Email notifications"
[ ] 5. Trigger a job scan → new jobs alert email arrives at your inbox
[ ] 6. Apply to a job, change status → status update email arrives
[ ] 7. Profile → Export my data → JSON file downloads containing only your data
[ ] 8. ISOLATION TEST: Sign up a second account with a different email
         → second account must see zero jobs, zero applications, zero notes
         → this verifies tenant.ts is working, not returning undefined
[ ] 9. Profile → Clear job data → jobs gone, account still intact, can log back in
[ ] 10. Profile → Delete account → redirected to /login, cannot log in again
[ ] 11. Forgot password flow: enter email → receive reset code → set new password → log in with new password
```

Test 8 (isolation) is the most important. If both accounts see the same data, `tenant.ts` is still broken.

---

## STEP 8 — Rebuild Frontend + Deploy

Once `.env.local` has real Cognito values and backend is deployed:

```bash
cd /path/to/career-jump-web

# Build (pass real env vars)
VITE_AWS_REGION=us-east-1 \
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX \
VITE_COGNITO_APP_CLIENT_ID=XXXXXXXXXXXXXXXXXXXXXXXXXX \
VITE_COGNITO_DOMAIN=career-jump-poc.auth.us-east-1.amazoncognito.com \
VITE_API_BASE_URL=https://YOUR_BACKEND_LAMBDA_URL \
VITE_USE_MOCKS=false \
VITE_APP_URL=https://YOUR_CLOUDFRONT_DOMAIN \
npm run build

# Deploy to S3
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name career-jump-poc-frontend \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
  --output text --region us-east-1)

aws s3 sync dist/ s3://$BUCKET --delete

# Invalidate CloudFront cache
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name career-jump-poc-frontend \
  --query 'Stacks[0].Outputs[?OutputKey==`FrontendDistributionId`].OutputValue' \
  --output text --region us-east-1)

aws cloudfront create-invalidation \
  --distribution-id $DIST_ID \
  --paths "/*"
```

---

## Key Facts (context for any agent)

| Fact | Detail |
|---|---|
| Tenant ID | Cognito `sub` claim — immutable UUID, never changes even if email changes |
| Frontend mock mode trigger | Localhost only with `VITE_USE_MOCKS=true`; CloudFront production does not enter mock mode |
| Mock verification code | Always `123456` |
| DynamoDB key pattern | `USER#{sub}#{RESOURCE}` as partition key, e.g. `USER#abc-123#JOBS` |
| Backend tenant files | `career-jump-aws/src/lib/tenant.ts` and `src/aws/auth.ts` — currently stubs |
| Token flow | Frontend → Cognito auth → JWT → `Authorization: Bearer` on every `/api/*` → backend validates → `sub` extracted → DynamoDB scoped |
| Email flow | Event → SNS topic → `notification-lambda` → SES templates → user's verified email |
| Frontend repo | `career-jump-web` — React/Vite, S3 + CloudFront |
| Backend repo | `career-jump-aws` — AWS Lambda + DynamoDB (separate repo) |

## File Reference

| File | Purpose |
|---|---|
| `src/lib/auth.ts` | Cognito client + mock fallback |
| `src/features/auth/AuthContext.tsx` | React auth context + token refresh |
| `src/routes/__root.tsx` | Route protection (public vs authenticated paths) |
| `infra/cognito.yaml` | Cognito User Pool + Post Confirmation Lambda |
| `infra/ses.yaml` | SES + 6 email templates |
| `infra/notification-lambda.yaml` | Notification Lambda (Python 3.12) |
| `docs/architecture/auth.md` | Auth flow Mermaid diagrams |
| `docs/architecture/multi-tenancy.md` | Tenant isolation model |
| `docs/compliance/ccpa.md` | CCPA compliance guide |
| `career-jump-aws/src/lib/tenant.ts` | **Stub — needs implementation (Step 4)** |
| `career-jump-aws/src/aws/auth.ts` | **Stub — needs `sub` propagation (Step 4)** |
| `career-jump-aws/src/routes.ts` | Already calls tenant.ts — will work once Step 4 is done |
