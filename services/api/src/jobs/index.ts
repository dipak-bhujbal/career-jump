/**
 * Jobs pipeline barrel — single import for all stages.
 *
 * Usage:
 *   import { pipe, filters, enrichers, reducers } from "../jobs";
 *
 *   const out = await pipe(rawJobs, ctx,
 *     enrichers.normalizeLocation,
 *     filters.byCountry(["US"]),
 *     enrichers.extractSeniority,
 *     enrichers.extractCompType,
 *     enrichers.extractSalary,
 *     enrichers.computeFingerprint,
 *     reducers.dedupeByFingerprint,
 *     reducers.rankByRelevance,
 *   );
 */
export { pipe, runStateful, buildPipeline } from "./pipeline";
export type { Filter, Enricher, Reducer, Stage, StatefulStage, FilterContext, UserPreferences, SeniorityLevel } from "./types";

import * as byCountryMod from "./filters/byCountry";
import * as byKeywordsMod from "./filters/byKeywords";
import * as byJobTitleMod from "./filters/byJobTitle";
import * as byLocationMod from "./filters/byLocation";
import * as byPostedDateMod from "./filters/byPostedDate";
import * as byDepartmentMod from "./filters/byDepartment";

import * as normalizeLocationMod from "./enrichers/normalizeLocation";
import * as extractSeniorityMod from "./enrichers/extractSeniority";
import * as extractCompTypeMod from "./enrichers/extractCompType";
import * as extractSalaryMod from "./enrichers/extractSalary";
import * as computeFingerprintMod from "./enrichers/computeFingerprint";

import * as dedupeByFingerprintMod from "./reducers/dedupeByFingerprint";
import * as dedupeByApplyUrlMod from "./reducers/dedupeByApplyUrl";
import * as rankByRelevanceMod from "./reducers/rankByRelevance";

export const filters = {
  byCountry: byCountryMod.byCountry,
  usOnly: byCountryMod.usOnly,
  byKeywords: byKeywordsMod.byKeywords,
  byJobTitle: byJobTitleMod.byJobTitle,
  byCity: byLocationMod.byCity,
  byState: byLocationMod.byState,
  remoteOnly: byLocationMod.remoteOnly,
  excludeRemote: byLocationMod.excludeRemote,
  onsiteOnly: byLocationMod.onsiteOnly,
  byPostedDate: byPostedDateMod.byPostedDate,
  lastWeek: byPostedDateMod.lastWeek,
  lastMonth: byPostedDateMod.lastMonth,
  byDepartment: byDepartmentMod.byDepartment,
};

export const enrichers = {
  normalizeLocation: normalizeLocationMod.normalizeLocation,
  extractSeniority: extractSeniorityMod.extractSeniority,
  extractCompType: extractCompTypeMod.extractCompType,
  extractSalary: extractSalaryMod.extractSalary,
  computeFingerprint: computeFingerprintMod.computeFingerprint,
};

export const reducers = {
  dedupeByFingerprint: dedupeByFingerprintMod.dedupeByFingerprint,
  dedupeByApplyUrl: dedupeByApplyUrlMod.dedupeByApplyUrl,
  rankByRelevance: rankByRelevanceMod.rankByRelevance,
};
