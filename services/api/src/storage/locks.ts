// Lock-related exports are grouped here for discoverability. The implementation
// still lives in core.ts so tenant-aware lock changes stay centralized.
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
