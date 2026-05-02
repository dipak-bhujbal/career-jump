#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-career-jump-prod}"
REGION="${AWS_REGION:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$API_DIR/../.." && pwd)"
WEB_DIST_DIR="${WEB_DIST_DIR:-$REPO_ROOT/apps/web/dist}"
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
FRONTEND_URL="$(output FrontendCloudFrontUrl)"
DISTRIBUTION_ID="$(output FrontendDistributionId)"
COGNITO_DOMAIN="$(output CognitoDomain)"
COGNITO_CLIENT_ID="$(output CognitoClientId)"
COGNITO_USER_POOL_ID="$(output CognitoUserPoolId)"
ADMIN_COGNITO_DOMAIN="$(output AdminCognitoDomain)"
ADMIN_COGNITO_CLIENT_ID="$(output AdminCognitoClientId)"
ADMIN_COGNITO_USER_POOL_ID="$(output AdminCognitoUserPoolId)"
GA_MEASUREMENT_ID="${GOOGLE_ANALYTICS_MEASUREMENT_ID:-${VITE_GA_MEASUREMENT_ID:-}}"

CONFIG_FILE="$(mktemp)"
cat > "$CONFIG_FILE" <<EOF_CONFIG
window.CAREER_JUMP_AWS = {
  apiBaseUrl: "${FRONTEND_URL%/}",
  cognitoDomain: "${COGNITO_DOMAIN%/}",
  cognitoClientId: "${COGNITO_CLIENT_ID}",
  cognitoUserPoolId: "${COGNITO_USER_POOL_ID}",
  adminCognitoDomain: "${ADMIN_COGNITO_DOMAIN%/}",
  adminCognitoClientId: "${ADMIN_COGNITO_CLIENT_ID}",
  adminCognitoUserPoolId: "${ADMIN_COGNITO_USER_POOL_ID}",
  gaMeasurementId: "${GA_MEASUREMENT_ID}",
  redirectUri: "${FRONTEND_URL%/}/"
};
EOF_CONFIG

if [[ ! -d "$WEB_DIST_DIR" ]]; then
  printf 'Missing frontend build directory: %s\nRun npm run build:web from the repo root first.\n' "$WEB_DIST_DIR" >&2
  exit 1
fi

# Publish the Vite build, not the legacy static frontend from the old backend repo.
aws "${PROFILE_ARG[@]}" s3 sync "$WEB_DIST_DIR" "s3://${BUCKET}" \
  --region "$REGION" \
  --delete \
  --cache-control "public,max-age=60"

aws "${PROFILE_ARG[@]}" s3 cp "$CONFIG_FILE" "s3://${BUCKET}/aws-config.js" \
  --region "$REGION" \
  --content-type "application/javascript" \
  --cache-control "no-store"

aws "${PROFILE_ARG[@]}" s3 cp "$API_DIR/public/swagger.html" "s3://${BUCKET}/docs" \
  --region "$REGION" \
  --content-type "text/html" \
  --cache-control "public,max-age=60"

rm -f "$CONFIG_FILE"

aws "${PROFILE_ARG[@]}" cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --output text >/dev/null

printf 'Frontend synced: %s\n' "$FRONTEND_URL"
