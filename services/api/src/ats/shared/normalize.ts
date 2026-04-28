/**
 * Normalize ATS labels from the seed registry to canonical adapter ids.
 * Discovery sometimes labels the same provider differently (e.g.,
 * "Oracle Cloud" / "Oracle", "SAP SuccessFactors" / "SuccessFactors",
 * "Icims" / "iCIMS"). One normalizer means one place to fix it.
 */
const LABEL_TO_ID: Record<string, string> = {
  workday: "workday",
  greenhouse: "greenhouse",
  gem: "custom-jsonld",
  lever: "lever",
  ashby: "ashby",
  smartrecruiters: "smartrecruiters",
  deel: "custom-jsonld",
  icims: "icims",
  "icims careers": "icims",
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
  "tesla custom": "custom-jsonld",
  custom: "custom-jsonld", // generic fallback for unknown custom
};

export function normalizeAtsId(label: string | null | undefined): string {
  if (!label) return "";
  const k = label.toLowerCase().trim();
  return LABEL_TO_ID[k] ?? k.replace(/\s+/g, "");
}

/**
 * Some registry rows have no ATS label or carry an imprecise one, but their
 * canonical board URL still clearly identifies the provider. Use the URL as a
 * second source of truth so valid companies do not become unscannable.
 */
export function inferAtsIdFromUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) return "";

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    if (host.includes("myworkdayjobs.com")) return "workday";
    if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io" || host === "boards-api.greenhouse.io") {
      return "greenhouse";
    }
    if (url.searchParams.has("gh_jid")) return "greenhouse";
    if (host.endsWith("ashbyhq.com")) return "ashby";
    if (host === "jobs.lever.co") return "lever";
    if (host === "jobs.smartrecruiters.com" || host === "careers.smartrecruiters.com" || host === "api.smartrecruiters.com") {
      return "smartrecruiters";
    }
    if (host.includes("oraclecloud.com") || path.includes("/hcmui/candidateexperience/")) return "oracle";
    if (/career[0-9]*\.successfactors\.com$/i.test(host)) return "successfactors";
    if (host.includes("apply.workable.com")) return "workable";
    if (host.endsWith(".breezy.hr")) return "breezy";
    if (host.includes("icims.com")) return "icims";
    if (host.endsWith(".recruitee.com")) return "recruitee";
    if (host.includes("jobs.gem.com")) return "custom-jsonld";
    if (host.includes("jobs.deel.com")) return "custom-jsonld";
  } catch {
    return "";
  }

  return "";
}
