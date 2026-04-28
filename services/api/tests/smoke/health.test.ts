import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../../src/routes";
import type { Env } from "../../src/types";

const mockEnv = {
  JOB_STATE: {} as KVNamespace,
  ATS_CACHE: {} as KVNamespace,
  CONFIG_STORE: {} as KVNamespace,
  DB: {} as D1Database,
  ASSETS: {
    fetch: vi.fn(async () => new Response("not-used", { status: 200 })),
  },
  APP_NAME: "Career Jump Test",
} as unknown as Env;

describe("api smoke health", () => {
  it("returns 200 from /health with the expected runtime shape", async () => {
    const response = await handleRequest(new Request("http://localhost/health"), mockEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      appName: "Career Jump Test",
    });
  });
});
