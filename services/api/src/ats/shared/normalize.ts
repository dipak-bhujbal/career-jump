/**
 * Normalize ATS labels from the seed registry to canonical adapter ids.
 * Discovery sometimes labels the same provider differently (e.g.,
 * "Oracle Cloud" / "Oracle", "SAP SuccessFactors" / "SuccessFactors",
 * "Icims" / "iCIMS"). One normalizer means one place to fix it.
 */
const LABEL_TO_ID: Record<string, string> = {
  workday: "workday",
  greenhouse: "greenhouse",
  lever: "lever",
  ashby: "ashby",
  smartrecruiters: "smartrecruiters",
  icims: "icims",
  eightfold: "eightfold",
  phenom: "phenom",
  jobvite: "jobvite",
  oracle: "oracle",
  "oracle cloud": "oracle",
  "oracle cloud hcm": "oracle",
  taleo: "taleo",
  successfactors: "successfactors",
  "sap successfactors": "successfactors",
  workable: "workable",
  breezy: "breezy",
  recruitee: "recruitee",
  bamboohr: "bamboohr",
  "bamboo hr": "bamboohr",
  jazzhr: "jazzhr",
  custom: "custom-jsonld", // generic fallback for unknown custom
};

export function normalizeAtsId(label: string | null | undefined): string {
  if (!label) return "";
  const k = label.toLowerCase().trim();
  return LABEL_TO_ID[k] ?? k.replace(/\s+/g, "");
}
