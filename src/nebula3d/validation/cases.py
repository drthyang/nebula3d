# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The validation cases: synthetic volumes with a planted truth and one fault each.

Every case is a variant of the synthetic demo crystal (:mod:`nebula3d.demo`):
its chemical short-range order, thermal diffuse and rods, plus **planted pair
correlations** at known vectors and signs, which the 3D-ΔPDF must recover. On
top come what a measurement adds (the radial background, the Bragg peaks, the
beam spot, counting noise) and one fault of a known size. The truth is the
crystal's own diffuse scattering, noise-free and in the crystal's frame.

The cases come in two splits. **dev** is for improving the tools, the skills
and the prompts. **test** is held out: only its reported numbers are read, and
nothing may be tuned on it. Each family has one case in each split, built
from a different crystal (cell, order, seed, planted vectors) and a different
fault size, so what is learned on dev cannot fit test by its numbers.
``tests/test_validation.py`` and ``web/src/llm/evals/validation.test.ts``
hold the split apart.

Nothing here reads measured data.
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .. import faults
from ..analysis.coverage import q_coverage
from ..core import HKLVolume
from ..demo import DemoModel, demo_volume

__all__ = [
    "Built",
    "Case",
    "CASES",
    "Crystal",
    "FAMILIES",
    "Planted",
    "SPLITS",
    "build",
    "case_named",
    "cases",
    "orbit",
]

SPLITS = ("dev", "test")

#: What each family plants or breaks, and what the Pilot should do about it.
FAMILIES: Mapping[str, str] = {
    "control": (
        "No fault: the planted correlations must come through, and nothing may be reported wrong."
    ),
    "ub": (
        "The UB turned: every Bragg peak sits beside its node by the angle × |Q|. Report the "
        "angle; no setting fixes it."
    ),
    "origin": (
        "The HKL origin shifted: every feature moves by one vector, which no UB undoes. Report it"
        " as the origin, not the UB."
    ),
    "coverage": (
        "The counts end inside the box. The ΔPDF window must stay on measured space; report the "
        "edge."
    ),
    "rings": "Powder rings: remove them, and report them.",
    "shell": (
        "A diffuse shell at one |Q| that is the crystal's own (it follows the crystal's symmetry,"
        " absent in a fifth of directions). Keep it."
    ),
    "flatten": (
        "A background rising as |Q|², which the default flatten (a constant) leaves as a "
        "pedestal. Turn on the flatten's Q² term."
    ),
    "rings-shell": (
        "Powder rings and the crystal's own shell together: remove the one, keep the other."
    ),
}


@dataclass(frozen=True)
class Planted:
    """A pair correlation planted in the crystal: ΔI(h) = amplitude · E(|Q|) ·
    Σ cos 2π h·r over the vectors r of :func:`orbit` (*vector*), so the 3D-ΔPDF
    has a peak of that sign at every one of them."""

    vector: tuple[float, float, float]  # fractions of the cell
    amplitude: float  # data units per cosine term; its sign is the correlation's


@dataclass(frozen=True)
class Crystal:
    """The demo crystal's variant and the correlations planted in it."""

    a: float
    sro_amp: float
    seed: int
    planted: tuple[Planted, ...]
    envelope_q: float = 4.0  # Å⁻¹: σ of the planted terms' Gaussian envelope E(|Q|)


@dataclass(frozen=True)
class Case:
    id: str
    family: str
    split: str
    crystal: Crystal
    fault: Mapping[str, Any] = field(default_factory=dict)

    @property
    def summary(self) -> str:
        return FAMILIES[self.family]


# The two crystals. The planted vectors are interatomic vectors of the rock
# salt structure (cation to anion: an odd sum of doubled fractions) that are not
# FCC lattice vectors, where the crystal's own order puts its correlations: so
# each planted peak stands apart from them.
DEV_CRYSTAL = Crystal(
    a=3.9,
    sro_amp=0.09,
    seed=11,
    planted=(Planted((0.5, 1.0, 1.0), -0.004), Planted((1.5, 0.0, 0.0), 0.010)),
)
TEST_CRYSTAL = Crystal(
    a=4.1,
    sro_amp=0.07,
    seed=23,
    planted=(Planted((0.5, 1.0, 0.0), 0.004), Planted((1.5, 1.0, 0.0), -0.003)),
)


def _pair(family: str, dev: Mapping[str, Any], test: Mapping[str, Any]) -> tuple[Case, Case]:
    return (
        Case(f"dev-{family}", family, "dev", DEV_CRYSTAL, dev),
        Case(f"test-{family}", family, "test", TEST_CRYSTAL, test),
    )


_SHELL_DEV = {"q": 2.9, "amplitude": 0.25, "width": 0.03, "lobes": "100", "power": 3}
_SHELL_TEST = {"q": 3.35, "amplitude": 0.2, "width": 0.035, "lobes": "111", "power": 3}
_RINGS_DEV = {"q": (2.2, 4.05), "amplitude": 0.5, "width": 0.025}
_RINGS_TEST = {"aluminium": 0.6}  # the sample can's textured Al lines (nebula3d.demo)

#: Every case, dev then test per family.
CASES: tuple[Case, ...] = tuple(
    itertools.chain.from_iterable(
        (
            _pair("control", {}, {}),
            _pair(
                "ub",
                {"angle_deg": 0.6, "axis": (1.0, 1.0, 0.0)},
                {"angle_deg": 0.45, "axis": (1.0, 0.0, 2.0)},
            ),
            _pair("origin", {"offset": (0.03, 0.02, 0.0)}, {"offset": (0.0, 0.035, 0.02)}),
            _pair("coverage", {"fraction": 0.7}, {"fraction": 0.62}),
            _pair("rings", _RINGS_DEV, _RINGS_TEST),
            _pair("shell", _SHELL_DEV, _SHELL_TEST),
            _pair("flatten", {"q2": 0.006}, {"q2": 0.0045}),
            _pair(
                "rings-shell",
                {**_RINGS_DEV, "shell": _SHELL_DEV},
                {**_RINGS_TEST, "shell": _SHELL_TEST},
            ),
        )
    )
)


def cases(split: str) -> tuple[Case, ...]:
    if split not in SPLITS:
        raise ValueError(f"split must be one of {SPLITS}")
    return tuple(c for c in CASES if c.split == split)


def case_named(case_id: str) -> Case:
    for c in CASES:
        if c.id == case_id:
            return c
    raise KeyError(f"no validation case {case_id!r}")


def orbit(vector: Sequence[float]) -> list[tuple[float, float, float]]:
    """The vector's images under the cube's 48 operations, one of each ± pair."""
    out: set[tuple[float, float, float]] = set()
    for p in itertools.permutations(vector):
        for s in itertools.product((1.0, -1.0), repeat=3):
            w = tuple(float(x * y) + 0.0 for x, y in zip(p, s))
            if tuple(-x + 0.0 for x in w) not in out:
                out.add(w)  # type: ignore[arg-type]
    return sorted(out)


# ---------------------------------------------------------------- building


@dataclass
class Built:
    """A case's volumes: what the instrument gives, and the truth."""

    case: Case
    raw: HKLVolume  # the measured volume, fault included (float32, as the browser keeps it)
    truth: HKLVolume  # the crystal's own diffuse, noise-free, in its frame, every voxel measured
    rings: NDArray[np.floating] | None  # the powder rings put in (data units), on the grid
    shell: NDArray[np.floating] | None  # the crystal's own shell (part of truth), on the grid
    notes: dict[str, Any]


def _model(c: Crystal, ring_amp: float = 0.0) -> DemoModel:
    return DemoModel(a=c.a, sro_amp=c.sro_amp, ring_amp=ring_amp)


def _q_and_hkl(vol: HKLVolume) -> tuple[NDArray[np.float64], tuple[NDArray[np.float64], ...]]:
    h, k, l = np.meshgrid(vol.h_axis, vol.k_axis, vol.l_axis, indexing="ij")
    return vol.q_magnitude().astype(np.float64), (h, k, l)


def planted_intensity(vol: HKLVolume, c: Crystal) -> NDArray[np.float64]:
    """The planted correlations' ΔI on *vol*'s grid (crystal frame)."""
    q, (h, k, l) = _q_and_hkl(vol)
    envelope = np.exp(-0.5 * (q / c.envelope_q) ** 2)
    out = np.zeros_like(q)
    for p in c.planted:
        terms = np.zeros_like(q)
        for u, v, w in orbit(p.vector):
            terms += np.cos(2.0 * np.pi * (h * u + k * v + l * w))
        out += p.amplitude * envelope * terms
    return out


def shell_intensity(vol: HKLVolume, s: Mapping[str, Any]) -> NDArray[np.float64]:
    """A diffuse shell at |Q| = q that follows the cube's symmetry: strongest
    along ⟨100⟩ (lobes "100") or ⟨111⟩ ("111"), and near zero in about a fifth
    of the directions (power 3), so it is not a powder ring."""
    q, (h, k, l) = _q_and_hkl(vol)
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    qx = ub[0, 0] * h + ub[0, 1] * k + ub[0, 2] * l
    qy = ub[1, 0] * h + ub[1, 1] * k + ub[1, 2] * l
    qz = ub[2, 0] * h + ub[2, 1] * k + ub[2, 2] * l
    safe = np.where(q > 0, q, 1.0)
    quartic = (qx**4 + qy**4 + qz**4) / safe**4  # 1 along ⟨100⟩, 1/3 along ⟨111⟩
    g = np.clip((quartic - 1.0 / 3.0) / (2.0 / 3.0), 0.0, 1.0)
    if s["lobes"] == "111":
        g = 1.0 - g
    radial = np.exp(-0.5 * ((q - float(s["q"])) / float(s["width"])) ** 2)
    return float(s["amplitude"]) * radial * g ** int(s["power"])


def build(case: Case, n: int = 161) -> Built:
    """The case's volumes on an n³ grid over ±4 r.l.u. (161: every integer node on a voxel)."""
    c = case.crystal
    f = case.fault
    aluminium = float(f.get("aluminium", 0.0))
    model = _model(c, aluminium)
    crystal = demo_volume(
        n, seed=c.seed, model=model, components=("sro", "tds", "rods"), noise=False
    )
    nuisance_parts = ("background", "bragg", "beam") + (("rings",) if aluminium else ())
    nuisance = demo_volume(n, seed=c.seed, model=model, components=nuisance_parts, noise=False)

    truth_data = crystal.data + planted_intensity(crystal, c)
    shell = (
        shell_intensity(crystal, f["shell"] if "shell" in f else f)
        if case.family in ("shell", "rings-shell")
        else None
    )
    if shell is not None:
        truth_data = truth_data + shell
    expected = truth_data + nuisance.data

    rings: NDArray[np.floating] | None = None
    if "q" in f and case.family in ("rings", "rings-shell"):
        rings = faults.add_rings(
            replace(crystal, data=np.zeros_like(crystal.data)),
            f["q"],
            amplitude=f["amplitude"],
            width=f["width"],
        ).data
    elif aluminium:
        al = demo_volume(n, seed=c.seed, model=model, components=("rings",), noise=False)
        rings = al.data
    if rings is not None and not aluminium:
        expected = expected + rings
    if "q2" in f:
        q = crystal.q_magnitude().astype(np.float64)
        expected = expected + float(f["q2"]) * q * q

    if expected.min() <= 0:
        raise AssertionError(f"{case.id}: the expected intensity must stay positive")
    # Counting noise as the demo makes it: Poisson counts plus a Gaussian residual.
    rng = np.random.default_rng(c.seed)
    tau = model.counts_per_unit
    data = rng.poisson(expected * tau) / tau + model.residual_noise * rng.standard_normal(
        expected.shape
    )
    sigma = np.sqrt(expected / tau + model.residual_noise**2)
    raw = replace(
        crystal,
        data=data.astype(np.float32),
        sigma=sigma.astype(np.float32),
        mask=np.ones(expected.shape, dtype=bool),
    )

    notes: dict[str, Any] = {}
    if case.family == "ub":
        raw = faults.misorient(raw, f["angle_deg"], f["axis"])
    elif case.family == "origin":
        raw = faults.shift_origin(raw, f["offset"])
    elif case.family == "coverage":
        q_cut = float(f["fraction"]) * q_coverage(raw).box_q
        raw = faults.cut_coverage(raw, q_cut)
        notes["q_cut"] = round(q_cut, 4)
    truth = replace(
        crystal,
        data=truth_data,
        sigma=np.zeros_like(truth_data),
        mask=np.ones(truth_data.shape, dtype=bool),
    )
    return Built(case=case, raw=raw, truth=truth, rings=rings, shell=shell, notes=notes)


def ring_qs(b: Built) -> list[float]:
    """The |Q| of every powder ring the case put in (Å⁻¹)."""
    f = b.case.fault
    if "q" in f and b.case.family in ("rings", "rings-shell"):
        return [float(x) for x in f["q"]]
    if f.get("aluminium"):
        from ..demo import _AL_A, _AL_LINES

        return [2.0 * math.pi * math.sqrt(sum(i * i for i in hkl)) / _AL_A for hkl, _ in _AL_LINES]
    return []
