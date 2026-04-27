/**
 * Seed data used by `installMocks()` to populate the app for local UI
 * exercise without a running backend. Realistic enough to test every
 * filter, the kanban drag, hover-cards, and the run-progress monitor.
 */
import type {
  AppliedJob, Job, RegistryEntry, RegistryMeta, RuntimeConfig,
} from "@/lib/api";
import { REGISTRY_META } from "@/data/companies-registry";

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ago(ms: number): string { return new Date(NOW - ms).toISOString(); }

export const seedCompanies = [
  { company: "Stripe",    ats: "Greenhouse", tier: "TIER1_VERIFIED",  board_url: "https://job-boards.greenhouse.io/stripe" },
  { company: "Anthropic", ats: "Greenhouse", tier: "TIER1_VERIFIED",  board_url: "https://job-boards.greenhouse.io/anthropic" },
  { company: "OpenAI",    ats: "Ashby",      tier: "TIER1_VERIFIED",  board_url: "https://jobs.ashbyhq.com/openai" },
  { company: "Vercel",    ats: "Lever",      tier: "TIER1_VERIFIED",  board_url: "https://jobs.lever.co/vercel" },
  { company: "Linear",    ats: "Ashby",      tier: "TIER1_VERIFIED",  board_url: "https://jobs.ashbyhq.com/linear" },
  { company: "Figma",     ats: "Greenhouse", tier: "TIER1_VERIFIED",  board_url: "https://job-boards.greenhouse.io/figma" },
  { company: "Notion",    ats: "Greenhouse", tier: "TIER1_VERIFIED",  board_url: "https://job-boards.greenhouse.io/notion" },
  { company: "Walmart",   ats: "Workday",    tier: "TIER1_VERIFIED",  board_url: "https://walmart.wd5.myworkdayjobs.com/en-US/WalmartExternal" },
  { company: "Apple",     ats: "Custom",     tier: "TIER1_VERIFIED",  board_url: "https://jobs.apple.com/en-us/search" },
  { company: "Tesla",     ats: "Tesla",      tier: "TIER2_MEDIUM",   board_url: "https://www.tesla.com/careers/search" },
] as const;

const TITLES = [
  "Senior Software Engineer",
  "Staff Software Engineer, Platform",
  "Engineering Manager, Infrastructure",
  "Product Engineer",
  "Senior Frontend Engineer",
  "Staff Backend Engineer",
  "Principal Engineer, Distributed Systems",
  "Software Engineer, Growth",
  "Senior Site Reliability Engineer",
  "Engineering Lead, Developer Experience",
  "Senior Full-Stack Engineer",
  "Software Engineer II",
  "Staff Engineer, Identity",
  "Senior Mobile Engineer (iOS)",
  "Senior Mobile Engineer (Android)",
];

const LOCATIONS = ["San Francisco, CA", "New York, NY", "Remote (USA)", "Seattle, WA", "Austin, TX", "Remote (Global)", "Toronto, Canada", "London, UK"];

const MOCK_CHANGES: { field: string; from: string; to: string }[][] = [
  [{ field: "Title", from: "Software Engineer", to: "Senior Software Engineer" }, { field: "Location", from: "San Francisco, CA", to: "Remote (USA)" }],
  [{ field: "Location", from: "New York, NY", to: "Remote (USA)" }],
  [{ field: "Title", from: "Staff Engineer", to: "Staff Engineer, Identity" }, { field: "Salary", from: "$180k–$220k", to: "$200k–$250k" }],
  [{ field: "Salary", from: "$150k–$190k", to: "$160k–$200k" }],
  [{ field: "Title", from: "Senior Frontend Engineer", to: "Staff Frontend Engineer" }, { field: "Location", from: "Austin, TX", to: "Remote (USA)" }],
];

function pick<T>(arr: readonly T[], i: number): T { return arr[i % arr.length]; }

/** Build N jobs with a mix of new/updated flags spread over the last 30 days. */
export function buildJobs(): Job[] {
  const jobs: Job[] = [];
  for (let i = 0; i < 38; i++) {
    const company = pick(seedCompanies, i).company;
    const title = pick(TITLES, i + 3);
    const location = pick(LOCATIONS, i + 7);
    const postedAt = new Date(NOW - (1 + (i % 26)) * DAY - (i % 9) * HOUR);
    const isNew = i < 4;
    const isUpdated = !isNew && i % 7 === 0;
    jobs.push({
      jobKey: `${company.toLowerCase()}-${i}-${title.split(" ")[0].toLowerCase()}`,
      company,
      jobTitle: title,
      url: `https://example.com/jobs/${company.toLowerCase()}/${i}`,
      source: pick(seedCompanies, i).ats.toLowerCase(),
      location,
      postedAt: postedAt.toISOString(),
      postedAtDate: postedAt.toISOString().slice(0, 10),
      detectedCountry: location.includes("UK") ? "UK" : location.includes("Canada") ? "CA" : "US",
      usLikely: !location.includes("UK") && !location.includes("Canada"),
      isNew,
      isUpdated,
      changes: isUpdated ? MOCK_CHANGES[Math.floor(i / 7) % MOCK_CHANGES.length] : undefined,
      notes: i === 1 ? "Reached out to recruiter on LinkedIn 2 days ago." : "",
      noteRecords: i === 1 ? [
        { id: "n1", text: "Reached out to recruiter on LinkedIn 2 days ago.", createdAt: ago(2 * DAY) },
        { id: "n2", text: "Heard back — they want to schedule a call next week.", createdAt: ago(1 * DAY) },
      ] : i === 3 ? [
        { id: "n3", text: "Strong culture fit based on their engineering blog.", createdAt: ago(3 * DAY), updatedAt: ago(1 * DAY) },
      ] : [],
    });
  }
  return jobs;
}

export function buildAppliedJobs(): AppliedJob[] {
  const allJobs = buildJobs();
  const statuses: AppliedJob["status"][] = ["Applied", "Applied", "Applied", "Interview", "Interview", "Negotiations", "Offered", "Rejected"];
  return statuses.map((status, i) => {
    const job = allJobs[i + 5];
    return {
      jobKey: job.jobKey,
      job,
      appliedAt: ago((2 + i * 3) * DAY),
      status,
      notes: status === "Interview" ? "Onsite scheduled for next Wednesday." : "",
      noteRecords: status === "Interview" ? [
        { id: `${job.jobKey}-n1`, text: "Onsite scheduled for next Wednesday.", createdAt: ago(2 * DAY) },
      ] : [],
      interviewRounds: status === "Interview" || status === "Negotiations" ? [
        { id: `${job.jobKey}-r1`, number: 1, designation: "Recruiter screen", scheduledAt: ago(7 * DAY), outcome: "Passed", notes: "" },
        { id: `${job.jobKey}-r2`, number: 2, designation: "Hiring Manager", scheduledAt: ago(2 * DAY), outcome: status === "Negotiations" ? "Passed" : "Pending", notes: "" },
      ] : [],
      timeline: [],
      lastStatusChangedAt: ago(i * DAY),
    };
  });
}

export function buildActionPlan() {
  const applied = buildAppliedJobs();
  return applied
    .filter((j) => j.status === "Interview" || j.status === "Negotiations")
    .map((j) => ({
      jobKey: j.jobKey,
      company: j.job.company,
      jobTitle: j.job.jobTitle,
      notes: j.notes ?? "",
      appliedAt: j.appliedAt,
      appliedAtDate: j.appliedAt.slice(0, 10),
      interviewAt: j.interviewRounds?.[1]?.scheduledAt ?? null,
      interviewAtDate: j.interviewRounds?.[1]?.scheduledAt?.slice(0, 10) ?? null,
      outcome: j.interviewRounds?.[1]?.outcome ?? "Pending",
      currentRoundId: j.interviewRounds?.[1]?.id ?? "",
      currentRoundNumber: 2,
      interviewRounds: j.interviewRounds,
      timeline: [],
      url: j.job.url,
      location: j.job.location,
      source: j.job.source,
      postedAt: j.job.postedAt,
    }));
}

export function buildConfig(): RuntimeConfig {
  return {
    companies: seedCompanies.slice(0, 6).map((c) => ({
      company: c.company,
      enabled: true,
      source: c.ats.toLowerCase().replace(/\s+/g, ""),
      sampleUrl: c.board_url,
      isRegistry: true,
      registryAts: c.ats,
      registryTier: c.tier,
    })),
    jobtitles: {
      includeKeywords: ["senior", "staff", "principal", "engineer"],
      excludeKeywords: ["data analyst", "qa"],
    },
    updatedAt: ago(2 * DAY),
  };
}

export function buildRegistryMeta(): RegistryMeta {
  return {
    ok: true,
    meta: { version: REGISTRY_META.version, total: REGISTRY_META.total },
    loadedAt: NOW,
    adapters: [...REGISTRY_META.adapters],
    counts: {
      total: REGISTRY_META.total,
      tier1: REGISTRY_META.tier1,
      tier2: REGISTRY_META.tier2,
      tier3: REGISTRY_META.tier3,
      needsReview: REGISTRY_META.needsReview,
    },
  };
}

export function buildRegistryEntries(search?: string, ats?: string, tier?: string): RegistryEntry[] {
  let entries: RegistryEntry[] = seedCompanies.map((c, i) => ({
    rank: i + 1,
    sheet: "Registry",
    company: c.company,
    board_url: c.board_url,
    ats: c.ats,
    total_jobs: null,
    source: "registry",
    tier: c.tier as RegistryEntry["tier"],
  }));
  if (ats) entries = entries.filter((e) => (e.ats ?? "").toLowerCase() === ats.toLowerCase());
  if (tier) entries = entries.filter((e) => e.tier === tier);
  if (search) entries = entries.filter((e) => e.company.toLowerCase().includes(search.toLowerCase()));
  return entries;
}

export function buildDashboard() {
  const applied = buildAppliedJobs();
  const counts = applied.reduce<Record<string, number>>((acc, j) => {
    acc[j.status] = (acc[j.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    ok: true,
    kpis: {
      totalTrackedJobs: 142,
      availableJobs: 38,
      newJobsLatestRun: 4,
      updatedJobsLatestRun: 7,
      appliedJobs: applied.length,
      applicationRatio: 0.27,
      interviewRatio: 0.40,
      offerRatio: 0.13,
      interview: counts.Interview ?? 0,
      negotiations: counts.Negotiations ?? 0,
      offered: counts.Offered ?? 0,
      rejected: counts.Rejected ?? 0,
      companiesDetected: 6,
      companiesConfigured: 6,
      totalFetched: 312,
      matchRate: 0.46,
    },
    lastRunAt: ago(45 * 60 * 1000),
    statusBreakdown: counts,
    keywordCounts: {
      Senior: 18,
      Staff: 9,
      Principal: 4,
      Platform: 7,
      Infrastructure: 5,
      Frontend: 6,
      Backend: 8,
      "Full-Stack": 3,
    },
  };
}
