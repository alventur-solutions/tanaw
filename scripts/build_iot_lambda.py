#!/usr/bin/env python3
"""Build the Lambda zip for the Neon-backed IoT receiver."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

REPO_ROOT = Path(__file__).resolve().parents[1]
INFRA_DIR = REPO_ROOT / "infra"
SOURCE = REPO_ROOT / "iot" / "server" / "receiver.py"
REQUIREMENTS = REPO_ROOT / "iot" / "server" / "requirements-lambda.txt"
API_DIR = REPO_ROOT / "api"
ARTIFACT = INFRA_DIR / "build" / "iot_receiver.zip"
API_MODULES = ("__init__.py", "config.py", "db.py")


def pip_command() -> list[str]:
    candidates = [[sys.executable, "-m", "pip"]]
    for name in ("pip3", "pip"):
        executable = shutil.which(name)
        if executable:
            candidates.append([executable])

    for candidate in candidates:
        result = subprocess.run(
            [*candidate, "--version"], capture_output=True, check=False, text=True
        )
        if result.returncode == 0:
            return candidate

    raise SystemExit("pip is required to build the Lambda dependency bundle")


def main() -> None:
    for path in (SOURCE, REQUIREMENTS, *(API_DIR / name for name in API_MODULES)):
        if not path.is_file():
            raise SystemExit(f"Required Lambda source file not found: {path}")

    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    ARTIFACT.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="iot-lambda-stage-", dir=ARTIFACT.parent) as tmp:
        stage = Path(tmp)
        command = [
            *pip_command(),
            "install",
            "--disable-pip-version-check",
            "--only-binary=:all:",
            "--platform=manylinux2014_x86_64",
            "--implementation=cp",
            "--python-version=3.12",
            "--abi=cp312",
            "--target",
            str(stage),
            "-r",
            str(REQUIREMENTS),
        ]
        subprocess.run(command, check=True)

        shutil.copy2(SOURCE, stage / "receiver.py")
        package_dir = stage / "api"
        package_dir.mkdir(exist_ok=True)
        for name in API_MODULES:
            shutil.copy2(API_DIR / name, package_dir / name)

        with ZipFile(ARTIFACT, "w", compression=ZIP_DEFLATED) as archive:
            for path in sorted(stage.rglob("*")):
                if not path.is_file() or "__pycache__" in path.parts or path.suffix == ".pyc":
                    continue
                if path.name == ".env" or path.name.startswith(".env."):
                    continue
                archive.write(path, arcname=path.relative_to(stage).as_posix())

    print(ARTIFACT.relative_to(INFRA_DIR).as_posix())


if __name__ == "__main__":
    main()
