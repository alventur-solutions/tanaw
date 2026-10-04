#!/usr/bin/env python3
"""PostToolUse: format Python, flag em dashes and 'deforestation' wording for Hansen data."""
import json
import re
import shutil
import subprocess
import sys

data = json.load(sys.stdin)
path = data.get("tool_input", {}).get("file_path", "")
warnings = []

if path.endswith(".py") and shutil.which("ruff"):
    subprocess.run(["ruff", "format", path], capture_output=True)
    res = subprocess.run(["ruff", "check", "--fix", path], capture_output=True, text=True)
    if res.returncode != 0:
        warnings.append(f"ruff issues in {path}:\n{res.stdout.strip()}")

try:
    with open(path, encoding="utf-8") as f:
        text = f.read()
except (OSError, UnicodeDecodeError):
    text = ""

if path.endswith((".md", ".tsx", ".ts", ".jsx", ".html")) and "—" in text:
    warnings.append(f"{path} contains an em dash. Project style forbids them.")

if "hansen" in text.lower() and re.search(r"\bdeforestation\b", text, re.IGNORECASE):
    warnings.append(f"{path}: Hansen data must be labeled 'tree cover loss', not 'deforestation'.")

USER_FACING = (".md", ".tsx", ".ts", ".jsx", ".html", ".js")
if path.endswith(USER_FACING) and "/.claude/" not in path:
    for word in ("corruption", "corrupt", "ghost project", "proves that"):
        if re.search(rf"\b{word}\b", text, re.IGNORECASE):
            warnings.append(
                f"{path}: uses '{word}'. TANAW shows patterns, not wrongdoing. Use neutral wording."
            )

if warnings:
    # Exit 2 on PostToolUse feeds stderr back to Claude so it can fix the issue.
    print("\n".join(warnings), file=sys.stderr)
    sys.exit(2)
sys.exit(0)
