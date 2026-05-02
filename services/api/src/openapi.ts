const jobPostingSchema = {
  type: "object",
  required: ["source", "company", "id", "title", "location", "url"],
  properties: {
    source: { type: "string", enum: ["greenhouse", "ashby", "smartrecruiters", "workday", "lever"] },
    company: { type: "string" },
    id: { type: "string" },
    title: { type: "string" },
    location: { type: "string" },
    url: { type: "string", format: "uri" },
    postedAt: { type: "string", format: "date-time", nullable: true },
    postedAtSource: { type: "string", enum: ["ats", "identified_fallback", "legacy"], nullable: true },
    identifiedAt: { type: "string", format: "date-time", nullable: true },
    detectedCountry: { type: "string", nullable: true },
    isUSLikely: { type: "boolean", nullable: true },
    matchedKeywords: { type: "array", items: { type: "string" } },
  },
};

const appLogSchema = {
  type: "object",
  required: ["id", "event", "timestamp", "level", "message"],
  properties: {
    id: { type: "string" },
    event: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    level: { type: "string", enum: ["info", "warn", "error"] },
    message: { type: "string" },
    route: { type: "string", nullable: true },
    company: { type: "string", nullable: true },
    source: { type: "string", nullable: true },
    runId: { type: "string", nullable: true },
    details: {
      type: "object",
      additionalProperties: true,
      description: "Structured metadata persisted with the log entry. Company scan logs include counts plus detailed new and updated job lists.",
    },
  },
};

const runtimeConfigSchema = {
  type: "object",
  required: ["companies", "jobtitles", "updatedAt"],
  properties: {
    companies: {
      type: "array",
      items: {
        type: "object",
        required: ["company"],
        properties: {
          company: { type: "string" },
          aliases: { type: "array", items: { type: "string" } },
          enabled: { type: "boolean" },
          source: { type: "string", nullable: true },
          sampleUrl: { type: "string", nullable: true },
          boardToken: { type: "string", nullable: true },
          companySlug: { type: "string", nullable: true },
          smartRecruitersCompanyId: { type: "string", nullable: true },
          leverSite: { type: "string", nullable: true },
          workdayBaseUrl: { type: "string", nullable: true },
          host: { type: "string", nullable: true },
          tenant: { type: "string", nullable: true },
          site: { type: "string", nullable: true },
        },
      },
    },
    jobtitles: {
      type: "object",
      required: ["includeKeywords", "excludeKeywords"],
      properties: {
        includeKeywords: { type: "array", items: { type: "string" } },
        excludeKeywords: { type: "array", items: { type: "string" } },
      },
    },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const savedFilterSchema = {
  type: "object",
  required: ["id", "name", "scope", "filter", "isDefault", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    tenantId: { type: "string", nullable: true },
    name: { type: "string" },
    scope: { type: "string", enum: ["available_jobs", "applied_jobs", "dashboard", "logs"] },
    filter: { type: "object", additionalProperties: true },
    createdByUserId: { type: "string", nullable: true },
    isDefault: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

const appliedJobSchema = {
  type: "object",
  required: ["jobKey", "job", "appliedAt", "status", "interviewRounds", "timeline"],
  properties: {
    jobKey: { type: "string" },
    job: jobPostingSchema,
    appliedAt: { type: "string", format: "date-time" },
    status: { type: "string", enum: ["Applied", "Interview", "Rejected", "Negotiations", "Offered"] },
    interviewRounds: { type: "array", items: { type: "object", additionalProperties: true } },
    timeline: { type: "array", items: { type: "object", additionalProperties: true } },
    lastStatusChangedAt: { type: "string", format: "date-time", nullable: true },
  },
};

const planConfigSchema = {
  type: "object",
  required: ["plan", "displayName", "scanCacheAgeHours", "canTriggerLiveScan", "maxSessions", "maxEmailsPerWeek", "enabledFeatures", "updatedAt", "updatedBy"],
  properties: {
    plan: { type: "string", enum: ["free", "starter", "pro", "power"] },
    displayName: { type: "string" },
    scanCacheAgeHours: { type: "number" },
    canTriggerLiveScan: { type: "boolean" },
    maxCompanies: { type: "integer", nullable: true },
    maxSessions: { type: "integer" },
    maxVisibleJobs: { type: "integer", nullable: true },
    maxAppliedJobs: { type: "integer", nullable: true },
    emailNotificationsEnabled: { type: "boolean" },
    weeklyDigestEnabled: { type: "boolean" },
    maxEmailsPerWeek: { type: "integer" },
    enabledFeatures: { type: "array", items: { type: "string" } },
    updatedAt: { type: "string", format: "date-time" },
    updatedBy: { type: "string" },
  },
};

const stripeConfigPublicSchema = {
  type: "object",
  properties: {
    publishableKey: { type: "string" },
    webhookConfigured: { type: "boolean" },
    priceIds: {
      type: "object",
      properties: {
        starter: { type: "string", nullable: true },
        pro: { type: "string", nullable: true },
        power: { type: "string", nullable: true },
      },
    },
    updatedAt: { type: "string", format: "date-time", nullable: true },
  },
};

const billingSubscriptionSchema = {
  type: "object",
  properties: {
    plan: { type: "string", enum: ["free", "starter", "pro", "power"] },
    status: { type: "string", enum: ["active", "trialing", "canceled"] },
    provider: { type: "string" },
    stripeCustomerId: { type: "string", nullable: true },
    stripeSubscriptionId: { type: "string", nullable: true },
    currentPeriodEnd: { type: "string", format: "date-time", nullable: true },
    updatedAt: { type: "string", format: "date-time" },
  },
};

export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Career Jump API",
      version: "3.0.0",
      description: [
        "Operational API for Career Jump AWS, a low-cost AWS serverless application that scans ATS providers, filters target roles, tracks application pipeline state, and stores runtime state in DynamoDB.",
        "",
        "Authentication model:",
        "- Browser users sign in through Cognito hosted UI and call the Lambda Function URL with a Cognito ID token.",
        "- Browser sessions authenticate through Access.",
        "",
        "Data model highlights:",
        "- DynamoDB is the active runtime store for configuration, available inventory, applied jobs, logs, and saved filters.",
        "- Available inventory stores only jobs that pass the current filters; discarded fetched jobs are summarized by reason instead of persisted.",
        "- App logs and temporary scan decision summaries expire after six hours through DynamoDB TTL.",
        "- The logs API defaults to one compact company row per run with counts and updated-job diffs; pass compact=false for raw scan progress rows.",
      ].join("\n"),
    },
    servers: [{ url: baseUrl, description: "Current environment origin" }],
    security: [{ CloudflareAccessIdentity: [] }],
    tags: [
      { name: "services", description: "Health, docs, and operational scan endpoints" },
      { name: "config", description: "Tenant runtime configuration and reset operations" },
      { name: "jobs", description: "Available inventory, applied jobs, and workflow actions" },
      { name: "filters", description: "Tenant-scoped saved filter management" },
      { name: "logs", description: "Operational logs and audit visibility" },
      { name: "billing", description: "Stripe billing, subscription, and checkout flows" },
      { name: "admin", description: "Super-admin routes — require admin authentication" },
      { name: "debugging", description: "Decision and connector troubleshooting endpoints" },
      { name: "docs", description: "Swagger/OpenAPI assets" },
    ],
    components: {
      securitySchemes: {
        CloudflareAccessIdentity: {
          type: "apiKey",
          in: "header",
          name: "Cf-Access-Authenticated-User-Email",
          description: "Legacy identity header retained for compatibility with the Cloudflare runtime path. AWS browser users authenticate with Cognito instead.",
        },
      },
      schemas: {
        JobPosting: jobPostingSchema,
        AppLogEntry: appLogSchema,
        RuntimeConfig: runtimeConfigSchema,
        SavedFilterRecord: savedFilterSchema,
        AppliedJobRecord: appliedJobSchema,
        HealthResponse: {
          type: "object",
          required: ["ok"],
          properties: {
            ok: { type: "boolean" },
            app: { type: "string", nullable: true },
            env: { type: "string", nullable: true },
            timestamp: { type: "string", format: "date-time", nullable: true },
          },
        },
        DashboardResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            kpis: { type: "object", additionalProperties: true },
            sourcingCoverage: { type: "object", additionalProperties: true },
            conversionRatios: { type: "object", additionalProperties: true },
            stageBreakdown: { type: "object", additionalProperties: true },
            trend: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
        RunResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            runAt: { type: "string", format: "date-time" },
            totalNewMatches: { type: "integer" },
            totalUpdatedMatches: { type: "integer" },
            totalMatched: { type: "integer" },
            totalFetched: { type: "integer" },
            byCompany: { type: "object", additionalProperties: { type: "integer" } },
            emailedJobs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  id: { type: "string" },
                },
              },
            },
            emailedUpdatedJobs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  company: { type: "string" },
                  title: { type: "string" },
                  id: { type: "string" },
                },
              },
            },
            emailStatus: { type: "string", enum: ["sent", "skipped", "failed"] },
            emailError: { type: "string", nullable: true },
            scanMeta: {
              type: "object",
              properties: {
                cacheHits: { type: "integer" },
                liveFetchCompanies: { type: "integer" },
                quotaBlockedCompanies: { type: "array", items: { type: "string" } },
                remainingLiveScansToday: { type: "integer", nullable: true },
                filteredOutCompanies: { type: "integer" },
                filteredOutJobs: { type: "integer" },
              },
            },
          },
        },
        ScanQuotaResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            liveScansUsed: { type: "integer" },
            remainingLiveScansToday: { type: "integer" },
            lastLiveScanAt: { type: "string", format: "date-time", nullable: true },
            date: { type: "string" },
          },
        },
        JobsResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            total: { type: "integer" },
            totals: {
              type: "object",
              properties: {
                availableJobs: { type: "integer" },
                newJobs: { type: "integer" },
                updatedJobs: { type: "integer" },
              },
            },
            jobs: { type: "array", items: { $ref: "#/components/schemas/JobPosting" } },
          },
        },
        AppliedJobsResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            total: { type: "integer" },
            jobs: { type: "array", items: { $ref: "#/components/schemas/AppliedJobRecord" } },
          },
        },
        LogsResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            total: { type: "integer" },
            storage: { type: "string" },
            retentionHours: { type: "integer", nullable: true },
            logs: { type: "array", items: { $ref: "#/components/schemas/AppLogEntry" } },
          },
        },
        FiltersResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            total: { type: "integer" },
            filters: { type: "array", items: { $ref: "#/components/schemas/SavedFilterRecord" } },
          },
        },
        PlanConfig: planConfigSchema,
        StripeConfigPublic: stripeConfigPublicSchema,
        BillingSubscription: billingSubscriptionSchema,
        AnnouncementRecord: {
          type: "object",
          required: ["id", "title", "body", "severity", "active", "dismissible", "activeFrom", "targetPlans", "updatedAt", "updatedBy"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            body: { type: "string" },
            severity: { type: "string", enum: ["info", "warning", "critical"] },
            active: { type: "boolean" },
            dismissible: { type: "boolean" },
            activeFrom: { type: "string", format: "date-time" },
            activeTo: { type: "string", format: "date-time", nullable: true },
            targetPlans: { type: "array", items: { type: "string", enum: ["all", "free", "starter", "pro", "power"] } },
            targetTenantIds: { type: "array", items: { type: "string" }, nullable: true },
            updatedAt: { type: "string", format: "date-time" },
            updatedBy: { type: "string" },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["ok", "error"],
          properties: {
            ok: { type: "boolean", enum: [false] },
            error: { type: "string" },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          tags: ["services"],
          summary: "Health check",
          description: "Returns a simple runtime health response for uptime checks and smoke tests.",
          responses: {
            "200": {
              description: "Healthy response",
              content: { "application/json": { schema: { $ref: "#/components/schemas/HealthResponse" } } },
            },
          },
        },
      },
      "/docs": {
        get: {
          tags: ["docs"],
          summary: "Swagger UI",
          description: "Serves the interactive Swagger UI backed by `/api/openapi.json`.",
          responses: { "200": { description: "Swagger UI HTML" } },
        },
      },
      "/api/openapi.json": {
        get: {
          tags: ["docs"],
          summary: "OpenAPI document",
          responses: { "200": { description: "OpenAPI JSON" } },
        },
      },
      "/api/dashboard": {
        get: {
          tags: ["services"],
          summary: "Get dashboard payload",
          description: "Returns KPI cards, sourcing coverage, conversion ratios, stage breakdown, and trend data for the current workspace.",
          responses: {
            "200": {
              description: "Dashboard payload",
              content: { "application/json": { schema: { $ref: "#/components/schemas/DashboardResponse" } } },
            },
          },
        },
      },
      "/api/run": {
        post: {
          tags: ["services"],
          summary: "Run a fresh scan",
          description: "Performs a full ATS scan for the current workspace, persists inventory state, emits audit logs, and optionally sends notifications.",
          responses: {
            "200": {
              description: "Run summary",
              content: { "application/json": { schema: { $ref: "#/components/schemas/RunResponse" } } },
            },
          },
        },
      },
      "/api/run/abort": {
        post: {
          tags: ["services"],
          summary: "Abort the active scan",
          description: "Clears the active scan lock so a new scan can be started immediately. A displaced older scan will exit once it reaches its next ownership check.",
          responses: {
            "200": {
              description: "Abort summary",
            },
          },
        },
      },
      "/api/run/status": {
        get: {
          tags: ["services"],
          summary: "Get active scan status",
          description: "Returns the current active scan lock, if any, so the UI can recover scan state after a refresh.",
          responses: {
            "200": {
              description: "Active scan state",
            },
          },
        },
      },
      "/api/scan-quota": {
        get: {
          tags: ["services"],
          summary: "Get remaining daily live scan quota",
          description: "Returns the current tenant's daily live-scan usage and remaining quota for the current UTC date.",
          responses: {
            "200": {
              description: "Scan quota summary",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ScanQuotaResponse" },
                },
              },
            },
          },
        },
      },
      "/api/config": {
        get: {
          tags: ["config"],
          summary: "Get runtime configuration",
          responses: {
            "200": {
              description: "Current runtime config",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      config: { $ref: "#/components/schemas/RuntimeConfig" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/config/save": {
        post: {
          tags: ["config"],
          summary: "Save runtime configuration",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RuntimeConfig" },
              },
            },
          },
          responses: { "200": { description: "Configuration saved" } },
        },
      },
      "/api/config/apply": {
        post: {
          tags: ["config"],
          summary: "Apply configuration and rebuild inventory",
          responses: { "200": { description: "Configuration applied and inventory refreshed" } },
        },
      },
      "/api/cache/clear": {
        post: {
          tags: ["config"],
          summary: "Clear inventory cache",
          description: "Clears the hot inventory cache while leaving durable runtime state available for rebuild.",
          responses: { "200": { description: "Cache cleared" } },
        },
      },
      "/api/data/clear": {
        post: {
          tags: ["config"],
          summary: "Clear runtime data",
          description: "Clears runtime inventory state, applied jobs, and first-seen/seen markers.",
          responses: { "200": { description: "Runtime data cleared" } },
        },
      },
      "/api/jobs": {
        get: {
          tags: ["jobs"],
          summary: "Get available jobs",
          description: "Returns available job inventory with optional filtering.",
          parameters: [
            { name: "company", in: "query", schema: { type: "string" }, description: "Optional company filter. Repeat the parameter to match multiple companies." },
            { name: "location", in: "query", schema: { type: "string" } },
            { name: "keyword", in: "query", schema: { type: "string" } },
            { name: "duration", in: "query", schema: { type: "string", example: "3d" } },
            { name: "newOnly", in: "query", schema: { type: "boolean" } },
            { name: "updatedOnly", in: "query", schema: { type: "boolean" } },
            { name: "source", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "Filtered available jobs",
              content: { "application/json": { schema: { $ref: "#/components/schemas/JobsResponse" } } },
            },
          },
        },
      },
      "/api/jobs/remove-broken-links": {
        post: {
          tags: ["jobs"],
          summary: "Remove broken links from inventory",
          description: "Checks currently available jobs and removes confirmed broken links from the available inventory snapshot. Applied jobs are preserved separately.",
          responses: { "200": { description: "Broken-link cleanup summary" } },
        },
      },
      "/api/jobs/apply": {
        post: {
          tags: ["jobs"],
          summary: "Move an available job into the applied pipeline",
          description: "Copies the selected available job into applied-job state, then removes the available-copy from inventory so the job appears in Applied Jobs instead of Available Jobs.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["jobKey"],
                  properties: {
                    jobKey: { type: "string" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Applied state updated" } },
        },
      },
      "/api/jobs/status": {
        post: {
          tags: ["jobs"],
          summary: "Update applied job status",
          description: "Updates an applied job. Moving a job to Interview creates interview-round state, which makes the job appear in Action Plan while preserving the applied record.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["jobKey", "status"],
                  properties: {
                    jobKey: { type: "string" },
                    status: { type: "string", enum: ["Applied", "Interview", "Rejected", "Negotiations", "Offered"] },
                    interviewAt: { type: "string", format: "date-time", nullable: true },
                    outcome: { type: "string", enum: ["Passed", "Failed", "Follow-up", "Pending"], nullable: true },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Applied status updated" } },
        },
      },
      "/api/applied-jobs": {
        get: {
          tags: ["jobs"],
          summary: "Get applied jobs",
          responses: {
            "200": {
              description: "Applied pipeline state",
              content: { "application/json": { schema: { $ref: "#/components/schemas/AppliedJobsResponse" } } },
            },
          },
        },
      },
      "/api/action-plan": {
        get: {
          tags: ["jobs"],
          summary: "Get action plan rows",
          responses: { "200": { description: "Action plan rows" } },
        },
      },
      "/api/action-plan/interview": {
        post: {
          tags: ["jobs"],
          summary: "Update interview date or outcome",
          responses: { "200": { description: "Action plan updated" } },
        },
      },
      "/api/filters": {
        get: {
          tags: ["filters"],
          summary: "List saved filters",
          parameters: [{ name: "scope", in: "query", schema: { type: "string", enum: ["available_jobs", "applied_jobs", "dashboard", "logs"] } }],
          responses: {
            "200": {
              description: "Saved filters",
              content: { "application/json": { schema: { $ref: "#/components/schemas/FiltersResponse" } } },
            },
          },
        },
        post: {
          tags: ["filters"],
          summary: "Create or update a saved filter",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "scope", "filter"],
                  properties: {
                    id: { type: "string", nullable: true },
                    name: { type: "string" },
                    scope: { type: "string", enum: ["available_jobs", "applied_jobs", "dashboard", "logs"] },
                    filter: { type: "object", additionalProperties: true },
                    isDefault: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Saved filter",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      filter: { $ref: "#/components/schemas/SavedFilterRecord" },
                    },
                  },
                },
              },
            },
            "409": {
              description: "Duplicate saved filter name",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
            },
          },
        },
      },
      "/api/filters/{id}": {
        delete: {
          tags: ["filters"],
          summary: "Delete a saved filter",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Filter deleted" }, "404": { description: "Filter not found" } },
        },
      },
      "/api/logs": {
        get: {
          tags: ["logs"],
          summary: "Query operational logs",
          description: "Returns tenant-scoped operational logs from KV.",
          parameters: [
            { name: "event", in: "query", schema: { type: "string" } },
            { name: "query", in: "query", schema: { type: "string" } },
            { name: "level", in: "query", schema: { type: "string", enum: ["info", "warn", "error"] } },
            { name: "route", in: "query", schema: { type: "string" } },
            { name: "company", in: "query", schema: { type: "string" } },
            { name: "source", in: "query", schema: { type: "string" } },
            { name: "runId", in: "query", schema: { type: "string" } },
            { name: "compact", in: "query", schema: { type: "boolean", default: true }, description: "When true, repetitive per-company scan rows are collapsed into run-level summaries." },
            { name: "limit", in: "query", schema: { type: "integer", default: 200, minimum: 1, maximum: 1000 } },
          ],
          responses: {
            "200": {
              description: "Operational log rows",
              content: { "application/json": { schema: { $ref: "#/components/schemas/LogsResponse" } } },
            },
          },
        },
      },
      "/api/debug/webhook-url": {
        get: {
          tags: ["debugging"],
          summary: "Inspect notification configuration",
          responses: { "200": { description: "Webhook debug payload" } },
        },
      },
      "/api/debug/schedule": {
        get: {
          tags: ["debugging"],
          summary: "Inspect active registry scan cadence",
          description: "Returns the registry-level scheduler wake-up cadence plus the hot, warm, and cold scan intervals.",
          responses: { "200": { description: "Schedule debug payload" } },
        },
      },
      "/api/debug/discovery": {
        get: {
          tags: ["debugging"],
          summary: "Inspect ATS discovery mapping for one company",
          parameters: [{ name: "company", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Discovery debug payload" } },
        },
      },
      "/api/debug/discovery/reset": {
        post: {
          tags: ["debugging"],
          summary: "Reset ATS discovery state for one company",
          responses: { "200": { description: "Discovery reset response" } },
        },
      },
      "/api/debug/workday": {
        get: {
          tags: ["debugging"],
          summary: "Debug Workday fetching for one company",
          parameters: [{ name: "company", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Workday debug payload" } },
        },
      },
      "/api/debug/workday-filter": {
        get: {
          tags: ["debugging"],
          summary: "Debug Workday filtering decisions",
          parameters: [{ name: "company", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Workday filter debug payload" } },
        },
      },
      "/api/debug/email": {
        post: {
          tags: ["debugging"],
          summary: "Send a debug email payload",
          responses: { "200": { description: "Debug email sent" } },
        },
      },
      "/api/me": {
        get: {
          tags: ["services"],
          summary: "Get current user session",
          description: "Returns the authenticated user's profile, billing subscription, and filtered announcements. Used to bootstrap the frontend session.",
          responses: {
            "200": {
              description: "Session payload",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      profile: { type: "object", additionalProperties: true },
                      billing: { $ref: "#/components/schemas/BillingSubscription" },
                      announcements: { type: "array", items: { type: "object", additionalProperties: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/billing/checkout": {
        post: {
          tags: ["billing"],
          summary: "Create Stripe Checkout session",
          description: "Creates a Stripe Checkout session for upgrading to a paid plan. Returns a redirect URL to the Stripe-hosted checkout page.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["plan", "successUrl", "cancelUrl"],
                  properties: {
                    plan: { type: "string", enum: ["starter", "pro", "power"] },
                    successUrl: { type: "string", format: "uri" },
                    cancelUrl: { type: "string", format: "uri" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Checkout session created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      url: { type: "string", format: "uri" },
                      sessionId: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": { description: "Stripe not configured or invalid plan" },
          },
        },
      },
      "/api/billing/subscription": {
        get: {
          tags: ["billing"],
          summary: "Get current billing subscription",
          description: "Returns the authenticated user's current billing subscription and plan config — used by the Profile > Subscriptions tab.",
          responses: {
            "200": {
              description: "Subscription and plan config",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      subscription: { $ref: "#/components/schemas/BillingSubscription" },
                      planConfig: { $ref: "#/components/schemas/PlanConfig" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/stripe/webhook": {
        post: {
          tags: ["billing"],
          summary: "Stripe webhook receiver",
          description: "Receives and verifies signed Stripe webhook events. Handles `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted` to update DynamoDB subscription state.",
          parameters: [
            { name: "Stripe-Signature", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          responses: {
            "200": { description: "Event handled" },
            "400": { description: "Signature verification failed" },
          },
        },
      },
      "/api/admin/summary": {
        get: {
          tags: ["admin"],
          summary: "Admin summary dashboard",
          description: "Returns high-level platform stats: total users, active scans, plan distribution, and recent activity.",
          responses: { "200": { description: "Admin summary payload" } },
        },
      },
      "/api/admin/users": {
        get: {
          tags: ["admin"],
          summary: "List all users",
          description: "Returns all tenant accounts with profile, billing subscription, and plan info.",
          parameters: [
            { name: "plan", in: "query", schema: { type: "string", enum: ["free", "starter", "pro", "power"] } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: { "200": { description: "User list" } },
        },
      },
      "/api/admin/users/{userId}/plan": {
        put: {
          tags: ["admin"],
          summary: "Override a user's subscription plan",
          description: "Manually sets any user's subscription to the specified tier. Sets provider=internal, status=active. Audit-logged as ADMIN_ACTION.",
          parameters: [
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["plan"],
                  properties: {
                    plan: { type: "string", enum: ["free", "starter", "pro", "power"] },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Billing subscription updated" },
            "400": { description: "Invalid plan value" },
            "404": { description: "User not found" },
          },
        },
      },
      "/api/admin/feature-flags": {
        get: {
          tags: ["admin"],
          summary: "Get feature flags",
          responses: { "200": { description: "Current feature flag values" } },
        },
        put: {
          tags: ["admin"],
          summary: "Update feature flags",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          responses: { "200": { description: "Feature flags updated" } },
        },
      },
      "/api/admin/plan-config": {
        get: {
          tags: ["admin"],
          summary: "Get all plan configs",
          description: "Returns the current admin-editable config for all 4 plans (free, starter, pro, power). Falls back to hardcoded defaults if not yet saved.",
          responses: {
            "200": {
              description: "All plan configs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      plans: { type: "array", items: { $ref: "#/components/schemas/PlanConfig" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/admin/plan-config/{plan}": {
        put: {
          tags: ["admin"],
          summary: "Update a single plan config",
          description: "Saves admin-editable settings for a single tier. Immediately invalidates the 5-minute in-memory cache.",
          parameters: [
            { name: "plan", in: "path", required: true, schema: { type: "string", enum: ["free", "starter", "pro", "power"] } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/PlanConfig" } } },
          },
          responses: {
            "200": { description: "Plan config saved" },
            "400": { description: "Invalid plan or body" },
          },
        },
      },
      "/api/admin/stripe-config": {
        get: {
          tags: ["admin"],
          summary: "Get Stripe config (public fields only)",
          description: "Returns publishable key, webhook status, and per-plan price IDs. Secret key and webhook secret are never returned.",
          responses: {
            "200": {
              description: "Public Stripe config",
              content: { "application/json": { schema: { $ref: "#/components/schemas/StripeConfigPublic" } } },
            },
          },
        },
        put: {
          tags: ["admin"],
          summary: "Save Stripe config",
          description: "Saves full Stripe configuration including secret key and webhook secret to DynamoDB. These fields are write-only and never returned by GET.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["publishableKey", "secretKey", "webhookSecret"],
                  properties: {
                    publishableKey: { type: "string" },
                    secretKey: { type: "string", description: "Write-only — never returned by GET" },
                    webhookSecret: { type: "string", description: "Write-only — never returned by GET" },
                    priceIds: {
                      type: "object",
                      properties: {
                        starter: { type: "string" },
                        pro: { type: "string" },
                        power: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Stripe config saved" } },
        },
      },
      "/api/admin/announcements": {
        get: {
          tags: ["admin"],
          summary: "List all announcements (admin)",
          description: "Returns all announcements regardless of active status or targeting — unfiltered admin view.",
          responses: {
            "200": {
              description: "All announcements",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      total: { type: "integer" },
                      announcements: { type: "array", items: { $ref: "#/components/schemas/AnnouncementRecord" } },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["admin"],
          summary: "Create announcement banner",
          description: "Creates a persistent banner targeted at specific users or plan cohorts. Non-dismissible by default.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title", "body"],
                  properties: {
                    title: { type: "string" },
                    body: { type: "string" },
                    severity: { type: "string", enum: ["info", "warning", "critical"], default: "info" },
                    active: { type: "boolean", default: true },
                    dismissible: { type: "boolean", default: false },
                    targetPlans: { type: "array", items: { type: "string", enum: ["all", "free", "starter", "pro", "power"] }, nullable: true },
                    targetTenantIds: { type: "array", items: { type: "string" }, nullable: true },
                    activeFrom: { type: "string", format: "date-time" },
                    activeTo: { type: "string", format: "date-time", nullable: true },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Announcement created" } },
        },
      },
      "/api/admin/announcements/{id}": {
        put: {
          tags: ["admin"],
          summary: "Update announcement",
          description: "Patches any fields on an existing announcement. Use active=false to deactivate without deleting.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
          responses: {
            "200": { description: "Announcement updated" },
            "404": { description: "Announcement not found" },
          },
        },
        delete: {
          tags: ["admin"],
          summary: "Delete announcement",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Announcement deleted" },
            "404": { description: "Announcement not found" },
          },
        },
      },
      "/api/admin/analytics/growth": {
        get: {
          tags: ["admin"],
          summary: "User growth analytics",
          description: "Returns new user signups and plan conversion trends over time.",
          responses: { "200": { description: "Growth analytics payload" } },
        },
      },
      "/api/admin/analytics/market-intel": {
        get: {
          tags: ["admin"],
          summary: "Market intelligence analytics",
          description: "Returns aggregate job market signals: top companies by new postings, keyword frequency, and location distribution.",
          responses: { "200": { description: "Market intel payload" } },
        },
      },
      "/api/admin/analytics/feature-usage": {
        get: {
          tags: ["admin"],
          summary: "Feature usage analytics",
          description: "Returns per-feature engagement metrics across the platform.",
          responses: { "200": { description: "Feature usage payload" } },
        },
      },
      "/api/admin/analytics/system-health": {
        get: {
          tags: ["admin"],
          summary: "System health analytics",
          description: "Returns Lambda execution metrics, scan success/failure rates, and DynamoDB operation counts.",
          responses: { "200": { description: "System health payload" } },
        },
      },
      "/api/admin/analytics/scan-quota": {
        get: {
          tags: ["admin"],
          summary: "Scan quota analytics",
          description: "Returns cache-hit rate, live-fetch rate, quota-block rate, per-plan scan usage, and daily quota consumption trends over the last 30 days.",
          responses: {
            "200": {
              description: "Scan quota analytics payload",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      cachedAt: { type: "string", format: "date-time" },
                      cacheExpiresAt: { type: "string", format: "date-time" },
                      data: {
                        type: "object",
                        properties: {
                          cacheHitRate: { type: "number", description: "0–1 fraction of company slots served from cache" },
                          liveFetchRate: { type: "number", description: "0–1 fraction of company slots live-fetched" },
                          quotaBlockRate: { type: "number", description: "0–1 fraction of company slots blocked by quota" },
                          totalRunsAnalyzed: { type: "integer" },
                          totalCacheHits: { type: "integer" },
                          totalLiveFetches: { type: "integer" },
                          totalQuotaBlocked: { type: "integer" },
                          perPlanUsage: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: {
                                plan: { type: "string" },
                                totalLiveScansUsed: { type: "integer" },
                                tenantCount: { type: "integer" },
                                avgPerTenant: { type: "number" },
                              },
                            },
                          },
                          quotaUsagePerDay: {
                            type: "array",
                            items: { type: "object", properties: { date: { type: "string" }, count: { type: "integer" } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/admin/support/tickets": {
        get: {
          tags: ["admin"],
          summary: "List support tickets",
          responses: { "200": { description: "Support tickets list" } },
        },
      },
      "/api/admin/export/jobs": {
        get: {
          tags: ["admin"],
          summary: "Export applied jobs (NDJSON)",
          description: "Streams all applied job records for the tenant as newline-delimited JSON. Suitable for data lake ingestion.",
          responses: {
            "200": { description: "NDJSON stream of AppliedJobRecord objects", content: { "application/x-ndjson": { schema: { type: "string" } } } },
          },
        },
      },
      "/api/admin/export/scan-state": {
        get: {
          tags: ["admin"],
          summary: "Export registry scan state (NDJSON)",
          description: "Streams all RegistryCompanyScanState records ordered by scan pool priority and time-of-day bias.",
          responses: {
            "200": { description: "NDJSON stream of RegistryCompanyScanState objects", content: { "application/x-ndjson": { schema: { type: "string" } } } },
          },
        },
      },
      "/api/applied-jobs/kanban": {
        get: {
          tags: ["jobs"],
          summary: "Kanban board view of applied jobs",
          description: "Returns applied jobs grouped into kanban columns by status: Applied, Interview, Negotiations, Offered, Rejected.",
          responses: {
            "200": {
              description: "Kanban board",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      total: { type: "integer" },
                      columns: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            status: { type: "string", enum: ["Applied", "Interview", "Negotiations", "Offered", "Rejected"] },
                            count: { type: "integer" },
                            jobs: { type: "array", items: { type: "object" } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/companies/{company}/applied": {
        get: {
          tags: ["jobs"],
          summary: "Applied jobs for a specific company",
          description: "Returns all applied job records filtered to a single company slug.",
          parameters: [{ name: "company", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "List of applied job records for the company" } },
        },
      },
    },
  };
}

export function openApiJsonResponse(request: Request): Response {
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return new Response(JSON.stringify(buildOpenApiDocument(baseUrl), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // The OpenAPI document is public metadata, so short-lived caching helps
      // the embedded docs UI avoid re-hammering the API origin on refresh.
      "Cache-Control": "public, max-age=60",
    },
  });
}
