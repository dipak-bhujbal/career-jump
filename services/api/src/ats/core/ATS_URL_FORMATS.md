# Supported ATS URL Formats

This reference lists the ATS adapters currently registered by the API and the
job board URL formats they expect.

Use the canonical ATS ids shown here when editing registry records or validating
custom companies.

## Workday

- ATS id: `workday`
- Expected board URL patterns:
  - `https://{tenant}.wd{n}.myworkdayjobs.com/{site}`
  - `https://{tenant}.wd{n}.myworkdayjobs.com/en-US/{site}`
  - `https://{tenant}.myworkdaysite.com/recruiting/{region}/{site}`

Examples:

- `https://airtable.wd1.myworkdayjobs.com/Careers`
- `https://cisco.wd5.myworkdayjobs.com/en-US/Careers`

## Greenhouse

- ATS id: `greenhouse`
- Expected board URL patterns:
  - `https://job-boards.greenhouse.io/embed/job_board?for={slug}`
  - `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`
  - Also recognized from Greenhouse-hosted board pages such as:
    - `https://boards.greenhouse.io/{slug}`
    - `https://job-boards.greenhouse.io/{slug}`

Examples:

- `https://job-boards.greenhouse.io/embed/job_board?for=airbnb`
- `https://boards-api.greenhouse.io/v1/boards/anthropic/jobs`

## Lever

- ATS id: `lever`
- Expected board URL patterns:
  - `https://jobs.lever.co/{slug}`
  - `https://jobs.eu.lever.co/{slug}`

Example:

- `https://jobs.lever.co/figma`

## Ashby

- ATS id: `ashby`
- Expected board URL patterns:
  - `https://jobs.ashbyhq.com/{slug}`

Example:

- `https://jobs.ashbyhq.com/openai`

## SmartRecruiters

- ATS id: `smartrecruiters`
- Expected board URL patterns:
  - `https://jobs.smartrecruiters.com/{slug}`
  - `https://careers.smartrecruiters.com/{slug}`

## Eightfold

- ATS id: `eightfold`
- Expected board URL patterns:
  - `https://{company}.eightfold.ai/careers`
  - `https://{company}.eightfold.ai/careers?domain={domain}`
  - `https://{company}.eightfold.ai/careers/job?...`

Example:

- `https://careers.snap.com/us/en`

## Phenom

- ATS id: `phenom`
- Expected board URL patterns:
  - `https://jobs.{company}.com`
  - `https://{subdomain}.phenompeople.com`
  - `https://{company}.jobs.com`
  - Any board URL the Phenom parser can normalize into a working site root

Note:

- Phenom is more flexible than some other adapters because companies use
  several host shapes.

## Jobvite

- ATS id: `jobvite`
- Expected board URL patterns:
  - `https://jobs.jobvite.com/{slug}`

## iCIMS

- ATS id: `icims`
- Expected board URL patterns:
  - `https://careers-{company}.icims.com/jobs/search`
  - `https://jobs.icims.com/jobs/search`
  - Any `*.icims.com` job-search URL recognized by the adapter

Example:

- `https://careers-acadiahealthcare.icims.com/jobs/search`

## Oracle Cloud HCM

- ATS id: `oracle`
- Expected board URL patterns:
  - `https://{host}.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{site}/jobs`
  - Other Oracle Cloud HCM Candidate Experience URLs containing:
    - `oraclecloud.com`
    - `/hcmUI/CandidateExperience/`

Example:

- `https://fa-espx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs`

Note:

- Use ATS id `oracle`, not `oracle_cloud_hcm`.

## Workable

- ATS id: `workable`
- Expected board URL patterns:
  - `https://apply.workable.com/{slug}`

## Breezy

- ATS id: `breezy`
- Expected board URL patterns:
  - `https://{slug}.breezy.hr`

## Recruitee

- ATS id: `recruitee`
- Expected board URL patterns:
  - `https://{slug}.recruitee.com`

## BambooHR

- ATS id: `bamboohr`
- Expected board URL patterns:
  - `https://{company}.bamboohr.com/careers`

## SAP SuccessFactors

- ATS id: `successfactors`
- Expected board URL patterns:
  - `https://career{n}.successfactors.com/career?company={slug}`
  - Optional query params are allowed, for example:
    - `career_ns=jobsearch`
    - `rss=1`

Examples:

- `https://career5.successfactors.com/career?company=FOOCORP`
- `https://career5.successfactors.com/career?company=FOOCORP&career_ns=jobsearch&rss=1`

## Taleo

- ATS id: `taleo`
- Expected board URL patterns:
  - `https://{host}/careersection/{section}/jobsearch.ftl`
  - Taleo board URLs that parse into a valid Taleo host and career section

## Notes

- When editing registry rows, prefer the canonical ATS ids listed above.
- Some adapters accept a few equivalent host variants, but validation still
  checks the live board before allowing a company to be added.
- If an ATS is not listed here, it is not currently registered as a supported
  adapter in the API.
