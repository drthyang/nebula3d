# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""``scripts/build_web_wheel.py`` — the data-free, content-addressed wheel the
browser (Pages / Pyodide) build installs at runtime."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / "scripts" / "build_web_wheel.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("build_web_wheel", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_wheel(path: Path, members: list[str]) -> Path:
    with zipfile.ZipFile(path, "w") as zf:
        for name in members:
            zf.writestr(name, b"x")
    return path


def test_check_wheel_payload_flags_data_and_nested_wheels(tmp_path):
    mod = _load_script()
    clean = _make_wheel(tmp_path / "clean.whl", [
        "nebula3d/__init__.py",
        "nebula3d/server/static/index.html",
        "nebula3d/server/static/assets/index-abc.js",
        "nebula3d-0.3.0.dist-info/RECORD",
    ])
    assert mod.check_wheel_payload(clean) == []

    offenders = [
        "nebula3d/server/static/data/volume.h5",
        "nebula3d/server/static/data/manifest.json",       # anything under data/
        "nebula3d/server/static/wheels/nebula3d-0.3.0-py3-none-any.whl",
        "nebula3d/examples/cache.NPY",                      # case-insensitive suffix
    ]
    dirty = _make_wheel(tmp_path / "dirty.whl", ["nebula3d/__init__.py", *offenders])
    assert sorted(mod.check_wheel_payload(dirty)) == sorted(offenders)


def test_publish_is_content_addressed_and_keeps_exactly_one_wheel(tmp_path):
    mod = _load_script()
    out = tmp_path / "wheels"
    # Leftovers from earlier builds: a previous hash dir and a loose wheel.
    (out / "0123456789ab").mkdir(parents=True)
    (out / "0123456789ab" / "nebula3d-0.2.0-py3-none-any.whl").write_bytes(b"old")
    (out / "nebula3d-0.1.0-py3-none-any.whl").write_bytes(b"loose")

    wheel = _make_wheel(tmp_path / "nebula3d-9.9.9-py3-none-any.whl", ["nebula3d/__init__.py"])
    manifest = mod.publish(wheel, out)

    digest = hashlib.sha256(wheel.read_bytes()).hexdigest()
    assert manifest["wheel"] == f"{digest[:mod.HASH_CHARS]}/nebula3d-9.9.9-py3-none-any.whl"
    assert manifest["sha256"] == digest
    assert (out / manifest["wheel"]).read_bytes() == wheel.read_bytes()
    assert json.loads((out / "manifest.json").read_text()) == manifest
    assert not (out / "0123456789ab").exists()
    assert not (out / "nebula3d-0.1.0-py3-none-any.whl").exists()
    published = [p for p in out.rglob("*.whl")]
    assert published == [out / manifest["wheel"]]


def test_end_to_end_build_excludes_static_data_and_wheels(tmp_path):
    """Build the real package from a copy of the source tree seeded with the two
    things that must never ship — a data file and a stale wheel under
    ``server/static/`` — and check that pyproject's ``exclude-package-data``
    keeps them out (the script's payload guard is the independent backstop)
    while the SPA assets stay in and the version comes from ``_version.py``."""
    repo = tmp_path / "repo"
    repo.mkdir()
    for name in ("pyproject.toml", "README.md", "LICENSE", "NOTICE"):
        shutil.copy2(REPO / name, repo / name)
    shutil.copytree(
        REPO / "src", repo / "src",
        ignore=shutil.ignore_patterns("*.egg-info", "__pycache__", "static"),
    )
    static = repo / "src" / "nebula3d" / "server" / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<!doctype html>")
    (static / "assets" / "index-abc.js").write_text("// spa")
    (static / "data").mkdir()
    (static / "data" / "volume.h5").write_bytes(b"\x89HDF")
    (static / "wheels").mkdir()
    (static / "wheels" / "nebula3d-0.0.0-py3-none-any.whl").write_bytes(b"PK")

    mod = _load_script()
    out = tmp_path / "out"
    assert mod.main(["--repo", str(repo), "--out", str(out)]) == 0

    manifest = json.loads((out / "manifest.json").read_text())
    wheel = out / manifest["wheel"]
    names = zipfile.ZipFile(wheel).namelist()
    assert "nebula3d/server/static/index.html" in names
    assert "nebula3d/server/static/assets/index-abc.js" in names
    assert not [n for n in names if "/static/data/" in n or "/static/wheels/" in n]
    assert not [n for n in names if n.endswith(".whl")]

    from nebula3d import __version__
    assert wheel.name == f"nebula3d-{__version__}-py3-none-any.whl"
    assert manifest["sha256"] == hashlib.sha256(wheel.read_bytes()).hexdigest()
