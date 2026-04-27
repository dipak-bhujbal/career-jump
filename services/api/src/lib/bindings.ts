import type { Env } from "../types";

/**
 * Small binding helpers keep KV usage centralized and make the orchestrator code easier to read.
 */
export function jobStateKv(env: Env): KVNamespace {
  return env.JOB_STATE;
}

export function atsCacheKv(env: Env): KVNamespace {
  return env.ATS_CACHE;
}

export function configStoreKv(env: Env): KVNamespace {
  return env.CONFIG_STORE;
}

export function d1Db(env: Env): D1Database {
  return env.DB;
}
