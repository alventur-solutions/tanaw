# Design: Funding Ingest (DPWH)

Status: draft
Traces: requirements.md (FR1-FR9, NFR1-NFR4)

## Overview

Two steps: clean (`funding/clean_dpwh.py`) turns the raw CSV into typed project
rows plus area links and writes files; load (`funding/load_dpwh.py`) bulk-loads
those files into Neon. The API (`api/funding.py`) reads per-area totals.

## Flow

```
funding/raw/*.csv
   | clean_dpwh.run
   v
deduplicate -> clean (type, classify, money, coords, flags) -> assign_areas (sjoin)
   |                                                               |
 funding/clean/dpwh_flood_control.{parquet,csv}       dpwh_flood_control_areas.{parquet,csv}
   |                                                   + dpwh_flood_control_ee.csv (ok coords)
   | load_dpwh.load (COPY + upsert, one transaction)
   v
Neon: funding_projects (geom point) , funding_project_areas (links)
   |
 api/funding GET /funding/totals  -> projects and PHP per area per year
```

## Cleaning (clean_dpwh.py)

- `deduplicate`: sort by numeric `InfraYear`, drop duplicate `ProjectComponentID`
  keeping the earliest year (FR1).
- `classify(type_of_work, description)`: `PUMPING_STATION` regex on the description
  wins; otherwise first keyword match over `CATEGORY_KEYWORDS` in order; else
  `other` (FR2).
- `_money(strings, numbers)`: use the `*_String` centavos value when it equals the
  numeric value within 0.06, else the numeric column; log conflicts (FR3).
- Coordinate flags: `ok`, `coords_outside_ph` (outside the PH bbox), `coords_missing`
  (FR4).
- `assign_areas`: build points from ok rows, `gpd.sjoin` within study-area polygons,
  one (component_id, area_id) row per containing area (FR5).
- `write_outputs`: projects parquet+csv, links parquet+csv, EE csv of ok rows (FR6).

## Loading (load_dpwh.py)

- `to_records`: project rows in `STAGING_COLUMNS` order; `lon`/`lat` only for ok
  rows; money to `Decimal`.
- `load`: in one asyncpg transaction, COPY into two temp staging tables, check all
  staged `area_id`s exist in `study_areas` (abort if not, FR8), `UPSERT`
  `funding_projects` on `component_id` building `ST_MakePoint` geom, then delete and
  re-insert links for staged projects (FR7). Uses the pooled engine from `api/db.py`
  inside a single transaction so temp tables survive PgBouncer.

## Data model

- `funding_projects(component_id PK, project_id, year, category, type_of_work,
  amount_php, abc_php, contractor, municipality, province, start_date,
  completion_date, source, geom Point)`.
- `funding_project_areas(component_id, area_id)` links, from migration 0003.

## API (api/funding.py)

- `GET /funding/totals?area_id=&include_partial_years=` returns
  `FundingTotalsResponse` with per (area_id, year) `projects` and `amount_php`.
- Default window is `FIRST_FULL_YEAR=2021` to `LAST_FULL_YEAR=2024`;
  `include_partial_years=true` removes the window and sets a caveat (FR9).
- Always carries `OVERLAP_NOTE`: totals are per area, not to be summed across areas
  (NFR2). Unknown `area_id` returns 404.

## Decisions

- D1: Keep every containing area as a separate link row; never pick one area per
  project, because areas overlap by design (NFR2).
- D2: Flag bad coordinates instead of dropping, so counts stay complete; exclude
  flagged rows only from spatial joins and the EE upload (FR4).
- D3: Load in one transaction with staging tables so a refreshed file is safe to
  re-run (NFR4).

## Risks

- R1: A boundary change moves a project out of an area. The load replaces links for
  staged projects, so the old link is dropped on reload (documented behavior).
- R2: Presenting partial-year totals as a trend. Mitigated by the default window and
  the caveat.
