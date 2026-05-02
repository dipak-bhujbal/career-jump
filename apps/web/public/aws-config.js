// Production runtime config. Deploy scripts can overwrite these placeholders
// with the isolated career-jump-web stack outputs without rebuilding assets.
window.CAREER_JUMP_AWS = {
  apiBaseUrl: "",
  // Set to the career-jump-web-poc-registry Lambda Function URL once deployed.
  // Leave empty to fall back to apiBaseUrl for registry calls.
  registryBaseUrl: "",
  cognitoDomain: "",
  cognitoClientId: "",
  cognitoUserPoolId: "",
  gaMeasurementId: "",
  redirectUri: window.location.origin,
};
