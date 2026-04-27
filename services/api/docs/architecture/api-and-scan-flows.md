# API And Scan Flows

## High-Level API Surface

The browser is served by CloudFront/S3. API calls go directly to the Lambda Function URL carrying a Cognito ID token.

### Product Routes
| Route | Description |
| --- | --- |
| `/` | Main dashboard and job workflow |
| `/logs.html` | Compact operational logs |
| `/docs` | Swagger/OpenAPI documentation |

### API Routes
| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check (public, no auth) |
| `GET` | `/api/dashboard` | Dashboard summary |
| `GET` | `/api/jobs` | Available jobs inventory |
| `GET` | `/api/applied-jobs` | Applied jobs list |
| `POST` | `/api/run` | Trigger a manual scan |
| `GET` | `/api/run/status` | Current run progress |
| `POST` | `/api/run/abort` | Abort active run |
| `GET` | `/api/config` | Runtime configuration |
| `POST` | `/api/config/save` | Save runtime configuration |
| `POST` | `/api/companies/:name/toggle` | Toggle company enabled state |
| `POST` | `/api/companies/toggle-all` | Toggle all companies |
| `POST` | `/api/jobs/status` | Update job status |
| `POST` | `/api/jobs/apply` | Move job to Applied |
| `POST` | `/api/jobs/notes` | Save job notes |
| `POST` | `/api/jobs/discard` | Discard job (stores footprint key) |
| `POST` | `/api/jobs/remove-broken-links` | Remove broken link jobs |
| `GET` | `/api/logs` | Application logs (compact or raw) |
| `GET` | `/api/openapi.json` | OpenAPI spec |

---

## Browser Auth Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User Browser
    participant CF as ☁ CloudFront
    participant S3 as ◼ S3
    participant Cognito as ◉ Cognito
    participant API as λ Lambda API

    User->>CF: GET / (HTTPS)
    CF->>S3: Fetch static assets (OAC signed)
    S3-->>User: index.html · app.js · styles.css · aws-config.js
    Note over User: App initialises, checks for stored tokens
    User->>Cognito: Redirect to Hosted UI (PKCE · code_challenge)
    Cognito-->>User: Login page
    User->>Cognito: Submit credentials
    Cognito-->>User: Redirect with authorization code
    User->>Cognito: Exchange code for tokens (PKCE · code_verifier)
    Cognito-->>User: ID token · access token · refresh token
    User->>API: API request + Authorization: Bearer {id_token}
    API->>Cognito: Verify ID token signature + claims
    API-->>User: JSON response
```

---

## Parallel Scan Flow

![Scan Fanout](./diagrams/scan-fanout.svg)

### Sequence Detail

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 Browser
    participant API as λ API
    participant DDB as ◈ DynamoDB
    participant Orch as λ Orchestrator
    participant Scanner as λ Scanner ×N
    participant ATS as 🌐 ATS Providers
    participant Final as λ Finalizer
    participant Apps as 📧 Apps Script

    User->>API: POST /api/run
    API->>Orch: Async invoke
    API-->>User: 202 Accepted + runId
    Orch->>DDB: Acquire active run lock
    Orch->>DDB: Write run metadata
    par One invoke per enabled company
        Orch->>Scanner: Invoke (company A)
        Orch->>Scanner: Invoke (company B)
        Orch->>Scanner: Invoke (company N...)
    end
    par Each scanner independently
        Scanner->>ATS: HTTPS fetch company jobs
        ATS-->>Scanner: Raw job postings
        Scanner->>DDB: Write company result fragment
        Scanner->>DDB: Increment completed/failed counter
    end
    Scanner->>Final: Last company done triggers finalizer
    Final->>DDB: Merge company fragments
    Final->>DDB: Apply discard key list
    Final->>DDB: Save available inventory snapshot
    Final->>Apps: POST email webhook (new + updated jobs)
    Final->>DDB: Release active run lock
    Note over User: Dashboard refreshes via polling
```

---

## Frontend Run Progress Flow

```mermaid
sequenceDiagram
    autonumber
    actor UI as 🖥 Dashboard UI
    participant API as λ Lambda API
    participant DDB as ◈ DynamoDB

    UI->>API: POST /api/run
    API-->>UI: 202 + runId
    Note over UI: Progress bar shown at 0 / N companies
    loop While run is active
        UI->>API: GET /api/logs?compact=false
        API->>DDB: Load recent app log events
        DDB-->>API: Progress events
        API-->>UI: company_scan_completed rows (current / total)
        UI->>UI: Update progress bar + detail text
    end
    API-->>UI: run_completed event
    UI->>UI: Show 100% · final summary briefly
    UI->>API: Refresh /api/dashboard and /api/jobs
    API-->>UI: Updated inventory
```

---

## Logs Flow

```mermaid
sequenceDiagram
    autonumber
    participant LogsPage as 🗒 /logs.html
    participant API as λ Lambda API
    participant DDB as ◈ DynamoDB

    LogsPage->>API: GET /api/logs?compact=true
    API->>DDB: Load app logs (last 6h via TTL)
    DDB-->>API: Raw log events
    API->>API: Compact: one row per company per run
    API->>API: Include: scan_started · company_scan_summary · errors
    API-->>LogsPage: Compact company summaries with counts and diffs
    Note over LogsPage: One row = company · ATS · new/updated/discarded counts
```

---

## Job Lifecycle

![Job Lifecycle](./diagrams/job-lifecycle.svg)

### State Transition Summary

| From | To | Trigger |
| --- | --- | --- |
| Fetched (raw) | Available | Passes title + geography + source filters |
| Fetched (raw) | Filter Discard | Title or geography filter fails |
| Available | Applied | User clicks Apply |
| Available | User Discarded | User clicks Discard — key stored, auto-skipped next scans |
| Available | Removed | Broken link or job missing from subsequent scan |
| Applied | Interview | User changes status to Interview |
| Interview | Action Plan | Interview round recorded |

### Storage Invariants

- `Available` jobs: stored only while currently matched and returned by the ATS.
- `Applied` jobs: preserved indefinitely across scans.
- `User Discarded` key: stored in `runtime:discarded_job_keys`; auto-skips on all future scans, dashboard, and email.
- `Filter Discards` and `Removals`: counted by reason only — no job record persisted.
- Notes: travel with the job from Available → Applied → Action Plan.
- App logs and decision summaries: DynamoDB TTL of 6 hours.

---

## Reliability Rules

| Rule | Mechanism |
| --- | --- |
| No overlapping inventory writes | One active run lock per tenant in DynamoDB |
| Slow company never blocks the run | Each Scanner Lambda is independent; fanout is parallel |
| Finalization is atomic | Finalizer runs only after all expected companies complete or fail |
| Progress always visible | Raw logs available via `compact=false` during 6h DynamoDB TTL |
| Paused companies preserved | Finalizer carries forward paused-company inventory untouched |
| Discard footprint persists | User discard keys survive scan cycles; auto-excluded from logs, dashboard, and email |
