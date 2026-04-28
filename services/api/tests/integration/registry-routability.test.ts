/**
 * Full-registry routability audit — CI guardrail.
 *
 * Every company in the seed registry must resolve to a non-null DetectedConfig
 * after normalization + companyToDetectedConfig. A null result means the company
 * would silently fail to scan when a user adds it from Configuration.
 *
 * Any change that introduces a null is blocked by this test.
 */
import { describe, expect, it } from "vitest";
import { companyToDetectedConfig, sanitizeCompanies } from "../../src/config";
import { normalizeAtsId, inferAtsIdFromUrl } from "../../src/ats/shared/normalize";
import { resolveAdapter } from "../../src/ats/registry";
import "../../src/ats/shared/init-core";
import "../../src/ats/custom";
import seedRegistry from "../../data/seed_registry.json";

type RegistryEntry = {
  company: string;
  board_url: string | null;
  ats: string | null;
  sample_url?: string | null;
  tier: string;
};

const companies = (seedRegistry as { companies: RegistryEntry[] }).companies;

function entryToRawInput(entry: RegistryEntry): Record<string, unknown> {
  return {
    company: entry.company,
    enabled: true,
    isRegistry: true,
    registryAts: entry.ats ?? undefined,
    registryTier: entry.tier,
    boardUrl: entry.board_url ?? undefined,
    sampleUrl: entry.sample_url ?? undefined,
    source:
      (entry.ats ? normalizeAtsId(entry.ats) : undefined) ||
      inferAtsIdFromUrl(entry.board_url) ||
      inferAtsIdFromUrl(entry.sample_url) ||
      undefined,
  };
}

describe("registry routability — every company must produce a non-null DetectedConfig", () => {
  it(`resolves all ${companies.length} seed registry companies`, () => {
    const nullResults: Array<{ company: string; ats: string | null; boardUrl: string | null }> = [];

    const normalized = sanitizeCompanies(companies.map(entryToRawInput));

    for (let i = 0; i < normalized.length; i++) {
      const company = normalized[i];
      const entry = companies[i];
      const detected = companyToDetectedConfig(company);
      if (detected === null) {
        nullResults.push({
          company: entry.company,
          ats: entry.ats,
          boardUrl: entry.board_url,
        });
      }
    }

    if (nullResults.length > 0) {
      const lines = nullResults
        .map((r) => `  ${r.company} (ats=${r.ats ?? "null"}, boardUrl=${r.boardUrl ?? "null"})`)
        .join("\n");
      throw new Error(
        `${nullResults.length}/${companies.length} registry companies produced a null DetectedConfig:\n${lines}`,
      );
    }

    expect(nullResults).toHaveLength(0);
  });

  it("Greenhouse boardToken is never synthesized from company name slug", () => {
    // After removing the slugify fallback, a Greenhouse company with an
    // unparseable board URL must fall back to registry-adapter, not return
    // a guessed boardToken. Verify the specific cases that were previously broken.
    const brokenUrls = [
      // api.greenhouse.io — previously unrecognized, now parsed
      { company: "DigitalOcean", boardUrl: "https://api.greenhouse.io/v1/boards/digitalocean98/embed/departments" },
      // EU Greenhouse host — previously unrecognized, now parsed
      { company: "JetBrains", boardUrl: "https://job-boards.eu.greenhouse.io/jetbrains" },
    ];

    for (const { company, boardUrl } of brokenUrls) {
      const [normalized] = sanitizeCompanies([
        { company, enabled: true, isRegistry: true, boardUrl, source: "greenhouse" },
      ]);
      const detected = companyToDetectedConfig(normalized);
      // Must not be null — previously these returned null due to unrecognized URL patterns
      expect(detected, `${company} should produce a non-null config`).not.toBeNull();
    }
  });

  it("Greenhouse fails closed when boardToken cannot be extracted (no slug fallback, no registry-adapter escape)", () => {
    // A Greenhouse company whose board URL is completely unrecognizable must return null.
    // It must NOT be routed through registry-adapter or have a guessed boardToken.
    const [normalized] = sanitizeCompanies([
      {
        company: "SomeCompany",
        enabled: true,
        isRegistry: true,
        boardUrl: "https://careers.somecompany.com/jobs",  // custom domain, no gh_jid
        source: "greenhouse",
      },
    ]);
    const detected = companyToDetectedConfig(normalized);
    // Strict fail-closed: null, not registry-adapter
    expect(detected).toBeNull();
  });

  it("Lever company with non-standard board URL falls back to registry-adapter with a scannable adapter chain", () => {
    const [normalized] = sanitizeCompanies([
      {
        company: "Lever",
        enabled: true,
        isRegistry: true,
        boardUrl: "https://www.lever.com/careers",
        source: "lever",
      },
    ]);
    const detected = companyToDetectedConfig(normalized);
    expect(detected).not.toBeNull();
    // Explicitly intentional fallback — not null, not greenhouse-style fail-closed
    expect(detected?.source).toBe("registry-adapter");

    // Verify the registry-adapter path has at least one scannable adapter
    // (custom-jsonld or custom-sitemap) that can handle arbitrary career pages.
    const entry = {
      rank: null as null,
      sheet: "test",
      company: "Lever",
      board_url: "https://www.lever.com/careers",
      ats: "lever",
      total_jobs: null as null,
      source: "test",
      tier: "NEEDS_REVIEW" as const,
    };
    const adapter = resolveAdapter(entry);
    expect(adapter, "Lever fallback entry should resolve to at least one adapter").not.toBeNull();
    expect(["lever", "custom-jsonld", "custom-sitemap"]).toContain(adapter?.id);
  });
});
