# Tasks: Web Client

Status: draft
Traces: requirements.md, design.md

Each task lists its demo and the requirements it covers.

## Task 1: Public client scaffold (Next.js static export)
- [x] Next.js app with `output: "export"`, Leaflet, pnpm, `NEXT_PUBLIC_API_URL`.
- Covers: FR2, FR3; D2
- Files: `client/next.config.ts`, `client/package.json`, `client/app`,
  `client/components`, `client/lib`
- Demo: `pnpm build` produces `out/`; blank API URL shows a config message.
- Status: scaffolded.

## Task 2: Public map and data wiring
- [x] Fetch areas, projects, tree-cover metrics; map with pins and detail card.
- Covers: FR1, FR6, FR7, NFR1
- Files: `client/app`, `client/components`, `client/lib`
- Demo: selecting a place shows recorded fields from the API.
- Status: implemented per README/AGENTS; verify against live API.

## Task 3: Imagery compare (Esri Wayback)
- [x] Two-date archive compare from `public/data/imagery-releases.json`.
- Covers: FR4, NFR3
- Files: `client/public/data`, `client/components`
- Demo: a draggable divider compares two archive dates; attribution visible.
- Status: implemented per client-design.md.

## Task 4: Admin dashboard (Vite + MapLibre)
- [x] React/Vite/MapLibre app reading the API via the `/api` proxy.
- Covers: FR5, NFR1, NFR4
- Files: `dashboard/`
- Demo: `npm run dev`; areas/metrics/projects render from the API, nothing mocked.
- Status: implemented; builds verified earlier.

## Task 5: Accessibility and style pass
- [ ] Keyboard access, visible focus, responsive, reduced motion; TANAW palette.
- Covers: NFR2, NFR4
- Files: `client/`, `dashboard/`
- Demo: keyboard-only navigation works; reduced-motion respected.
- Status: ongoing; needs an explicit audit.

## Task 6: Deploy the public client
- [ ] `pnpm build` then upload `out/` to the frontend bucket; set CORS origin.
- Covers: FR3, NFR5
- Files: `client/`, `infra/` (see infra-deploy spec)
- Demo: the public subdomain serves the client and loads live API data.
- Status: pending the hosting/endpoint decision.

## Task 7: Decide admin hosting (OQ2)
- [ ] Decide whether the admin dashboard deploys statically or stays dev-only.
- Covers: resolves OQ2
- Files: `dashboard/`, `infra/`
- Demo: documented decision and, if deployed, a reachable admin URL.
- Status: pending owner decision.
