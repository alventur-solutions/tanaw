# TANAW

Topographic Assessment for National Adaptation Works.

## Kiro setup in this repo

| Type | Name | Use it for |
|---|---|---|
| Agent | gee-pipeline-engineer | Earth Engine metric code |
| Agent | geospatial-reviewer | Read-only review of science and wording |
| Agent | funding-data-analyst | DPWH and other funding data |
| Agent | iot-firmware-engineer | ESP32 river and street stations |
| Agent | dashboard-engineer | FastAPI backend and React dashboard |
| Skill | study-area-setup | Add a river basin, rural upland, or urban area |
| Skill | add-satellite-metric | Add any new satellite metric |
| Skill | urban-imperviousness | Built-up, green space, night lights for cities |
| Skill | flood-extent-sar | Sentinel-1 flood extent and flood per mm of rain |
| Skill | dpwh-ingest | Clean and geotag the DPWH flood control CSV |
| Skill | funding-vs-land-insight | Neutral plain-language insight text |
| Skill | gee-app-prototype | Earth Engine App for demos |

Hooks:
- SessionStart: shows implemented metrics, study areas, funding files, EE project.
- PreToolUse: blocks edits to secrets and applied migrations, requires dry runs for pipeline exports, blocks destructive commands.
- PostToolUse: ruff on Python, flags em dashes, wrong labels for Hansen data, and accusatory words in user-facing files.

Requirements: python3, ruff, earthengine-api.

## First prompts
1. "Scaffold the repo based on CLAUDE.md with pyproject.toml, pipeline/run.py, and db/migrations/001_init.sql."
2. "Use the study-area-setup skill for pasig-marikina-tullahan, antipolo-rodriguez-uplands, and quezon-city."
3. "Use the dpwh-ingest skill on funding/raw/flood-control-projects-full_2026-10-03.csv."
4. "Use the gee-app-prototype skill to build the demo app."
