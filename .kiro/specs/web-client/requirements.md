# Requirements: Web Client

Status: draft
Owner: TANAW
Related code: `client/` (public), `dashboard/` (admin), `docs/client-design.md`,
`client/AGENTS.md`, `infra/` (hosting)

## Problem statement

TANAW has two web surfaces that read the same API: a public client on a subdomain
for nontechnical users, and an admin dashboard for internal review. Both must show
only real API data (study areas, project sites, tree-cover metrics) with honest
labels and no invented values, rankings, or sensor readings.

## Surfaces

- Public client (`client/`): Next.js static export (`output: "export"`), Leaflet +
  React Leaflet, hosted on S3 + CloudFront (the public subdomain). Calls the API in
  the browser via `NEXT_PUBLIC_API_URL` (the API Function URL), embedded at build
  time. Light theme for nontechnical users.
- Admin dashboard (`dashboard/`): React + Vite + MapLibre, dark "console" theme,
  reads the API through the Vite `/api` proxy. Internal use.

## Goals

- Public: a map-first page where a user selects a place or project site, sees its
  recorded fields, and compares two historical imagery dates.
- Admin: the richer operational view over the same API.
- Both: present source, units, coverage, quality, and interpretation limits near
  each finding; keep tile attribution visible.

## Non-goals

- Server-only Next.js features in the public client (it is a static export).
- Inventing measurements, rankings, project matches, station readings, or image
  capture dates.
- Adding totals across overlapping areas; treating project sites as area boundaries.

## User stories

1. As a nontechnical user, I want a full-screen map where I can pick a place and
   read a short, plain summary with details on demand.
2. As a user, I want to compare two archive imagery dates for a selected place.
3. As an admin, I want the dashboard to show every number from the API with no
   mocked values.

## Functional requirements

- FR1: The public client SHALL fetch `/areas`, `/areas/{id}/projects`, and
  `/areas/{id}/metrics?metric=tree_cover_loss` from the API in the browser.
- FR2: The public client SHALL read the API base from `NEXT_PUBLIC_API_URL`; when
  blank it SHALL show a configuration message instead of calling an API.
- FR3: The public client SHALL build to a static `out/` via `pnpm build` for upload
  to the Terraform `frontend_bucket_name` bucket.
- FR4: The public client SHALL compare two Esri Wayback archive dates using
  `public/data/imagery-releases.json`, loading tiles from Esri in the browser, and
  SHALL show the archive publication date (not capture date).
- FR5: The admin dashboard SHALL read the API through the Vite `/api` proxy
  (target the local API) and render only API data.
- FR6: Both surfaces SHALL mark project points as source coordinates, not area
  boundaries, and SHALL deduplicate project components shared across areas.
- FR7: Both surfaces SHALL label tree cover loss as such (never "deforestation")
  and SHALL use neutral language about funding and outcomes.

## Non-functional requirements

- NFR1 (honesty): No invented values, rankings, matches, readings, or alert states.
  Missing-data states SHALL be shown plainly.
- NFR2 (accessibility): Keyboard access, visible focus, responsive layout, and
  reduced-motion support SHALL be preserved.
- NFR3 (attribution): Imagery attribution (Esri, Maxar, Earthstar Geographics)
  SHALL stay visible; imagery kept at natural brightness.
- NFR4 (style): Public client uses the light theme and TANAW colors
  (green `#087443`, blue `#086aa5`); admin uses the dark console theme.
- NFR5 (CORS): The API Function URL SHALL allow browser requests from the local and
  deployed client origins.

## Acceptance criteria

- AC1: With `NEXT_PUBLIC_API_URL` set, the public client loads study areas and shows
  a selectable map; with it blank, it shows a configuration message.
- AC2: `pnpm build` in `client/` produces a static `out/` export.
- AC3: Selecting a place shows its recorded fields and a two-date imagery compare.
- AC4: The admin dashboard renders areas, metrics, and projects from the API with
  nothing mocked (`npm run dev` in `dashboard/`).
- AC5: Project points are shown as source coordinates, not boundaries, on both.
