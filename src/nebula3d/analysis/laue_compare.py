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
ratio ρ = R_int / noise floor.  The rule (:func:`judge`):

- a candidate *rises* against a subgroup when its ρ exceeds the subgroup's by
  more than :data:`DELTA` (10 %) and by more than :data:`Z` standard errors;
- it is *supported* when it rises against none of its candidate subgroups and
  every one of them is supported;
- a reading *tells the classes apart* only when pooling whole |Q| shells (no
  symmetry at all, the most a class could pool) rises against the lowest
  candidate by the same test: else every class agrees within the noise and
  the data cannot prefer one;
- the suggestion is the supported candidate with the most operations in
  every reading that tells the classes apart.  It is a suggestion: the class
  is the user's to declare.

Twinning or several domains related by an operation the sample lacks make a
lower symmetry look higher, and R_int alone cannot tell them apart.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from nebula3d.core import HKLVolume, q_magnitude_from_axes
from nebula3d.symmetry import (
    LAUE_PRESETS,
    METRIC_TOLERANCE,
    GridSymmetry,
    LaueGroup,
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
    "DELTA",
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

#: ... and by more than this many standard errors of its ratio, so a small
#: volume's noise does not reject a class.
Z = 2.0

ProgressFn = Callable[[float, str], None]

_MEAN_ABS_NORMAL = math.sqrt(2.0 / math.pi)


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
    one over the other and ``ratio_se`` its standard error over orbits.
    ``None`` without such an orbit (or, for the noise floor and the ratio,
    without a σ above 0)."""

    r_int: float | None
    noise: float | None
    ratio: float | None
    ratio_se: float | None
    orbits: int
    voxels: int
    pairs: int

    def to_dict(self) -> dict[str, Any]:
        return {"r_int": self.r_int, "noise": self.noise, "ratio": self.ratio,
                "ratio_se": self.ratio_se, "orbits": self.orbits, "voxels": self.voxels,
                "pairs": self.pairs}


@dataclass(frozen=True)
class Verdict:
    """What the rule made of one candidate in one reading: ``supported``, and
    the subgroup it was weighed against (``against``, the candidate subgroup
    with the lowest ratio) with its ``rise`` (the ratio over that one's);
    ``rises`` when the rise itself fails the rule (not merely a subgroup's
    failure inherited), ``judged`` False when the reading cannot judge it."""

    supported: bool
    rises: bool
    against: str | None
    rise: float | None
    judged: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {"supported": self.supported, "rises": self.rises, "against": self.against,
                "rise": self.rise, "judged": self.judged}


@dataclass
class Candidate:
    """A Laue class the metric allows and the grid takes: its group, how much
    its operations change the cell's metric (``None`` without a UB), its
    candidate subgroups (all, and the maximal ones: the chain the table
    draws, ``depth`` the longest chain below it) and its two readings with
    their verdicts."""

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
    verdict_all: Verdict | None = None
    verdict_diffuse: Verdict | None = None

    @property
    def order(self) -> int:
        return self.group.order

    def to_dict(self) -> dict[str, Any]:
        return {
            "laue": self.label, "generators": self.generators, "order": self.order,
            "ops": self.group.ops_text, "metric_change": self.metric_change,
            "subgroups": list(self.subgroups), "maximal_subgroups": list(self.maximal),
            "depth": self.depth,
            "all": None if self.all is None else self.all.to_dict(),
            "diffuse": None if self.diffuse is None else self.diffuse.to_dict(),
            "verdict": {
                "all": None if self.verdict_all is None else self.verdict_all.to_dict(),
                "diffuse": None if self.verdict_diffuse is None else self.verdict_diffuse.to_dict(),
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
    shells), the Bragg neighbourhood masked for the diffuse reading, the rule
    and what it suggests.  :meth:`to_dict` is the API's payload."""

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
            "limits": LIMITS,
        }


#: What R_int cannot tell (the result carries it, and the docs).
LIMITS = (
    "Twinning or several domains related by an operation the sample lacks make a lower "
    "symmetry look higher: the domains' sum has the higher symmetry, and R_int alone cannot "
    "tell them apart. Only the presets' settings are compared (the four-fold along c, the "
    "two-fold along b or c); a sample with its unique axis elsewhere needs custom generators. "
    "The diffuse reading masks a sphere around each Bragg node, not the punch itself.")


def rule_text(delta: float = DELTA, z: float = Z) -> str:
    """The rule in one paragraph, with its numbers."""
    return (
        f"Each class's R_int is read in units of its noise floor (the R_int counting noise "
        f"alone gives on the same orbits, from σ). A class rises against a subgroup when that "
        f"ratio exceeds the subgroup's by more than {100 * delta:.0f}% and by more than "
        f"{z:g} standard errors; it is supported when it rises against none of its candidate "
        f"subgroups and all of them are supported. A reading tells the classes apart only when "
        f"pooling whole |Q| shells rises against the lowest class by the same test. The "
        f"suggestion is the supported class with the most operations in every reading that "
        f"tells them apart.")


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
# R_int of one class, both readings, in one slab-wise pass
# ---------------------------------------------------------------------------
@dataclass
class _Sums:
    """Running sums of one reading over the slabs."""

    dev: float = 0.0
    mag: float = 0.0
    noise: float = 0.0
    orbits: int = 0
    voxels: int = 0
    pairs: int = 0
    # Over orbits, for the ratio's standard error: d = Σ|I − ⟨I⟩| and
    # ν = the noise floor's numerator, per orbit.
    dd: float = 0.0
    dn: float = 0.0
    nn: float = 0.0

    def add_orbits(self, d: NDArray[np.float64], a: NDArray[np.float64],
                   nu: NDArray[np.float64], members: NDArray[np.float64]) -> None:
        self.dev += float(d.sum())
        self.mag += float(a.sum())
        self.noise += float(nu.sum())
        self.orbits += int(d.size)
        self.voxels += int(np.rint(members.sum()))
        self.pairs += int(np.rint((members * (members - 1.0) / 2.0).sum()))
        self.dd += float(np.dot(d, d))
        self.dn += float(np.dot(d, nu))
        self.nn += float(np.dot(nu, nu))

    def reading(self) -> Reading:
        if self.orbits == 0 or self.mag <= 0:
            return Reading(None, None, None, None, self.orbits, self.voxels, self.pairs)
        r_int = self.dev / self.mag
        if self.noise <= 0:
            return Reading(r_int, None, None, None, self.orbits, self.voxels, self.pairs)
        ratio = self.dev / self.noise
        var = max(0.0, self.dd - 2.0 * ratio * self.dn + ratio * ratio * self.nn)
        return Reading(r_int, self.noise / self.mag, ratio, math.sqrt(var) / self.noise,
                       self.orbits, self.voxels, self.pairs)


def _class_readings(
    vol: HKLVolume, sym: GridSymmetry, masks: tuple[NDArray[np.bool_], ...], *,
    slab_voxels: int = 1 << 20, progress: Callable[[float], None] | None = None,
) -> list[Reading]:
    """R_int of the class *sym* on each of *masks*, with its noise floor:
    :func:`~nebula3d.symmetry.orbit_terms` (the symmetry average's own pass),
    a slab of H planes at a time."""
    data, sigma = vol.data, vol.sigma
    if sigma.shape != data.shape:
        sigma = np.broadcast_to(sigma, data.shape)
    sums = [_Sums() for _ in masks]
    nh = sym.shape[0]
    planes = slab_planes(sym, slab_voxels)
    for lo in range(0, nh, planes):
        ri, rj, rl = slab_orbits(sym, lo, min(nh, lo + planes))
        if ri.size:
            stab, terms = orbit_terms(data, masks, sym, ri, rj, rl, sigma=sigma,
                                      sigma_unknown_abs=True, noise=True)
            for s, t in zip(sums, terms):
                tw = t.twice
                if not tw.any() or t.dev is None or t.mag is None:
                    continue
                st = stab[tw].astype(np.float64)
                nu = (t.noise[tw] / st) if t.noise is not None else np.zeros(int(tw.sum()))
                s.add_orbits(t.dev[tw] / st, t.mag[tw] / st, nu, t.count[tw] / st)
            del stab, terms
        if progress is not None:
            progress(min(1.0, (lo + planes) / nh))
    return [s.reading() for s in sums]


def _isotropic_readings(
    vol: HKLVolume, masks: tuple[NDArray[np.bool_], ...], *, slab_voxels: int = 1 << 20,
) -> tuple[list[Reading], float]:
    """R_int of whole |Q| shells on each of *masks* (every voxel pooled with
    the measured voxels at its |Q|: no symmetry, the most a class could
    pool), with its noise floor, and the shells' width (the grid's finest
    step in Q).  Two slab-wise passes; the shells are counted with
    :func:`~nebula3d.utils.counting.bincount`."""
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    axes = [np.asarray(a, dtype=np.float64) for a in (vol.h_axis, vol.k_axis, vol.l_axis)]
    steps = [abs(float(a[1] - a[0])) if a.size > 1 else 1.0 for a in axes]
    width = min(float(np.linalg.norm(ub[:, i])) * steps[i] for i in range(3))
    nh, nk, nl = vol.data.shape
    planes = max(1, int(slab_voxels) // max(1, nk * nl))
    data, sigma = vol.data, vol.sigma
    if sigma.shape != data.shape:
        sigma = np.broadcast_to(sigma, data.shape)

    def slab(lo: int) -> tuple[slice, NDArray[np.intp]]:
        hi = min(nh, lo + planes)
        q = q_magnitude_from_axes(axes[0][lo:hi], axes[1], axes[2], ub)
        return slice(lo, hi), np.floor(q / width).astype(np.intp)

    nbin = int(math.floor(float(q_magnitude_from_axes(
        np.array([axes[0][0], axes[0][-1]]), np.array([axes[1][0], axes[1][-1]]),
        np.array([axes[2][0], axes[2][-1]]), ub).max()) / width)) + 2
    total = [np.zeros(nbin) for _ in masks]
    count = [np.zeros(nbin) for _ in masks]
    var2 = [np.zeros(nbin) for _ in masks]
    for lo in range(0, nh, planes):
        sl, b = slab(lo)
        v = data[sl].astype(np.float64)
        finite = np.isfinite(v)
        var = np.square(sigma[sl].astype(np.float64))
        var = np.where(np.isfinite(var), var, np.abs(np.where(finite, v, 0.0)))
        for m, mask in enumerate(masks):
            ok = mask[sl] & finite
            idx = b[ok]
            total[m] += bincount(idx, v[ok], minlength=nbin)[:nbin]
            count[m] += bincount(idx, minlength=nbin)[:nbin]
            var2[m] += bincount(idx, var[ok], minlength=nbin)[:nbin]
    means = [np.divide(t, c, out=np.zeros_like(t), where=c > 0) for t, c in zip(total, count)]
    dev = [np.zeros(nbin) for _ in masks]
    mag = [np.zeros(nbin) for _ in masks]
    noise = [np.zeros(nbin) for _ in masks]
    for lo in range(0, nh, planes):
        sl, b = slab(lo)
        v = data[sl].astype(np.float64)
        finite = np.isfinite(v)
        var = np.square(sigma[sl].astype(np.float64))
        var = np.where(np.isfinite(var), var, np.abs(np.where(finite, v, 0.0)))
        for m, mask in enumerate(masks):
            ok = mask[sl] & finite
            idx = b[ok]
            n = count[m][idx]
            use = n >= 2
            idx, vv, n, vr = idx[use], v[ok][use], n[use], var[ok][use]
            dev[m] += bincount(idx, np.abs(vv - means[m][idx]), minlength=nbin)[:nbin]
            mag[m] += bincount(idx, np.abs(vv), minlength=nbin)[:nbin]
            sd2 = vr * (1.0 - 2.0 / n) + var2[m][idx] / (n * n)
            noise[m] += bincount(idx, _MEAN_ABS_NORMAL * np.sqrt(np.maximum(sd2, 0.0)),
                                 minlength=nbin)[:nbin]
    out = []
    for m in range(len(masks)):
        s = _Sums()
        shells = count[m] >= 2
        if shells.any():
            s.add_orbits(dev[m][shells], mag[m][shells], noise[m][shells], count[m][shells])
        out.append(s.reading())
    return out, width


# ---------------------------------------------------------------------------
# The rule
# ---------------------------------------------------------------------------
def _rises(r: Reading, ref: Reading, delta: float, z: float) -> tuple[bool, float | None]:
    """Whether *r*'s ratio rises against *ref*'s by the rule, and the rise."""
    if r.ratio is None or ref.ratio is None or ref.ratio <= 0:
        return False, None
    rise = r.ratio / ref.ratio
    excess = r.ratio - (1.0 + delta) * ref.ratio
    return bool(excess > 0 and excess > z * (r.ratio_se or 0.0)), rise


def judge(candidates: Sequence[Candidate], reading: str, delta: float = DELTA,
          z: float = Z) -> dict[str, Verdict]:
    """The rule on one reading ("all" or "diffuse"): each candidate's
    verdict, smallest classes first, so a subgroup is judged before the
    classes above it."""
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
        rises, rise = _rises(r, getattr(best, reading), delta, z)
        inherited = any(not out[s.label].supported for s in subs)
        out[c.label] = Verdict(not rises and not inherited, rises, best.label, rise)
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
    rises, rise = _rises(iso, lowest, delta, z)
    return rises, rise, None


def _fmt(x: float | None) -> str:
    """A ratio or a rise as the reasons write it: two decimals."""
    return "–" if x is None else f"{x:.2f}"


def _suggest(cmp: LaueComparison) -> None:
    """Apply the rule to both readings and write the suggestion, its reason,
    the disagreement flag and the per-reading verdicts into *cmp*."""
    cands = cmp.candidates
    used: list[str] = []
    for reading in ("all", "diffuse"):
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
    both = [c for c in cands
            if all(getattr(c, f"verdict_{r}").supported for r in used)]
    pick = max(both, key=lambda c: (c.order, -(c.all.ratio if c.all and c.all.ratio else 0.0)))
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


# ---------------------------------------------------------------------------
# The comparison
# ---------------------------------------------------------------------------
def compare_laue_classes(
    vol: HKLVolume, *, cell: Sequence[int] = (1, 1, 1), bragg_radius_q: float | None = None,
    origin_radius_q: float | None = None, punch: PunchParams | None = None,
    delta: float = DELTA, z: float = Z, extra: Sequence[str] = (), slab_voxels: int = 1 << 20,
    progress: ProgressFn | None = None,
) -> LaueComparison:
    """Compare every candidate Laue class of *vol* by R_int, and suggest one.

    *vol* is what the symmetry average would read: the raw input with its
    coverage edge trimmed (:func:`nebula3d.pipeline.load_input`); it is not
    changed.  The Bragg nodes are the multiples of *cell* (the punch's cell),
    masked within *bragg_radius_q* (Å⁻¹; by default from *punch*'s settings,
    :func:`bragg_radius_from_punch`) for the diffuse reading.  *extra* adds
    classes beyond the presets (the user's custom generators).  *progress*
    gets ``(fraction, message)``.  One slab-wise pass per candidate, both
    readings at once (:func:`_class_readings`); the masks are the only
    volume-sized arrays besides the volume.
    """
    def emit(fraction: float, message: str) -> None:
        if progress is not None:
            progress(max(0.0, min(1.0, fraction)), message)

    candidates, refused = laue_candidates(vol, extra)
    node_r, origin_r, source = bragg_radius_from_punch(punch)
    if bragg_radius_q is not None:
        node_r, source = float(bragg_radius_q), "as asked"
        origin_r = max(node_r, float(origin_radius_q) if origin_radius_q is not None
                       else origin_r)
    elif origin_radius_q is not None:
        origin_r = max(node_r, float(origin_radius_q))
    measured = vol.mask
    largest = _largest_group(candidates, vol)
    steps = len(candidates) + 1
    emit(0.0, "masking the Bragg nodes")
    bragg, used_r = bragg_neighbourhood(vol, cell, node_r, origin_r, symmetry=largest,
                                        slab_voxels=slab_voxels)
    n_measured = 0
    n_bragg = 0
    nh = vol.data.shape[0]
    for lo in range(0, nh, 64):
        sl = slice(lo, lo + 64)
        m = measured[sl] & np.isfinite(vol.data[sl])
        n_measured += int(np.count_nonzero(m))
        n_bragg += int(np.count_nonzero(m & bragg[sl]))
    diffuse = measured & ~bragg
    del bragg
    masks = (measured, diffuse)
    emit(0.5 / steps, "the |Q|-shell reference")
    iso, width = _isotropic_readings(vol, masks, slab_voxels=slab_voxels)
    for i, c in enumerate(candidates):
        assert c.sym is not None
        base = (i + 1) / steps

        def tick(f: float, label: str = c.label, base: float = base) -> None:
            emit(base + f / steps, f"R_int over {label}")

        tick(0.0)
        c.all, c.diffuse = _class_readings(vol, c.sym, masks, slab_voxels=slab_voxels,
                                           progress=tick)
    cmp = LaueComparison(
        candidates=candidates, refused=refused,
        isotropic={"all": iso[0], "diffuse": iso[1]},
        bragg={"cell": [int(x) for x in cell], "radius_q": used_r, "asked_q": node_r,
               "origin_radius_q": max(used_r, origin_r), "from": source,
               "closed_under": None if largest is None else group_label(largest.ops),
               "voxels": n_bragg, "share": (n_bragg / n_measured) if n_measured else None,
               "shell_width_q": width},
        measured=n_measured, sigma_estimated=bool(vol.sigma_estimated), delta=delta, z=z)
    if used_r < node_r:
        cmp.notes.append(
            f"The Bragg radius was capped at {used_r:.3g} Å⁻¹ (asked {node_r:.3g}): beyond it a "
            "voxel's nearest node is no longer its rounded index on this cell.")
    if _ub_unknown(vol):
        cmp.notes.append("No UB: the metric is not checked, and |Q| is in r.l.u.")
    if vol.sigma_estimated:
        cmp.notes.append(
            "σ was estimated (√|I|): the noise floor is only as right as that estimate, and "
            "the ratios compare classes by their orbits' sizes rather than by counting noise.")
    _suggest(cmp)
    emit(1.0, "done")
    return cmp
