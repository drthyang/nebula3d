# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Dataset listing endpoints, and regridding a dataset into a new one."""

from __future__ import annotations

import math
import platform
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request

from nebula3d.server import consistency as consistency_mod
from nebula3d.server import datasets as ds_mod
from nebula3d.server import deltapdf as dpdf_mod
from nebula3d.server import regrid as regrid_mod
from nebula3d.server import volumes as vol_mod
from nebula3d.server.config import ServerConfig
from nebula3d.server.deps import get_config
from nebula3d.server.schemas import (
    DataRootIn,
    DataRootOut,
    DatasetOut,
    RawFileOut,
    RegridIn,
    RegridOut,
    StageStatusOut,
)

router = APIRouter(prefix="/api", tags=["datasets"])


def _data_root_out(cfg: ServerConfig) -> DataRootOut:
    return DataRootOut(
        data_root=str(cfg.data_root),
        raw_exists=cfg.raw_dir.is_dir(),
        processed_exists=cfg.processed_dir.is_dir(),
        n_datasets=len(ds_mod.discover_datasets(cfg)),
    )


def _switch_data_root(root: Path, request: Request) -> DataRootOut:
    root = root.expanduser().resolve()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail=f"Folder does not exist: {root}")

    cfg = ServerConfig(data_root=root)
    request.app.state.config = cfg
    vol_mod.clear_cache()
    dpdf_mod.clear_cache()
    consistency_mod.clear_cache()
    return _data_root_out(cfg)


def _choose_directory(initial: Path) -> Path | None:
    """Ask the server's desktop session for a folder path."""
    initial = initial.expanduser().resolve()
    system = platform.system()

    if system == "Darwin":
        escaped = str(initial).replace("\\", "\\\\").replace('"', '\\"')
        script = (
            f'set initialFolder to POSIX file "{escaped}"\n'
            "try\n"
            '  set chosenFolder to choose folder with prompt "Choose nebula3d data folder" '
            "default location initialFolder\n"
            "  POSIX path of chosenFolder\n"
            "on error number -128\n"
            '  return ""\n'
            "end try\n"
        )
        proc = subprocess.run(
            ["osascript", "-e", script],
            check=False,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            msg = proc.stderr.strip() or "macOS folder picker failed"
            raise HTTPException(status_code=500, detail=msg)
        selected = proc.stdout.strip()
        return Path(selected) if selected else None

    if system == "Linux" and shutil.which("zenity"):
        proc = subprocess.run(
            [
                "zenity",
                "--file-selection",
                "--directory",
                f"--filename={initial}/",
                "--title=Choose nebula3d data folder",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if proc.returncode == 1:
            return None
        if proc.returncode != 0:
            msg = proc.stderr.strip() or "Linux folder picker failed"
            raise HTTPException(status_code=500, detail=msg)
        return Path(proc.stdout.strip())

    try:
        import tkinter as tk
        from tkinter import filedialog
    except Exception as exc:  # pragma: no cover - platform fallback
        raise HTTPException(
            status_code=501,
            detail="No local folder picker is available; paste the full folder path.",
        ) from exc

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        selected = filedialog.askdirectory(
            initialdir=str(initial),
            title="Choose nebula3d data folder",
            mustexist=True,
        )
    finally:
        root.destroy()
    return Path(selected) if selected else None


@router.get("/data-root", response_model=DataRootOut)
def get_data_root(cfg: ServerConfig = Depends(get_config)) -> DataRootOut:
    """Return the active data root scanned by the web server."""
    return _data_root_out(cfg)


@router.put("/data-root", response_model=DataRootOut)
def set_data_root(req: DataRootIn, request: Request) -> DataRootOut:
    """Switch the active data root for this running server process."""
    return _switch_data_root(Path(req.data_root), request)


@router.post("/data-root/browse", response_model=DataRootOut)
def browse_data_root(
    request: Request,
    cfg: ServerConfig = Depends(get_config),
) -> DataRootOut:
    """Open a trusted local folder picker and switch to the selected root."""
    if request.headers.get("x-nebula3d-local") != "1":
        raise HTTPException(status_code=403, detail="Missing local request header")

    selected = _choose_directory(cfg.data_root)
    if selected is None:
        raise HTTPException(status_code=409, detail="Folder selection canceled")
    return _switch_data_root(selected, request)


def _dataset_out(ds: ds_mod.Dataset) -> DatasetOut:
    stages = [
        StageStatusOut(name=s.name, exists=s.exists, kind=s.kind,
                       volume_id=f"{ds.id}.{s.name}",
                       mtime=ds_mod.output_mtime(s),
                       source=ds_mod.output_source(ds, s))
        for s in ds.stages
    ]
    raw = ds_mod.raw_file_stat(ds.raw_path)
    return DatasetOut(
        id=ds.id, temperature=ds.temperature, raw_name=ds.raw_name,
        stem=ds.stem, stages=stages,
        raw_file=RawFileOut(size=raw[0], mtime=raw[1]) if raw else None,
    )


@router.get("/datasets", response_model=list[DatasetOut])
def list_datasets(cfg: ServerConfig = Depends(get_config)) -> list[DatasetOut]:
    """List datasets grouped by raw input, with per-stage output status."""
    return [_dataset_out(ds) for ds in ds_mod.discover_datasets(cfg)]


@router.get("/datasets/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: str, cfg: ServerConfig = Depends(get_config)) -> DatasetOut:
    """One dataset — including a tuning view (``<id>~tune~<run>[~<trial>]``)."""
    ds = ds_mod.find_dataset(cfg, dataset_id)
    if ds is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")
    return _dataset_out(ds)


@router.post("/datasets/{dataset_id}/regrid", response_model=RegridOut)
def regrid_dataset(dataset_id: str, req: RegridIn,
                   cfg: ServerConfig = Depends(get_config)) -> RegridOut:
    """Regrid the dataset's raw volume onto its refined UB (the UB check's
    fit), as a new dataset beside it; never overwriting a file.  A refusal
    (the target exists, the fit cannot turn the UB, nothing to symmetrise
    with) is a 200 with ``written`` false and ``refusal`` saying why."""
    if len(req.cell) != 3 or min(req.cell) < 1:
        raise HTTPException(400, f"cell must be three positive integers, not {req.cell!r}")
    if req.q_max is not None and not (math.isfinite(req.q_max) and req.q_max > 0):
        raise HTTPException(400, f"q_max must be positive, not {req.q_max!r}")
    if ds_mod.find_dataset(cfg, dataset_id) is None:
        raise HTTPException(404, f"unknown dataset id {dataset_id!r}")
    cell = (req.cell[0], req.cell[1], req.cell[2])
    try:
        out = regrid_mod.regrid_dataset_out(cfg, dataset_id, cell, req.q_max, req.symmetrise)
    except FileNotFoundError as exc:  # no raw volume
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:  # too few peaks to fit
        raise HTTPException(422, str(exc)) from exc
    return RegridOut(**out)
