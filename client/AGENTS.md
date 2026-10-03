# Client implementation notes

- Read the repository `CLAUDE.md` and `docs/project-vision.md` before changing product behavior or evidence copy.
- This is a Next.js static export for private S3 and CloudFront. Fetch study areas, project points, and metrics from the API Function URL in the browser. Do not add server-only Next.js features.
- Use pnpm from `client/`. Keep area, metric, funding, and station schemas aligned with the API before connecting them.
- Do not invent measurements, rankings, project matches, station readings, or alert states. Use API study-area boundaries and mark project sites as source coordinates.
- Design for nontechnical users. Lead with key findings and short, plain labels. Put source, units, coverage, quality, and interpretation limits in expandable details near the relevant finding. Keep missing-data states clear. Use neutral language about funding and outcomes.
- Keep tile attribution visible. Do not treat project sites as study-area boundaries.
- Use Leaflet and React Leaflet for the map, Esri Wayback releases for date comparison, and a light interface with white controls, dark text, and TANAW green and blue accents. Keep satellite imagery at its natural brightness.
- Preserve keyboard access, visible focus, responsive layouts, and reduced-motion support.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
