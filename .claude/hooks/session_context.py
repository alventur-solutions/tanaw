#!/usr/bin/env python3
"""SessionStart: inject TANAW pipeline state so Claude knows what exists."""
import json
import os
import pathlib

root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", "."))
lines = ["TANAW session context:"]

metrics = sorted(p.stem for p in (root / "pipeline" / "metrics").glob("*.py") if p.stem != "__init__")
lines.append(f"- Metrics implemented: {', '.join(metrics) or 'none yet'}")

areas = []
for f in (root / "pipeline" / "areas").glob("*.geojson"):
    try:
        props = json.loads(f.read_text())["features"][0]["properties"]
        areas.append(f"{props.get('area_id', f.stem)} ({props.get('study_type', '?')})")
    except Exception:
        areas.append(f.stem)
lines.append(f"- Study areas: {', '.join(areas) or 'none yet'}")

raw = list((root / "funding" / "raw").glob("*.csv"))
clean = list((root / "funding" / "clean").glob("*"))
lines.append(f"- Funding files: {len(raw)} raw, {len(clean)} cleaned")
lines.append(f"- EE_PROJECT: {os.environ.get('EE_PROJECT') or 'not set'}")
print("\n".join(lines))
