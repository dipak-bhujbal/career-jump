# Career Jump — Web (React rebuild)

A ground-up React rewrite of the Career Jump frontend. The vanilla
`career-jump-aws/public/` app stays in production, and this repo is a
separately deployed React frontend that can be validated in parallel.

## Status

- React frontend is deployed independently to its own S3 + CloudFront stack.
- Real Cognito auth is enabled in production builds when the Cognito env vars are set.
- The vanilla app remains available on its original stack while this app hardens toward cutover.

## Stack

| Concern | Choice |
|---|---|
| Build | Vite 5 |
| UI | React 19 + TypeScript (strict) |
| Styling | Tailwind v4 + shadcn-style primitives in `src/components/ui/` |
| Data | TanStack Query v5 |
| Routing | TanStack Router (file-based, in `src/routes/`) |
| Forms | React Hook Form + Zod (added on first form-heavy screen) |
| Tests | Vitest + Testing Library |
| Icons | lucide-react |

## Directory map

```
src/
  components/
    layout/      Sidebar, Topbar, AppShell-style layout pieces
    ui/          Button, Card, Input, Badge, Dialog, TierTag, Toast
  features/
    companies/   queries.ts, CompanyPicker, CompanyTable
  lib/
    api.ts       Typed fetch wrapper + shared API types
    auth.ts      Cognito token storage helper (read-only for now)
    utils.ts     cn(), formatTierLabel, formatAtsLabel, companyKey
  routes/        File-based routes (TanStack Router auto-generates routeTree.gen.ts)
  index.css      Tailwind v4 + theme variables (dark default)
  main.tsx       App entry — wires QueryClient + RouterProvider
```

## Local development

```bash
# 1) Backend (one of):
#    a) Local SAM:    cd ~/career-jump-aws && sam local start-api --port 3000
#    b) Live API:     copy .env.example -> .env.local, set VITE_API_URL
#
# 2) Web app:
cd ~/career-jump-web
npm install            # first time only
npm run dev            # http://localhost:5173
```

`/api/*` is proxied to `VITE_API_URL` (default `http://localhost:3000`)
by `vite.config.ts`. You can hot-reload the React UI while pointing it
at the deployed backend, which is the fastest way to iterate.

### Useful commands

```bash
npm run dev        # Vite dev server, HMR
npm run build      # tsc -b + vite build (production bundle)
npm run preview    # serve the production bundle locally
npm test           # vitest run
npx tsc -b         # type-check only
npx @tanstack/router-cli generate   # regenerate routeTree.gen.ts (rare; vite plugin handles it)
```

## Architecture notes

- **Auth:** `src/lib/auth.ts` uses Cognito directly in deployed builds. Mock
  mode is local-only and requires `VITE_USE_MOCKS=true` on localhost.
- **API types:** hand-typed in `src/lib/api.ts` for the routes the
  rebuild touches. We can swap to `openapi-fetch` codegen against
  `/api/openapi.json` once the surface stabilises.
- **Form state:** Configuration uses local React state + a TanStack
  Query baseline; Save/Cancel pattern matches the vanilla app's
  dirty-tracking UX. We will introduce React Hook Form once a form
  appears that justifies it (multi-step settings, profile editor).
- **Theme:** dark by default. Switch by toggling the `light` class on
  `<html>`. Theme variables live in `src/index.css` (HSL triplets so
  Tailwind utilities like `bg-primary` resolve correctly).

## Open scope items (tracked, not yet implemented)

- **Registry-driven scanning on the backend.** When you add a
  registry company with an ATS outside the legacy 5
  (workday/greenhouse/ashby/lever/smartrecruiters) — e.g. iCIMS,
  Oracle, Custom — the row saves with empty `source` and the existing
  scan path skips it. The registry dispatcher
  (`career-jump-aws/src/services/registry-scraper.ts`) supports 16+
  ATSes plus custom adapters but isn't wired into the cron scan yet.
  Wire-up is a backend task; the UI already passes the right metadata.
- **Profile / resume builder.** Out of scope for the parity rewrite;
  add after parity is achieved.
- **PR preview deploys.** Skipped to keep the runbook simple; can
  revisit once you settle on a CI strategy.

See [docs/DEPLOY.md](./docs/DEPLOY.md) for the current manual deploy steps and
[docs/RELEASE_RUNBOOK.md](./docs/RELEASE_RUNBOOK.md) for release workflow details.
