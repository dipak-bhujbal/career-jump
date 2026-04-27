import type { JobPosting } from "../../types";
import { atsJson } from "../shared/http";

/**
 * BambooHR adapter.
 * Public list: https://{slug}.bamboohr.com/careers/list
 * Single posting: https://{slug}.bamboohr.com/careers/{id}
 */
type BambooJob = {
  id?: number | string;
  jobOpeningName?: string;
  jobOpeningStatus?: string;
  city?: string;
  state?: string;
  country?: string;
  location?: { city?: string; state?: string; country?: string };
  departmentLabel?: string;
  employmentStatusLabel?: string;
  datePosted?: string;
};

type BambooListResponse = {
  result?: BambooJob[];
};

const HEADERS = { Accept: "application/json" };

function api(slug: string): string {
  return `https://${slug}.bamboohr.com/careers/list`;
}

export async function validateBambooSlug(slug: string): Promise<{ source: "bamboohr"; companySlug: string } | null> {
  const r = await atsJson<BambooListResponse>(api(slug), { headers: HEADERS });
  return r && Array.isArray(r.result) ? { source: "bamboohr", companySlug: slug } : null;
}

export async function countBambooJobs(slug: string): Promise<number> {
  const r = await atsJson<BambooListResponse>(api(slug), { headers: HEADERS });
  return r?.result?.length ?? 0;
}

export async function fetchBambooJobs(slug: string, companyName: string): Promise<JobPosting[]> {
  const r = await atsJson<BambooListResponse>(api(slug), { headers: HEADERS });
  if (!r?.result) return [];
  return r.result
    .map((j) => {
      const id = String(j.id ?? "");
      if (!id) return null;
      const loc = j.location ?? { city: j.city, state: j.state, country: j.country };
      return {
        id,
        title: j.jobOpeningName ?? "",
        company: companyName,
        location: [loc.city, loc.state, loc.country].filter(Boolean).join(", "),
        url: `https://${slug}.bamboohr.com/careers/${id}`,
        source: "bamboohr" as never,
        department: j.departmentLabel,
        postedAt: j.datePosted,
      } as JobPosting;
    })
    .filter((x): x is JobPosting => x !== null);
}
