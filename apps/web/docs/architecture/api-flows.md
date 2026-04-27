# API Flows

All endpoints are on the API Lambda Function URL. Auth: `Authorization: Bearer <cognito-id-token>` on every request. In mock mode (`?demo=1`), all calls are intercepted client-side.

---

## End-to-End Request Path

```mermaid
sequenceDiagram
    participant UI as React route
    participant API as src/lib/api.ts
    participant Auth as src/lib/auth.ts
    participant URL as Lambda Function URL
    participant Lambda as API Lambda
    participant Store as DynamoDB / backend storage

    UI->>API: query or mutation
    API->>Auth: getValidIdToken()
    Auth-->>API: Cognito ID token
    API->>URL: fetch /api/* with Authorization header
    URL->>Lambda: invoke handler
    Lambda->>Store: scoped read/write
    Store-->>Lambda: data
    Lambda-->>UI: { ok, ...payload }
```

## API Surface Map

```mermaid
flowchart TB
    Client["React client"]
    Auth["Auth + tenant context"]
    Jobs["Jobs endpoints"]
    Applied["Applied pipeline endpoints"]
    Plan["Interview/action plan endpoints"]
    Config["Configuration endpoints"]
    Registry["Registry endpoints"]
    Run["Run control endpoints"]
    User["User/self-service endpoints"]

    Client --> Auth
    Auth --> Jobs
    Auth --> Applied
    Auth --> Plan
    Auth --> Config
    Auth --> Registry
    Auth --> Run
    Auth --> User
```

## Authentication and Authorization Flow

```mermaid
sequenceDiagram
    participant Browser
    participant Cognito
    participant ApiClient
    participant ApiLambda
    participant Tenant as Tenant Resolver

    Browser->>Cognito: Sign in / refresh session
    Cognito-->>Browser: ID token with sub/email claims
    Browser->>ApiClient: User action
    ApiClient->>ApiLambda: Authorization: Bearer <id-token>
    ApiLambda->>Tenant: validate token + resolve tenant
    Tenant-->>ApiLambda: tenantId=sub, user metadata
    ApiLambda-->>Browser: scoped response
```

## Available Jobs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List available jobs. Query params: `keyword`, `location`, `company[]`, `newOnly`, `updatedOnly`, `limit`, `offset` |
| POST | `/api/jobs/apply` | Move job to applied pipeline. Body: `{ jobKey, notes? }` |
| POST | `/api/jobs/discard` | Remove job from available list. Body: `{ jobKey }` |
| POST | `/api/jobs/notes` | Save legacy single-string notes. Body: `{ jobKey, notes }` |
| POST | `/api/notes/add` | Add a note record. Body: `{ jobKey, text }` → returns `{ ok, record }` |
| POST | `/api/notes/update` | Edit a note record. Body: `{ jobKey, noteId, text }` |
| POST | `/api/notes/delete` | Delete a note record. Body: `{ jobKey, noteId }` |
| POST | `/api/jobs/manual-add` | Manually add a job. Body: `{ company, jobTitle, url?, location?, notes? }` |

### Available Jobs Sequence

```mermaid
sequenceDiagram
    participant UI as Jobs page
    participant API as API Lambda
    participant DB as Backend storage

    UI->>API: GET /api/jobs?keyword=&location=&company[]=
    API->>DB: load tenant-scoped inventory
    DB-->>API: jobs + pagination + counts
    API-->>UI: available jobs payload
```

## Applied Jobs & Pipeline

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/applied-jobs` | List all applied jobs with status, rounds, timeline |
| POST | `/api/jobs/status` | Update pipeline status. Body: `{ jobKey, status }` — one of Applied/Interview/Negotiations/Offered/Rejected |

### Status Change Sequence

```mermaid
sequenceDiagram
    participant UI as Applied / Kanban UI
    participant API as API Lambda
    participant DB as Backend storage
    participant SNS as Notification topic

    UI->>API: POST /api/jobs/status
    API->>DB: update applied record
    API->>DB: append timeline event
    API-->>UI: updated job state
    opt notifications enabled
        API->>SNS: publish status_update event
    end
```

## Interview Rounds (Action Plan)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/action-plan` | List jobs on action plan with interview rounds |
| POST | `/api/rounds/add` | Add interview round. Body: `{ jobKey, number }` |
| POST | `/api/rounds/update` | Update round fields. Body: `{ jobKey, roundId, designation?, scheduledAt?, outcome?, notes? }` |
| POST | `/api/rounds/delete` | Delete a round. Body: `{ jobKey, roundId }` |

### Action Plan Sequence

```mermaid
sequenceDiagram
    participant UI as Action Plan page
    participant API as API Lambda
    participant DB as Backend storage

    UI->>API: POST /api/rounds/add or /update or /delete
    API->>DB: mutate tenant-scoped interview rounds
    API->>DB: rewrite timeline snapshot
    API-->>UI: latest action plan row
```

## Dashboard

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | KPIs: pipeline counts, stage breakdown, last run time |

## Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Load runtime config: tracked companies, title filters |
| POST | `/api/config` | Save runtime config |
| POST | `/api/companies/toggle` | Pause/resume a company's scan. Body: `{ company, paused }` |
| POST | `/api/companies/toggle-all` | Pause/resume all scans |

### Configuration Save Flow

```mermaid
sequenceDiagram
    participant UI as Configuration page
    participant API as API Lambda
    participant DB as Config store

    UI->>API: POST /api/config
    API->>API: sanitize companies + filters
    API->>DB: save tenant config
    API-->>UI: saved config envelope
```

## Registry (Company Discovery)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/registry/meta` | Registry metadata: total companies, ATS breakdown |
| GET | `/api/registry/companies` | Search registry. Query: `q`, `ats`, `tier`, `limit` |
| GET | `/api/registry/companies/:key` | Get single company entry |

## Scan Run

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/run` | Trigger a fresh scan (async, returns immediately) |
| GET | `/api/run/status` | Poll run status: active, fetched, total, percent |
| POST | `/api/jobs/remove-broken-links` | Clean up stale job URLs |

### Run Trigger and Polling Flow

```mermaid
sequenceDiagram
    participant UI as Topbar / Run button
    participant API as API Lambda
    participant OR as Orchestrator Lambda
    participant DB as Backend storage

    UI->>API: POST /api/run
    API->>OR: invoke async
    API-->>UI: { ok, runId, active }
    loop while active
        UI->>API: GET /api/run/status
        API->>DB: read run state
        API-->>UI: progress snapshot
    end
```

## Cache & State Management

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/jobs/clear` | Clear available jobs + ATS cache |
| POST | `/api/cache/clear-ats` | Clear ATS cache only |

---

## Response Envelope

All responses return `{ ok: boolean, ...data }`. Errors return `{ ok: false, error: string }` with an appropriate HTTP status code.

## Resource Model

```mermaid
classDiagram
    class RuntimeConfig {
      companies[]
      jobtitles
      updatedAt
    }
    class Job {
      jobKey
      company
      jobTitle
      url
      isNew
      isUpdated
    }
    class AppliedJob {
      jobKey
      status
      appliedAt
      interviewRounds[]
      timeline[]
    }
    class SavedFilter {
      id
      name
      scope
      filter
      isDefault
    }
    class UserPreferences {
      newJobsAlert
      weeklyDigest
      statusUpdate
    }

    AppliedJob --> Job
```

---

## Frontend ↔ Backend Contract

The React app (`career-jump-web`) is built against this API contract. The mock interceptor in `src/mocks/install.ts` implements the same contract using in-memory state, allowing full UI development without a running backend.

To connect to the real backend, set `VITE_API_BASE_URL` at build time — the `api` client in `src/lib/api.ts` prepends this to all requests.
