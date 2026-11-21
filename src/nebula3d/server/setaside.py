# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Outputs set aside before a run that may be put back.

Auto mode (``web/src/llm/auto/controller.ts``) runs the pipeline after a fix
changed a setting, and puts the setting back when the fix made its stage's
check worse.  The outputs of the settings put back existed minutes earlier:
instead of computing them again, they are set aside before the fix's run and
restored after it.

    <data_root>/set-aside/<dataset>/            one per dataset
        manifest.json                           what was set aside, and from which stage
        <file names as in processed/>

- :func:`set_aside` copies every output the run will overwrite (the stage
  files from a stage on, their side files, the ΔPDF and its check) with the
  tuning runs' clone helper: a copy-on-write clone where the filesystem has
  one, else a plain copy (in the browser, a copy sized first); never a hard
  link.  It is skipped when the disk is
  short (:func:`space_refusal`).
- :func:`restore` moves them back over ``processed/`` with their dates, then
  asks :func:`nebula3d.pipeline.resume_plan` whether a run with the settings
  put back would compute anything.  It reports "not restored" for anything
  less than that, and the caller then runs the pipeline as it did before.
- :func:`discard` deletes them (the fix was kept, or the run ended).

The folder is no dataset and no tuning run: the dataset listing reads only
``raw/`` and ``processed/``, the tuning runs only ``tuning/``.

No FastAPI here: the in-browser bridge reuses this module.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from collections.abc import Collection
from dataclasses import dataclass, field
from pathlib import Path

from nebula3d.pipeline import (
    STAGES,
    PipelineParams,
    PipelinePaths,
    pipeline_paths,
    resolve_symmetry_average,
    resume_plan,
)
from nebula3d.server.config import ServerConfig
from nebula3d.server.tuning import ARTIFACT_STAGE, TUNE_STAGES, _clone, _trial_files

SET_ASIDE_DIR = "set-aside"
_MANIFEST = "manifest.json"

#: The stages a run can start from, in order: the symmetry average, then the
#: tuning stages (``pdf`` with its check).
FROM_STAGES: tuple[str, ...] = ("symmetry_average", *TUNE_STAGES)

#: Free space kept beyond the files set aside: the disk must hold them twice
#: over and this much more.  A clone takes no space when it is made, but the
#: run that follows rewrites the originals, and the clones then hold the old
#: blocks alone: the cost is the files' size either way.
FREE_SPACE_MARGIN_BYTES = 1 << 30

_DATASET_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*$")


@dataclass(frozen=True)
class SetAside:
    """What :func:`set_aside` did: the files kept, or why none were."""

    done: bool
    reason: str | None = None
    files: list[str] = field(default_factory=list)
    bytes: int = 0

    def as_dict(self) -> dict[str, object]:
        return {"set_aside": self.done, "reason": self.reason, "files": self.files,
                "bytes": self.bytes}


@dataclass(frozen=True)
class Restored:
    """What :func:`restore` did: the files put back, or why it did not."""

    done: bool
    reason: str | None = None
    files: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {"restored": self.done, "reason": self.reason, "files": self.files}


def set_aside_root(cfg: ServerConfig) -> Path:
    return cfg.data_root / SET_ASIDE_DIR


def _folder(cfg: ServerConfig, dataset_id: str) -> Path:
    if not _DATASET_RE.match(dataset_id):
        raise ValueError(f"bad dataset id {dataset_id!r}")
    return set_aside_root(cfg) / dataset_id


def _from_index(from_stage: str) -> int:
    if from_stage not in FROM_STAGES:
        raise ValueError(f"bad stage {from_stage!r}; choose one of {FROM_STAGES}")
    return FROM_STAGES.index(from_stage)


def _artifacts_from(paths: PipelinePaths, from_stage: str) -> list[Path]:
    """Every artifact a run from *from_stage* may write, whether it exists or not."""
    first = _from_index(from_stage)
    out = [paths.symmetrized] if first == 0 else []
    out += [getattr(paths, attr) for attr, stage in ARTIFACT_STAGE.items()
            if FROM_STAGES.index(stage) >= first]
    return out


def _rewritten(p: PipelineParams, paths: PipelinePaths, from_stage: str) -> list[Path]:
    """The files a run from *from_stage* with the settings *p* writes: each
    stage switched on from there, with the side files its settings leave
    (:func:`nebula3d.server.tuning._trial_files`)."""
    first = _from_index(from_stage)
    out = [paths.symmetrized] if first == 0 and p.stage_enabled("symmetry_average") else []
    for stage in TUNE_STAGES:
        if FROM_STAGES.index(stage) >= first and p.stage_enabled(stage):
            out += _trial_files(stage, p, paths)
    return out


def space_refusal(need: int, free: int) -> str | None:
    """Why *need* bytes are not set aside on a disk with *free* bytes left
    (None: they are): the disk must hold them twice over and
    :data:`FREE_SPACE_MARGIN_BYTES` more."""
    wanted = 2 * need + FREE_SPACE_MARGIN_BYTES
    if free < wanted:
        return (f"the disk has {free / 1e9:.1f} GB free; setting {need / 1e9:.1f} GB aside "
                f"needs {wanted / 1e9:.1f} GB")
    return None


def discard(cfg: ServerConfig, dataset_id: str) -> bool:
    """Delete what is set aside for *dataset_id*; True when there was any."""
    folder = _folder(cfg, dataset_id)
    if not folder.exists():
        return False
    shutil.rmtree(folder, ignore_errors=True)
    try:
        set_aside_root(cfg).rmdir()  # the last one: the folder itself goes
    except OSError:
        pass
    return True


def sweep(cfg: ServerConfig) -> int:
    """Delete everything set aside under the data root (a server starting:
    the run that set it aside is gone); how many datasets' were."""
    root = set_aside_root(cfg)
    if not root.is_dir():
        return 0
    n = 0
    for folder in sorted(root.iterdir()):
        if folder.is_dir() and _DATASET_RE.match(folder.name):
            shutil.rmtree(folder, ignore_errors=True)
            n += 1
    try:
        root.rmdir()
    except OSError:
        pass
    return n


def set_aside(
    cfg: ServerConfig, dataset_id: str, raw_path: Path, from_stage: str, *,
    max_bytes: int | None = None,
) -> SetAside:
    """Set aside *dataset_id*'s outputs from *from_stage* to the end, in place
    of anything set aside for it before.

    Every artifact on disk a run from there may write is kept: the stage
    files, the ring diagnostics, the punch's profile, the ΔPDF and its check.
    Nothing is kept, and ``processed/`` is only read, when there is nothing to
    keep, when the files are larger than *max_bytes* (the browser's cap), when
    the disk is short (:func:`space_refusal`), or when a copy fails.
    """
    discard(cfg, dataset_id)
    paths = pipeline_paths(raw_path, proc_dir=cfg.processed_dir)
    files = [f for f in _artifacts_from(paths, from_stage) if f.is_file()]
    if not files:
        return SetAside(False, "no outputs to set aside")
    need = sum(f.stat().st_size for f in files)
    if max_bytes is not None and need > max_bytes:
        return SetAside(False, f"{need / 1e6:.0f} MB of outputs is over the "
                               f"{max_bytes / 1e6:.0f} MB kept in memory", bytes=need)
    try:
        refusal = space_refusal(need, shutil.disk_usage(cfg.data_root).free)
    except OSError:
        refusal = None  # no disk to ask (an in-memory filesystem): the cap above decides
    if refusal is not None:
        return SetAside(False, refusal, bytes=need)
    folder = _folder(cfg, dataset_id)
    try:
        folder.mkdir(parents=True)
        kept: dict[str, dict[str, int]] = {}
        for f in files:
            st = f.stat()
            dst = folder / f.name
            _clone(f, dst)
            os.utime(dst, ns=(st.st_atime_ns, st.st_mtime_ns))
            copy = dst.stat()
            if copy.st_size != st.st_size:
                raise OSError(f"{f.name} was not copied whole")
            # The copy's own date as its filesystem holds it: the original's,
            # to that filesystem's resolution (the browser's in-memory one
            # keeps milliseconds).
            kept[f.name] = {"size": copy.st_size, "mtime_ns": copy.st_mtime_ns}
        (folder / _MANIFEST).write_text(json.dumps({
            "dataset_id": dataset_id, "raw_name": raw_path.name,
            "from_stage": from_stage, "files": kept}, indent=2))
    except OSError as exc:
        discard(cfg, dataset_id)
        return SetAside(False, f"could not set the outputs aside: {exc}", bytes=need)
    return SetAside(True, None, sorted(kept), need)


def _manifest(folder: Path) -> dict[str, object] | None:
    try:
        meta = json.loads((folder / _MANIFEST).read_text())
    except (OSError, ValueError):
        return None
    return meta if isinstance(meta, dict) and isinstance(meta.get("files"), dict) else None


def held(cfg: ServerConfig, dataset_id: str) -> dict[str, object] | None:
    """What is set aside for *dataset_id* (its manifest), or None."""
    return _manifest(_folder(cfg, dataset_id))


def restore(
    cfg: ServerConfig, dataset_id: str, raw_path: Path, params: PipelineParams, *,
    pdf_configs: Collection[str] | None = None,
) -> Restored:
    """Put back what is set aside for *dataset_id*, for a run of the settings
    *params* that is then not needed; what is set aside is gone afterwards,
    whatever the answer.

    The files put back are those a run of *params* from the stage they were
    set aside at would write (:func:`_rewritten`): all of them must be there,
    whole and dated as they were.  They are then moved over ``processed/``
    (a rename each, their dates kept); a file of a stage *params* switches
    off is left as the run in between left it, as a run would leave it.
    Restored only when :func:`~nebula3d.pipeline.resume_plan` then computes
    nothing for *params* (*pdf_configs* as it takes them).  Anything else is
    "not restored" with the reason, and the caller runs the pipeline from
    that stage, which makes every one of these files again.
    """
    folder = _folder(cfg, dataset_id)
    try:
        meta = _manifest(folder)
        if meta is None:
            return Restored(False, "nothing was set aside")
        if meta.get("dataset_id") != dataset_id or meta.get("raw_name") != raw_path.name:
            return Restored(False, "what was set aside is another dataset's")
        from_stage = str(meta.get("from_stage"))
        kept = meta["files"]
        assert isinstance(kept, dict)
        p, _ = resolve_symmetry_average(params, raw_path)
        paths = pipeline_paths(raw_path, proc_dir=cfg.processed_dir)
        wanted = _rewritten(p, paths, from_stage)
        for dst in wanted:
            src, was = folder / dst.name, kept.get(dst.name)
            if not isinstance(was, dict) or not src.is_file():
                return Restored(False, f"{dst.name} was not set aside")
            st = src.stat()
            if st.st_size != was.get("size") or st.st_mtime_ns != was.get("mtime_ns"):
                return Restored(False, f"{dst.name} changed since it was set aside")
        expected = {f.name for f in wanted}
        try:
            for dst in wanted:
                os.replace(folder / dst.name, dst)
        except OSError as exc:
            return Restored(False, f"could not put the outputs back: {exc}")
        plan = resume_plan(raw_path, params, proc_dir=cfg.processed_dir, stages=STAGES,
                           pdf_configs=pdf_configs)
        if plan:
            stage, why = next(iter(plan.items()))
            return Restored(False, f"a run would still compute {stage}: {why}",
                            sorted(expected))
        return Restored(True, None, sorted(expected))
    finally:
        discard(cfg, dataset_id)
