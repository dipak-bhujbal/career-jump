# Project Roadmap

Career Jump React Rebuild — running log of what was built, why, and what's next.

---

## Context

The original Career Jump app (`career-jump` on Cloudflare) is a working vanilla-JS product. This repo (`career-jump-web`) is a full React rebuild of the UI, targeting the same AWS backend (`career-jump-aws`). The goal is a richer, more maintainable frontend — with A/B testing via isolated AWS hosting before a full DNS cutover.

**Backend is NOT being rebuilt.** The React app calls the same `/api/*` endpoints. All new features are pure frontend.

---

## Done

### Foundation
- Vite + React 18 + TypeScript + TanStack Router/Query + Tailwind v4
- Mock fetch interceptor (`src/mocks/install.ts`) — full UI works without a running backend
- Cognito auth integration (reads token from localStorage, passes in Bearer header)
- Shared `JobDetailsDrawer` component — renders differently for Available / Applied / Plan sources

### Wave 1 — Power-User Table (Jobs Page)
- `j`/`k` keyboard navigation through job rows
- `Enter` opens drawer, `e` applies, `x` discards, `/` focuses search
- Shift-click range selection with checkboxes
- BulkActionBar floats when multi-select is active
- `isNew` pulse animation on fresh jobs

### Wave 2 — Dashboard & Action Plan
- Customizable widget dashboard (drag-to-reorder, add/remove, persist to localStorage)
- Add Widget dialog: search + category filter + Single/Grouped type filter, alphabetical sort
- Action Plan drawer: add/edit/delete interview rounds with live state

### Wave 3 — Differentiating Moments
- **Inline diff tooltip**: hover "Updated" badge → see what changed (field, old→new, red/green)
- **Resizable split panes**: click a job → page splits into list + inline drawer with drag handle; width persists to localStorage
- **Confetti**: fires on Offered status (kanban drag + drawer select), via `canvas-confetti`
- **Keyboard-first onboarding**: command palette auto-opens 1.2s after first visit, never again

### Notes Redesign
- Replaced single textarea with WhatsApp-style record system
- Each note: timestamp, text, hover-to-edit/delete
- Optimistic updates — note appears instantly, rolls back on server error
- Add/edit/delete backed by `/api/notes/*` mock endpoints

---

## In Progress

- **Bug fixes & polish** — notes visibility fix (optimistic update), split-pane layout refinements

---

## Next Up (Wave 4 — Bonus Tier)

These features would make Career Jump the only job tracker doing them:

| Feature | Description | Why |
|---------|-------------|-----|
| **Job comparison view** | Pick 2–3 jobs → side-by-side card comparing title/location/salary/keywords | Users shortlist and compare before applying — currently done in a spreadsheet |
| **AI cover letter draft** | Drawer button → generates draft using notes + job description | Saves 30–60 min per application |
| **"Why this job?" panel** | Inline keyword-match explanation | Makes the filter logic transparent, helps users decide faster |

---

## Pending (to ship to production)

These are required before the React app can replace the vanilla app:

| Item | Notes |
|------|-------|
| **Remove mock, wire real API** | Set `VITE_API_BASE_URL` at build time; remove `?demo=1` guard |
| **Cognito auth in React** | Login redirect, token refresh, logout. Currently the token is assumed to exist in localStorage |
| **Deploy to AWS** | S3 bucket `cj-web-static-poc-<acct>` + CloudFront `cj-web-cdn-poc`, stack `career-jump-web-poc` |
| **GitHub Actions deploy workflow** | Push to `main` → build → sync to S3 → CloudFront invalidation |
| **Loading states / error boundaries** | Mock always succeeds; real API can fail, be slow, or return auth errors |
| **Pagination** | Mock returns all 38 jobs; real inventory can be 200+ |
| **Session expiry handling** | Re-login flow when Cognito token expires |

---

## What This App Is Not (Scope Guardrails)

- Not rebuilding the backend — all Lambda/DynamoDB/ATS work stays in `career-jump-aws`
- Not duplicating the Cloudflare deployment — that stays untouched as a fallback
- Not adding multi-user support — single-tenant, single owner
