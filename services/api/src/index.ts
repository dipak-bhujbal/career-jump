import { applyCompanyScanOverrides, loadRuntimeConfig } from "./config";
import { handleRequest } from "./routes";
import { writeAnalytics, trackRequestAnalytics } from "./lib/analytics";
import { resolveSystemTenantContext } from "./lib/tenant";
import { maybeSendEmail } from "./services/email";
import { getLatestRunNotificationJobs, markJobsAsSeen, runScan } from "./services/inventory";
import {
  ActiveRunOwnershipError,
  acquireActiveRunLock,
  ensureActiveRunOwnership,
  recordErrorLog,
  recordAppLog,
  releaseActiveRunLock,
  reserveEmailSendAttempt,
  updateEmailSendAttempt,
} from "./storage";
import type { Env } from "./types";

function makeRunId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startedAt = Date.now();
    const response = await handleRequest(request, env);
    trackRequestAnalytics(env, request, response, startedAt);
    return response;
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const runId = makeRunId("scheduled");
    let tenantId: string | undefined;
    try {
      const lockResult = await acquireActiveRunLock(env, { runId, triggerType: "scheduled" });
      if (!lockResult.ok) {
        await recordAppLog(env, {
          level: "warn",
          event: "scheduled_run_skipped",
          message: "Scheduled run skipped because another run is already in progress",
          runId,
          route: "/scheduled",
          details: {
            activeRunId: lockResult.lock.runId,
            activeTriggerType: lockResult.lock.triggerType,
            activeStartedAt: lockResult.lock.startedAt,
          },
        });
        return;
      }
      if (lockResult.recoveredLock) {
        await recordAppLog(env, {
          level: "warn",
          event: "scheduled_run_recovered_stale_lock",
          message: "Scheduled run recovered a stale active run lock before starting",
          runId,
          route: "/scheduled",
          details: {
            recoveredRunId: lockResult.recoveredLock.runId,
            recoveredTriggerType: lockResult.recoveredLock.triggerType,
            recoveredStartedAt: lockResult.recoveredLock.startedAt,
            recoveredLastHeartbeatAt: lockResult.recoveredLock.lastHeartbeatAt ?? null,
            recoveredCurrentCompany: lockResult.recoveredLock.currentCompany ?? null,
            recoveredCurrentStage: lockResult.recoveredLock.currentStage ?? null,
          },
        });
      }
      const tenantContext = await resolveSystemTenantContext(env);
      tenantId = tenantContext.tenantId;
      await recordAppLog(env, {
        level: "info",
        event: "scheduled_run_started",
        message: "Scheduled run started",
        tenantId: tenantContext.tenantId,
        runId,
        route: "/scheduled",
      });
      // Tenant pause flags should only affect manual `/run` fanout, not the
      // system-driven scheduled scans that keep shared inventory fresh.
      const config = await loadRuntimeConfig(env, tenantContext.tenantId, {
        isAdmin: tenantContext.isAdmin,
        updatedByUserId: tenantContext.userId,
      });
      const { inventory, previousInventory, newJobs, updatedJobs } = await runScan(env, config, runId, tenantContext.tenantId);
      const notificationJobs = await getLatestRunNotificationJobs(env, inventory, previousInventory, tenantContext.tenantId);
      await ensureActiveRunOwnership(env, runId);
      const hasNotificationJobs = notificationJobs.newJobs.length > 0 || notificationJobs.updatedJobs.length > 0;
      let emailResult: Awaited<ReturnType<typeof maybeSendEmail>> = {
        status: "skipped",
        skipReason: "Email was not attempted",
      };
      if (hasNotificationJobs && env.APPS_SCRIPT_WEBHOOK_URL) {
        const emailAttempt = await reserveEmailSendAttempt(env, runId, tenantContext.tenantId);
        if (!emailAttempt.reserved) {
          emailResult = {
            status: "skipped",
            skipReason: `Email already attempted for this run (${emailAttempt.attempt?.status ?? "unknown"})`,
          };
        } else {
          try {
            emailResult = await maybeSendEmail(
              env,
              notificationJobs.newJobs,
              notificationJobs.updatedJobs,
              inventory.runAt,
              runId,
              tenantContext.userId
            );
            await updateEmailSendAttempt(env, runId, "sent", { tenantId: tenantContext.tenantId });
          } catch (error) {
            await updateEmailSendAttempt(env, runId, "failed", {
              tenantId: tenantContext.tenantId,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
        }
      } else {
        emailResult = await maybeSendEmail(
          env,
          notificationJobs.newJobs,
          notificationJobs.updatedJobs,
          inventory.runAt,
          runId,
          tenantContext.userId
        );
      }
      writeAnalytics(env, {
        event: "scheduled_run_completed",
        indexes: ["scheduled", "/scheduled"],
        blobs: [runId],
        doubles: [inventory.stats.totalJobsMatched, newJobs.length, updatedJobs.length, inventory.stats.totalFetched],
      });
      if (notificationJobs.newJobs.length > 0 && emailResult.status === "sent") {
        await ensureActiveRunOwnership(env, runId);
        await markJobsAsSeen(env, notificationJobs.newJobs, inventory.runAt, runId, tenantContext.tenantId);
      }
      await ensureActiveRunOwnership(env, runId);
      await recordAppLog(env, {
        level: "info",
        event: "run_completed",
        message: `Run completed with ${inventory.stats.totalJobsMatched} matched jobs, ${newJobs.length} new jobs, and ${updatedJobs.length} updated jobs`,
        tenantId: tenantContext.tenantId,
        runId,
        route: "/scheduled",
        details: {
          totalMatched: inventory.stats.totalJobsMatched,
          totalNewMatches: newJobs.length,
          totalUpdatedMatches: updatedJobs.length,
          totalFetched: inventory.stats.totalFetched,
          emailStatus: emailResult.status,
          emailSkipReason: emailResult.skipReason,
          emailError: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof ActiveRunOwnershipError) {
        await recordAppLog(env, {
          level: "warn",
          event: "scheduled_run_aborted",
          message: "Scheduled run stopped after losing the active run lock",
          tenantId,
          route: "/scheduled",
          runId,
          details: {
            activeRunId: error.activeRunId,
          },
        });
        return;
      }
      console.log("[scheduled] unhandled exception", JSON.stringify({ error: message }));
      writeAnalytics(env, {
        event: "scheduled_run_failed",
        indexes: ["scheduled", "/scheduled"],
        blobs: [runId, message],
        doubles: [1],
      });
      await recordErrorLog(env, {
        event: "scheduled_run_failed",
        message,
        tenantId,
        route: "/scheduled",
        runId,
        details: {
          stack: error instanceof Error ? error.stack : null,
        },
      });
    } finally {
      await releaseActiveRunLock(env, runId);
    }
  },
};
