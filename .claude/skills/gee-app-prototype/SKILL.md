---
name: gee-app-prototype
description: Build or update the TANAW prototype as an Earth Engine App (JavaScript, Code Editor ui API). Use for demos, pitches, and hackathons before the full dashboard exists.
---
# Earth Engine App prototype

Location: `pipeline/gee_app/tanaw_app.js` (pasted into code.earthengine.google.com, published via Apps).

Layout:
- Left panel: title "TANAW", study area dropdown (from `projects/$EE_PROJECT/assets/areas/*`), study_type badge, year range slider (2001 to 2024).
- Map: layers chosen by study_type.
  - river_basin and rural_upland: Hansen forest 2000 (green), loss year (yellow to dark red), area outline.
  - urban: GHSL built-up change, Dynamic World green space.
  - All: DPWH project points colored by category, sized by amount.
- Right panel: key numbers, chart of land change per year, chart of PHP per year (2021+), insight text from the funding-vs-land-insight skill.

Rules:
- Use `ui.Chart.feature.byFeature` for charts, `ee.Reducer.sum().group()` for per-year totals.
- Keep reducers at scale 30 and `maxPixels: 1e10`.
- Clicking a DPWH point shows TypeofWork, ContractCost, Contractor, years.
- No em dashes in labels.
