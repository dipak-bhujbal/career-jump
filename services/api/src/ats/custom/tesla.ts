import type { JobPosting } from "../../types";
import { atsJson } from "../shared/http";
import { registerAdapter } from "../shared/types";

/**
 * Tesla custom adapter.
 *
 * Tesla maintains its own job board at https://www.tesla.com/careers.
 * Their search endpoint returns JSON:
 *   https://www.tesla.com/cua-api/apps/careers/state
 *
 * Returns ~3,000 listings under `listings` array.
 */

const API = "https://www.tesla.com/cua-api/apps/careers/state";

type TeslaListing = {
  externalId?: string;
  id?: string;
  title?: string;
  shortDescription?: string;
  department?: string;
  region?: string;
  location?: string;
  type?: string;
  url?: string;
};

type TeslaState = {
  data?: { listings?: TeslaListing[] };
  listings?: TeslaListing[];
};

async function fetchAll(): Promise<TeslaListing[]> {
  const r = await atsJson<TeslaState>(API);
  return r?.data?.listings ?? r?.listings ?? [];
}

registerAdapter({
  id: "custom:tesla",
  kind: "custom",
  async validate() {
    return (await fetchAll()).length > 0;
  },
  async count() {
    return (await fetchAll()).length;
  },
  async fetchJobs(_c, companyName) {
    const listings = await fetchAll();
    return listings.map((j) => ({
      id: String(j.externalId ?? j.id ?? ""),
      title: j.title ?? "",
      company: companyName,
      location: j.location ?? j.region ?? "",
      url: j.url ?? `https://www.tesla.com/careers/search/job/${j.externalId ?? j.id}`,
      source: "custom:tesla" as never,
      department: j.department,
    } as JobPosting));
  },
});
