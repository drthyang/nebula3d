# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The sample's modulation, and what it protects from the Bragg punch's search.

A modulation of wave vector **k** puts satellites at **G** ± m·**k** about
every node **G** of the parent lattice, up to the order m the sample shows.
Sharp and off the lattice, they are what the punch's search pass punches, so a
sample that has them declares its **k**, per material, and the search leaves
the positions it implies alone (:class:`Modulation`). The form is the user's
to declare; this module never infers it:

- ``"points"`` (the default when none is named): each satellite
  **G** ± m·R·**k**, R over the point group the data were symmetrised with,
  in a box of ± ``half_width`` r.l.u. on every axis;
- ``"planes"``: the whole planes through them, ``t·x ≡ ±m·(k·t) (mod P)``,
  with ``t`` the primitive integer vector along **k** (or the declared
  ``normal``) and ``P`` the period of ``t·x`` on the parent lattice, and every
  plane equivalent to one of them under the point group.

**G** runs over the parent lattice of the punch's indexing cell
(``PunchParams.supercell``): on a doubled cell the satellites repeat at every
second node. Positions are quantised to 1e-4 r.l.u., so ``k = (1/3, 0, 0)`` as
planes protects H = n ± 0.3333 and n ± 0.6667, the planes the punch's search
left alone before modulations were declared, bit for bit.

Every rule here, the punch's mask, a slice's labels, a point's nearest
position and the legacy H planes (:func:`h_planes`), reads one predicate,
:func:`_band`: a coordinate within a half-width of a centre, on a circle of the
coordinate's period.

:func:`detect_commensurate` measures whether the search's sharp peaks off the
lattice bunch at one commensurate fraction of a coordinate, as a modulation
the sample did not declare would make them. It measures and records; the
question is the user's.
"""

from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from fractions import Fraction
from functools import lru_cache
from typing import TYPE_CHECKING, Any

import numpy as np
from numpy.typing import ArrayLike, NDArray

from nebula3d.core import HKLVolume
from nebula3d.symmetry import GridSymmetry, coordinate_forms, point_group

if TYPE_CHECKING:
    Symmetry = GridSymmetry | Sequence[ArrayLike] | None
    Grid = HKLVolume | Sequence[ArrayLike]

__all__ = [
    "ALPHA",
    "FORMS",
    "HALF_WIDTH",
    "MAX_ORDER",
    "MIN_HITS",
    "SHARP_RATIO",
    "Band",
    "Bunching",
    "Modulation",
    "Nearest",
    "Position",
    "coordinate",
    "detect_commensurate",
    "h_planes",
    "nearest_position",
    "protected_labels",
    "protected_mask",
]

#: The forms a modulation may be declared in.
FORMS = ("points", "planes")
#: A position's default half-width, r.l.u.
HALF_WIDTH = 0.08
#: The highest order a declaration may name.
MAX_ORDER = 6
#: Positions are quantised to 1 / QUANTUM r.l.u.
QUANTUM = 10_000
#: The bunching test's family-wise level: one-sided 3σ.
ALPHA = 1.35e-3
#: The fewest hits that count as bunching: a modulation repeats at every node,
#: so one ± pair of peaks is not evidence of one.
MIN_HITS = 3
#: A sharp peak is no wider than this × the median Bragg peak at the nodes, on
#: every axis: the "as sharp as Bragg" ratio of the console's settings.
SHARP_RATIO = 2.0

_NONE = {"", "none", "off"}
_IDENTITY = np.eye(3, dtype=np.int64)


# --------------------------------------------------------------------------- the predicate

def _offset(x: ArrayLike, centre: float, period: float | None) -> NDArray[np.float64]:
    """How far coordinate *x* lies from *centre*: on a circle of *period* r.l.u.
    when one is given, else along the line."""
    x = np.asarray(x)
    if period is None:
        return np.abs(x - float(centre))
    p = float(period)
    d = np.abs(np.mod(x, p) - float(centre) % p)
    return np.minimum(d, p - d)


def _band(x: ArrayLike, centre: float, half_width: float,
          period: float | None) -> NDArray[np.bool_]:
    """Whether coordinate *x* lies within *half_width* of *centre* (mod *period*).

    The one predicate of the module: the punch's mask, a slice's labels, a
    point's nearest position, the legacy H planes and the bunching test all
    read it, so they agree voxel for voxel.
    """
    return _offset(x, centre, period) <= half_width


def coordinate(form: Sequence[int] | NDArray[np.int64], h: ArrayLike, k: ArrayLike,
               l: ArrayLike) -> NDArray[np.float64]:
    """``form·(h, k, l)``, broadcast: only the axes the form uses take part,
    so H alone is *h* itself."""
    out: NDArray[np.float64] | None = None
    for c, ax in zip(form, (h, k, l)):
        if c:
            a = np.asarray(ax)
            term = a if c == 1 else float(c) * a
            out = term if out is None else out + term
    return out if out is not None else np.zeros(np.broadcast(h, k, l).shape)


def _axes(grid: Grid) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """A grid's axes (an :class:`~nebula3d.core.HKLVolume`, or its three axes)
    shaped to broadcast against its volume."""
    axes = ((grid.h_axis, grid.k_axis, grid.l_axis) if isinstance(grid, HKLVolume)
            else tuple(grid))
    h, k, l = (np.asarray(a) for a in axes)
    return h[:, None, None], k[None, :, None], l[None, None, :]


# --------------------------------------------------------------------------- positions

@dataclass(frozen=True)
class Band:
    """One coordinate ``form·x`` within its position's half-width of *centre*,
    on a circle of *period* r.l.u. (``None``: one plane, not periodic)."""

    form: tuple[int, int, int]
    centre: float
    period: float | None


@dataclass(frozen=True)
class Position:
    """One protected position and the voxels it covers.

    A point lies in it when, for one of its ``regions``, every band of that
    region holds. A plane family has one region of one band; a satellite one
    region of three bands (its box) and, on symmetrised data, one more per
    operation that shears the box into another shape.
    """

    label: str
    kind: str  # "plane" or "point"
    half_width: float
    regions: tuple[tuple[Band, ...], ...]
    # A plane: its coordinate, centre (exact) and period on the parent lattice.
    coordinate: tuple[int, int, int] | None = None
    centre: str | None = None
    period: int | None = None
    # A satellite: its vector G + vector, exact, each component in (-n/2, n/2].
    vector: tuple[str, str, str] | None = None

    def to_json(self) -> dict[str, Any]:
        """Every field, those of the other kind None."""
        return {
            "label": self.label,
            "kind": self.kind,
            "half_width": self.half_width,
            "coordinate": None if self.coordinate is None else list(self.coordinate),
            "centre": self.centre,
            "period": self.period,
            "vector": None if self.vector is None else list(self.vector),
        }


@dataclass(frozen=True)
class Nearest:
    """The protected position nearest a point: its ``index`` in the positions,
    and how far the point lies from it (r.l.u., along the farthest of its
    bands); ``inside`` when that is within its half-width."""

    index: int
    position: Position
    distance: float
    inside: bool


def _inside(position: Position, coords: dict[tuple[int, int, int], NDArray[np.float64]],
            h: ArrayLike, k: ArrayLike, l: ArrayLike) -> NDArray[np.bool_]:
    """Where *position* covers the points (h, k, l); *coords* caches each
    form's coordinate between positions."""
    out: NDArray[np.bool_] | None = None
    for region in position.regions:
        here: NDArray[np.bool_] | None = None
        for band in region:
            x = coords.get(band.form)
            if x is None:
                x = coords[band.form] = coordinate(band.form, h, k, l)
            b = _band(x, band.centre, position.half_width, band.period)
            here = b if here is None else here & b
        if here is not None:
            out = here if out is None else out | here
    return out if out is not None else np.zeros(np.broadcast(h, k, l).shape, dtype=bool)


def protected_mask(positions: Sequence[Position], grid: Grid) -> NDArray[np.bool_]:
    """The voxels of *grid* any of *positions* covers, broadcastable to its
    volume's shape (only the axes the positions use take a dimension)."""
    h, k, l = _axes(grid)
    coords: dict[tuple[int, int, int], NDArray[np.float64]] = {}
    out: NDArray[np.bool_] = np.zeros((1, 1, 1), dtype=bool)
    for position in positions:
        out = out | _inside(position, coords, h, k, l)
    return out


def protected_labels(positions: Sequence[Position], h: ArrayLike, k: ArrayLike,
                     l: ArrayLike) -> NDArray[np.int32]:
    """Which of *positions* covers each point (h, k, l), broadcast: ``i + 1``
    for ``positions[i]`` (the first that covers it), 0 where none does.
    Nonzero exactly where :func:`protected_mask` is true."""
    h, k, l = np.asarray(h), np.asarray(k), np.asarray(l)
    out = np.zeros(np.broadcast(h, k, l).shape, dtype=np.int32)
    coords: dict[tuple[int, int, int], NDArray[np.float64]] = {}
    for i, position in enumerate(positions, start=1):
        out = np.where((out == 0) & _inside(position, coords, h, k, l), np.int32(i), out)
    return out


def nearest_position(positions: Sequence[Position],
                     hkl: Sequence[float]) -> Nearest | None:
    """The position nearest the point *hkl*, or ``None`` without positions.

    A plane's distance is its coordinate's from the centre; a satellite's the
    largest of its box's three, in whichever of its regions lies nearest.
    ``inside`` agrees with :func:`protected_labels` at the point.
    """
    h, k, l = (np.asarray(v, dtype=np.float64) for v in hkl)
    best: Nearest | None = None
    for i, position in enumerate(positions):
        for region in position.regions:
            d = max(float(_offset(coordinate(b.form, h, k, l), b.centre, b.period))
                    for b in region)
            if best is None or d < best.distance:
                inside = all(bool(_band(coordinate(b.form, h, k, l), b.centre,
                                        position.half_width, b.period)) for b in region)
                best = Nearest(index=i, position=position, distance=d, inside=inside)
    return best


def h_planes(*, centres: Sequence[float] | None = None,
             fractions: Sequence[float] | None = None, half_width: float,
             symmetry: Symmetry = None) -> tuple[Position, ...]:
    """The H planes the punch's search left alone before modulations were
    declared (``search_exclude_h_centers`` and ``search_exclude_h_fractions``):
    each centre (H = c), and each fraction mod 1 (H = n + f), ± *half_width*,
    and with *symmetry* every plane equivalent to them. None when the
    half-width is not positive or nothing is named."""
    half = max(float(half_width), 0.0)
    if half <= 0 or (not centres and not fractions):
        return ()
    out = []
    for g in coordinate_forms(_group(symmetry), (1, 0, 0)):
        form = _form(g)
        name = _name(form)
        for c in centres or ():
            out.append(Position(f"{name} = {float(c):g}", "plane", half,
                                ((Band(form, float(c), None),),), coordinate=form,
                                centre=f"{float(c):g}", period=None))
        for f in fractions or ():
            out.append(Position(f"{name} ≡ {float(f) % 1.0:g} (mod 1)", "plane", half,
                                ((Band(form, float(f), 1.0),),), coordinate=form,
                                centre=f"{float(f) % 1.0:g}", period=1))
    return tuple(out)


# --------------------------------------------------------------------------- the declaration

@dataclass(frozen=True)
class Modulation:
    """A modulation the user declares for the sample, and what it protects.

    ``k`` holds one or more wave vectors, exact fractions of the volume's
    reciprocal axes; ``order`` the highest harmonic m; ``form`` "points" (the
    satellites) or "planes" (the planes through them); ``half_width`` how far
    from each position (r.l.u.) the search leaves alone; ``normal`` the planes'
    normal t, an integer vector (``None``: the primitive one along each k).

    :meth:`positions`, :meth:`mask`, :meth:`labels` and :meth:`nearest` take
    the point group the data were symmetrised with (a
    :class:`~nebula3d.symmetry.GridSymmetry`, its operations, or ``None``) and
    the punch's indexing cell, whose parent lattice the satellites repeat on.
    """

    k: tuple[tuple[Fraction, Fraction, Fraction], ...]
    order: int = 1
    form: str = "points"
    half_width: float = HALF_WIDTH
    normal: tuple[int, int, int] | None = None

    def __post_init__(self) -> None:
        vectors = tuple(_vector(v) for v in _vectors(self.k))
        if not vectors:
            raise ValueError("a modulation needs at least one k")
        for v in vectors:
            if all(c == 0 for c in v):
                raise ValueError("k = (0, 0, 0) is no modulation")
        if isinstance(self.order, bool) or int(self.order) != self.order:
            raise ValueError(f"order {self.order!r}: a whole number from 1 to {MAX_ORDER}")
        order = int(self.order)
        if not 1 <= order <= MAX_ORDER:
            raise ValueError(f"order {order}: a whole number from 1 to {MAX_ORDER}")
        form = str(self.form).strip().lower()
        if form not in FORMS:
            raise ValueError(f"form {self.form!r}: choose 'points' or 'planes'")
        half = float(self.half_width)
        if not 0.0 < half < 0.5:
            raise ValueError(f"half_width {self.half_width!r}: between 0 and 0.5 r.l.u.")
        normal = None if self.normal is None else _primitive(_integers(self.normal))
        object.__setattr__(self, "k", vectors)
        object.__setattr__(self, "order", order)
        object.__setattr__(self, "form", form)
        object.__setattr__(self, "half_width", half)
        object.__setattr__(self, "normal", normal)

    # ------------------------------------------------------------------ reading and writing

    @classmethod
    def parse(cls, value: object) -> Modulation | None:
        """A declaration from what a person or a request gives.

        ``None``, ``""``, ``"none"`` and ``"off"`` declare none. A string is the
        k vectors, ``"1/3, 0, 0"`` or several separated by ``;``, in the
        default form (points), and so is a sequence (one vector of three
        components, or a list of them). A mapping takes ``k`` (such a string, one
        vector as three components, or a list of vectors), ``order``,
        ``form``, ``half_width`` and ``normal``; blank values take the
        defaults, and without k it declares none, whatever else it holds (a
        form's other fields keep their values). A component is an exact
        fraction (``"1/3"``), an integer, or a decimal, read as the simplest
        fraction within half the quantum of it (0.3333 is 1/3). Raises
        ``ValueError`` saying what is wrong.
        """
        if value is None or isinstance(value, Modulation):
            return value
        if isinstance(value, str):
            return None if value.strip().lower() in _NONE else cls(k=_parse_k(value))
        if isinstance(value, Sequence):
            return cls(k=_parse_k(value)) if len(value) else None
        if not isinstance(value, Mapping):
            raise ValueError(f"cannot read a modulation from {type(value).__name__}")
        unknown = set(value) - {"k", "order", "form", "half_width", "normal"}
        if unknown:
            raise ValueError(f"unknown modulation field(s): {', '.join(sorted(map(str, unknown)))}")
        k = value.get("k")
        if k is None or (isinstance(k, str) and k.strip().lower() in _NONE) or (
                isinstance(k, Sequence) and not isinstance(k, str) and not k):
            return None
        order, form, half, normal = (value.get(name) for name in
                                     ("order", "form", "half_width", "normal"))
        return cls(
            k=_parse_k(k),
            order=1 if _blank(order) else _whole(order, "order"),
            form="points" if _blank(form) else str(form),
            half_width=HALF_WIDTH if _blank(half) else _real(half, "half_width"),
            normal=None if _blank(normal) else _parse_normal(normal),
        )

    def to_json(self) -> dict[str, Any]:
        """The declaration as JSON, its fractions exact; :meth:`parse` reads it back."""
        return {
            "k": [[_text(c) for c in v] for v in self.k],
            "order": self.order,
            "form": self.form,
            "half_width": self.half_width,
            "normal": None if self.normal is None else list(self.normal),
        }

    def describe(self, symmetry: Symmetry = None,
                 cell: Sequence[int] = (1, 1, 1)) -> str:
        """What the declaration protects, in one line."""
        group = _group(symmetry)
        cells = _cell(cell)
        vectors = " and ".join(_vector_text(v) for v in self.k)
        orders = "1" if self.order == 1 else f"1 to {self.order}"
        head = f"k = {vectors}, m = {orders}"
        positions = self.positions(symmetry, cells)
        if self.form == "planes":
            own = []
            for v in self.k:
                t = self.normal or _primitive_of(v)
                period = _period(t, cells)
                centres = _centres_text(_plane_centres(v, t, self.order, period), period)
                own.append(f"{_name(t)} ≡ {centres or 'nothing off the lattice'} (mod {period})")
            text = f"{head}, as planes: {'; '.join(own)}, ± {self.half_width:g} r.l.u."
            what = "plane families"
        else:
            text = (f"{head}, as points: the satellites G ± m·k in a box of "
                    f"± {self.half_width:g} r.l.u.")
            what = "satellites about each node"
        if len(group) > 1:
            text += f"; with the {len(group)} symmetry operations, {len(positions)} {what}"
        if not positions:
            text += "; every one on the lattice: nothing is protected"
        return text

    # ------------------------------------------------------------------ what it protects

    def positions(self, symmetry: Symmetry = None,
                  cell: Sequence[int] = (1, 1, 1)) -> tuple[Position, ...]:
        """Every position the declaration protects, labelled: the plane
        families (form "planes") or the satellites about a node (form
        "points"), closed under the symmetry, on the parent lattice of *cell*.
        A position on the lattice itself (m·k a lattice vector) is left out:
        there the punch's node test has the say."""
        group = _group(symmetry)
        return _positions(self, tuple(_key(m) for m in group), _cell(cell))

    def mask(self, grid: Grid, symmetry: Symmetry = None,
             cell: Sequence[int] = (1, 1, 1)) -> NDArray[np.bool_]:
        """The voxels of *grid* (a volume, or its three axes) the declaration
        protects, broadcastable to its shape (:func:`protected_mask`)."""
        return protected_mask(self.positions(symmetry, cell), grid)

    def labels(self, h: ArrayLike, k: ArrayLike, l: ArrayLike, symmetry: Symmetry = None,
               cell: Sequence[int] = (1, 1, 1)) -> NDArray[np.int32]:
        """Which position covers each point: ``i + 1`` for ``positions()[i]``,
        0 for none (:func:`protected_labels`)."""
        return protected_labels(self.positions(symmetry, cell), h, k, l)

    def nearest(self, hkl: Sequence[float], symmetry: Symmetry = None,
                cell: Sequence[int] = (1, 1, 1)) -> Nearest | None:
        """The position nearest the point *hkl* (:func:`nearest_position`)."""
        return nearest_position(self.positions(symmetry, cell), hkl)


@lru_cache(maxsize=64)
def _positions(mod: Modulation, group_key: tuple[tuple[int, ...], ...],
               cell: tuple[int, int, int]) -> tuple[Position, ...]:
    group = tuple(np.asarray(m, dtype=np.int64).reshape(3, 3) for m in group_key)
    if mod.form == "planes":
        return _plane_positions(mod, group, cell)
    return _point_positions(mod, group, cell)


def _plane_centres(v: tuple[Fraction, ...], t: tuple[int, ...], order: int,
                   period: int) -> list[Fraction]:
    """The planes' centres ±m·(k·t) mod *period*, those on the lattice left out."""
    kt = sum((a * b for a, b in zip(v, t)), Fraction(0))
    out: list[Fraction] = []
    for m in range(1, order + 1):
        for sign in (1, -1):
            c = (sign * m * kt) % period
            if c != 0 and _quantised(c, period) != 0 and c not in out:
                out.append(c)
    return sorted(out)


def _plane_positions(mod: Modulation, group: tuple[NDArray[np.int64], ...],
                     cell: tuple[int, int, int]) -> tuple[Position, ...]:
    out: list[Position] = []
    index: dict[tuple[tuple[int, int, int], Fraction], int] = {}
    for v in mod.k:
        t = mod.normal or _primitive_of(v)
        for g in coordinate_forms(group, t):
            form = _form(g)
            period = _period(form, cell)
            for c in _plane_centres(v, t, mod.order, period):
                key = (form, c)
                if key in index:
                    continue
                band = Band(form, _quantised(c, period), float(period))
                twin = (_form(-np.asarray(form)), (-c) % period)
                if twin in index:  # the same planes read on −f: one family, two regions
                    i = index[key] = index[twin]
                    out[i] = replace(out[i], regions=out[i].regions + ((band,),))
                    continue
                index[key] = len(out)
                # Named on the coordinate with a positive lead: −K ≡ 1/3 is K ≡ 2/3.
                named, at = (form, c) if form == _primitive(form) else twin
                out.append(Position(f"{_name(named)} ≡ {_text(at)} (mod {period})", "plane",
                                    mod.half_width, ((band,),), coordinate=named,
                                    centre=_text(at), period=period))
    return tuple(out)


def _point_positions(mod: Modulation, group: tuple[NDArray[np.int64], ...],
                     cell: tuple[int, int, int]) -> tuple[Position, ...]:
    star: list[tuple[Fraction, ...]] = []
    for v in mod.k:
        for r in group:
            rk = _apply(r, v)
            for m in range(1, mod.order + 1):
                for sign in (1, -1):
                    s = tuple((sign * m * c) % n for c, n in zip(rk, cell))
                    if all(_quantised(c, n) == 0 for c, n in zip(s, cell)):
                        continue  # on the parent lattice
                    if s not in star:
                        star.append(s)
    reps = _coset_representatives(group, cell)
    out = []
    for s in star:
        regions: list[tuple[Band, ...]] = []
        for r in reps:
            image = tuple(c % n for c, n in zip(_apply(r, s), cell))
            region = tuple(Band(_form(r[i]), _quantised(image[i], cell[i]), float(cell[i]))
                           for i in range(3))
            if region not in regions:
                regions.append(region)
        shown = (_text(_centred(s[0], cell[0])), _text(_centred(s[1], cell[1])),
                 _text(_centred(s[2], cell[2])))
        out.append(Position(f"G + ({', '.join(shown)})", "point", mod.half_width,
                            tuple(regions), vector=shown))
    return tuple(out)


def _coset_representatives(group: tuple[NDArray[np.int64], ...],
                           cell: tuple[int, int, int]) -> list[NDArray[np.int64]]:
    """One operation per right coset of the group's signed permutations that
    keep the parent lattice: those map a satellite's box onto another's, so
    ``P·M`` adds no voxel that ``M`` does not (the box ``M⁻¹`` shears is the
    same); the others (the hexagonal 6-fold) shear it into a new shape."""
    perms = [p for p in group if _signed_permutation(p)
             and all(cell[i] == cell[j] for i, j in zip(*np.nonzero(p)))]
    reps, seen = [], set()
    for m in group:
        key = min(_key(p @ m) for p in perms)
        if key not in seen:
            seen.add(key)
            reps.append(m)
    return reps


# --------------------------------------------------------------------------- the bunching test

@dataclass(frozen=True)
class Bunching:
    """Sharp peaks off the lattice bunched at one commensurate fraction.

    Of the ``peaks`` the search punched as sharp as Bragg peaks and off the
    lattice (each symmetry orbit once), ``hits`` lie within ``half_width``
    (one grid step) of a fraction ``p/denominator`` of ``coordinate``'s
    ``period`` (or of an equivalent coordinate's), where chance would put each
    with probability ``p0``: the binomial tail of ``hits`` is ``p_value``,
    under ``alpha`` over the ``tests`` (coordinates × denominators) run.
    ``mean_distance`` is how far (r.l.u.) the hits lie from the fractions on
    average; ``others`` the other fractions that passed the test too, which
    the grid fits about as well (a band of one grid step holds fractions of
    other denominators: on a 0.05 grid 3/8 lies within it of 2/5).
    """

    coordinate: str
    equivalents: tuple[str, ...]
    period: int
    denominator: int
    values: tuple[tuple[str, int], ...]  # each fraction with hits, and its hits
    hits: int
    peaks: int
    p0: float
    p_value: float
    alpha: float
    tests: int
    half_width: float
    centres: tuple[tuple[float, float, float], ...]  # the hits, up to 12
    mean_distance: float = 0.0
    others: tuple[str, ...] = ()

    @property
    def expected(self) -> float:
        """The hits chance would give."""
        return self.peaks * self.p0

    def where(self) -> str:
        """``"H ≡ ±1/3 (mod 1)"``: the coordinate and the fractions."""
        values = [Fraction(v) for v, _hits in self.values]
        return f"{self.coordinate} ≡ {_centres_text(values, self.period)} (mod {self.period})"

    def to_json(self) -> dict[str, Any]:
        return {
            "coordinate": self.coordinate,
            "equivalents": list(self.equivalents),
            "period": self.period,
            "denominator": self.denominator,
            "values": [{"value": v, "hits": n} for v, n in self.values],
            "hits": self.hits,
            "peaks": self.peaks,
            "expected": round(self.expected, 3),
            "p0": float(f"{self.p0:.6g}"),
            "p_value": float(f"{self.p_value:.6g}"),
            "alpha": self.alpha,
            "tests": self.tests,
            "half_width": round(self.half_width, 6),
            "centres": [list(c) for c in self.centres],
            "mean_distance": round(self.mean_distance, 6),
            "others": list(self.others),
            "where": self.where(),
        }

    def describe(self) -> str:
        """The run log's line."""
        also = f" (and the equivalent {', '.join(self.equivalents)})" if self.equivalents else ""
        fits = f"; the grid also fits {', '.join(self.others)}" if self.others else ""
        return (f"sharp peaks off the lattice bunch at {self.where()}{also}: {self.hits} of "
                f"{self.peaks} lie within {self.half_width:g} r.l.u. of it, where chance puts "
                f"{self.expected:.2g} (binomial tail {self.p_value:.2g}, under {self.alpha:g} "
                f"over {self.tests} tests){fits}; no modulation is declared there, so the "
                f"search punched them")


def detect_commensurate(
    peaks_hkl: Sequence[Sequence[float]],
    axes: Sequence[ArrayLike],
    symmetry: Symmetry = None,
    declared: Modulation | None = None,
    *,
    cell: Sequence[int] = (1, 1, 1),
    eligible: ArrayLike | None = None,
    alpha: float = ALPHA,
    min_hits: int = MIN_HITS,
) -> Bunching | None:
    """Whether *peaks_hkl*, the search's sharp peaks off the lattice, bunch at
    one commensurate fraction of a coordinate; ``None`` when they do not.

    Left out: peaks within one grid step of a node of the parent lattice on all
    three axes (a Bragg peak's wings), peaks in a *declared* position or within
    one grid step of it (the flank of a declared satellite, which the search
    finds once the satellite's own voxels are protected), and peaks outside
    *eligible* (the voxels the search could find a peak in, on the grid of
    *axes*; all by default); the voxels left out leave the null's share too.
    On symmetrised data each orbit counts
    once. For each coordinate (H, K, L, those equivalent under the symmetry
    counted as one) and each denominator q from 2 to the largest whose
    fractions the grid keeps apart (bands of one grid step w that do not meet,
    ``1/q > 2w/P``), the hits X are the peaks within w of a fraction p/q of the
    coordinate's period P (p prime to q), and under no bunching each peak hits
    with the probability p₀, the share of the voxels it could lie in that are
    within w of one. A test fires when the binomial tail P(X ≥ hits) is at or
    under *alpha* over the number of tests run, with at least *min_hits* hits.
    Of the tests that fire, the one whose hits lie nearest their fractions on
    average (then the smaller denominator) is reported, the others with it.
    """
    from scipy.special import betainc

    ax = tuple(np.asarray(a) for a in axes)
    shape = tuple(int(a.size) for a in ax)
    steps = tuple(abs(float(a[1] - a[0])) if a.size > 1 else 0.0 for a in ax)
    cells = _cell(cell)
    group = _group(symmetry)
    h, k, l = ax[0][:, None, None], ax[1][None, :, None], ax[2][None, None, :]
    region: Any = (np.ones((1, 1, 1), dtype=bool) if eligible is None
                   else np.asarray(eligible, dtype=bool))
    if declared is not None:
        # A declared position and one grid step about it: with a satellite's
        # summit protected, the search can still find the voxel beside it
        # (protected voxels drop out of its local-maximum test), and such a
        # flank is the declared satellite's, not evidence of another.
        margin = max(steps)
        widened = [replace(p, half_width=p.half_width + margin)
                   for p in declared.positions(symmetry, cells)]
        region = region & ~protected_mask(widened, ax)
    at_node = (_band(h, 0.0, steps[0], float(cells[0])) & _band(k, 0.0, steps[1], float(cells[1]))
               & _band(l, 0.0, steps[2], float(cells[2])))
    region = np.broadcast_to(region & ~at_node, shape)
    pts = _orbit_representatives(peaks_hkl, ax, region, group)
    if len(pts) < min_hits:
        return None
    n = len(pts)
    ph, pk, pl = pts[:, 0], pts[:, 1], pts[:, 2]

    # One plan per coordinate (equivalent ones counted once) and denominator.
    plans = []
    seen: set[frozenset[tuple[int, int, int]]] = set()
    for c in range(3):
        axis = _form(np.eye(3, dtype=np.int64)[c])
        forms = tuple(_form(g) for g in coordinate_forms(group, axis))
        key = frozenset(forms)
        if key in seen or not steps[c] > 0:
            continue
        seen.add(key)
        # The voxels a peak could lie in, counted over the axes the forms use.
        used = {i for f in forms for i in range(3) if f[i]}
        unused = tuple(i for i in range(3) if i not in used)
        counts = region.sum(axis=unused, keepdims=True, dtype=np.int64) if unused else region
        q = 2
        while q * 2 * steps[c] / cells[c] < 1 - 1e-9:
            plans.append((c, axis, forms, counts, q))
            q += 1
    tests = len(plans)
    if not tests:
        return None

    grid_x: dict[tuple[int, int, int], Any] = {}
    peak_x: dict[tuple[int, int, int], Any] = {}
    fired: list[tuple[float, int, int, Bunching]] = []
    for order, (c, axis, forms, counts, q) in enumerate(plans):
        width = steps[c]
        covered: Any = np.zeros((1, 1, 1), dtype=bool)
        hit = np.zeros(n, dtype=bool)
        near = np.full(n, np.inf)
        values = []
        for p in range(1, q):
            if math.gcd(p, q) != 1:
                continue
            here = np.zeros(n, dtype=bool)
            for f in forms:
                if f not in grid_x:
                    grid_x[f] = coordinate(f, h, k, l)
                    peak_x[f] = coordinate(f, ph, pk, pl)
                period = _period(f, cells)
                centre = float(Fraction(p, q) * period)
                covered = covered | _band(grid_x[f], centre, width, float(period))
                here |= _band(peak_x[f], centre, width, float(period))
                near = np.minimum(near, _offset(peak_x[f], centre, float(period)))
            hit |= here
            if here.any():
                values.append((_text(Fraction(p, q) * cells[c]), int(here.sum())))
        if counts.dtype == bool:
            total, inside = int(np.count_nonzero(counts)), int(np.count_nonzero(counts & covered))
        else:
            total, inside = int(counts.sum()), int((counts * covered).sum())
        p0 = inside / total if total else 0.0
        hits = int(hit.sum())
        if hits < min_hits or not 0.0 < p0 < 1.0:
            continue
        tail = float(betainc(hits, n - hits + 1, p0))
        if tail > alpha / tests:
            continue
        own = _name(axis)
        names = (_name(_primitive(f)) for f in forms)
        equivalents = tuple(dict.fromkeys(x for x in names if x != own))
        centres = tuple((round(float(x), 4), round(float(y), 4), round(float(z), 4))
                        for x, y, z in pts[hit][:12])
        spread = float(near[hit].mean())
        fired.append((spread, q, order, Bunching(
            coordinate=own, equivalents=equivalents, period=cells[c], denominator=q,
            values=tuple(values), hits=hits, peaks=n, p0=p0, p_value=tail, alpha=alpha,
            tests=tests, half_width=width, centres=centres, mean_distance=spread)))
    if not fired:
        return None
    fired.sort(key=lambda f: (round(f[0], 9), f[1], f[2]))
    return replace(fired[0][3], others=tuple(b.where() for *_rest, b in fired[1:]))


def _orbit_representatives(peaks_hkl: Sequence[Sequence[float]], axes: tuple[Any, ...],
                           region: NDArray[np.bool_],
                           group: tuple[NDArray[np.int64], ...]) -> NDArray[np.float64]:
    """The peaks in *region* (at their nearest voxel), one per symmetry orbit,
    as an (n, 3) array in the order given."""
    out, seen = [], set()
    for peak in peaks_hkl:
        x = np.asarray(peak, dtype=np.float64)
        idx = tuple(int(np.argmin(np.abs(a - v))) for a, v in zip(axes, x))
        if not region[idx]:
            continue
        orbit = min(tuple(round(float(v), 4) + 0.0 for v in m @ x) for m in group)
        if orbit in seen:
            continue
        seen.add(orbit)
        out.append(x)
    return np.asarray(out, dtype=np.float64).reshape(-1, 3)


# --------------------------------------------------------------------------- helpers

def _group(symmetry: Symmetry) -> tuple[NDArray[np.int64], ...]:
    """The point group *symmetry* names (identity first); the identity alone without one."""
    if symmetry is None:
        return (_IDENTITY,)
    if isinstance(symmetry, GridSymmetry):
        return symmetry.ops
    return point_group(symmetry)


def _key(m: ArrayLike) -> tuple[int, ...]:
    return tuple(int(x) for x in np.asarray(m).ravel())


def _form(g: ArrayLike) -> tuple[int, int, int]:
    a, b, c = (int(x) for x in np.asarray(g).ravel())
    return (a, b, c)


def _cell(cell: Sequence[int]) -> tuple[int, int, int]:
    values = tuple(cell)
    if len(values) != 3 or any(isinstance(n, bool) or int(n) != n or n < 1 for n in values):
        raise ValueError(f"cell {cell!r}: three positive integers")
    return (int(values[0]), int(values[1]), int(values[2]))


def _period(form: Sequence[int], cell: tuple[int, int, int]) -> int:
    """The period of ``form·x`` on the parent lattice of *cell*: the gcd of its
    values on the nodes."""
    return math.gcd(*(abs(int(c)) * n for c, n in zip(form, cell) if c)) or 1


def _quantised(c: Fraction, period: int) -> float:
    """*c* to the nearest 1/QUANTUM, mod *period*."""
    return (round(c * QUANTUM) / QUANTUM) % period


def _apply(m: NDArray[np.int64], v: Sequence[Fraction]) -> tuple[Fraction, ...]:
    """``M·v``, exact."""
    return tuple(sum((int(m[i, j]) * v[j] for j in range(3)), Fraction(0)) for i in range(3))


def _signed_permutation(m: NDArray[np.int64]) -> bool:
    a = np.abs(np.asarray(m))
    return bool(np.all(np.isin(a, (0, 1))) and np.all(a.sum(axis=0) == 1)
                and np.all(a.sum(axis=1) == 1))


def _primitive(v: Sequence[int]) -> tuple[int, int, int]:
    """The primitive integer vector along *v*, its first nonzero component positive."""
    g = math.gcd(*(abs(int(c)) for c in v))
    if g == 0:
        raise ValueError("the planes' normal must not be (0, 0, 0)")
    a, b, c = (int(x) // g for x in v)
    sign = -1 if next(x for x in (a, b, c) if x) < 0 else 1
    return (sign * a, sign * b, sign * c)


def _primitive_of(v: Sequence[Fraction]) -> tuple[int, int, int]:
    """The primitive integer vector along the rational vector *v*."""
    scale = math.lcm(*(c.denominator for c in v))
    return _primitive([int(c * scale) for c in v])


def _centred(c: Fraction, n: int) -> Fraction:
    """*c* mod *n*, in (-n/2, n/2]."""
    c = c % n
    return c - n if c > Fraction(n, 2) else c


def _text(c: Fraction) -> str:
    return str(c.numerator) if c.denominator == 1 else f"{c.numerator}/{c.denominator}"


def _vector_text(v: Sequence[Fraction]) -> str:
    return "(" + ", ".join(_text(c) for c in v) + ")"


def _centres_text(centres: Sequence[Fraction], period: int) -> str:
    """``±1/3`` for a centre in [0, period) and its negative mod *period*,
    each alone otherwise."""
    rest = sorted(set(centres))
    out = []
    while rest:
        c = rest.pop(0)
        twin = (-c) % period
        if twin != c and twin in rest:
            rest.remove(twin)
            out.append(f"±{_text(c)}")
        else:
            out.append(_text(c))
    return ", ".join(out)


def _name(form: Sequence[int]) -> str:
    """``(1, 1, 0)`` → ``"H+K"``, ``(-1, 0, 0)`` → ``"-H"``, ``(2, -1, 0)`` → ``"2H-K"``."""
    out = ""
    for c, axis in zip(form, "HKL"):
        if not c:
            continue
        sign = "-" if c < 0 else ("+" if out else "")
        out += f"{sign}{'' if abs(c) == 1 else abs(c)}{axis}"
    return out or "0"


def _blank(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _whole(value: object, name: str) -> int:
    try:
        number = float(str(value).strip())
    except ValueError as exc:
        raise ValueError(f"{name} {value!r}: a whole number") from exc
    if isinstance(value, bool) or not number.is_integer():
        raise ValueError(f"{name} {value!r}: a whole number")
    return int(number)


def _real(value: object, name: str) -> float:
    try:
        number = float(str(value).strip())
    except ValueError as exc:
        raise ValueError(f"{name} {value!r}: a number") from exc
    if isinstance(value, bool) or not math.isfinite(number):
        raise ValueError(f"{name} {value!r}: a finite number")
    return number


def _integers(v: object) -> tuple[int, int, int]:
    values = list(v) if isinstance(v, Sequence) and not isinstance(v, str) else None
    if values is None or len(values) != 3:
        raise ValueError(f"normal {v!r}: three integers")
    return (_whole(values[0], "normal"), _whole(values[1], "normal"),
            _whole(values[2], "normal"))


def _parse_normal(value: object) -> tuple[int, int, int]:
    if isinstance(value, str):
        parts = [p for p in re.split(r"[\s,;]+", value.strip().strip("()[]⟨⟩")) if p]
        return _integers(parts)
    return _integers(value)


def _fraction(value: object) -> Fraction:
    """A component of k: exact as a fraction or an integer; a decimal as the
    simplest fraction within half the quantum of it."""
    if isinstance(value, bool):
        raise ValueError(f"k component {value!r}: a number")
    if isinstance(value, Fraction):
        return value
    if isinstance(value, (int, np.integer)):
        return Fraction(int(value))
    if isinstance(value, (float, np.floating)):
        if not math.isfinite(float(value)):
            raise ValueError(f"k component {value!r}: a finite number")
        return _simplest(Fraction(repr(float(value))))
    text = str(value).strip().replace("−", "-")
    try:
        if "/" in text:
            num, den = text.split("/")
            return Fraction(int(num), int(den))
        exact = Fraction(text)
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError(f"k component {value!r}: a fraction such as 1/3, or a number") from exc
    return exact if exact.denominator == 1 else _simplest(exact)


def _simplest(x: Fraction) -> Fraction:
    """The fraction with the smallest denominator within half the quantum of *x*."""
    tolerance = Fraction(1, 2 * QUANTUM)
    for den in range(1, QUANTUM + 1):
        num = round(x * den)
        if abs(Fraction(num, den) - x) <= tolerance:
            return Fraction(num, den)
    return x  # unreachable: den = QUANTUM is always within half the quantum


def _vector(v: object) -> tuple[Fraction, Fraction, Fraction]:
    values = list(v) if isinstance(v, Sequence) and not isinstance(v, str) else None
    if values is None or len(values) != 3:
        raise ValueError(f"k {v!r}: three components")
    a, b, c = (_fraction(x) for x in values)
    return (a, b, c)


def _vectors(k: object) -> list[object]:
    """*k* as a list of vectors: one vector of three components, or several."""
    if not isinstance(k, Sequence) or isinstance(k, str):
        raise ValueError(f"k {k!r}: a vector of three components, or a list of them")
    items = list(k)
    if len(items) == 3 and not any(isinstance(x, Sequence) and not isinstance(x, str)
                                   for x in items):
        return [items]
    return items


def _parse_k(value: object) -> tuple[tuple[Fraction, Fraction, Fraction], ...]:
    """k from a string (``"1/3, 0, 0"``, several separated by ``;``), one
    vector of three components, or a list of vectors."""
    if isinstance(value, str):
        vectors = []
        for part in value.split(";"):
            text = part.strip().strip("()[]⟨⟩ ")
            if text:
                vectors.append([p for p in re.split(r"[\s,]+", text) if p])
        if not vectors:
            raise ValueError("a modulation needs k")
        return tuple(_vector(v) for v in vectors)
    return tuple(_vector(v) for v in _vectors(value))
