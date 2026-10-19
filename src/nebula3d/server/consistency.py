# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Back-FFT consistency check for the API.

Runs the |Q|-band-limited ΔPDF round trip (``nebula3d.pipeline.consistency_reconstruction``)
for a dataset and serves the resulting reciprocal-space volumes — ``data`` (the
band-limited input), ``recon`` (the inverse-FFT of that band's ΔPDF), and
``residual`` — as the same binary slice envelope the cleanup viewer uses, plus
the agreement metrics.

The round trip transforms what the dataset's run transformed, as the run did:
the volume its ΔPDF was made from, with the window, its σ, shape and support,
the zero padding and the mean and smooth-background subtraction the run used.
The ΔPDF records both in its provenance (``source_file`` and
``transform_config``, read back by
:func:`nebula3d.pipeline.delta_pdf_settings_from_config`).  The view keeps the
full |Q| range by design (no crop: see ``DeltaPdfParams.crop_hkl``), and its
|Q| band is the request's.  A dataset whose ΔPDF records no transform (none on
disk, or one that predates the record) gets the package defaults,
``DeltaPdfParams()``; without an input to follow, the view takes the flattened
volume, else the backfilled one.  The response says so: :func:`run_settings`
builds its ``settings`` field.

A reconstruction (one forward+inverse FFT) is the expensive part, so it is LRU
cached by ``(pdf-input path, mtime, transform, |Q| and |R| bands)``: changing
the displayed plane/cut re-slices the cached volumes (cheap), and only a new
band, or a ΔPDF re-run with other settings, recomputes.

:func:`saved_check` is the cheap counterpart: it re-reads the metrics the
pipeline's own check stage saved for the ΔPDF it produced, with no FFT at all.
"""

from __future__ import annotations

import dataclasses
import functools
import json
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from nebula3d.io.delta_pdf_file import load_delta_pdf
from nebula3d.pipeline import (
    DeltaPdfParams,
    consistency_reconstruction,
    delta_pdf_settings_from_config,
    delta_pdf_transform_config,
    write_delta_pdf_h5,
)
from nebula3d.server.config import ServerConfig
from nebula3d.server.datasets import Dataset, artifact_path, find_dataset
from nebula3d.server.volumes import PLANES, lattice_parameters, load_volume, pack_slice
from nebula3d.visualization import extract_slice
from nebula3d.visualization.slices import extract_slice_dpdf

#: The three comparison volumes the viewer can slice.
PANELS: tuple[str, ...] = ("data", "recon", "residual", "dpdf")

_CACHE_MAX = 4
_cache: OrderedDict[tuple, dict] = OrderedDict()
_lock = threading.Lock()


def set_cache_max(n: int) -> None:
    """Cap the reconstruction cache (evicting oldest); the browser build
    shrinks it — each entry holds three volume-sized arrays (data / recon /
    ΔPDF); the residual panel is derived per-slice."""
    global _CACHE_MAX
    with _lock:
        _CACHE_MAX = max(1, int(n))
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)


#: The transform settings the view takes from the run's ΔPDF record.  The crop
#: and the |Q| band are the view's own: the full range, and the request's band
#: (the response reports the run's as ``run_crop_hkl`` and ``run_q_band``).
WINDOW_FIELDS: tuple[str, ...] = (
    "apodization", "gaussian_sigma", "zero_pad", "subtract_mean",
    "subtract_smooth_bg", "window_shape", "window_support")


@dataclass(frozen=True)
class ViewInput:
    """What the consistency view transforms, and how.

    ``path`` is the volume the run's ΔPDF was made from (else the flattened
    volume, else the backfilled one), ``params`` the transform the view runs
    (the run's, else the defaults; crop off), and ``settings`` the response's
    record of where both came from (:func:`run_settings`).
    """

    path: Path
    params: DeltaPdfParams
    settings: dict[str, Any]


def _input_volume(ds: Dataset) -> Path | None:
    """The fallback input, without a record to follow: flattened if present,
    else backfilled (the volume the pipeline's ΔPDF stage takes)."""
    by_name = {s.name: s for s in ds.stages}
    for name in ("flattened", "backfilled"):
        stage = by_name.get(name)
        if stage is not None and stage.exists:
            return stage.path
    return None


def _named_input(ds: Dataset, record: Path, made_from: str) -> Path | None:
    """The volume a ΔPDF record names as its input, when it is on disk: the
    dataset's stage of that name (a tuning view's stages live in its run's
    folders), else the file of that name beside the ΔPDF.  Only the name is
    read, so a record cannot point the view outside the dataset's folders."""
    name = Path(made_from).name
    for stage in ds.stages:
        if stage.kind == "hkl" and stage.path.name == name and stage.path.is_file():
            return stage.path
    beside = record.parent / name
    return beside if beside.is_file() else None


def _finite(obj: object) -> object:
    """NaN/inf → None (the check writes NaN for a degenerate per-plane r)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _finite(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finite(v) for v in obj]
    return obj


@functools.lru_cache(maxsize=16)
def _record(path: str, mtime_ns: int, size: int) -> tuple[str, str]:
    """``(source_file, transform_config)`` of the ΔPDF at *path*, as it was at
    *mtime_ns*: read once per version of the file, not on every slice."""
    logs = load_delta_pdf(path, read_data=False).logs
    return str(logs.get("source_file") or ""), str(logs.get("transform_config") or "")


def run_settings(ds: Dataset) -> tuple[Path | None, DeltaPdfParams, dict[str, Any]]:
    """What the view transforms for *ds* and how, and the response's record of it.

    The view transforms what the run transformed, as the run did: the volume
    the dataset's ΔPDF records it was made from (``source_file``, reported as
    ``made_from``), with the settings it records (``transform_config``).  A
    setting the record lacks (one written before the setting existed) takes
    its default, and ``defaulted`` names it.  Without a readable record (no
    ΔPDF on disk, or one that records no transform) every setting is the
    default and ``source`` is ``"defaults"``.  Without an input to follow (no
    record names one, or the file it names is gone) the view falls back to
    the flattened volume, else the backfilled one.  Each fallback is said in
    ``note``, so none is silent; ``input`` is the volume the view transforms
    and ``same_input`` whether that is the record's (None when no record
    names one).  The run's crop and |Q| band are reported (``run_crop_hkl``,
    ``run_q_band``), not applied.  The path is None when there is nothing to
    transform.
    """
    stage = next((s for s in ds.stages if s.name == "delta_pdf"), None)
    record = stage.path if stage is not None and stage.exists else None
    recorded: dict[str, Any] = {}
    made_from: str | None = None
    notes: list[str] = []
    read = False
    if record is None:
        notes.append("no ΔPDF on disk for this dataset")
    else:
        try:
            stat = record.stat()
            source, config = _record(str(record), stat.st_mtime_ns, stat.st_size)
            made_from = source or None
            recorded = delta_pdf_settings_from_config(config)
        except Exception as exc:  # noqa: BLE001 - an unreadable record means the defaults
            made_from = None  # nor is its input taken from a record that does not read
            notes.append(f"{record.name} could not be read as a ΔPDF record ({exc})")
        else:
            read = True
            if not any(f in recorded for f in WINDOW_FIELDS):
                notes.append(f"{record.name} records no transform settings")
    from_run = not notes
    followed = (_named_input(ds, record, made_from)
                if record is not None and made_from is not None else None)
    path = followed or _input_volume(ds)
    if followed is None and path is not None:
        if record is not None and made_from is not None:
            notes.append(f"{record.name} was made from {made_from}, which is not on disk")
        elif record is not None and read:
            notes.append(f"{record.name} does not name its input")
        notes.append(f"the view falls back to {path.name}")
    run = DeltaPdfParams(**recorded)
    params = dataclasses.replace(run, crop_hkl=None, q_band=None)
    settings: dict[str, Any] = {
        "source": "run" if from_run else "defaults",
        "note": "; ".join(notes) or None,
        "delta_pdf": record.name if record is not None else None,
        "made_from": made_from,
        "input": path.name if path is not None else None,
        "same_input": None if made_from is None else followed is not None,
        "defaulted": [f for f in WINDOW_FIELDS if f not in recorded],
        **{f: getattr(params, f) for f in WINDOW_FIELDS},
        "run_crop_hkl": run.crop_hkl,
        "run_q_band": run.q_band,
    }
    return path, params, _finite(settings)  # type: ignore[return-value]


def view_input(cfg: ServerConfig, dataset_id: str) -> ViewInput | None:
    """The consistency view's input for *dataset_id*: the volume and the
    transform of the run's ΔPDF (:func:`run_settings`).  None for an unknown
    dataset, or one with nothing to transform: no record to follow and
    neither a flattened nor a backfilled volume."""
    ds = find_dataset(cfg, dataset_id)
    if ds is None:
        return None
    path, params, settings = run_settings(ds)
    return None if path is None else ViewInput(path, params, settings)


def saved_check(cfg: ServerConfig, dataset_id: str) -> dict | None:
    """The pipeline's back-FFT check result (``*_delta_pdf_consistency.json``).

    These are the metrics for the ΔPDF on disk, computed with the run's own ΔPDF
    parameters; :func:`consistency_meta` instead re-runs the round trip, with
    the same transform over the full |Q| range, for the interactive viewer's
    bands.  ``None`` for an unknown dataset.  ``has_check`` is false when the
    check never ran, or when it is older than the ΔPDF (re-run with the check
    disabled), since it then describes a ΔPDF that no longer exists.
    """
    ds = find_dataset(cfg, dataset_id)
    if ds is None:
        return None
    path = artifact_path(cfg, ds, "pdf_check_json")
    dpdf = artifact_path(cfg, ds, "delta_pdf")
    metrics = None
    if path.exists() and not (
        dpdf.exists() and dpdf.stat().st_mtime > path.stat().st_mtime
    ):
        metrics = _finite(json.loads(path.read_text(encoding="utf-8")))
    return {
        "dataset_id": dataset_id,
        "check_path": str(path),
        "has_check": metrics is not None,
        "metrics": metrics,
    }


def _band_key(q_band: tuple[float, float] | None, r_band: tuple[float, float] | None) -> tuple:
    qk = (round(float(q_band[0]), 4), round(float(q_band[1]), 4)) if q_band else None
    rk = (round(float(r_band[0]), 4), round(float(r_band[1]), 4)) if r_band else None
    return (qk, rk)


def reconstruction(
    view: ViewInput, q_band: tuple[float, float] | None, r_band: tuple[float, float] | None
) -> dict:
    """LRU-cached ``consistency_reconstruction`` for *view* + bands."""
    path = view.path
    key = (str(path), path.stat().st_mtime, delta_pdf_transform_config(view.params),
           _band_key(q_band, r_band))
    with _lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit
    vol = load_volume(path)  # shared with the slice viewers' cache
    # Evict the previous reconstruction(s) BEFORE building the new one.  Each
    # entry holds three volume-sized arrays (data / recon / ΔPDF) —
    # dead weight during the new band's memory-heavy forward+inverse FFT.  In the
    # browser (cache_max=1, a 4 GB WASM heap that never shrinks) freeing them
    # first reclaims ~4 volumes for the computation to reuse, instead of stacking
    # the old result under the new one's peak and OOM-ing.
    with _lock:
        while len(_cache) >= _CACHE_MAX:
            _cache.popitem(last=False)
    res = consistency_reconstruction(vol, view.params, q_band=q_band, r_band=r_band)
    with _lock:
        _cache[key] = res
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return res


def clear_cache() -> None:
    with _lock:
        _cache.clear()
    _record.cache_clear()


def consistency_meta(
    view: ViewInput, q_band: tuple[float, float] | None, r_band: tuple[float, float] | None
) -> dict:
    """Grid ranges, available span, the agreement metrics, and the transform's
    settings with where they came from (``settings``, :func:`run_settings`)."""
    res = reconstruction(view, q_band, r_band)
    recon = res["recon"]
    return {
        "shape": [int(n) for n in recon.data.shape],
        "h_range": [float(recon.h_axis[0]), float(recon.h_axis[-1])],
        "k_range": [float(recon.k_axis[0]), float(recon.k_axis[-1])],
        "l_range": [float(recon.l_axis[0]), float(recon.l_axis[-1])],
        "dpdf_shape": [int(n) for n in res["dpdf"].data.shape],
        "x_range": [float(res["dpdf"].x_axis[0]), float(res["dpdf"].x_axis[-1])],
        "y_range": [float(res["dpdf"].y_axis[0]), float(res["dpdf"].y_axis[-1])],
        "z_range": [float(res["dpdf"].z_axis[0]), float(res["dpdf"].z_axis[-1])],
        "lattice": lattice_parameters(recon),
        "planes": list(PLANES),
        "q_data_max": res["metrics"]["q_data_max"],
        "r_data_max": res["metrics"]["r_data_max"],
        "metrics": res["metrics"],
        "settings": view.settings,
    }


def _band_tag(q_band: tuple[float, float] | None,
              r_band: tuple[float, float] | None) -> str:
    """Filename suffix encoding the selected bands (so distinct selections
    don't overwrite each other); ``full`` when neither band is set."""
    parts = []
    if q_band is not None:
        parts.append(f"q{q_band[0]:g}-{q_band[1]:g}")
    if r_band is not None:
        parts.append(f"r{r_band[0]:g}-{r_band[1]:g}")
    return "_".join(parts) if parts else "full"


def save_reconstruction(
    view: ViewInput, q_band: tuple[float, float] | None,
    r_band: tuple[float, float] | None, out_dir: Path,
) -> Path:
    """Write the band-limited 3D-ΔPDF (the workflow's final product) to HDF5.

    ``res["dpdf"]`` is the cleaned real-space ΔPDF after the selected |Q| band
    (applied before the forward FFT) and |R| band (masked after) — i.e. exactly
    what the viewer shows, and its provenance records the transform it was
    made with: the run's window and the view's band.  Reuses the cached
    reconstruction, so saving right after viewing recomputes nothing.
    """
    path = view.path
    res = reconstruction(view, q_band, r_band)
    vol = load_volume(path)  # cached; supplies UB / lattice for provenance
    out_dir = Path(out_dir)
    out_path = out_dir / f"{path.stem}_delta_pdf_{_band_tag(q_band, r_band)}.h5"
    p = dataclasses.replace(view.params, q_band=q_band)
    write_delta_pdf_h5(
        res["dpdf"], vol, p, source_name=path.name, out_path=out_path,
        r_band=r_band)
    return out_path


def consistency_slice_envelope(
    view: ViewInput, q_band: tuple[float, float] | None, r_band: tuple[float, float] | None,
    panel: str, plane: str, value: float,
) -> bytes:
    """Binary slice envelope of one comparison *panel* at *plane*/*value*."""
    res = reconstruction(view, q_band, r_band)
    if panel == "dpdf":
        sd = extract_slice_dpdf(res["dpdf"], plane=plane, value=value)
    elif panel == "residual":
        # Derived per-slice instead of caching a full residual volume: slicing
        # is nearest-plane, so data_slice − recon_slice is elementwise identical
        # to slicing a materialised (data − recon) volume — including the NaN
        # pattern, since recon's masked-out voxels slice to NaN and propagate.
        sd_data = extract_slice(res["data"], plane=plane, value=value)
        sd_recon = extract_slice(res["recon"], plane=plane, value=value)
        sd = sd_data._replace(data=sd_data.data - sd_recon.data)
    else:
        sd = extract_slice(res[panel], plane=plane, value=value)
    return pack_slice(sd)
