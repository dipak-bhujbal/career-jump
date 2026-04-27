/**
 * ATS module barrel — back-compat re-exports so existing call sites
 * (`import { fetchAshbyJobs } from "../ats/ashby"`) continue to work after
 * the core/custom split.
 *
 * For NEW code, prefer the registry dispatcher:
 *   import { getAdapter, fetchJobsForEntry } from "../ats/registry";
 */

// Core ATS adapters
export * from "./core/ashby";
export * from "./core/greenhouse";
export * from "./core/lever";
export * from "./core/smartrecruiters";
export * from "./core/workday";

// New core adapters (added in arch refactor)
export * from "./core/eightfold";
export * from "./core/phenom";
export * from "./core/jobvite";
export * from "./core/icims";
export * from "./core/oracle";

// Shared interface + dispatcher
export type { AtsAdapter, AdapterConfig, FetchOptions } from "./shared/types";
export { getAdapter, listAdapters } from "./shared/types";
export { countJobs, fetchJobsForEntry, loadRegistry } from "./registry";
export type { RegistryEntry, SeedRegistry } from "./registry";
