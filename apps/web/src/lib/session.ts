const SESSION_ID_KEY = "cj:session-id";

function randomSessionId(): string {
  return (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getSessionId(): string {
  const existing = localStorage.getItem(SESSION_ID_KEY)?.trim();
  if (existing) return existing;
  const next = randomSessionId();
  localStorage.setItem(SESSION_ID_KEY, next);
  return next;
}

export function clearSessionId(): void {
  localStorage.removeItem(SESSION_ID_KEY);
}

/**
 * Lightweight, low-friction fingerprinting is enough for anomaly logging
 * without pulling in invasive browser fingerprint techniques.
 */
export function getDeviceFingerprint(): string {
  const raw = [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
  ].join("|");

  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(index);
    hash |= 0;
  }
  return `fp-${Math.abs(hash)}`;
}
