# SOC2 Type I Controls Mapping

## Overview

This document maps Career Jump's current technical and operational controls to the AICPA SOC2 Trust Service Criteria (TSC). It covers Security (CC), Availability (A), and Confidentiality (C) criteria — the three trust service categories relevant to a SaaS job-tracking platform.

**SOC2 Type I** attests that controls are suitably designed as of a specific point in time. **SOC2 Type II** additionally attests that controls operated effectively over a period (typically 6–12 months). This document targets Type I.

**Target audit date**: Q4 2026 (6 months from April 2026)

---

## Table of Contents

1. [Trust Service Criteria Overview](#trust-service-criteria-overview)
2. [Security Controls (CC)](#security-controls-cc)
3. [Availability Controls (A)](#availability-controls-a)
4. [Confidentiality Controls (C)](#confidentiality-controls-c)
5. [Gaps to Address Before Audit](#gaps-to-address-before-audit)
6. [Evidence Collection Guide](#evidence-collection-guide)
7. [Recommended Path to SOC2 Type I](#recommended-path-to-soc2-type-i)

---

## Trust Service Criteria Overview

| TSC Code | Category | Criterion | Career Jump Coverage |
|----------|----------|-----------|---------------------|
| CC6.1 | Security | Logical and physical access controls | Cognito auth, JWT validation, IAM |
| CC6.2 | Security | New account provisioning | Email verification, self-service with controls |
| CC6.3 | Security | Access removal | Account deletion cascade, token revocation |
| CC6.7 | Security | Data transmission | HTTPS everywhere (CloudFront, Cognito, Lambda) |
| CC6.8 | Security | Malicious software prevention | CSP headers, no server-side file uploads |
| CC7.2 | Security | System monitoring | CloudWatch Logs, CloudTrail |
| CC7.3 | Security | Incident identification and response | CloudWatch Alarms, SNS alerting |
| A1.1 | Availability | Availability and performance targets | S3+CloudFront 99.99%, Lambda 99.95% |
| C1.1 | Confidentiality | Information classified as confidential | DynamoDB encryption at rest, SES TLS |

---

## Security Controls (CC)

### CC6.1 — Logical and Physical Access Controls

**Criterion**: The entity implements logical access security software, infrastructure, and architectures over protected information assets to protect them from security events.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| Authentication required for all data | Every API endpoint validates Cognito JWT before processing | API Lambda code review; CloudWatch 401 rate |
| Strong password policy | Cognito User Pool: min 8 chars, uppercase, lowercase, digit | Cognito User Pool config export |
| Token-based API authorization | `aws-jwt-verify` validates signature, expiry, issuer, audience | Lambda source code + unit tests |
| No long-lived credentials in app | SPA uses short-lived JWTs (1-hour ID token) | Cognito App Client config |
| IAM least-privilege for Lambda | Lambda execution role scoped to single DynamoDB table | IAM policy document |
| Infrastructure access via IAM + MFA | AWS console access requires MFA; CLI access requires IAM user or role | AWS IAM config |
| No shared credentials | Each Lambda function has its own IAM execution role | IAM role inventory |
| Tenant data isolation | DynamoDB partition key prefix `USER#{sub}#` enforced in code | Code review + integration tests |
| Physical security | AWS data centers (SOC2 certified, ISO 27001) | AWS Compliance reports |

**Gaps**: See [Gaps to Address](#gaps-to-address-before-audit).

---

### CC6.2 — New Account Provisioning

**Criterion**: New internal and external users are registered and authorized consistent with the entity's policies.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| Email verification required | Cognito requires OTP confirmation before account is marked confirmed | Cognito User Pool settings |
| No account creation without valid email | `signUp()` fails if email is invalid format; `confirmSignUp()` required | Cognito flow documentation |
| Self-service signup with automatic controls | No admin approval required; controls are technical (verification, password policy) | Signup flow diagram (docs/architecture/auth.md) |
| Account exists check | Cognito `UsernameExistsException` prevents duplicate accounts | Auth error handling |
| Tenant provisioning is automatic and scoped | First-login Lambda auto-creates isolated DynamoDB namespace | Multi-tenancy docs |
| No privileged account creation via API | There is no admin user creation path in the user-facing API | API route table |

---

### CC6.3 — Access Removal

**Criterion**: Access to information assets is removed when no longer required.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| Account deletion is immediate and complete | `DELETE /api/user/account` cascades DynamoDB + Cognito deletion | Deletion flow documentation |
| Token invalidation on logout | `revokeToken()` invalidates refresh token server-side | Auth flow: Logout section |
| Token invalidation on password change | Cognito invalidates all refresh tokens on `confirmForgotPassword` | Forgot password flow |
| No orphaned access | JWT expiry (1 hour) limits window of stolen token misuse | Token configuration |
| SES suppression list removal on delete | Bounce handler removes user from suppression on account delete | Bounce handling code |

---

### CC6.7 — Data Transmission Security

**Criterion**: The entity restricts the transmission of information to authorized individuals and systems.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| HTTPS enforced on CloudFront | HTTP→HTTPS redirect on CloudFront distribution | CloudFront distribution config |
| HTTPS enforced on Lambda Function URL | Lambda Function URL uses HTTPS only (no HTTP support) | Lambda function URL config |
| TLS 1.2+ for all Cognito traffic | Cognito endpoints require TLS 1.2 minimum | AWS Cognito documentation |
| SES SMTP uses TLS | All SES email sending uses TLS (STARTTLS + TLS wrapper) | SES configuration set |
| DynamoDB SDK uses TLS | AWS SDK always uses TLS for DynamoDB API calls | AWS SDK documentation |
| HSTS header | `Strict-Transport-Security: max-age=31536000; includeSubDomains` set on CloudFront | CloudFront response headers policy |
| No plain-text data channels | All data flows are over TLS-encrypted channels | Architecture diagram |

---

### CC6.8 — Malicious Software Prevention

**Criterion**: Controls protect against malicious software.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| Content Security Policy | CloudFront Response Headers Policy sets strict CSP | CloudFront config |
| No server-side file upload | API does not accept file uploads; eliminates malicious file vector | API route table |
| No server-side HTML rendering | React SPA — Lambda never renders HTML; eliminates XSS server-side | Architecture |
| Input validation at system boundaries | Lambda validates all request parameters before DynamoDB operations | Lambda source code |
| No npm audit failures in production build | `npm audit` runs in CI; critical/high vulnerabilities block deployment | CI pipeline config |
| Dependency pinning | `package-lock.json` committed; `npm ci` used in CI | package-lock.json |
| No inline scripts (CSP) | `script-src 'self'` — no inline JavaScript execution | CSP header value |

---

### CC7.2 — System Monitoring

**Criterion**: The entity monitors system components and the operation of those components for anomalies.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| Lambda execution logs | All Lambdas log to CloudWatch Log Groups with structured JSON | CloudWatch Log Groups |
| API access logging | Lambda logs every request: method, path, status, duration, sub | Lambda logging middleware |
| Auth event logging | Cognito auth events (login, signup, password reset) in CloudTrail | CloudTrail log queries |
| AWS API call audit | CloudTrail captures all AWS API calls with IAM principal, timestamp, source IP | CloudTrail config |
| DynamoDB metrics | Read/write capacity, throttle events in CloudWatch | CloudWatch DynamoDB metrics |
| Lambda metrics | Invocations, errors, duration, throttles in CloudWatch | CloudWatch Lambda metrics |
| SES delivery metrics | Bounce rate, complaint rate, delivery success in CloudWatch | CloudWatch SES metrics |
| CloudWatch Log Insights | Ad-hoc query capability over all logs | CloudWatch Log Insights |

**Log retention:**
| Log Type | Retention | Storage |
|----------|-----------|---------|
| Lambda execution logs | 1 day | CloudWatch Logs |
| CloudTrail events | 90 days | S3 bucket (CloudTrail default) |
| Application-level run logs (DynamoDB) | 6 hours | DynamoDB TTL |

---

### CC7.3 — Incident Identification and Response

**Criterion**: The entity evaluates security events to determine whether they could or have resulted in a failure of the entity to meet its objectives.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| Lambda error alarms | CloudWatch Alarm on Lambda `Errors` metric > 0 → SNS → admin email | CloudWatch Alarms config |
| Elevated 4xx/5xx rate alarm | CloudWatch Alarm on API error rate → SNS → admin email | CloudWatch Alarms |
| SES bounce rate alarm | CloudWatch Alarm: bounce rate > 2% | SES + CloudWatch Alarms |
| Budget alerts | AWS Budgets alert at 60% + 100% of $5/month | AWS Budgets config |
| Incident response contact | `dipak.bhujbal23@gmail.com` receives all CloudWatch alarms | SNS subscription |
| Security event review | Monthly review of CloudTrail and CloudWatch logs (manual) | Calendar event / runbook |

**Gap**: No formal Incident Response Plan (IRP) document exists. See [Gaps](#gaps-to-address-before-audit).

---

## Availability Controls (A)

### A1.1 — Availability and Performance Targets

**Criterion**: Current processing capacity and usage are maintained, monitored, and evaluated to manage capacity demands.

**Career Jump Implementation:**

| Component | AWS SLA | Notes |
|-----------|---------|-------|
| S3 (static hosting) | 99.99% | Multi-AZ by default; CloudFront caches globally |
| CloudFront | 99.99% | Global edge network; automatic failover |
| Lambda | 99.95% | Managed by AWS; auto-scales to zero and back |
| DynamoDB | 99.999% | Multi-AZ, 11 nines durability |
| Cognito | 99.9% | Managed by AWS |
| Amazon SES | 99.9% | Managed by AWS |

**Composite availability estimate**: 99.9% (bounded by Cognito and SES)

| Control | Implementation | Evidence |
|---------|---------------|----------|
| Auto-scaling | Lambda and DynamoDB scale automatically (PAY_PER_REQUEST) | AWS service documentation |
| No single point of failure | Stateless Lambdas, managed DynamoDB, CloudFront edge | Architecture diagram |
| Concurrent execution limits | Lambda reserved concurrency set per function to prevent runaway | Lambda config |
| DynamoDB capacity mode | PAY_PER_REQUEST — no capacity planning required | DynamoDB table settings |
| CloudFront CDN | React SPA served from edge nodes globally | CloudFront distribution config |
| Health check monitoring | CloudWatch Alarms notify on Lambda errors | CloudWatch Alarms |

**Gap**: No formal uptime SLA commitment to users exists (Career Jump is currently self-hosted for a single user). A status page and uptime monitoring should be added before multi-user launch.

---

## Confidentiality Controls (C)

### C1.1 — Information Classified as Confidential

**Criterion**: The entity identifies and maintains confidential information to meet the entity's objectives related to confidentiality.

**Career Jump Implementation:**

| Control | Implementation | Evidence |
|---------|---------------|----------|
| DynamoDB encryption at rest | DynamoDB uses AWS-managed KMS keys (AES-256) by default | DynamoDB table settings |
| DynamoDB encryption in transit | All DynamoDB API calls use HTTPS (TLS 1.2+) | AWS SDK config |
| SES email encryption in transit | STARTTLS used for all SMTP relay; TLS 1.2 minimum | SES config |
| Cognito credential security | Passwords stored as SRP verifiers (not plaintext or reversible hash) | Cognito security model |
| sessionStorage token storage | Tokens stored in sessionStorage (cleared on tab close) not localStorage | Auth implementation |
| No credentials in source code | `.env` files excluded via `.gitignore`; secrets in Lambda env vars | .gitignore; Lambda config |
| Environment variables for secrets | Cognito Pool ID, Client ID, DynamoDB table name in Lambda env vars | Lambda config |
| No PII in log output | Lambda logging middleware strips email and sub from log bodies | Logging middleware code |
| CloudFront access log PII | IP addresses in CloudFront access logs; 1-day retention | CloudFront config |

**Data classification:**

| Classification | Definition | Examples in Career Jump |
|----------------|------------|------------------------|
| Public | No confidentiality requirement | App UI, public API docs |
| Internal | Internal use; not sensitive | System logs, metrics |
| Confidential | User personal data | Email, job data, notes, preferences |
| Restricted | Auth credentials | Cognito passwords (SRP), JWT tokens |

---

## Gaps to Address Before Audit

The following gaps must be remediated before a SOC2 Type I audit engagement:

### Gap 1: No Formal Security Policy Documents
**Risk**: Auditors require written policies, not just technical controls.
**Remediation**: Draft and publish:
- Information Security Policy
- Access Control Policy
- Incident Response Plan
- Data Classification Policy
- Business Continuity Plan (light version)
**Owner**: Dipak Bhujbal
**Target**: 8 weeks before audit

### Gap 2: No Vendor Risk Management Program
**Risk**: AWS sub-processors must be formally assessed and have signed DPAs.
**Remediation**: Accept AWS Data Processing Addendum (checkbox in AWS console); document that AWS is the only sub-processor.
**Owner**: Dipak Bhujbal
**Target**: Immediately (< 1 week)

### Gap 3: No Formal Change Management Process
**Risk**: SOC2 auditors will ask how code changes are reviewed, approved, and deployed.
**Remediation**: Document and enforce:
- Feature branch → PR → review → merge → deploy process in GitHub
- Required reviewer for all PRs (even if self-review with a checklist for solo developer)
- Deployment runbook (`docs/RELEASE_RUNBOOK.md` — already exists, formalize)
**Owner**: Dipak Bhujbal
**Target**: 4 weeks before audit

### Gap 4: No Penetration Test or Vulnerability Assessment
**Risk**: SOC2 auditors increasingly expect at least an automated vulnerability scan.
**Remediation**: Run `npm audit`, `aws securityhub enable`, and an OWASP ZAP scan against the staging Lambda URL. Document findings and remediations.
**Owner**: Dipak Bhujbal
**Target**: 6 weeks before audit

### Gap 5: Token Storage in sessionStorage (Not HttpOnly Cookies)
**Risk**: XSS vulnerability could allow token exfiltration. sessionStorage is better than localStorage but not as strong as httpOnly cookies.
**Remediation**: Migrate to httpOnly cookie-based token storage with CSRF protection (requires Lambda changes to set `Set-Cookie` header).
**Owner**: Backend + Frontend
**Target**: 12 weeks (may slip to Type II)

### Gap 6: No Multi-Factor Authentication for Admin AWS Access
**Risk**: If the AWS root account or IAM admin user is compromised, all infrastructure is at risk.
**Remediation**: Enable MFA on AWS root account (hardware MFA key recommended). Enable MFA on all IAM users with console access.
**Owner**: Dipak Bhujbal
**Target**: Immediately (< 1 week)

### Gap 7: No Formal Employee Security Training
**Risk**: SOC2 expects evidence of security awareness training for personnel with system access.
**Remediation**: For a solo developer, complete and document:
- OWASP Top 10 review (self-study, document completion)
- AWS Security Fundamentals course (free on AWS Training)
**Owner**: Dipak Bhujbal
**Target**: 10 weeks before audit

### Gap 8: No Uptime Monitoring or Status Page
**Risk**: A1.1 availability controls require evidence of monitoring and capacity management.
**Remediation**: Set up an uptime monitor (e.g., AWS CloudWatch Synthetics canary or BetterUptime) and a simple status page.
**Owner**: Dipak Bhujbal
**Target**: 8 weeks before audit

---

## Evidence Collection Guide

For each control area, the following evidence should be collected and preserved for the audit:

| Control | Evidence to Collect | How to Export |
|---------|--------------------|--------------------|
| CC6.1 — Logical access | Cognito User Pool config screenshot; Lambda IAM policy JSON; JWT validation code | AWS Console; IAM policy export; GitHub |
| CC6.2 — Account provisioning | Cognito signup flow recording; User Pool email verification setting | Console screenshot; video demo |
| CC6.3 — Access removal | Deletion Lambda code; test showing complete cascade | GitHub; test run output |
| CC6.7 — Transmission security | CloudFront HTTPS redirect config; Lambda URL config; curl output showing HSTS | AWS Console; curl -v output |
| CC6.8 — Malicious software | CSP header value; npm audit output; CI pipeline logs | curl -I output; npm audit JSON; GitHub Actions logs |
| CC7.2 — Monitoring | CloudWatch Log Group list + retention settings; CloudTrail trail config | AWS Console screenshots |
| CC7.3 — Incident response | CloudWatch Alarms config; SNS subscription; sample alarm notification | AWS Console; email screenshot |
| A1.1 — Availability | Lambda/DynamoDB/CloudFront SLA links; reserved concurrency config | AWS documentation links; Lambda config |
| C1.1 — Confidentiality | DynamoDB encryption setting; sessionStorage usage; `.gitignore` | AWS Console; browser DevTools; GitHub |

**Evidence snapshot date**: Should be taken within 2 weeks of the Type I assessment date. Take screenshots with timestamps, export configs to JSON, and save all evidence in a secure, versioned location.

---

## Recommended Path to SOC2 Type I

**Total timeline: 6 months (April → October 2026)**

```
Month 1 (April–May 2026):
  Week 1–2:  Remediate critical gaps (Gap 2: AWS DPA, Gap 6: MFA)
  Week 3–4:  Draft security policy documents (Gap 1)

Month 2 (May–June 2026):
  Week 5–6:  Formalize change management process (Gap 3)
  Week 7–8:  Run vulnerability assessment (Gap 4), document findings

Month 3 (June–July 2026):
  Week 9–10: Complete security training (Gap 7)
  Week 11–12: Deploy uptime monitoring + status page (Gap 8)

Month 4 (July–August 2026):
  Week 13–14: Engage SOC2 auditor (CPA firm specializing in cloud SaaS)
  Week 15–16: Auditor scoping call; confirm evidence requirements; set Type I date

Month 5 (August–September 2026):
  Week 17–18: Collect and organize all evidence
  Week 19–20: Internal readiness review; address auditor pre-questions

Month 6 (September–October 2026):
  Week 21–22: Auditor performs evidence review and testing
  Week 23–24: Draft report review; respond to findings; final report issued
```

**Recommended auditors for small SaaS:**
- Prescient Assurance (specializes in startup SOC2)
- Johanson Group
- Sensiba San Filippo
- A-LIGN

**Estimated cost**: $15,000–$30,000 for Type I (smaller firm, small scope). Type II costs $30,000–$60,000.

**Automation tools** to reduce evidence collection overhead:
- **Vanta** — continuous compliance monitoring, auto-generates SOC2 evidence
- **Drata** — similar to Vanta; integrates with GitHub, AWS, Cognito
- **Secureframe** — compliance automation with auditor connections

Using a compliance automation tool reduces audit prep time by 50–70% and is recommended if the platform scales beyond a handful of users.
