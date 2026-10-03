# TANAW Project Vision

**Status:** Working product direction for frontend planning. The document marks unverified figures and undecided architecture as open work.

## Vision

TANAW helps DENR planners and their LGU and DRRM partners understand how a place is changing, what public works records say about funding, and what monitored stations measure now. The platform brings these views together so a planner can decide where to investigate and what evidence to review.

TANAW is a decision-support tool. It shows evidence, patterns, and uncertainty. It does not determine whether a project succeeded, assign blame, or claim that funding caused an environmental outcome.

**One-line pitch:** A platform that lets DENR see how an area changed, where public works funding was recorded, and what is happening now, all on one map.

## Users And Needs

- **DENR planners and analysts** choose areas for review, compare land and funding records, and prepare evidence for planning discussions.
- **LGU and DRRM staff** review local exposure, public works locations, and current station conditions.
- **Field staff and communities near stations** need clear local readings and understandable alert states.

The primary dashboard user is a nontechnical planner who wants key insights quickly. Lead with the selected place, its key findings, and simple actions. Use short, plain copy; make sources, methods, and interpretation limits available on demand near the relevant finding. Field staff also use the station display and local buzzer without needing the dashboard.

## Core Journey

1. **Choose an area.** The planner scans a national map and area list, filters by area type or region, and sorts areas by a defined priority measure. A selected area shows its boundary, type, available years, and the inputs behind any ranking.
2. **Study land history.** The planner explores a timeline from 2010 onward where data supports that span. They compare periods on a map and in annual or dataset-native charts. Each measure shows its source, year coverage, units, and quality.
3. **Review funding records.** The planner sees project locations, agencies, budget fields, dates, and status when the source provides them. They compare records with land metrics for overlapping years and inspect where a project point sits relative to the study area.
4. **Review the relationship.** An insight panel summarizes the observed land change, the funding records in the same period, their locations, and the limits of the comparison. It uses correlation language and leaves causation open.
5. **Monitor conditions.** The planner views river and street stations, their latest readings, reading time, history, and alert state. The station itself shows readings locally and sounds its buzzer at configured water-level thresholds.

## Frontend Structure

### Map first

The primary client opens directly to a full-screen map. Its main task is to show study-area boundaries and the locations of recorded public works. Search finds a place or project. Selecting either opens a compact record card and lets the user compare two dates in satellite imagery with a draggable before/after divider.

Use the TANAW API for study-area GeoJSON, project points and tree-cover metrics. The current API routes are `/areas`, `/areas/{area_id}/projects`, and `/areas/{area_id}/metrics?metric=tree_cover_loss`. Area project queries default to the fully covered DPWH years 2021–2024.

Use Esri World Imagery Wayback for historical imagery tiles and available archive dates. Display dates as archive publication dates; they are not necessarily image capture dates. Keep project coordinates visibly distinct from area boundaries and avoid implying that a project site is its area of benefit.

The map's project category filters follow the API's `category` values. Keep project amounts attached to the record and label them as contract cost. Never sum duplicated projects across overlapping areas.

Show source and quality details when a user opens a selected project or place. Keep missing values blank or label them as unavailable. Do not add mock metrics, project markers, or station observations.

### Other views

Land history can show annual tree-cover loss from the existing API with each row's quality flag. Funding totals or zone comparisons can be added when they help answer the selected place's question. A water-station view depends on station endpoints and readings that the API does not currently expose.

### Station detail

Show station identity, area, station type, latest timestamp, current water measure, temperature and humidity when available, battery or connectivity state when available, recent history, and alert thresholds. Distinguish a stale reading from a normal reading and a missing value from zero.

## Candidate Study Areas

The current project context names Pasig-Marikina-Tullahan, Rodriguez/Antipolo uplands, and Quezon City as the initial demo set. The broader product brief proposes these additional priority areas: Upper Marikina Watershed, Sierra Madre, Angat Watershed, Cagayan River Basin, Bicol, Agusan, Iloilo, Davao, Pampanga, Tullahan-Tinajeros, Jalaur, and Cagayan de Oro.

The table below preserves the working ABC summary supplied in the project brief. Treat it as unverified reference material, not as a ranking or as approved dashboard data. The notes do not provide a source URL, date range, aggregation method, or definition for the dagger marker. Validate those details and the geographic join before publishing values.

| Candidate area | River records: count / ABC | Nearby-area records: count / ABC |
|---|---:|---:|
| Angat / Bulacan | Angat: 97 / PHP 5.90B; "Bulacan River": 0 | Calumpit, Hagonoy, Malolos: 122 / PHP 8.11B |
| Cagayan | Cagayan River: 131 / PHP 8.49B | Tuguegarao: 10 / PHP 0.28B; Isabela province: 341 / PHP 22.96B dagger |
| Bicol | Bicol River: 63 / PHP 4.76B | Naga City: 7 / PHP 0.29B; Camarines Sur province: 252 / PHP 17.72B dagger |
| Agusan | Agusan River: 54 / PHP 4.49B | Butuan City: 42 / PHP 5.79B |
| Iloilo | Iloilo River: 2 / PHP 0.08B | Iloilo City: 24 / PHP 1.27B |
| Davao | Davao River: 30 / PHP 1.69B | Davao City: 88 / PHP 4.67B |
| Pampanga | Pampanga River: 46 / PHP 3.39B | Pampanga province: 292 / PHP 14.53B dagger |
| Tullahan-Tinajeros | Tullahan: 16 / PHP 1.09B; Tinajeros: 0 | Valenzuela, Malabon, Navotas: 163 / PHP 7.01B |
| Jalaur | Jalaur River: 23 / PHP 0.91B | No towns specified in the source note |
| Cagayan de Oro | Cagayan de Oro River: 7 / PHP 0.47B | Cagayan de Oro City: 54 / PHP 2.98B |

Counts and amounts above came from a project note and have not been independently checked. The dagger's meaning is unspecified. River, city, and province totals may describe different geographies, so do not compare or add them until the source and method establish that comparison.

## Data And Evidence

### Satellite and environmental measures

The project brief proposes these data families. Earth Engine is the intended place to source and process many of them, subject to verifying collection coverage and methods before implementation.

| Question | Candidate measures and sources |
|---|---|
| Vegetation and forest change | Hansen Global Forest Change; NDVI/EVI from Landsat, Sentinel-2, or MODIS |
| Land cover | ESA WorldCover; Dynamic World |
| Built-up growth and settlement | GHSL; Dynamic World built-up class; VIIRS nighttime lights |
| Rainfall and flood extent | CHIRPS or GPM rainfall; Sentinel-1 SAR flood extent |
| Terrain and flow context | SRTM or Copernicus DEM, elevation, and slope |
| Ground saturation | SMAP soil moisture |

The repository's current metric rules remain the working scientific constraints:

- Label Hansen results **tree cover loss**, not deforestation. Tree cover loss can include storms and fires.
- Use NDVI as supporting evidence with multi-year comparison windows and harmonized Landsat sensors. Do not present a single-year NDVI comparison as a trend.
- Report GHSL at its observed five-year epochs. Do not silently interpolate it into annual values.
- Dynamic World coverage begins in 2016. Sentinel-1 flood analysis begins in 2015. Show these limits in the interface.
- Display units, source, date range, spatial resolution where available, and a quality flag for each metric.
- Never turn missing, invalid, or not-yet-processed data into zero.

The first useful comparisons are tree cover loss and flood exposure across basin zones, and built-up growth and green space for urban areas. Pair Sentinel-1 flood extent with rainfall to investigate whether similar rainfall coincides with different observed flood extents. Present that as an observed comparison, not proof of a cause.

### Public works and funding

Start with DPWH flood-control records. The project context says the current dataset mostly covers 2021 to 2024, so funding comparisons must use 2021 onward and state the exact overlapping period. Later sources may include DBM/GAA, PhilGEPS, COA reports, LGU DRRM budgets, and DENR National Greening Program records.

For each project, show source, year, location, agency, category, and status only when the source supports those fields. Preserve the distinction between **ABC**, **contract cost**, and **actual expenditure**. Do not label an amount as money spent unless the source records expenditure.

Project coordinates describe the project site, not necessarily the area that benefits from it. Show the pin as a site and explain how the system associates it with a study area. Keep unmatched and uncertain records visible as such rather than silently dropping them.

### IoT stations

The current project brief describes ESP32 stations with a DHT22, water-level sensor, OLED, and buzzer. The firmware agent's draft specifies a JSN-SR04T ultrasonic sensor, river and street station types, and readings every five minutes, more often during alerts. A rain gauge, solar supply, battery, and waterproof enclosure are possible later additions.

Stations may send readings over WiFi or use a remote-site link such as LoRa or GSM. Normalize the readings before they reach the dashboard so the UI does not depend on the station's network transport.

Use station-specific water fields: `water_level_cm` for river stations and `flood_depth_cm` for street stations. The existing firmware guidance sets street alert levels at 10, 30, and 50 cm. Show the threshold and the reading time wherever an alert appears.

## Language And Interpretation

- Describe patterns and mismatches for review. Do not accuse a person, agency, or contractor.
- Do not imply that funding caused a land or flood outcome. Compare only overlapping years and state the period.
- Put the measured fact first, then interpretation and caveats. Example: "From 2021 to 2024, this area recorded X hectares of tree cover loss. DPWH records show Y projects worth PHP Z in the same period. Project points mark work sites and may not show the area that benefits."
- Treat example figures such as "72% forest in 2010, 41% today" as mock copy until the metric, boundary, source, and calculation have been checked.
- Explain whether an amount represents ABC, contract cost, or expenditure.
- Use "unknown" or "not reported" for absent project status. Do not infer completion from a missing field.
- Keep units, date ranges, data sources, and quality flags close to the displayed values.

## Frontend And Integration Direction

The frontend is a **static Next.js export** served from private S3 through CloudFront. The browser calls the API Function URL for study areas, project locations, and metric rows. Historical imagery tiles load from Esri Wayback. Configure CORS for the local and deployed client origins.

The repository's dashboard-agent notes propose an API surface: area list and metrics, funding by area, station list and readings, and asynchronous analysis with job polling. These endpoints are a proposal, not a verified running API contract. Coordinate the frontend's data types with the backend before treating them as stable.

The Terraform currently creates S3/CloudFront, ECR, and optional Lambda functions with direct HTTPS Function URLs. It does not provision AWS IoT Core or a database. The project brief also describes MQTT and a cloud database as possible telemetry architecture. Keep the frontend independent of the transport and settle the ingest and persistence design before wiring production data.

The existing data dictionary describes an analog water sensor and temperature-based LED alerts, while the project brief and firmware-agent notes describe ultrasonic water measurement and water-depth alerts. Confirm the hardware and alert model before finalizing station fields, alert names, or thresholds in the UI.

## Frontend Delivery Scope

### First release

- Build the area explorer and study-area workspace around data that exists and has a source.
- Show the current demo areas first. Add candidate areas after boundaries, joins, and data availability are checked.
- Support land history, DPWH funding from 2021 onward, neutral insights, and the station view when each has usable data.
- Include loading, empty, stale, partial-coverage, and error states. Mark any fixture data as demo data.
- Provide a useful view when a metric is unavailable. Do not fill gaps with invented values or interpolated annual observations.
- Support a shareable area and time-range URL. Treat PDF/CSV export as a follow-up unless it is needed for the first demo.

### Later expansion

- Add and validate the full priority-area catalog and a documented risk-ranking method.
- Add additional funding sources and broader satellite measures after source-specific ingestion and quality checks.
- Add richer station alerts, rainfall gauges, export formats, and history where the data pipeline supports them.

## Decisions To Set Before Those Features Ship

1. Define risk-score inputs, normalization, weights, recency, and geographic aggregation. Until then, show components without a composite score.
2. Verify the ten-area ABC table, its source and period, record-count meaning, nearby-area matching method, and dagger marker.
3. Choose the MVP satellite datasets and document coverage and quality behavior for each.
4. Confirm whether the water sensor is ultrasonic or analog, which water measures each station reports, and which alert thresholds apply to each type.
5. Choose MQTT/AWS IoT Core or direct HTTPS ingestion, then define persistence and the frontend API contract.
6. Decide how users access the public API and whether the browser needs authentication. CORS alone does not control non-browser callers.

## Frontend Acceptance Checks

- A planner can find an area from the map or list and see its type, boundary, data coverage, and ranking inputs.
- The selected area remains clear while the planner moves between land, funding, insight, and station views.
- Each chart and map layer identifies its source, units, years, and quality state.
- Comparisons use overlapping periods and distinguish project sites from areas that may benefit.
- Every insight states the comparison window and avoids claims of causation or wrongdoing.
- The interface distinguishes zero, missing, unknown, stale, and unverified values.
- Mobile and desktop layouts keep maps, legends, controls, and labels readable without relying on color alone.
