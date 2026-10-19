# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Regridding a dataset onto its refined UB, as a new file beside it.

A UB turned by a fraction of a degree puts each Bragg peak beside its node,
by the angle times |Q| (0.05 Å⁻¹ at 10 Å⁻¹ for 0.3°): the punch then looks
for the peaks off their nodes, and symmetrising spreads each one into a ring
around its node.  :func:`regrid_dataset` refines the UB of a dataset's raw
volume the way the UB check does (:func:`~nebula3d.analysis.ub_refine.
check_ub`), resamples the volume onto the refined UB's HKL grid
(:func:`~nebula3d.analysis.ub_refine.regrid`), which puts the peaks back on
their nodes, and writes the result as a new file beside the raw one, in the
NeXus Viewer's layout the pipeline reads (``/entry/{data, sigma, mask,
h_axis, k_axis, l_axis, ub_matrix}``).  The file records what was done.

Regridding only resamples: each voxel takes what was measured at its Q.
Symmetrising changes the data, so it is optional and off by default; a
dataset that is symmetrised already stays symmetrised.

The raw volume is only read, and no file is ever overwritten: the new one
must lie inside the data root, must not be the raw one, and must not exist;
it is created exclusively, so a file that appears while the regrid runs is
not overwritten either.  When the fit cannot turn the UB, nothing is written
and :class:`RegridRefusal` says why, as data.
"""

from __future__ import annotations

import errno
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

import nebula3d
from nebula3d.analysis.ub_refine import (
    UB_TURN,
    Ops,
    UBCheck,
    _group,
    auto_fit,
    check_ub,
    outside_grid,
    regrid,
)
from nebula3d.core import HKLVolume
from nebula3d.symmetry import GridSymmetry, _triplet

#: The new file is ``<stem>_regridded.nxs`` beside the raw ``<stem>.nxs``, and
#: ``<stem>_regridded_sym.nxs`` when it is symmetrised (see :func:`regrid_target`).
SUFFIX = "_regridded"

#: :class:`RegridRefusal` codes.
TARGET_EXISTS = "target_exists"
SYMMETRISED_WITHOUT_SOURCE = "symmetrised_without_source"
TURN_BELOW_NOISE = "turn_below_noise"
CANNOT_SYMMETRISE = "cannot_symmetrise"

_VOLUME_SUFFIXES = (".nxs", ".h5", ".hdf5")


@dataclass(frozen=True)
class RegridRefusal:
    """Why :func:`regrid_dataset` wrote nothing: ``code`` (one of the codes
    above) to act on, ``reason`` to show."""

    code: str
    reason: str


@dataclass(frozen=True)
class Regridded:
    """:func:`regrid_dataset`'s result: the new file, or why there is none.

    The fields a refusal comes before are ``None``: one for an existing
    target comes before anything is fitted."""

    source: Path  # the dataset's raw volume
    target: Path  # the new file: written, or the one that would have been
    refusal: RegridRefusal | None
    fit: str | None = None  # the fit that applies (a refusal before fitting) or was made
    refined_on: Path | None = None  # whose peaks were fitted and whose data regridded
    check: UBCheck | None = None  # the refinement, as the UB check makes it
    source_symmetrised: bool | None = None  # the source; None where not judged
    symmetrised: bool = False  # the new file is symmetrised and declares its operations
    symmetry_ops: str | None = None  # ... those operations
    measured_before: int | None = None  # measured voxels regridded (after the edge trim)
    measured_after: int | None = None  # measured voxels in the new file
    voxels_outside: int | None = None  # measured before, unmeasured now: their Q left the old box

    @property
    def written(self) -> bool:
        return self.refusal is None

    @property
    def voxels_outside_share(self) -> float | None:
        """:attr:`voxels_outside` over :attr:`measured_before`."""
        if self.voxels_outside is None or not self.measured_before:
            return None
        return self.voxels_outside / self.measured_before


def regrid_target(source: str | Path, *, symmetrised: bool = False) -> Path:
    """Where :func:`regrid_dataset` writes *source*: beside it, as
    ``<stem>_regridded.nxs``, or ``<stem>_regridded_sym.nxs`` when the new
    file is symmetrised.  A ``.nxs`` in a data root's ``raw/`` is a dataset of
    its own, and its pipeline outputs are named after its own stem."""
    source = Path(source)
    return source.with_name(f"{source.stem}{SUFFIX}{'_sym' if symmetrised else ''}.nxs")


def unsymmetrised_source(path: str | Path) -> tuple[str | None, Path | None]:
    """The unsymmetrised volume a symmetrised one was made from: the name its
    ``source_file`` attribute gives (the NeXus Viewer's export names it), and
    that file when it is beside *path*; ``(None, None)`` when it names none.
    Only the name is taken from the attribute, never a folder."""
    path = Path(path)
    name = _declared(path, "source_file")
    if name is None:
        return None, None
    other = path.parent / Path(name).name
    if not other.is_file() or _same_file(other, path):
        return name, None
    return name, other


def regrid_dataset(
    source: str | Path,
    *,
    data_root: str | Path,
    ops: Ops | None = None,
    ops_from: str | None = None,
    cell: tuple[int, int, int] = (1, 1, 1),
    q_max: float | None = None,
    symmetrise: bool = False,
    edge_trim: int = 1,
    dtype: np.dtype | type | None = None,
    out: str | Path | None = None,
    taken: Callable[[Path], str | None] | None = None,
) -> Regridded:
    """Refine *source*'s UB as the UB check does, regrid it onto the refined
    UB, and write the result as a new file beside it.

    *source* is a dataset's raw volume.  *ops* are the symmetry operations
    declared for it, *ops_from* the file that declares them: the UB check
    takes the file's own, else those of a symmetrised export naming it as its
    source (:func:`nebula3d.server.volumes.symmetry_ops_for`).  They constrain
    the cell, tell whether *source* is symmetrised, and are what
    *symmetrise* symmetrises with.  *cell*, *q_max* and *edge_trim* are
    :func:`~nebula3d.analysis.ub_refine.check_ub`'s; the edge is trimmed
    before the regrid too, as the regrid's docstring asks.  *dtype* is the
    precision the volume is loaded and written in (``None``: the file's own).

    The new file is :func:`regrid_target`'s (*out* names another), and it
    records the UB before and after, the fit and the turn, the file whose
    data were regridded (``source_file``), and the operations when it is
    symmetrised (``symmetry_ops``, which the pipeline reads with ``symmetry:
    auto``; written only then, as the pipeline takes data that declare them
    for symmetrised).  It is a new dataset, with its own pipeline outputs.

    Nothing is overwritten.  ``ValueError`` before anything is read when the
    target would lie outside *data_root* (``..`` resolved), be *source*
    itself, sit in no folder, or not be a volume file.  A target that exists
    is refused, and the file is created exclusively, so one that appears
    meanwhile is refused too and left alone.  *taken* can refuse a target
    for the caller's own reasons (the server: a dataset id in use), giving
    the reason.  *source* is only read.

    Refusals come back as data, nothing written (:class:`RegridRefusal`):

    - ``target_exists``: the new file's name is in use;
    - ``symmetrised_without_source``: *source* is symmetrised under *ops*, so
      a turned UB shows there as rings around the nodes, not as shifts: only
      the symmetric fit applies, and it cannot turn the UB.  When the
      unsymmetrised volume *source* was made from is beside it (its
      ``source_file``), that one is refined and regridded instead, and
      symmetrised under *ops*: a symmetrised dataset keeps its operations.
      Refused when there is no such volume, or it is symmetrised too;
    - ``turn_below_noise``: the fit turns the UB by less than
      :data:`~nebula3d.analysis.ub_refine.UB_TURN` (0.05°), the UB check's
      rule: within the fit's own noise, a regrid would only resample;
    - ``cannot_symmetrise``: *symmetrise* without operations, or with
      operations that do not map the grid onto itself.

    ``ValueError`` (from the fit) when too few peaks are found.
    """
    source = Path(source)
    root = Path(data_root)
    if not source.is_file():
        raise FileNotFoundError(f"no volume at {source}")
    candidates = ([Path(out)] if out is not None
                  else [regrid_target(source), regrid_target(source, symmetrised=True)])
    for candidate in candidates:
        _check_target(candidate, source, root)

    vol = nebula3d.load(source, dtype=dtype)
    fit, broken = auto_fit(vol, ops)
    source_symmetrised = None if broken is None else fit == "symmetric"
    target = (Path(out) if out is not None
              else regrid_target(source, symmetrised=symmetrise or fit == "symmetric"))

    def refuse(code: str, reason: str, fit: str | None, refined_on: Path | None = None,
               check: UBCheck | None = None) -> Regridded:
        return Regridded(source=source, target=target, refusal=RegridRefusal(code, reason),
                         fit=fit, refined_on=refined_on, check=check,
                         source_symmetrised=source_symmetrised)

    if os.path.lexists(target):
        return refuse(TARGET_EXISTS, _exists_reason(target, source), fit=fit)
    why = taken(target) if taken is not None else None
    if why:
        return refuse(TARGET_EXISTS, why, fit=fit)

    refined_on = source
    sym_ops: Ops | None = None  # what the new file is symmetrised under
    if fit == "symmetric":
        assert ops is not None and broken is not None
        named, unsym = unsymmetrised_source(source)
        if unsym is None:
            return refuse(SYMMETRISED_WITHOUT_SOURCE,
                          _symmetrised_reason(source, ops, broken, named, "missing"), fit=fit)
        del vol
        vol = nebula3d.load(unsym, dtype=dtype)
        if auto_fit(vol, ops)[0] == "symmetric":
            return refuse(SYMMETRISED_WITHOUT_SOURCE,
                          _symmetrised_reason(source, ops, broken, named, "symmetrised"),
                          fit=fit)
        refined_on, sym_ops = unsym, ops
    elif symmetrise:
        if ops is None:
            return refuse(CANNOT_SYMMETRISE,
                          f"Symmetrising needs the operations the data are to be symmetrised "
                          f"with, and none are declared for {source.name}, by itself or by a "
                          "symmetrised export naming it as its source. Nothing was written.",
                          fit=fit)
        sym_ops = ops
    sym = None
    if sym_ops is not None:
        try:
            sym = GridSymmetry.for_volume(vol, sym_ops)
        except ValueError as exc:
            return refuse(CANNOT_SYMMETRISE,
                          f"The operations {ops_from or 'given'} declares do not map "
                          f"{refined_on.name}'s grid onto itself ({exc}), so it cannot be "
                          "symmetrised under them. Nothing was written.",
                          fit=fit, refined_on=refined_on)

    check = check_ub(vol, ops, cell=cell, q_max=q_max, edge_trim=edge_trim)
    f = check.refinement.fit
    if f.angle_deg < UB_TURN:
        return refuse(TURN_BELOW_NOISE,
                      f"The {check.fit} fit turns the UB by {f.angle_deg:.3f}°, under the "
                      f"UB check's {UB_TURN:g}° rule (UB_TURN): a turn that small is within "
                      "the fit's own noise, and regridding onto it would only resample the "
                      "data. Nothing was written.",
                      fit=check.fit, refined_on=refined_on, check=check)

    measured_before = int(np.count_nonzero(vol.mask))
    new = regrid(vol, f.ub)
    lost = outside_grid(vol, f.ub)
    lost &= vol.mask
    instrument = vol.instrument
    del vol
    if sym is not None:
        _symmetrise(new, sym)
    voxels_outside = int(np.count_nonzero(lost & ~new.mask))
    del lost
    ops_text = None if sym_ops is None else "; ".join(_triplet(m) for m in sym_ops)
    label = (_declared(source.parent / Path(ops_from).name, "symmetry")
             if ops_text and ops_from else None)
    attrs = _provenance(source, refined_on, check, cell=cell, q_max=q_max,
                        edge_trim=edge_trim, ops=ops, ops_from=ops_from, ops_text=ops_text,
                        label=label, instrument=instrument)
    if not _write_new(target, new, attrs):
        return refuse(TARGET_EXISTS,
                      f"{target.name} appeared beside {source.name} while the regrid ran: "
                      "regridding never overwrites a file, and nothing was written.",
                      fit=check.fit, refined_on=refined_on, check=check)
    return Regridded(source=source, target=target, refusal=None, fit=check.fit,
                     refined_on=refined_on, check=check,
                     source_symmetrised=source_symmetrised, symmetrised=sym is not None,
                     symmetry_ops=ops_text, measured_before=measured_before,
                     measured_after=int(np.count_nonzero(new.mask)),
                     voxels_outside=voxels_outside)


def _check_target(target: Path, source: Path, data_root: Path) -> None:
    """``ValueError`` unless *target* lies inside *data_root* (``..`` resolved
    lexically, so a link the user made inside the root stays theirs to make),
    is not *source*, has a folder to go in, and is a volume file."""
    root = Path(os.path.abspath(data_root))
    where = Path(os.path.abspath(target))
    if root not in where.parents:
        raise ValueError(f"{target} is outside the data root {root}: "
                         "regridding never writes there")
    if where == Path(os.path.abspath(source)) or _same_file(where, source):
        raise ValueError(f"{target} is the volume being regridded: regridding never "
                         "writes to it")
    if not where.parent.is_dir():
        raise ValueError(f"{target}: there is no folder {where.parent} to write it in")
    if where.suffix.lower() not in _VOLUME_SUFFIXES:
        raise ValueError(f"{target.name}: the new file must be one of "
                         f"{', '.join(_VOLUME_SUFFIXES)}")


def _same_file(a: Path, b: Path) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:  # either is missing
        return False


def _declared(path: Path, key: str) -> str | None:
    """A text attribute *path* declares (``source_file``, ``symmetry``: see
    :func:`nebula3d.io.hkl_reader.declared_attrs`), or ``None``."""
    import h5py

    from nebula3d.io.hkl_reader import declared_attrs

    try:
        with h5py.File(path, "r") as f:
            attrs = declared_attrs(f)
            value = attrs.get(key) if attrs is not None else None
    except OSError:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    text = None if value is None else str(value).strip()
    return text or None


def _exists_reason(target: Path, source: Path) -> str:
    return (f"{target.name} already exists beside {source.name}: regridding never "
            "overwrites a file, and nothing was written. Use that dataset, or move the file "
            "away to regrid again.")


def _symmetrised_reason(source: Path, ops: Ops, broken: float, named: str | None,
                        why: str) -> str:
    head = (f"{source.name} is symmetrised under the {len(_group(ops))} operations declared "
            f"for it (it differs from its images by {broken:.1e}): a turned UB shows there as "
            "rings around the nodes, not as shifts, so only the symmetric fit applies, and it "
            "cannot turn the UB. Regridding needs the unsymmetrised volume it was made from")
    if named is None:
        tail = f", and {source.name} names none as its source."
    elif why == "missing":
        tail = f": {source.name} names {named}, which is not beside it."
    else:
        tail = f": {source.name} names {named}, which is symmetrised too."
    return head + tail + " Nothing was written."


def _symmetrise(vol: HKLVolume, sym: GridSymmetry) -> None:
    """Symmetrise *vol* in place, as examples/refine_ub.py does: a voxel
    measured at any equivalent position gets the mean of those that are, and
    σ the orbit's RMS σ (the mean's own would be smaller)."""
    valid = vol.mask & np.isfinite(vol.data)
    where = sym.orbit_any(valid)
    vol.data[~valid] = np.nan  # left out of the orbit means
    sym.orbit_mean(vol.data, where)
    var = None
    if not vol.sigma_estimated:
        var = np.where(valid, np.square(vol.sigma), np.nan).astype(vol.sigma.dtype)
        sym.orbit_mean(var, where)
    del valid
    vol.mask = where & np.isfinite(vol.data)
    vol.data[~vol.mask] = 0.0  # unmeasured as the loader leaves it
    sigma = np.sqrt(np.abs(vol.data)) if var is None else np.sqrt(var)
    vol.sigma = np.where(vol.mask, sigma, 0.0).astype(vol.sigma.dtype)


def _provenance(source: Path, refined_on: Path, check: UBCheck, *,
                cell: tuple[int, int, int], q_max: float | None, edge_trim: int,
                ops: Ops | None, ops_from: str | None, ops_text: str | None,
                label: str | None, instrument: str) -> dict[str, object]:
    """The new file's ``/entry`` attributes: what was done, and from what."""
    from nebula3d import __version__

    f = check.refinement.fit
    attrs: dict[str, object] = {
        # The NeXus Viewer's name for the file the data came from.
        "source_file": refined_on.name,
        "regrid_dataset_file": source.name,
        "regrid_fit": f.fit,
        "regrid_turn_deg": float(f.angle_deg),
        "regrid_turn_axis_uvw": np.asarray(f.axis_uvw, dtype=np.float64),
        "regrid_ub_start": np.asarray(f.ub_start, dtype=np.float64),
        "regrid_ub": np.asarray(f.ub, dtype=np.float64),
        "regrid_cell_start": np.asarray(f.cell_start, dtype=np.float64),
        "regrid_cell": np.asarray(f.cell, dtype=np.float64),
        "regrid_rms_start": float(f.rms_start),
        "regrid_rms": float(f.rms),
        "regrid_n_peaks": int(f.n_used),
        "regrid_cell_nodes": np.asarray(cell, dtype=np.int64),
        "regrid_edge_trim": int(edge_trim),
        "regrid_symmetrised": int(ops_text is not None),
        "ub_refinement": (
            f"regrid_dataset fit={f.fit} cell={tuple(cell)} from {refined_on.name}: RMS "
            f"{f.rms_start:.4f} -> {f.rms:.4f} 1/A over {f.n_used} peaks, turned "
            f"{f.angle_deg:.4f} deg; regridded" + (" and symmetrised" if ops_text else "")),
        "nebula3d_version": __version__,
    }
    if q_max is not None:
        attrs["regrid_q_max"] = float(q_max)
    if ops is not None:  # what constrained the cell, under a name the pipeline does not read
        attrs["regrid_operations"] = "; ".join(_triplet(m) for m in ops)
        if ops_from:
            attrs["regrid_operations_from"] = ops_from
    if ops_text:  # the data are symmetrised: declare it, as the NeXus Viewer's export does
        attrs["symmetry_ops"] = ops_text
        if label:
            attrs["symmetry"] = label
    if instrument:
        attrs["instrument"] = instrument
    return attrs


def _write_new(target: Path, vol: HKLVolume, attrs: dict[str, object]) -> bool:
    """Write *vol* to *target* in the NeXus Viewer's layout, creating the file
    exclusively (``O_CREAT | O_EXCL``: never an existing file, nor one behind a
    link): ``False``, writing nothing, when *target* exists by then.  σ is
    left out when it was estimated, so the loader estimates it again (√|I|)
    and says so.  The partial file is removed when writing fails."""
    import h5py

    try:
        f = h5py.File(target, "x")
    except FileExistsError:
        return False
    except OSError as exc:
        if exc.errno == errno.EEXIST:
            return False
        raise
    try:
        with f:
            entry = f.create_group("entry")
            entry.create_dataset("data", data=vol.data)
            if not vol.sigma_estimated:
                entry.create_dataset("sigma", data=vol.sigma)
            for name, values in (("mask", vol.mask), ("h_axis", vol.h_axis),
                                 ("k_axis", vol.k_axis), ("l_axis", vol.l_axis),
                                 ("ub_matrix", vol.ub_matrix)):
                entry.create_dataset(name, data=values)
            for key, value in attrs.items():
                entry.attrs[key] = value
    except BaseException:
        target.unlink(missing_ok=True)  # ours: created exclusively above
        raise
    return True
