#!/usr/bin/env python3
"""PreToolUse: block edits to secrets and to applied DB migrations."""
import json
import re
import sys

data = json.load(sys.stdin)
path = data.get("tool_input", {}).get("file_path", "")

BLOCKED = [
    r"(^|/)\.env(\..*)?$",
    r"(^|/)secrets/",
    r"service[-_]account.*\.json$",
    r"firmware/include/secrets\.h$",
]
for pat in BLOCKED:
    if re.search(pat, path):
        print(f"Blocked: {path} holds credentials. Edit it by hand.", file=sys.stderr)
        sys.exit(2)

# Applied migrations are immutable; add a new numbered migration instead.
if re.search(r"db/migrations/applied/", path):
    print("Blocked: applied migrations are immutable. Create a new migration.", file=sys.stderr)
    sys.exit(2)

sys.exit(0)
