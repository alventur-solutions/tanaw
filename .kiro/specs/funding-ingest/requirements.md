# Requirements: Funding Ingest (DPWH)

Status: draft
Owner: TANAW
Related code: `funding/clean_dpwh.py`, `funding/load_dpwh.py`, `api/funding.py`,
`funding/SOURCES.md`, `db/migrations/versions/0001_init.py` and
`0003_funding_project_areas.py`

## Problem statement

TANAW compares land change with public works funding. The DPWH flood control
projects CSV must be cleaned, de-duplicated, classified by work type, geotagged to
study areas, and loaded into Neon so the API can report spending per area per year
next to satellite metrics. Study areas overlap, so totals must always be per area
and never summed across areas. The platform must never imply wrongdoing.

## Goals

- Turn the raw DPWH CSV into one typed row per project component.
- Classify each project into a fixed set of work categories.
- Link each project to every study area its site falls in.
- Load projects and links into Neon idempotently (safe to re-run).
- Report totals per area per year with honest caveats.

## Non-goals

- Trends before the covered years (DPWH is mostly 2021 to 2024).
- Adding totals across overlapping areas.
- Any claim of corruption, ghost projects, or causation.
- Non-DPWH sources (DENR NGP, GAA, COA, LGU DRRM) in this iteration.

## User stories

1. As a funding analyst, I want the raw CSV cleaned and de-duplicated so each
   project is counted once.
2. As a reviewer, I want each project classified (drainage, river_structure,
   slope_protection, pumping, other) so spending can be grouped by work type.
3. As the dashboard, I want `GET /funding/totals` to return projects and PHP per
   area per year, with a caveat when partial years are included.

## Functional requirements

- FR1: Cleaning SHALL de-duplicate on `ProjectComponentID`, keeping the earliest
  `InfraYear` row so a multi-year contract cost is counted once.
- FR2: Cleaning SHALL classify work into `drainage`, `river_structure`,
  `slope_protection`, `pumping`, or `other`, first match wins; a pumping station in
  `ProjectDescription` overrides `TypeofWork`.
- FR3: Amounts SHALL be parsed to PHP floats, preferring the `*_String` column when
  it is the same amount unrounded, else the numeric column.
- FR4: Coordinates SHALL be validated against the Philippines bounding box
  (lon 116 to 127, lat 4 to 21); outliers and missing coordinates SHALL be flagged
  (`coords_outside_ph`, `coords_missing`), never dropped.
- FR5: Each project SHALL be joined by point-in-polygon to every study area it
  falls in, producing (component_id, area_id) links. Only `ok`-coordinate rows are
  linked.
- FR6: Cleaning SHALL write parquet and CSV outputs for projects, the links, and a
  slim Earth Engine CSV (ok coordinates only).
- FR7: Loading SHALL COPY into staging tables, upsert `funding_projects` on
  `component_id` (building the point geometry), and replace the links for staged
  projects. Re-running SHALL be safe.
- FR8: Loading SHALL fail if a link references an `area_id` not in `study_areas`.
- FR9: `GET /funding/totals` SHALL return projects and PHP per area per year through
  the link table, defaulting to the full-year window, with an option to include
  partial years and a matching caveat.

## Non-functional requirements

- NFR1 (honesty): Output and API copy SHALL describe patterns, never wrongdoing.
  The point is the project site, not the area it protects; state this.
- NFR2 (no cross-area sums): Totals SHALL be per area; the API note SHALL say they
  must not be added across overlapping areas.
- NFR3 (raw untouched): Raw files in `funding/raw/` SHALL never be modified; cleaned
  output goes to `funding/clean/`.
- NFR4 (idempotent load): Loading a refreshed file SHALL not create duplicates.

## Acceptance criteria

- AC1: `python -m funding.clean_dpwh <csv>` prints rows in, duplicates removed,
  rows per category, rows per year, and projects per area, then writes the outputs.
- AC2: A pumping station described in `ProjectDescription` is categorized `pumping`
  even when `TypeofWork` is generic.
- AC3: Rows with coordinates outside the Philippines are kept with a flag, not
  dropped, and are excluded from the links and the EE CSV.
- AC4: `python -m funding.load_dpwh` upserts and can be run twice without duplicate
  rows; an unknown `area_id` aborts the load.
- AC5: `GET /funding/totals?area_id=<id>` returns per-year rows; an unknown
  `area_id` returns 404.
