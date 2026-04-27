# Feature Logic Reference

Quick reference for how each major feature works — useful when debugging or extending.

---

## Dashboard

- Widget grid stored in `localStorage` via `useWidgetStore` (Zustand). Layout survives refresh.
- Widgets are registered in `src/features/dashboard/widgets.tsx` — each has an id, category (Pipeline/Conversion/etc.), kind (Single/Grouped), icon, title, description.
- `AddWidgetDialog` filters unplaced widgets by category + type, sorts A→Z.
- "Customize" mode: drag-to-reorder (dnd-kit sortable), remove (×), add, reset to default.

## Available Jobs

- Fetched from `/api/jobs` with server-side filters (keyword, location, company, newOnly, updatedOnly). Date range is client-side only.
- **isNew** = found in the latest scan for the first time. **isUpdated** = detected change since last scan (diff stored in `job.changes[]`).
- **Diff tooltip**: hover the "Updated" badge → shows `field | old → new` in red/green.
- **Split-pane**: clicking a row switches the page to a flex layout — job list on left (resizable, width persisted to `localStorage` key `cj_split_width`), inline drawer on right. Drag the divider to resize.
- **Hotkeys**: `j`/`k` navigate rows, `Enter` opens drawer, `e` applies, `x` discards, `/` focuses search, `Escape` clears selection.

## Job Details Drawer

- Shared across Jobs / Applied / Plan pages. Accepts a `DrawerSource` union (`available | applied | plan`) and adapts accordingly.
- Two render modes: `inline=false` (fixed overlay panel, default) and `inline=true` (fills its flex container — used in split-pane).
- **Notes section**: WhatsApp-style records. Each note has `id`, `text`, `createdAt`, `updatedAt?`. Optimistic update — note appears instantly, rolls back on error. Hover a note to reveal edit/delete icons.

## Applied Jobs Kanban

- Drag cards between columns (Applied → Interview → Negotiations → Offered → Rejected).
- Optimistic local state: card moves instantly, server mutation fires in background, rolls back on error.
- **Confetti**: fires when status changes to **Offered** (both drag and drawer status select).
- Click a card to open the Job Details Drawer.

## Action Plan

- Shows applied jobs that have interview rounds. Editable rounds (add/edit/delete) in the drawer.
- Round fields: designation (Recruiter / Hiring Manager / etc.), scheduled date, outcome (Pending/Passed/Failed/Follow-up), notes.

## Command Palette (⌘K)

- Global search: navigate pages, search jobs by title/company, search company registry, run actions (scan, toggle theme, clear cache).
- **Onboarding**: auto-opens 1.2s after first visit (checks `localStorage.getItem("cj_onboarded")`). Sets flag on open — fires once ever.

## Configuration

- Tracked companies: add from registry (1,200+ companies), add custom URL, remove, pause/resume scan.
- Title filters: include/exclude keywords applied server-side during scan.
- Company scan overrides: per-company pause state stored in DynamoDB.
