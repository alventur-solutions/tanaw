# Tasks: Funding Ingest (DPWH)

Status: draft
Traces: requirements.md, design.md

Each task lists its demo and the requirements it covers.

## Task 1: Clean and de-duplicate the DPWH CSV
- [x] Typed rows, earliest-year dedup on `ProjectComponentID`.
- Covers: FR1, FR3, NFR3
- Files: `funding/clean_dpwh.py`
- Demo: summary prints rows in, duplicates removed, rows out.
- Status: implemented; covered by `tests/test_clean_dpwh.py`.

## Task 2: Classify work category
- [x] drainage / river_structure / slope_protection / pumping / other, with the
  pumping-station description override.
- Covers: FR2
- Files: `funding/clean_dpwh.py`
- Demo: a generic `TypeofWork` with a pumping-station description -> `pumping`.
- Status: implemented and tested.

## Task 3: Coordinate validation and flags
- [x] PH bbox check; `coords_outside_ph` / `coords_missing`, never dropped.
- Covers: FR4
- Files: `funding/clean_dpwh.py`
- Demo: an out-of-PH row is kept with a flag and excluded from links/EE csv.
- Status: implemented and tested.

## Task 4: Point-in-polygon area links
- [x] `assign_areas` sjoin -> one (component_id, area_id) per containing area.
- Covers: FR5; D1
- Files: `funding/clean_dpwh.py`
- Demo: a project inside a city and its enclosing basin yields two link rows.
- Status: implemented and tested.

## Task 5: Write cleaned outputs
- [x] projects parquet+csv, links parquet+csv, EE csv of ok rows.
- Covers: FR6
- Files: `funding/clean_dpwh.py`
- Demo: `funding/clean/` holds the five files after a run.
- Status: implemented.

## Task 6: Bulk load into Neon (idempotent)
- [x] COPY to staging, upsert projects with geom, replace links, abort on unknown
  area.
- Covers: FR7, FR8, NFR4
- Files: `funding/load_dpwh.py`
- Demo: running the load twice leaves no duplicates; an unknown area aborts.
- Status: implemented.

## Task 7: Funding totals API
- [x] `GET /funding/totals` per area per year with window and caveat.
- Covers: FR9, NFR1, NFR2
- Files: `api/funding.py`
- Demo: `GET /funding/totals?area_id=<id>` returns per-year rows; unknown -> 404.
- Status: implemented; covered by `tests/test_funding.py`.

## Task 8: Ingest a refreshed source file (operational)
- [ ] Run clean then load on a new DPWH export and confirm counts.
- Covers: AC1, AC4
- Files: operational, uses the above
- Demo: new file cleaned and loaded; `funding_projects` count updates without
  duplicates.
- Status: pending the next DPWH file.
