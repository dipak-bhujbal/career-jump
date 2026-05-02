#!/usr/bin/env node
/**
 * Apply one-off registry cleanup instructions from the user:
 * - rename selected companies
 * - delete selected companies
 * - overlay manually corrected board metadata from a broken-URLs JSON export
 *
 * The download file currently has one missing comma, so this script repairs
 * that known syntax issue in-memory before parsing. We keep the source file
 * untouched and only update the repo's seed registry JSON.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const seedPath = resolve("services/api/data/seed_registry.json");
const brokenPath = process.argv[2] ?? "/Users/dbhujbal/Downloads/registry-board-url-broken-2026-04-30.json";

const RENAME_MAP = new Map([
  ["Insomnia", "solera"],
  ["TSMC", "CiscoTango"],
  ["Jira", "Swift"],
  ["Lattice Semiconductor", "lattice"],
  ["Udemy", "Alcon"],
]);

const DELETE_COMPANIES = new Set([
  "AccelByte Inc",
  "Airbyte",
  "American Airlines Group",
  "Boise Cascade",
  "Census",
  "Cheesecake Factory",
  "CodeSandbox",
  "Costco Wholesale",
  "Cruise (GM)",
  "DirecTV",
  "Eppo",
  "Glacier Bancorp",
  "GreyNoise Intelligence",
  "Hanesbrands",
  "Honeywell",
  "Hubbell",
  "Interpublic Group",
  "imgix",
  "Kajabi",
  "Lever",
  "Linden Lab",
  "Lokalise",
  "Loom",
  "mantech",
  "MessageBird",
  "Midjourney",
  "Monday.com",
  "Neon Database",
  "Nuvei",
  "Oracle",
  "PDF Solutions",
  "Railway",
  "Room to Read",
  "SendGrid",
  "Siemens",
  "Splunk",
  "Twitter/X",
  "Unbounce",
  "United Airlines Holdings",
  "Zimmer",
  "Activision Blizzard",
  "Adecco USA",
  "Akamai Technologies",
  "Alnylam Pharmaceuticals",
  "AMC Theatres",
  "Amedisys",
  "American Tower Corporation",
  "American University",
  "AptarGroup",
  "Aramark",
  "Ardent Health Services",
  "Arhaus",
  "Asbury Automotive Group",
  "Ascension Health",
  "Ashley Furnitur",
  "Atrium Health",
  "Auburn University",
  "AuditBoard",
  "Auto-Owners Insurance",
  "AutoZone",
  "Avis Budget Group",
  "Baker Hughes",
  "Banner Health",
  "Bass Pro Shops / Cabela's",
  "Bassett Furniture Industries",
  "BayCare Health System",
  "Baylor Scott & White Health",
  "Beaumont Health",
  "Belden Inc",
  "Best Buy",
  "Bill.com",
  "Bloomin' Brands",
  "Blueprint Medicines",
  "Bob Evans Farms",
  "Bob's Discount Furniture",
  "Bon Secours Mercy Health",
  "Boston University",
  "Brinker International",
  "Burlington Stores",
  "BWX Technologies",
  "Cardiovascular Systems Inc",
  "Carlyle Group",
  "Carter's Inc",
  "Case Western Reserve University",
  "Cava Group",
  "CBRE Group",
  "Cedar Fair (now Six Flags merged)",
  "Celestica",
  "Ceridian (Dayforce)",
  "Cerner (Oracle Health)",
  "Chargebee",
  "Charles River Laboratories",
  "CHRISTUS Health",
  "Chubb Limited",
  "Cleveland Clinic",
  "CMS Energy",
  "Columbia University",
  "CommonSpirit Health",
  "Compass Group USA",
  "Concentra",
  "Condé Nast",
  "Conduent",
  "ConocoPhillips",
  "Consolidated Communications",
  "Container Store",
  "CoreLogic",
  "Cracker Barrel",
  "Crate & Barrel (Euromarket Designs)",
  "Crown Castle",
  "CyberArk Software",
  "DeepScribe",
  "Delaware North",
  "Dell Technologies",
  "DePaul University",
  "Dignity Health",
  "Dine Brands Global",
  "Discover Financial Services",
  "Docusign",
  "Dollar General",
  "Donegal Insurance Group",
  "Dorman Products",
  "Dotdash Meredith",
  "Dover Corporation",
  "Drexel University",
  "Drift",
  "Duke Health",
  "Duke University",
  "Dutch Bros Coffee",
  "Dynatrace",
  "ECU Health",
  "El Camino Health",
  "El Pollo Loco",
  "Emory Healthcare",
  "Emory University",
  "Encompass Health",
  "EPAM Systems",
  "Erie Indemnity",
  "Erie Insurance Group",
  "Ethan Allen",
  "Everi Holdings",
  "FAT Brands",
  "First American Financial",
  "First Watch Restaurant Group",
  "Floor & Decor",
  "Fisher Phillips",
  "Fluor Corporation",
  "Focus Brands",
  "Foot Locker",
  "Fordham University",
  "Freedom Mortgage",
  "Frontier Airlines",
  "George Washington University",
  "Giant Eagle",
  "Grand Canyon University",
  "Graphic Packaging International",
  "Gray Television",
  "Greenberg Traurig",
  "Grocery Outlet",
  "Halliburton",
  "Harbor Freight Tools",
  "Harman International (Samsung)",
  "HCA Healthcare",
  "Headspace Health",
  "Heap Analytics",
  "HEICO Corporation",
  "Hershey Company",
  "Hertz Global Holdings",
  "Howard University",
  "Hubbell Incorporated",
  "Hunton Andrews Kurth",
  "Hyatt Hotels",
  "IGT (International Game Technology)",
  "Indiana University",
  "Informatica",
  "Iowa State University",
  "Jack Henry & Associates",
  "JetBlue Airways",
  "Johns Hopkins University",
  "Kaman Corporation",
  "Kansas State University",
  "Kellanova",
  "Kelly Services",
  "Kettering Health",
  "Kforce",
  "Khoros",
  "KKR",
  "Kratos Defense",
  "La-Z-Boy",
  "Lee Enterprises",
  "Lee Health",
  "Legacy Health",
  "Leggett & Platt",
  "Liberty University",
  "Lionsgate Entertainment",
  "Littler Mendelson",
  "Live Nation Entertainment",
  "LoanDepot",
  "Loom Inc",
  "Loyola University Chicago",
  "Lululemon",
  "mParticle",
  "Marcus & Millichap",
  "Marquette University",
  "Maximus Federal",
  "McCormick & Company",
  "McGuireWoods",
  "McLaren Health Care",
  "Medallia",
  "Mercury Systems",
  "Mettler-Toledo",
  "Michigan State University",
  "MicroStrategy",
  "Mississippi State University",
  "MITRE Corporation",
  "Modine Manufacturing",
  "Monro Muffler Brake",
  "Mr Cooper Group",
  "Mutual of Omaha",
  "Noodles & Company",
  "North Dakota State University",
  "Northwell Health",
  "Norton Rose Fulbright",
  "Novant Health",
  "Nuance Communications",
  "NYU Langone Health",
  "Ogletree Deakins",
  "OHSU Health",
  "Oklahoma State University",
  "Oracle Health",
  "Oracle Health (Cerner)",
  "Owens & Minor",
  "Pacific Life Insurance",
  "Palomar Health",
  "Parker Hannifin",
  "Paylocity",
  "PeaceHealth",
  "Pennymac",
  "Penske Automotive Group",
  "PetSmart",
  "Piedmont Healthcare",
  "Pilgrim's Pride",
  "Polestar",
  "Potbelly Corporation",
  "Prisma Health",
  "Primerica",
  "Protagonist Therapeutics",
  "Protective Life",
  "Providence Health & Services",
  "Quaker Houghton",
  "Qualcomm",
  "Qualtrics",
  "Radian Group",
  "Rapid7",
  "Realty Income Corporation",
  "Rebellion Defense",
  "Recursion Pharmaceuticals",
  "Redfin",
  "Reed Smith",
  "REI Co-op",
  "Replicate",
  "Restaurant Brands International",
  "Rice University",
  "RingCentral",
  "Rivian",
  "Robert Half International",
  "Rocket Companies",
  "Roku Inc",
  "Ross Stores",
  "Sanmina Corporation",
  "Schneider National",
  "Scientific Games (now Light & Wonder split)",
  "Scotts Miracle-Gro",
  "Seagate Technology",
  "Sealed Air Corporation",
  "SeaWorld Entertainment",
  "Seismic",
  "Sempra Energy",
  "Sendoso",
  "Seton Hall University",
  "Shake Shack",
  "Sharp HealthCare",
  "Shenandoah Telecommunications",
  "Simon Property Group",
  "Sinclair Broadcast Group",
  "SiriusXM",
  "Six Flags Entertainment",
  "SLB (Schlumberger)",
  "Southern New Hampshire University",
  "Spectrum Health (Corewell)",
  "Sprouts Farmers Market",
  "SSM Health",
  "Standard Motor Products",
  "Stantec",
  "Stepan Company",
  "Stewart Title",
  "Take-Two Interactive",
  "Temple University",
  "Tetra Tech",
  "Texas A&M University",
  "Texas Health Resources",
  "Texas Tech University",
  "Textron Inc",
  "TransDigm Group",
  "Troutman Pepper",
  "Tulane University",
  "Turning Point Therapeutics (BMS)",
  "Tyler Technologies",
  "UCLA Health",
  "UCSF Health",
  "Ulta Beauty",
  "Ultragenyx Pharmaceutical",
  "UNC Health",
  "United Wholesale Mortgage",
  "Unity Technologies",
  "University of Alabama",
  "University of Arizona",
  "University of Arkansas",
  "University of Cincinnati",
  "University of Colorado",
  "University of Houston",
  "University of Iowa",
  "University of Kansas",
  "University of Kentucky",
  "University of Louisville",
  "University of Minnesota",
  "University of Mississippi",
  "University of Missouri",
  "University of Nebraska",
  "University of New Mexico",
  "University of Notre Dame",
  "University of Oklahoma",
  "University of Pittsburgh",
  "University of Rochester",
  "University of Tennessee",
  "University of Utah",
  "University of Virginia",
  "University of Wisconsin",
  "University of Wyoming",
  "US Foods",
  "UW Medicine",
  "Valvoline Inc",
  "Vanderbilt University",
  "Varonis Systems",
  "Veeva Systems",
  "Verizon",
  "Victoria's Secret",
  "Virginia Mason Franciscan Health",
  "Virginia Tech",
  "VMware",
  "Vonage (Ericsson)",
  "Wake Forest University",
  "WakeMed Health",
  "Weber Inc",
  "Webflow",
  "Weights & Biases",
  "Welltower",
  "West Monroe Partners",
  "Western Governors University",
  "Williams-Sonoma",
  "Wyndham Hotels & Resorts",
  "Wynn Resorts",
  "XPO Logistics",
  "Xylem Inc",
  "Yale University",
  "YETI Holdings",
  "Zuora",
  "Zynga (Take-Two)",
]);

const NORMALIZED_DELETE_COMPANIES = new Set(
  Array.from(DELETE_COMPANIES, (name) => normalizeName(name).replace(/[^a-z0-9]+/g, "")),
);

function normalizeName(value) {
  return String(value ?? "")
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCompanyKey(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, "");
}

function titleCaseAts(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const known = new Map([
    ["workday", "Workday"],
    ["greenhouse", "Greenhouse"],
    ["ashby", "Ashby"],
    ["lever", "Lever"],
    ["smartrecruiters", "SmartRecruiters"],
    ["icims", "iCIMS"],
    ["eightfold", "Eightfold"],
    ["phenom", "Phenom"],
    ["jobvite", "Jobvite"],
    ["oracle", "Oracle"],
    ["oracle_cloud_hcm", "Oracle"],
    ["successfactors", "SuccessFactors"],
    ["custom", "Custom"],
    ["custom-jsonld", "Custom"],
    ["bamboohr", "BambooHR"],
    ["recruitee", "Recruitee"],
    ["workable", "Workable"],
    ["breezy", "Breezy"],
  ]);
  return known.get(lower) ?? raw;
}

function parseBrokenFile(path) {
  const raw = readFileSync(path, "utf8");
  // The exported file currently has a single missing comma between adjacent
  // objects. Repair the known malformed boundary in-memory so we can preserve
  // the user's manual board fixes without editing Downloads directly.
  const repaired = raw.replace(
    /(\}\s*\n\s*)(\{[\s\n]*"company": "Hearst Communications")/,
    "},\n  $2",
  );
  return JSON.parse(repaired);
}

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const brokenEntries = parseBrokenFile(brokenPath);
const seedCompanies = Array.isArray(seed.companies) ? seed.companies : [];

const correctedByCompany = new Map();
for (const entry of brokenEntries) {
  const company = String(entry.company ?? "").trim();
  if (!company) continue;
  correctedByCompany.set(normalizeName(company), {
    company,
    ats: titleCaseAts(entry.ats),
    board_url: String(entry.boardUrl ?? "").trim() || null,
    adapterId: String(entry.adapterId ?? "").trim() || null,
  });
}

const deletedFound = [];
const deletedMissing = [];
const renamed = [];
const overlays = [];

const nextCompanies = [];
for (const company of seedCompanies) {
  const originalName = String(company.company ?? "").trim();
  const renamedName = RENAME_MAP.get(originalName) ?? originalName;
  const deleteKey = normalizeCompanyKey(renamedName);

  if (
    DELETE_COMPANIES.has(originalName) ||
    DELETE_COMPANIES.has(renamedName) ||
    NORMALIZED_DELETE_COMPANIES.has(normalizeCompanyKey(originalName)) ||
    NORMALIZED_DELETE_COMPANIES.has(deleteKey)
  ) {
    deletedFound.push(originalName);
    continue;
  }

  const corrected = correctedByCompany.get(normalizeName(renamedName));
  const next = { ...company, company: renamedName };

  if (renamedName !== originalName) {
    renamed.push({ from: originalName, to: renamedName });
  }

  if (corrected) {
    // The manual audit JSON is the source of truth for corrected board and ATS
    // metadata, so overwrite the registry row with those verified values.
    next.company = corrected.company;
    next.ats = corrected.ats ?? next.ats ?? null;
    next.board_url = corrected.board_url ?? next.board_url ?? null;
    overlays.push({
      company: corrected.company,
      ats: corrected.ats,
      board_url: corrected.board_url,
      adapterId: corrected.adapterId,
    });
  }

  nextCompanies.push(next);
}

const dedupedCompanies = [];
const seenCompanies = new Set();
for (const company of nextCompanies) {
  const key = normalizeCompanyKey(company.company);
  // Keep the first surviving row for each normalized company name so rename
  // overlays cannot leave duplicate logical companies in the registry.
  if (seenCompanies.has(key)) continue;
  seenCompanies.add(key);
  dedupedCompanies.push(company);
}

for (const name of DELETE_COMPANIES) {
  if (!deletedFound.some((found) => normalizeCompanyKey(found) === normalizeCompanyKey(name))) {
    deletedMissing.push(name);
  }
}

seed.companies = dedupedCompanies;
seed._meta = {
  ...seed._meta,
  total: dedupedCompanies.length,
};

writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`);

console.log(JSON.stringify({
  seedPath,
  brokenPath,
  totals: {
    before: seedCompanies.length,
    after: dedupedCompanies.length,
    renamed: renamed.length,
    deletedFound: deletedFound.length,
    deletedMissing: deletedMissing.length,
    overlays: overlays.length,
    deduped: nextCompanies.length - dedupedCompanies.length,
  },
  renamed,
  deletedMissing,
  overlays: overlays.slice(0, 50),
}, null, 2));
