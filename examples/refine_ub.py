"""Refine a volume's UB from where its Bragg peaks sit, and regrid onto it.

Finds each Bragg node's peak, fits the UB that puts the peaks back on their
nodes (``nebula3d.analysis.ub_refine``), and reports how far they sat before
and after: by pass, and as the median radial offset relative to |Q| per |Q|
band, in-plane and out of plane.  A cell error gives the same relative offset
at every |Q|; one that changes with |Q| is something no UB can take out.

A symmetrised volume (one equal to its images under the operations) shows
only the UB changes that commute with the operations, and takes the
``symmetric`` fit alone; the orientation needs the unsymmetrised volume.  To
refine that one under the symmetry its symmetrised export declares, point
OPS_FROM at the export.

With OUT the volume is regridded onto the refined UB (trilinear), optionally
symmetrised under the operations (SYMMETRISE=1: a voxel measured at any
equivalent position gets the mean of those that are), and written in the
NeXus Viewer's layout (``/entry/{data, sigma, mask, h_axis, k_axis, l_axis,
ub_matrix}``, the operations in ``symmetry_ops`` when symmetrised), which the
pipeline reads with ``symmetry: auto``.

Run::

    PYTHONPATH=src VOLUME=data/raw/<file>.nxs CELL=2,2,2 \\
      .venv/bin/python examples/refine_ub.py

Env:
    VOLUME      the volume (.nxs/.h5; default: the first data/raw/*.nxs)
    FIT         orientation | lattice | both | symmetric (default: symmetric
                when VOLUME is symmetrised under the operations, else both)
    OPS         auto (the operations VOLUME declares; default) | none |
                triplets, e.g. "h,k,l; h+k,-h,l; k,h,l; h,k,-l"
    OPS_FROM    take the operations another file declares instead
    CELL        the Bragg nodes' spacing, "2,2,2" for a doubled cell (default 1,1,1)
    Q_MIN       the nodes' |Q| range in Å⁻¹ (default: from 0 ...
    Q_MAX       ... to the box's farthest corner)
    REACH       how far from its predicted place a peak is looked for (Å⁻¹, 0.25)
    MIN_SIG     how far above the local background a peak must stand, in robust
                noise sigmas (default 10)
    OUT         write the regridded volume here
    SYMMETRISE  1 to symmetrise OUT under the operations
"""

from __future__ import annotations

import glob
import os
from pathlib import Path

import h5py
import numpy as np

import nebula3d
from nebula3d.analysis.ub_refine import (
    OFFSET_BANDS,
    OFFSET_DIRECTIONS,
    SYMMETRISED,
    auto_fit,
    radial_offsets,
    refine_ub,
    regrid,
)
from nebula3d.symmetry import GridSymmetry, parse_symmetry_ops


def env_float(name: str) -> float | None:
    value = os.environ.get(name, "").strip()
    return float(value) if value else None


def operations(volume: str) -> tuple[tuple[np.ndarray, ...] | None, str | None]:
    """The operations to use and their text, from OPS / OPS_FROM."""
    spec = os.environ.get("OPS", "auto").strip()
    source = os.environ.get("OPS_FROM", "").strip() or volume
    if spec.lower() == "none":
        return None, None
    if spec.lower() != "auto":
        return parse_symmetry_ops(spec), spec
    with h5py.File(source, "r") as f:
        entry = f.get("entry")
        text = entry.attrs.get("symmetry_ops") if isinstance(entry, h5py.Group) else None
    if text is None:
        return None, None
    text = text.decode() if isinstance(text, bytes) else str(text)
    return (parse_symmetry_ops(text), text) if text.strip() else (None, None)


def print_offsets(fit, centres) -> None:
    """The peaks' median offset along Q relative to |Q|, by |Q| band and
    direction (``ub_refine.radial_offsets``), before → after the fit."""
    rows = radial_offsets(fit, centres)
    names = [name for name, _a, _b in OFFSET_DIRECTIONS]
    print("\nthe peaks' offset along Q from their nodes, relative to |Q| (median), "
          "before → after the fit")
    print(f"{'|Q| (Å⁻¹)':>12}  " + "  ".join(f"{n:>26}" for n in names))
    for lo, hi in OFFSET_BANDS:
        cells = []
        for name in names:
            o = next((o for o in rows if o.q_lo == lo and o.direction == name), None)
            cells.append(f"{o.before:+.1e} → {o.after:+.1e} ({o.n:4d})" if o else "")
        band = f"{lo:g}–{hi:g}" if np.isfinite(hi) else f"≥ {lo:g}"
        print(f"{band:>12}  " + "  ".join(c.rjust(26) for c in cells))


def write_entry(vol, path: str, *, source: str, ops_text: str | None, note: str) -> None:
    """*vol* in the NeXus Viewer's layout."""
    with h5py.File(path, "w") as f:
        entry = f.create_group("entry")
        for name, values in (("data", vol.data), ("sigma", vol.sigma), ("mask", vol.mask),
                             ("h_axis", vol.h_axis), ("k_axis", vol.k_axis),
                             ("l_axis", vol.l_axis), ("ub_matrix", vol.ub_matrix)):
            entry.create_dataset(name, data=values)
        entry.attrs["source_file"] = Path(source).name
        entry.attrs["ub_refinement"] = note
        if ops_text:
            entry.attrs["symmetry_ops"] = ops_text


def main() -> None:
    volume = os.environ.get("VOLUME") or sorted(glob.glob("data/raw/*.nxs"))[0]
    vol = nebula3d.load(volume, dtype=np.float32)
    ops, ops_text = operations(volume)
    cell = tuple(int(x) for x in os.environ.get("CELL", "1,1,1").split(","))
    print(f"volume: {Path(volume).name} {vol.shape}")
    chosen, broken = auto_fit(vol, ops)
    if ops is not None and broken is not None:
        state = "symmetrised" if broken < SYMMETRISED else "not symmetrised"
        order = GridSymmetry.for_volume(vol, ops).order
        print(f"operations: a group of {order}; the volume differs from its images by "
              f"{broken:.1e} ({state})")
    fit = os.environ.get("FIT") or chosen
    r = refine_ub(vol, fit=fit, ops=ops, cell=cell,  # type: ignore[arg-type]
                  q_min=env_float("Q_MIN") or 0.0, q_max=env_float("Q_MAX"),
                  reach=env_float("REACH") or 0.25, min_significance=env_float("MIN_SIG") or 10.0)
    f = r.fit
    print(f"fit: {fit}; Bragg nodes every {cell}")
    print(f"{'pass':>4}  {'|Q| ≤':>6}  {'found':>6}  {'used':>6}  RMS from the nodes (Å⁻¹)")
    for i, p in enumerate(r.passes, 1):
        print(f"{i:>4}  {p.q_max:6.2f}  {p.n_found:6d}  {p.n_used:6d}  "
              f"{p.rms_start:.4f} → {p.rms:.4f}")
    print("cell (Å, °): " + " ".join(f"{x:.4f}" for x in f.cell_start) + "  →  "
          + " ".join(f"{x:.4f}" for x in f.cell))
    axis = " ".join(f"{x:.3f}" for x in f.axis_uvw)
    print(f"orientation change: {f.angle_deg:.3f}° about [{axis}]")
    print("UB_start⁻¹·UB:\n" + np.array2string(f.transform, precision=6, suppress_small=True))
    print("refined UB:\n" + np.array2string(f.ub, precision=6, suppress_small=True))
    print_offsets(f, r.centres)

    out = os.environ.get("OUT", "").strip()
    if not out:
        return
    new = regrid(vol, f.ub)
    symmetrise = os.environ.get("SYMMETRISE", "") == "1" and ops is not None
    if symmetrise:
        sym = GridSymmetry.for_volume(new, ops)  # type: ignore[arg-type]
        valid = new.mask & np.isfinite(new.data)
        where = sym.orbit_any(valid)
        new.data[~valid] = np.nan
        sym.orbit_mean(new.data, where)
        var = np.where(valid, new.sigma.astype(np.float64) ** 2, np.nan).astype(new.sigma.dtype)
        sym.orbit_mean(var, where)  # the orbit's RMS σ: the mean's own is smaller
        new.sigma = np.sqrt(var)
        new.mask = where & np.isfinite(new.data)
    note = (f"refine_ub fit={fit} cell={cell} from {Path(volume).name}: "
            f"RMS {f.rms_start:.4f} -> {f.rms:.4f} 1/A over {f.n_used} peaks")
    write_entry(new, out, source=volume, ops_text=ops_text if symmetrise else None, note=note)
    print(f"\nwrote {out}" + (" (symmetrised)" if symmetrise else ""))


if __name__ == "__main__":
    main()
