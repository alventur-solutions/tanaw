# Design: Web Client

Status: draft
Traces: requirements.md (FR1-FR7, NFR1-NFR5)

## Overview

Two independent frontends over one API. The public client is a Next.js static
export served from S3/CloudFront; the admin dashboard is a Vite SPA used
internally. Neither stores data; both read the dashboard API.

## Public client (client/)

- Stack: Next.js 16 (`output: "export"`, `trailingSlash: true`,
  `images.unoptimized`), React 19, Leaflet + React Leaflet, pnpm.
- Hosting: static `out/` uploaded to the frontend bucket; CloudFront serves it on
  the public subdomain.
- API access: browser fetch to `NEXT_PUBLIC_API_URL` (the API Function URL),
  embedded at build time. Blank URL -> on-map configuration message (FR2).
- Screen: full-screen light map. Top-bar search; area boundaries; category-colored
  project pins; a detail card on selection; a draggable divider with two archive
  dates for imagery compare (docs/client-design.md).
- Imagery: Esri Wayback releases from `public/data/imagery-releases.json`; tiles
  load from Esri in the browser; show archive publication date (FR4, NFR3).
- Data: `/areas`, `/areas/{id}/projects`, `/areas/{id}/metrics?metric=
  tree_cover_loss` (FR1).

## Admin dashboard (dashboard/)

- Stack: React + Vite + MapLibre, dark "console" theme (inspired by the open-source
  ghostwatch project, MIT).
- API access: Vite dev server proxies `/api` to the local API (`vite.config.ts`);
  every number comes from the API, nothing mocked (FR5, NFR1).
- Imagery: Esri World Imagery Wayback (`public/data/wayback.json`, thinned).

## Shared rules

- Project points are source coordinates for sites, not boundaries; dedupe shared
  components; never sum across areas (FR6).
- Label tree cover loss as such; neutral funding language (FR7).
- Keep schemas aligned with the API (area, metric, funding) before wiring (per
  client/AGENTS.md).

## Decisions

- D1: Two surfaces, not one. Public (static, hardened, nontechnical) and admin
  (richer, internal) have different audiences and hosting, so they are separate
  apps over the same API.
- D2: Public client is a static export (no server runtime) so it can live on
  S3/CloudFront cheaply and safely; all dynamic data comes from the API in the
  browser.
- D3: Different map libraries reflect their lineage (Leaflet for the public client
  per client-design.md; MapLibre for the admin dashboard). Not unified for now.

## Risks

- R1: `NEXT_PUBLIC_API_URL` is build-time; a wrong value needs a rebuild and
  re-upload. Mitigate with a clear configuration message when blank.
- R2: CORS on the Function URL must include the deployed origin or the browser is
  blocked (NFR5).
- R3: Maintaining two frontends is more work; justified by distinct audiences.
  Revisit if they converge.

## Open questions

- OQ1: Final public subdomain and the admin host (CloudFront path or separate).
- OQ2: Whether the admin dashboard also deploys statically or stays dev-only.
