# Funding data sources

Raw source files live in `funding/raw/` and are not tracked in git (see `.gitignore`).
Keep each raw file untouched. This file records where every raw file came from, so the
cleaned output in `funding/clean/` can be reproduced.

## DPWH flood control projects

| | |
|---|---|
| File | `funding/raw/flood-control-projects-full_2026-10-03.csv` |
| Publisher | Department of Public Works and Highways (DPWH) |
| Dataset | Flood control projects, full list |
| Source URL | Not recorded yet. Add the page the file was downloaded from. |
| Download date | 2026-10-03 |
| Size | 8,723,420 bytes |
| SHA-256 | `92a448910212d3046b7b810f35c6ade3236710e9570da343ff2003eb299a6d8b` |
| Rows | 9,855 (9,827 after deduplication on `ProjectComponentID`) |
| Columns | 35 |
| Coverage | InfraYear 2018 to 2025. Mostly 2021 to 2024, other years are partial. |

Notes
- Coordinates are the project site, not the area the project protects.
- Amounts are nominal PHP.
- Only DPWH flood control projects are listed. Spending by DENR, LGUs, and other agencies
  is not in this file.

Clean and load:

```
python -m funding.clean_dpwh funding/raw/flood-control-projects-full_2026-10-03.csv
python -m funding.load_dpwh
```

To refresh: download the new file into `funding/raw/` with the download date in its name,
add a row set like the one above, then run the two commands again.

## DPWH Infrastructure Transparency dataset (primary source)

| | |
|---|---|
| File | `data/raw/dpwh/dpwh_transparency_data.parquet` (not tracked in git) |
| Publisher | Department of Public Works and Highways (DPWH), Transparency Portal |
| Origin | https://transparency.dpwh.gov.ph/ through its public API (`https://api.transparency.dpwh.gov.ph/projects`) |
| Compiled by | The dpwh-transparency-data-api-scraper by @csiiiv, published as a dataset. Add the download page here. |
| License | CC0 1.0 |
| Download date | 2026-10-04 |
| Size | 24,330,129 bytes |
| SHA-256 | `5b411cf3f112fabd1913c70681791e5e2b78b43a8393f489f48bd882f154e123` |
| Rows | 248,220 contracts, all infrastructure types. 35,034 are flood control and drainage. |
| Coverage | infraYear 2016 to 2025 in full. 2026 holds 267 contracts. |

Notes
- `contractId` is unique. It is the key of `funding_projects`.
- Every contract of the flood control CSV above is in this dataset (matched on `ContractID`),
  with the same cost for 99.6 percent of them. The CSV is now used only to supply
  `TypeofWork`, the ABC, the municipality, and the coordinates for those contracts.
- Coordinates of the two files agree within about 200 m for only 57 percent of the shared
  contracts. The CSV coordinates are kept for the contracts it holds.
- 22,845 flood control contracts have no `TypeofWork`. Their category is read from the
  description and flagged `category_from_description`.
- 2,491 flood control contracts have no coordinates. They are loaded without a point and are
  in no study area.
- `amountPaid` is zero for every flood control row and is not used.

Clean and load (replaces the rows of the older source so no contract counts twice):

```
python -m funding.clean_dpwh_transparency data/raw/dpwh/dpwh_transparency_data.parquet --flood-control-csv data/raw/funding/flood-control-projects-full_2026-10-03.csv
python -m funding.load_dpwh funding/clean/dpwh_transparency.parquet --replace-source dpwh_flood_control
```
