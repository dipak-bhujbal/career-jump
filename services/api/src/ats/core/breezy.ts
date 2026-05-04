import type { JobPosting } from "../../types";
import { atsJson } from "../shared/http";

/**
 * Breezy HR adapter.
 * Public JSON: https://{slug}.breezy.hr/json
 */
type BreezyJob = {
  id?: string;
  _id?: string;
  name?: string;
  title?: string;
  url?: string;
  apply_url?: string;
  type?: string;
  department?: string;
  category?: string;
  location?: { city?: string; state?: string; country?: string; name?: string } | string;
  published_date?: string;
  created_date?: string;
};

const HEADERS = { Accept: "application/json" };

function api(slug: string): string {
  return `https://${slug}.breezy.hr/json`;
}

export async function validateBreezySlug(slug: string): Promise<{ source: "breezy"; companySlug: string } | null> {
  const r = await atsJson<BreezyJob[]>(api(slug), { headers: HEADERS });
  return Array.isArray(r) ? { source: "breezy", companySlug: slug } : null;
}

export async function countBreezyJobs(slug: string): Promise<number> {
  const r = await atsJson<BreezyJob[]>(api(slug), { headers: HEADERS });
  return Array.isArray(r) ? r.length : 0;
}

function locStr(loc: BreezyJob["location"]): string {
  if (!loc) return "";
  if (typeof loc === "string") return loc;
  return loc.name ?? [loc.city, loc.state, loc.country].filter(Boolean).join(", ");
}

export async function fetchBreezyJobs(slug: string, companyName: string): Promise<JobPosting[]> {
  const r = await atsJson<BreezyJob[]>(api(slug), { headers: HEADERS });
  if (!Array.isArray(r)) return [];
  return r
    .map((j) => {
      const id = String(j.id ?? j._id ?? "");
      if (!id) return null;
      const url = j.apply_url ?? j.url ?? `https://${slug}.breezy.hr/p/${id}`;
      return {
        id,
        title: j.title ?? j.name ?? "",
        company: companyName,
        location: locStr(j.location),
        locationCity: typeof j.location === "object" && j.location ? j.location.city : undefined,
        locationState: typeof j.location === "object" && j.location ? j.location.state : undefined,
        locationCountry: typeof j.location === "object" && j.location ? j.location.country : undefined,
        url,
        source: "breezy" as never,
        department: j.department ?? j.category,
        postedAt: j.published_date ?? j.created_date,
      } as JobPosting;
    })
    .filter((x): x is JobPosting => x !== null);
}
