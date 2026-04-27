// Registry metadata only. Company data is served from the backend API (/api/registry/companies).
// Do not add company records here — they are proprietary and must stay server-side.
export const REGISTRY_META = {
  total: 1230,
  tier1: 1123,
  tier2: 36,
  tier3: 27,
  needsReview: 44,
  adapters: ["Ashby", "BambooHR", "Breezy", "Custom", "Deel", "Eightfold", "Gem", "Greenhouse", "Icims", "Lever", "Oracle", "Oracle Cloud", "Phenom", "Recruitee", "SAP SuccessFactors", "SmartRecruiters", "SuccessFactors", "Taleo", "Tesla custom", "Workable", "Workday", "iCIMS"],
  version: "final-v5",
  generated: "2026-04-25",
} as const;
