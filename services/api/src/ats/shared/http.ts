/**
 * Shared HTTP helper for ATS adapters.
 *
 * Centralizes:
 *   - Consistent User-Agent across all adapters
 *   - Default timeout (so a slow ATS can't stall the whole pipeline)
 *   - Retry on transient 429/5xx with exponential backoff
 *   - JSON parsing helpers with safe error handling
 */

const DEFAULT_UA = "career-jump/1.0 (+https://github.com/ruvnet/career-jump-aws)";
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export type FetchOpts = RequestInit & {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

export async function atsFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
    retryDelayMs = 500,
    headers,
    signal: outerSignal,
    ...rest
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    // Combine outer + inner signals
    const onOuterAbort = () => ctrl.abort();
    if (outerSignal) outerSignal.addEventListener("abort", onOuterAbort, { once: true });

    try {
      const r = await fetch(url, {
        ...rest,
        signal: ctrl.signal,
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "application/json,text/html,*/*",
          ...(headers ?? {}),
        },
      });
      if (RETRY_STATUSES.has(r.status) && attempt < retries) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }
      return r;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(t);
      if (outerSignal) outerSignal.removeEventListener("abort", onOuterAbort);
    }
  }
  throw lastError ?? new Error(`atsFetch exhausted retries: ${url}`);
}

export async function atsJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T | null> {
  try {
    const r = await atsFetch(url, opts);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function atsText(url: string, opts: FetchOpts = {}): Promise<string | null> {
  try {
    const r = await atsFetch(url, opts);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
