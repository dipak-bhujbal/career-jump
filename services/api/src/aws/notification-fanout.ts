import { jobStateKv } from "../lib/bindings";
import { tenantScopedKey } from "../lib/tenant";
import { normalizeCompanyKey } from "../storage/tenant-keys";
import { NOTIFICATION_CONFIG_VERSION_KEY } from "../constants";
import {
  findUserProfiles,
  loadUserSettings,
  recordAppLog,
  reserveEmailSendAttempt,
  updateEmailSendAttempt,
} from "../storage";
import {
  expandAdminRuntimeConfigCompanies,
  loadRuntimeConfig,
} from "../config";
import { maybeSendEmail } from "../services/email";
import {
  buildAvailableJobsFromSharedInventory,
  findNewJobs,
  findUpdatedJobs,
  getInventoryDiff,
  getLatestRunNotificationJobs,
  loadInventoryState,
  markJobsAsSeen,
  notificationInventoryStateKeys,
  pruneInventoryForStorage,
  saveInventory,
} from "../services/inventory";
import type { Env, InventorySnapshot, RuntimeConfig, UserProfileRecord } from "../types";
import { makeAwsEnv } from "./env";

type NotificationFanoutEvent = {
  companySlug?: string;
  reason?: "scheduled" | "registry-scan";
};

type NotificationProfileResult =
  | { status: "sent" | "skipped" | "baselined"; profile: string; reason?: string; newJobs?: number; updatedJobs?: number }
  | { status: "failed"; profile: string; reason: string };

function makeNotificationRunId(profile: UserProfileRecord, reason: string): string {
  return `notify-${reason}-${profile.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function notificationConfigVersion(config: RuntimeConfig, isAdmin: boolean): string {
  // Admin notification mode intentionally spans the whole registry even when
  // the interactive configuration page only shows a curated subset.
  return isAdmin ? `${config.updatedAt}:admin-all-v1` : config.updatedAt;
}

async function buildNotificationConfig(env: Env, profile: UserProfileRecord): Promise<RuntimeConfig> {
  const config = await loadRuntimeConfig(env, profile.tenantId, {
    isAdmin: profile.scope === "admin",
    updatedByUserId: profile.userId,
    // Interactive admin pages stay bounded to the visible config subset. The
    // notification worker deliberately opts into the full registry instead.
    expandAdminCompanies: profile.scope === "admin" ? false : undefined,
  });

  if (profile.scope !== "admin") {
    return config;
  }

  return {
    ...config,
    adminRegistryMode: "all",
    companies: await expandAdminRuntimeConfigCompanies(config.companies, "all"),
  };
}

function enabledCompanySet(config: RuntimeConfig): Set<string> {
  return new Set(
    config.companies
      .filter((company) => company.enabled !== false)
      .map((company) => normalizeCompanyKey(company.company)),
  );
}

async function baselineNotificationState(
  env: Env,
  profile: UserProfileRecord,
  configVersion: string,
  inventory: InventorySnapshot,
): Promise<void> {
  const stateKeys = notificationInventoryStateKeys();
  await saveInventory(env, inventory, profile.tenantId, undefined, {
    stateKeys,
    skipDashboardRefresh: true,
    skipKeyPrune: true,
    skipNotePrune: true,
  });
  await Promise.all([
    jobStateKv(env).put(tenantScopedKey(profile.tenantId, stateKeys.lastNewJobsCountKey), "0"),
    jobStateKv(env).put(tenantScopedKey(profile.tenantId, stateKeys.lastNewJobKeysKey), JSON.stringify([])),
    jobStateKv(env).put(tenantScopedKey(profile.tenantId, stateKeys.lastUpdatedJobsCountKey), "0"),
    jobStateKv(env).put(tenantScopedKey(profile.tenantId, stateKeys.lastUpdatedJobKeysKey), JSON.stringify([])),
    jobStateKv(env).put(tenantScopedKey(profile.tenantId, NOTIFICATION_CONFIG_VERSION_KEY), configVersion),
  ]);
}

async function processProfile(
  env: Env,
  profile: UserProfileRecord,
  event: NotificationFanoutEvent,
): Promise<NotificationProfileResult> {
  const settings = await loadUserSettings(profile.userId);
  if (!settings.emailNotifications) {
    return { status: "skipped", profile: profile.email, reason: "email notifications disabled" };
  }

  const config = await buildNotificationConfig(env, profile);
  const relevantCompanySlug = event.companySlug ? normalizeCompanyKey(event.companySlug) : null;
  if (relevantCompanySlug && profile.scope !== "admin") {
    const configuredCompanies = enabledCompanySet(config);
    if (!configuredCompanies.has(relevantCompanySlug)) {
      return { status: "skipped", profile: profile.email, reason: "scan company not tracked by tenant" };
    }
  }

  const stateKeys = notificationInventoryStateKeys();
  const previousState = await loadInventoryState(env, profile.tenantId, stateKeys);
  const previousConfigVersion = await jobStateKv(env).get(tenantScopedKey(profile.tenantId, NOTIFICATION_CONFIG_VERSION_KEY));
  const nextInventory = await buildAvailableJobsFromSharedInventory(
    env,
    config,
    previousState.inventory,
    profile.tenantId,
    { isAdmin: profile.scope === "admin" },
  );
  const storageInventory = await pruneInventoryForStorage(env, nextInventory, profile.tenantId);
  const nextConfigVersion = notificationConfigVersion(config, profile.scope === "admin");

  // The first notification sweep should establish a clean baseline instead of
  // emailing every historical job that already existed before alerts were on.
  if (!previousState.inventory || previousConfigVersion !== nextConfigVersion) {
    await baselineNotificationState(env, profile, nextConfigVersion, storageInventory);
    await recordAppLog(env, {
      level: "info",
      event: "notification_baseline_saved",
      tenantId: profile.tenantId,
      route: "/aws/notification-fanout",
      message: "Saved a fresh notification baseline instead of sending historical jobs",
      details: {
        profile: profile.email,
        scope: profile.scope,
        configVersion: nextConfigVersion,
        companySlug: event.companySlug ?? null,
        totalJobsMatched: storageInventory.stats.totalJobsMatched,
      },
    });
    return { status: "baselined", profile: profile.email, reason: "initialized notification baseline" };
  }

  const diff = getInventoryDiff(previousState.inventory, storageInventory);
  await findNewJobs(env, previousState.inventory, storageInventory, undefined, profile.tenantId, {
    recordLog: false,
    diff,
    stateKeys,
  });
  await findUpdatedJobs(env, previousState.inventory, storageInventory, undefined, profile.tenantId, {
    recordLog: false,
    diff,
    stateKeys,
  });
  await saveInventory(env, nextInventory, profile.tenantId, previousState, {
    stateKeys,
    skipDashboardRefresh: true,
    skipKeyPrune: true,
    skipNotePrune: true,
  });
  await jobStateKv(env).put(tenantScopedKey(profile.tenantId, NOTIFICATION_CONFIG_VERSION_KEY), nextConfigVersion);

  const notificationJobs = await getLatestRunNotificationJobs(
    env,
    storageInventory,
    previousState.inventory,
    profile.tenantId,
    stateKeys,
  );
  if (!notificationJobs.newJobs.length && !notificationJobs.updatedJobs.length) {
    return { status: "skipped", profile: profile.email, reason: "no new or updated jobs" };
  }

  const runId = makeNotificationRunId(profile, event.reason ?? "scheduled");
  const emailAttempt = await reserveEmailSendAttempt(env, runId, profile.tenantId);
  if (!emailAttempt.reserved) {
    return {
      status: "skipped",
      profile: profile.email,
      reason: `email already attempted (${emailAttempt.attempt?.status ?? "unknown"})`,
    };
  }

  try {
    const emailResult = await maybeSendEmail(
      env,
      notificationJobs.newJobs,
      notificationJobs.updatedJobs,
      storageInventory.runAt,
      runId,
      profile.userId,
    );
    await updateEmailSendAttempt(env, runId, emailResult.status === "sent" ? "sent" : "failed", {
      tenantId: profile.tenantId,
      error: emailResult.status === "failed" ? "notification send failed" : undefined,
    });
    if (emailResult.status === "sent" && notificationJobs.newJobs.length) {
      await markJobsAsSeen(env, notificationJobs.newJobs, storageInventory.runAt, runId, profile.tenantId);
    }
    return {
      status: emailResult.status === "sent" ? "sent" : "skipped",
      profile: profile.email,
      reason: emailResult.skipReason ?? undefined,
      newJobs: notificationJobs.newJobs.length,
      updatedJobs: notificationJobs.updatedJobs.length,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await updateEmailSendAttempt(env, runId, "failed", {
      tenantId: profile.tenantId,
      error: reason,
    });
    return { status: "failed", profile: profile.email, reason };
  }
}

export async function handler(event: NotificationFanoutEvent = {}): Promise<{
  ok: boolean;
  processed: number;
  sent: number;
  baselined: number;
  skipped: number;
  failed: number;
  results: NotificationProfileResult[];
}> {
  const env = makeAwsEnv();
  const profiles = (await findUserProfiles()).filter((profile) => profile.accountStatus === "active");
  const results = await Promise.all(profiles.map((profile) => processProfile(env, profile, event)));

  return {
    ok: true,
    processed: results.length,
    sent: results.filter((result) => result.status === "sent").length,
    baselined: results.filter((result) => result.status === "baselined").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
    results,
  };
}
