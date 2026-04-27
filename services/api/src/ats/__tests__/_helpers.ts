import { afterEach, vi } from "vitest";

/**
 * Test helpers for ATS adapters.
 *
 * Stubs global `fetch` per-test with a predictable response. Resets after
 * each test so tests stay isolated.
 */

export type StubResponse = {
  status?: number;
  body?: unknown;
  text?: string;
  /** Predicate over (url, init) — only intercept matching requests. */
  match?: (url: string, init?: RequestInit) => boolean;
};

export function stubFetch(responses: StubResponse[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const idx = queue.findIndex((r) => (r.match ? r.match(url, init) : true));
      const r = idx >= 0 ? queue[idx] : null;
      if (idx >= 0) queue.splice(idx, 1);
      const status = r?.status ?? 200;
      const body =
        r?.body !== undefined ? JSON.stringify(r.body) : r?.text ?? "";
      return new Response(body, { status, headers: { "Content-Type": "application/json" } });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});
