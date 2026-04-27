# CCPA Compliance Guide

## Overview

This document defines how Career Jump complies with the California Consumer Privacy Act (CCPA) as amended by the California Privacy Rights Act (CPRA). It covers the categories of personal information collected, how each user right is fulfilled, data retention policies, deletion procedures, and the implementation checklist.

**Decision**: Career Jump treats all users as California residents regardless of actual location (ADR-004). This simplifies compliance — universal data rights apply to every account — and reduces legal surface area.

---

## Table of Contents

1. [Scope and Applicability](#scope-and-applicability)
2. [Personal Information Collected](#personal-information-collected)
3. [How Personal Information Is Used](#how-personal-information-is-used)
4. [User Rights Under CCPA](#user-rights-under-ccpa)
5. [Data Retention Policy](#data-retention-policy)
6. [Data Export](#data-export)
7. [Privacy Policy](#privacy-policy)
8. [Do Not Track](#do-not-track)
9. [Contact for Privacy Requests](#contact-for-privacy-requests)
10. [Implementation Checklist](#implementation-checklist)
11. [Vendor Sub-Processors](#vendor-sub-processors)

---

## Scope and Applicability

**CCPA applies when a business:**
- Is for-profit
- Does business in California
- Meets one of: (a) > $25M annual gross revenue, (b) buys/sells > 100K consumers' data/year, (c) derives > 50% revenue from selling personal info

Career Jump does not currently meet these thresholds. However, by extending CCPA rights universally, Career Jump:
- Avoids tracking whether users are California residents
- Avoids the overhead of geographic-based consent gating
- Demonstrates privacy-by-design for SOC2 purposes
- Prepares for GDPR equivalence if EU users are onboarded

**Effective date of this policy**: April 26, 2026

---

## Personal Information Collected

The CCPA defines "personal information" broadly as information that identifies, relates to, or could reasonably be linked to a consumer. Career Jump collects the following categories:

| Category | Specific Data Points | Source | Purpose |
|----------|---------------------|--------|---------|
| **Identifiers** | Email address, Cognito `sub` UUID | User-provided at signup | Account creation, authentication, data scoping |
| **Internet/Electronic Activity** | Job search queries, filter presets, kanban status changes | User actions in-app | Core product functionality |
| **Professional/Employment Information** | Job titles searched, companies tracked, application status, interview notes | User-provided or user-triggered scraping | Core product functionality |
| **Inferences from Personal Info** | Implicit job preference signals (industries, locations, salary ranges in job descriptions) | Derived from job data | Not currently used for profiling |
| **Commercial Information** | None | — | Career Jump is currently free; no billing data collected |
| **Biometric Information** | None | — | Not collected |
| **Geolocation Data** | Location filters entered by user (e.g., "San Francisco") | User-provided | Job filtering only; not device GPS |
| **Sensitive Personal Information** | None | — | CPRA sensitive categories not collected |

**What Career Jump does NOT collect:**
- Social Security Number, driver's license, or government ID
- Financial account information or credit/debit card numbers
- Precise geolocation (GPS coordinates)
- Health or medical information
- Racial or ethnic origin
- Religious or philosophical beliefs
- Sexual orientation or gender identity
- Contents of private communications (email, text messages)

---

## How Personal Information Is Used

Career Jump uses collected personal information solely to provide the job-tracking service:

| Data | How Used | Shared With? |
|------|----------|-------------|
| Email address | Account authentication; email notifications (if opted in) | Amazon Cognito (auth), Amazon SES (email delivery) |
| Cognito sub UUID | DynamoDB partition key — scopes all data to your account | Not shared externally |
| Job search/filter data | Powers the job matching and scan results displayed to you | Not shared |
| Application pipeline data | Displayed in the Kanban view and Action Plan | Not shared |
| Notes on applications | Stored and displayed to you on demand | Not shared |
| Run logs | Debugging and scan performance monitoring (6-hour TTL) | Not shared; auto-deleted |

**No sale of personal information.** Career Jump does not sell, rent, or share personal information with third parties for their own marketing or commercial purposes. The Right to Opt-Out (CCPA § 1798.120) is not applicable — but the user right is acknowledged (see below).

---

## User Rights Under CCPA

### Right to Know (CCPA § 1798.110)

**What the right covers**: You have the right to know what personal information we collect, how it is used, and who it is shared with.

**How Career Jump fulfills it:**

1. **This document** — comprehensive list of all data categories collected, purposes, and sub-processors
2. **Privacy Policy** — located at `/privacy` in the app, plain-language version of this document
3. **Profile page** — `/configuration` shows your stored email, notification preferences, and filter configuration
4. **Data Export** — `GET /api/user/data-export` returns a complete JSON snapshot of all your data (see [Data Export](#data-export))

**Response time for requests**: Within 45 days (CCPA statutory limit). Career Jump's automated export endpoint provides immediate self-service fulfillment.

---

### Right to Delete (CCPA § 1798.105)

**What the right covers**: You have the right to request deletion of personal information we have collected.

**How Career Jump fulfills it:**

The "Delete Account" button in `/configuration` → "Account Settings" triggers a complete cascade deletion:

1. **DynamoDB**: All items under `USER#{sub}#*` partition key prefixes are permanently deleted
   - Job inventory (`USER#{sub}#JOBS`)
   - Applied jobs and pipeline data (`USER#{sub}#APPLIED`)
   - Configuration and company lists (`USER#{sub}#CONFIG`)
   - Notes (`USER#{sub}#NOTES`)
   - Saved filters (`USER#{sub}#FILTERS`)
   - User profile and preferences (`USER#{sub}#PROFILE`)
   - Run state (`USER#{sub}#RUN`)

2. **Amazon Cognito**: The user account (`adminDeleteUser`) is permanently deleted, invalidating all tokens

3. **SES Suppression List**: Email is removed from suppression list (allowing re-signup if desired)

4. **Run logs**: Already auto-deleted via 6-hour DynamoDB TTL; any remaining are explicitly deleted in the cascade

**Verification**: The deletion Lambda verifies all items are removed before responding with 200 OK. A confirmation email is sent before deletion initiates (user must confirm via email link).

**Exceptions** (CCPA § 1798.105(d)): Career Jump has no basis to retain data after an account deletion request. No legal obligations require retention of user job search data.

**Response time**: Immediate (synchronous cascade for accounts with < 1,000 items; asynchronous with email confirmation for larger accounts).

---

### Right to Opt-Out of Sale (CCPA § 1798.120)

**Applicability**: Not applicable. Career Jump does not sell personal information.

**How Career Jump fulfills it**: The Privacy Policy at `/privacy` explicitly states "We do not sell your personal information." A "Do Not Sell My Personal Information" link is not legally required but is included in the Privacy Policy footer as a declarative statement for clarity.

---

### Right to Non-Discrimination (CCPA § 1798.125)

**What the right covers**: You have the right not to receive discriminatory treatment for exercising CCPA rights.

**How Career Jump fulfills it**: Career Jump is a free, single-tier service. There are no paid tiers, no premium features, and no differential treatment based on whether a user exercises their privacy rights. Exercising any right (data export, deletion, opt-out) does not affect your access to any service features.

---

### Right to Correct (CPRA Amendment)

**What the right covers**: You have the right to correct inaccurate personal information.

**How Career Jump fulfills it**: All user-provided data (email, notification preferences, company lists, job notes) is directly editable in the app at any time. The API exposes `PATCH /api/user/profile` for profile updates. Email address changes flow through Cognito's `updateUserAttributes` flow with re-verification.

---

## Data Retention Policy

| Data Category | Retention Period | Deletion Trigger |
|---------------|-----------------|-----------------|
| User profile (email, preferences) | Until account deletion | User-initiated account delete |
| Job inventory (scan results) | Until account deletion or user manually clears | Account delete or `/configuration` → "Clear All Jobs" |
| Applied jobs and pipeline status | Until account deletion | Account delete |
| Job notes | Until user deletes individual notes or account | Per-note delete or account delete |
| Saved filters | Until user deletes or account is deleted | Per-filter delete or account delete |
| Scan run logs | 6 hours | DynamoDB TTL (automatic) |
| Cognito auth tokens (ID/Access) | 1 hour | Expiry (automatic) |
| Cognito refresh tokens | 30 days | Expiry or revocation on logout/password change |
| SES bounce/complaint records | Retained in SES suppression list until cleared | Manual or re-signup flow |
| CloudWatch Lambda logs | 1 day | CloudWatch log group retention policy |
| CloudTrail API logs | 90 days | Default CloudTrail retention |

---

## Data Export

**Endpoint**: `GET /api/user/data-export`
**Authentication**: Requires valid Bearer token
**Response**: `application/json` — complete export of all user data

**Export format:**

```json
{
  "exportedAt": "2026-01-15T10:00:00Z",
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "user@example.com",
  "profile": {
    "createdAt": "2025-12-01T00:00:00Z",
    "notificationPrefs": { ... }
  },
  "configuration": {
    "companies": [ ... ],
    "titleFilters": [ ... ],
    "locationFilters": [ ... ]
  },
  "jobInventory": [
    {
      "jobId": "greenhouse-anthropic-swe-123",
      "title": "Staff Engineer",
      "company": "Anthropic",
      "location": "San Francisco, CA",
      "discoveredAt": "2026-01-10T08:00:00Z"
    }
  ],
  "appliedJobs": [ ... ],
  "savedFilters": [ ... ],
  "notes": [ ... ]
}
```

The export includes all personal information Career Jump holds. The JSON file can be downloaded directly from the browser or from the profile page in the app. No request to data@career-jump.app is needed — the endpoint is self-service and immediate.

---

## Privacy Policy

**Location**: `/privacy` route in the React app (publicly accessible without login)

The Privacy Policy is a plain-language document that covers:
- What data is collected
- How it is used
- Third-party service providers (Cognito, SES, CloudFront)
- User rights and how to exercise them
- Contact information for privacy requests
- Effective date and version history

The Privacy Policy is also linked in:
- The signup page footer
- The login page footer
- All email footers (transactional and digest)
- The app footer (visible on all authenticated routes)

**Policy update process**: Any material change to data practices requires updating this policy with a new effective date and emailing all registered users with a summary of the change at least 30 days before it takes effect.

---

## Do Not Track

Career Jump honors the browser Do Not Track (DNT) header. Specifically:

- **No analytics trackers** are embedded in the app (no Google Analytics, Mixpanel, Segment, etc.)
- **No cross-site tracking pixels** in emails (SES click/open tracking is disabled per the configuration set)
- **No advertising cookies** or third-party cookies of any kind
- The only first-party sessionStorage data stored is Cognito auth tokens (necessary for the service)

This policy applies to all users regardless of DNT header status — DNT is honored by default, not on request.

---

## Contact for Privacy Requests

For privacy inquiries, data requests, or to exercise any right under CCPA:

**Email**: data@career-jump.app
**Subject line**: `[CCPA Request] - {Your Request Type}`

Response time: Within 45 days of verified request receipt. Verification may require confirming your registered email address.

**No postal mail address is required** for CCPA compliance at this scale (CCPA's "designated methods" requirement is met by the in-app self-service export and delete, plus email contact).

---

## Implementation Checklist

| Item | Status | Notes |
|------|--------|-------|
| Privacy Policy at `/privacy` route | ✅ | Publicly accessible without login |
| Data export endpoint `GET /api/user/data-export` | ✅ | Returns complete JSON export |
| Account deletion cascade (DynamoDB + Cognito) | ✅ | See `docs/architecture/multi-tenancy.md` |
| Deletion confirmation email before action | ✅ | 24-hour confirmation window |
| Notification opt-in/opt-out per category | ✅ | User preferences in DynamoDB |
| One-click email unsubscribe links | ✅ | Signed JWT-based unsubscribe URL |
| SES click/open tracking disabled | ✅ | Configuration Set setting |
| No analytics trackers embedded | ✅ | No third-party JS trackers |
| No third-party cookies | ✅ | No advertising or analytics cookies |
| Privacy Policy linked from signup/login | ✅ | Footer links |
| Privacy Policy linked from all email footers | ✅ | Email template footer |
| data@career-jump.app mailbox active | ⬜ | Create and monitor inbox |
| DMARC/DKIM/SPF configured for email domain | ✅ | Career-jump.app domain verified in SES |
| Vendor DPA (Data Processing Agreement) with AWS | ⬜ | Accept AWS DPA in console |
| User email change re-verification flow | ✅ | Cognito updateUserAttributes + verify |
| Right to Correct — all fields editable in app | ✅ | PATCH /api/user/profile |
| "Do Not Sell" declaration in Privacy Policy | ✅ | Declarative statement |
| Run log TTL set to 6 hours | ✅ | DynamoDB TTL attribute on log items |
| CloudWatch log retention set to 1 day | ✅ | Log group retention policy |
| Annual privacy policy review scheduled | ⬜ | Schedule yearly review |
| Incident response plan for data breach | ⬜ | Draft and publish internally |

---

## Vendor Sub-Processors

Career Jump uses the following AWS services that process personal information:

| Vendor | Service | Data Processed | DPA |
|--------|---------|----------------|-----|
| Amazon Web Services | Cognito | Email address, authentication credentials | AWS GDPR DPA (covers CCPA) |
| Amazon Web Services | DynamoDB | All user job/application data | AWS GDPR DPA |
| Amazon Web Services | SES | Email address, email content | AWS GDPR DPA |
| Amazon Web Services | Lambda | Transient processing (no persistence) | AWS GDPR DPA |
| Amazon Web Services | CloudFront | IP address in access logs (1-day retention) | AWS GDPR DPA |
| Amazon Web Services | CloudWatch | Lambda execution logs (1-day retention) | AWS GDPR DPA |

No data is shared with non-AWS third parties. Career Jump does not use analytics vendors, advertising networks, or data brokers.

**AWS DPA**: Accept the AWS Data Processing Addendum at `aws.amazon.com/agreement` → Data Privacy → Data Processing Addendum. This is a checkbox in the AWS console for account owners.
