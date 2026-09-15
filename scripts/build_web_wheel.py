#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Build the data-free ``nebula3d`` wheel the browser (Pages / Pyodide) build
micropip-installs at runtime, and the manifest both workers resolve it from.

Used by ``make web-wheel`` and ``.github/workflows/pages.yml`` so the two can
never drift.  What it does, in order:

1. ``rm -rf build/ src/*.egg-info`` — a stale ``build/lib`` can carry modules
   that no longer exist in ``src/`` into the wheel.
2. ``pip wheel . --no-deps`` into a temporary directory.
3. Refuses the wheel if it carries anything that must never ship: experimental
   data (``.nxs``/``.h5``/``.npy``/…), anything under ``server/static/data/``
   or ``server/static/wheels/`` (pyproject's ``exclude-package-data`` already
   drops both; this is the independent second guard), or a nested ``.whl``.
4. Places the wheel **content-addressed** at
   ``web/public/wheels/<sha256[:12]>/<wheel>`` and writes
   ``web/public/wheels/manifest.json`` → ``{"wheel": "<h12>/<name>", ...}``.
   GitHub Pages caches assets for 10 min and the wheel name only carries the
   package version, so a version-named URL could serve a *stale* wheel to a
   browser that already loaded the new (hash-named) JS; a hash directory
   makes every distinct wheel a distinct URL.  Older hash directories are
   removed so exactly one wheel is ever published.

Usage:
    python scripts/build_web_wheel.py [--repo DIR] [--out DIR] [--python EXE]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

#: File suffixes that only ever belong to experimental data (or a nested wheel).
FORBIDDEN_SUFFIXES = (".bin", ".nxs", ".h5", ".hdf5", ".npy", ".npz", ".whl")
#: Package sub-trees that must never be shipped in the browser wheel.
FORBIDDEN_PREFIXES = ("nebula3d/server/static/data/", "nebula3d/server/static/wheels/")

HASH_CHARS = 12


def check_wheel_payload(wheel: Path) -> list[str]:
    """Return the offending member names (empty list = clean)."""
    bad: list[str] = []
    with zipfile.ZipFile(wheel) as zf:
        for name in zf.namelist():
            lower = name.lower()
            if lower.endswith(FORBIDDEN_SUFFIXES) or name.startswith(FORBIDDEN_PREFIXES):
                bad.append(name)
    return bad


def build_wheel(repo: Path, python: str, tmp: Path) -> Path:
    for stale in [repo / "build", *repo.glob("src/*.egg-info")]:
        shutil.rmtree(stale, ignore_errors=True)
    subprocess.run(
        [python, "-m", "pip", "wheel", str(repo), "--no-deps", "-w", str(tmp)],
        check=True,
    )
    wheels = sorted(tmp.glob("*.whl"))
    if len(wheels) != 1:
        raise SystemExit(f"expected exactly one wheel in {tmp}, got {wheels}")
    return wheels[0]


def publish(wheel: Path, out: Path) -> dict[str, str]:
    digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
    subdir = digest[:HASH_CHARS]
    out.mkdir(parents=True, exist_ok=True)
    # Exactly one published wheel: drop previous hash dirs and loose wheels.
    for child in out.iterdir():
        if child.is_dir() and re.fullmatch(rf"[0-9a-f]{{{HASH_CHARS}}}", child.name):
            shutil.rmtree(child)
        elif child.suffix == ".whl":
            child.unlink()
    dest = out / subdir / wheel.name
    dest.parent.mkdir()
    shutil.copy2(wheel, dest)
    manifest = {
        "wheel": f"{subdir}/{wheel.name}",
        "sha256": digest,
        "size": str(dest.stat().st_size),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main(argv: list[str] | None = None) -> int:
    here = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--repo", type=Path, default=here, help="repository root")
    ap.add_argument("--out", type=Path, default=None,
                    help="publish dir (default: <repo>/web/public/wheels)")
    ap.add_argument("--python", default=sys.executable,
                    help="interpreter whose pip builds the wheel")
    args = ap.parse_args(argv)
    repo = args.repo.resolve()
    out = (args.out or repo / "web" / "public" / "wheels").resolve()

    with tempfile.TemporaryDirectory(prefix="nebula3d-wheel-") as tmpdir:
        wheel = build_wheel(repo, args.python, Path(tmpdir))
        offenders = check_wheel_payload(wheel)
        if offenders:
            print("DATA LEAK in wheel — refusing to publish:", file=sys.stderr)
            for name in offenders:
                print(f"  {name}", file=sys.stderr)
            return 1
        manifest = publish(wheel, out)
    print(f"published {out / manifest['wheel']}  ({manifest['size']} bytes, "
          f"sha256 {manifest['sha256'][:HASH_CHARS]}…)")
    print(f"manifest {out / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
