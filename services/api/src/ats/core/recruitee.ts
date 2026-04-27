import type { JobPosting } from "../../types";
import { atsJson } from "../shared/http";

/**
 * Recruitee adapter.
 * Public API: https://{slug}.recruitee.com/api/offers
 */
type RecruiteeOffer = {
  id?: number | string;
  slug?: string;
  title?: string;
  city?: string;
  state_code?: string;
  country?: string;
  location?: string;
  careers_url?: string;
  careers_apply_url?: string;
  department?: string;
  function?: string;
  published_at?: string;
  created_at?: string;
};

type RecruiteeResponse = {
  offers?: RecruiteeOffer[];
};

const HEADERS = { Accept: "application/json" };

function api(slug: string): string {
  return `https://${slug}.recruitee.com/api/offers`;
}

export async function validateRecruiteeSlug(slug: string): Promise<{ source: "recruitee"; companySlug: string } | null> {
  const r = await atsJson<RecruiteeResponse>(api(slug), { headers: HEADERS });
  return r && Array.isArray(r.offers) ? { source: "recruitee", companySlug: slug } : null;
}

export async function countRecruiteeJobs(slug: string): Promise<number> {
  const r = await atsJson<RecruiteeResponse>(api(slug), { headers: HEADERS });
  return r?.offers?.length ?? 0;
}

export async function fetchRecruiteeJobs(slug: string, companyName: string): Promise<JobPosting[]> {
  const r = await atsJson<RecruiteeResponse>(api(slug), { headers: HEADERS });
  if (!r?.offers) return [];
  return r.offers
    .map((o) => {
      const id = String(o.id ?? "");
      if (!id) return null;
      const url = o.careers_apply_url ?? o.careers_url ?? `https://${slug}.recruitee.com/o/${o.slug ?? id}`;
      const location = o.location ?? [o.city, o.state_code, o.country].filter(Boolean).join(", ");
      return {
        id,
        title: o.title ?? "",
        company: companyName,
        location,
        url,
        source: "recruitee" as never,
        department: o.department ?? o.function,
        postedAt: o.published_at ?? o.created_at,
      } as JobPosting;
    })
    .filter((x): x is JobPosting => x !== null);
}
