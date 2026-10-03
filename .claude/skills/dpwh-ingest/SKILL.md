---
name: dpwh-ingest
description: Clean, classify, deduplicate, and geotag the DPWH flood control projects CSV into TANAW's funding table and Earth Engine asset. Use whenever a DPWH flood control file is added or refreshed.
---
# DPWH ingest

Input: `funding/raw/flood-control-projects-*.csv` (about 9,855 rows, 35 columns, mostly 2021 to 2024).

1. Load with pandas. Keep raw file untouched.
2. Deduplicate on `ProjectComponentID`. Log rows removed.
3. Parse: ContractCost and ABC to float PHP, StartDate (MM/DD/YYYY), CompletionDateActual (YYYY-MM-DD). `CompletionDateOriginal` is epoch milliseconds.
4. `year` = InfraYear. Keep FundingYear and CompletionYear too.
5. Classify TypeofWork into category:
   - drainage: contains "Drainage"
   - river_structure: "Flood Mitigation", "Flood Control", "Revetment", "Dike"
   - slope_protection: "Slope Protection"
   - pumping: "Pumping"
   - other: anything else
6. Validate coordinates inside the Philippines (lon 116 to 127, lat 4 to 21). Flag outliers, do not drop them.
7. Point-in-polygon join to `pipeline/areas/*.geojson` to set area_id (and zone for basins).
8. Write `funding/clean/dpwh_flood_control.parquet` and `.csv`.
9. For Earth Engine: write a slim CSV (component_id, area_id, year, category, amount_php, Longitude, Latitude) and upload with X=Longitude, Y=Latitude to `projects/$EE_PROJECT/assets/funding/dpwh_flood_control`.
10. Print a summary: rows in, duplicates removed, rows per area, PHP per area per year.
