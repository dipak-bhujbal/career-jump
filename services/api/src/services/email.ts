import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { Env, JobPosting, UpdatedEmailJob } from "../types";
import { formatET } from "../lib/utils";
import {
  loadBillingSubscription,
  loadEmailWebhookConfig,
  loadFeatureFlags,
  loadUserProfile,
  loadUserSettings,
  recordAppLog,
} from "../storage";
import { resolveSystemTenantContext } from "../lib/tenant";

const EMAIL_APP_NAME = "Career Jump";
const ses = new SESv2Client({});

export type EmailAttemptResult =
  | { status: "sent"; skipReason: null }
  | { status: "skipped"; skipReason: string }
  | { status: "failed"; skipReason: null };

function isSystemOwnedUser(userId?: string): boolean {
  return Boolean(userId?.startsWith("system-"));
}

function postedAtSortValue(job: JobPosting): number {
  if (!job.postedAt) return 0;
  const ms = new Date(job.postedAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value);
}

function mapNewJob(job: JobPosting) {
  return {
    changeType: "new",
    changeLabel: "New job",
    company: job.company,
    source: job.source,
    jobTitle: job.title,
    location: job.location,
    postedAt: formatET(job.postedAt) ?? "Unknown",
    postedAtRaw: job.postedAt ?? "",
    url: job.url,
    updateJustification: "",
    updateChanges: [],
    updateDiffText: "",
  };
}

function mapUpdatedJob(job: UpdatedEmailJob) {
  const updateChanges = Array.isArray(job.updateChanges) ? job.updateChanges : [];
  return {
    changeType: "updated",
    changeLabel: "Updated job",
    company: job.company,
    source: job.source,
    jobTitle: job.title,
    location: job.location,
    postedAt: formatET(job.postedAt) ?? "Unknown",
    postedAtRaw: job.postedAt ?? "",
    url: job.url,
    updateJustification: job.updateJustification ?? "Tracked inventory fields changed since the previous snapshot.",
    updateChanges,
    updateDiffText: updateChanges
      .map((change) => `${change.field}: ${formatChangeValue(change.previous)} -> ${formatChangeValue(change.current)}`)
      .join("\n"),
  };
}

async function sendNotificationWebhook(
  input: {
    webhookUrl: string;
    sharedSecret: string;
    recipient: string;
    sender: string;
    subject: string;
    runAt: string;
    runId?: string;
    plan: string;
    newJobs: ReturnType<typeof mapNewJob>[];
    updatedJobs: ReturnType<typeof mapUpdatedJob>[];
  }
): Promise<void> {
  // Keep the notification payload explicit so the shared Apps Script endpoint
  // can evolve independently from the SES text-only email body.
  //
  // Apps Script web apps do not reliably expose custom request headers to
  // doPost(). Include the shared secret in both places so the current Google
  // Apps Script deployment can validate `body.sharedSecret`, while older
  // webhook consumers that still read the header continue to work unchanged.
  const response = await fetch(input.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.sharedSecret ? { "x-cj-webhook-secret": input.sharedSecret } : {}),
    },
    body: JSON.stringify({
      type: "job_notification_email",
      sharedSecret: input.sharedSecret,
      recipient: input.recipient,
      sender: input.sender,
      subject: input.subject,
      runAt: input.runAt,
      runId: input.runId,
      plan: input.plan,
      summary: {
        totalNewJobs: input.newJobs.length,
        totalUpdatedJobs: input.updatedJobs.length,
      },
      newJobs: input.newJobs,
      updatedJobs: input.updatedJobs,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Webhook delivery failed: ${response.status} ${text.slice(0, 200)}`);
  }
}

export async function maybeSendEmail(
  env: Env,
  newJobs: JobPosting[],
  updatedJobs: UpdatedEmailJob[],
  runAt: string,
  runId?: string,
  userId?: string
): Promise<EmailAttemptResult> {
  if (!newJobs.length && !updatedJobs.length) {
    const skipReason = "No new or updated jobs were found";
    await recordAppLog(env, {
      level: "info",
      event: "email_skipped",
      message: `Skipped email because ${skipReason.toLowerCase()}`,
      runId,
      route: "scan",
      details: { skipReason, newJobs: 0, updatedJobs: 0 },
    });
    return { status: "skipped", skipReason };
  }

  if (isSystemOwnedUser(userId)) {
    const skipReason = "system-owned runs do not send user notification emails";
    await recordAppLog(env, {
      level: "info",
      event: "email_skipped",
      message: `Skipped email because ${skipReason}`,
      runId,
      route: "scan",
      details: { skipReason, newJobs: newJobs.length, updatedJobs: updatedJobs.length, userId },
    });
    return { status: "skipped", skipReason };
  }

  // Manual and async runs should both target the signed-in user's stored
  // profile email. Falling back to a blank actor silently routed messages to
  // the default tenant address instead of the real recipient.
  const profile = userId ? await loadUserProfile(userId) : null;
  if (profile?.scope === "admin") {
    const skipReason = "Admin accounts do not receive personal job alerts";
    await recordAppLog(env, {
      level: "info",
      event: "email_skipped",
      message: `Skipped email because ${skipReason.toLowerCase()}`,
      runId,
      route: "scan",
      details: { skipReason, newJobs: newJobs.length, updatedJobs: updatedJobs.length, userId },
    });
    return { status: "skipped", skipReason };
  }
  if (userId && !profile) {
    const skipReason = "No valid non-admin user profile for email delivery";
    await recordAppLog(env, {
      level: "warn",
      event: "email_skipped",
      message: `Skipped email because ${skipReason.toLowerCase()}`,
      runId,
      route: "scan",
      details: { skipReason, newJobs: newJobs.length, updatedJobs: updatedJobs.length, userId },
    });
    return { status: "skipped", skipReason };
  }
  const actor = userId
    ? {
        userId,
        tenantId: profile?.tenantId ?? userId,
        email: profile?.email ?? "",
        displayName: profile?.displayName ?? "",
        scope: profile?.scope ?? ("user" as const),
        // Admin profiles have already been rejected above, so the remaining
        // user-triggered email path is always non-admin.
        isAdmin: false,
      }
    : await resolveSystemTenantContext(env);
  const [settings, subscription, flags] = userId
    ? await Promise.all([
        loadUserSettings(userId),
        loadBillingSubscription(userId),
        loadFeatureFlags(actor),
      ])
    : [
        { emailNotifications: true, weeklyDigest: true, trackedCompanies: [], updatedAt: runAt, userId: actor.userId },
        { plan: "free", status: "active", provider: "internal", updatedAt: runAt, userId: actor.userId },
        await loadFeatureFlags(actor),
      ];
  const digestEnabled = flags.find((flag) => flag.flagName === "email_digest")?.enabled !== false;
  const recipient = actor.email || "";
  const sender = env.SES_FROM_EMAIL || process.env.SES_FROM_EMAIL || "";
  const storedWebhook = await loadEmailWebhookConfig(env);
  const webhookUrl = storedWebhook?.webhookUrl || env.APPS_SCRIPT_WEBHOOK_URL || "";
  const webhookSecret = storedWebhook?.sharedSecret || env.APPS_SCRIPT_SHARED_SECRET || "";

  if (!sender) {
    const skipReason = "SES_FROM_EMAIL is not configured";
    await recordAppLog(env, {
      level: "warn",
      event: "email_skipped",
      message: `Skipped email because ${skipReason}`,
      runId,
      route: "scan",
      details: { skipReason, newJobs: newJobs.length, updatedJobs: updatedJobs.length },
    });
    return { status: "skipped", skipReason };
  }

  if (!recipient) {
    const skipReason = "recipient email is not configured";
    await recordAppLog(env, {
      level: "warn",
      event: "email_skipped",
      message: `Skipped email because ${skipReason}`,
      runId,
      route: "scan",
      details: { skipReason, newJobs: newJobs.length, updatedJobs: updatedJobs.length },
    });
    return { status: "skipped", skipReason };
  }

  if (!settings.emailNotifications || !digestEnabled) {
    const skipReason = "email notifications are disabled";
    await recordAppLog(env, {
      level: "info",
      event: "email_skipped",
      message: `Skipped email because ${skipReason}`,
      runId,
      route: "scan",
      details: { skipReason, newJobs: newJobs.length, updatedJobs: updatedJobs.length },
    });
    return { status: "skipped", skipReason };
  }

  const sortedNewJobs = [...newJobs].sort((a, b) => postedAtSortValue(b) - postedAtSortValue(a));
  const sortedUpdatedJobs = [...updatedJobs].sort((a, b) => postedAtSortValue(b) - postedAtSortValue(a));
  const emailNewJobs = sortedNewJobs.map(mapNewJob);
  const emailUpdatedJobs = sortedUpdatedJobs.map(mapUpdatedJob);

  await recordAppLog(env, {
    level: "info",
    event: "email_send_started",
    message: `Sending email for ${sortedNewJobs.length} new jobs and ${sortedUpdatedJobs.length} updated jobs`,
    runId,
    route: "scan",
    details: {
      newJobs: sortedNewJobs.length,
      updatedJobs: sortedUpdatedJobs.length,
      totalJobs: sortedNewJobs.length + sortedUpdatedJobs.length,
      recipient,
      deliveryMode: webhookUrl ? "webhook" : "ses",
    },
  });

  const subject = `[${EMAIL_APP_NAME}] ${sortedNewJobs.length} new jobs and ${sortedUpdatedJobs.length} updated jobs`;
  const bodyText = [
    `Plan: ${subscription.plan}`,
    `Run at: ${formatET(runAt) ?? runAt}`,
    `Summary: ${sortedNewJobs.length} new jobs, ${sortedUpdatedJobs.length} updated jobs`,
    "",
    ...emailNewJobs.map((job) => `NEW | ${job.company} | ${job.jobTitle} | ${job.location} | ${job.url}`),
    ...emailUpdatedJobs.map((job) => `UPDATED | ${job.company} | ${job.jobTitle} | ${job.location} | ${job.url}`),
  ].join("\n");

  if (webhookUrl) {
    try {
      await sendNotificationWebhook({
        webhookUrl,
        sharedSecret: webhookSecret,
        recipient,
        sender,
        subject,
        runAt,
        runId,
        plan: subscription.plan,
        newJobs: emailNewJobs,
        updatedJobs: emailUpdatedJobs,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await recordAppLog(env, {
        level: "error",
        event: "email_send_failed",
        message: "Webhook email send failed",
        runId,
        route: "scan",
        details: { responseText: text.slice(0, 500), webhookUrl, recipient },
      });
      throw new Error(`Webhook email failed: ${text.slice(0, 200)}`);
    }
  } else {
    try {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: sender,
        Destination: { ToAddresses: [recipient] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: {
              Text: { Data: bodyText },
            },
          },
        },
      }));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      await recordAppLog(env, {
        level: "error",
        event: "email_send_failed",
        message: "SES email send failed",
        runId,
        route: "scan",
        details: { responseText: text.slice(0, 500), sender, recipient },
      });
      throw new Error(`SES email failed: ${text.slice(0, 200)}`);
    }
  }

  await recordAppLog(env, {
    level: "info",
    event: "email_send_completed",
    message: `Email sent for ${sortedNewJobs.length} new jobs and ${sortedUpdatedJobs.length} updated jobs`,
    runId,
    route: "scan",
    details: {
      newJobs: sortedNewJobs.length,
      updatedJobs: sortedUpdatedJobs.length,
      totalJobs: sortedNewJobs.length + sortedUpdatedJobs.length,
      recipient,
      deliveryMode: webhookUrl ? "webhook" : "ses",
    },
  });

  return { status: "sent", skipReason: null };
}
