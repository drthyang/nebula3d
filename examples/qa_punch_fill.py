"""Real-data QA of a Bragg punch + backfill — what the punch left and the fill did.

Reads a punched volume (``*_braggpunched.h5``: the original data is still under
every hole, and the punch stage records which voxels it punched), its backfill
if present, and its Bragg profile JSON, and reports, with nothing changed:

* **detections** — integer-node and search peaks, and their significance ``z``
  (the punch's own measure: integrated excess over half the resolution
  ellipsoid, in standard errors).  Peaks under 5σ are noise; where they sit in
  |Q| shows whether they cluster at the coverage edge;
* **holes** — how many, how big, how much of the punch is in merged holes
  (each filled as one region by the ``local`` fill);
* **leakage** — per hole, the excess in shells outside it by distance in Å⁻¹,
  by hole brightness; the first shell's 90th percentile catches a tail
  leaking on one side, which the shell median hides;
* **fill** — the fill against the first shell and against the local level;
* **refill test** (``REFILL``) — the punch's own holes moved half a node step
  along K, into measured diffuse, filled with each listed method and compared
  with the data there (``bragg_qa.refill_test``): per-hole bias, and the ΔPDF
  of the fill error at the lattice vectors as a share of the real ΔPDF there.

Run::

    PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl DATASET=22K \\
      .venv/bin/python examples/qa_punch_fill.py

Env:
    DATASET     substring picking data/processed/*<DATASET>*_braggpunched.h5
    PUNCHED     explicit punched .h5 (overrides DATASET)
    BACKFILLED  backfilled .h5 (default: <punched stem>_backfilled.h5, if present)
    PROFILE     Bragg profile JSON (default: <punched stem>_profile.json)
    MIN_Z       significance threshold reported (default 5)
    REFILL      comma list of fill methods for the refill test, e.g.
                laplace,local (default: none)
    OUT_JSON    write the metrics here as JSON
"""

from __future__ import annotations

import dataclasses
import json
import os
from pathlib import Path

import numpy as np

import nebula3d
from nebula3d.analysis.bragg_qa import (
    PDF_BANDS_A,
    detection_significance,
    hole_census,
    hole_rings,
    lattice_points,
    refill_test,
    summarise_rings,
)
from nebula3d.io import load_delta_pdf
from nebula3d.pipeline import _read_punched  # noqa: PLC2701 - the stage's own record

PROC = Path("data/processed")


def _punched_path() -> Path:
    if os.environ.get("PUNCHED"):
        return Path(os.environ["PUNCHED"])
    tag = os.environ.get("DATASET", "")
    cands = sorted(PROC.glob(f"*{tag}*_braggpunched.h5"))
    if not cands:
        raise SystemExit(f"no *{tag}*_braggpunched.h5 in {PROC}")
    return cands[0]


def main() -> None:
    path = _punched_path()
    stem = path.with_suffix("")
    min_z = float(os.environ.get("MIN_Z", "5"))
    print(f"punched:    {path.name}")
    vol = nebula3d.load(path)
    punched = _read_punched(path)
    if punched is None:
        raise SystemExit("this file has no punch record (/entry/punched)")
    report: dict = {"punched_file": str(path)}

    # --- detections ------------------------------------------------------
    prof_path = Path(os.environ.get("PROFILE", f"{stem}_profile.json"))
    if prof_path.exists():
        peaks = json.loads(prof_path.read_text())["peaks"]
        # Score on the volume the peaks were found on: the holes put back.
        detected_on = dataclasses.replace(vol, mask=vol.mask | punched)
        z = detection_significance(detected_on, [p["center_hkl"] for p in peaks])
        q = np.array([p["q_abs"] for p in peaks])
        is_int = np.array([p["source_node_hkl"] is not None for p in peaks])
        det: dict = {}
        print(f"\ndetections ({prof_path.name}): z = integrated excess / its error")
        for name, sel in (("integer", is_int), ("search", ~is_int)):
            if not sel.any():
                continue
            zs, low = z[sel], z[sel] < min_z
            row = {"n": int(sel.sum()), "below_min_z": int(low.sum()),
                   "z_percentiles": {str(p): float(v) for p, v in
                                     zip((10, 50, 90), np.nanpercentile(zs, [10, 50, 90]))}}
            if low.any():
                row["below_min_z_q_percentiles"] = {
                    str(p): float(v) for p, v in
                    zip((10, 50, 90), np.percentile(q[sel][low], [10, 50, 90]))}
            det[name] = row
            where = (f"; their |Q| p10/50/90 = "
                     f"{np.round(list(row['below_min_z_q_percentiles'].values()), 2)} Å⁻¹"
                     if low.any() else "")
            print(f"  {name:7s} n={row['n']:6d}  z p10/50/90 = "
                  f"{np.round(list(row['z_percentiles'].values()), 1)}  "
                  f"below {min_z:g}σ: {row['below_min_z']} ({low.mean():.1%}){where}")
        print(f"  (all |Q|: p10/50/90 = {np.round(np.percentile(q, [10, 50, 90]), 2)} Å⁻¹)")
        report["detections"] = det
    else:
        print(f"(no profile JSON at {prof_path}; detections skipped)")

    # --- holes -----------------------------------------------------------
    census = hole_census(vol, punched)
    report["holes"] = census
    print(f"\nholes: {census['n_holes']:,} holding {census['punched_voxels']:,} voxels "
          f"({census['punched_fraction']:.2%} of the volume)")
    if census["n_holes"]:
        print(f"  size p50/90/99/max: {[int(v) for v in census['size_percentiles'].values()]}")
        print("  share of punched voxels in holes over "
              + ", ".join(f"{k} vox: {v:.1%}" for k, v in census["share_in_holes_over"].items()))
        for b in census["largest"]:
            print(f"  largest: {b['voxels']:8,} vox at {np.round(b['centre'], 2)}")

    # --- leakage + fill --------------------------------------------------
    bf = Path(os.environ.get("BACKFILLED", f"{stem}_backfilled.h5"))
    filled = nebula3d.load(bf).data if bf.exists() else None
    print(f"\nshells outside each hole{' and fill (' + bf.name + ')' if filled is not None else ''}"
          f" — σ = scatter of the outermost shell")
    summary = summarise_rings(hole_rings(vol, punched, filled))
    report["rings"] = summary
    print(f"  shell centres (Å⁻¹): {np.round(summary['ring_centres_q'], 2)}")
    for b in summary["bins"]:
        lo, hi = b["peak_over_noise"]
        fill = (f" | fill−shell1 {b['fill_minus_ring1']:+.2f}σ, fill−level "
                f"{b['fill_minus_reference']:+.2f}σ" if "fill_minus_ring1" in b else "")
        print(f"  peak [{lo:g},{hi:g})σ n={b['n_holes']:5d}: shell excess "
              f"{np.round(b['ring_excess_median'], 2)} | shell-1 p90 "
              f"{b['ring1_p90_excess_median']:.2f}σ, >3σ in "
              f"{b['frac_ring1_p90_over_3sigma']:.0%} | at background "
              f"{b['punched_at_background']:.0%}{fill}")
    if "outside_over_inside" in summary:
        print(f"  holes >100σ: excess in the first two shells / excess punched = "
              f"{summary['outside_over_inside']:.2%}")

    # --- refill test -----------------------------------------------------
    methods = [m for m in os.environ.get("REFILL", "").split(",") if m.strip()]
    if methods:
        ref = _lattice_reference(Path(f"{stem}_backfilled_delta_pdf.h5"), vol)
        print("\nrefill test: the holes moved half a node step along K, filled, "
              "compared with the data there")
        report["refill"] = {}
        for m in methods:
            r = refill_test(vol, punched, method=m.strip())
            report["refill"][m] = r
            pe = r["pdf_error"]
            share = (", ".join(f"{k} Å {pe[k]['lattice_rms'] / ref[k]:.1%}" for k in pe
                               if ref.get(k)) if ref else
                     ", ".join(f"{k} Å {pe[k]['lattice_rms']:.3g}" for k in pe))
            print(f"  {m:8s} {r['n_holes']} holes: per-hole mean error median "
                  f"{r['hole_bias_sigma_median']:+.3f}σ "
                  f"(|·| {r['hole_bias_sigma_abs_median']:.3f}σ)"
                  f" | ΔPDF error at the lattice vectors"
                  f"{' / real ΔPDF there' if ref else ''}: {share}")

    out = os.environ.get("OUT_JSON")
    if out:
        Path(out).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nwrote {out}")


def _lattice_reference(pdf_path: Path, vol: nebula3d.HKLVolume) -> dict:
    """RMS of the run's real ΔPDF at the lattice vectors, per |r| band (Å)."""
    if not pdf_path.exists():
        return {}
    d = load_delta_pdf(pdf_path)
    lens = np.linalg.norm(2 * np.pi * np.linalg.inv(vol.ub_matrix).T, axis=0)
    x, y, z = d.x_axis, d.y_axis, d.z_axis
    pts = lattice_points(d.data.shape, (x / lens[0], y / lens[1], z / lens[2]))
    r = np.sqrt(x[pts[0]] ** 2 + y[pts[1]] ** 2 + z[pts[2]] ** 2)
    v = d.data[pts]
    out = {}
    for lo, hi in PDF_BANDS_A:
        m = (r >= lo) & (r < hi)
        if m.any():
            out[f"{lo:g}-{hi:g}"] = float(np.sqrt(np.mean(v[m] ** 2)))
    return out


if __name__ == "__main__":
    main()
