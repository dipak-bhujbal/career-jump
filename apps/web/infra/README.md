# Career Jump – Infrastructure

CloudFormation templates for the Career Jump SaaS backend (auth, email, notifications).

---

## Stack overview

| File | Description |
|---|---|
| `backend-foundation.yaml` | React-owned DynamoDB state table + SNS notification topic |
| `frontend-site.yaml` | S3 bucket + CloudFront distribution for the React/Vite SPA |
| `cognito.yaml` | Cognito User Pool, App Client, and hosted-UI domain |
| `ses.yaml` | SES email identity, configuration set, six email templates, bounce/complaint SNS topic |
| `notification-lambda.yaml` | Python 3.12 Lambda that sends SES templated emails via SNS events |
| `full-stack.yaml` | Orchestrator – nested stacks for all of the above |

## v3.0.0 separation contract

The React app must own its AWS resources so the older `career-jump-aws` app can
be deleted later without breaking this frontend. Use `AppName=career-jump-web`
for backend/auth/email resources and `FrontendAppName=cj-web` for the existing
React static site.

Expected isolated names for the POC stage:

| Resource | Name family |
|---|---|
| DynamoDB state table | `career-jump-web-poc-state` |
| DynamoDB registry table | `career-jump-web-poc-registry` |
| SNS notification topic | `career-jump-web-poc-notifications` |
| Cognito user pool | `career-jump-web-poc-user-pool` |
| Post-confirm Lambda | `career-jump-web-poc-post-confirmation` |
| Notification Lambda | `career-jump-web-poc-notification` |
| Frontend S3/CloudFront | `cj-web-*` |

Do not pass or reuse `career-jump-aws-poc-state`, `career-jump-aws-poc-api`, or
the older app's Cognito pool/client in a React production deployment. Keep the
global company registry in `career-jump-web-poc-registry`, not in the per-user
state table.

---

## Prerequisites

### 1. AWS CLI configured

```bash
aws configure
# or use AWS_PROFILE / environment credentials
```

### 2. SES domain or address verified

SES starts in sandbox mode. You must verify the sender email (or its domain) before deploying:

```bash
# Verify a single email address
aws ses verify-email-identity --email-address noreply@yourdomain.com --region us-east-1

# --- OR --- verify an entire domain (preferred for production)
aws ses verify-domain-identity --domain yourdomain.com --region us-east-1
# Then add the TXT DNS record returned in the output to your DNS provider.
```

For production, request SES production access via the AWS console (Support Center → SES Sending Limits increase).

### 3. S3 bucket for nested-stack templates (full-stack.yaml only)

```bash
aws s3 mb s3://career-jump-cfn-templates --region us-east-1
```

---

## Deployment order

Deploy stacks independently **or** use `full-stack.yaml` for a single-command deploy.

### Option A – deploy stacks independently

```bash
REGION=us-east-1
APP=career-jump-web
STAGE=poc
FROM_EMAIL=noreply@yourdomain.com

# 1. Backend foundation (DynamoDB + SNS)
aws cloudformation deploy \
  --template-file infra/backend-foundation.yaml \
  --stack-name ${APP}-foundation-${STAGE} \
  --parameter-overrides AppName=${APP} Stage=${STAGE} \
  --region ${REGION}

# 2. Frontend (optional if already deployed)
aws cloudformation deploy \
  --template-file infra/frontend-site.yaml \
  --stack-name cj-web-frontend-${STAGE} \
  --parameter-overrides AppName=cj-web Stage=${STAGE} \
  --region ${REGION}

# 3. Cognito
aws cloudformation deploy \
  --template-file infra/cognito.yaml \
  --stack-name ${APP}-cognito-${STAGE} \
  --parameter-overrides \
      AppName=${APP} \
      Stage=${STAGE} \
      SESFromEmail=${FROM_EMAIL} \
      DynamoDBTableName=${APP}-${STAGE}-state \
      NotificationTopicArn=arn:aws:sns:${REGION}:ACCOUNT_ID:${APP}-${STAGE}-notifications \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ${REGION}

# 4. SES
aws cloudformation deploy \
  --template-file infra/ses.yaml \
  --stack-name ${APP}-ses-${STAGE} \
  --parameter-overrides \
      AppName=${APP} \
      Stage=${STAGE} \
      FromEmail=${FROM_EMAIL} \
  --region ${REGION}

# 5. Notification Lambda
#    Replace <UserPoolId> with the Cognito output.
aws cloudformation deploy \
  --template-file infra/notification-lambda.yaml \
  --stack-name ${APP}-notification-${STAGE} \
  --parameter-overrides \
      AppName=${APP} \
      Stage=${STAGE} \
      UserPoolId=<UserPoolId> \
      SESFromEmail=${FROM_EMAIL} \
      DynamoDBTableName=${APP}-${STAGE}-state \
      NotificationTopicArn=arn:aws:sns:${REGION}:ACCOUNT_ID:${APP}-${STAGE}-notifications \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ${REGION}
```

### Option B – full-stack orchestrator (single deploy)

```bash
REGION=us-east-1
APP=career-jump-web
STAGE=poc
FROM_EMAIL=noreply@yourdomain.com
TEMPLATES_BUCKET=career-jump-cfn-templates

# Package nested stack templates (uploads local files to S3 and rewrites TemplateURL)
aws cloudformation package \
  --template-file infra/full-stack.yaml \
  --s3-bucket ${TEMPLATES_BUCKET} \
  --s3-prefix infra \
  --output-template-file infra/full-stack-packaged.yaml \
  --region ${REGION}

# Deploy
aws cloudformation deploy \
  --template-file infra/full-stack-packaged.yaml \
  --stack-name ${APP}-full-stack-${STAGE} \
  --parameter-overrides \
      AppName=${APP} \
      FrontendAppName=cj-web \
      Stage=${STAGE} \
      SESFromEmail=${FROM_EMAIL} \
      TemplatesBucketName=${TEMPLATES_BUCKET} \
  --capabilities CAPABILITY_NAMED_IAM CAPABILITY_AUTO_EXPAND \
  --region ${REGION}
```

---

## Retrieving stack outputs

```bash
# All outputs for a given stack
aws cloudformation describe-stacks \
  --stack-name career-jump-cognito-poc \
  --query "Stacks[0].Outputs" \
  --output table \
  --region us-east-1
```

Use the `UserPoolId` and `UserPoolClientId` outputs to populate your `.env.local` / CI secrets.

---

## Parameter descriptions

| Parameter | Stack(s) | Description |
|---|---|---|
| `AppName` | all | Prefix for backend/auth/email resource names and CloudFormation exports. Default: `career-jump-web`. |
| `Stage` | all | Deployment stage (`poc`, `dev`, `staging`, `prod`). Affects resource names. |
| `SESFromEmail` / `FromEmail` | cognito, ses, notification-lambda, full-stack | Verified SES sender address. Must be verified before deploy. |
| `UserPoolId` | notification-lambda, full-stack | Cognito User Pool ID. Output from the cognito stack. |
| `DynamoDBTableName` | cognito, notification-lambda | DynamoDB table holding user profiles (`pk=USER#<id>`, `sk=PROFILE`). The full-stack orchestrator creates and wires this automatically. |
| `NotificationTopicArn` | cognito, notification-lambda | SNS topic that triggers the notification Lambda. The full-stack orchestrator creates and wires this automatically. |
| `TemplatesBucketName` | full-stack | S3 bucket that holds packaged nested-stack YAML files (after `cfn package`). |
| `FrontendAppName` | full-stack | AppName forwarded to the frontend-site nested stack. Default: `cj-web`. |

---

## Environment variables for the frontend

Copy `.env.example` at the project root to `.env.local` and fill in the values obtained from the Cognito stack outputs:

```bash
VITE_COGNITO_USER_POOL_ID=<UserPoolId output>
VITE_COGNITO_APP_CLIENT_ID=<UserPoolClientId output>
VITE_COGNITO_DOMAIN=<UserPoolDomain output>
```

---

## Teardown

```bash
# Individual stacks (reverse deployment order)
aws cloudformation delete-stack --stack-name career-jump-notification-poc --region us-east-1
aws cloudformation delete-stack --stack-name career-jump-ses-poc          --region us-east-1
aws cloudformation delete-stack --stack-name career-jump-cognito-poc      --region us-east-1

# NOTE: The Cognito User Pool has DeletionProtection: ACTIVE.
# Disable it first via the console or CLI, then delete the stack.
aws cognito-idp update-user-pool \
  --user-pool-id <UserPoolId> \
  --deletion-protection INACTIVE \
  --region us-east-1
```

---

## Security notes

- The Cognito User Pool has `DeletionProtection: ACTIVE` – this prevents accidental deletion in production. Disable it manually before running `delete-stack`.
- SES is scoped to send only from the verified `FromEmail` address via an IAM condition (`ses:FromAddress`).
- DynamoDB access in the Lambda role is scoped to the single table and its GSIs only.
- SSM parameter access in the Lambda role is scoped to the `/${AppName}/${Stage}/notification/*` path.
- Never commit `.env.local` or any file containing Cognito IDs, SES credentials, or ARNs to version control.
