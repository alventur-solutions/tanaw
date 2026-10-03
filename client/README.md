# TANAW client

Next.js static client for S3 and CloudFront. The home screen is a full-screen map: it fetches study areas, recorded project locations and tree-cover metrics from the API, then compares historical Esri imagery when a place or project is selected.

## Run locally

1. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL` to the API Function URL.
2. From `client/`, run `pnpm install` and `pnpm dev`.
3. Open http://localhost:3000.

The API Function URL must allow browser requests from the local and deployed client origins. The client does not call an API when the URL is blank; it shows a configuration message on the map.

## Static deployment

```sh
pnpm build
```

The export is in `out/`. `NEXT_PUBLIC_API_URL` is embedded at build time. Upload `out/` to the frontend bucket from Terraform's `frontend_bucket_name` output.

## Data and map behavior

- `/areas` supplies study area boundaries.
- `/areas/{area_id}/projects` supplies map points, category and record details.
- `/areas/{area_id}/metrics?metric=tree_cover_loss` supplies annual measurements and quality flags.
- `public/data/imagery-releases.json` lists Esri Wayback archive releases. Image tiles load from Esri in the browser. The displayed date is the archive publication date and may differ from image capture date.
- Project points are source coordinates for project sites, not boundaries or protected areas. The map deduplicates project components shared by areas and never adds area totals.

Current API routes do not provide station readings or other satellite metrics. These do not appear as sample values in the client.
