"""The phase match of the pooled ring removal on synthetic volumes (THY-62).

Each volume carries the Al lines of the sample environment (contracted by
0.4 %) and the rings of another library phase at its own lattice scale,
textured, with noise, and measured past 5.5 Å⁻¹ in half the directions only
(tests/powder_phase_volumes.py). The match must name the phase with its
scale; leave the lines hidden under an Al ring unjudged; report the rings it
does not explain; and name nothing where no phase is there: a crystal's own
diffuse shells, or vanadium, whose lines neutrons barely see.
"""

import dataclasses

import numpy as np
import pytest

from nebula3d import pipeline
from nebula3d.preprocessing import PooledRingConfig, fit_pooled_rings, powder_phases

from .powder_phase_volumes import phase_volume

AL = (-0.004, 1.0)
CFG = PooledRingConfig(q_max=7.0)


def _fit(vol, cfg=CFG, sample="synthetic_20K.nxs"):
    vol = dataclasses.replace(vol, data=vol.data.copy(), mask=vol.mask.copy())
    return fit_pooled_rings(vol, cfg, sample=sample)


@pytest.fixture(scope="module")
def bi_case():
    vol, _ = phase_volume({"Al": AL, "Bi": (-0.004, 0.12)}, extra=[(3.60, 0.25)])
    return vol, _fit(vol)


def _best(res):
    rec = res.diagnostics["powder_phases"]
    return rec, (rec["candidates"][0] if rec["candidates"] else None)


def test_bi_flux_rings_are_named_with_their_scale(bi_case):
    _vol, res = bi_case
    rec, best = _best(res)
    assert best["phase"] == "Bi" and best["status"] == "likely"
    assert best["scale"] == pytest.approx(-0.004, abs=0.001)
    assert {ln["hkl"] for ln in best["lines"]} >= {"012", "202", "214"}
    assert rec["temperature_K"] == 20.0 and rec["scales"][1] == powder_phases.SCALE_MARGIN
    # The record's rings, each with how the ring removal saw it.
    assert all(r["source"] in ("ring", "left", "weak") for r in rec["rings"])
    # The Bi rings the ring removal kept carry the match.
    kept = [s for s in res.diagnostics["shells"] if (s.get("match") or {}).get("phase") == "Bi"]
    assert kept and kept[0]["match"]["hkl"] == "012" and kept[0]["match"]["status"] == "likely"


def test_bi_lines_under_al_111_are_hidden_not_missing(bi_case):
    _vol, res = bi_case
    _rec, best = _best(res)
    hidden = {h["hkl"]: h["under"] for h in best["hidden"]}
    assert hidden.get("104") == "Al111" and hidden.get("110") == "Al111"
    assert not best["missing"]


def test_a_ring_of_no_phase_is_reported_unmatched(bi_case):
    _vol, res = bi_case
    rec, best = _best(res)
    assert any(abs(q - 3.60) < 0.05 for q in best["unmatched"])
    assert rec["unmatched"] == best["unmatched"]
    assert "unmatched 3.6" in powder_phases.summary(rec)


@pytest.mark.parametrize("phase, scale, amount", [("Sn", -0.003, 0.15), ("Cu", -0.003, 0.05)])
def test_tin_and_copper_rings_are_named(phase, scale, amount):
    vol, _ = phase_volume({"Al": AL, phase: (scale, amount)}, seed=1)
    _rec, best = _best(_fit(vol))
    assert best["phase"] == phase and best["status"] == "likely"
    assert best["scale"] == pytest.approx(scale, abs=0.001)


def test_the_crystals_own_diffuse_shells_name_no_phase():
    vol, _ = phase_volume({"Al": AL}, diffuse=[(2.2, 0.3), (3.45, 0.25), (4.6, 0.25)], seed=2)
    rec, best = _best(_fit(vol))
    assert best is None
    assert powder_phases.summary(rec) is None


def test_vanadium_beside_aluminium_is_not_seen():
    # As much V as Al in the beam: its lines stand at about 1/70 of the Al's,
    # under the noise, and no phase is named.
    vol, _ = phase_volume({"Al": AL, "V": (-0.002, 1.0)}, seed=3)
    rec, best = _best(_fit(vol))
    assert best is None or best["phase"] != "V"


def test_the_match_changes_no_subtraction(bi_case):
    vol, res = bi_case
    off = _fit(vol, dataclasses.replace(CFG, match_phases=False))
    np.testing.assert_array_equal(res.cleaned.data, off.cleaned.data)
    np.testing.assert_array_equal(res.cleaned.mask, off.cleaned.mask)
    on_d, off_d = dict(res.diagnostics), dict(off.diagnostics)
    assert "powder_phases" in on_d and "powder_phases" not in off_d
    for d in (on_d, off_d):
        d.pop("powder_phases", None)
        d.pop("timing_s")
        d["config"] = {k: v for k, v in d["config"].items() if k != "match_phases"}
        for s in [*d["shells"], *d["rejected_shells"]]:
            if (s.get("match") or {}).get("phase") not in (None, "Al"):
                s.pop("match")
    assert on_d == off_d


def test_the_pipeline_hands_the_sample_name_to_the_match():
    vol, _ = phase_volume({"Al": AL, "Bi": (-0.004, 0.12)}, seed=4)
    params = pipeline.RingParams(q_max=7.0)
    out = pipeline.remove_rings(vol, params, sample="NdBi_20K_(0,k,l).nxs")
    rec = out._ring_diagnostics["powder_phases"]
    assert rec["temperature_K"] == 20.0
    assert rec["candidates"][0]["phase"] == "Bi" and rec["candidates"][0]["in_composition"]
