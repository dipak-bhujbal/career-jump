import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { nowISO } from "../lib/utils";
import type {
  AnnouncementRecord,
  AuthScope,
  BillingSubscriptionRecord,
  FeatureFlagRecord,
  RequestActor,
  SupportTicketMessageRecord,
  SupportTicketPriority,
  SupportTicketRecord,
  SupportTicketStatus,
  SupportTicketTag,
  UserProfileRecord,
  UserSessionRecord,
  UserSettingsRecord,
  UserPlan,
} from "../types";
import {
  billingTableName,
  eventsTableName,
  getRow,
  putRow,
  queryRows,
  scanRows,
  supportTableName,
  usersTableName,
} from "../aws/dynamo";

const cognito = new CognitoIdentityProviderClient({});

type UserTableProfileRow = UserProfileRecord & {
  pk: string;
  sk: "PROFILE";
  gsi1pk: string;
  gsi1sk: string;
};

type UserTableSettingsRow = UserSettingsRecord & {
  pk: string;
  sk: "SETTINGS";
};

type UserTableSessionRow = UserSessionRecord & {
  pk: string;
  sk: string;
};

type BillingTableSubscriptionRow = BillingSubscriptionRecord & {
  pk: string;
  sk: "SUBSCRIPTION";
  gsi1pk?: string;
  gsi1sk?: string;
};

type SupportTicketMetadataRow = SupportTicketRecord & {
  pk: string;
  sk: "METADATA";
  gsi1pk: SupportTicketStatus;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  gsi3pk: string;
  gsi3sk: string;
  gsi4pk?: string;
  gsi4sk?: string;
};

type SupportTicketMessageRow = SupportTicketMessageRecord & {
  pk: string;
  sk: string;
};

type SupportUserTicketLinkRow = {
  pk: string;
  sk: string;
  ticketId: string;
  createdAt: string;
  gsi2pk: string;
  gsi2sk: string;
};

type SupportFeatureFlagRow = FeatureFlagRecord & {
  pk: string;
  sk: "CONFIG";
};

type SupportAnnouncementRow = AnnouncementRecord & {
  pk: string;
  sk: "CONFIG";
};

function userPk(userId: string): string {
  return `USER#${userId}`;
}

function ticketPk(ticketId: string): string {
  return `TICKET#${ticketId}`;
}

async function generateSupportTicketId(): Promise<string> {
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    // Keep support IDs short and human-friendly while still checking storage
    // for collisions before we return them.
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const ticketId = `CJ-${day}-${randomPart}`;
    const existing = await getSupportTicket(ticketId);
    if (!existing) return ticketId;
  }
  return `CJ-${Date.now().toString().slice(-8)}`;
}

function normalizePlan(plan?: string | null): UserPlan {
  return plan === "pro" || plan === "power" ? plan : "free";
}

function normalizeScope(scope?: string | null): AuthScope {
  return scope === "admin" ? "admin" : "user";
}

function defaultSettings(userId: string): UserSettingsRecord {
  return {
    userId,
    emailNotifications: true,
    weeklyDigest: true,
    trackedCompanies: [],
    updatedAt: nowISO(),
  };
}

function defaultSubscription(userId: string): BillingSubscriptionRecord {
  return {
    userId,
    plan: "free",
    status: "active",
    provider: "internal",
    updatedAt: nowISO(),
  };
}

function sessionLimitForPlan(plan: UserPlan): number {
  switch (plan) {
    case "power":
      return 3;
    case "pro":
      return 2;
    case "free":
    default:
      return 1;
  }
}

function sessionSk(sessionId: string): string {
  return `SESSION#${sessionId}`;
}

function ipSubnet(ipAddress: string): string {
  const match = ipAddress.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  return match ? `${match[1]}.0/24` : ipAddress;
}

function defaultFeatureFlags(updatedBy: string): FeatureFlagRecord[] {
  const updatedAt = nowISO();
  return [
    {
      flagName: "workday_layer2_headless",
      enabled: false,
      enabledForPlans: [],
      enabledForUsers: [],
      rolloutPercent: 0,
      description: "Enable headless Chrome for measured Workday failures.",
      updatedAt,
      updatedBy,
    },
    {
      flagName: "workday_layer3_scraperapi",
      enabled: false,
      enabledForPlans: [],
      enabledForUsers: [],
      rolloutPercent: 0,
      description: "Enable ScraperAPI routing for failing Workday tenants.",
      updatedAt,
      updatedBy,
    },
    {
      flagName: "email_digest",
      enabled: true,
      enabledForPlans: ["free", "pro", "power"],
      enabledForUsers: [],
      rolloutPercent: 100,
      description: "Weekly digest and run email notifications.",
      updatedAt,
      updatedBy,
    },
  ];
}

export async function recordEvent(
  actor: RequestActor | null,
  eventType: string,
  details: Record<string, unknown> = {}
): Promise<void> {
  const createdAt = nowISO();
  const eventId = crypto.randomUUID();
  await putRow(eventsTableName(), {
    pk: actor ? userPk(actor.userId) : "SYSTEM",
    sk: `EVENT#${createdAt}#${eventId}`,
    gsi1pk: eventType,
    gsi1sk: createdAt,
    eventType,
    actor: actor ? `${actor.scope}#${actor.userId}` : "system",
    createdAt,
    details,
    expiresAtEpoch: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60),
  });
}

async function loadUserProfileRow(userId: string): Promise<UserTableProfileRow | null> {
  return getRow<UserTableProfileRow>(usersTableName(), { pk: userPk(userId), sk: "PROFILE" }, true);
}

export async function loadUserProfile(userId: string): Promise<UserProfileRecord | null> {
  return loadUserProfileRow(userId);
}

export async function ensureUserProfile(actor: RequestActor): Promise<UserProfileRecord> {
  const existing = await loadUserProfileRow(actor.userId);
  const timestamp = nowISO();
  if (existing) {
    const refreshed: UserTableProfileRow = {
      ...existing,
      displayName: actor.displayName || existing.displayName,
      email: actor.email,
      tenantId: actor.tenantId,
      scope: normalizeScope(actor.scope),
      lastLoginAt: timestamp,
    };
    await putRow(usersTableName(), refreshed);
    return refreshed;
  }

  const created: UserTableProfileRow = {
    pk: userPk(actor.userId),
    sk: "PROFILE",
    gsi1pk: `EMAIL#${actor.email.toLowerCase()}`,
    gsi1sk: actor.userId,
    userId: actor.userId,
    tenantId: actor.tenantId,
    email: actor.email.toLowerCase(),
    displayName: actor.displayName,
    accountStatus: "active",
    plan: "free",
    joinedAt: timestamp,
    lastLoginAt: timestamp,
    cognitoSub: actor.userId,
    scope: actor.scope,
  };
  await putRow(usersTableName(), created);
  await putRow(usersTableName(), {
    pk: userPk(actor.userId),
    sk: "SETTINGS",
    ...defaultSettings(actor.userId),
  } satisfies UserTableSettingsRow);
  await putRow(billingTableName(), {
    pk: userPk(actor.userId),
    sk: "SUBSCRIPTION",
    ...defaultSubscription(actor.userId),
  } satisfies BillingTableSubscriptionRow);
  await recordEvent(actor, "USER_CREATED", { plan: "free" });
  return created;
}

export async function loadUserSettings(userId: string): Promise<UserSettingsRecord> {
  const existing = await getRow<UserTableSettingsRow>(usersTableName(), { pk: userPk(userId), sk: "SETTINGS" }, true);
  if (existing) return existing;
  const defaults = defaultSettings(userId);
  await putRow(usersTableName(), { pk: userPk(userId), sk: "SETTINGS", ...defaults });
  return defaults;
}

export async function loadBillingSubscription(userId: string): Promise<BillingSubscriptionRecord> {
  const existing = await getRow<BillingTableSubscriptionRow>(
    billingTableName(),
    { pk: userPk(userId), sk: "SUBSCRIPTION" },
    true
  );
  if (existing) return existing;
  const defaults = defaultSubscription(userId);
  await putRow(billingTableName(), { pk: userPk(userId), sk: "SUBSCRIPTION", ...defaults });
  return defaults;
}

export async function listUserSessions(userId: string): Promise<UserSessionRecord[]> {
  const rows = await queryRows<UserTableSessionRow>(
    usersTableName(),
    "pk = :pk AND begins_with(sk, :prefix)",
    { ":pk": userPk(userId), ":prefix": "SESSION#" },
    { scanIndexForward: false, limit: 20, consistentRead: true }
  );
  return rows.filter((row) => !row.revokedAt);
}

export async function ensureUserSession(
  actor: RequestActor,
  input: {
    sessionId: string;
    deviceFingerprint: string;
    ipAddress: string;
    country: string;
  }
): Promise<UserSessionRecord> {
  const subscription = await loadBillingSubscription(actor.userId);
  const plan = normalizePlan(subscription.plan);
  const now = nowISO();
  const existing = await getRow<UserTableSessionRow>(
    usersTableName(),
    { pk: userPk(actor.userId), sk: sessionSk(input.sessionId) },
    true
  );
  if (existing?.revokedAt) {
    throw new Error("This session was revoked. Please sign in again.");
  }
  if (existing) {
    const refreshed: UserTableSessionRow = {
      ...existing,
      lastSeenAt: now,
      ipAddress: input.ipAddress,
      country: input.country,
      deviceFingerprint: input.deviceFingerprint || existing.deviceFingerprint,
      plan,
    };
    await putRow(usersTableName(), refreshed);
    return refreshed;
  }

  const activeSessions = await listUserSessions(actor.userId);
  const limit = sessionLimitForPlan(plan);
  const sortedSessions = [...activeSessions].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt));
  if (sortedSessions.length >= limit) {
    const oldest = sortedSessions[0];
    if (oldest) {
      await putRow(usersTableName(), {
        pk: userPk(actor.userId),
        sk: sessionSk(oldest.sessionId),
        ...oldest,
        revokedAt: now,
        revokeReason: "concurrent_session_limit",
      } satisfies UserTableSessionRow);
      await recordEvent(actor, "CONCURRENT_SESSION_LIMIT_HIT", {
        evictedSessionId: oldest.sessionId,
        maxConcurrentSessions: limit,
        plan,
      });
    }
  }

  const session: UserTableSessionRow = {
    pk: userPk(actor.userId),
    sk: sessionSk(input.sessionId),
    userId: actor.userId,
    sessionId: input.sessionId,
    createdAt: now,
    lastSeenAt: now,
    deviceFingerprint: input.deviceFingerprint,
    ipAddress: input.ipAddress,
    country: input.country,
    plan,
    revokedAt: null,
    revokeReason: null,
  };
  await putRow(usersTableName(), session);

  const recentDistinctFingerprints = new Set(activeSessions.map((row) => row.deviceFingerprint).filter(Boolean));
  recentDistinctFingerprints.add(input.deviceFingerprint);
  if (recentDistinctFingerprints.size >= 4) {
    await recordEvent(actor, "DEVICE_FINGERPRINT_ANOMALY", {
      distinctFingerprints7d: recentDistinctFingerprints.size,
      plan,
    });
  }

  const recentSubnets = new Set(activeSessions.map((row) => ipSubnet(row.ipAddress)).filter(Boolean));
  recentSubnets.add(ipSubnet(input.ipAddress));
  if (recentSubnets.size >= 3) {
    await recordEvent(actor, "IP_ANOMALY_DETECTED", {
      distinctSubnets24h: recentSubnets.size,
      plan,
    });
  }

  return session;
}

export async function setUserAccountStatus(
  actor: RequestActor,
  userId: string,
  accountStatus: "active" | "suspended"
): Promise<UserProfileRecord | null> {
  const existing = await loadUserProfileRow(userId);
  if (!existing) return null;
  const updated = { ...existing, accountStatus };
  await putRow(usersTableName(), updated);
  await recordEvent(actor, "ADMIN_ACTION", { targetUserId: userId, accountStatus, action: "set_account_status" });
  return updated;
}

export async function findUserProfiles(search?: string): Promise<UserProfileRecord[]> {
  const query = search?.trim().toLowerCase();
  if (!query) {
    return scanRows<UserTableProfileRow>(usersTableName(), "sk = :profile", { ":profile": "PROFILE" }, 100);
  }
  if (query.includes("@")) {
    return queryRows<UserTableProfileRow>(
      usersTableName(),
      "gsi1pk = :email",
      { ":email": `EMAIL#${query}` },
      { indexName: "email-index", limit: 20 }
    );
  }
  const profile = await loadUserProfileRow(query.replace(/^USER#/, ""));
  return profile ? [profile] : [];
}

export async function loadAnnouncements(): Promise<AnnouncementRecord[]> {
  return queryRows<SupportAnnouncementRow>(
    supportTableName(),
    "pk = :pk",
    { ":pk": "ANNOUNCEMENT" },
    { limit: 50, scanIndexForward: false }
  );
}

export async function loadFeatureFlags(actor: RequestActor): Promise<FeatureFlagRecord[]> {
  const existing = await queryRows<SupportFeatureFlagRow>(
    supportTableName(),
    "pk = :pk",
    { ":pk": "FEATURE" },
    { limit: 50 }
  );
  if (existing.length) return existing;
  const defaults = defaultFeatureFlags(actor.userId);
  await Promise.all(defaults.map((flag) => putRow(supportTableName(), {
    pk: "FEATURE",
    sk: `CONFIG#${flag.flagName}`,
    ...flag,
  })));
  return defaults;
}

export async function loadSystemWorkdayLayerFlags(): Promise<{ layer2: boolean; layer3: boolean }> {
  // Background scans need global flag reads without depending on a user session.
  const existing = await queryRows<SupportFeatureFlagRow>(
    supportTableName(),
    "pk = :pk",
    { ":pk": "FEATURE" },
    { limit: 50 }
  );

  const layer2 = existing.find((flag) => flag.flagName === "workday_layer2_headless");
  const layer3 = existing.find((flag) => flag.flagName === "workday_layer3_scraperapi");

  return {
    layer2: layer2?.enabled === true,
    layer3: layer3?.enabled === true,
  };
}

export async function saveFeatureFlag(actor: RequestActor, input: FeatureFlagRecord): Promise<FeatureFlagRecord> {
  const next: FeatureFlagRecord = {
    ...input,
    enabledForPlans: input.enabledForPlans ?? [],
    enabledForUsers: input.enabledForUsers ?? [],
    rolloutPercent: Math.max(0, Math.min(100, Number(input.rolloutPercent) || 0)),
    updatedAt: nowISO(),
    updatedBy: actor.userId,
  };
  await putRow(supportTableName(), {
    pk: "FEATURE",
    sk: `CONFIG#${next.flagName}`,
    ...next,
  });
  await recordEvent(actor, "ADMIN_ACTION", { action: "save_feature_flag", flagName: next.flagName });
  return next;
}

export async function createAnnouncement(actor: RequestActor, input: AnnouncementRecord): Promise<AnnouncementRecord> {
  const next: AnnouncementRecord = {
    ...input,
    id: input.id || crypto.randomUUID(),
    updatedAt: nowISO(),
    updatedBy: actor.userId,
  };
  await putRow(supportTableName(), {
    pk: "ANNOUNCEMENT",
    sk: `CONFIG#${next.id}`,
    ...next,
  });
  await recordEvent(actor, "ADMIN_ACTION", { action: "save_announcement", announcementId: next.id });
  return next;
}

export async function createSupportTicket(
  actor: RequestActor,
  input: {
    subject: string;
    body: string;
    priority?: SupportTicketPriority;
    tags?: SupportTicketTag[];
  }
): Promise<SupportTicketRecord> {
  const createdAt = nowISO();
  const ticketId = await generateSupportTicketId();
  const ticket: SupportTicketRecord = {
    ticketId,
    userId: actor.userId,
    subject: input.subject.trim(),
    status: "open",
    priority: input.priority ?? "normal",
    tags: input.tags ?? [],
    assignedTo: null,
    createdAt,
    updatedAt: createdAt,
    resolvedAt: null,
  };
  await putRow(supportTableName(), {
    pk: ticketPk(ticketId),
    sk: "METADATA",
    gsi1pk: ticket.status,
    gsi1sk: createdAt,
    gsi2pk: actor.userId,
    gsi2sk: createdAt,
    gsi3pk: ticket.assignedTo ?? "UNASSIGNED",
    gsi3sk: createdAt,
    gsi4pk: ticket.tags[0] ?? undefined,
    gsi4sk: createdAt,
    ...ticket,
  } satisfies SupportTicketMetadataRow);
  await putRow(supportTableName(), {
    pk: ticketPk(ticketId),
    sk: `MESSAGE#${createdAt}#${actor.userId}`,
    ticketId,
    sender: actor.userId,
    senderType: actor.isAdmin ? "admin" : "user",
    body: input.body.trim(),
    attachments: [],
    createdAt,
    internal: false,
  } satisfies SupportTicketMessageRow);
  await putRow(supportTableName(), {
    pk: userPk(actor.userId),
    sk: `TICKET#${ticketId}`,
    ticketId,
    createdAt,
    gsi2pk: actor.userId,
    gsi2sk: createdAt,
  } satisfies SupportUserTicketLinkRow);
  await recordEvent(actor, "TICKET_CREATED", { ticketId, subject: ticket.subject });
  return ticket;
}

export async function appendSupportMessage(
  actor: RequestActor,
  ticketId: string,
  body: string,
  options?: { internal?: boolean }
): Promise<SupportTicketMessageRecord> {
  const createdAt = nowISO();
  const message: SupportTicketMessageRecord = {
    ticketId,
    sender: actor.userId,
    senderType: actor.isAdmin ? "admin" : "user",
    body: body.trim(),
    attachments: [],
    createdAt,
    internal: options?.internal === true,
  };
  await putRow(supportTableName(), {
    pk: ticketPk(ticketId),
    sk: `${message.internal ? "NOTE" : "MESSAGE"}#${createdAt}#${actor.userId}`,
    ...message,
  });
  const ticket = await getSupportTicket(ticketId);
  if (ticket) {
    const nextStatus: SupportTicketStatus = actor.isAdmin ? ticket.status : "open";
    await putRow(supportTableName(), {
      pk: ticketPk(ticketId),
      sk: "METADATA",
      gsi1pk: nextStatus,
      gsi1sk: ticket.createdAt,
      gsi2pk: ticket.userId,
      gsi2sk: ticket.createdAt,
      gsi3pk: ticket.assignedTo ?? "UNASSIGNED",
      gsi3sk: ticket.createdAt,
      gsi4pk: ticket.tags[0] ?? undefined,
      gsi4sk: ticket.createdAt,
      ...ticket,
      status: nextStatus,
      updatedAt: createdAt,
      resolvedAt: nextStatus === "resolved" ? createdAt : ticket.resolvedAt,
    } satisfies SupportTicketMetadataRow);
  }
  return message;
}

export async function getSupportTicket(ticketId: string): Promise<SupportTicketRecord | null> {
  return getRow<SupportTicketMetadataRow>(supportTableName(), { pk: ticketPk(ticketId), sk: "METADATA" }, true);
}

export async function listSupportTicketMessages(ticketId: string): Promise<SupportTicketMessageRecord[]> {
  const rows = await queryRows<SupportTicketMessageRow>(
    supportTableName(),
    "pk = :pk AND begins_with(sk, :prefix)",
    { ":pk": ticketPk(ticketId), ":prefix": "MESSAGE#" },
    { scanIndexForward: true, limit: 200 }
  );
  const notes = await queryRows<SupportTicketMessageRow>(
    supportTableName(),
    "pk = :pk AND begins_with(sk, :prefix)",
    { ":pk": ticketPk(ticketId), ":prefix": "NOTE#" },
    { scanIndexForward: true, limit: 200 }
  );
  return [...rows, ...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listUserTickets(actor: RequestActor): Promise<SupportTicketRecord[]> {
  return queryRows<SupportTicketMetadataRow>(
    supportTableName(),
    "gsi2pk = :userId",
    { ":userId": actor.userId },
    { indexName: "user-tickets-index", scanIndexForward: false, limit: 100 }
  );
}

export async function listAdminTickets(status?: SupportTicketStatus): Promise<SupportTicketRecord[]> {
  if (status) {
    return queryRows<SupportTicketMetadataRow>(
      supportTableName(),
      "gsi1pk = :status",
      { ":status": status },
      { indexName: "status-index", scanIndexForward: false, limit: 100 }
    );
  }
  return scanRows<SupportTicketMetadataRow>(supportTableName(), "sk = :metadata", { ":metadata": "METADATA" }, 100);
}

export async function verifyAdminBootstrapEmail(): Promise<string | null> {
  const adminUserPoolId = process.env.ADMIN_COGNITO_USER_POOL_ID;
  const adminBootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
  if (!adminUserPoolId || !adminBootstrapEmail) return null;
  try {
    const response = await cognito.send(new AdminGetUserCommand({
      UserPoolId: adminUserPoolId,
      Username: adminBootstrapEmail,
    }));
    return response.UserAttributes?.find((attribute) => attribute.Name === "email")?.Value ?? adminBootstrapEmail;
  } catch {
    return adminBootstrapEmail;
  }
}
