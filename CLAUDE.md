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
- `funding/raw/` untouched source files, `funding/clean/` cleaned output
- `db/migrations/` PostgreSQL + PostGIS
- `api/` FastAPI (on demand analysis with cache, job polling)
- `firmware/` ESP32 station (PlatformIO, Arduino)
- `dashboard/` React + MapLibre
- `tests/` pytest

## Core conventions
- Join key across all data: `area_id` + `year`. Never rename an `area_id`.
- Metric rows: `(area_id, year, metric, value, quality_flag)`.
- Earth Engine project: `bigquery-ai-project-473708` (read from env `EE_PROJECT`).
- Hansen: `UMD/hansen/global_forest_change_2024_v1_12`, forest = treecover2000 >= 30. Label it "tree cover loss", never "deforestation".
- NDVI is supporting evidence only. Use multi-year windows (e.g. 2009 to 2011 vs 2022 to 2024) and harmonize Landsat 7 to 8/9 before comparing. A single-year NDVI comparison is not allowed in reports.
- Optical composites: Jan 1 to May 31, median, cloud masked.
- Built-up: GHSL (`JRC/GHSL/P2023A/GHS_BUILT_S`) for long trend, Dynamic World for 2016+.
- Flood extent: Sentinel-1 VV only (2015+).
- Units: hectares, mm, PHP (nominal), cm for water depth.
- Every value carries a `quality_flag`.

## Funding data (DPWH)
- Source CSV columns include ProjectID, InfraYear, FundingYear, Municipality, Province, TypeofWork, ContractCost, ABC, Contractor, Longitude, Latitude, StartDate, CompletionDateActual.
- Coverage is mostly 2021 to 2024. Do not present pre-2021 funding trends.
- Deduplicate on ProjectComponentID (ProjectID has duplicates).
- Coordinates are the project site, not the area it protects.
- Classify TypeofWork into: drainage, river_structure, slope_protection, pumping, other.

## IoT stations
Same hardware for all: ESP32, DHT22, JSN-SR04T waterproof ultrasonic, SSD1306 OLED, buzzer.
- `station_type = river`: mounted on a bridge, reports water_level_cm.
- `station_type = street`: mounted on a pole over the road, reports flood_depth_cm = dry_baseline_cm minus measured_cm.
- Street alert levels: 10 cm gutter, 30 cm not passable for cars, 50 cm dangerous for people.

## Commands
- Install: `pip install -e ".[dev]"`
- Lint/format: `ruff check . && ruff format .`
- Tests: `pytest -q`
- Dry run: `python -m pipeline.run --metric tree_cover_loss --area upper-marikina --years 2021-2022 --dry-run`
- Clean DPWH: `python -m funding.clean_dpwh funding/raw/<file>.csv`
- API: `uvicorn api.main:app --reload`
- Firmware: `pio run -d firmware`

## Rules
- Never run a real Earth Engine export without a dry run first.
- Never commit `.env`, service account JSON, or `firmware/include/secrets.h`.
- Writing style for docs, UI copy, and reports: no em dashes.
