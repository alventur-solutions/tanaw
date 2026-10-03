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
