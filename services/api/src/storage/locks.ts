// Lock-related exports are grouped here for discoverability. The implementation
// still lives in core.ts so existing logic and signatures remain unchanged.
export {
  ActiveRunOwnershipError,
  acquireActiveRunLock,
  clearRunAbortRequest,
  clearActiveRunLock,
  ensureActiveRunOwnership,
  heartbeatActiveRun,
  isRunAbortRequested,
  isActiveRunOwnershipError,
  isRunLockStale,
  loadActiveRunLock,
  loadEmailSendAttempt,
  requestRunAbort,
  releaseActiveRunLock,
  reserveEmailSendAttempt,
  updateEmailSendAttempt,
} from "./core";
