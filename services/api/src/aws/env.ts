import { DynamoKvNamespace } from "./kv";
import type { Env } from "../types";

const notFoundAssets = {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
};

export function makeAwsEnv(): Env {
  return {
    JOB_STATE: new DynamoKvNamespace("JOB_STATE") as unknown as KVNamespace,
    ATS_CACHE: new DynamoKvNamespace("ATS_CACHE") as unknown as KVNamespace,
    CONFIG_STORE: new DynamoKvNamespace("CONFIG_STORE") as unknown as KVNamespace,
    DB: {} as D1Database,
    ASSETS: notFoundAssets,
    APP_NAME: process.env.APP_NAME ?? "Career Jump",
    APP_ENV: process.env.APP_ENV ?? "aws-poc",
    DEFAULT_TENANT_EMAIL: process.env.DEFAULT_TENANT_EMAIL,
    APPS_SCRIPT_WEBHOOK_URL: process.env.APPS_SCRIPT_WEBHOOK_URL || undefined,
    APPS_SCRIPT_SHARED_SECRET: process.env.APPS_SCRIPT_SHARED_SECRET || undefined,
    SES_FROM_EMAIL: process.env.SES_FROM_EMAIL || undefined,
  };
}
