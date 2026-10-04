---
name: urban-imperviousness
description: Compute urban land metrics for TANAW (built-up growth, green space loss, night lights) for urban study areas such as Quezon City. Use for any "why does this street flood" or urbanization question.
---
# Urban imperviousness

Idea: in cities the equivalent of a bald mountain is sealed ground. More concrete means less infiltration and faster runoff.

Metrics per area per year:
1. `builtup_ha`: GHSL `JRC/GHSL/P2023A/GHS_BUILT_S` (5-year epochs 1975 to 2030, use observed epochs up to 2020). Sum built-up surface m² / 1e4.
2. `builtup_pct`: builtup_ha / area_ha * 100.
3. `green_ha`: Dynamic World `GOOGLE/DYNAMICWORLD/V1`, dry-season mode of `label`, classes trees (1) + grass (2) + shrub (5). 2016+ only.
4. `impervious_pct`: Dynamic World class built (6) share, 2016+.
5. `night_lights`: VIIRS annual `NOAA/VIIRS/DNB/ANNUAL_V22`, sum of `average`. Flag saturation in dense cores.
6. Optional: `rain_heavy_days` from CHIRPS (> 50 mm/day) to pair with street sensor data.

quality_flag: share of valid Dynamic World pixels in the composite.
Report GHSL as epochs, not yearly values. Do not interpolate GHSL silently.
