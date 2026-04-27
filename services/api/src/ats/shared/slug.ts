/**
 * Slug + URL parsing helpers used across adapters.
 */

/** Strip corporate suffixes/qualifiers from a company name. */
export function cleanCompanyName(name: string): string {
  let n = name.replace(/^The\s+/i, "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
  n = n.replace(/[,]?\s+(Inc|Incorporated|LLC|L\.L\.C\.|Ltd|Limited|Corp|Corporation|Co|Company|PLC|N\.V\.|S\.A\.|AG|GmbH|N\.A\.)[.]?$/i, "").trim();
  const trailers = [
    "Holdings", "Holding", "Group", "Companies", "Industries", "Enterprises",
    "International", "Worldwide", "Global", "Healthcare", "Financial",
    "Technologies", "Services", "Solutions", "Brands", "Bancorp", "Bancshares",
    "Properties", "Resources",
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of trailers) {
      const re = new RegExp(`\\s+${t}$`, "i");
      if (re.test(n)) { n = n.replace(re, "").trim(); changed = true; }
    }
  }
  return n;
}

/** Convert a company name to a likely ATS slug. */
export function slugify(name: string): string {
  return cleanCompanyName(name)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Take the last non-empty path segment of a URL. */
export function lastPathSegment(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

/** Take the leftmost subdomain of a URL's hostname. */
export function subdomain(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "";
  }
}

/** Generate plausible slug variants for a company. */
export function slugVariants(name: string): string[] {
  const base = slugify(name);
  const variants = new Set<string>([base]);
  variants.add(name.toLowerCase().replace(/&/g, "and").replace(/[,.]/g, "").trim().replace(/\s+/g, "-"));
  const words = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words[0] && words[0].length >= 4) variants.add(words[0]);
  if (words.length >= 2) variants.add(`${words[0]}${words[1]}`);
  return [...variants].filter((s) => s.length >= 3);
}
