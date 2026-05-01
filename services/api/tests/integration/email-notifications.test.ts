import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/types";

const sesSendMock = vi.fn();
const fetchMock = vi.fn();
const loadUserProfileMock = vi.fn();
const loadUserSettingsMock = vi.fn();
const loadBillingSubscriptionMock = vi.fn();
const loadFeatureFlagsMock = vi.fn();
const loadEmailWebhookConfigMock = vi.fn();
const recordAppLogMock = vi.fn();
const getRunMetaMock = vi.fn();
const reserveEmailSendAttemptMock = vi.fn();
const updateEmailSendAttemptMock = vi.fn();
const listCompanyResultsMock = vi.fn();
const listFailedCompanyResultsMock = vi.fn();
const loadRuntimeConfigMock = vi.fn();
const applyCompanyScanOverridesMock = vi.fn();
const loadPreviousInventoryMock = vi.fn();
const pruneInventoryForStorageMock = vi.fn();
const findNewJobsMock = vi.fn();
const findUpdatedJobsMock = vi.fn();
const getLatestRunNotificationJobsMock = vi.fn();
const saveInventoryMock = vi.fn();
const markJobsAsSeenMock = vi.fn();
const logAppEventMock = vi.fn();
const markFinalizedMock = vi.fn();
const releaseActiveRunLockMock = vi.fn();
const markFirstScanAtIfUnsetMock = vi.fn();
const recordEventMock = vi.fn();
const jobStateGetMock = vi.fn();
const jobStateListMock = vi.fn();

vi.mock("@aws-sdk/client-sesv2", () => {
  class SESv2Client {
    send = sesSendMock;
    constructor(_input: Record<string, unknown>) {}
  }

  class SendEmailCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }

  return { SESv2Client, SendEmailCommand };
});

vi.mock("../../src/storage", async () => {
  const actual = await vi.importActual<typeof import("../../src/storage")>("../../src/storage");
  return {
    ...actual,
    loadUserProfile: loadUserProfileMock,
    loadUserSettings: loadUserSettingsMock,
    loadBillingSubscription: loadBillingSubscriptionMock,
    loadFeatureFlags: loadFeatureFlagsMock,
    loadEmailWebhookConfig: loadEmailWebhookConfigMock,
    recordAppLog: recordAppLogMock,
    reserveEmailSendAttempt: reserveEmailSendAttemptMock,
    updateEmailSendAttempt: updateEmailSendAttemptMock,
    saveInventory: saveInventoryMock,
    markJobsAsSeen: markJobsAsSeenMock,
    markFirstScanAtIfUnset: markFirstScanAtIfUnsetMock,
    recordEvent: recordEventMock,
    releaseActiveRunLock: releaseActiveRunLockMock,
  };
});

vi.mock("../../src/aws/run-state", async () => {
  const actual = await vi.importActual<typeof import("../../src/aws/run-state")>("../../src/aws/run-state");
  return {
    ...actual,
    getRunMeta: getRunMetaMock,
    markFinalized: markFinalizedMock,
  };
});

vi.mock("../../src/config", () => ({
  loadRuntimeConfig: loadRuntimeConfigMock,
  applyCompanyScanOverrides: applyCompanyScanOverridesMock,
}));

vi.mock("../../src/services/inventory", () => ({
  getInventoryDiff: vi.fn(() => ({ currentKeys: new Set(), previousKeys: new Set(), newKeys: new Set(), removedKeys: new Set(), stayedKeys: new Set(), currentByKey: new Map(), previousByKey: new Map() })),
  findNewJobs: findNewJobsMock,
  findUpdatedJobs: findUpdatedJobsMock,
  getLatestRunNotificationJobs: getLatestRunNotificationJobsMock,
  markJobsAsSeen: markJobsAsSeenMock,
  pruneInventoryForStorage: pruneInventoryForStorageMock,
  saveInventory: saveInventoryMock,
}));

vi.mock("../../src/lib/logger", () => ({
  logAppEvent: logAppEventMock,
  logErrorEvent: vi.fn(async () => undefined),
}));

vi.mock("../../src/lib/bindings", () => ({
  jobStateKv: vi.fn(() => ({
    get: jobStateGetMock,
    list: jobStateListMock,
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

describe("email notifications", () => {
  const originalEnv = { ...process.env };
  const env = {
    JOB_STATE: {} as KVNamespace,
    ATS_CACHE: {} as KVNamespace,
    CONFIG_STORE: {} as KVNamespace,
    DB: {} as D1Database,
    ASSETS: { fetch: vi.fn(async () => new Response("", { status: 200 })) },
    SES_FROM_EMAIL: "noreply@careerjump.test",
  } as unknown as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SES_FROM_EMAIL = "noreply@careerjump.test";
    vi.stubGlobal("fetch", fetchMock);
    sesSendMock.mockResolvedValue({});
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    loadUserProfileMock.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
      email: "person@example.com",
      displayName: "Person Example",
      accountStatus: "active",
      plan: "free",
      joinedAt: "2026-04-30T00:00:00.000Z",
      lastLoginAt: "2026-04-30T00:00:00.000Z",
      cognitoSub: "user-1",
      scope: "user",
    });
    loadUserSettingsMock.mockResolvedValue({
      userId: "user-1",
      emailNotifications: true,
      weeklyDigest: true,
      trackedCompanies: [],
      updatedAt: "2026-04-30T00:00:00.000Z",
    });
    loadBillingSubscriptionMock.mockResolvedValue({
      userId: "user-1",
      plan: "free",
      status: "active",
      provider: "internal",
      updatedAt: "2026-04-30T00:00:00.000Z",
    });
    loadFeatureFlagsMock.mockResolvedValue([{ flagName: "email_digest", enabled: true }]);
    loadEmailWebhookConfigMock.mockResolvedValue(null);
    recordAppLogMock.mockResolvedValue(undefined);
    reserveEmailSendAttemptMock.mockResolvedValue({ reserved: true });
    updateEmailSendAttemptMock.mockResolvedValue(undefined);
    getRunMetaMock.mockResolvedValue({
      runId: "manual-1",
      triggerType: "manual",
      expectedCompanies: 1,
      completedCompanies: 1,
      failedCompanies: 0,
      totalFinishedCompanies: 1,
      startedAt: "2026-04-30T00:00:00.000Z",
      updatedAt: "2026-04-30T00:00:05.000Z",
      userId: "user-1",
      tenantId: "tenant-1",
      email: "person@example.com",
      displayName: "Person Example",
    });
    loadRuntimeConfigMock.mockResolvedValue({
      companies: [{ company: "Adobe Inc", enabled: true, source: "workday" }],
      jobtitles: { includeKeywords: [], excludeKeywords: [] },
      updatedAt: "2026-04-30T00:00:00.000Z",
    });
    applyCompanyScanOverridesMock.mockImplementation(async (_env: Env, config: unknown) => config);
    jobStateGetMock.mockResolvedValue(null);
    jobStateListMock.mockResolvedValue({ keys: [], list_complete: true, cursor: "" });
    pruneInventoryForStorageMock.mockImplementation(async (_env: Env, inventory: unknown) => inventory);
    findNewJobsMock.mockResolvedValue([]);
    findUpdatedJobsMock.mockResolvedValue([]);
    getLatestRunNotificationJobsMock.mockResolvedValue({
      newJobs: [
        {
          source: "workday",
          company: "Adobe Inc",
          id: "job-1",
          title: "Manager",
          location: "Remote, US",
          url: "https://example.com/jobs/1",
          postedAt: "2026-04-30T00:00:00.000Z",
        },
      ],
      updatedJobs: [],
    });
    saveInventoryMock.mockResolvedValue(undefined);
    markJobsAsSeenMock.mockResolvedValue(undefined);
    logAppEventMock.mockResolvedValue(undefined);
    markFinalizedMock.mockResolvedValue(undefined);
    releaseActiveRunLockMock.mockResolvedValue(undefined);
    markFirstScanAtIfUnsetMock.mockResolvedValue({ wasFirstScan: false, firstScanAt: null, joinedAt: null });
    recordEventMock.mockResolvedValue(undefined);
  });

  afterAll(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("sends email to the stored profile email for manual/user-triggered runs", async () => {
    const { maybeSendEmail } = await import("../../src/services/email");

    const result = await maybeSendEmail(
      env,
      [{
        source: "workday",
        company: "Adobe Inc",
        id: "job-1",
        title: "Manager",
        location: "Remote, US",
        url: "https://example.com/jobs/1",
        postedAt: "2026-04-30T00:00:00.000Z",
      }],
      [],
      "2026-04-30T00:00:00.000Z",
      "manual-1",
      "user-1",
    );

    expect(result).toEqual({ status: "sent", skipReason: null });
    expect(loadUserProfileMock).toHaveBeenCalledWith("user-1");
    expect(sesSendMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        Destination: { ToAddresses: ["person@example.com"] },
      }),
    }));
  });

  it("prefers the configured webhook over SES for outbound user notifications", async () => {
    loadEmailWebhookConfigMock.mockResolvedValue({
      webhookUrl: "https://example.com/email-webhook",
      sharedSecret: "top-secret",
    });

    const { maybeSendEmail } = await import("../../src/services/email");

    const result = await maybeSendEmail(
      env,
      [{
        source: "workday",
        company: "Adobe Inc",
        id: "job-1",
        title: "Manager",
        location: "Remote, US",
        url: "https://example.com/jobs/1",
        postedAt: "2026-04-30T00:00:00.000Z",
      }],
      [],
      "2026-04-30T00:00:00.000Z",
      "manual-1",
      "user-1",
    );

    expect(result).toEqual({ status: "sent", skipReason: null });
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/email-webhook", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "content-type": "application/json",
        "x-cj-webhook-secret": "top-secret",
      }),
      body: expect.stringContaining("\"sharedSecret\":\"top-secret\""),
    }));
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("uses the run meta userId during async finalize so tenantId-only runs still email the right person", async () => {
    const { handler } = await import("../../src/aws/finalize-run");

    await handler({ runId: "manual-1", tenantId: "tenant-1" });

    expect(loadUserProfileMock).toHaveBeenCalledWith("user-1");
    expect(sesSendMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        Destination: { ToAddresses: ["person@example.com"] },
      }),
    }));
  });

  it("skips notification delivery for system-owned scheduled runs", async () => {
    const { maybeSendEmail } = await import("../../src/services/email");

    const result = await maybeSendEmail(
      env,
      [{
        source: "workday",
        company: "Adobe Inc",
        id: "job-1",
        title: "Manager",
        location: "Remote, US",
        url: "https://example.com/jobs/1",
        postedAt: "2026-04-30T00:00:00.000Z",
      }],
      [],
      "2026-04-30T00:00:00.000Z",
      "scheduled-1",
      "system-career-jump",
    );

    expect(result).toEqual({
      status: "skipped",
      skipReason: "system-owned runs do not send user notification emails",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sesSendMock).not.toHaveBeenCalled();
  });
});
