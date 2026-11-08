# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The pre-run powder ring survey (THY-43): the ring stage's detection on the
raw volume, as a dry run, with nothing removed.

Before the workflow runs, NEBULA Pilot (and auto mode's preflight) asks what
powder rings the volume holds, which are the sample environment's aluminium,
which another phase's lines may explain, and which no line explains. The ring
stage knows all of it, but only as it removes the rings. The survey runs the
same detection without the removal:

1. **Profiles.** Each plane's all-azimuth median radial profile, the ring
   stage's pass 1 (:func:`~nebula3d.preprocessing.pooled_rings.fit_pooled_rings`)
   without its sector profiles and sampling mask, which only the subtraction
   reads.
2. **Shells.** The stage's own detection, 3D judgement and Al lattice fit
   (``pooled_rings._find_shells``): every shell above the detection cut, each
   confirmed as a powder ring only if it rises in nearly every direction
   (:mod:`~nebula3d.preprocessing.ring_isotropy`), the Al lines judged again
   in their own frame.
3. **Phases.** The stage's phase match of the rings the Al lines leave
   (:mod:`~nebula3d.preprocessing.powder_phases`), with the hints the input's
   file name gives.

Each shell is then labelled, by the same rules as the stage's diagnostics
(``match``): ``AL`` on a fitted Al line (its hkl), ``PH`` on a line of the
phase the match names first (``possibly`` that phase: a possibility with its
evidence, never an identification), ``XTAL`` the crystal's own scattering (it
fails the ring test on height or isotropy, standing clear of the noise in the
typical direction), and ``UNK``, unrecognized: a ring, or a shell the test
could not show to be the crystal's own, that no line explains. A shell under
the detection cut, found for the phase match only, is listed where a line
explains it or the 3D test confirms it a ring, and counted otherwise: noise
alone must flag nothing. ``removed`` says whether the ring stage would
subtract the shell (a confirmed ring, whatever its phase); the others stay in
the volume.

The survey reads the volume as the ring stage reads it, edge trim included
(the caller loads it so), but not after the symmetry average, which a run
may apply first. Its result is the stage's to the bit on the same volume and
settings: the same shells, verdicts, Al lattice and phase record.
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from nebula3d.core import HKLVolume, low_memory
from nebula3d.preprocessing.pooled_rings import (
    _PLANES,
    PooledRingConfig,
    _crystals_own,
    _find_shells,
    _left_code,
    _profile_excess,
    _shell_matcher,
    _shell_profile,
    _voxel_q_spacing,
)
from nebula3d.preprocessing.powder_phases import summary as phase_summary
from nebula3d.preprocessing.radial_background import _stack_plane_q_magnitude
from nebula3d.preprocessing.ring_isotropy import grid_too_coarse

ProgressFn = Callable[[float, str], None]

#: The survey record's format.
SURVEY_VERSION = 1
#: How many lines of a list :func:`survey_lines` names; the rest it counts.
SUMMARY_ITEMS = 4
#: The labels a shell takes (the module docstring): on an Al line; the
#: crystal's own; on the named phase's line; a ring no line explains; and,
#: unexplained and not confirmed, the grid too coarse to judge it, not judged
#: (no clean flank, too few cells), or not a ring by the test (too faint).
CODES = ("AL", "XTAL", "PH", "UNK", "GRID", "NJ", "NR")


#: The most threads the profiles are read on, natively.
_MAX_PROFILE_THREADS = 8


def _round(x: float, n: int = 4) -> float:
    return float(round(float(x), n))


def _profile_workers(n_planes: int) -> int:
    """Threads for the planes' profiles: one in low-memory mode (the browser,
    whose Pyodide has none), else up to :data:`_MAX_PROFILE_THREADS`."""
    if low_memory() or n_planes < 2:
        return 1
    return max(1, min(_MAX_PROFILE_THREADS, os.cpu_count() or 1, n_planes))


def survey_rings(vol: HKLVolume, config: PooledRingConfig | None = None, *,
                 sample: str | None = None, progress: ProgressFn | None = None
                 ) -> dict[str, object]:
    """The powder rings of ``vol`` as the ring stage would find them, with
    nothing removed (the module docstring). ``config`` is the stage's
    (:func:`nebula3d.pipeline.pooled_ring_config` builds it from the run's
    settings); ``sample``, the input's file name, gives the phase match the
    composition and temperature it names. ``vol`` is read, never written.

    Returns the JSON-ready record: the Al lattice, every shell with its
    |Q|, FWHM, signal-to-noise, label (:data:`CODES`), line and whether the
    stage would remove it; how many shells under the detection cut it left
    unlisted (``faint``); the phase match's record and its one line; why the
    grid cannot judge a ring, if it cannot; and the timing.
    """
    cfg = config or PooledRingConfig()
    t0 = time.perf_counter()
    axis = _PLANES[cfg.plane][0]
    n_planes = int(vol.data.shape[axis])
    q_step = max(cfg.q_step, 0.5 * _voxel_q_spacing(vol))
    edges = np.arange(cfg.q_min, cfg.q_max + q_step, q_step)
    q_grid = 0.5 * (edges[:-1] + edges[1:])
    shell_prof = np.full((n_planes, q_grid.size), np.nan)
    shell_cnt = np.zeros((n_planes, q_grid.size))

    def plane_profile(i: int) -> None:
        q2 = _stack_plane_q_magnitude(vol, cfg.plane, axis, i)
        data2 = np.take(vol.data, i, axis=axis).astype(np.float64)
        valid2 = np.take(vol.mask, i, axis=axis) & np.isfinite(data2)
        profile = _shell_profile(q2, data2, valid2, edges)
        if profile is not None:
            shell_prof[i], shell_cnt[i] = profile

    # Each plane's profile is its own (a row of its own): natively on
    # threads, numpy's sorts releasing the GIL; in the browser in turn.
    workers = _profile_workers(n_planes)
    if workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            list(pool.map(plane_profile, range(n_planes)))
    else:
        for i in range(n_planes):
            plane_profile(i)
            if progress is not None and (i + 1) % 50 == 0:
                progress(0.5 * (i + 1) / n_planes, f"ring survey: profiles {i + 1}/{n_planes}")
    t_profiles = time.perf_counter() - t0
    if progress is not None:
        progress(0.5, "ring survey: judging the shells in 3D")
    found, phases = _find_shells(vol, cfg, q_grid, shell_prof, shell_cnt, q_step, sample)
    _g, _measured, _exc, noise = _profile_excess(shell_prof, shell_cnt, q_step, cfg)
    t_detect = time.perf_counter() - t0
    match = _shell_matcher(found, phases, cfg, q_step)

    def snr(amplitude: float) -> float | None:
        return _round(amplitude / noise, 1) if noise > 0 and np.isfinite(amplitude) else None

    def labelled(q: float, w: float, ring: bool | None, why: str | None,
                 verdict: object) -> dict[str, object]:
        m = match(q, w).get("match")
        line = m if isinstance(m, dict) else None
        if line is not None and line.get("phase") == "Al":
            return {"code": "AL", "line": f"Al{line.get('hkl')}"}
        if ring is not True and _crystals_own(verdict):
            return {"code": "XTAL"}
        if line is not None:
            return {"code": "PH", "line": f"{line.get('phase')}{line.get('hkl')}",
                    "phase": line.get("phase"), "status": line.get("status")}
        if ring is True:
            return {"code": "UNK"}
        # Unexplained and not confirmed: the grid could not judge it, the test
        # could not (no clean flank, too few cells), or it failed the test,
        # rising in some directions only (the crystal's own, as the ring
        # check draws it) or too faint to call.
        return {"code": "GRID" if why == "grid" else
                "NJ" if why in ("flank", "cells", "nodata", "unjudged") else
                "XTAL" if why == "isotropy" else "NR"}

    # Each shell: its label, whether the 3D test confirms it a powder ring
    # (``ring``; None where it could not judge it), and whether the stage
    # would remove it, else why it stays (``why``, as shell_summary says it).
    rings: list[dict[str, object]] = []
    for c, f, a in zip(found.centers.tolist(), found.fwhm.tolist(), found.amps.tolist()):
        rings.append({"q": _round(c), "fwhm": _round(f), "snr": snr(a),
                      **labelled(c, f, True, None, None), "ring": True, "removed": True,
                      "source": "detected"})
    for s in found.rejected:
        c, f, a = float(s["q_center"]), float(s["fwhm"]), float(s["amplitude"])  # type: ignore[arg-type]
        verdict = s.get("isotropy")
        ring = (bool(verdict.get("is_ring"))
                if isinstance(verdict, dict) and not verdict.get("not_judged") else None)
        why = _left_code(verdict)
        rings.append({"q": _round(c), "fwhm": _round(f), "snr": snr(a),
                      **labelled(c, f, ring, why, verdict), "ring": ring,
                      "removed": False, "why": why, "source": "detected"})
    # The shells under the detection cut the phase match found and judged
    # (kept: the stage removes no shell under its cut): listed where the 3D
    # test confirms a ring, or could not judge one standing min_snr above the
    # noise (between two lines, no clean flank), and counted otherwise, so
    # that noise, whose faint bumps fail the test, flags nothing.
    faint = 0
    for r in (phases or {}).get("rings") or []:  # type: ignore[attr-defined]
        if not isinstance(r, dict) or r.get("source") != "weak":
            continue
        code = str(r.get("code") or "")
        sn = r.get("snr")
        unjudged = (code in ("grid", "flank", "cells", "nodata")
                    and isinstance(sn, (int, float)) and sn >= cfg.min_snr)
        if code != "ring" and not unjudged:
            faint += 1
            continue
        q, w = float(r["q"]), float(r["fwhm"])
        ring = True if code == "ring" else None
        rings.append({"q": _round(q), "fwhm": _round(w), "snr": sn,
                      **labelled(q, w, ring, None if ring else code, None), "ring": ring,
                      "removed": False, "why": "faint" if ring else code, "source": "weak"})
    rings.sort(key=lambda r: float(r["q"]))  # type: ignore[arg-type]
    # The phase the match names first is reported only where a ring listed
    # here sits on its lines: a candidate resting on faint shells the 3D test
    # does not confirm is the match's guess on noise, kept in its record.
    named = any(r.get("code") == "PH" for r in rings)
    cands = (phases or {}).get("candidates")
    best = cands[0] if isinstance(cands, list) and cands else None
    return {
        "version": SURVEY_VERSION,
        "dry_run": True,
        "plane": cfg.plane,
        "q_range": [cfg.q_min, cfg.q_max],
        "q_step": q_step,
        "al_lattice_a": None if found.al_a is None else _round(found.al_a, 5),
        "noise": float(noise),
        "rings": rings,
        "faint": faint,
        "phases": phases,
        "phase_summary": phase_summary(phases) if named else None,
        # The candidate the match named that no listed ring supports, if any.
        "phase_unsupported": (best.get("phase")
                              if not named and isinstance(best, dict) else None),
        "not_judged": grid_too_coarse(vol, cfg.isotropy) or None,
        "timing_s": {"profiles": t_profiles, "detect": t_detect,
                     "total": time.perf_counter() - t0},
    }


def _listed(items: list[str]) -> str:
    more = len(items) - SUMMARY_ITEMS
    return ", ".join(items[:SUMMARY_ITEMS]) + (f", +{more} more" if more > 0 else "")


def survey_lines(record: object) -> dict[str, object] | None:
    """The survey for NEBULA Pilot, a few short lines (None for no record):

    - ``al``: the fitted Al lattice and its lines found (hkl at the ring's |Q|),
      or that none was fitted;
    - ``phases``: the phase match's line (:func:`~nebula3d.preprocessing.
      powder_phases.summary`), None where it names no phase;
    - ``unrecognized``: each ring no line explains, strongest first, its |Q|,
      signal-to-noise and whether the 3D test confirmed it a ring (else why
      not), at most :data:`SUMMARY_ITEMS` named;
    - ``removal``: what the ring stage would remove and keep;
    - ``grid``: why the grid cannot judge a ring, only when it cannot.
    """
    if not isinstance(record, dict):
        return None
    rings = [r for r in record.get("rings") or [] if isinstance(r, dict)]
    a = record.get("al_lattice_a")
    al = [r for r in rings if r.get("code") == "AL"]
    al_line = (f"a={float(a):.4f} Å; lines " + _listed(
        [f"{str(r.get('line'))[2:]} {float(r['q']):.2f}" for r in al])  # type: ignore[arg-type]
        if isinstance(a, (int, float)) and al else
        f"a={float(a):.4f} Å" if isinstance(a, (int, float)) else "no Al lattice fitted")
    def strongest(codes: tuple[str, ...]) -> list[dict[str, object]]:
        return sorted((r for r in rings if r.get("code") in codes),
                      key=lambda r: -float(r.get("snr") or 0.0))  # type: ignore[arg-type]

    def word(r: dict[str, object], state: str) -> str:
        sn = r.get("snr")
        strength = f"snr {float(sn):.0f}, " if isinstance(sn, (int, float)) else ""
        return f"{float(r['q']):.2f} ({strength}{state})"  # type: ignore[arg-type]

    unk = [word(r, "removed" if r.get("removed") else "faint, kept") for r in strongest(("UNK",))]
    unsure = [word(r, "grid" if r.get("code") == "GRID" else str(r.get("why")))
              for r in strongest(("GRID", "NJ"))]
    removed = [r for r in rings if r.get("removed")]
    kept = [r for r in rings if not r.get("removed") and r.get("source") == "detected"]
    by: list[str] = []
    for code, name in (("AL", "Al"), ("PH", "phase"), ("UNK", "unrecognized")):
        n = sum(1 for r in removed if r.get("code") == code)
        if n:
            by.append(f"{name} {n}")
    not_rings = sum(1 for r in kept if r.get("code") in ("XTAL", "NR"))
    removal = (f"would remove {len(removed)}" + (f" ({', '.join(by)})" if by else "")
               + f"; keep {len(kept)}" + (f" ({not_rings} not rings)" if not_rings else ""))
    out: dict[str, object] = {
        "al": al_line,
        "phases": record.get("phase_summary"),
        "unrecognized": _listed(unk) if unk else "none",
        **({"unconfirmed": _listed(unsure)} if unsure else {}),
        "removal": removal,
    }
    if record.get("not_judged"):
        out["grid"] = record["not_judged"]
    return out


__all__ = ["CODES", "SUMMARY_ITEMS", "SURVEY_VERSION", "survey_lines", "survey_rings"]
