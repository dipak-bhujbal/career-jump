import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { Env, JobPosting, UpdatedEmailJob } from "../types";
import { formatET } from "../lib/utils";
import { loadBillingSubscription, loadFeatureFlags, loadUserSettings, recordAppLog } from "../storage";
import { resolveSystemTenantContext } from "../lib/tenant";

const EMAIL_APP_NAME = "Career Jump";
const ses = new SESv2Client({});

export type EmailAttemptResult =
  | { status: "sent"; skipReason: null }
  | { status: "skipped"; skipReason: string }
  | { status: "failed"; skipReason: null };

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

  const actor = userId
    ? { userId, tenantId: userId, email: "", displayName: "", scope: "user" as const, isAdmin: false }
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
  const recipient = actor.email || process.env.DEFAULT_TENANT_EMAIL || "";
  const sender = env.SES_FROM_EMAIL || process.env.SES_FROM_EMAIL || "";

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
    details: { newJobs: sortedNewJobs.length, updatedJobs: sortedUpdatedJobs.length, totalJobs: sortedNewJobs.length + sortedUpdatedJobs.length },
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

  await recordAppLog(env, {
    level: "info",
    event: "email_send_completed",
    message: `Email sent for ${sortedNewJobs.length} new jobs and ${sortedUpdatedJobs.length} updated jobs`,
    runId,
    route: "scan",
    details: { newJobs: sortedNewJobs.length, updatedJobs: sortedUpdatedJobs.length, totalJobs: sortedNewJobs.length + sortedUpdatedJobs.length },
  });

  return { status: "sent", skipReason: null };
}
