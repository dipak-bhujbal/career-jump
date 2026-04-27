# Decision Log

Short-form record of every significant architectural or product decision. New entries go at the top.

## ADR-005: Custom Auth UI Over Cognito Hosted UI

**Status**: Accepted
**Date**: 2026-04-26

**Context**: Cognito provides a Hosted UI (a Cognito-managed login page at a `auth.us-east-1.amazoncognito.com` subdomain) that handles signup, login, and MFA out of the box. The alternative is to build custom auth screens using the Cognito SDK directly.

**Decision**: Use a custom React auth UI (`/login`, `/signup`, `/verify-email`, `/forgot-password`) built with the Amplify/Cognito SDK, rather than redirecting to Cognito Hosted UI.

**Rationale**:
- **Brand control**: Hosted UI cannot be styled to match the Career Jump design system (Tailwind, dark mode, component library). Custom UI looks and feels like the rest of the app.
- **UX quality**: The Hosted UI has no loading states, no inline field validation, no toast notifications, and no custom error messaging — all of which the custom UI provides.
- **Routing integration**: Custom UI integrates with TanStack Router (auth state machine, redirect after login, `?redirect=` parameter) — impossible with a hosted redirect-based flow without significant complexity.
- **PKCE compatibility**: The app uses `USER_SRP_AUTH` (direct SDK, no redirect), which works with the public client. If PKCE redirect is needed in the future, the Hosted UI can be enabled alongside the custom UI.

**Alternatives Evaluated**:
- Cognito Hosted UI: rejected — no brand control, poor UX, OAuth redirect adds complexity for a SPA with direct SDK access
- Auth0 / Clerk: rejected — additional vendor, monthly cost, external dependency (see ADR-001)

**Consequences**:
- Positive: Full control over UI, animations, error handling, routing behavior
- Negative: Must implement and maintain auth screens; must handle all Cognito SDK edge cases (OTP expiry, rate limits, password policy errors)
- Neutral: PKCE redirect flow would require refactoring if added later

---

## ADR-004: Treat All Users as California Residents (Universal CCPA Compliance)

**Status**: Accepted
**Date**: 2026-04-26

**Context**: CCPA technically applies only to California residents meeting certain thresholds. Career Jump could implement geographic detection to only show CCPA controls to California users. Alternatively, all users can be treated as California residents.

**Decision**: Apply CCPA rights universally — every user, regardless of location, has the same data export, deletion, and opt-out rights.

**Rationale**:
- **Simplicity**: No geographic detection logic needed. No IP-based location lookup. No consent management platform required.
- **Universal data rights**: Users everywhere deserve these rights regardless of legal requirement. This is the ethical stance.
- **Reduced legal surface area**: No edge cases where a California resident doesn't get their rights because geolocation was wrong. No state-specific legal exposure.
- **SOC2 alignment**: Privacy controls are applied consistently, which auditors prefer over conditional logic.
- **Future-proofing**: As more states adopt similar laws (Virginia VCDPA, Colorado CPA, Connecticut CTDPA), universal compliance avoids future rework.

**Alternatives Evaluated**:
- Geographic detection (IP-based): rejected — location detection is unreliable (VPN, mobile IP), adds complexity, and creates legal risk if a California resident is misclassified
- No CCPA compliance: rejected — Privacy laws are the direction of travel; proactive compliance is lower cost than reactive

**Consequences**:
- Positive: Zero legal complexity around residency determination; cleaner Privacy Policy; user trust
- Negative: Slightly more implementation work (data export, deletion cascade) for users who don't legally require it
- Neutral: The technical implementation (DynamoDB cascade delete, data export endpoint) is the same regardless of which users are in scope

---

## ADR-003: Amazon SES for Email Notifications

**Status**: Accepted
**Date**: 2026-04-26

**Context**: Career Jump needs to send transactional emails (welcome, verification, job alerts, weekly digest). Options considered were Amazon SES, SendGrid, Mailgun, and Postmark.

**Decision**: Use Amazon SES for all email sending.

**Rationale**:
- **AWS-native**: SES integrates directly with Lambda, SNS, DynamoDB Streams, and EventBridge — no cross-vendor auth or API keys to manage
- **Cost**: SES is $0.10 per 1,000 emails (vs. SendGrid $14.95/month for 50K, Mailgun $35/month for 50K). At Career Jump's scale, SES cost is effectively $0.
- **No additional vendor**: Stays within the AWS account and AWS DPA. No new vendor contract or DPA negotiation.
- **Domain reputation control**: SES allows full DKIM/DMARC control over the sending domain. Deliverability is managed within the same domain as the app.
- **Bounce/complaint handling**: SES natively integrates with SNS for bounce/complaint feedback, which connects directly to the existing Lambda infrastructure.

**Alternatives Evaluated**:
- SendGrid: rejected — monthly cost, additional vendor, API key management outside AWS, separate DPA
- Mailgun: rejected — same concerns as SendGrid; higher cost for EU data residency
- Postmark: rejected — premium transactional email service, cost is disproportionate to Career Jump's volume
- Google Apps Script webhook (previous): deprecated — not scalable, tightly coupled to personal Gmail, no templating, no bounce handling

**Consequences**:
- Positive: Cost-effective, AWS-native, full DKIM/DMARC control, native bounce handling
- Negative: SES sandbox restriction requires production access request; warm-up strategy needed for deliverability
- Neutral: SES template management is a separate deploy step (not SAM-native, requires CLI or Custom Resource)

---

## ADR-002: Tenant Isolation via Cognito Sub as DynamoDB Key Prefix

**Status**: Accepted
**Date**: 2026-04-26

**Context**: Career Jump needs to isolate job, application, and configuration data between users (tenants). Three main isolation strategies were considered: (1) a key prefix in a shared table, (2) a separate DynamoDB table per user, (3) a separate AWS account per user.

**Decision**: Use the Cognito `sub` UUID as a partition key prefix in the shared DynamoDB table. All user items have `pk = USER#{sub}#{resourceType}`.

**Rationale**:
- **Cost**: A single DynamoDB table with `PAY_PER_REQUEST` billing costs nearly nothing at small scale. Separate tables per user would mean thousands of tables; separate accounts would multiply all AWS infrastructure costs.
- **Simplicity**: No table creation on user signup. No table lifecycle management. DynamoDB Query with `begins_with` on the partition key is the only isolation mechanism needed.
- **Sufficient isolation**: The `sub` is an immutable, Cognito-issued UUID that a user cannot forge or manipulate. Combined with JWT validation, the isolation is cryptographically grounded.
- **No cross-tenant leakage**: DynamoDB partition keys physically separate hot data. A query on `USER#aaa-111#JOBS` cannot return items from `USER#bbb-222#JOBS` — this is guaranteed by DynamoDB's architecture.
- **DynamoDB best practices**: Single-table design with hierarchical key patterns is the documented AWS best practice for multi-tenant SaaS on DynamoDB.

**Alternatives Evaluated**:
- Separate table per tenant: rejected — table limit (2,500 per region per account for SAM stacks), provisioning complexity, no shared query infrastructure
- Separate AWS account per tenant: rejected — extreme cost and operational overhead; appropriate for enterprise multi-tenancy at a much larger scale
- Separate DynamoDB item attribute (no key prefix): rejected — requires application-layer filtering after full scan; doesn't leverage DynamoDB's partition isolation; insecure

**Consequences**:
- Positive: Zero infrastructure changes for new tenants; strong partition-level isolation; aligns with DynamoDB single-table best practices
- Negative: All tenant data is in one table — a misconfigured query missing the `pk` condition could theoretically return cross-tenant data (mitigated by code review and integration tests)
- Neutral: Admin access (debugging, CCPA audits) requires direct DynamoDB console access with IAM credentials — no admin UI exists yet

---

## ADR-001: Use Amazon Cognito for Authentication

**Status**: Accepted
**Date**: 2026-04-26

**Context**: Career Jump's React SPA needs user authentication. The backend (Lambda) needs to validate user identity for every API call. Options evaluated: Amazon Cognito, Auth0, Supabase Auth, Firebase Auth, and custom JWT implementation.

**Decision**: Use Amazon Cognito User Pools for authentication and authorization.

**Rationale**:
- **Cost**: Cognito is free for the first 50,000 MAUs. Auth0's free tier is 7,500 MAUs with limited features. At Career Jump's scale, Cognito is effectively free.
- **AWS integration**: Cognito is native to the AWS stack. JWT validation uses `aws-jwt-verify` (AWS-maintained library). IAM policies can reference Cognito identities. No cross-vendor auth token exchange.
- **No vendor lock-in risk**: Cognito is an AWS-managed service, and the app uses the Cognito SDK directly. Migrating away would require a new auth provider's SDK but not a change in application architecture — the JWT-based API contract remains the same.
- **SRP auth**: Cognito's `USER_SRP_AUTH` flow means passwords are never transmitted in plaintext — a security property that custom JWT and most third-party providers don't offer without additional configuration.
- **Managed compliance**: Cognito's password storage, OTP generation, and token issuance are handled by AWS and covered by AWS's SOC2 Type II, ISO 27001, and PCI DSS certifications.
- **Email verification built-in**: Cognito sends OTP verification emails natively. No separate email provider integration is needed for auth flows.

**Alternatives Evaluated**:
- Auth0: rejected — additional vendor, cost at scale ($240+/month for production features), separate DPA, JWT validation requires Auth0 SDK or manual JWKS fetch
- Supabase Auth: rejected — non-AWS infrastructure; introduces a Postgres dependency; less mature IAM integration
- Firebase Auth: rejected — Google Cloud dependency; cross-cloud; no SRP; less aligned with AWS-native architecture
- Custom JWT (express-jwt or similar): rejected — reinventing the wheel; would require implementing password hashing, token rotation, OTP email sending, brute-force protection — all solved by Cognito

**Consequences**:
- Positive: Free at scale, AWS-native, SRP security, managed compliance, built-in email verification
- Negative: Cognito's SDK has a steeper learning curve than simpler providers; Hosted UI is limited (resolved by ADR-005)
- Neutral: Cognito User Pool ID and Client ID are required in Lambda environment variables; these are not secrets but must be managed as configuration

---

| # | Decision | Rationale | Date | Alternatives Evaluated | Why Discarded |
|---|----------|-----------|------|------------------------|---------------|
| 9 | **Optimistic updates for notes** — update UI instantly, roll back on error | Notes appeared to vanish after saving due to stale React Query cache; optimistic update makes it feel instant and sidesteps the refetch timing issue | 2026-04-26 | Wait for refetch; add a `key` prop to force remount | Both add latency/flicker; optimistic is the React Query recommended pattern |
| 8 | **WhatsApp-style note records** instead of a single textarea | A single text field loses history and timestamps; users need to track recruiter conversations and prep notes over weeks | 2026-04-26 | Keep single textarea; use a rich text editor | Single textarea discards history; rich editor is overkill for short notes |
| 7 | **Resizable split panes** for jobs list + drawer | Overlay drawer hides the list; power users want to scan the list while reading job details | 2026-04-26 | Full-screen drawer; two-column CSS grid (fixed widths) | Full-screen loses list context; fixed widths don't adapt to screen size |
| 6 | **Mock-first UI development** — all API calls intercepted client-side | Backend (`career-jump-aws`) is deployed and stable; rebuilding backend first would block UI progress | 2026-04-26 | Build against real backend from the start; use a local backend dev server | Real backend requires auth + deployed infra for every local session; local dev server duplicates Lambda/DynoDB setup |
| 5 | **Isolated frontend infra** (`career-jump-web-poc` stack) with shared backend | Enables A/B testing — both apps see identical data; no duplicate backend cost or auth complexity | 2026-04-26 | Full isolation (separate Lambda + DynamoDB); no isolation (deploy over vanilla) | Full isolation defeats A/B purpose and doubles complexity; no isolation risks breaking the working vanilla app |
| 4 | **React + Vite + TanStack Router/Query** for the UI rebuild | Vanilla JS app is hard to extend; React gives component reuse, TypeScript, and ecosystem tooling | 2026-04-26 | Vue, Svelte, Next.js | Vue/Svelte: smaller community, fewer hiring-relevant examples; Next.js: SSR complexity is unnecessary for a SPA calling an existing API |
| 3 | **Single shared `JobDetailsDrawer`** for Available / Applied / Plan | Three pages show job details with slight variations — one component with a `DrawerSource` union avoids duplication | 2026-04-26 | Separate drawer components per page | Three separate components diverge over time and require 3× changes for shared features |
| 2 | **Inline=false/true modes** for drawer instead of separate components | Split-pane layout needs the drawer to render inline; overlay mode still needed for Applied and Plan pages | 2026-04-26 | Extract inner content to a render prop; create a separate inline component | Render prop adds indirection; separate component duplicates all the mutation hooks |
| 1 | **Keep Cloudflare deployment untouched** while building AWS POC | The Cloudflare app is the stable MVP used daily; all AWS work is additive, not a migration | 2026-04-26 | Migrate Cloudflare → AWS first; run both in parallel indefinitely | Migration first removes the safety net; indefinite parallel ops doubles maintenance |
