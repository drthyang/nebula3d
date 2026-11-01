# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Which Laue class: the candidates compared by R_int, the evidence for stage 0.

The symmetry average (pipeline stage 0, :mod:`nebula3d.symmetry`) averages an
unsymmetrized volume over the Laue class the user declares.  This module gives
the evidence for choosing it.  Every Laue class the cell's metric allows (the
UB under the stage's own check, :func:`~nebula3d.symmetry.metric_change` within
:data:`~nebula3d.symmetry.METRIC_TOLERANCE`) and whose operations map the grid
onto itself is a candidate; for each, R_int — Σ|I − ⟨I⟩| / Σ|I| over the
measured voxels of the orbits measured at least twice — is computed with the
stage's own orbit construction and measured-voxel rule
(:func:`~nebula3d.symmetry.orbit_terms`), twice: on every measured voxel, and
on the diffuse alone, the Bragg nodes masked (:func:`bragg_neighbourhood`).

R_int grows with the size of the orbits even when equivalent voxels differ by
counting noise alone (the mean absolute deviation from the mean of n values
is √(1 − 1/n) of a value's own), so classes are compared in units of their
**noise floor**, the R_int counting noise alone would give on the same orbits
(√(2/π)·sd(I − ⟨I⟩) from σ, :class:`~nebula3d.symmetry.OrbitTerms`): the
ratio ρ = R_int / noise floor.  Beside it, χ²/dof: Σ(I − ⟨I⟩_w)²/σ² over the
same members about their inverse-variance mean, over Σ(n − 1), 1 where the
equivalents agree to the counting noise.  The rule (:func:`judge`):

- a candidate *rises* against a subgroup when its ρ exceeds the subgroup's by
  more than :data:`DELTA` (10 %) and the excess is more than :data:`Z`
  standard errors, from a spatial block bootstrap of the difference
  (:func:`_bootstrap`: neighbouring voxels are correlated, so orbits are not
  independent samples);
- it is *supported* when it rises against none of its candidate subgroups and
  every one of them is supported;
- a reading *tells the classes apart* only when pooling whole |Q| shells (no
  symmetry at all, the most a class could pool) rises against the lowest
  candidate by the same test: else every class agrees within the noise and
  the data cannot prefer one;
- the suggestion is the supported candidate with the most operations in
  every reading that tells the classes apart.  It is a suggestion: the class
  is the user's to declare.

A diagnostic reads every class again on the voxels the lowest candidate can
judge (the common subset), and flags a suggestion that changes there: a sign
of systematic errors that differ between regions of the coverage.

Twinning or several domains related by an operation the sample lacks make a
lower symmetry look higher, and R_int alone cannot tell them apart.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Any, cast

import numpy as np
from numpy.typing import ArrayLike, NDArray

from nebula3d.core import HKLVolume, q_magnitude_from_axes
from nebula3d.symmetry import (
    LAUE_PRESETS,
    METRIC_TOLERANCE,
    GridSymmetry,
    LaueGroup,
    OrbitTerms,
    check_uniform_axes,
    close_group,
    group_label,
    laue_group,
    metric_change,
    orbit_terms,
    slab_orbits,
    slab_planes,
)
from nebula3d.utils.counting import bincount

if TYPE_CHECKING:
    from nebula3d.pipeline import PunchParams

__all__ = [
    "BLOCK_MIN",
    "DELTA",
    "REPLICATES",
    "Z",
    "Candidate",
    "LaueComparison",
    "Reading",
    "Refused",
    "bragg_neighbourhood",
    "bragg_radius_from_punch",
    "compare_laue_classes",
    "judge",
    "laue_candidates",
]

#: The rule's relative tolerance: a class rises against a subgroup when its
#: R_int, in units of its noise floor, exceeds the subgroup's by more than
#: this.  Where the subgroup's equivalents agree to the counting noise, 10 %
#: lets through a symmetry breaking under about half the noise per voxel
#: (√(1 + 0.46²) ≈ 1.1), which averaging cannot distort the data by more than
#: the noise does; above it the rise exceeds the ratio's sampling error on any
#: volume of more than a few thousand orbits (docs/algorithms/laue_compare.md).
DELTA = 0.10

#: ... and by more than this many standard errors of the difference, so a
#: small volume's noise does not reject a class.
Z = 2.0

#: Whether the rule caps the paired excess's error at the subgroup's own
#: (:func:`_rises`).  Provisional, for the user to confirm: the block
#: bootstrap alone also counts the uneven reach of a real breaking over the
#: coverage, which near the tolerance accepts a broken class.
SE_CAP = True

#: The bootstrap's replicates: the standard error it gives is itself within
#: about 1/√(2·200) = 5 % of its value from the resampling alone.
REPLICATES = 200

#: The bootstrap's seed: the same volume gives the same standard errors.
BOOTSTRAP_SEED = 20261101

#: The smallest block edge, in voxels: below the autocorrelation's reach of
#: one voxel the estimate cannot see a correlation, and 4³ representatives a
#: block keep any it misses inside the block more than it leaks out.
BLOCK_MIN = 4

#: The block edge is the smallest whose blocks keep at least this share of the
#: variance the measured autocorrelation gives a block sum (the rest is the
#: covariance across block faces the bootstrap cannot see): the standard error
#: then errs low by at most 1 − √0.8 ≈ 10 %.
VARIANCE_KEPT = 0.8

#: At most this many blocks on the grid (the edge grows on a large grid, which
#: only makes the blocks safer), and at least :data:`MIN_BLOCKS` holding
#: measured voxels (the edge is capped on a small one).
MAX_BLOCKS = 16384
MIN_BLOCKS = 64

#: The autocorrelation is measured to this lag (voxels), on about
#: :data:`CORR_SAMPLE` voxels of the lowest class's orbits.
CORR_LAGS = 8
CORR_SAMPLE = 1 << 20

ProgressFn = Callable[[float, str], None]

_MEAN_ABS_NORMAL = math.sqrt(2.0 / math.pi)

# The voxel classes the readings select, as bits of one uint8 array (one byte
# a voxel for all four readings' masks): measured (mask True, value finite),
# near a Bragg node, and judged by the lowest candidate class on every
# measured voxel and on the diffuse (its orbit holds another such voxel).
_MEASURED, _BRAGG, _COMMON_ALL, _COMMON_DIFFUSE = 1, 2, 4, 8


class _Gather:
    """The codes at the voxels last asked for: the masks of one pass read the
    same images in turn, so the codes are gathered once for all of them."""

    def __init__(self, codes: NDArray[np.uint8]) -> None:
        self.codes = codes
        self._index: tuple[Any, ...] | None = None
        self._value: NDArray[np.uint8] | None = None

    def __call__(self, index: tuple[NDArray[np.intp], ...] | slice) -> NDArray[np.uint8]:
        key = index if isinstance(index, tuple) else (index,)
        last = self._index
        if (last is None or self._value is None or len(last) != len(key)
                or any(a is not b for a, b in zip(last, key))):
            self._index, self._value = key, self.codes[index]
        assert self._value is not None
        return self._value


class _Bits:
    """A boolean mask read off bit fields of one uint8 array, as
    :func:`~nebula3d.symmetry.orbit_terms` reads a mask (``mask[i, j, l]``):
    True where every bit of *on* is set and no bit of *off*.  Masks built on
    one :class:`_Gather` share its gathered codes."""

    def __init__(self, codes: NDArray[np.uint8] | _Gather, on: int, off: int = 0) -> None:
        self._gather = codes if isinstance(codes, _Gather) else _Gather(codes)
        self.shape = self._gather.codes.shape
        self._care = np.uint8(on | off)
        self._want = np.uint8(on)

    def __getitem__(self, index: tuple[NDArray[np.intp], ...] | slice) -> NDArray[np.bool_]:
        return cast("NDArray[np.bool_]", (self._gather(index) & self._care) == self._want)


#: A mask as the readings take it: a boolean array, or bits of the codes.
_Mask = NDArray[np.bool_] | _Bits


def _as_mask(m: _Mask) -> NDArray[np.bool_]:
    """A mask as orbit_terms' signature names it (a :class:`_Bits` reads alike)."""
    return cast("NDArray[np.bool_]", m)


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Reading:
    """R_int of one class (or of whole |Q| shells) on one set of voxels.

    ``r_int`` is Σ|I − ⟨I⟩| / Σ|I| over the measured members of the
    ``orbits`` measured at least twice (``voxels`` of them, ``pairs`` the
    pairs of measured equivalents those orbits hold), ``noise`` the R_int
    counting noise alone would give there (the noise floor), ``ratio`` the
    one over the other and ``ratio_se`` its standard error: from the spatial
    block bootstrap once :func:`compare_laue_classes` has run it, from the
    orbits as independent samples before (``ratio_se_orbits``, which
    correlated neighbours make too small).  ``chi2`` is Σ(I − ⟨I⟩_w)²/σ² about
    each orbit's inverse-variance mean over ``dof`` = Σ(n − 1), the members
    with σ above 0.  ``None`` without such an orbit (or, for the noise floor,
    the ratio and χ², without a σ above 0)."""

    r_int: float | None
    noise: float | None
    ratio: float | None
    ratio_se: float | None
    orbits: int
    voxels: int
    pairs: int
    chi2: float | None = None
    dof: int = 0
    ratio_se_orbits: float | None = None
    # The ratio on each bootstrap replicate, the same resamples for every
    # class and reading (for paired differences); not in the payload.
    replicates: NDArray[np.float64] | None = field(default=None, repr=False, compare=False)

    def to_dict(self) -> dict[str, Any]:
        return {"r_int": self.r_int, "noise": self.noise, "ratio": self.ratio,
                "ratio_se": self.ratio_se, "ratio_se_orbits": self.ratio_se_orbits,
                "chi2": self.chi2, "dof": self.dof, "orbits": self.orbits,
                "voxels": self.voxels, "pairs": self.pairs}


@dataclass(frozen=True)
class Verdict:
    """What the rule made of one candidate in one reading: ``supported``, and
    the subgroup it was weighed against (``against``, the candidate subgroup
    with the lowest ratio) with its ``rise`` (the ratio over that one's) and
    the standard error of the tested difference (``se``: the class's ratio
    minus (1 + δ) times the subgroup's, over the same bootstrap resamples);
    ``rises`` when the rise itself fails the rule (not merely a subgroup's
    failure inherited), ``judged`` False when the reading cannot judge it."""

    supported: bool
    rises: bool
    against: str | None
    rise: float | None
    judged: bool = True
    se: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"supported": self.supported, "rises": self.rises, "against": self.against,
                "rise": self.rise, "se": self.se, "judged": self.judged}


#: The readings each candidate gets: every measured voxel, the diffuse, and
#: the same two on the common subset (the voxels the lowest class can judge).
READINGS = ("all", "diffuse")
COMMON = ("common_all", "common_diffuse")


@dataclass
class Candidate:
    """A Laue class the metric allows and the grid takes: its group, how much
    its operations change the cell's metric (``None`` without a UB), its
    candidate subgroups (all, and the maximal ones: the chain the table
    draws, ``depth`` the longest chain below it), its two readings with
    their verdicts, and the same two on the common subset."""

    label: str
    generators: str
    group: LaueGroup
    metric_change: float | None
    sym: GridSymmetry | None = None
    subgroups: list[str] = field(default_factory=list)
    maximal: list[str] = field(default_factory=list)
    depth: int = 0
    all: Reading | None = None
    diffuse: Reading | None = None
    common_all: Reading | None = None
    common_diffuse: Reading | None = None
    verdict_all: Verdict | None = None
    verdict_diffuse: Verdict | None = None
    verdict_common_all: Verdict | None = None
    verdict_common_diffuse: Verdict | None = None

    @property
    def order(self) -> int:
        return self.group.order

    def to_dict(self) -> dict[str, Any]:
        def r(x: Reading | None) -> dict[str, Any] | None:
            return None if x is None else x.to_dict()

        def v(x: Verdict | None) -> dict[str, Any] | None:
            return None if x is None else x.to_dict()

        return {
            "laue": self.label, "generators": self.generators, "order": self.order,
            "ops": self.group.ops_text, "metric_change": self.metric_change,
            "subgroups": list(self.subgroups), "maximal_subgroups": list(self.maximal),
            "depth": self.depth,
            "all": r(self.all),
            "diffuse": r(self.diffuse),
            "common": {"all": r(self.common_all), "diffuse": r(self.common_diffuse)},
            "verdict": {
                "all": v(self.verdict_all),
                "diffuse": v(self.verdict_diffuse),
                "common_all": v(self.verdict_common_all),
                "common_diffuse": v(self.verdict_common_diffuse),
            },
        }


@dataclass(frozen=True)
class Refused:
    """A Laue class that is not a candidate, and why: ``reason`` "metric" (its
    operations change the cell's metric by more than 2 %: no symmetries of
    this lattice) or "grid" (they do not map the grid onto itself), with the
    stage's own wording in ``detail``."""

    label: str
    order: int
    reason: str
    detail: str
    metric_change: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"laue": self.label, "order": self.order, "reason": self.reason,
                "detail": self.detail, "metric_change": self.metric_change}


@dataclass
class LaueComparison:
    """The candidates compared, the classes refused, the reference (whole |Q|
    shells), the Bragg neighbourhood masked for the diffuse reading, the
    bootstrap behind the standard errors, the common-subset diagnostic, the
    rule and what it suggests.  :meth:`to_dict` is the API's payload."""

    candidates: list[Candidate]
    refused: list[Refused]
    isotropic: dict[str, Reading]
    bragg: dict[str, Any]
    measured: int
    sigma_estimated: bool
    delta: float = DELTA
    z: float = Z
    readings: dict[str, dict[str, Any]] = field(default_factory=dict)
    suggestion: str | None = None
    suggested_by: dict[str, str | None] = field(default_factory=dict)
    reason: str = ""
    disagreement: str | None = None
    notes: list[str] = field(default_factory=list)
    bootstrap: dict[str, Any] = field(default_factory=dict)
    common: dict[str, Any] = field(default_factory=dict)

    @property
    def rule(self) -> str:
        return rule_text(self.delta, self.z)

    def candidate(self, label: str) -> Candidate:
        return next(c for c in self.candidates if c.label == label)

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidates": [c.to_dict() for c in self.candidates],
            "refused": [r.to_dict() for r in self.refused],
            "isotropic": {k: v.to_dict() for k, v in self.isotropic.items()},
            "bragg": dict(self.bragg),
            "measured": self.measured,
            "sigma": "estimated" if self.sigma_estimated else "measured",
            "rule": {"delta": self.delta, "z": self.z, "text": self.rule},
            "readings": {k: dict(v) for k, v in self.readings.items()},
            "suggestion": self.suggestion,
            "suggested_by": dict(self.suggested_by),
            "reason": self.reason,
            "disagreement": self.disagreement,
            "notes": list(self.notes),
            "bootstrap": dict(self.bootstrap),
            "common": dict(self.common),
            "limits": LIMITS,
        }


#: What R_int cannot tell (the result carries it, and the docs).
LIMITS = (
    "Twinning or several domains related by an operation the sample lacks make a lower "
    "symmetry look higher: the domains' sum has the higher symmetry, and R_int alone cannot "
    "tell them apart. Systematic errors that differ between regions of the coverage reject "
    "classes falsely (the common-subset reading flags it). Only the presets' settings are "
    "compared (the four-fold along c, the two-fold along b or c); a sample with its unique "
    "axis elsewhere needs custom generators. The diffuse reading masks a sphere around each "
    "Bragg node, not the punch itself.")


def rule_text(delta: float = DELTA, z: float = Z) -> str:
    """The rule in one paragraph, with its numbers."""
    return (
        f"Each class's R_int is read in units of its noise floor (the R_int counting noise "
        f"alone gives on the same orbits, from σ). A class rises against a subgroup when that "
        f"ratio exceeds the subgroup's by more than {100 * delta:.0f}% and the excess is more "
        f"than {z:g} standard errors (a spatial block bootstrap of the difference); it is "
        f"supported when it rises against none of its candidate subgroups and all of them are "
        f"supported. A reading tells the classes apart only when pooling whole |Q| shells rises "
        f"against the lowest class by the same test. The suggestion is the supported class with "
        f"the most operations in every reading that tells them apart.")


# ---------------------------------------------------------------------------
# The candidates
# ---------------------------------------------------------------------------
def _ub_unknown(vol: HKLVolume) -> bool:
    return bool(np.array_equal(np.asarray(vol.ub_matrix, dtype=np.float64), np.eye(3)))


def laue_candidates(
    vol: HKLVolume, extra: Sequence[str] = (),
) -> tuple[list[Candidate], list[Refused]]:
    """The Laue classes to compare on *vol*, and those refused.

    Every preset of :data:`~nebula3d.symmetry.LAUE_PRESETS` but ``1`` (the
    identity pools nothing), then each of *extra* (a preset name or
    generators, :func:`~nebula3d.symmetry.laue_group`) that is not one of
    them.  A class is refused, as the symmetry average refuses it, when its
    operations change the cell's metric by more than
    :data:`~nebula3d.symmetry.METRIC_TOLERANCE` (not checked without a UB) or
    do not map the grid onto itself.
    """
    specs: list[str] = [name for name, _ in LAUE_PRESETS if name != "1"]
    groups: list[LaueGroup] = [laue_group(name) for name in specs]
    seen = {frozenset(_key(m) for m in g.ops) for g in groups}
    for spec in extra:
        text = str(spec or "").strip()
        if not text:
            continue
        try:
            g = laue_group(text)
        except ValueError:
            continue
        key = frozenset(_key(m) for m in g.ops)
        if g.order < 2 or key in seen:
            continue
        seen.add(key)
        customs = sum(1 for h in groups if h.label.startswith("custom"))
        if g.label == "custom" and customs:
            g = LaueGroup(label=f"custom {customs + 1}", generators=g.generators, ops=g.ops)
        groups.append(g)
    unknown = _ub_unknown(vol)
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    try:
        check_uniform_axes(vol)
        uniform: str | None = None
    except ValueError as exc:
        uniform = str(exc)
    candidates: list[Candidate] = []
    refused: list[Refused] = []
    for g in groups:
        change = None if unknown else metric_change(g.ops, ub)
        if change is not None and change > METRIC_TOLERANCE:
            refused.append(Refused(
                g.label, g.order, "metric",
                f"changes the cell's metric by up to {100 * change:.0f}% (more than "
                f"{100 * METRIC_TOLERANCE:g}%): not symmetries of this lattice", change))
            continue
        if uniform is not None:
            refused.append(Refused(g.label, g.order, "grid", uniform, change))
            continue
        try:
            sym = GridSymmetry.for_volume(vol, g.ops)
        except ValueError as exc:
            refused.append(Refused(g.label, g.order, "grid", str(exc), change))
            continue
        candidates.append(Candidate(label=g.label, generators=g.generators, group=g,
                                    metric_change=change, sym=sym))
    _relate(candidates)
    return candidates, refused


def _key(m: NDArray[np.int64]) -> tuple[int, ...]:
    return tuple(int(x) for x in np.asarray(m).ravel())


def _relate(candidates: list[Candidate]) -> None:
    """Each candidate's candidate subgroups (its operations a proper subset),
    the maximal ones among them, and the longest chain below it."""
    sets = {c.label: frozenset(_key(m) for m in c.group.ops) for c in candidates}
    for c in candidates:
        c.subgroups = [d.label for d in candidates
                       if d is not c and sets[d.label] < sets[c.label]]
    for c in candidates:
        c.maximal = [s for s in c.subgroups
                     if not any(s in next(d for d in candidates if d.label == t).subgroups
                                for t in c.subgroups if t != s)]
    depth: dict[str, int] = {}
    for c in sorted(candidates, key=lambda d: d.order):
        depth[c.label] = 1 + max((depth[s] for s in c.maximal), default=-1)
        c.depth = depth[c.label]
    candidates.sort(key=lambda d: (d.order, d.depth))


def _largest_group(candidates: Sequence[Candidate], vol: HKLVolume) -> GridSymmetry | None:
    """The group every candidate lies in, on the grid: the candidate that
    contains all others, else the group they generate together (when it is a
    point group whose operations map the grid), else None."""
    if not candidates:
        return None
    sets = [frozenset(_key(m) for m in c.group.ops) for c in candidates]
    for c, s in zip(candidates, sets):
        if all(t <= s for t in sets):
            return c.sym
    try:
        ops = close_group([m for c in candidates for m in c.group.ops])
        return GridSymmetry.for_volume(vol, ops)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# The Bragg neighbourhood (the diffuse reading leaves it out)
# ---------------------------------------------------------------------------
def bragg_radius_from_punch(punch: PunchParams | None = None) -> tuple[float, float, str]:
    """The Bragg neighbourhood's radius (Å⁻¹) and the origin's, from the punch
    settings (:class:`~nebula3d.pipeline.PunchParams`, its defaults when
    *punch* is None), and what they come from.

    A node's radius is the largest ellipsoid the punch gives an integer
    node's own fit: ``max_radius_scale`` × the longest radius of the
    punch-frame ellipsoid, plus the guard ``margin`` (2 × 0.115 + 0.02 =
    0.25 Å⁻¹ by default).  The origin's is at least the incident-beam punch's
    longest radius plus its margin.
    """
    from nebula3d.pipeline import PunchParams

    p = punch if punch is not None else PunchParams()
    frame = str(getattr(p, "punch_frame", "spherical")).strip().lower()
    radii = (p.punch_spherical_radii if frame == "spherical" else p.punch_q_radii) or ()
    single = getattr(p, "punch_q_radius", None)
    base = max([float(r) for r in radii] + ([float(single)] if single else []), default=0.115)
    scale = max(1.0, float(getattr(p, "max_radius_scale", 2.0)))
    margin = max(0.0, float(getattr(p, "margin", 0.0)))
    node = scale * base + margin
    beam = list(getattr(p, "incident_beam_q_radii", None) or ())
    origin = max([node] + [float(r) + max(0.0, float(getattr(p, "incident_beam_q_margin", 0.0)))
                           for r in beam])
    source = (f"the punch's largest node ellipsoid: {scale:g} × {base:g} Å⁻¹ + "
              f"{margin:g} Å⁻¹ margin")
    return node, origin, source


def _metric(vol: HKLVolume) -> NDArray[np.float64]:
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    return ub.T @ ub


def _node_spacing_limit(vol: HKLVolume, cell: ArrayLike) -> float:
    """The largest radius whose sphere around a node holds no voxel nearer
    (in index space) to another node: half the smallest singular value of the
    node lattice's basis, UB·diag(cell)."""
    basis = np.asarray(vol.ub_matrix, dtype=np.float64) @ np.diag(np.asarray(cell, dtype=float))
    return 0.5 * float(np.linalg.svd(basis, compute_uv=False).min())


def bragg_neighbourhood(
    vol: HKLVolume, cell: Sequence[int] = (1, 1, 1), radius_q: float = 0.25,
    origin_radius_q: float | None = None, *, symmetry: GridSymmetry | None = None,
    slab_voxels: int = 1 << 20,
) -> tuple[NDArray[np.bool_], float]:
    """Voxels within *radius_q* (Å⁻¹) of a Bragg node, and the radius used.

    The Bragg nodes are the integer nodes of the punch's cell: h, k and l
    multiples of ``cell`` (the parent lattice of a supercell the volume is
    indexed on, as the punch takes them), and within *origin_radius_q* of
    Q = 0 (the incident beam).  The distance is |Q| from the node, through
    the UB, so the sphere is the same at every node a symmetry of the metric
    relates.  The radius is capped at :func:`_node_spacing_limit`, below which
    each voxel's nearest node is its rounded index.  With *symmetry* the mask
    is closed under it (a voxel counts when an equivalent does), so every
    class it contains sees the same voxels.  Slab by slab: the temporaries
    are a few slabs of float64, never a volume's.
    """
    cell_arr = np.maximum(np.asarray(cell, dtype=np.int64), 1)
    limit = 0.98 * _node_spacing_limit(vol, cell_arr)
    radius = float(min(max(0.0, float(radius_q)), limit))
    r0 = max(radius, float(origin_radius_q or 0.0))
    g = _metric(vol)
    axes = [np.asarray(a, dtype=np.float64) for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    offs = [a - c * np.rint(a / c) for a, c in zip(axes, cell_arr)]
    nh, nk, nl = vol.data.shape
    planes = max(1, int(slab_voxels) // max(1, nk * nl))
    out = np.zeros(vol.data.shape, dtype=bool)
    dk = offs[1][None, :, None]
    dl = offs[2][None, None, :]
    for lo in range(0, nh, planes):
        hi = min(nh, lo + planes)
        dh = offs[0][lo:hi, None, None]
        q2 = (g[0, 0] * dh * dh + g[1, 1] * dk * dk + g[2, 2] * dl * dl
              + 2.0 * (g[0, 1] * dh * dk + g[0, 2] * dh * dl + g[1, 2] * dk * dl))
        block = q2 <= radius * radius
        if r0 > radius:
            block |= q_magnitude_from_axes(axes[0][lo:hi], axes[1], axes[2],
                                           vol.ub_matrix) <= r0
        out[lo:hi] = block
    if symmetry is not None:
        out = symmetry.orbit_any(out)
    return out, radius


# ---------------------------------------------------------------------------
# The spatial blocks the bootstrap resamples
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _Blocks:
    """The grid tiled into cubes of ``edge`` voxels (the last along each axis
    shorter)."""

    edge: int
    grid: tuple[int, int, int]

    @property
    def shape(self) -> tuple[int, int, int]:
        e = self.edge
        return (-(-self.grid[0] // e), -(-self.grid[1] // e), -(-self.grid[2] // e))

    @property
    def count(self) -> int:
        a, b, c = self.shape
        return a * b * c

    def of(self, i: NDArray[np.intp], j: NDArray[np.intp],
           l_: NDArray[np.intp]) -> NDArray[np.intp]:
        """The block of each voxel index (any broadcastable shapes)."""
        _, nb, nc = self.shape
        e = self.edge
        return cast("NDArray[np.intp]", ((i // e) * nb + j // e) * nc + l_ // e)


def _image(r: NDArray[np.int64], t: NDArray[np.int64], i: NDArray[np.intp],
           j: NDArray[np.intp], l_: NDArray[np.intp]) -> tuple[NDArray[np.intp], ...]:
    """The index image R·(i, j, l) + t (any broadcastable shapes)."""
    rr = [[int(x) for x in row] for row in r]
    return tuple((rr[a][0] * i + rr[a][1] * j + rr[a][2] * l_ + int(t[a])).astype(
        np.intp, copy=False) for a in range(3))


def _close_and_place(codes: NDArray[np.uint8], sym: GridSymmetry, *,
                     slab_voxels: int = 1 << 20) -> NDArray[np.uint8]:
    """One pass over the orbits of *sym*, the group every candidate lies in.

    The ``_BRAGG`` bit is made the same on every member of an orbit (a voxel
    counts as Bragg when an equivalent does, as
    :meth:`~nebula3d.symmetry.GridSymmetry.orbit_any` makes it), in place, so
    every class reads the same voxels; and each voxel gets the index of the
    operation that maps it onto its orbit's representative (the member with
    the smallest flat index): the array returned, the identity's index (0) on
    the representatives themselves.  A slab of representatives at a time.
    """
    ops = sym.ops
    inverse = []
    eye = np.eye(3, dtype=np.int64)
    for m in ops:
        inverse.append(next(k for k, w in enumerate(ops) if np.array_equal(w @ m, eye)))
    lstar = np.zeros(sym.shape, dtype=np.uint8)
    nh, nk, nl = sym.shape
    planes = slab_planes(sym, slab_voxels)
    for lo in range(0, nh, planes):
        ri, rj, rl = slab_orbits(sym, lo, min(nh, lo + planes))
        if not ri.size:
            continue
        bragg = np.zeros(ri.size, dtype=bool)
        for r, t in sym.index_ops:
            si, sj, sl = _image(r, t, ri, rj, rl)
            on = (si >= 0) & (si < nh) & (sj >= 0) & (sj < nk) & (sl >= 0) & (sl < nl)
            bragg[on] |= (codes[si[on], sj[on], sl[on]] & _BRAGG) != 0
        # In reverse, so the identity is written last: a representative keeps 0.
        for k in range(len(ops) - 1, -1, -1):
            r, t = sym.index_ops[k]
            si, sj, sl = _image(r, t, ri, rj, rl)
            at = np.flatnonzero((si >= 0) & (si < nh) & (sj >= 0) & (sj < nk) & (sl >= 0)
                                & (sl < nl))
            si, sj, sl = si[at], sj[at], sl[at]
            lstar[si, sj, sl] = inverse[k]
            codes[si, sj, sl] |= np.where(bragg[at], _BRAGG, 0).astype(np.uint8)
            del si, sj, sl, at
    return lstar


@dataclass(frozen=True)
class _Placement:
    """Where the bootstrap puts an orbit: in the block of its orbit's
    representative under the group every candidate lies in (``lstar`` the
    operation that maps each voxel there, :func:`_close_and_place`), so an
    orbit of a class and the orbits of its subgroups inside it — the same
    voxels — fall in the same block, and a resample of the blocks resamples
    the same voxels for every class: the pairing the rule's differences need.
    Without such a group, at the voxel's own place.  The blocks that hold a
    representative are numbered compactly (``index``, −1 elsewhere)."""

    blocks: _Blocks
    lstar: NDArray[np.uint8] | None
    rot: NDArray[np.int32]
    shift: NDArray[np.int32]
    index: NDArray[np.int32]
    count: int

    @classmethod
    def make(cls, blocks: _Blocks, lstar: NDArray[np.uint8] | None,
             sym: GridSymmetry | None) -> _Placement:
        if lstar is None or sym is None:
            used = np.ones(blocks.count, dtype=bool)
            rot = np.eye(3, dtype=np.int32)[None]
            shift = np.zeros((1, 3), dtype=np.int32)
        else:
            rot = np.stack([np.asarray(r, dtype=np.int32) for r, _ in sym.index_ops])
            shift = np.stack([np.asarray(t, dtype=np.int32) for _, t in sym.index_ops])
            used = np.zeros(blocks.count, dtype=bool)
            nh, nk, nl = blocks.grid
            jj = np.arange(nk, dtype=np.intp)[None, :, None]
            ll = np.arange(nl, dtype=np.intp)[None, None, :]
            for lo in range(0, nh, 16):
                ii = np.arange(lo, min(nh, lo + 16), dtype=np.intp)[:, None, None]
                rep = lstar[lo:lo + 16] == 0
                used[np.broadcast_to(blocks.of(ii, jj, ll), rep.shape)[rep]] = True
        index = np.full(blocks.count, -1, dtype=np.int32)
        index[used] = np.arange(int(used.sum()), dtype=np.int32)
        return cls(blocks, lstar, rot, shift, index, int(used.sum()))

    def of(self, i: NDArray[np.intp], j: NDArray[np.intp],
           l_: NDArray[np.intp]) -> NDArray[np.intp]:
        """The compact block of each voxel's orbit (broadcastable shapes)."""
        if self.lstar is None:
            g = self.blocks.of(i, j, l_)
        else:
            i, j, l_ = np.broadcast_arrays(i, j, l_)
            k = self.lstar[i, j, l_]
            r, t = self.rot[k], self.shift[k]
            ci = r[..., 0, 0] * i + r[..., 0, 1] * j + r[..., 0, 2] * l_ + t[..., 0]
            cj = r[..., 1, 0] * i + r[..., 1, 1] * j + r[..., 1, 2] * l_ + t[..., 1]
            cl = r[..., 2, 0] * i + r[..., 2, 1] * j + r[..., 2, 2] * l_ + t[..., 2]
            del r, t
            g = self.blocks.of(ci.astype(np.intp), cj.astype(np.intp), cl.astype(np.intp))
        return cast("NDArray[np.intp]", self.index[g].astype(np.intp))


def _variance_kept(rho: Sequence[Sequence[float]], b: int) -> float:
    """The share of a block sum's variance that blocks of edge *b* keep, by the
    measured autocorrelation *rho* (per axis, lags 1, 2, …): along an axis of
    correlation ρ(k), a run of b voxels has variance b(1 + 2Σ_{k<b} ρ(k)) −
    2Σ_{k<b} k·ρ(k) against b(1 + 2Σ ρ(k)) for b voxels of an endless run; the
    axes multiply (a separable correlation)."""
    kept = 1.0
    for r in rho:
        lags = np.arange(1, len(r) + 1, dtype=np.float64)
        rr = np.asarray(r, dtype=np.float64)
        inside = lags < b
        tau = 1.0 + 2.0 * float(rr.sum())
        own = b * (1.0 + 2.0 * float(rr[inside].sum())) - 2.0 * float((lags * rr)[inside].sum())
        kept *= max(0.0, own) / (b * tau) if tau > 0 else 1.0
    return kept


def _block_edge(rho: Sequence[Sequence[float]], reaches_past: bool, n_grid: int,
                order: int = 1) -> int:
    """The block edge the correlation asks for: the smallest, from
    :data:`BLOCK_MIN` (and the edge that keeps the blocks within
    :data:`MAX_BLOCKS`; the orbits sit at the representatives of a group of
    *order* operations, which fill 1/order of the grid), whose blocks keep
    :data:`VARIANCE_KEPT` of a block sum's variance by the autocorrelation
    *rho*; twice :data:`CORR_LAGS` at least where the correlation reaches past
    the lags measured.  :func:`compare_laue_classes` then caps it where fewer
    than :data:`MIN_BLOCKS` blocks would hold a representative."""
    lo = max(BLOCK_MIN, math.ceil((n_grid / max(1, order) / MAX_BLOCKS) ** (1.0 / 3.0) - 1e-9))
    b = lo
    while _variance_kept(rho, b) < VARIANCE_KEPT and b < 4 * CORR_LAGS:
        b += 1
    if reaches_past:
        b = max(b, 2 * CORR_LAGS)
    return b


# ---------------------------------------------------------------------------
# R_int of one class, every reading, in one slab-wise pass
# ---------------------------------------------------------------------------
@dataclass
class _Sums:
    """Running sums of one reading over the slabs, and per block."""

    dev: float = 0.0
    mag: float = 0.0
    noise: float = 0.0
    orbits: int = 0
    voxels: int = 0
    pairs: int = 0
    chi2: float = 0.0
    dof: float = 0.0
    # Over orbits, for the ratio's standard error with orbits as independent
    # samples: d = Σ|I − ⟨I⟩| and ν = the noise floor's numerator, per orbit.
    dd: float = 0.0
    dn: float = 0.0
    nn: float = 0.0
    # Per bootstrap block: Σ d and Σ ν of the orbits it holds.
    block_dev: NDArray[np.float64] | None = None
    block_noise: NDArray[np.float64] | None = None

    def add_orbits(self, d: NDArray[np.float64], a: NDArray[np.float64],
                   nu: NDArray[np.float64], members: NDArray[np.float64], *,
                   chi2: NDArray[np.float64] | None = None,
                   dof: NDArray[np.float64] | None = None,
                   block: NDArray[np.intp] | None = None) -> None:
        self.dev += float(d.sum())
        self.mag += float(a.sum())
        self.noise += float(nu.sum())
        self.orbits += int(d.size)
        self.voxels += int(np.rint(members.sum()))
        self.pairs += int(np.rint((members * (members - 1.0) / 2.0).sum()))
        self.dd += float(np.dot(d, d))
        self.dn += float(np.dot(d, nu))
        self.nn += float(np.dot(nu, nu))
        if chi2 is not None and dof is not None:
            self.chi2 += float(chi2.sum())
            self.dof += float(dof.sum())
        if block is not None and self.block_dev is not None and self.block_noise is not None:
            n = self.block_dev.size
            self.block_dev += bincount(block, d, minlength=n)[:n]
            self.block_noise += bincount(block, nu, minlength=n)[:n]

    def reading(self) -> Reading:
        dof = int(np.rint(self.dof))
        chi2 = self.chi2 / dof if dof > 0 else None
        if self.orbits == 0 or self.mag <= 0:
            return Reading(None, None, None, None, self.orbits, self.voxels, self.pairs)
        r_int = self.dev / self.mag
        if self.noise <= 0:
            return Reading(r_int, None, None, None, self.orbits, self.voxels, self.pairs,
                           chi2, dof)
        ratio = self.dev / self.noise
        var = max(0.0, self.dd - 2.0 * ratio * self.dn + ratio * ratio * self.nn)
        se = math.sqrt(var) / self.noise
        return Reading(r_int, self.noise / self.mag, ratio, se, self.orbits, self.voxels,
                       self.pairs, chi2, dof, se)


def _sums(n: int, place: _Placement | None) -> list[_Sums]:
    return [_Sums(block_dev=None if place is None else np.zeros(place.count),
                  block_noise=None if place is None else np.zeros(place.count))
            for _ in range(n)]


def _orbit_rows(t: OrbitTerms, stab: NDArray[np.int32]) -> tuple[NDArray[np.bool_], dict[str, Any]]:
    """One mask's per-orbit terms on the orbits measured twice, each distinct
    member once: d, |I|, ν, the members, χ² and its degrees of freedom."""
    tw = t.twice
    st = stab[tw].astype(np.float64)
    assert t.dev is not None and t.mag is not None  # orbit_terms' deviations pass ran
    nu = (t.noise[tw] / st) if t.noise is not None else np.zeros(int(tw.sum()))
    out: dict[str, Any] = {"d": t.dev[tw] / st, "a": t.mag[tw] / st, "nu": nu,
                           "members": t.count[tw] / st}
    if t.chi2 is not None and t.wcount is not None:
        out["chi2"] = t.chi2[tw] / st
        out["dof"] = np.maximum(t.wcount[tw] / st - 1.0, 0.0)
    return tw, out


def _class_sums(
    vol: HKLVolume, sym: GridSymmetry, masks: Sequence[_Mask], *,
    place: _Placement | None = None, slab_voxels: int = 1 << 20,
    progress: Callable[[float], None] | None = None,
) -> list[_Sums]:
    """The sums behind R_int of the class *sym* on each of *masks*, its noise
    floor and χ², per block of *place* too:
    :func:`~nebula3d.symmetry.orbit_terms` (the symmetry average's own pass),
    a slab of H planes at a time."""
    data, sigma = vol.data, vol.sigma
    if sigma.shape != data.shape:
        sigma = np.broadcast_to(sigma, data.shape)
    sums = _sums(len(masks), place)
    nh = sym.shape[0]
    planes = slab_planes(sym, slab_voxels)
    for lo in range(0, nh, planes):
        ri, rj, rl = slab_orbits(sym, lo, min(nh, lo + planes))
        if ri.size:
            stab, terms = orbit_terms(data, [_as_mask(m) for m in masks], sym, ri, rj, rl,
                                      sigma=sigma, sigma_unknown_abs=True, noise=True,
                                      chi2=True)
            block = None if place is None else place.of(ri, rj, rl)
            for s, t in zip(sums, terms):
                if not t.twice.any() or t.dev is None or t.mag is None:
                    continue
                tw, row = _orbit_rows(t, stab)
                s.add_orbits(row["d"], row["a"], row["nu"], row["members"],
                             chi2=row.get("chi2"), dof=row.get("dof"),
                             block=None if block is None else block[tw])
            del stab, terms, block
        if progress is not None:
            progress(min(1.0, (lo + planes) / nh))
    return sums


def _class_readings(
    vol: HKLVolume, sym: GridSymmetry, masks: Sequence[_Mask], *,
    slab_voxels: int = 1 << 20, progress: Callable[[float], None] | None = None,
) -> list[Reading]:
    """R_int of the class *sym* on each of *masks*, with its noise floor and
    χ², standard errors over orbits (:func:`_class_sums`)."""
    return [s.reading() for s in _class_sums(vol, sym, masks, slab_voxels=slab_voxels,
                                             progress=progress)]


# ---------------------------------------------------------------------------
# The block edge, from the autocorrelation of the orbits' residuals
# ---------------------------------------------------------------------------
def _autocorrelation(
    vol: HKLVolume, sym: GridSymmetry, masks: Sequence[_Mask], *,
    slab_voxels: int = 1 << 20, sample: int = CORR_SAMPLE, lags: int = CORR_LAGS,
) -> tuple[list[list[list[float]]], list[list[bool]]]:
    """How far the orbits' residuals stay correlated, per mask and axis.

    The residual of an orbit is u = d − ρ·ν (its deviation sum less the ratio
    times its noise-floor sum): the terms whose sum the ratio's error is, so
    their correlation is what the standard error must honour.  Orbits sit at
    their representatives; ρ(k) along an axis is the mean of u·u′ over pairs
    of orbits k voxels apart, over the mean of u².  Read on the class *sym*
    (the lowest candidate: its orbits pool the fewest voxels, and a symmetry
    it lacks is the sample's lowest) on about *sample* voxels: runs of
    consecutive slabs spread evenly over the grid, each run long enough for
    the lags along H (the last planes of a slab carried into the next), two
    passes over them (the ratio, then the products).

    Returns, per mask, per axis, ρ(k) for k = 1, 2, … up to the first lag
    within two standard errors of 0 (that lag excluded), and per mask and
    axis whether ρ was still above them at the last lag the grid allows.
    """
    data, sigma = vol.data, vol.sigma
    if sigma.shape != data.shape:
        sigma = np.broadcast_to(sigma, data.shape)
    nh, nk, nl = sym.shape
    planes = slab_planes(sym, slab_voxels)
    starts = list(range(0, nh, planes))
    run = max(1, math.ceil((lags + 1) / planes))
    runs = [starts[i:i + run] for i in range(0, len(starts), run)]
    every = max(1, math.ceil(nh * nk * nl / (2.0 * sample)))
    chosen = runs[::every]
    m = len(masks)

    def slab(lo: int) -> tuple[tuple[NDArray[np.intp], ...], list[tuple[Any, ...] | None]]:
        ri, rj, rl = slab_orbits(sym, lo, min(nh, lo + planes))
        if not ri.size:
            return (ri, rj, rl), [None] * m
        stab, ts = orbit_terms(data, [_as_mask(x) for x in masks], sym, ri, rj, rl,
                               sigma=sigma, sigma_unknown_abs=True, noise=True)
        rows: list[tuple[Any, ...] | None] = []
        for t in ts:
            if t.twice.any() and t.dev is not None and t.noise is not None:
                tw, row = _orbit_rows(t, stab)
                rows.append((tw, row["d"], row["nu"]))
            else:
                rows.append(None)
        return (ri, rj, rl), rows

    num = np.zeros(m)
    den = np.zeros(m)
    for group in chosen:
        for lo in group:
            _, rows = slab(lo)
            for k, row in enumerate(rows):
                if row is not None:
                    num[k] += float(row[1].sum())
                    den[k] += float(row[2].sum())
    ratio = np.where(den > 0, num / np.where(den > 0, den, 1.0), 0.0)
    prod = np.zeros((m, 3, lags))
    pairs = np.zeros((m, 3, lags))
    sq = np.zeros(m)
    count = np.zeros(m)
    for group in chosen:
        tails: list[tuple[NDArray[np.float64], NDArray[np.bool_]] | None] = [None] * m
        for lo in group:
            (ri, rj, rl), rows = slab(lo)
            hi = min(nh, lo + planes)
            for k, row in enumerate(rows):
                field_ = np.zeros((hi - lo, nk, nl))
                have = np.zeros((hi - lo, nk, nl), dtype=bool)
                if row is not None:
                    tw, d, nu = row
                    u = d - ratio[k] * nu
                    field_[ri[tw] - lo, rj[tw], rl[tw]] = u
                    have[ri[tw] - lo, rj[tw], rl[tw]] = True
                    sq[k] += float(np.dot(u, u))
                    count[k] += u.size
                for axis in (1, 2):
                    for lag in range(1, min(lags, field_.shape[axis] - 1) + 1):
                        a = [slice(None)] * 3
                        b = [slice(None)] * 3
                        a[axis] = slice(0, -lag)
                        b[axis] = slice(lag, None)
                        prod[k, axis, lag - 1] += float(
                            (field_[tuple(a)] * field_[tuple(b)]).sum())
                        pairs[k, axis, lag - 1] += float(np.count_nonzero(
                            have[tuple(a)] & have[tuple(b)]))
                # Along H: the pairs whose second member is in this slab, the
                # first in it or in the planes carried from the slab before.
                tail = tails[k]
                f2 = field_ if tail is None else np.concatenate([tail[0], field_])
                h2 = have if tail is None else np.concatenate([tail[1], have])
                t0 = 0 if tail is None else tail[0].shape[0]
                for lag in range(1, lags + 1):
                    first = max(0, t0 - lag)
                    if first + lag >= f2.shape[0]:
                        break
                    prod[k, 0, lag - 1] += float((f2[first:-lag] * f2[first + lag:]).sum())
                    pairs[k, 0, lag - 1] += float(np.count_nonzero(h2[first:-lag]
                                                                   & h2[first + lag:]))
                tails[k] = (f2[-lags:].copy(), h2[-lags:].copy())
                del field_, have, f2, h2
    rho: list[list[list[float]]] = []
    past: list[list[bool]] = []
    for k in range(m):
        var = sq[k] / count[k] if count[k] > 0 else 0.0
        per_axis: list[list[float]] = []
        reach: list[bool] = []
        for axis in range(3):
            kept: list[float] = []
            measured = 0
            for lag in range(lags):
                n = pairs[k, axis, lag]
                if n < 2 or var <= 0:
                    break
                measured += 1
                r = prod[k, axis, lag] / n / var
                if r <= 2.0 / math.sqrt(n):
                    break
                kept.append(float(min(r, 1.0)))
            per_axis.append(kept)
            reach.append(measured > 0 and len(kept) == measured)
        rho.append(per_axis)
        past.append(reach)
    return rho, past


# ---------------------------------------------------------------------------
# The common subset: the voxels the lowest class can judge
# ---------------------------------------------------------------------------
def _mark_common(codes: NDArray[np.uint8], sym: GridSymmetry, *,
                 slab_voxels: int = 1 << 20) -> None:
    """Set the common-subset bits of *codes*, in place: ``_COMMON_ALL`` on each
    measured voxel whose orbit under *sym* (the lowest candidate class) holds
    another measured voxel, ``_COMMON_DIFFUSE`` on each diffuse one whose orbit
    holds another diffuse one.  A voxel every operation maps onto itself (the
    origin: every Laue class holds −1) has no equivalent under any class, so it
    is in no reading; it is marked too, which keeps the subset whole when
    every other voxel is.  A slab of H planes at a time."""
    nh, nk, nl = sym.shape
    planes = slab_planes(sym, slab_voxels)
    j = np.arange(nk, dtype=np.intp)[None, :, None]
    lk = np.arange(nl, dtype=np.intp)[None, None, :]
    for lo in range(0, nh, planes):
        hi = min(nh, lo + planes)
        i = np.arange(lo, hi, dtype=np.intp)[:, None, None]
        own = codes[lo:hi]
        meas = (own & _MEASURED) != 0
        dif = meas & ((own & _BRAGG) == 0)
        other_all = np.zeros(own.shape, dtype=bool)
        other_dif = np.zeros(own.shape, dtype=bool)
        alone = np.ones(own.shape, dtype=bool)
        for r, t in sym.index_ops[1:]:
            si, sj, sl = (np.broadcast_to(x, own.shape) for x in _image(r, t, i, j, lk))
            moved = ~((si == i) & (sj == j) & (sl == lk))
            alone &= ~moved
            on = (si >= 0) & (si < nh) & (sj >= 0) & (sj < nk) & (sl >= 0) & (sl < nl) & moved
            img = codes[si[on], sj[on], sl[on]]
            m_img = (img & _MEASURED) != 0
            other_all[on] |= m_img
            other_dif[on] |= m_img & ((img & _BRAGG) == 0)
            del si, sj, sl, on, img, m_img, moved
        own |= (np.where(meas & (other_all | alone), _COMMON_ALL, 0)
                | np.where(dif & (other_dif | alone), _COMMON_DIFFUSE, 0)).astype(np.uint8)


# ---------------------------------------------------------------------------
# The reference: whole |Q| shells
# ---------------------------------------------------------------------------
def _isotropic_sums(
    vol: HKLVolume, masks: Sequence[_Mask], *, place: _Placement | None = None,
    slab_voxels: int = 1 << 20,
) -> tuple[list[_Sums], float]:
    """The sums behind R_int of whole |Q| shells on each of *masks* (every
    voxel pooled with the measured voxels at its |Q|: no symmetry, the most a
    class could pool), its noise floor and χ², per block of *place* too, and
    the shells' width (the grid's finest step in Q).  Two slab-wise passes;
    the shells are counted with :func:`~nebula3d.utils.counting.bincount`."""
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    axes = [np.asarray(a, dtype=np.float64) for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    steps = [abs(float(a[1] - a[0])) if a.size > 1 else 1.0 for a in axes]
    width = min(float(np.linalg.norm(ub[:, i])) * steps[i] for i in range(3))
    nh, nk, nl = vol.data.shape
    planes = max(1, int(slab_voxels) // max(1, nk * nl))
    data, sigma = vol.data, vol.sigma
    if sigma.shape != data.shape:
        sigma = np.broadcast_to(sigma, data.shape)
    jj = np.arange(nk, dtype=np.intp)[None, :, None]
    ll = np.arange(nl, dtype=np.intp)[None, None, :]

    def slab(lo: int) -> tuple[slice, NDArray[np.intp], NDArray[np.float64], NDArray[np.float64],
                               NDArray[np.bool_]]:
        hi = min(nh, lo + planes)
        q = q_magnitude_from_axes(axes[0][lo:hi], axes[1], axes[2], ub)
        v = data[lo:hi].astype(np.float64)
        finite = np.isfinite(v)
        var = np.square(sigma[lo:hi].astype(np.float64))
        var = np.where(np.isfinite(var), var, np.abs(np.where(finite, v, 0.0)))
        return slice(lo, hi), np.floor(q / width).astype(np.intp), v, var, finite

    nbin = int(math.floor(float(q_magnitude_from_axes(
        np.array([axes[0][0], axes[0][-1]]), np.array([axes[1][0], axes[1][-1]]),
        np.array([axes[2][0], axes[2][-1]]), ub).max()) / width)) + 2
    zeros = lambda: [np.zeros(nbin) for _ in masks]  # noqa: E731
    total, count, var2, wsum, wtotal, wcount = (zeros() for _ in range(6))
    for lo in range(0, nh, planes):
        sl, b, v, var, finite = slab(lo)
        weight = np.where(var > 0, 1.0 / np.where(var > 0, var, 1.0), 0.0)
        for m, mask in enumerate(masks):
            ok = mask[sl] & finite
            idx = b[ok]
            total[m] += bincount(idx, v[ok], minlength=nbin)[:nbin]
            count[m] += bincount(idx, minlength=nbin)[:nbin]
            var2[m] += bincount(idx, var[ok], minlength=nbin)[:nbin]
            wsum[m] += bincount(idx, weight[ok], minlength=nbin)[:nbin]
            wtotal[m] += bincount(idx, weight[ok] * v[ok], minlength=nbin)[:nbin]
            wcount[m] += bincount(idx, (weight[ok] > 0).astype(np.float64), minlength=nbin)[:nbin]
    means = [np.divide(t, c, out=np.zeros_like(t), where=c > 0) for t, c in zip(total, count)]
    wmeans = [np.divide(t, w, out=np.zeros_like(t), where=w > 0) for t, w in zip(wtotal, wsum)]
    dev, mag, noise, chi2 = (zeros() for _ in range(4))
    sums = _sums(len(masks), place)
    for lo in range(0, nh, planes):
        sl, b, v, var, finite = slab(lo)
        block = None
        if place is not None:
            ii = np.arange(sl.start, sl.stop, dtype=np.intp)[:, None, None]
            block = np.broadcast_to(place.of(ii, jj, ll), v.shape)
        for m, mask in enumerate(masks):
            ok = mask[sl] & finite
            idx = b[ok]
            n = count[m][idx]
            use = n >= 2
            idx, vv, n, vr = idx[use], v[ok][use], n[use], var[ok][use]
            d = np.abs(vv - means[m][idx])
            sd2 = vr * (1.0 - 2.0 / n) + var2[m][idx] / (n * n)
            nu = _MEAN_ABS_NORMAL * np.sqrt(np.maximum(sd2, 0.0))
            dev[m] += bincount(idx, d, minlength=nbin)[:nbin]
            mag[m] += bincount(idx, np.abs(vv), minlength=nbin)[:nbin]
            noise[m] += bincount(idx, nu, minlength=nbin)[:nbin]
            kw = vr > 0
            res = np.where(kw, vv - wmeans[m][idx], 0.0)
            chi2[m] += bincount(idx, res * res / np.where(kw, vr, 1.0), minlength=nbin)[:nbin]
            s = sums[m]
            if block is not None and s.block_dev is not None and s.block_noise is not None:
                bb = block[ok][use]
                s.block_dev += bincount(bb, d, minlength=s.block_dev.size)[:s.block_dev.size]
                s.block_noise += bincount(bb, nu, minlength=s.block_noise.size)[
                    :s.block_noise.size]
    for m in range(len(masks)):
        shells = count[m] >= 2
        if shells.any():  # the blocks' sums were filled voxel by voxel above
            sums[m].add_orbits(dev[m][shells], mag[m][shells], noise[m][shells],
                               count[m][shells], chi2=chi2[m][shells],
                               dof=np.maximum(wcount[m][shells] - 1.0, 0.0))
    return sums, width


# ---------------------------------------------------------------------------
# The spatial block bootstrap
# ---------------------------------------------------------------------------
def _bootstrap(series: Sequence[_Sums], *, replicates: int = REPLICATES,
               seed: int = BOOTSTRAP_SEED) -> tuple[NDArray[np.float64], int]:
    """The ratio Σd / Σν of every series on each of *replicates* resamples of
    the blocks, and the blocks resampled.

    The blocks that hold an orbit in any series are drawn with replacement, as
    many as there are, and every series is read on the same draws: a class
    and its subgroup, or a reading and its common subset, then vary together
    as the data make them, and the spread of their difference over the
    replicates is its standard error.  A replicate whose draws hold no noise
    floor gives NaN.  Seeded: the same volume gives the same numbers.
    """
    rows = [(s.block_dev, s.block_noise) for s in series
            if s.block_dev is not None and s.block_noise is not None]
    if not rows or len(rows) != len(series):
        return np.full((len(series), replicates), np.nan), 0
    dev = np.stack([r[0] for r in rows])
    noise = np.stack([r[1] for r in rows])
    used = (noise != 0).any(axis=0) | (dev != 0).any(axis=0)
    dev, noise = dev[:, used], noise[:, used]
    n = int(dev.shape[1])
    out = np.full((len(series), replicates), np.nan)
    if n == 0:
        return out, 0
    rng = np.random.default_rng(seed)
    chunk = max(1, min(replicates, (1 << 18) // max(n, 1)))  # weights of a few MB at most
    for lo in range(0, replicates, chunk):
        hi = min(replicates, lo + chunk)
        weights = np.empty((hi - lo, n))
        for r in range(hi - lo):
            weights[r] = bincount(rng.integers(0, n, size=n), minlength=n)[:n]
        num = weights @ dev.T
        den = weights @ noise.T
        with np.errstate(divide="ignore", invalid="ignore"):
            out[:, lo:hi] = np.where(den > 0, num / np.where(den > 0, den, 1.0), np.nan).T
    return out, n


def _spread(x: NDArray[np.float64] | None) -> float | None:
    """The standard deviation of the finite replicates, ``None`` with fewer than two."""
    if x is None:
        return None
    ok = x[np.isfinite(x)]
    return float(np.std(ok, ddof=1)) if ok.size >= 2 else None


def _effective_blocks(s: _Sums) -> float | None:
    """Kish's effective number of blocks: (Σ ν_b)² / Σ ν_b², blocks weighed by
    the noise floor they hold (equal blocks give their count)."""
    if s.block_noise is None:
        return None
    w = s.block_noise
    sq = float(np.dot(w, w))
    return float(w.sum()) ** 2 / sq if sq > 0 else None


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------
def _rises(r: Reading, ref: Reading, delta: float,
           z: float) -> tuple[bool, float | None, float | None]:
    """Whether *r*'s ratio rises against *ref*'s by the rule, the rise, and the
    standard error of the excess ρ − (1 + δ)·ρ_ref.

    The error is the excess's spread over the bootstrap's replicates of both
    ratios (the same resamples), at most the reference's own spread there
    (``SE_CAP``): where the class's extra operations hold, the two ratios read
    the same voxels and the same noise, and the excess varies less than the
    reference does (about half, on correlated noise); a larger spread comes
    from where they fail, the uneven reach of a real breaking over the
    coverage (textured powder rings, rods), which is no noise and would
    otherwise let a breaking above the tolerance through.  Without
    replicates, *r*'s own standard error."""
    if r.ratio is None or ref.ratio is None or ref.ratio <= 0:
        return False, None, None
    rise = r.ratio / ref.ratio
    excess = r.ratio - (1.0 + delta) * ref.ratio
    se: float | None = None
    if r.replicates is not None and ref.replicates is not None:
        se = _spread(r.replicates - (1.0 + delta) * ref.replicates)
        cap = _spread(ref.replicates) if SE_CAP else None
        if se is not None and cap is not None:
            se = min(se, cap)
    if se is None:
        se = r.ratio_se
    return bool(excess > 0 and excess > z * (se or 0.0)), rise, se


def judge(candidates: Sequence[Candidate], reading: str, delta: float = DELTA,
          z: float = Z) -> dict[str, Verdict]:
    """The rule on one reading ("all", "diffuse", "common_all" or
    "common_diffuse"): each candidate's verdict, smallest classes first, so a
    subgroup is judged before the classes above it."""
    by = {c.label: c for c in candidates}
    out: dict[str, Verdict] = {}
    for c in sorted(candidates, key=lambda d: d.order):
        r = getattr(c, reading)
        if r is None or r.ratio is None:
            out[c.label] = Verdict(False, False, None, None, judged=False)
            continue
        subs = [by[s] for s in c.subgroups if getattr(by[s], reading) is not None
                and getattr(by[s], reading).ratio is not None]
        if not subs:
            out[c.label] = Verdict(True, False, None, None)
            continue
        best = min(subs, key=lambda d: getattr(d, reading).ratio)
        rises, rise, se = _rises(r, getattr(best, reading), delta, z)
        inherited = any(not out[s.label].supported for s in subs)
        out[c.label] = Verdict(not rises and not inherited, rises, best.label, rise, se=se)
    return out


def _tells_apart(candidates: Sequence[Candidate], iso: Reading, reading: str,
                 delta: float, z: float) -> tuple[bool, float | None, str | None]:
    """Whether a reading can prefer a class at all: pooling whole |Q| shells
    must rise against its lowest candidate by the rule.  With the rise, and
    why not when it cannot judge."""
    rs = [getattr(c, reading) for c in candidates]
    if not rs or any(r is None or r.ratio is None for r in rs):
        return False, None, "a class has no orbit measured twice, or no noise floor (σ)"
    if iso.ratio is None:
        return False, None, "no |Q| shell holds two measured voxels"
    lowest = min(rs, key=lambda r: r.ratio)
    rises, rise, _ = _rises(iso, lowest, delta, z)
    return rises, rise, None


def _fmt(x: float | None) -> str:
    """A ratio or a rise as the reasons write it: two decimals."""
    return "–" if x is None else f"{x:.2f}"


def _pick(cands: Sequence[Candidate], used: Sequence[str]) -> Candidate | None:
    """The supported class with the most operations in every reading of
    *used* (ties: the lower ratio on every measured voxel)."""
    both = [c for c in cands if all(getattr(c, f"verdict_{r}").supported for r in used)]
    return max(both, key=lambda c: (c.order, -(c.all.ratio if c.all and c.all.ratio else 0.0)),
               default=None)


def _suggest(cmp: LaueComparison) -> None:
    """Apply the rule to both readings and write the suggestion, its reason,
    the disagreement flag and the per-reading verdicts into *cmp*."""
    cands = cmp.candidates
    used: list[str] = []
    for reading in READINGS:
        verdicts = judge(cands, reading, cmp.delta, cmp.z)
        for c in cands:
            setattr(c, f"verdict_{reading}", verdicts[c.label])
        apart, rise, why = _tells_apart(cands, cmp.isotropic[reading], reading, cmp.delta, cmp.z)
        supported = [c for c in cands if verdicts[c.label].supported]
        best = max(supported, key=lambda c: (c.order, -(getattr(c, reading).ratio or 0.0)),
                   default=None)
        cmp.readings[reading] = {"tells_apart": apart, "isotropic_rise": rise,
                                 "cannot_judge": why,
                                 "suggests": best.label if best is not None and apart else None}
        cmp.suggested_by[reading] = best.label if best is not None and apart else None
        if apart:
            used.append(reading)
    if not cands:
        cmp.reason = "No Laue class is a candidate: every class was refused (see refused)."
        return
    if not used:
        lo = [c.all.ratio for c in cands if c.all is not None and c.all.ratio is not None]
        span = (f" (R_int / noise floor {min(lo):.2f}–{max(lo):.2f})" if lo else "")
        iso = cmp.readings["all"]["isotropic_rise"]
        cmp.reason = (
            "No meaningful preference: pooling whole |Q| shells, which no class can exceed, "
            f"raises R_int only {_fmt(iso)}× over the lowest class's in units of the noise "
            f"floor{span}, within the counting noise, so the data cannot tell the classes apart.")
        return
    pick = _pick(cands, used)
    assert pick is not None  # the lowest class is supported in every reading
    cmp.suggestion = pick.label
    reading = used[0] if len(used) == 1 else "all"
    v = getattr(pick, f"verdict_{reading}")
    if v.against is not None:
        within = (f"its R_int, in units of the noise floor, is {_fmt(v.rise)}× that of "
                  f"{v.against}, the subgroup that agrees best")
    else:
        within = "it is the lowest class compared"
    above = [c for c in cands if pick.label in c.subgroups
             and any(getattr(c, f"verdict_{r}").rises for r in used)]
    risen = ""
    if above:
        first = min(above, key=lambda c: c.order)
        r_by = next(r for r in used if getattr(first, f"verdict_{r}").rises)
        fv = getattr(first, f"verdict_{r_by}")
        risen = (f"; {first.label} rose {_fmt(fv.rise)}× against {fv.against}"
                 f"{' on the diffuse' if r_by == 'diffuse' else ''}")
    which = ("in both readings" if len(used) == 2
             else "on every measured voxel" if used == ["all"] else "on the diffuse")
    cmp.reason = (f"{pick.label} is the class with the most operations the rule supports "
                  f"{which}: {within}{risen}.")
    if len(used) == 1:
        other = "diffuse" if used == ["all"] else "all"
        why = cmp.readings[other]["cannot_judge"]
        cmp.notes.append(
            f"The {'diffuse' if other == 'diffuse' else 'full'} reading cannot tell the classes "
            "apart" + (f" ({why})" if why else
                       ": every class agrees there within the counting noise") + ".")
    s_all, s_dif = cmp.suggested_by.get("all"), cmp.suggested_by.get("diffuse")
    if len(used) == 2 and s_all and s_dif and s_all != s_dif:
        a, d = cmp.candidate(s_all), cmp.candidate(s_dif)
        if d.order < a.order:
            cmp.disagreement = (
                f"The diffuse alone supports only {d.label} where every measured voxel supports "
                f"{a.label}: the Bragg peaks dominate the full reading, and averaging over "
                f"{a.label} would impose their symmetry on the diffuse.")
        elif a.order < d.order:
            cmp.notes.append(
                f"Every measured voxel supports only {a.label} where the diffuse supports "
                f"{d.label}: the Bragg peaks break the higher symmetry (or carry errors such "
                "as extinction or absorption that the diffuse does not).")


def _common_flag(cmp: LaueComparison, lowest: Candidate | None, voxels: int) -> None:
    """The common-subset diagnostic: the rule again on each class's readings
    restricted to the voxels the lowest class can judge, among the classes
    judged there; flagged when its suggestion differs from the main
    readings' on the same classes."""
    cands = cmp.candidates
    for reading in COMMON:
        verdicts = judge(cands, reading, cmp.delta, cmp.z)
        for c in cands:
            setattr(c, f"verdict_{reading}", verdicts[c.label])
    share = voxels / cmp.measured if cmp.measured else None
    cmp.common = {"lowest": None if lowest is None else lowest.label, "voxels": voxels,
                  "share": share, "suggestion": None, "main": None, "flag": None}
    used = [r for r in READINGS if cmp.readings.get(r, {}).get("tells_apart")]
    if lowest is None or cmp.suggestion is None or not used:
        return
    seen = [c for c in cands if all(getattr(c, f"verdict_common_{r}").judged for r in used)]
    main = _pick(seen, used)
    common = _pick(seen, [f"common_{r}" for r in used])
    cmp.common["main"] = None if main is None else main.label
    cmp.common["suggestion"] = None if common is None else common.label
    if main is None or common is None or main.label == common.label:
        return
    pct = "" if share is None else f" ({100 * share:.0f}% of the measured voxels)"
    if common.order > main.order:
        cmp.common["flag"] = (
            f"On the voxels {lowest.label} can judge{pct} the rule supports {common.label}, where "
            f"every measured voxel supports only {main.label}: the voxels only a higher class "
            "compares reject it. Errors that differ between regions of the coverage (absorption, "
            "detector or coverage edges) do that, and so does a breaking seen only there.")
    else:
        cmp.common["flag"] = (
            f"On the voxels {lowest.label} can judge{pct} the rule supports only {common.label}, "
            f"where every measured voxel supports {main.label}: the voxels only a higher class "
            "compares agree better than the rest, a sign of errors that differ between regions "
            "of the coverage.")


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------
def _codes(vol: HKLVolume, bragg: NDArray[np.bool_]) -> NDArray[np.uint8]:
    """The voxel classes as bits (``_MEASURED``, ``_BRAGG``), slab by slab."""
    codes = np.zeros(vol.data.shape, dtype=np.uint8)
    measured = vol.mask
    for lo in range(0, vol.data.shape[0], 64):
        sl = slice(lo, lo + 64)
        m = measured[sl] & np.isfinite(vol.data[sl])
        codes[sl] = np.where(m, _MEASURED, 0).astype(np.uint8) | np.where(
            bragg[sl], _BRAGG, 0).astype(np.uint8)
    return codes


def _count(codes: NDArray[np.uint8], on: int, off: int = 0) -> int:
    care = np.uint8(on | off)
    return sum(int(np.count_nonzero((codes[lo:lo + 64] & care) == on))
               for lo in range(0, codes.shape[0], 64))


def compare_laue_classes(
    vol: HKLVolume, *, cell: Sequence[int] = (1, 1, 1), bragg_radius_q: float | None = None,
    origin_radius_q: float | None = None, punch: PunchParams | None = None,
    delta: float = DELTA, z: float = Z, extra: Sequence[str] = (), slab_voxels: int = 1 << 20,
    replicates: int = REPLICATES, seed: int = BOOTSTRAP_SEED,
    progress: ProgressFn | None = None,
) -> LaueComparison:
    """Compare every candidate Laue class of *vol* by R_int, and suggest one.

    *vol* is what the symmetry average would read: the raw input with its
    coverage edge trimmed (:func:`nebula3d.pipeline.load_input`); it is not
    changed.  The Bragg nodes are the multiples of *cell* (the punch's cell),
    masked within *bragg_radius_q* (Å⁻¹; by default from *punch*'s settings,
    :func:`bragg_radius_from_punch`) for the diffuse reading.  *extra* adds
    classes beyond the presets (the user's custom generators).  *progress*
    gets ``(fraction, message)``.  The block edge comes from the residuals'
    autocorrelation on the lowest class (:func:`_autocorrelation`,
    :func:`_block_edge`); then one slab-wise pass per candidate, all four
    readings at once (:func:`_class_sums`), and the bootstrap's *replicates*
    from *seed* (:func:`_bootstrap`).  One byte a voxel holds every reading's
    mask; nothing else the size of the volume stays.
    """
    done = [0.0]

    def emit(fraction: float, message: str) -> None:
        # Never backwards, also where two steps' sums round apart.
        done[0] = max(done[0], max(0.0, min(1.0, fraction)))
        if progress is not None:
            progress(done[0], message)

    candidates, refused = laue_candidates(vol, extra)
    node_r, origin_r, source = bragg_radius_from_punch(punch)
    if bragg_radius_q is not None:
        node_r, source = float(bragg_radius_q), "as asked"
        origin_r = max(node_r, float(origin_radius_q) if origin_radius_q is not None
                       else origin_r)
    elif origin_radius_q is not None:
        origin_r = max(node_r, float(origin_radius_q))
    largest = _largest_group(candidates, vol)
    steps = len(candidates) + 2
    emit(0.0, "masking the Bragg nodes")
    # The Bragg mask is closed under the largest group in the same pass that
    # places every voxel's orbit for the bootstrap (_close_and_place).
    bragg, used_r = bragg_neighbourhood(vol, cell, node_r, origin_r, slab_voxels=slab_voxels)
    codes = _codes(vol, bragg)
    del bragg
    lstar = None if largest is None else _close_and_place(codes, largest,
                                                          slab_voxels=slab_voxels)
    lowest = candidates[0] if candidates else None
    if lowest is not None and lowest.sym is not None:
        _mark_common(codes, lowest.sym, slab_voxels=slab_voxels)
    n_measured = _count(codes, _MEASURED)
    n_bragg = _count(codes, _MEASURED | _BRAGG)
    n_common = _count(codes, _MEASURED | _COMMON_ALL)
    n_common_diffuse = _count(codes, _MEASURED | _COMMON_DIFFUSE, _BRAGG)
    gather = _Gather(codes)
    main = (_Bits(gather, _MEASURED), _Bits(gather, _MEASURED, _BRAGG))
    # Where the lowest class judges every measured voxel (and every diffuse
    # one), the common subset is the whole and its readings are the main ones.
    whole = n_common == n_measured and n_common_diffuse == n_measured - n_bragg
    masks = main if whole else (*main, _Bits(gather, _MEASURED | _COMMON_ALL),
                                _Bits(gather, _MEASURED | _COMMON_DIFFUSE, _BRAGG))

    emit(0.3 / steps, "the residuals' correlation length")
    rho: list[list[list[float]]] = [[[], [], []]]
    past: list[list[bool]] = [[False, False, False]]
    if lowest is not None and lowest.sym is not None:
        rho, past = _autocorrelation(vol, lowest.sym, main, slab_voxels=slab_voxels)
    # The longer of the two readings' correlations sets the blocks.
    order = 1 if largest is None else largest.order
    edges = [_block_edge(r, any(p), vol.data.size, order) for r, p in zip(rho, past)]
    k_edge = max(range(len(edges)), key=lambda k: edges[k])
    wanted = edge = edges[k_edge]
    grid = (int(vol.data.shape[0]), int(vol.data.shape[1]), int(vol.data.shape[2]))
    place = _Placement.make(_Blocks(edge, grid), lstar, largest)
    while place.count < MIN_BLOCKS and edge > 1:
        edge -= 1
        place = _Placement.make(_Blocks(edge, grid), lstar, largest)
    kept = _variance_kept(rho[k_edge], edge)
    edge_notes = [] if edge == wanted else [
        f"The bootstrap's blocks were cut to {edge} voxels (the correlation asks for {wanted}) "
        f"to keep {MIN_BLOCKS} of them" + (
            "." if kept >= VARIANCE_KEPT else
            f": they keep {100 * kept:.0f}% of a block's variance, so the standard errors are "
            f"low by up to {100 * (1 - math.sqrt(kept)):.0f}%.")]

    # orbit_terms holds about a dozen float64 arrays a mask per representative
    # of a slab: smaller slabs for more masks (and χ²) keep the slab's peak
    # where two masks without χ² had it (the browser's heap).
    pass_voxels = max(1, (2 * slab_voxels) // (len(masks) + 1))

    emit(0.7 / steps, "the |Q|-shell reference")
    iso, width = _isotropic_sums(vol, main, place=place, slab_voxels=slab_voxels)
    sums: list[list[_Sums]] = []
    for i, c in enumerate(candidates):
        assert c.sym is not None
        base = (i + 1) / steps

        def tick(f: float, label: str = c.label, base: float = base) -> None:
            emit(base + f / steps, f"R_int over {label}")

        tick(0.0)
        sums.append(_class_sums(vol, c.sym, masks, place=place, slab_voxels=pass_voxels,
                                progress=tick))
    del codes, gather, masks, main, place, lstar

    emit((len(candidates) + 1) / steps, "the block bootstrap")
    per_class = 2 if whole else 4
    series = [*iso] + [s for per in sums for s in per]
    reps, n_blocks = _bootstrap(series, replicates=replicates, seed=seed)

    def finish(s: _Sums, row: NDArray[np.float64]) -> Reading:
        r = s.reading()
        if r.ratio is None:
            return r
        se = _spread(row)
        return replace(r, ratio_se=se if se is not None else r.ratio_se, replicates=row)

    iso_readings = [finish(s, reps[k]) for k, s in enumerate(iso)]
    for i, c in enumerate(candidates):
        rows = reps[len(iso) + per_class * i: len(iso) + per_class * (i + 1)]
        read = [finish(s, row) for s, row in zip(sums[i], rows)]
        c.all, c.diffuse = read[0], read[1]
        c.common_all, c.common_diffuse = (read[0], read[1]) if whole else (read[2], read[3])
    eff = _effective_blocks(sums[0][0]) if sums else None
    ell = [float(sum(r)) for r in rho[k_edge]]
    cmp = LaueComparison(
        candidates=candidates, refused=refused,
        isotropic={"all": iso_readings[0], "diffuse": iso_readings[1]},
        bragg={"cell": [int(x) for x in cell], "radius_q": used_r, "asked_q": node_r,
               "origin_radius_q": max(used_r, origin_r), "from": source,
               "closed_under": None if largest is None else group_label(largest.ops),
               "voxels": n_bragg, "share": (n_bragg / n_measured) if n_measured else None,
               "shell_width_q": width},
        measured=n_measured, sigma_estimated=bool(vol.sigma_estimated), delta=delta, z=z,
        bootstrap={"replicates": int(replicates), "seed": int(seed), "block_voxels": int(edge),
                   "blocks": int(n_blocks),
                   "effective_blocks": None if eff is None else round(eff, 1),
                   "correlation_voxels": [round(x, 2) for x in ell],
                   "correlation_reading": READINGS[k_edge] if k_edge < len(READINGS) else None,
                   "reaches_past": bool(any(past[k_edge])),
                   "variance_kept": round(kept, 3)})
    cmp.notes.extend(edge_notes)
    if any(past[k_edge]):
        cmp.notes.append(
            f"The residuals stay correlated past {CORR_LAGS} voxels: the bootstrap's blocks are "
            f"{edge} voxels, and correlations longer than that make its standard errors low.")
    if 0 < n_blocks < MIN_BLOCKS:
        cmp.notes.append(f"The bootstrap resampled only {n_blocks} blocks: its standard errors "
                         "are rough.")
    if used_r < node_r:
        cmp.notes.append(
            f"The Bragg radius was capped at {used_r:.3g} Å⁻¹ (asked {node_r:.3g}): beyond it a "
            "voxel's nearest node is no longer its rounded index on this cell.")
    if _ub_unknown(vol):
        cmp.notes.append("No UB: the metric is not checked, and |Q| is in r.l.u.")
    if vol.sigma_estimated:
        cmp.notes.append(
            "σ was estimated (√|I|): the noise floor and χ² are only as right as that estimate, "
            "and the ratios compare classes by their orbits' sizes rather than by counting noise.")
    _suggest(cmp)
    _common_flag(cmp, lowest, n_common)
    emit(1.0, "done")
    return cmp
