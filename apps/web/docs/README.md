# Career Jump Web — Documentation

New to the project? Start here.

---

## What Is This?

`career-jump-web` is a React rebuild of the Career Jump job-tracking UI. It targets the same AWS backend (`career-jump-aws`) as the existing vanilla app. The goal is a richer, more maintainable frontend — deployed in isolation for A/B testing before a full cutover.

**The backend is not being rebuilt.** All Lambda/DynamoDB/ATS scraping work stays in `career-jump-aws`.

---

## Quick Navigation

### Core Architecture

| Doc | What it covers |
|-----|---------------|
| [Architecture Overview](architecture/overview.md) | Multi-tenant system diagram, three repos, AWS infra, ATS adapters, tech stack |
| [Authentication & Authorization](architecture/auth.md) | Cognito User Pool config, auth state machine, all auth flows with sequence diagrams, token types, route protection, API authorization |
| [Multi-Tenancy](architecture/multi-tenancy.md) | Tenant isolation model, DynamoDB key design, data isolation enforcement, onboarding, account deletion cascade |
| [Email Notifications](architecture/email-notifications.md) | SES architecture, all email types, event sources, bounce handling, user preferences, SES limits |
| [Infrastructure](architecture/infra.md) | AWS resources, Cognito + SES configuration, naming conventions, isolation strategy, local dev |
| [API Flows](architecture/api-flows.md) | Every `/api/*` endpoint, request/response shape, auth header requirements |
| [Feature Logic](architecture/features.md) | How each major feature works — drawer, notes, kanban, split pane |

All architecture pages use GitHub-native Mermaid so the diagrams render directly
in the repository UI without extra tooling.

### Decisions & Planning

| Doc | What it covers |
|-----|---------------|
| [Decision Log](decisions/log.md) | All ADRs — Cognito, multi-tenancy, SES, CCPA scope, custom auth UI, and historical UI decisions |
| [Roadmap](roadmap/README.md) | What was built (waves 1–3), what's next (wave 4), what's pending for production |

### Compliance

| Doc | What it covers |
|-----|---------------|
| [CCPA Compliance Guide](compliance/ccpa.md) | Personal info collected, user rights (Know, Delete, Opt-Out, Non-Discrimination), data retention, export endpoint, implementation checklist |
| [SOC2 Type I Controls Mapping](compliance/soc2.md) | TSC criteria (CC6, A1, C1) mapped to Career Jump controls, gaps to address, evidence collection guide, 6-month audit timeline |

### Operations

| Doc | What it covers |
|-----|---------------|
| [Deploy Guide](DEPLOY.md) | Build, version, deploy to AWS, A/B switch |
| [Release Runbook](RELEASE_RUNBOOK.md) | Step-by-step release checklist for Dipak |

---

## State of the Project

```
career-jump (Cloudflare)  ──────  Live production MVP. DO NOT TOUCH.
career-jump-aws           ──────  Backend. Active, deployed, API is live.
career-jump-web (this)    ──────  Multi-tenant SaaS React UI. Auth integrated. Deploying to AWS.
```

Career Jump has evolved from a single-user personal tool to a multi-tenant SaaS platform. The architecture now supports multiple isolated user accounts, each scoped to their own Cognito sub UUID and DynamoDB key prefix.

**Current status:**
- Cognito authentication is fully designed and documented (signup, login, refresh, forgot password)
- Multi-tenant data isolation is implemented (DynamoDB key prefix per user)
- Amazon SES email notification system is designed and ready to deploy
- CCPA compliance controls are in place (data export endpoint, account deletion cascade)
- SOC2 Type I target: Q4 2026

**What's still needed to go fully live:**
1. `VITE_API_BASE_URL` set to the Lambda Function URL
2. Cognito client ID / User Pool ID set as Vite env vars
3. Auth context wired into TanStack Router (route guards active)
4. Deployed to `cj-web-static-poc-<acct>` S3 + `cj-web-cdn-poc` CloudFront
5. Error handling for real API failures
6. SES domain verified and production access requested
7. SOC2 gap remediation (see `docs/compliance/soc2.md`)

---

## Why No ATS Files Here?

ATS scraping (Greenhouse, Lever, Ashby, Workday, etc.) is a **backend concern**. The ATS adapters live in `career-jump-aws/src/ats/`. The React app never touches ATS logic — it consumes the normalized job data the backend produces via `/api/jobs`. The 16+ ATS adapters are invisible to the frontend.

---

## Getting Started (Local Dev)

```bash
cd ~/career-jump-web
npm install
npm run dev
# Open http://localhost:5173/?demo=1
```

Everything works in mock mode — no backend required.
