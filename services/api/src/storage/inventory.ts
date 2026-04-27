// Inventory-adjacent helpers remain re-exported from core while the storage
// layout is split into domain-oriented entry points.
export {
  atsCacheKey,
  clearATSCache,
  deleteKvPrefix,
  firstSeenFingerprintKey,
  legacySeenJobKeys,
  loadDetectionCache,
  loadProtectedDiscovery,
  protectedDiscoveryKey,
  saveDetectionCache,
  saveProtectedDiscovery,
  seenJobKey,
  deleteProtectedDiscovery,
} from "./core";
