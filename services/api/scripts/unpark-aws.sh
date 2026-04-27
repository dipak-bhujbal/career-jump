#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-career-jump-aws-poc}"
REGION="${AWS_REGION:-us-east-1}"
PROFILE_ARG=()
if [[ -n "${AWS_PROFILE:-}" ]]; then
  PROFILE_ARG=(--profile "$AWS_PROFILE")
fi

output() {
  aws "${PROFILE_ARG[@]}" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" \
    --output text
}

BUCKET="$(output FrontendBucketName)"
DISTRIBUTION_ID="$(output FrontendDistributionId)"

aws "${PROFILE_ARG[@]}" lambda put-function-concurrency \
  --function-name "${STACK_NAME}-api" \
  --reserved-concurrent-executions 20 \
  --region "$REGION" >/dev/null

aws "${PROFILE_ARG[@]}" lambda put-function-concurrency \
  --function-name "${STACK_NAME}-run-orchestrator" \
  --reserved-concurrent-executions 1 \
  --region "$REGION" >/dev/null

aws "${PROFILE_ARG[@]}" lambda put-function-concurrency \
  --function-name "${STACK_NAME}-scan-company" \
  --reserved-concurrent-executions 40 \
  --region "$REGION" >/dev/null

aws "${PROFILE_ARG[@]}" lambda put-function-concurrency \
  --function-name "${STACK_NAME}-finalize-run" \
  --reserved-concurrent-executions 1 \
  --region "$REGION" >/dev/null

aws "${PROFILE_ARG[@]}" s3api put-public-access-block \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --public-access-block-configuration BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

aws "${PROFILE_ARG[@]}" s3api put-bucket-website \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --website-configuration '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"index.html"}}'

BUCKET_ARN="arn:aws:s3:::${BUCKET}"
POLICY_FILE="$(mktemp)"
cat > "$POLICY_FILE" <<EOF_POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadStaticAssets",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "${BUCKET_ARN}/*"
    }
  ]
}
EOF_POLICY

aws "${PROFILE_ARG[@]}" s3api put-bucket-policy \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --policy "file://${POLICY_FILE}"
rm -f "$POLICY_FILE"

DIST_CONFIG_FILE="$(mktemp)"
DIST_UPDATE_FILE="$(mktemp)"
aws "${PROFILE_ARG[@]}" cloudfront get-distribution-config \
  --id "$DISTRIBUTION_ID" > "$DIST_CONFIG_FILE"
ETAG="$(jq -r .ETag "$DIST_CONFIG_FILE")"
ENABLED="$(jq -r .DistributionConfig.Enabled "$DIST_CONFIG_FILE")"

if [[ "$ENABLED" != "true" ]]; then
  jq ".DistributionConfig.Enabled = true | .DistributionConfig" "$DIST_CONFIG_FILE" > "$DIST_UPDATE_FILE"
  aws "${PROFILE_ARG[@]}" cloudfront update-distribution \
    --id "$DISTRIBUTION_ID" \
    --if-match "$ETAG" \
    --distribution-config "file://${DIST_UPDATE_FILE}" >/dev/null
fi

rm -f "$DIST_CONFIG_FILE" "$DIST_UPDATE_FILE"
printf 'AWS resources unparked for stack %s\n' "$STACK_NAME"
