#!/usr/bin/env python3
"""PreToolUse (Bash): require --dry-run for pipeline exports, block destructive commands."""
import json
import re
import sys

data = json.load(sys.stdin)
cmd = data.get("tool_input", {}).get("command", "")

# Real Earth Engine exports cost quota and time. Force a dry run unless explicitly confirmed.
if re.search(r"pipeline\.run", cmd) and "--dry-run" not in cmd and "--confirmed" not in cmd:
    print(
        "Blocked: run with --dry-run on a small year range first. "
        "After the user approves, re-run with --confirmed.",
        file=sys.stderr,
    )
    sys.exit(2)

DANGEROUS = [
    r"\bdrop\s+(table|database|schema)\b",
    r"\btruncate\b",
    r"rm\s+-rf\s+(/|~|\.|data)\b",
    r"gsutil\s+(-m\s+)?rm\b",
    r"earthengine\s+rm\b",
    r"git\s+push\s+.*--force",
]
for pat in DANGEROUS:
    if re.search(pat, cmd, re.IGNORECASE):
        print(f"Blocked destructive command (matched {pat}). Ask the user to run it.", file=sys.stderr)
        sys.exit(2)

sys.exit(0)
