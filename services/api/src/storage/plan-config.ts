import { billingTableName, getRow, putRow } from "../aws/dynamo";
import { nowISO } from "../lib/utils";
import type { PlanConfig, UserPlan } from "../types";

const PLAN_CONFIG_PK = "PLAN_CONFIG";
const CACHE_TTL_MS = 5 * 60 * 1000;

type PlanConfigRow = PlanConfig & { pk: string; sk: UserPlan };

type CacheEntry = { configs: Map<UserPlan, PlanConfig>; expiresAt: number };
let _cache: CacheEntry | null = null;

const DEFAULTS: Record<UserPlan, Omit<PlanConfig, "updatedAt" | "updatedBy">> = {
  starter: {
    plan: "starter",
    displayName: "Starter",
    scanCacheAgeHours: 4,
    canTriggerLiveScan: true,
    maxCompanies: 10,
    maxSessions: 1,
    maxVisibleJobs: 40,
    maxAppliedJobs: 150,
    emailNotificationsEnabled: false,
    weeklyDigestEnabled: false,
    maxEmailsPerWeek: 3,
    enabledFeatures: [],
  },
  free: {
    plan: "free",
    displayName: "Free",
    scanCacheAgeHours: 0,
    canTriggerLiveScan: false,
    maxCompanies: 5,
    maxSessions: 1,
    maxVisibleJobs: 15,
    maxAppliedJobs: 50,
    emailNotificationsEnabled: false,
    weeklyDigestEnabled: false,
    maxEmailsPerWeek: 0,
    enabledFeatures: [],
  },
  pro: {
    plan: "pro",
    displayName: "Pro",
    scanCacheAgeHours: 8,
    canTriggerLiveScan: true,
    maxCompanies: 25,
    maxSessions: 2,
    maxVisibleJobs: 100,
    maxAppliedJobs: 500,
    emailNotificationsEnabled: true,
    weeklyDigestEnabled: true,
    maxEmailsPerWeek: 7,
    enabledFeatures: ["email_notifications", "weekly_digest"],
  },
  power: {
    plan: "power",
    displayName: "Power",
    scanCacheAgeHours: 4,
    canTriggerLiveScan: true,
    maxCompanies: null,
    maxSessions: 3,
    maxVisibleJobs: null,
    maxAppliedJobs: null,
    emailNotificationsEnabled: true,
    weeklyDigestEnabled: true,
    maxEmailsPerWeek: 14,
    enabledFeatures: ["email_notifications", "weekly_digest", "priority_scan", "advanced_filters"],
  },
};

function defaultPlanConfig(plan: UserPlan): PlanConfig {
  return { ...DEFAULTS[plan], updatedAt: "2026-04-28T00:00:00.000Z", updatedBy: "system" };
}

export async function loadPlanConfig(plan: UserPlan): Promise<PlanConfig> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return _cache.configs.get(plan) ?? defaultPlanConfig(plan);
  }
  const row = await getRow<PlanConfigRow>(billingTableName(), { pk: PLAN_CONFIG_PK, sk: plan });
  const config = row ?? defaultPlanConfig(plan);
  // Populate cache with at least this plan; full load happens via loadAllPlanConfigs
  if (!_cache || _cache.expiresAt <= now) {
    _cache = { configs: new Map([[plan, config]]), expiresAt: now + CACHE_TTL_MS };
  } else {
    _cache.configs.set(plan, config);
  }
  return config;
}

export async function loadAllPlanConfigs(): Promise<PlanConfig[]> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now && _cache.configs.size === 4) {
    return Array.from(_cache.configs.values());
  }
  const plans: UserPlan[] = ["free", "starter", "pro", "power"];
  const rows = await Promise.all(plans.map((p) => getRow<PlanConfigRow>(billingTableName(), { pk: PLAN_CONFIG_PK, sk: p })));
  const configs = plans.map((p, i) => rows[i] ?? defaultPlanConfig(p));
  _cache = {
    configs: new Map(plans.map((p, i) => [p, configs[i] as PlanConfig])),
    expiresAt: now + CACHE_TTL_MS,
  };
  return configs;
}

export async function savePlanConfig(updatedBy: string, config: Omit<PlanConfig, "updatedAt" | "updatedBy">): Promise<PlanConfig> {
  const full: PlanConfig = { ...config, updatedAt: nowISO(), updatedBy };
  const row: PlanConfigRow = { ...full, pk: PLAN_CONFIG_PK, sk: config.plan };
  await putRow(billingTableName(), row);
  // Invalidate cache so next read reflects new config
  _cache = null;
  return full;
}
