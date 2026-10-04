# Tasks: Satellite Metrics Pipeline

Status: draft
Traces: requirements.md, design.md

Each task lists its demo and the requirements it covers. Checkboxes mark progress.

## Task 1: Metric CLI with dry-run and confirmed modes
- [x] `--metric/--area/--years`, mutually exclusive `--dry-run`/`--confirmed`.
- Covers: FR1, FR2, FR3, FR4; NFR3; D2
- Files: `pipeline/run.py`
- Demo: dry-run prints a table; confirmed upserts to `satellite_metrics`.
- Status: implemented.

## Task 2: Metric registry and contract
- [x] `Metric` dataclass registry; `compute(year, areas)` contract.
- Covers: FR5, FR8; D1, D4
- Files: `pipeline/registry.py`, `pipeline/metrics/__init__.py`
- Demo: `METRICS` resolves `tree_cover_loss`; rows carry `source_version`.
- Status: implemented.

## Task 3: tree_cover_loss metric (reference)
- [x] Hansen loss in hectares with storm-year and low-coverage flags.
- Covers: FR5, FR6, NFR1, NFR2, NFR4
- Files: `pipeline/metrics/tree_cover_loss.py`
- Demo: dry-run shows per-area hectares and a quality_flag per row.
- Status: implemented.

## Task 4: Year batching
- [x] Batch years by `YEARS_PER_REQUEST` to avoid aggregation limits.
- Covers: FR7; D3
- Files: `pipeline/run.py`
- Demo: a 2001-2025 dry run completes without an aggregation error.
- Status: implemented.

## Task 5: Remaining metrics (pending)
- [ ] Add `built_up_area`, `green_space`, `ndvi`, `rainfall`, `flood_extent`,
  `night_lights`, each as a module plus registry entry plus schema test.
- Covers: FR5, FR6, NFR2, NFR4; follows the add-satellite-metric skill
- Files: `pipeline/metrics/*.py`, `pipeline/registry.py`, `tests/metrics/*.py`
- Demo: each new metric dry-runs on a 2-year range and prints valid rows.
- Status: pending. `METRIC_NAMES` lists them; only `tree_cover_loss` is
  implemented.

## Task 6: Schema tests per metric
- [ ] Keep `tests/metrics/test_<metric>.py` in step with the registry.
- Covers: AC4
- Files: `tests/metrics/`
- Demo: `pytest -q` passes with a schema test for each implemented metric.
- Status: `test_tree_cover_loss.py` exists; add one per new metric.

## Task 7: Document each metric
- [ ] Record source, units, windows, and caveats in `docs/metrics.md`.
- Covers: NFR1
- Files: `docs/metrics.md`
- Demo: `docs/metrics.md` has an entry per implemented metric.
- Status: ongoing.
