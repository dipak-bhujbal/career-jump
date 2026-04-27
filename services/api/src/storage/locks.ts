// Lock-related exports are grouped here for discoverability. The implementation
// still lives in core.ts so existing logic and signatures remain unchanged.
export {
  ActiveRunOwnershipError,
  acquireActiveRunLock,
  clearActiveRunLock,
  ensureActiveRunOwnership,
  heartbeatActiveRun,
  isActiveRunOwnershipError,
  isRunLockStale,
  loadActiveRunLock,
  loadEmailSendAttempt,
  releaseActiveRunLock,
  reserveEmailSendAttempt,
  updateEmailSendAttempt,
} from "./core";
