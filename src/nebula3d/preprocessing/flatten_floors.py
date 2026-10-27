# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The flatten's per-|Q|-shell floors, measured over the whole volume.

What is measured
----------------
The radial flatten (:mod:`nebula3d.preprocessing.radial_flatten`) fits its
pedestal to the **floor** of each thin spherical |Q| shell: the 25th percentile
of the shell's measured voxels, low enough to sit under the diffuse and the
Bragg residuals.  After a good flatten the floors sit near zero at every |Q|.
Floors that still rise (or fall) with |Q| are a pedestal the model left: most
often the inelastic background (thermal diffuse and multiphonon scattering
with neutrons, Compton scattering with X-rays), whose leading term grows as
Q², when the flatten's ``b·Q²`` term is off.

:func:`shell_floors` measures those floors on any volume, over every voxel of
each shell.  The NEBULA Pilot reads them from three planes through the origin
(``web/src/llm/metrics/flatten.ts``), which see the whole sphere only when the
background is isotropic.  Given the flatten's input as well (``before``), it
measures both volumes on the same shells, and the diffuse level the Pilot
divides the floors' span by.

The shells are the flatten's
----------------------------
They run ``q_step`` apart (0.05 Å⁻¹) from the smallest |Q| measured on the
flatten's input to the largest (:func:`~nebula3d.preprocessing.radial_flatten.
measured_q_range`, :func:`~nebula3d.preprocessing.radial_flatten.shell_edges`),
and each voxel is placed by :func:`nebula3d.core.q_bin_indices`, as the
flatten places it.  The floor is ``np.percentile`` (linear interpolation) of
the shell's measured voxels; a shell with fewer than ``min_count`` (20) has
none.  On the flatten's input the floors are therefore its own
``raw_levels``, value for value.  Each shell also has every voxel of the grid
it holds, measured or not (``totals``): the share measured says whether the
counts reach the shell.

Memory
------
A percentile is an order statistic, and the flatten finds each shell's by
sorting every measured voxel by shell at once: the shell indices, the sort's
permutation and the gathered values, several volume-sized arrays.  This
measurement reads the volume one slab of H planes at a time instead,
recomputing each slab's |Q| and shells, and finds each order statistic it
needs (the two ranks either side of the floor and of the median, in every
shell) by a radix select on sort keys that order as the values do:

1. the first pass counts each shell's measured voxels and histograms the top
   bits of their keys (an eighth to a half of an octave of value per bin with
   a few hundred shells), which names the bin each wanted rank falls in;
2. a later pass histograms the next ten bits of the voxels in those bins only
   (a thousandth of a bin), or, once a bin holds few enough voxels (or a
   single key), collects them;
3. the collected voxels (32 768 a bin at most, and half a million a pass in
   low-memory mode) are sorted and give the ranks exactly.

A bin whose voxels all hold one value is resolved without narrowing further.
A pass finds each value's bin by table lookups along those digits.  Three
passes are typical.  What stays resident is the histograms and tables (a few
MB), the voxels collected (capped per pass) and one slab's temporaries.  On
a 401×401×301 float32 volume and its flatten input, a third of it measured,
the traced peak is 29 MiB in low-memory mode
(:func:`~nebula3d.core.low_memory`, the browser: slabs of a quarter of a
million voxels), 0.16 of one volume, and 74 MiB natively, in 3 s; measured
throughout, 41 and 88 MiB in 6 s.  The flatten's own sort holds several
volumes.  Both modes give the same numbers.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume, low_memory, q_bin_indices
from nebula3d.preprocessing.radial_flatten import measured_q_range, shell_edges
from nebula3d.utils.counting import bincount

#: The flatten's defaults (``FlattenParams``): shell width (Å⁻¹), the floor's
#: percentile and the fewest measured voxels a shell's floor is taken from.
Q_STEP = 0.05
FLOOR_PERCENTILE = 25.0
MIN_COUNT = 20

#: The most shells a measurement takes (q_step 0.005 Å⁻¹ over 20 Å⁻¹).
MAX_SHELLS = 4096


@dataclass(frozen=True)
class _Budget:
    """What one mode may hold: voxels per slab, values collected per pass,
    the first pass's histogram bins, the bins a pass narrows (a histogram row
    each) and the indices batched per count."""

    slab_voxels: int
    collect: int
    first_bins: int
    rows: int
    batch: int


#: Low-memory mode (the browser) and native.
_LEAN = _Budget(slab_voxels=1 << 18, collect=1 << 19, first_bins=1 << 20, rows=1 << 10,
                batch=1 << 19)
_NATIVE = _Budget(slab_voxels=1 << 20, collect=1 << 21, first_bins=1 << 21, rows=1 << 12,
                  batch=1 << 20)

#: A bin with at most this many voxels is collected rather than narrowed.
_COLLECT_BIN = 1 << 15

#: Bits of the 32-bit key each narrowing reads.
_NEXT_BITS = 10

#: A guard: the select converges in four passes, a few more when it has more
#: bins than a pass narrows.
_MAX_PASSES = 32

_KEY_BITS = 32


@dataclass(frozen=True)
class ShellFloors:
    """The floors of a volume's |Q| shells (:func:`shell_floors`).

    Per shell (``S`` of them):

    ``q_edges`` (S + 1), ``centres``
        The shells' edges and centres (Å⁻¹).
    ``totals``
        The grid's voxels in the shell, measured or not.
    ``counts``
        The volume's measured voxels in the shell (``mask`` and finite).
    ``floors``
        ``np.percentile(values, percentile)`` of those voxels (linear
        interpolation); NaN for a shell with fewer than ``min_count``.
    ``medians``
        Their 50th percentile, the same way (flatten.ts's ``median``); NaN
        likewise.
    ``counts_before``, ``floors_before``, ``medians_before``
        The same of ``before``, when it was given; None otherwise.

    ``level`` is the diffuse level the floors' span is a share of: the 50th
    percentile of ``before`` over the voxels measured in both volumes when
    ``before`` was given (flatten.ts's ``base``), else of the volume's own
    measured voxels; NaN when there are none.  ``level_count`` is how many
    voxels it was taken over, and ``passes`` how many times the volume was read.
    """

    q_edges: NDArray[np.float64]
    centres: NDArray[np.float64]
    totals: NDArray[np.int64]
    counts: NDArray[np.int64]
    floors: NDArray[np.float64]
    medians: NDArray[np.float64]
    level: float
    level_count: int
    q_step: float
    percentile: float
    min_count: int
    counts_before: NDArray[np.int64] | None = None
    floors_before: NDArray[np.float64] | None = None
    medians_before: NDArray[np.float64] | None = None
    passes: int = 0


def shell_floors(
    vol: HKLVolume,
    *,
    before: HKLVolume | None = None,
    q_step: float = Q_STEP,
    percentile: float = FLOOR_PERCENTILE,
    min_count: int = MIN_COUNT,
    slab: int | None = None,
) -> ShellFloors:
    """The floor of every |Q| shell of *vol*, over the whole volume.

    Parameters
    ----------
    vol : HKLVolume
        The volume measured, e.g. the flattened stage.
    before : HKLVolume, optional
        The volume *vol* was made from, on the same grid (the flatten's input,
        the backfilled stage).  Its measured voxels set the shells, as they
        set the flatten's; both volumes are measured on them, and ``level``
        is taken of it.
    q_step : float
        Shell width (Å⁻¹), the flatten's ``q_step`` (default 0.05).
    percentile : float
        The floor's percentile, 0–100, the flatten's ``floor_percentile``
        (default 25).
    min_count : int
        A shell with fewer measured voxels has no floor (default 20).
    slab : int, optional
        H planes read at a time (default: about 2²⁰ voxels natively, 2¹⁸ in
        low-memory mode).  Changes the memory and the time, not the result.

    See :class:`ShellFloors` for what is returned and the module docstring for
    how it is computed.
    """
    q_step = float(q_step)
    percentile = float(percentile)
    if not (math.isfinite(q_step) and q_step > 0):
        raise ValueError(f"q_step must be a positive number of Å⁻¹, not {q_step!r}")
    if not 0.0 <= percentile <= 100.0:
        raise ValueError(f"percentile must lie in 0–100, not {percentile!r}")
    if int(min_count) < 1:
        raise ValueError(f"min_count must be at least 1, not {min_count!r}")
    min_count = int(min_count)
    if before is not None:
        _same_grid(vol, before)
    ref = before if before is not None else vol
    lean = low_memory()
    budget = _LEAN if lean else _NATIVE
    n_h = int(vol.data.shape[0])
    plane = max(1, int(vol.data[0].size)) if n_h else 1
    slab = max(1, int(slab) if slab is not None else budget.slab_voxels // plane)

    measured = measured_q_range(ref, slab=slab)
    if measured is None:
        return _empty(before is not None, q_step, percentile, min_count)
    q0, q1 = measured
    edges = shell_edges(q0, q1, q_step)
    nb = int(edges.size - 1)
    if nb > MAX_SHELLS:
        raise ValueError(f"q_step {q_step:g} Å⁻¹ cuts {q0:.3g}–{q1:.3g} Å⁻¹ into {nb} shells, "
                         f"more than {MAX_SHELLS}")
    # The flatten clips the measured voxels at the range's ends into the end
    # shells; one more edge just past q1 takes in those at or past the last
    # edge (np.arange can end a rounding short of q1) and no grid voxel beyond.
    ext = edges if edges[-1] > q1 else np.append(edges, np.nextafter(q1, np.inf))
    n_ext = int(ext.size - 1)

    pair = before is not None
    level_group = 2 * nb if pair else nb
    n_groups = level_group + 1
    totals = np.zeros(nb, dtype=np.int64)
    reads = [0]

    def shells(lo: int, hi: int, first: bool) -> NDArray[np.int32]:
        """Each voxel's shell in H planes lo … hi − 1 (−1: outside them all),
        recomputed by every pass: keeping them would cost a volume of int16."""
        d = q_bin_indices(vol.h_axis[lo:hi], vol.k_axis, vol.l_axis, vol.ub_matrix, ext,
                          slab=hi - lo)
        b = d - 1
        b[(d < 1) | (d > n_ext)] = -1
        np.minimum(b, nb - 1, out=b)
        if first:
            totals[:] += bincount(b[b >= 0], minlength=nb)
        return b

    def stream() -> Iterator[tuple[NDArray[np.integer], NDArray[np.floating]]]:
        first = reads[0] == 0
        reads[0] += 1
        for lo in range(0, n_h, slab):
            hi = min(n_h, lo + slab)
            b = shells(lo, hi, first)
            inside = b >= 0
            data = vol.data[lo:hi]
            ok = vol.mask[lo:hi] & np.isfinite(data)
            sel = ok & inside
            yield b[sel], data[sel]
            if before is None:
                yield np.full(int(ok.sum()), level_group, dtype=np.int32), data[ok]
                continue
            data_b = before.data[lo:hi]
            ok_b = before.mask[lo:hi] & np.isfinite(data_b)
            sel = ok_b & inside
            yield b[sel].astype(np.int32) + np.int32(nb), data_b[sel]
            ok &= ok_b  # the level: voxels measured in both
            yield np.full(int(ok.sum()), level_group, dtype=np.int32), data_b[ok]

    shell_quantiles = (percentile, 50.0)

    def ranks_for(counts: NDArray[np.int64]) -> list[list[int]]:
        out: list[list[int]] = []
        for g in range(n_groups):
            n = int(counts[g])
            if g == level_group:
                out.append(_percentile_ranks(n, 50.0) if n else [])
            elif n < min_count:
                out.append([])
            else:
                out.append(sorted({r for p in shell_quantiles for r in _percentile_ranks(n, p)}))
        return out

    counts, values, passes = _select(
        stream, n_groups, ranks_for, exact_keys=_float32_storage(vol, before), budget=budget)

    def column(g0: int, p: float) -> NDArray[np.float64]:
        out = np.full(nb, np.nan)
        for b in range(nb):
            n = int(counts[g0 + b])
            if n >= min_count:
                out[b] = _percentile_value(values, g0 + b, n, p)
        return out

    n_level = int(counts[level_group])
    return ShellFloors(
        q_edges=edges.astype(np.float64), centres=0.5 * (edges[:-1] + edges[1:]),
        totals=totals, counts=counts[:nb].copy(),
        floors=column(0, percentile), medians=column(0, 50.0),
        level=_percentile_value(values, level_group, n_level, 50.0) if n_level else math.nan,
        level_count=n_level, q_step=q_step, percentile=percentile, min_count=min_count,
        counts_before=counts[nb:2 * nb].copy() if pair else None,
        floors_before=column(nb, percentile) if pair else None,
        medians_before=column(nb, 50.0) if pair else None,
        passes=passes,
    )


def _same_grid(vol: HKLVolume, other: HKLVolume) -> None:
    if (vol.data.shape != other.data.shape
            or not all(np.array_equal(a, b) for a, b in
                       ((vol.h_axis, other.h_axis), (vol.k_axis, other.k_axis),
                        (vol.l_axis, other.l_axis)))
            or not np.array_equal(np.asarray(vol.ub_matrix), np.asarray(other.ub_matrix))):
        raise ValueError("before must be on the volume's grid: the same shape, axes and UB")


def _float32_storage(*vols: HKLVolume | None) -> bool:
    """Whether every value is a float32, so one sort key is one value."""
    return all(v is None or v.data.dtype == np.float32 for v in vols)


def _empty(pair: bool, q_step: float, percentile: float, min_count: int) -> ShellFloors:
    """No measured voxel: no shells."""
    none_i = np.zeros(0, dtype=np.int64)
    none_f = np.zeros(0, dtype=np.float64)
    return ShellFloors(
        q_edges=none_f, centres=none_f, totals=none_i, counts=none_i, floors=none_f,
        medians=none_f, level=math.nan, level_count=0, q_step=q_step,
        percentile=percentile, min_count=min_count,
        counts_before=none_i if pair else None, floors_before=none_f if pair else None,
        medians_before=none_f if pair else None,
    )


# ---------------------------------------------------------------------------
# Percentiles from order statistics, as np.percentile computes them
# ---------------------------------------------------------------------------
def _virtual_index(n: int, percentile: float) -> float:
    """np.percentile's position of *percentile* among *n* sorted values
    (``method="linear"``): ``(n − 1) · percentile / 100``, in float64."""
    return float((n - 1) * np.true_divide(percentile, np.float64(100.0)))


def _percentile_ranks(n: int, percentile: float) -> list[int]:
    """The 0-based ranks np.percentile reads to interpolate *percentile*."""
    vi = _virtual_index(n, percentile)
    if vi >= n - 1:
        return [n - 1]
    lo = math.floor(vi)
    return [lo, lo + 1]


def _percentile_value(values: dict[tuple[int, int], float], group: int, n: int,
                      percentile: float) -> float:
    """np.percentile of the group's *n* values from the order statistics found.

    The interpolation is numpy's own: its quantile of the two neighbours in
    rank at the same fraction between them is the same expression it
    evaluates on the whole array, so the result matches it bit for bit.
    """
    vi = _virtual_index(n, percentile)
    if vi >= n - 1:
        return values[(group, n - 1)]
    lo = math.floor(vi)
    pair = np.array([values[(group, lo)], values[(group, lo + 1)]], dtype=np.float64)
    return float(np.quantile(pair, vi - lo))


# ---------------------------------------------------------------------------
# Exact order statistics of many groups of values, streamed (a radix select)
# ---------------------------------------------------------------------------
def _sort_keys(values: NDArray[np.floating]) -> NDArray[np.uint32]:
    """Unsigned 32-bit keys that sort as the (finite) values do.

    The float32 bit pattern with its sign bit set for a positive value and
    every bit flipped for a negative one.  Rounding a float64 to float32 never
    reverses an order, so the key is non-decreasing in the value; for float32
    values it is one-to-one (−0 sits just below +0).
    """
    with np.errstate(over="ignore"):
        bits = np.asarray(values, dtype=np.float32).view(np.uint32)
    flip = (bits >> np.uint32(31)) * np.uint32(0x7FFFFFFF) | np.uint32(0x80000000)
    return bits ^ flip


def _key_value(key: int) -> float:
    """The float32 value whose sort key is *key* (:func:`_sort_keys` inverted)."""
    bits = key ^ 0x80000000 if key & 0x80000000 else ~key & 0xFFFFFFFF
    return float(np.array([bits], dtype=np.uint32).view(np.float32)[0])


@dataclass
class _Bin:
    """A run of keys of one group, holding at least one wanted rank."""

    group: int
    start: int          # its first key
    bits: int           # it holds 2**bits keys
    below: int          # the group's values with a smaller key
    count: int          # the group's values in it
    ranks: list[int]    # the wanted ranks in it


class _Bincount:
    """``np.bincount`` summed over many index arrays, a batch at a time (one
    ``minlength``-long count per batch, not one per slab).  The indices are
    cast to ``intp`` first: int32 in the browser's 32-bit WASM build, where
    ``np.bincount`` need not take int64."""

    def __init__(self, n_bins: int, batch: int) -> None:
        self.total = np.zeros(n_bins, dtype=np.int64)
        self._parts: list[NDArray[np.int64]] = []
        self._size = 0
        self._batch = batch

    def add(self, index: NDArray[np.int64]) -> None:
        self._parts.append(index)
        self._size += int(index.size)
        if self._size >= self._batch:
            self.flush()

    def flush(self) -> NDArray[np.int64]:
        if self._parts:
            index = np.concatenate(self._parts).astype(np.intp, copy=False)
            self.total += bincount(index, minlength=self.total.size)
            self._parts, self._size = [], 0
        return self.total


def _extremes(lo: NDArray[np.float64], hi: NDArray[np.float64], index: NDArray[np.integer],
              values: NDArray[np.floating]) -> None:
    """Each group's least and greatest value so far, in place.  The values are
    widened to float64 first: ``ufunc.at`` casting float32 into a float64
    array is some twenty times slower than on matching types."""
    v = values.astype(np.float64, copy=False)
    np.minimum.at(lo, index, v)
    np.maximum.at(hi, index, v)


def _split(group: int, start: int, bits: int, below: int, hist: NDArray[np.int64],
           ranks: list[int], digit: int) -> list[_Bin]:
    """The bins one level down that *ranks* fall in: *hist* counts the
    group's values in each of the ``2**digit`` equal parts of the keys
    ``start … start + 2**bits − 1``."""
    cum = np.cumsum(hist)
    sub = bits - digit
    out: dict[int, _Bin] = {}
    for r in ranks:
        j = int(np.searchsorted(cum, r - below, side="right"))
        part = out.get(j)
        if part is None:
            part = out[j] = _Bin(group, start + (j << sub), sub,
                                 below + (int(cum[j - 1]) if j else 0), int(hist[j]), [])
        part.ranks.append(r)
    return list(out.values())


Stream = Callable[[], Iterator[tuple[NDArray[np.integer], NDArray[np.floating]]]]


def _select(
    stream: Stream,
    n_groups: int,
    ranks_for: Callable[[NDArray[np.int64]], list[list[int]]],
    *,
    exact_keys: bool,
    budget: _Budget,
) -> tuple[NDArray[np.int64], dict[tuple[int, int], float], int]:
    """Exact order statistics of many groups of values, read by passes.

    ``stream()`` yields ``(group, values)`` chunks covering every value once,
    the same each time it is called.  ``ranks_for(counts)`` names the 0-based
    ranks wanted in each group.  Returns the counts, ``{(group, rank): value}``
    and the number of passes.  *exact_keys*: every value is a float32 (one key,
    one value).  At most ``budget.collect`` values are held per pass, unless
    one bin of a single key alone holds more.
    """
    first = max(4, min(12, int(math.log2(max(1, budget.first_bins // max(1, n_groups))))))
    shift = np.uint32(_KEY_BITS - first)
    counts = np.zeros(n_groups, dtype=np.int64)
    lo = np.full(n_groups, np.inf)
    hi = np.full(n_groups, -np.inf)
    hist = _Bincount(n_groups << first, batch=budget.batch)
    for g, v in stream():
        if g.size == 0:
            continue
        counts += bincount(g, minlength=n_groups)
        _extremes(lo, hi, g, v)
        hist.add((g.astype(np.int64) << first) | (_sort_keys(v) >> shift))
    rows = hist.flush().reshape(n_groups, 1 << first)
    del hist

    values: dict[tuple[int, int], float] = {}
    frontier: list[_Bin] = []
    for group, ranks in enumerate(ranks_for(counts)):
        if not ranks:
            continue
        if lo[group] == hi[group]:  # one value throughout
            values.update({(group, r): float(lo[group]) for r in ranks})
            continue
        frontier += _split(group, 0, _KEY_BITS, 0, rows[group], ranks, first)
    del rows

    passes = 1
    while frontier:
        narrow, collect, later = _plan(frontier, exact_keys, budget, values)
        if narrow or collect:
            passes += 1
            if passes > _MAX_PASSES:
                raise RuntimeError("shell floors: the order statistics did not converge")
            later += _pass(stream, n_groups, first, narrow, collect, values, budget.batch)
        frontier = later
    return counts, values, passes


def _plan(frontier: list[_Bin], exact_keys: bool, budget: _Budget,
          values: dict[tuple[int, int], float]) -> tuple[list[_Bin], list[_Bin], list[_Bin]]:
    """Which bins the next pass narrows, which it collects and which wait.

    A bin of one key is collected (or, with float32 values, resolved here: its
    key is its value).  Small bins are collected, smallest first, while the
    pass's budget lasts; the rest are narrowed, which holds no values, up to
    ``budget.rows`` of them.
    """
    narrow: list[_Bin] = []
    small: list[_Bin] = []
    for b in frontier:
        if b.bits == 0 and exact_keys:
            v = _key_value(b.start)
            values.update({(b.group, r): v for r in b.ranks})
        elif b.bits == 0 or b.count <= _COLLECT_BIN:
            small.append(b)
        else:
            narrow.append(b)
    collect: list[_Bin] = []
    later: list[_Bin] = []
    held = 0
    for b in sorted(small, key=lambda b: b.count):
        if not collect or held + b.count <= budget.collect:
            collect.append(b)
            held += b.count
        elif b.bits:
            narrow.append(b)
        else:
            later.append(b)
    later += narrow[budget.rows:]
    return narrow[:budget.rows], collect, later


def _digit_widths(first: int) -> list[int]:
    """The bits of the key each level of the select reads: *first*, then
    ``_NEXT_BITS`` at a time (the last level what is left)."""
    widths = [first]
    while sum(widths) < _KEY_BITS:
        widths.append(min(_NEXT_BITS, _KEY_BITS - sum(widths)))
    return widths


class _Lookup:
    """Which of a pass's bins each value falls in, read off its key's digits.

    One table per level of the select, indexed by the node above and the
    next digit (by the group and the first digit at the top): the index of a
    bin of the pass (0 or more), a node narrowed by an earlier pass whose
    bins lie further down (−2 − its index at that level), or nothing (−1).
    A value costs one gather per level it goes down, where a search among
    a thousand bins cost ten comparisons.
    """

    def __init__(self, bins: list[_Bin], n_groups: int, first: int) -> None:
        widths = _digit_widths(first)
        read = [int(x) for x in np.cumsum(widths)]   # bits read after each level
        self.first, self.widths = first, widths
        self.shifts = [np.uint32(_KEY_BITS - r) for r in read]
        nodes: list[dict[int, int]] = [{} for _ in widths]
        paths: list[list[int]] = []
        for b in bins:
            depth = read.index(_KEY_BITS - b.bits) + 1
            pos = (b.group << first) | (b.start >> (_KEY_BITS - first))
            path = [pos]
            for k in range(1, depth):
                node = nodes[k - 1].setdefault(pos, len(nodes[k - 1]))
                digit = (b.start >> (_KEY_BITS - read[k])) & ((1 << widths[k]) - 1)
                pos = (node << widths[k]) | digit
                path.append(pos)
            paths.append(path)
        depth = max((len(p) for p in paths), default=1)
        self.tables = [np.full(n_groups << first, -1, dtype=np.int32)]
        self.tables += [np.full(len(nodes[k - 1]) << widths[k], -1, dtype=np.int32)
                        for k in range(1, depth)]
        for i, path in enumerate(paths):
            for k, pos in enumerate(path[:-1]):
                self.tables[k][pos] = -2 - nodes[k][pos]
            self.tables[len(path) - 1][path[-1]] = i

    def __call__(self, group: NDArray[np.integer], keys: NDArray[np.uint32]) -> NDArray[np.int32]:
        """Each value's bin (its index in the pass's list), −1 for none."""
        t = self.tables[0][(group.astype(np.int64) << self.first)
                           | (keys >> self.shifts[0]).astype(np.int64)]
        out = np.maximum(t, -1)
        walk = np.flatnonzero(t <= -2)
        t = t[walk]
        for k in range(1, len(self.tables)):
            if walk.size == 0:
                break
            digit = (keys[walk] >> self.shifts[k]) & np.uint32((1 << self.widths[k]) - 1)
            t = self.tables[k][((-2 - t).astype(np.int64) << self.widths[k])
                               | digit.astype(np.int64)]
            hit = t >= 0
            out[walk[hit]] = t[hit]
            walk, t = walk[t <= -2], t[t <= -2]
        return out


def _pass(stream: Stream, n_groups: int, first: int, narrow: list[_Bin],
          collect: list[_Bin], values: dict[tuple[int, int], float],
          batch: int) -> list[_Bin]:
    """One pass: histogram the next bits of the keys in *narrow*'s bins and
    gather the values in *collect*'s; resolve what that settles and return
    the bins one level down."""
    bins = narrow + collect           # a bin's index: a histogram row, then a slot
    n_narrow = len(narrow)
    lookup = _Lookup(bins, n_groups, first)
    first_key = np.array([b.start for b in bins], dtype=np.uint32)
    digits = [min(_NEXT_BITS, b.bits) for b in narrow]
    down = np.array([b.bits - min(_NEXT_BITS, b.bits) for b in bins], dtype=np.uint32)

    width = 1 << _NEXT_BITS
    hist = _Bincount(n_narrow * width, batch=batch)
    lo = np.full(n_narrow, np.inf)
    hi = np.full(n_narrow, -np.inf)
    got_values: list[NDArray[np.floating]] = []
    got_slots: list[NDArray[np.int32]] = []
    for g, v in stream():
        if g.size == 0:
            continue
        keys = _sort_keys(v)
        j = lookup(g, keys)
        inside = j >= 0
        if not inside.any():
            continue
        j, v, keys = j[inside], v[inside], keys[inside]
        m = j < n_narrow
        if m.any():
            jm = j[m].astype(np.intp)
            hist.add(jm * width + ((keys[m] - first_key[jm]) >> down[jm]).astype(np.int64))
            _extremes(lo, hi, jm, v[m])
        m = ~m
        if m.any():
            got_values.append(v[m])
            got_slots.append(j[m] - np.int32(n_narrow))

    later: list[_Bin] = []
    if narrow:
        rows = hist.flush().reshape(len(narrow), width)
        for i, b in enumerate(narrow):
            if lo[i] == hi[i]:  # one value throughout the bin
                values.update({(b.group, r): float(lo[i]) for r in b.ranks})
                continue
            later += _split(b.group, b.start, b.bits, b.below,
                            rows[i, :1 << digits[i]], b.ranks, digits[i])
    if collect:
        held = np.concatenate(got_values) if got_values else np.zeros(0)
        slots = np.concatenate(got_slots) if got_slots else np.zeros(0, dtype=np.int32)
        order = np.argsort(slots, kind="stable")
        held, slots = held[order], slots[order]
        bounds = np.searchsorted(slots, np.arange(len(collect) + 1))
        for i, b in enumerate(collect):
            seg = np.sort(held[bounds[i]:bounds[i + 1]])
            if seg.size != b.count:
                raise RuntimeError("shell floors: a pass read a different volume")
            values.update({(b.group, r): float(seg[r - b.below]) for r in b.ranks})
    return later


__all__ = ["FLOOR_PERCENTILE", "MIN_COUNT", "Q_STEP", "ShellFloors", "shell_floors"]
