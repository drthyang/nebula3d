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
made invariant there (:meth:`GridSymmetry.orbit_any`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume

_TERM = re.compile(r"([+-]?)(\d*)([hkl])")


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

    Read from the ``symmetry_ops`` attribute of ``/entry`` (the layout the
    NeXus Viewer hands over); ``None`` when the file declares none.
    """
    import h5py

    path = Path(path)
    if path.suffix.lower() not in {".h5", ".hdf5", ".nxs"}:
        return None
    with h5py.File(path, "r") as f:
        entry = f.get("entry")
        text = entry.attrs.get("symmetry_ops") if isinstance(entry, h5py.Group) else None
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

    def h_forms(self) -> tuple[NDArray[np.int64], ...]:
        """Distinct images of the H coordinate under the group.

        A voxel ``x`` maps to ``M⁻¹x``, whose H coordinate is ``f·x`` with
        ``f`` row 0 of ``M⁻¹``.  A rule on H (an integer-H guard, protected
        fractional-H planes) holds at every equivalent voxel when it is applied
        to each ``f·x``.  ``(1, 0, 0)`` (H itself) comes first.
        """
        out: list[NDArray[np.int64]] = []
        for m in self.ops:
            f = np.rint(np.linalg.inv(m)[0]).astype(np.int64)
            if not any(np.array_equal(f, g) for g in out):
                out.append(f)
        return tuple(out)

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
