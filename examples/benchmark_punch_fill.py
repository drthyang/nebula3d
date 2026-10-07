"""Ground-truth benchmark of the Bragg punch + backfill on the synthetic demo volume.

The demo volume (:func:`nebula3d.demo.demo_volume`) is built from known parts —
Bragg peaks at the FCC nodes, an incident-beam spot, and diffuse scattering
(short-range order, thermal diffuse peaked at every node, rods along L, a
smooth background) plus counting noise — so a punch + fill can be scored
against the truth (see :func:`nebula3d.analysis.bragg_qa.score_against_truth`):

* ``bragg_left`` / ``leak`` — Bragg intensity the punch left / voxels > 3σ;
* ``collateral`` — punched voxels with < 1σ of Bragg (diffuse removed);
* ``false`` — detections not on a Bragg peak;
* ``fill bias`` / ``rms`` — filled − true diffuse in the holes, relative;
* ``ΔPDF err`` — the 3D-ΔPDF error over the map and at the lattice vectors.

Scenarios: ``clean``, and ``edge`` — the outer fifth in K is measured with
little exposure (down to 1/300 of the rest, varying voxel to voxel), like the
high-|Q| edge of a real coverage.  A voxel there with one or two counts
becomes a spike of order 1 after normalisation, at I/σ ≈ 1–2: it clears the
|Q|-shell threshold and the absolute floor, but not the significance gate.

Run::

    PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl .venv/bin/python examples/benchmark_punch_fill.py

Env:
    N         grid points per axis (default 161: 0.05 r.l.u., 0.075 Å⁻¹ voxels)
    SCENARIOS comma list of clean, edge (default both)
    ARMS      comma list of no_gate, gate, profile_k0.5, profile_k1, profile_k2,
              profile_k3 (default no_gate, gate)
    BACKFILL  laplace | local (default laplace)
    PDF       1 (default) also scores the ΔPDF; 0 skips the FFTs
    OUT_JSON  write the results here as JSON
"""

from __future__ import annotations

import dataclasses
import json
import os
import time
from pathlib import Path

import numpy as np

from nebula3d.analysis.bragg_qa import score_against_truth
from nebula3d.core import HKLVolume
from nebula3d.demo import demo_volume
from nebula3d.pipeline import BackfillParams, PunchParams, backfill, punch_bragg

DIFFUSE = ("background", "sro", "tds", "rods")
# The demo has no fractional-H modulation: the default thirds protection off.
BASE = PunchParams(search_exclude_h_fractions=None)
ARMS = {
    "no_gate": dataclasses.replace(BASE, min_significance=None),
    "gate": dataclasses.replace(BASE, min_significance=5.0),
    **{f"profile_k{k:g}": dataclasses.replace(BASE, punch_footprint="profile",
                                              profile_n_sigma=k)
       for k in (0.5, 1, 2, 3)},
}
#: Counts per unit intensity and the residual noise floor of the demo
#: (DemoModel.counts_per_unit, .residual_noise), and the least exposure at the
#: edge, as a fraction of the rest.
COUNTS = 600.0
RESIDUAL = 0.006
EDGE_MIN_EXPOSURE = 10 ** -2.5


def scenario(name: str, n: int, seed: int = 0) -> tuple[HKLVolume, dict]:
    """Input volume and its noise-free parts for one scenario."""
    vol = demo_volume(n, seed=seed, components=(*DIFFUSE, "bragg", "beam"))
    parts = {
        "diffuse": demo_volume(n, components=DIFFUSE, noise=False).data,
        "bragg": demo_volume(n, components=("bragg",), noise=False).data,
        "beam": demo_volume(n, components=("beam",), noise=False).data,
    }
    if name == "edge":
        edge = (np.abs(vol.k_axis) > 0.8 * float(vol.k_axis.max()))[None, :, None]
        edge = np.broadcast_to(edge, vol.shape)
        rng = np.random.default_rng(seed + 1)
        lam = np.clip(parts["diffuse"] + parts["bragg"] + parts["beam"], 0.0, None)[edge]
        tau = COUNTS * EDGE_MIN_EXPOSURE ** rng.uniform(0.0, 1.0, lam.shape)
        counts = rng.poisson(lam * tau)
        data, sigma = vol.data.copy(), vol.sigma.copy()
        data[edge] = counts / tau
        # The error of the observed counts, as Mantid propagates it, plus the
        # demo's residual floor.
        sigma[edge] = np.sqrt(counts / tau**2 + RESIDUAL**2)
        vol = dataclasses.replace(vol, data=data, sigma=sigma)
    elif name != "clean":
        raise SystemExit(f"unknown scenario {name!r}")
    return vol, parts


def main() -> None:
    n = int(os.environ.get("N", "161"))
    scenarios = os.environ.get("SCENARIOS", "clean,edge").split(",")
    arms = os.environ.get("ARMS", "no_gate,gate").split(",")
    method = os.environ.get("BACKFILL", "laplace")
    pdf = os.environ.get("PDF", "1") != "0"
    results: dict = {}
    for sc in scenarios:
        vol, parts = scenario(sc, n)
        print(f"\n== {sc}  ({n}³ voxels, backfill={method})")
        print(f"   {'arm':13s} {'det':>6s} {'false':>6s} {'punched':>8s} {'bragg_left':>10s} "
              f"{'leak':>5s} {'collat':>7s} {'fill bias':>9s} {'rms':>6s}"
              + (f" {'ΔPDF err':>9s} {'@lattice':>9s}" if pdf else ""))
        for arm in arms:
            t0 = time.time()
            out = punch_bragg(vol, ARMS[arm])
            punched = out._punched  # type: ignore[attr-defined]
            peaks = _records(out)
            filled = backfill(out, BackfillParams(method=method))
            s = score_against_truth(vol, punched, filled, bragg=parts["bragg"],
                                    diffuse=parts["diffuse"], beam=parts["beam"],
                                    peaks=peaks, delta_pdf=pdf)
            s["seconds"] = time.time() - t0
            results.setdefault(sc, {})[arm] = s
            print(f"   {arm:13s} {s['detections']:6d} {s['false_detections']:6d} "
                  f"{s['punched_voxels']:8,d} {s['bragg_left']:10.2e} {s['leak_voxels']:5d} "
                  f"{s['collateral']:7.1%} {s['fill_bias']:+9.2%} {s['fill_rms']:6.1%}"
                  + (f" {s['pdf_rel_rms']:9.2%} {s['pdf_lattice_rel_rms']:9.2%}" if pdf else ""))
    out_json = os.environ.get("OUT_JSON")
    if out_json:
        Path(out_json).write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(f"\nwrote {out_json}")


def _records(out: HKLVolume) -> list:
    """Peak centres from the punch profile, as objects with ih/ik/il."""
    rows = out._bragg_profile["peaks"]  # type: ignore[attr-defined]
    axes = (out.h_axis, out.k_axis, out.l_axis)

    @dataclasses.dataclass
    class _P:
        ih: int
        ik: int
        il: int

    return [_P(*(int(np.argmin(np.abs(a - c))) for a, c in zip(axes, r["center_hkl"])))
            for r in rows]


if __name__ == "__main__":
    main()
