# TANAW

**Topographic Assessment for National Adaptation Works** (public/civic framing: Transparent Audit for National Adaptation Works).

Decision-support platform for DENR, LGUs, and DRRM offices. For each study area and year it compares:
1. Satellite history of the land (tree cover, built-up surface, green space, rainfall, flood extent)
2. Public works funding (DPWH flood control projects, later DENR NGP and LGU DRRM funds)
3. Live IoT readings from river and street flood stations

TANAW shows patterns and correlations. It never claims wrongdoing. UI and reports say "spending pattern", "mismatch", "for review", never "corruption" or "anomaly proves".

## Study area types
Every study area has a `study_type`:
| study_type | Example | Main question | Primary metrics |
|---|---|---|---|
| `river_basin` | Pasig-Marikina-Tullahan | Does upstream change drive downstream floods? | tree cover loss up vs down, flood extent, rainfall |
| `rural_upland` | Rodriguez / Antipolo uplands | Is forest being lost, and to what? | tree cover loss, land conversion |
| `urban` | Quezon City | Why do streets flood after ordinary rain? | built-up growth, green space loss, night lights |

Demo set: Pasig-Marikina-Tullahan (basin), Rodriguez/Antipolo uplands (rural), Quezon City (urban). All three sit on one river system: mountain, river, city street.

## Repo layout
- `pipeline/metrics/` one Earth Engine (Python `ee`) module per metric
- `pipeline/areas/` study area GeoJSON files
- `pipeline/gee_app/` Earth Engine App (JavaScript) prototype
- `data/raw/` untouched source files (`data/raw/dpwh/` is not in git, sources listed in `funding/SOURCES.md`), `funding/clean/` cleaned output (not in git, rebuilt with `python -m funding.clean_dpwh_transparency`)
- `db/migrations/` PostgreSQL + PostGIS (Alembic, config in `alembic.ini`)
- `api/` FastAPI (on demand analysis with cache, job polling)
- `firmware/` ESP32 station (PlatformIO, Arduino)
- `dashboard/` React + MapLibre
- `tests/` pytest

## Core conventions
- Join key across all data: `area_id` + `year`. Never rename an `area_id`.
- Metric rows: `(area_id, year, metric, value, quality_flag)`. `satellite_metrics` also stores `source_version` (the dataset ID).
- Earth Engine project: `bigquery-ai-project-473708` (read from env `EE_PROJECT`).
- Hansen: `UMD/hansen/global_forest_change_2025_v1_13` (loss years 2001 to 2025), forest = treecover2000 >= 30. Label it "tree cover loss", never "deforestation".
- NDVI is supporting evidence only. Use multi-year windows (e.g. 2009 to 2011 vs 2022 to 2024) and harmonize Landsat 7 to 8/9 before comparing. A single-year NDVI comparison is not allowed in reports.
- Optical composites: Jan 1 to May 31, median, cloud masked.
- Built-up: GHSL (`JRC/GHSL/P2023A/GHS_BUILT_S`) for long trend, Dynamic World for 2016+.
- Flood extent: Sentinel-1 VV only (2015+).
- Units: hectares, mm, PHP (nominal), cm for water depth.
- Every value carries a `quality_flag`.
- Database: Neon Postgres + PostGIS, async SQLAlchemy with asyncpg. The engine uses `postgresql+asyncpg://...?ssl=require`. `api/config.py` also accepts the URL as Neon shows it (`postgresql://...?sslmode=require&channel_binding=require`) and converts it.
  - `DATABASE_URL`: Neon pooled URL (host has `-pooler`). Used by the app (`api/db.py`). The pooler is PgBouncer in transaction mode, so prepared statement caches stay off.
  - `DATABASE_URL_DIRECT`: Neon direct URL (no `-pooler`). Used only by Alembic migrations (`db/migrations/env.py`).

## Funding data (DPWH)
- Primary source: the DPWH Infrastructure Transparency dataset (`data/raw/dpwh/dpwh_transparency_data.parquet`, from the DPWH Transparency Portal, CC0). Only contracts whose componentCategories include "Flood Control and Drainage" are loaded. Fields include contractId, description, status, budget, progress, contractor, startDate, completionDate, infraYear, latitude, longitude.
- One row per contract. The key is contractId (`funding_projects.component_id` and `contract_id`). It is unique in the source.
- The older flood control CSV (`data/raw/funding/`, keyed on ProjectComponentID with a ContractID column) is a subset of it. It supplies TypeofWork, ABC, Municipality, and coordinates for the contracts it holds. Never load both as separate sources: the same contract would count twice.
- `amount_php` is the contract `budget`. `amountPaid` is zero for every flood control row, so it is not used.
- Coverage is 2016 to 2025 in full. Every funding query defaults to 2016 to 2025, and `include_partial_years=true` adds the other years with a caveat.
- Study areas overlap, so a project links to every area it falls in (`funding_project_areas`). Compute every funding total per `area_id` through that table. Never add totals across areas.
- Coordinates are the project site, not the area it protects. The two DPWH files disagree on the site for many contracts, so treat a point near an area boundary with care.
- Classify into: drainage, river_structure, slope_protection, pumping, other. TypeofWork decides where the source has it. A contract without TypeofWork is classified from its description and carries `quality_flag = category_from_description`: treat that category as an estimate. A pumping station in the description sets the category to pumping and overrides TypeofWork (DPWH files pumping stations under general types). A pump on its own does not count.
- Status and progress are as reported by DPWH. Show them as "reported status", never as a finding about the project.

## IoT stations
Same hardware for all: ESP32, DHT22, JSN-SR04T waterproof ultrasonic, SSD1306 OLED, buzzer.
- `station_type = river`: mounted on a bridge, reports water_level_cm.
- `station_type = street`: mounted on a pole over the road, reports flood_depth_cm = dry_baseline_cm minus measured_cm.
- Street alert levels: 10 cm gutter, 30 cm not passable for cars, 50 cm dangerous for people.

## Commands
Run every command below inside the project virtual environment `.venv`. The system Python does not have the dependencies (for example `geopandas`), so `pytest` fails outside it.
- Create the venv (once): `python -m venv .venv`
- Activate: `.venv\Scripts\Activate.ps1` (PowerShell) or `source .venv/Scripts/activate` (Git Bash)
- Without activating: call the interpreter directly, e.g. `.venv/Scripts/python.exe -m pytest -q`
- Install: `pip install -e ".[dev]"`
- Lint/format: `ruff check . && ruff format .`
- Tests: `pytest -q`
- Dry run: `python -m pipeline.run --metric tree_cover_loss --area upper-marikina --years 2021-2022 --dry-run`
- Study areas: `python -m pipeline.study_areas build|upload|load` (GeoJSON, Earth Engine assets, `study_areas` table)
- Clean DPWH: `python -m funding.clean_dpwh_transparency data/raw/dpwh/dpwh_transparency_data.parquet --flood-control-csv data/raw/funding/<file>.csv`
- Load DPWH: `python -m funding.load_dpwh funding/clean/dpwh_transparency.parquet --replace-source dpwh_flood_control`
- Migrate: `alembic upgrade head` (preview SQL with `alembic upgrade head --sql`)
- API: `uvicorn api.main:app --reload`
- Firmware: `pio run -d firmware`

## Rules
- Never run a real Earth Engine export without a dry run first.
- Never commit `.env`, service account JSON, or `firmware/include/secrets.h`.
- Writing style for docs, UI copy, and reports: no em dashes.
