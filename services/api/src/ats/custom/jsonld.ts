import type { JobPosting } from "../../types";
import { atsText } from "../shared/http";
import { registerAdapter } from "../shared/types";

/**
 * Generic Schema.org JSON-LD JobPosting fallback.
 *
 * Many "Custom" career sites embed `application/ld+json` blocks with
 * `@type: "JobPosting"` because Google requires it for Google for Jobs
 * indexing. This adapter scrapes any URL and harvests every JobPosting it
 * finds.
 *
 * Registered with id `custom-jsonld` — the registry's `normalizeAtsId`
 * routes the literal label "Custom" to this adapter as a fallback.
 */

type JsonLdJobPosting = {
  "@type"?: string | string[];
  "@graph"?: JsonLdJobPosting[];
  identifier?: { value?: string | number } | string;
  title?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?:
    | { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }
    | Array<{ address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }>;
  datePosted?: string;
  url?: string;
  validThrough?: string;
  description?: string;
  employmentType?: string | string[];
};

function isJobPosting(item: unknown): item is JsonLdJobPosting {
  if (!item || typeof item !== "object") return false;
  const t = (item as JsonLdJobPosting)["@type"];
  if (!t) return false;
  return Array.isArray(t) ? t.includes("JobPosting") : t === "JobPosting";
}

/** Walk a JSON-LD value and collect every JobPosting node. */
function collect(node: unknown, out: JsonLdJobPosting[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const x of node) collect(x, out);
    return;
  }
  if (typeof node !== "object") return;
  if (isJobPosting(node)) out.push(node as JsonLdJobPosting);
  const obj = node as Record<string, unknown>;
  if ("@graph" in obj) collect(obj["@graph"], out);
}

function locStr(loc: JsonLdJobPosting["jobLocation"]): string {
  if (!loc) return "";
  const arr = Array.isArray(loc) ? loc : [loc];
  return arr
    .map((l) => {
      const a = l.address ?? {};
      return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(", ");
    })
    .filter(Boolean)
    .join(" / ");
}

function orgName(org: JsonLdJobPosting["hiringOrganization"]): string {
  if (typeof org === "string") return org;
  return org?.name ?? "";
}

function idOf(p: JsonLdJobPosting, fallback: string): string {
  const id = p.identifier;
  if (typeof id === "string") return id;
  if (id && typeof id === "object" && id.value !== undefined) return String(id.value);
  // Derive from URL hash
  if (p.url) {
    const m = p.url.match(/[?&/=#]([0-9]{4,})\b/);
    if (m) return m[1];
  }
  return fallback;
}

export async function fetchJsonLdJobs(boardUrl: string, companyName: string): Promise<JobPosting[]> {
  const html = await atsText(boardUrl);
  if (!html) return [];
  const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const postings: JsonLdJobPosting[] = [];
  for (const b of blocks) {
    const m = b.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      collect(parsed, postings);
    } catch {
      // Some sites embed multiple JSON objects in one script block — try line-splitting
      try {
        const parts = m[1].split(/\}\s*\{/);
        for (let i = 0; i < parts.length; i++) {
          let chunk = parts[i];
          if (i > 0) chunk = "{" + chunk;
          if (i < parts.length - 1) chunk = chunk + "}";
          try {
            collect(JSON.parse(chunk), postings);
          } catch {
            /* ignore individual chunk failures */
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return postings.map((p, i) => ({
    id: idOf(p, `jsonld-${i}`),
    title: p.title ?? "",
    company: orgName(p.hiringOrganization) || companyName,
    location: locStr(p.jobLocation),
    url: p.url ?? boardUrl,
    source: "custom-jsonld" as never,
    postedAt: p.datePosted,
  })).filter((j) => j.title);
}

export async function countJsonLdJobs(boardUrl: string): Promise<number> {
  return (await fetchJsonLdJobs(boardUrl, "")).length;
}

registerAdapter({
  id: "custom-jsonld",
  kind: "custom",
  async validate(c) {
    const jobs = await fetchJsonLdJobs(c.boardUrl, "");
    return jobs.length > 0;
  },
  count(c) {
    return countJsonLdJobs(c.boardUrl);
  },
  fetchJobs(c, company) {
    return fetchJsonLdJobs(c.boardUrl, company);
  },
});
