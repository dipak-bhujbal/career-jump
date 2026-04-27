# Observability and Logging Architecture

Career Jump AWS POC — v2.2.x

All four Lambda functions emit structured JSON logs to dedicated Amazon CloudWatch Log Groups.
This document specifies the full observability layer: log groups, log schemas, metric filters,
alarm targets, and the two-tier logging model (CloudWatch for Lambda errors; DynamoDB for
application-level run logs).

---

## Full Observability Overview

```mermaid
flowchart TB
    subgraph Browser["User Browser"]
        ui["Browser / SPA"]
    end

    subgraph Edge["AWS Edge — CloudFront + S3"]
        cf["Amazon CloudFront\n[Access Logs → S3 bucket optional]"]
        s3["Amazon S3\nFrontendBucket"]
    end

    subgraph Auth["Authentication — Amazon Cognito"]
        pool["Cognito User Pool"]
        hosted["Cognito Hosted UI\nCognito User Pool Domain"]
    end

    subgraph Compute["Serverless Compute — AWS Lambda"]
        api["API Lambda\n/aws/lambda/career-jump-aws-poc-api\nCloudWatch Logs — JSON — 1d TTL"]
        orch["Orchestrator Lambda\n/aws/lambda/career-jump-aws-poc-run-orchestrator\nCloudWatch Logs — JSON — 1d TTL"]
        scan["Scan Company Lambda × N\n/aws/lambda/career-jump-aws-poc-scan-company\nCloudWatch Logs — JSON — 1d TTL"]
        final["Finalize Run Lambda\n/aws/lambda/career-jump-aws-poc-finalize-run\nCloudWatch Logs — JSON — 1d TTL"]
    end

    subgraph State["Runtime State — Amazon DynamoDB"]
        table["DynamoDB: career-jump-aws-poc-state\nApp logs: KV#JOB_STATE runtime:applog:*\n6-hour TTL\nDecision summaries: runtime:decision-summary:*\n6-hour TTL"]
    end

    subgraph Scheduler["Scheduled Triggers — Amazon EventBridge Scheduler"]
        sched["EventBridge Scheduler\n[DISABLED — future use]"]
    end

    subgraph Observability["Observability — Amazon CloudWatch"]
        cw_api["Log Group\n/aws/lambda/career-jump-aws-poc-api\n1-day retention"]
        cw_orch["Log Group\n/aws/lambda/career-jump-aws-poc-run-orchestrator\n1-day retention"]
        cw_scan["Log Group\n/aws/lambda/career-jump-aws-poc-scan-company\n1-day retention"]
        cw_final["Log Group\n/aws/lambda/career-jump-aws-poc-finalize-run\n1-day retention"]
        mf_err["Metric Filter\nERROR count per function"]
        alarm["CloudWatch Alarm\n→ Email via SNS (future)"]
    end

    subgraph Budget["Cost Guardrail"]
        budget["AWS Budgets\n$5/month\nAlert at 60% and 100%"]
    end

    ui -->|HTTPS| cf
    cf --> s3
    ui -->|PKCE OAuth| pool
    pool --> hosted
    ui -->|Bearer ID token| api
    api -->|async invoke| orch
    orch -->|fan-out invoke| scan
    scan -->|invoke when last| final
    api --> table
    orch --> table
    scan --> table
    final --> table
    sched -->|cron invoke| orch

    api -->|JSON logs| cw_api
    orch -->|JSON logs| cw_orch
    scan -->|JSON logs| cw_scan
    final -->|JSON logs| cw_final

    cw_api --> mf_err
    cw_orch --> mf_err
    cw_scan --> mf_err
    cw_final --> mf_err
    mf_err --> alarm
    budget -->|alert email| ui
```

---

## CloudWatch Log Groups

| Log Group | Lambda | Retention | Log Format |
|-----------|--------|-----------|------------|
| `/aws/lambda/career-jump-aws-poc-api` | API | 1 day | JSON |
| `/aws/lambda/career-jump-aws-poc-run-orchestrator` | Orchestrator | 1 day | JSON |
| `/aws/lambda/career-jump-aws-poc-scan-company` | Scan Company | 1 day | JSON |
| `/aws/lambda/career-jump-aws-poc-finalize-run` | Finalize Run | 1 day | JSON |

All log groups are defined explicitly in `template.yaml` so CloudFormation owns their lifecycle and retention policy.

---

## Two-Tier Logging Model

```mermaid
flowchart LR
    subgraph LambdaRuntime["Lambda Runtime Events"]
        start["INIT / REPORT / timeout\ncold start duration\nbilled duration\nmemory used"]
        error["unhandled exceptions\nstack traces\nSDK errors"]
    end

    subgraph AppLogs["Application Events"]
        run["run_started\nrun_completed\nrun_aborted"]
        company["company_scan_start\ncompany_scan_done\ncompany_scan_failed"]
        inventory["inventory_updated\nnew_job_found\njob_removed"]
        notify["email_sent\nemail_skipped\nemail_failed"]
    end

    subgraph Destinations["Log Destinations"]
        cw["Amazon CloudWatch Logs\n1-day retention\nfor Lambda runtime faults"]
        ddb["Amazon DynamoDB\nruntime:applog:*\n6-hour TTL\nfor in-app progress + UI polling"]
    end

    LambdaRuntime --> cw
    AppLogs --> ddb
    AppLogs -.->|errors and exceptions also| cw
```

**Rule**: Lambda runtime telemetry (cold starts, timeouts, OOM, unhandled exceptions) lives in CloudWatch.
Application-level business events (scan progress, inventory diffs, job counts) live in DynamoDB with 6-hour TTL so the browser can poll them via `/api/logs`.

---

## Structured Log Schema

All Lambda functions use `LogFormat: JSON` (set in `template.yaml` `LoggingConfig`). The Lambda runtime wraps each `console.log` / `console.error` output as:

```json
{
  "timestamp": "2026-04-23T08:00:00.000Z",
  "level": "INFO",
  "requestId": "abc-123",
  "message": "...",
  "xRayTraceId": "Root=1-..."
}
```

Application-level log entries written to DynamoDB follow this shape:

```json
{
  "type": "company_scan_done",
  "runId": "run-2026-04-23T08:00:00.000Z",
  "company": "stripe",
  "fetched": 42,
  "matched": 8,
  "new": 2,
  "updated": 1,
  "discarded": 34,
  "durationMs": 4200,
  "timestamp": "2026-04-23T08:00:04.200Z"
}
```

---

## Scan Run Observability Flow

```mermaid
sequenceDiagram
    participant Browser
    participant API as API Lambda\n[CW: /aws/lambda/...-api]
    participant DDB as DynamoDB
    participant Orch as Orchestrator Lambda\n[CW: /aws/lambda/...-run-orchestrator]
    participant Scan as Scan Company Lambda × N\n[CW: /aws/lambda/...-scan-company]
    participant ATS as ATS Providers
    participant Final as Finalize Run Lambda\n[CW: /aws/lambda/...-finalize-run]
    participant CW as CloudWatch Logs

    Browser->>API: POST /api/run
    API->>CW: LOG run_trigger_received {runId, userId}
    API->>DDB: write run_started applog
    API->>Orch: async invoke
    API-->>Browser: 202 {runId}

    Orch->>CW: LOG orchestrator_started {runId, companyCount}
    Orch->>DDB: acquire run lock + write run metadata
    Orch->>Scan: invoke per company (concurrent)

    par each enabled company
        Scan->>CW: LOG scan_started {runId, company}
        Scan->>ATS: fetch jobs
        ATS-->>Scan: raw postings
        Scan->>DDB: write company fragment + applog
        Scan->>CW: LOG scan_done {runId, company, fetched, matched, durationMs}
    end

    Scan->>Final: invoke (last company triggers finalization)
    Final->>CW: LOG finalize_started {runId}
    Final->>DDB: merge fragments → inventory
    Final->>DDB: write run_completed applog
    Final->>CW: LOG finalize_done {runId, totalNew, totalMatched}
    Final->>DDB: release run lock

    loop UI polling
        Browser->>API: GET /api/logs
        API->>DDB: read applog:* entries
        API-->>Browser: progress events
    end
```

---

## CloudWatch Metric Filters (Recommended)

These metric filters can be added to `template.yaml` to surface error counts without a third-party APM tool.

| Filter Name | Log Group | Filter Pattern | Metric Namespace | Metric Name |
|-------------|-----------|----------------|-----------------|-------------|
| `ApiErrorCount` | `/aws/lambda/career-jump-aws-poc-api` | `{ $.level = "ERROR" }` | `CareerJump/Lambda` | `ApiErrors` |
| `OrchestratorErrorCount` | `/aws/lambda/career-jump-aws-poc-run-orchestrator` | `{ $.level = "ERROR" }` | `CareerJump/Lambda` | `OrchestratorErrors` |
| `ScanErrorCount` | `/aws/lambda/career-jump-aws-poc-scan-company` | `{ $.level = "ERROR" }` | `CareerJump/Lambda` | `ScanErrors` |
| `FinalizeErrorCount` | `/aws/lambda/career-jump-aws-poc-finalize-run` | `{ $.level = "ERROR" }` | `CareerJump/Lambda` | `FinalizeErrors` |

> Alarm threshold: any error count > 0 in a 5-minute window → SNS email (uses `BudgetEmail` parameter for low-cost single-subscriber setup).

---

## CloudWatch Alarm Flow (Future Addition)

```mermaid
flowchart LR
    cw_scan["CloudWatch Logs\n/aws/lambda/...-scan-company"]
    mf["MetricFilter\nScanErrors\nCareerJump/Lambda namespace"]
    alarm["CloudWatch Alarm\nScanErrors > 0\n5-minute period"]
    sns["Amazon SNS Topic\n[future resource]"]
    email["Email Notification\n→ dipak.bhujbal23@gmail.com"]

    cw_scan --> mf
    mf --> alarm
    alarm --> sns
    sns --> email
```

> Not yet deployed — cost is negligible (SNS email is free-tier). Add when scheduled scans are enabled.

---

## EventBridge Scheduler + CloudWatch Integration

```mermaid
flowchart TB
    sched_weekday["EventBridge Schedule\nWeekdayBusinessHours\ncron(0 9,12,15,18,21 ? * MON-FRI *)\nState: DISABLED"]
    sched_evening["EventBridge Schedule\nLateEveningSpillover\ncron(0 0,3 ? * TUE-SAT *)\nState: DISABLED"]
    orch["Orchestrator Lambda"]
    cw_orch["CloudWatch Logs\n/aws/lambda/...-run-orchestrator\n1-day retention"]
    eb_logs["EventBridge Scheduler\nDelivery Logs\n[optional — not yet provisioned]"]

    sched_weekday -->|invoke when enabled| orch
    sched_evening -->|invoke when enabled| orch
    orch --> cw_orch
    sched_weekday -.->|delivery status| eb_logs
    sched_evening -.->|delivery status| eb_logs
```

> EventBridge Scheduler delivery logs (failed invocations) can be directed to a separate log group when scheduled scans are activated.

---

## DynamoDB App Log Key Schema

```mermaid
flowchart TB
    subgraph DDB["DynamoDB: career-jump-aws-poc-state"]
        applog["pk = KV#JOB_STATE\nsk = runtime:applog:{runId}:{timestamp}:{companyId}\ntype: run_started | company_scan_done | run_completed | email_sent\nexpiresAtEpoch: now + 6h TTL"]
        decision["pk = KV#JOB_STATE\nsk = runtime:decision-summary:{runId}:{companyId}\ntype: decision_summary\nfetched, matched, new, updated, discarded counts\nexpiresAtEpoch: now + 6h TTL"]
        runmeta["pk = RUN#{runId}\nsk = META\nexpected, completed, failed company counts\nrun lock fields"]
    end
```

---

## Implementation Checklist for @codex

> The following items are either already in place or are recommended additions. Items marked ✅ are shipped. Items marked 🔲 are architect-specified additions.

| # | Item | Status | File / Resource |
|---|------|--------|----------------|
| 1 | JSON log format on all four Lambdas | ✅ | `template.yaml` `LoggingConfig` |
| 2 | Explicit log group resources with 1-day retention | ✅ | `ApiLogGroup`, `RunOrchestratorLogGroup`, `ScanCompanyLogGroup`, `FinalizeRunLogGroup` in `template.yaml` |
| 3 | App-level run logs written to DynamoDB with 6h TTL | ✅ | `src/aws/` handlers, `src/lib/` |
| 4 | `/api/logs` route for browser polling | ✅ | `src/routes.ts` |
| 5 | CloudWatch Metric Filters for ERROR counts | 🔲 | Add `AWS::Logs::MetricFilter` resources to `template.yaml` |
| 6 | CloudWatch Alarm → SNS → email on scan errors | 🔲 | Add `AWS::CloudWatch::Alarm` + `AWS::SNS::Topic` to `template.yaml` |
| 7 | EventBridge Scheduler delivery log group | 🔲 | Add when schedules are enabled |
| 8 | Structured log helper in `src/lib/` | 🔲 | Add `logger.ts` with typed `log(level, event, payload)` helper that writes to both `console.log` (CloudWatch) and DynamoDB applog |
