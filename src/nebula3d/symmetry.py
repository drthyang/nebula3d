# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The Laue symmetry a volume was symmetrised with, as permutations of its grid.

A volume symmetrised over a Laue group (the NeXus Viewer writes ``6/m`` and its
operations to the file) holds the same value at every symmetry-equivalent
voxel: ``d(M·hkl) = d(hkl)`` for each operation ``M`` of the group.  Decisions
taken on such data — which voxels are the coverage edge, which are Bragg — must
then be the same at every equivalent voxel too.  Computed voxel by voxel they
are not, whenever an operation mixes the grid axes: index-space windows and
neighbourhoods are not invariant under it (the hexagonal 6-fold
``(h, k, l) → (−k, h+k, l)`` maps the (1, 1) corner of a 3×3 square to
(−1, 2), outside the square), and a refined UB is not exactly symmetric either
(|a*| and |b*| differ slightly, and γ* is not exactly 60°).  The operations
are exact on the grid, where the data were symmetrised, so the decisions are
made invariant there (:meth:`GridSymmetry.orbit_any`).  Values computed voxel
by voxel — a backfill solved on an index-space stencil — are made invariant
the same way, by averaging them over each orbit (:meth:`GridSymmetry.orbit_mean`).

A volume that was *not* symmetrised can be, here (:func:`symmetry_average`,
the pipeline's optional first stage), by the NeXus Viewer's rules: the Laue
class's generators closed into a group (:data:`LAUE_PRESETS`,
:func:`laue_operations`), the operations exact on the grid, the metric check
against the UB (:func:`metric_change`), and each orbit's measured voxels
pooled with equal weight.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import ArrayLike, NDArray

from nebula3d.core import HKLVolume, low_memory

_TERM = re.compile(r"([+-]?)(\d*)([hkl])")

#: The Laue classes the NeXus Viewer offers (its ``js/symmetry.js`` PRESETS,
#: verbatim and in its order): a name and generators in hkl form, trigonal and
#: hexagonal classes on hexagonal axes.  ``"1"`` is the identity alone.
LAUE_PRESETS: tuple[tuple[str, str], ...] = (
    ("1", "None"),
    ("-1", "-h,-k,-l"),
    ("2/m (b unique)", "-h,k,-l; -h,-k,-l"),
    ("2/m (c unique)", "-h,-k,l; -h,-k,-l"),
    ("mmm", "-h,-k,l; -h,k,-l; -h,-k,-l"),
    ("4/m", "k,-h,l; -h,-k,-l"),
    ("4/mmm", "k,-h,l; h,-k,-l; -h,-k,-l"),
    ("-3", "k,-h-k,l; -h,-k,-l"),
    ("-3m1", "k,-h-k,l; h,-h-k,-l; -h,-k,-l"),
    ("-31m", "k,-h-k,l; -k,-h,-l; -h,-k,-l"),
    ("6/m", "h+k,-h,l; -h,-k,-l"),
    ("6/mmm", "h+k,-h,l; -k,-h,-l; -h,-k,-l"),
    ("m-3", "k,l,h; -h,-k,l; -h,k,-l; -h,-k,-l"),
    ("m-3m", "k,l,h; k,-h,l; -h,-k,-l"),
)

#: The largest relative change of the reciprocal metric under the operations
#: that still counts as a symmetry of the cell (the NeXus Viewer warns above it,
#: :func:`metric_change`): 2 %.
METRIC_TOLERANCE = 0.02

#: A point group has at most 48 operations (m-3m).
MAX_ORDER = 48

_IDENTITY = np.eye(3, dtype=np.int64)
_GENERATOR_TERM = re.compile(r"([+-]?)(\d*)\*?([a-z])")


def parse_symmetry_ops(text: str) -> tuple[NDArray[np.int64], ...]:
    """Integer matrices of the operations in *text*.

    *text* lists operations as coordinate triplets separated by ``;``, e.g.
    ``"h,k,l; h+k,-h,l; -h,-k,-l"`` — the NeXus Viewer's ``symmetry_ops``
    attribute.  Each triplet gives the new ``(h', k', l')`` in terms of
    ``(h, k, l)``, so its matrix ``M`` has ``(h', k', l') = M·(h, k, l)``.
    Raises ``ValueError`` for a malformed triplet or a matrix that is not a
    lattice symmetry (``|det M| ≠ 1``).
    """
    ops = []
    for triplet in (t.strip() for t in str(text).split(";")):
        if not triplet:
            continue
        parts = [p.replace(" ", "").lower() for p in triplet.split(",")]
        if len(parts) != 3:
            raise ValueError(f"symmetry operation {triplet!r}: need three components")
        m = np.zeros((3, 3), dtype=np.int64)
        for row, part in enumerate(parts):
            terms = _TERM.findall(part)
            if not part or "".join("".join(t) for t in terms) != part:
                raise ValueError(f"symmetry operation {triplet!r}: cannot read {part!r}")
            for sign, count, axis in terms:
                m[row, "hkl".index(axis)] += (-1 if sign == "-" else 1) * int(count or 1)
        if abs(round(float(np.linalg.det(m)))) != 1:
            raise ValueError(f"symmetry operation {triplet!r} is not a lattice symmetry")
        ops.append(m)
    if not ops:
        raise ValueError("no symmetry operations given")
    return tuple(ops)


def read_symmetry_ops(path: str | Path) -> tuple[NDArray[np.int64], ...] | None:
    """The symmetry operations *path* declares its data were symmetrised with.

    Read from the ``symmetry_ops`` attribute the NeXus Viewer's export writes
    (see :func:`nebula3d.io.hkl_reader.declared_attrs`); ``None`` when the
    file declares none.
    """
    import h5py

    from nebula3d.io.hkl_reader import declared_attrs

    path = Path(path)
    if path.suffix.lower() not in {".h5", ".hdf5", ".nxs"}:
        return None
    with h5py.File(path, "r") as f:
        attrs = declared_attrs(f)
        text = attrs.get("symmetry_ops") if attrs is not None else None
    if text is None:
        return None
    if isinstance(text, bytes):
        text = text.decode("utf-8")
    return parse_symmetry_ops(str(text)) if str(text).strip() else None


def _group_closure(ops: tuple[NDArray[np.int64], ...]) -> tuple[NDArray[np.int64], ...]:
    """The group *ops* generate, identity first; at most 48 elements."""
    seen = {np.eye(3, dtype=np.int64).tobytes(): np.eye(3, dtype=np.int64)}
    frontier = list(seen.values())
    while frontier:
        nxt = []
        for a in frontier:
            for b in ops:
                c = a @ np.asarray(b, dtype=np.int64)
                key = c.tobytes()
                if key not in seen:
                    seen[key] = c
                    nxt.append(c)
        if len(seen) > 48:
            raise ValueError("symmetry operations generate more than 48 elements: "
                             "not a crystallographic point group")
        frontier = nxt
    return tuple(seen.values())


def point_group(ops: Sequence[ArrayLike]) -> tuple[NDArray[np.int64], ...]:
    """The group the HKL matrices *ops* generate, identity first: the
    ``ops`` of a :class:`GridSymmetry`, without a grid."""
    return _group_closure(tuple(np.asarray(m, dtype=np.int64) for m in ops))


def coordinate_forms(
    ops: Sequence[ArrayLike], f: ArrayLike,
) -> tuple[NDArray[np.int64], ...]:
    """Distinct images of the coordinate ``f·x`` under the operations *ops*.

    A voxel ``x`` maps to ``M⁻¹x``, whose coordinate ``f·M⁻¹x`` is ``g·x``
    with ``g = f·M⁻¹``.  A rule on ``f·x`` (an integer-H guard, the planes a
    modulation protects) holds at every equivalent voxel when it is applied to
    each ``g·x``.  In the order of *ops*, so ``f`` itself comes first when the
    identity does.
    """
    row = np.asarray(f, dtype=np.int64)
    out: list[NDArray[np.int64]] = []
    for m in ops:
        g = np.rint(row @ np.linalg.inv(np.asarray(m, dtype=np.float64))).astype(np.int64)
        if not any(np.array_equal(g, h) for h in out):
            out.append(g)
    return tuple(out)


@dataclass(frozen=True)
class GridSymmetry:
    """A point group acting on a volume's grid.

    ``ops`` are the group's HKL matrices (closed under products, identity
    first); ``index_ops`` the same operations on voxel indices,
    ``i' = R·i + t``, exact integers.
    """

    ops: tuple[NDArray[np.int64], ...]
    index_ops: tuple[tuple[NDArray[np.int64], NDArray[np.int64]], ...]
    shape: tuple[int, int, int]

    @classmethod
    def for_volume(
        cls, vol: HKLVolume, ops: tuple[NDArray[np.int64], ...],
    ) -> GridSymmetry:
        """The group *ops* generate, on *vol*'s grid.

        Raises ``ValueError`` when an operation does not map grid points onto
        grid points (unequal steps along axes it mixes, or an origin off the
        lattice of grid points).
        """
        group = _group_closure(tuple(np.asarray(m, dtype=np.int64) for m in ops))
        axes = (vol.h_axis, vol.k_axis, vol.l_axis)
        start = np.array([float(a[0]) for a in axes])
        step = np.array([(float(a[-1]) - float(a[0])) / (a.size - 1) if a.size > 1 else 1.0
                         for a in axes])
        index_ops = []
        for m in group:
            r = m * step[None, :] / step[:, None]  # S⁻¹ M S
            t = ((m - np.eye(3)) @ start) / step  # S⁻¹ (M − I) a₀
            ri, ti = np.rint(r), np.rint(t)
            if np.abs(r - ri).max() > 1e-3 or np.abs(t - ti).max() > 1e-3:
                raise ValueError(
                    f"symmetry operation {_triplet(m)} does not map this volume's "
                    f"HKL grid onto itself (steps {np.round(step, 6).tolist()}, "
                    f"start {np.round(start, 6).tolist()})")
            index_ops.append((ri.astype(np.int64), ti.astype(np.int64)))
        return cls(ops=group, index_ops=tuple(index_ops),
                   shape=(int(vol.shape[0]), int(vol.shape[1]), int(vol.shape[2])))

    @property
    def order(self) -> int:
        return len(self.ops)

    def forms(self, f: ArrayLike) -> tuple[NDArray[np.int64], ...]:
        """Distinct images of the coordinate ``f·x`` under the group
        (:func:`coordinate_forms`); *f* itself comes first."""
        return coordinate_forms(self.ops, f)

    def h_forms(self) -> tuple[NDArray[np.int64], ...]:
        """Distinct images of the H coordinate under the group.

        A voxel ``x`` maps to ``M⁻¹x``, whose H coordinate is ``f·x`` with
        ``f`` row 0 of ``M⁻¹``.  A rule on H (an integer-H guard, protected
        fractional-H planes) holds at every equivalent voxel when it is applied
        to each ``f·x``.  ``(1, 0, 0)`` (H itself) comes first: the
        :meth:`forms` of ``(1, 0, 0)``.
        """
        return self.forms((1, 0, 0))

    def orbit_any(self, mask: NDArray[np.bool_]) -> NDArray[np.bool_]:
        """True where any symmetry-equivalent voxel of *mask* is True.

        The union of *mask*'s images under the group: invariant, and the
        smallest invariant mask that contains *mask*.  Equivalents outside the
        grid do not count.
        """
        mask = np.asarray(mask, dtype=bool)
        if mask.shape != self.shape:
            raise ValueError(f"mask shape {mask.shape} != grid shape {self.shape}")
        out = mask.copy()
        for r, t in self.index_ops[1:]:
            _or_pullback(out, mask, r, t)
        return out


    def orbit_mean(
        self, values: NDArray[np.floating], where: NDArray[np.bool_],
        chunk: int = 1_000_000,
    ) -> int:
        """Replace each voxel of *where* by the mean of its symmetry-equivalent
        voxels that are also in *where* and finite, **in place**.

        The invariant part of *values* on *where*: equivalent voxels end up
        equal, and voxels outside *where* are left alone.  Equivalents off the
        grid do not count.  On the general path each mean is written to the
        whole orbit at once, so a member reached later finds equal values and
        keeps them, and the temporaries stay a few times *chunk*.  Returns the
        number of voxels in *where*.
        """
        where = np.asarray(where, dtype=bool)
        if where.shape != self.shape or values.shape != self.shape:
            raise ValueError(f"shapes {values.shape}, {where.shape} != grid shape {self.shape}")
        if all(_l_separate(r) for r, _t in self.index_ops):
            self._orbit_mean_rows(values, where, in_place=low_memory())
            return int(where.sum())
        idx_all = np.argwhere(where)
        shape = np.asarray(self.shape)

        def images(idx: NDArray[np.int64], r: NDArray[np.int64],
                   t: NDArray[np.int64]) -> tuple[NDArray[np.intp], NDArray[np.int64]]:
            img = idx @ r.T + t
            on = np.all((img >= 0) & (img < shape), axis=1)
            pos = np.nonzero(on)[0]
            img = img[on]
            inside = where[img[:, 0], img[:, 1], img[:, 2]]
            return pos[inside], img[inside]

        for lo in range(0, len(idx_all), chunk):
            idx = idx_all[lo:lo + chunk]
            own = values[idx[:, 0], idx[:, 1], idx[:, 2]].astype(np.float64)
            finite = np.isfinite(own)
            total = np.where(finite, own, 0.0)
            count = finite.astype(np.int64)
            for r, t in self.index_ops[1:]:
                pos, img = images(idx, r, t)
                v = values[img[:, 0], img[:, 1], img[:, 2]].astype(np.float64)
                ok = np.isfinite(v)
                total[pos[ok]] += v[ok]   # each voxel has one image per operation
                count[pos[ok]] += 1
            mean = np.where(count > 0, total / np.maximum(count, 1), own).astype(values.dtype)
            for r, t in self.index_ops:
                pos, img = images(idx, r, t)
                values[img[:, 0], img[:, 1], img[:, 2]] = mean[pos]
        return len(idx_all)

    def _orbit_mean_rows(
        self, values: NDArray[np.floating], where: NDArray[np.bool_], block: int = 8,
        in_place: bool = False,
    ) -> None:
        """:meth:`orbit_mean` for a group whose operations map L to ±L alone
        (every hexagonal, tetragonal, orthorhombic and monoclinic one): whole L
        rows are gathered a block of H planes at a time, much faster than voxel
        indices on a full volume.  The blocks read each other's voxels, so the
        means are kept until every block is done (one value per voxel of
        *where*); with *in_place* (the browser's low-memory mode) each block's
        means are written to their whole orbits at once instead, which keeps
        nothing but takes about twice as long."""
        nh, nk, nl = self.shape
        j = np.arange(nk)[None, :]
        lidx = np.arange(nl)
        deferred: list[tuple[int, NDArray[np.bool_], NDArray[np.floating]]] = []
        for lo in range(0, nh, block):
            i = np.arange(lo, min(nh, lo + block))[:, None]
            sel = where[lo:lo + len(i)]
            if not sel.any():
                continue
            total = np.zeros(sel.shape, dtype=np.float64)
            count = np.zeros(sel.shape, dtype=np.int32)
            maps = []
            for r, t in self.index_ops:
                si = r[0, 0] * i + r[0, 1] * j + t[0]
                sj = r[1, 0] * i + r[1, 1] * j + t[1]
                sl = r[2, 2] * lidx + t[2]
                okl = (sl >= 0) & (sl < nl)
                ok = (si >= 0) & (si < nh) & (sj >= 0) & (sj < nk)
                rows = values[si[ok], sj[ok]][:, sl[okl]].astype(np.float64)
                inside = where[si[ok], sj[ok]][:, sl[okl]]
                use = inside & np.isfinite(rows)
                tot = total[ok]
                cnt = count[ok]
                tot[:, okl] += np.where(use, rows, 0.0)
                cnt[:, okl] += use
                total[ok] = tot
                count[ok] = cnt
                if in_place:
                    maps.append((si[ok], sj[ok], sl[okl], ok, okl, inside))
            mean = np.where(count > 0, total / np.maximum(count, 1),
                            values[lo:lo + len(i)]).astype(values.dtype)
            if not in_place:
                deferred.append((lo, sel, mean[sel]))
                continue
            for si_ok, sj_ok, sl_ok, ok, okl, inside in maps:
                put = sel[ok][:, okl] & inside
                if not put.any():
                    continue
                rr, ll = np.nonzero(put)
                values[si_ok[rr], sj_ok[rr], sl_ok[ll]] = mean[ok][:, okl][put]
        for lo, sel, mean in deferred:
            values[lo:lo + sel.shape[0]][sel] = mean


def _l_separate(r: NDArray[np.int64]) -> bool:
    """Whether the index operation maps L to ±L alone (and H, K among themselves)."""
    return bool(r[2, 0] == 0 and r[2, 1] == 0 and r[0, 2] == 0 and r[1, 2] == 0)


def _triplet(m: NDArray[np.int64]) -> str:
    def comp(row: NDArray[np.int64]) -> str:
        s = "".join(f"{'+' if c > 0 else '-'}{abs(int(c)) if abs(c) != 1 else ''}{a}"
                    for c, a in zip(row, "hkl") if c)
        return s.lstrip("+") or "0"
    return ",".join(comp(row) for row in m)


def _or_pullback(
    out: NDArray[np.bool_], mask: NDArray[np.bool_],
    r: NDArray[np.int64], t: NDArray[np.int64],
) -> None:
    """``out[i] |= mask[R·i + t]`` wherever ``R·i + t`` is on the grid."""
    nh, nk, nl = mask.shape
    if r[2, 0] == 0 and r[2, 1] == 0 and r[0, 2] == 0 and r[1, 2] == 0:
        # L maps to ±L alone (every hexagonal, tetragonal, orthorhombic and
        # monoclinic operation): gather whole L rows of the (H, K) plane, a
        # block of H planes at a time so the temporaries stay small.
        rows_in = mask.reshape(nh * nk, nl)
        j = np.arange(nk)[None, :]
        sl = r[2, 2] * np.arange(nl) + t[2]
        okl = (sl >= 0) & (sl < nl)
        for lo in range(0, nh, 16):
            i = np.arange(lo, min(nh, lo + 16))[:, None]
            si = r[0, 0] * i + r[0, 1] * j + t[0]
            sj = r[1, 0] * i + r[1, 1] * j + t[1]
            ok = ((si >= 0) & (si < nh) & (sj >= 0) & (sj < nk)).ravel()
            rows = rows_in[(si * nk + sj).ravel()[ok]][:, sl[okl]]
            dst = out[lo:lo + 16].reshape(-1, nl)  # a view: out is C-contiguous
            sub = dst[ok]
            sub[:, okl] |= rows
            dst[ok] = sub
        return
    # General operation (cubic, rhombohedral axes): H slabs, so the index
    # arrays stay small.
    j, k = np.meshgrid(np.arange(nk), np.arange(nl), indexing="ij")
    for lo in range(0, nh, 8):
        i = np.arange(lo, min(nh, lo + 8))[:, None, None]
        src = [r[a, 0] * i + r[a, 1] * j[None] + r[a, 2] * k[None] + t[a] for a in range(3)]
        ok = ((src[0] >= 0) & (src[0] < nh) & (src[1] >= 0) & (src[1] < nk)
              & (src[2] >= 0) & (src[2] < nl))
        block = out[lo:lo + 8]
        block[ok] |= mask[src[0][ok], src[1][ok], src[2][ok]]


# ---------------------------------------------------------------------------
# Symmetry averaging, by the NeXus Viewer's rules
# ---------------------------------------------------------------------------
# The viewer (js/symmetry.js and js/export.js) is the reference: the same
# generator syntax and group closure (in its order), the same grid and metric
# checks, and the same pooling, so a volume averaged here equals the one its
# export writes, voxel for voxel (tests/test_symmetry_average.py pins that
# against the viewer's own code).


def _key(m: NDArray[np.int64]) -> tuple[int, ...]:
    return tuple(int(x) for x in np.asarray(m).ravel())


def _det3(m: NDArray[np.int64]) -> int:
    """The determinant of an integer 3×3 matrix, exactly."""
    a = [[int(x) for x in row] for row in m]
    return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
            - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
            + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))


def _parse_generator(text: str) -> NDArray[np.int64]:
    """One operation, as the NeXus Viewer's ``parseOp`` reads it."""
    src = re.sub(r"\s+", "", text).lower()
    parts = src.split(",")
    if len(parts) != 3 or any(not p for p in parts):
        raise ValueError(f'"{text}" needs three comma-separated components.')
    real = re.search(r"[xyz]", src) is not None
    if real and re.search(r"[hkl]", src) is not None:
        raise ValueError(f'"{text}" mixes h,k,l with x,y,z.')
    names = "xyz" if real else "hkl"
    m = np.zeros((3, 3), dtype=np.int64)
    for row, part in enumerate(parts):
        pos = 0
        while pos < len(part):
            match = _GENERATOR_TERM.match(part, pos)
            if match is None:
                break
            sign, count, name = match.groups()
            col = names.find(name)
            if col < 0:
                raise ValueError(f'Unknown symbol "{name}" in "{text}".')
            m[row, col] += (-1 if sign == "-" else 1) * (int(count) if count else 1)
            pos = match.end()
        if pos != len(part):
            raise ValueError(f'Cannot read "{part}" in "{text}". Use integer combinations '
                             "such as h-k or -2l; translations are not allowed.")
    r = m.T.copy() if real else m
    det = _det3(r)
    if abs(det) != 1:
        raise ValueError(f'"{text}" has determinant {det}; a point operation must have '
                         "determinant ±1.")
    return r


def parse_generators(text: str) -> tuple[NDArray[np.int64], ...]:
    """The operations in *text*, as the NeXus Viewer's ``parseOps`` reads them.

    Operations are separated by ``;`` or new lines and written like coordinate
    triplets acting on reflections, ``h+k,-h,l`` (row ``i`` gives the new
    ``h'_i``, so ``(h', k', l') = R·(h, k, l)``).  Real-space triplets such as
    ``x-y,x,z`` are taken as ``R = Wᵀ``.  Integer coefficients only (``-2l``,
    ``2*h``), no translations, and ``|det R| = 1``.  ``None`` (any case) and
    empty text name no operation, so they give an empty tuple: the identity
    alone once closed (:func:`close_group`).  ``ValueError`` with the viewer's
    message for anything else.
    """
    pieces = (s.strip() for s in re.split(r"[;\n]", str(text)))
    return tuple(_parse_generator(s) for s in pieces if s and s.lower() != "none")


def close_group(generators: Sequence[ArrayLike]) -> tuple[NDArray[np.int64], ...]:
    """The smallest group containing *generators*, in the NeXus Viewer's order.

    As its ``closeGroup``: the identity, then each new generator, then the
    products ``a·b`` of every pair of the operations so far, pass after pass
    until a pass adds none.  The order is that of the viewer's index maps, so
    the sums of :func:`symmetry_average` add in its order too.  ``ValueError``
    past :data:`MAX_ORDER` operations (not a crystallographic point group).
    """
    ops: list[NDArray[np.int64]] = [_IDENTITY.copy()]
    keys = {_key(_IDENTITY)}

    def add(m: NDArray[np.int64]) -> bool:
        key = _key(m)
        if key in keys:
            return False
        if len(ops) >= MAX_ORDER:
            raise ValueError(f"These operations generate more than {MAX_ORDER} operations, so "
                             "they are not a crystallographic point group.")
        keys.add(key)
        ops.append(m)
        return True

    for g in generators:
        add(np.asarray(g, dtype=np.int64))
    grew = True
    while grew:
        grew = False
        for a in list(ops):
            for b in list(ops):
                grew = add(a @ b) or grew
    return tuple(ops)


def format_op(m: ArrayLike) -> str:
    """``"h+k,-h,l"``: an operation as the NeXus Viewer writes it (``formatOp``),
    the form of the ``symmetry_ops`` attribute (:func:`parse_symmetry_ops`)."""
    return _triplet(np.asarray(m, dtype=np.int64))


def group_label(ops: Sequence[ArrayLike]) -> str:
    """The name the NeXus Viewer gives the group *ops*: the Laue class of
    :data:`LAUE_PRESETS` with the same operations, else ``"custom"``."""
    key = frozenset(_key(np.asarray(m)) for m in ops)
    for name, gens in LAUE_PRESETS:
        if frozenset(_key(m) for m in close_group(parse_generators(gens))) == key:
            return name
    return "custom"


@dataclass(frozen=True)
class LaueGroup:
    """A Laue class to average over: its ``label`` (the preset it matches, else
    ``"custom"``, :func:`group_label`), the ``generators`` it was given as, and
    the closed group ``ops`` in the viewer's order, identity first."""

    label: str
    generators: str
    ops: tuple[NDArray[np.int64], ...]

    @property
    def order(self) -> int:
        return len(self.ops)

    @property
    def ops_text(self) -> str:
        """The group as the viewer's export writes ``symmetry_ops``."""
        return "; ".join(format_op(m) for m in self.ops)


def laue_group(spec: str) -> LaueGroup:
    """The Laue class *spec* names: a preset of :data:`LAUE_PRESETS` by its
    name (``"6/mmm"``, ``"2/m (b unique)"``; any case), or generators in the
    syntax of :func:`parse_generators` (``"h+k,-h,l; -k,-h,-l; -h,-k,-l"``),
    closed into a group (:func:`close_group`).

    ``ValueError`` for empty text, a name that is no preset (text without a
    comma), or generators the viewer would not read.
    """
    text = str(spec if spec is not None else "").strip()
    if not text:
        raise ValueError("Choose a Laue class: a preset such as 6/mmm, or generators "
                         "such as h+k,-h,l; -k,-h,-l; -h,-k,-l.")
    gens = next((g for name, g in LAUE_PRESETS if name.lower() == text.lower()), None)
    if gens is None and "," not in text and text.lower() != "none":
        names = ", ".join(name for name, _ in LAUE_PRESETS)
        raise ValueError(f'"{text}" is not a Laue class here: choose one of {names}, or '
                         "give generators such as h+k,-h,l; -h,-k,-l.")
    generators = gens if gens is not None else text
    ops = close_group(parse_generators(generators))
    return LaueGroup(label=group_label(ops), generators=generators, ops=ops)


def metric_change(ops: Sequence[ArrayLike], ub_matrix: ArrayLike) -> float:
    """The largest change of the reciprocal metric under *ops*, relative to its
    largest element: ``max |RᵀG*R − G*| / max |G*|`` with ``G* = UBᵀ·UB``.

    The NeXus Viewer's ``metricChange`` ("Metric (UB) kept to x %"): 0 for true
    symmetries of the cell, small but not 0 for a pseudo-symmetric one (6/mmm
    changes a slightly distorted hexagonal cell by 0.8 %), large for operations
    of another setting.  Above :data:`METRIC_TOLERANCE` they are not symmetries
    of this lattice.  Scale-free, so the UB's 2π does not matter.
    """
    ub = np.asarray(ub_matrix, dtype=np.float64)
    g = ub.T @ ub
    scale = float(np.abs(g).max())
    worst = 0.0
    for m in ops:
        r = np.asarray(m, dtype=np.float64)
        worst = max(worst, float(np.abs(r.T @ g @ r - g).max()) / scale)
    return worst


@dataclass(frozen=True)
class AverageStats:
    """What :func:`symmetry_average` did.

    ``measured_before`` counts the voxels it pooled (measured and finite),
    ``measured_after`` the voxels measured after it: those, and every voxel an
    equivalent of which was measured.  ``orbits`` are the orbits it averaged.
    ``r_int`` is the agreement of the measured equivalents before averaging,
    ``Σ|I − ⟨I⟩| / Σ|I|`` over the measured voxels of the orbits measured at
    least twice (crystallography's R_int, over voxels), ``None`` without such
    an orbit.  ``sigma_defaulted`` counts the voxels whose σ is √|mean|
    because no member of their orbit had a known σ (0 when σ was estimated
    to begin with).
    """

    order: int
    measured_before: int
    measured_after: int
    orbits: int
    r_int: float | None
    sigma_defaulted: int

    @property
    def filled(self) -> int:
        """Voxels measured only at an equivalent position, filled by symmetry."""
        return self.measured_after - self.measured_before


def check_uniform_axes(vol: HKLVolume) -> None:
    """``ValueError`` unless every axis of *vol* has uniform bins, as the NeXus
    Viewer's ``indexMaps`` requires (to 10⁻⁴ of a step): symmetry operations
    are integer maps on bin indices only on a uniform grid."""
    for name, axis in zip("HKL", (vol.h_axis, vol.k_axis, vol.l_axis)):
        a = np.asarray(axis, dtype=np.float64)
        if a.size < 3:
            continue
        step = (a[-1] - a[0]) / (a.size - 1)
        if np.abs(np.diff(a) - step).max() > 1e-4 * abs(step):
            raise ValueError(f"Axis {name} has non-uniform bins; symmetry averaging needs "
                             "uniform bins.")


def _images(r: NDArray[np.int64], t: NDArray[np.int64], i: NDArray[np.intp],
            j: NDArray[np.intp], k: NDArray[np.intp],
            ) -> tuple[NDArray[np.intp], NDArray[np.intp], NDArray[np.intp]]:
    """The index image ``R·(i, j, k) + t`` (any broadcastable shapes), in intp."""
    rr = [[int(x) for x in row] for row in r]
    tt = [int(x) for x in t]
    return tuple(  # type: ignore[return-value]
        (rr[a][0] * i + rr[a][1] * j + rr[a][2] * k + tt[a]).astype(np.intp, copy=False)
        for a in range(3))


def _representatives(sym: GridSymmetry, lo: int, hi: int) -> NDArray[np.bool_]:
    """Which voxels of H planes ``lo:hi`` are their orbit's representative:
    the member with the smallest flat (C-order) index among those on the grid,
    so each orbit is taken once, from there (the viewer's rule)."""
    nh, nk, nl = sym.shape
    rep = np.ones((hi - lo, nk, nl), dtype=bool)
    i = np.arange(lo, hi, dtype=np.intp)[:, None]
    j = np.arange(nk, dtype=np.intp)[None, :]
    lidx = np.arange(nl, dtype=np.intp)
    if all(_l_separate(r) for r, _t in sym.index_ops):
        # L maps to ±L alone: whether an image precedes the voxel is decided by
        # its (H, K) image, and only where those coincide by its L image.
        zero = np.zeros(1, dtype=np.intp)
        for r, t in sym.index_ops[1:]:
            si, sj, _ = _images(r, t, i, j, zero[:, None])
            on = (si >= 0) & (si < nh) & (sj >= 0) & (sj < nk)
            before = on & ((si < i) | ((si == i) & (sj < j)))
            same = on & (si == i) & (sj == j)
            sl = int(r[2, 2]) * lidx + int(t[2])
            lon = (sl >= 0) & (sl < nl)
            rep &= ~((before[:, :, None] & lon) | (same[:, :, None] & (lon & (sl < lidx))))
        return rep
    i3, j3, l3 = i[:, :, None], j[:, :, None], lidx[None, None, :]
    for r, t in sym.index_ops[1:]:
        si, sj, sl = _images(r, t, i3, j3, l3)
        on = ((si >= 0) & (si < nh) & (sj >= 0) & (sj < nk) & (sl >= 0) & (sl < nl))
        before = (si < i3) | ((si == i3) & ((sj < j3) | ((sj == j3) & (sl < l3))))
        rep &= ~(on & before)
    return rep


def symmetry_average(
    vol: HKLVolume, sym: GridSymmetry, *, slab_voxels: int = 1 << 20,
) -> AverageStats:
    """Average *vol* over the group *sym*, **in place**, by the NeXus Viewer's
    rules (its export, ``symmetrizeForExport``).

    Each orbit (its members on the grid) is visited once, from its
    representative, the member with the smallest flat index.  Its measured
    members — ``mask`` and finite — are pooled with equal weight: their values
    are summed in float64 over the images ``g·x`` in the group's order
    (*sym*'s, :func:`close_group`'s for a Laue class), a member on a symmetry
    element once per operation that maps the representative onto it, so sum
    and count scale alike, and the mean is written to every member on the
    grid, in the volume's dtype.  ``mask`` is then True on every member of an
    orbit with a measured member; an orbit without one is left unmeasured as
    the loader leaves it (0, σ 0, masked).  σ is the mean's,
    ``√(Σσ²)/n`` over the n members whose σ is known, else (and when σ was
    only estimated, :attr:`HKLVolume.sigma_estimated`) √|mean|.

    The volume's float32 values give the viewer's result bit for bit (its
    volume is float32, its sums float64) when its flat order is this one, as
    in the files it and NEBULA3D write (D0 = L).  The work goes a slab of H
    planes at a time and touches only each slab's representatives and their
    images, so it holds no volume-sized temporary (the browser's heap).
    Operations must map the grid onto itself (:meth:`GridSymmetry.for_volume`).
    """
    data, mask = vol.data, vol.mask
    if data.shape != sym.shape or mask.shape != sym.shape:
        raise ValueError(f"volume shape {data.shape} != grid shape {sym.shape}")
    if not vol.sigma.flags.writeable or vol.sigma.shape != data.shape:
        vol.sigma = np.array(np.broadcast_to(vol.sigma, data.shape), dtype=data.dtype)
    sigma = vol.sigma
    measured_sigma = not vol.sigma_estimated
    nh, nk, nl = sym.shape
    planes = max(1, int(slab_voxels) // max(1, nk * nl))
    if not all(_l_separate(r) for r, _t in sym.index_ops):
        planes = max(1, planes // 4)  # the general test holds three index arrays per op

    before = 0
    for lo in range(0, nh, planes):
        block = data[lo:lo + planes]
        before += int(np.count_nonzero(mask[lo:lo + planes] & np.isfinite(block)))

    orbits = defaulted = 0
    dev_sum = abs_sum = 0.0
    shape = (nh, nk, nl)

    def on_grid(si: NDArray[np.intp], sj: NDArray[np.intp],
                sl: NDArray[np.intp]) -> NDArray[np.bool_]:
        return ((si >= 0) & (si < shape[0]) & (sj >= 0) & (sj < shape[1])
                & (sl >= 0) & (sl < shape[2]))

    for lo in range(0, nh, planes):
        hi = min(nh, lo + planes)
        ri, rj, rl = np.nonzero(_representatives(sym, lo, hi))
        if ri.size == 0:
            continue
        ri = (ri + lo).astype(np.intp, copy=False)
        rj = rj.astype(np.intp, copy=False)
        rl = rl.astype(np.intp, copy=False)
        n = ri.size
        total = np.zeros(n, dtype=np.float64)
        count = np.zeros(n, dtype=np.int32)
        stab = np.zeros(n, dtype=np.int32)
        var2 = np.zeros(n, dtype=np.float64) if measured_sigma else None
        known = np.zeros(n, dtype=np.int32) if measured_sigma else None
        # 1. Sum each orbit's measured values over its images, in the group's order.
        for r, t in sym.index_ops:
            si, sj, sl = _images(r, t, ri, rj, rl)
            pos = np.flatnonzero(on_grid(si, sj, sl))
            si, sj, sl = si[pos], sj[pos], sl[pos]
            v = data[si, sj, sl].astype(np.float64)
            ok = mask[si, sj, sl] & np.isfinite(v)
            total[pos] += np.where(ok, v, 0.0)
            count[pos] += ok
            stab[pos] += (si == ri[pos]) & (sj == rj[pos]) & (sl == rl[pos])
            if var2 is not None and known is not None:
                var = np.square(sigma[si, sj, sl].astype(np.float64))
                kn = ok & np.isfinite(var)
                var2[pos] += np.where(kn, var, 0.0)
                known[pos] += kn
        has = count > 0
        mean = np.zeros(n, dtype=np.float64)
        mean[has] = total[has] / count[has]
        # 2. How far the measured members were from their mean (R_int), on the
        #    orbits measured at least twice (count / stab distinct members).
        twice = has & (count >= 2 * stab)
        if twice.any():
            dev = np.zeros(n, dtype=np.float64)
            mag = np.zeros(n, dtype=np.float64)
            for r, t in sym.index_ops:
                si, sj, sl = _images(r, t, ri, rj, rl)
                pos = np.flatnonzero(on_grid(si, sj, sl) & twice)
                v = data[si[pos], sj[pos], sl[pos]].astype(np.float64)
                ok = mask[si[pos], sj[pos], sl[pos]] & np.isfinite(v)
                dev[pos] += np.where(ok, np.abs(v - mean[pos]), 0.0)
                mag[pos] += np.where(ok, np.abs(v), 0.0)
            dev_sum += float((dev[twice] / stab[twice]).sum())
            abs_sum += float((mag[twice] / stab[twice]).sum())
        value = mean.astype(data.dtype)
        if var2 is not None and known is not None:
            # The viewer's export writes σ² of the mean, or √|mean| without a
            # known σ, which loads back as written.
            err = np.sqrt(np.abs(mean))
            some = has & (known > 0)
            err[some] = np.sqrt(var2[some] * stab[some]) / known[some]
            short = has & (known == 0)
        else:
            # An estimated σ is √|I| of the values as stored, as the loader
            # takes it (from the export's errors_squared = |data|).
            err = np.sqrt(np.abs(value.astype(np.float64)))
            short = np.zeros(n, dtype=bool)
        err[~has] = 0.0
        err_out = err.astype(sigma.dtype)
        orbits += int(np.count_nonzero(has))
        # 3. Write the mean to every member on the grid (and unmeasure the
        #    orbits with no measured member, as the loader leaves them).
        members = np.zeros(n, dtype=np.int32)
        for r, t in sym.index_ops:
            si, sj, sl = _images(r, t, ri, rj, rl)
            pos = np.flatnonzero(on_grid(si, sj, sl))
            si, sj, sl = si[pos], sj[pos], sl[pos]
            data[si, sj, sl] = value[pos]
            sigma[si, sj, sl] = err_out[pos]
            mask[si, sj, sl] = has[pos]
            members[pos] += 1
        if short.any():
            defaulted += int((members[short] // stab[short]).sum())
    after = 0
    for lo in range(0, nh, planes):
        after += int(np.count_nonzero(mask[lo:lo + planes]))
    return AverageStats(
        order=sym.order, measured_before=before, measured_after=after, orbits=orbits,
        r_int=(dev_sum / abs_sum) if abs_sum > 0 else None, sigma_defaulted=defaulted)
