# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""The backfill's texture check, on the punch's 3-D holes and their 3-D rims.

What is measured
----------------
Every Bragg punch sits on a reciprocal-lattice node, so fills that are
systematically brighter (or darker) than the diffuse around their holes print
a lattice of spots (or dimples) onto the diffuse: a texture with the
lattice's period, which the 3D-ΔPDF turns into features at the lattice
vectors, where the real pair correlations are.  The NEBULA Pilot's
``texture_check`` (``web/src/llm/metrics/texture.ts``) asks whether the fills
have such a sign on cuts through the volume, each filled hole against the
range its measured rim allows.  :func:`fill_texture` asks the same of every
hole of the volume, with the hole and its rim taken in 3-D.  It measures; it
changes no fill and no verdict.

The rule is texture.ts's
------------------------
The definitions are texture.ts's, each taken from a cut's plane to the
volume:

- **Holes.**  With the punch's record (the voxels the punch removed, which the
  punch stage writes into its output; :func:`nebula3d.pipeline.
  read_punch_record`), the recorded voxels the backfilled volume holds.
  Without it, texture.ts's own test: unmeasured in the punched volume (mask
  cleared or value not finite: NaN on a cut) and measured in the backfilled
  one.  That test also takes the never-measured voxels the backfill fills
  (dead voxels, an enclosed gap), which hold no node; the record leaves them
  out.  A hole is a 6-connected component (texture.ts's 4-connected
  components are the 6-neighbours that lie in its plane).
- **The rim.**  The voxels 1 to ``rim`` (4) voxels from the hole, chessboard
  distance (in 3-D, the shell the hole's 26-neighbour dilation reaches in one
  to four steps), that are measured in the punched volume, in no hole, and
  that the fill left as they were (the backfilled value equals the punched
  one).  The Laplace fill also rewrites a band ``laplace_gap`` voxels deep
  outside the punch (its gap band, see :func:`nebula3d.analysis.bragg_fill.
  backfill_bragg`): that band is fill, not rim, so the rim starts past it.
  Four voxels is texture.ts's depth, and the depth a trend needs: the band
  (one voxel by default, more where the symmetry closes it) takes the face
  neighbours of the first ring, so a shell one or two voxels deep would leave
  the trend one ring or none, and four leave it two at least.  Around a ball
  three voxels in radius the 3-D rim holds about 2400 voxels, where a cut
  through its centre holds about 160.
- **Where a voxel sits.**  A rim voxel at ``s`` = its chessboard distance from
  the hole (1 to 4); a hole voxel at ``s`` = 1 − its chessboard distance to
  the nearest voxel outside the hole (0 on the hole's outer layer, negative
  inside).
- **The rim's trend** ``I = a + b·s`` by least squares; its **σ**, 1.4826 ×
  the median absolute deviation of the rim about the trend; its **level**,
  the rim's median, the local diffuse level.  A hole whose rim has fewer than
  ``min_rim`` (8) voxels or a single ring, or σ = 0, is not judged.
- **The range the rim allows**, from ``edge`` = a + b, the diffuse at the
  hole's edge carried in (a flat continuation), to ``peaked`` = a + b·s̄, the
  rim's rise continued linearly to the hole's voxels (s̄ their mean ``s``; a
  node-peaked continuation).  The diffuse peaks at the nodes (thermal diffuse
  scattering, short-range order at lattice vectors), so a sound fill can sit
  anywhere between the two.  The **fill** is the mean of the backfilled
  values over the hole; its **bias** is its signed distance outside the range,
  0 inside it.
- **The rule.**  Over the judged holes: the median of bias / σ and of bias /
  \\|level\\| (holes at level 0 left out of the latter), the shares filled above
  the range (bias > 0) and below it (bias < 0).  The fills are systematically
  off their surroundings (``systematic_fill_bias``) when at least
  ``min_holes`` (5) holes are judged, the median in σ is ``min_sigma`` (0.5)
  or more in size, the median in level ``floor`` (0.2, texture.ts's
  ``FILL_BIAS_FLOOR``) or more, and ``one_way`` (0.75) of the judged holes or
  more lean the median's way.  These limits are provisional, derived on the
  validation's dev cases; they are parameters here, at texture.ts's values.
- **Room for the rim.**  The rim's trend is the diffuse falling away from the
  hole's own node, which holds on the node's side of the midpoint to the next
  node only: past it the diffuse turns toward that one.  A hole that reaches
  ``r`` voxels from its centre (chessboard: its bounding box's farthest face),
  with its rim ``rim`` voxels more, keeps the rim on its own side when the
  nodes are 2·(r + ``rim``) voxels apart or more.  The nodes are the grid's
  (``node_spacing``): those of integer h, k and l, one r.l.u. apart along the
  axis with the coarsest step (a supercell's parent nodes lie further apart,
  so this errs toward not judging).  The rule reads the median hole, so the
  fills are judged only where the median hole has that room; else they are
  not (``not_judged``: "grid too coarse: …", and ``systematic_fill_bias`` is
  False).  The fill's gap band is the rim's first ring or two, inside its
  ``rim``, so it adds nothing to the reach; it leaves the trend two rings or
  more while it is two voxels deep or less (a thinner rim is a hole's "thin
  rim").  On the validation's dev crystal (a = 3.9 Å) the 81-point grid puts
  the nodes 10 voxels apart, and its holes reach 3 voxels (cuts through them,
  2): their rims need 14 (12).  The 161-point grid puts them 20 apart, with
  holes of the same reach.

Beyond texture.ts, each hole's facts are returned, and the shares of the
judged holes filled above (below) their range by ``floor`` of their level or
more (``above_floor_fraction``, ``below_floor_fraction``).  texture.ts's
azimuthal texture (sector means around each \\|Q\\| shell, before the punch and
after the fill) is not a hole's measure, and stays per cut.

Why 3-D
-------
A cut sees a hole as the section it cuts out of it, and its rim as the ring
around that section in the cut's plane.  Through the hole's centre that is
the hole's widest section and the diffuse's radial trend around the node.
Through its edge it is a small section of a hole whose rim, in the plane, lies
off the node, where the diffuse is rounded: the trend continued into the
section, and with it the range the rim allows, depend on where the cut
crosses the hole, so one fill reads differently on two cuts.  Peaks off the
principal planes (satellites, a lower symmetry's nodes) are crossed by
``texture_check``'s three cuts at their edges only, or not at all.  Here each
hole is judged once, from all of its rim.

Memory
------
A volume-sized label array would cost four boolean volumes.  The holes are
found instead one slab of H planes at a time: each slab's hole mask is
labelled (``scipy.ndimage.label``, 6-connected), the labels of two adjacent
slabs that touch across their common face are joined (union–find), and each
hole keeps only its bounding box, a voxel of it, its size and its voxels'
index sums.  Each hole is then measured inside its bounding box grown by the
rim: the hole masks there are labelled again and the hole is the component
that holds its voxel, so a box crossed by another hole is no trouble.  What
stays resident is a slab's labels and masks (a quarter of a million voxels in
low-memory mode, :func:`~nebula3d.core.low_memory`, the browser; four million
natively), one hole's box and the per-hole facts.  Both modes give the same
numbers: the holes, their order (by their first voxel in C order) and every
value are independent of the slab.  On a 401×401×301 float32 pair with 6000
holes three voxels in radius, the traced peak is 7.4 MiB in low-memory mode
(0.16 of one boolean volume) and 23 MiB natively, in 1.4 s either way; the
punch's record the caller reads is one boolean volume more.  A hole whose box
with its rim exceeds :data:`MAX_REGION_VOXELS` is not judged; it is no Bragg
punch (the backfill treats a masked region past two million voxels as
unmeasured coverage, see :data:`~nebula3d.analysis.bragg_fill.
LAPLACE_MAX_UNKNOWNS`), and one just under it peaks at 64 MiB.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from nebula3d.core import HKLVolume, low_memory

#: texture.ts's ``RIM``: the rim's depth (voxels, chessboard distance).
RIM = 4
#: texture.ts: a rim with fewer measured voxels left as they were is not judged.
MIN_RIM_VOXELS = 8
#: texture.ts's limits for a systematic fill bias: the median bias in the
#: rim's σ, the share of the judged holes leaning the median's way, the fewest
#: judged holes, and ``FILL_BIAS_FLOOR``, the median bias in units of the
#: local diffuse level.  Provisional (derived on the dev cases).
MIN_SIGMA = 0.5
ONE_WAY = 0.75
MIN_HOLES = 5
FILL_BIAS_FLOOR = 0.2

#: The most voxels a hole's bounding box grown by the rim may hold to be
#: judged (a 161³ box): one hole's arrays then stay under 70 MiB.
MAX_REGION_VOXELS = 1 << 22

#: H planes are read so that a slab holds about this many voxels.
_SLAB_VOXELS_LEAN = 1 << 18
_SLAB_VOXELS_NATIVE = 1 << 22

#: Why a hole was not judged (``HoleTexture.not_judged``).
NotJudged = Literal["thin rim", "flat rim", "too large", "no outside"]

_CROSS = ndimage.generate_binary_structure(3, 1)  # 6-connectivity


@dataclass(frozen=True)
class HoleTexture:
    """Each hole's facts (:func:`hole_texture`).

    Per hole (``n`` of them, in C order of each hole's first voxel):

    ``voxels``
        The hole's voxels.
    ``centre``, ``centre_hkl``
        The mean position of its voxels, as (fractional) grid indices and in
        r.l.u. (``n`` × 3).
    ``rim_voxels``
        Its rim's voxels (measured, in no hole, left as they were by the fill,
        1 to ``rim`` voxels from the hole).
    ``fill``
        The mean backfilled value over the hole.
    ``level``
        The rim's median, the local diffuse level.
    ``sigma``
        The rim's robust σ about its trend (1.4826 × MAD).
    ``slope``
        The trend's ``b``: its change per voxel outward (negative when the
        diffuse rises toward the hole).
    ``edge``, ``peaked``
        The range the rim allows: the trend at ``s`` = 1 (a + b) and continued
        to the hole's mean ``s`` (a + b·s̄).
    ``bias``
        The fill's signed distance outside that range (0 inside).
    ``not_judged``
        Why a hole was not judged (:data:`NotJudged`), or None.  For a hole
        not judged ``level`` … ``bias`` are NaN (``fill`` too when its box is
        too large), and ``rim_voxels`` is 0 when it was not measured.
    ``reach``
        How far the hole reaches from its centre, in voxels (chessboard: its
        bounding box's farthest face).

    ``holes_from`` is ``"punch_record"`` or ``"masks"`` (texture.ts's test);
    ``rim`` and ``min_rim`` are the rim's depth and fewest voxels;
    ``node_spacing`` the voxels between neighbouring nodes of the grid's cell,
    along its coarsest axis (the module docstring, *Room for the rim*).
    """

    voxels: NDArray[np.int64]
    centre: NDArray[np.float64]
    centre_hkl: NDArray[np.float64]
    rim_voxels: NDArray[np.int64]
    fill: NDArray[np.float64]
    level: NDArray[np.float64]
    sigma: NDArray[np.float64]
    slope: NDArray[np.float64]
    edge: NDArray[np.float64]
    peaked: NDArray[np.float64]
    bias: NDArray[np.float64]
    not_judged: tuple[NotJudged | None, ...]
    holes_from: Literal["punch_record", "masks"]
    rim: int
    min_rim: int
    reach: NDArray[np.float64]
    node_spacing: float

    @property
    def n(self) -> int:
        return int(self.voxels.size)

    @property
    def room_needed(self) -> float:
        """The node spacing the median hole needs to keep its rim on its own
        side of the midpoint, 2·(its reach + ``rim``), in voxels (NaN without
        holes)."""
        return 2.0 * (float(np.median(self.reach)) + self.rim) if self.n else math.nan

    @property
    def too_coarse(self) -> str | None:
        """Why the grid is too coarse for the rule (the median hole's rim
        reaches past the midpoint to the next node), or None."""
        need = self.room_needed
        if not need > self.node_spacing:
            return None
        reach = f"{need / 2 - self.rim:.2g}"
        return (f"grid too coarse: the nodes are {self.node_spacing:.3g} voxels apart, under "
                f"{need:.3g}: a hole reaches {reach} voxel{'' if reach == '1' else 's'} and its "
                f"rim {self.rim} more")

    @property
    def judged(self) -> NDArray[np.bool_]:
        """Which holes were judged."""
        return np.array([r is None for r in self.not_judged], dtype=bool)

    @property
    def bias_sigma(self) -> NDArray[np.float64]:
        """Each hole's bias in its rim's σ (NaN when not judged)."""
        with np.errstate(invalid="ignore", divide="ignore"):
            return self.bias / self.sigma

    @property
    def bias_level(self) -> NDArray[np.float64]:
        """Each hole's bias in units of its local diffuse level, \\|level\\|
        (NaN when not judged or at level 0)."""
        scale = np.abs(self.level)
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(scale > 0, self.bias / scale, np.nan)


@dataclass(frozen=True)
class FillTexture:
    """The fills' texture over the volume (:func:`fill_texture`).

    ``holes`` are the per-hole facts; the rest is texture.ts's summary over
    the judged holes, with the limits it was judged by.

    ``n_holes``, ``n_judged``
        The holes, and those judged.
    ``judged``
        The rule applies: the grid leaves the median hole room for its rim
        (``not_judged`` is None) and enough holes were judged (``n_judged ≥
        min_holes``); else the fills are not judged and
        ``systematic_fill_bias`` is False.
    ``median_fill_bias_sigma``, ``median_fill_bias_level``
        The median bias in the rim's σ and in units of the local level (NaN
        with no hole judged, or none at a level other than 0).
    ``above_fraction``, ``below_fraction``
        The shares of the judged holes filled above, and below, the range
        their rim allows (NaN with none judged).
    ``above_floor_fraction``, ``below_floor_fraction``
        The shares of the judged holes filled above (below) it by ``floor`` of
        their level or more.
    ``systematic_fill_bias``
        texture.ts's verdict: the fills are systematically off their
        surroundings, in one direction.
    ``not_judged``
        Why the grid is too coarse for the rule (:attr:`HoleTexture.too_coarse`:
        the median hole's rim reaches past the midpoint to the next node), or
        None.  The holes' facts and the summary are still measured.
    """

    holes: HoleTexture
    n_holes: int
    n_judged: int
    judged: bool
    median_fill_bias_sigma: float
    median_fill_bias_level: float
    above_fraction: float
    below_fraction: float
    above_floor_fraction: float
    below_floor_fraction: float
    systematic_fill_bias: bool
    min_sigma: float
    one_way: float
    min_holes: int
    floor: float
    not_judged: str | None = None


def fill_texture(
    punched: HKLVolume,
    filled: HKLVolume,
    *,
    punch_record: NDArray[np.bool_] | None = None,
    rim: int = RIM,
    min_rim: int = MIN_RIM_VOXELS,
    min_sigma: float = MIN_SIGMA,
    one_way: float = ONE_WAY,
    min_holes: int = MIN_HOLES,
    floor: float = FILL_BIAS_FLOOR,
    slab: int | None = None,
) -> FillTexture:
    """texture.ts's fill-bias check over every hole of the volume, in 3-D.

    Parameters
    ----------
    punched : HKLVolume
        The punched stage: its holes masked (the values under them may still
        be the measured ones) or NaN.
    filled : HKLVolume
        The backfilled stage, on the same grid.
    punch_record : bool array, optional
        The voxels the punch removed (True), as the punch stage records them
        (:func:`nebula3d.pipeline.read_punch_record`).  Without it a hole is
        any voxel unmeasured in *punched* and measured in *filled*.
    rim, min_rim
        The rim's depth in voxels (texture.ts's 4) and the fewest rim voxels
        a hole is judged with (8).
    min_sigma, one_way, min_holes, floor
        The rule's limits, texture.ts's by default: a median bias of 0.5σ,
        three quarters of the judged holes one way, five judged holes, and a
        fifth of the local diffuse level.
    slab : int, optional
        H planes labelled at a time (default: about 2²² voxels natively, 2¹⁸
        in low-memory mode).  Changes the memory and the time, not the result.

    See the module docstring for the definitions, :class:`HoleTexture` and
    :class:`FillTexture` for what is returned.
    """
    holes = hole_texture(punched, filled, punch_record=punch_record, rim=rim,
                         min_rim=min_rim, slab=slab)
    return judge_fill_bias(holes, min_sigma=min_sigma, one_way=one_way,
                           min_holes=min_holes, floor=floor)


def judge_fill_bias(
    holes: HoleTexture,
    *,
    min_sigma: float = MIN_SIGMA,
    one_way: float = ONE_WAY,
    min_holes: int = MIN_HOLES,
    floor: float = FILL_BIAS_FLOOR,
) -> FillTexture:
    """texture.ts's summary and rule over the judged holes of *holes*."""
    min_sigma, one_way, floor = float(min_sigma), float(one_way), float(floor)
    if not (math.isfinite(min_sigma) and min_sigma >= 0):
        raise ValueError(f"min_sigma must be a number ≥ 0, not {min_sigma!r}")
    if not 0.0 <= one_way <= 1.0:
        raise ValueError(f"one_way must lie in 0–1, not {one_way!r}")
    if int(min_holes) < 1:
        raise ValueError(f"min_holes must be at least 1, not {min_holes!r}")
    if not (math.isfinite(floor) and floor >= 0):
        raise ValueError(f"floor must be a number ≥ 0, not {floor!r}")
    min_holes = int(min_holes)

    judged = holes.judged
    n_judged = int(judged.sum())
    bias = holes.bias[judged]
    in_sigma = holes.bias_sigma[judged]
    level = holes.bias_level[judged]
    in_level = level[np.isfinite(level)]
    nan = math.nan
    med_sigma = float(np.median(in_sigma)) if n_judged else nan
    med_level = float(np.median(in_level)) if in_level.size else nan
    above = float(np.count_nonzero(bias > 0)) / n_judged if n_judged else nan
    below = float(np.count_nonzero(bias < 0)) / n_judged if n_judged else nan
    # A hole inside its range (bias 0) leans neither way, whatever the floor.
    up = np.count_nonzero((in_level > 0) & (in_level >= floor))
    down = np.count_nonzero((in_level < 0) & (in_level <= -floor))
    above_floor = float(up) / n_judged if n_judged else nan
    below_floor = float(down) / n_judged if n_judged else nan
    # texture.ts: the median's sign picks the side (0 counts as below).
    one_sided = n_judged > 0 and (above >= one_way if med_sigma > 0 else below >= one_way)
    # The grid's room for the rims (the module docstring, Room for the rim).
    coarse = holes.too_coarse
    applies = coarse is None and n_judged >= min_holes
    systematic = (applies and abs(med_sigma) >= min_sigma
                  and math.isfinite(med_level) and abs(med_level) >= floor and one_sided)
    return FillTexture(
        holes=holes, n_holes=holes.n, n_judged=n_judged, judged=applies,
        median_fill_bias_sigma=med_sigma, median_fill_bias_level=med_level,
        above_fraction=above, below_fraction=below,
        above_floor_fraction=above_floor, below_floor_fraction=below_floor,
        systematic_fill_bias=bool(systematic),
        min_sigma=min_sigma, one_way=one_way, min_holes=min_holes, floor=floor,
        not_judged=coarse,
    )


def hole_texture(
    punched: HKLVolume,
    filled: HKLVolume,
    *,
    punch_record: NDArray[np.bool_] | None = None,
    rim: int = RIM,
    min_rim: int = MIN_RIM_VOXELS,
    slab: int | None = None,
) -> HoleTexture:
    """Each hole's fill against the range its 3-D rim allows (the facts
    :func:`fill_texture` judges; same parameters)."""
    if (punched.data.ndim != 3 or punched.data.shape != filled.data.shape
            or not all(np.array_equal(a, b) for a, b in
                       ((punched.h_axis, filled.h_axis), (punched.k_axis, filled.k_axis),
                        (punched.l_axis, filled.l_axis)))):
        raise ValueError("punched and filled must be 3-D volumes on one grid: "
                         "the same shape and axes")
    if punch_record is not None:
        if np.shape(punch_record) != punched.data.shape:
            raise ValueError("punch_record must have the volume's shape")
        record: NDArray[np.bool_] | None = np.asarray(punch_record, dtype=bool)
    else:
        record = None
    if int(rim) < 1:
        raise ValueError(f"rim must be at least 1 voxel, not {rim!r}")
    if int(min_rim) < 1:
        raise ValueError(f"min_rim must be at least 1, not {min_rim!r}")
    rim, min_rim = int(rim), int(min_rim)
    shape = tuple(int(n) for n in punched.data.shape)
    plane = max(1, shape[1] * shape[2])
    budget = _SLAB_VOXELS_LEAN if low_memory() else _SLAB_VOXELS_NATIVE
    slab = max(1, int(slab) if slab is not None else budget // plane)

    def holes_in(region: tuple[slice, ...]) -> NDArray[np.bool_]:
        """The hole mask (every hole) inside *region*."""
        out = filled.mask[region] & np.isfinite(filled.data[region])
        if record is not None:
            out &= record[region]
        else:
            out &= ~(punched.mask[region] & np.isfinite(punched.data[region]))
        return out

    found = _find_holes(holes_in, shape, slab)
    n = found.seed.size
    axes = (punched.h_axis, punched.k_axis, punched.l_axis)
    centre = found.coord_sum / np.maximum(found.count, 1)[:, None]
    # Each hole's chessboard reach from its centre: its box's farthest face.
    reach = (np.max(np.maximum(found.hi - 1 - centre, centre - found.lo), axis=1) if n
             else np.zeros(0))
    centre_hkl = np.stack(
        [np.interp(centre[:, d], np.arange(axes[d].size), axes[d]) for d in range(3)],
        axis=1) if n else np.zeros((0, 3))
    names = ("fill", "level", "sigma", "slope", "edge", "peaked", "bias")
    cols = {k: np.full(n, np.nan) for k in names}
    rim_voxels = np.zeros(n, dtype=np.int64)
    not_judged: list[NotJudged | None] = []
    for i in range(n):
        lo = np.maximum(found.lo[i] - rim, 0)
        hi = np.minimum(found.hi[i] + rim, shape)
        if int(np.prod(hi - lo)) > MAX_REGION_VOXELS:
            not_judged.append("too large")
            continue
        m = _measure_hole(punched, filled, holes_in, lo, hi, found, i, rim, min_rim)
        for k in names:
            cols[k][i] = getattr(m, k)
        rim_voxels[i] = m.rim_voxels
        not_judged.append(m.not_judged)
    return HoleTexture(
        voxels=found.count, centre=centre, centre_hkl=centre_hkl, rim_voxels=rim_voxels,
        fill=cols["fill"], level=cols["level"], sigma=cols["sigma"], slope=cols["slope"],
        edge=cols["edge"], peaked=cols["peaked"], bias=cols["bias"],
        not_judged=tuple(not_judged),
        holes_from="punch_record" if record is not None else "masks",
        rim=rim, min_rim=min_rim, reach=reach.astype(np.float64), node_spacing=node_spacing(axes),
    )


def node_spacing(axes: tuple[NDArray[np.floating], ...]) -> float:
    """The voxels between neighbouring nodes of the grid's cell (integer h, k
    and l): one r.l.u. along the axis with the coarsest step, axes of one
    plane aside (infinite with none), to six figures, so the axes' rounding
    (0.1 r.l.u. a voxel reads 9.999999999999991) moves no limit."""
    steps = [abs(float(a[1] - a[0])) for a in axes if np.size(a) > 1]
    return float(f"{1.0 / max(steps):.6g}") if steps and max(steps) > 0 else math.inf


@dataclass(frozen=True)
class _Found:
    """The holes found (:func:`_find_holes`), one row each, in C order of each
    hole's first voxel: that voxel's flat index, the bounding box (``lo``
    inclusive, ``hi`` exclusive, ``n`` × 3), the voxel count and the sums of
    the voxels' indices (``n`` × 3)."""

    seed: NDArray[np.int64]
    lo: NDArray[np.int64]
    hi: NDArray[np.int64]
    count: NDArray[np.int64]
    coord_sum: NDArray[np.float64]


def _find_holes(
    holes_in: Callable[[tuple[slice, ...]], NDArray[np.bool_]],
    shape: tuple[int, ...],
    slab: int,
) -> _Found:
    """The 6-connected components of the hole mask, one slab of H planes at
    a time (see the module docstring, *Memory*).

    Each slab's components get consecutive ids; a component that touches one
    of the previous slab's across their common face is joined to it
    (union–find over the ids), and each joined set is one hole.
    """
    nh, nk, nl = shape
    plane = nk * nl
    parent: list[int] = []

    def root(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    seeds: list[NDArray[np.int64]] = []
    los: list[NDArray[np.int64]] = []
    his: list[NDArray[np.int64]] = []
    counts: list[NDArray[np.int64]] = []
    sums: list[NDArray[np.float64]] = []
    last: NDArray[np.int64] | None = None  # the previous slab's last plane: ids, −1 none
    for z0 in range(0, nh, slab):
        z1 = min(nh, z0 + slab)
        labels, n_new = ndimage.label(holes_in((slice(z0, z1), slice(None), slice(None))),
                                      structure=_CROSS)
        base = len(parent)
        if n_new:
            flat = labels.reshape(-1)
            where = np.flatnonzero(flat)
            ids = flat[where]
            # Labels run in C order of each component's first voxel.
            _, first = np.unique(ids, return_index=True)
            seeds.append(where[first].astype(np.int64) + z0 * plane)
            counts.append(np.bincount(ids, minlength=n_new + 1)[1:].astype(np.int64))
            iz, ik, il = np.unravel_index(where, labels.shape)
            sums.append(np.stack([np.bincount(ids, weights=c, minlength=n_new + 1)[1:]
                                  for c in (iz + z0, ik, il)], axis=1).astype(np.float64))
            del flat, where, ids, iz, ik, il
            boxes = ndimage.find_objects(labels)
            start = np.array([[s.start for s in b] for b in boxes], dtype=np.int64)
            stop = np.array([[s.stop for s in b] for b in boxes], dtype=np.int64)
            start[:, 0] += z0
            stop[:, 0] += z0
            los.append(start)
            his.append(stop)
            parent.extend(range(base, base + n_new))
            if last is not None:
                first_plane = labels[0].astype(np.int64) - 1 + base
                touch = (last >= 0) & (labels[0] > 0)
                if touch.any():
                    pairs = np.unique(np.stack([last[touch], first_plane[touch]]), axis=1)
                    for a, b in pairs.T.tolist():
                        ra, rb = root(a), root(b)
                        if ra != rb:
                            parent[max(ra, rb)] = min(ra, rb)
            last = np.where(labels[-1] > 0, labels[-1].astype(np.int64) - 1 + base, -1)
        else:
            last = None
        del labels
    n_comp = len(parent)
    if not n_comp:
        empty = np.zeros((0, 3), dtype=np.int64)
        return _Found(seed=np.zeros(0, dtype=np.int64), lo=empty, hi=empty,
                      count=np.zeros(0, dtype=np.int64), coord_sum=np.zeros((0, 3)))
    roots = np.array([root(c) for c in range(n_comp)], dtype=np.int64)
    seed_c = np.concatenate(seeds)
    lo_c, hi_c = np.concatenate(los), np.concatenate(his)
    count_c, sum_c = np.concatenate(counts), np.concatenate(sums)
    # A joined set's root is its smallest id, whose first voxel comes first.
    hole_roots, hole_of = np.unique(roots, return_inverse=True)
    n = hole_roots.size
    seed = seed_c[hole_roots]
    lo = np.full((n, 3), np.iinfo(np.int64).max, dtype=np.int64)
    hi = np.zeros((n, 3), dtype=np.int64)
    np.minimum.at(lo, hole_of, lo_c)
    np.maximum.at(hi, hole_of, hi_c)
    count = np.bincount(hole_of, weights=count_c, minlength=n).astype(np.int64)
    coord_sum = np.stack([np.bincount(hole_of, weights=sum_c[:, d], minlength=n)
                          for d in range(3)], axis=1).astype(np.float64)
    order = np.argsort(seed, kind="stable")
    return _Found(seed=seed[order], lo=lo[order], hi=hi[order], count=count[order],
                  coord_sum=coord_sum[order])


@dataclass(frozen=True)
class _Measured:
    fill: float
    level: float
    sigma: float
    slope: float
    edge: float
    peaked: float
    bias: float
    rim_voxels: int
    not_judged: NotJudged | None


def _measure_hole(
    punched: HKLVolume,
    filled: HKLVolume,
    holes_in: Callable[[tuple[slice, ...]], NDArray[np.bool_]],
    lo: NDArray[np.int64],
    hi: NDArray[np.int64],
    found: _Found,
    i: int,
    rim: int,
    min_rim: int,
) -> _Measured:
    """Hole *i* against its rim, inside its bounding box grown by the rim
    (``lo`` … ``hi``)."""
    region = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
    every = holes_in(region)
    labels, _ = ndimage.label(every, structure=_CROSS)
    seed = np.unravel_index(int(found.seed[i]), punched.data.shape)
    hole = labels == labels[tuple(int(s) - int(a) for s, a in zip(seed, lo))]
    del labels
    if int(np.count_nonzero(hole)) != int(found.count[i]):
        raise RuntimeError("fill texture: a hole changed between its two readings")
    p = punched.data[region]
    f = filled.data[region]
    fill = float(np.mean(f[hole], dtype=np.float64))
    nan = math.nan

    def not_judged(why: NotJudged, n_rim: int = 0) -> _Measured:
        return _Measured(fill=fill, level=nan, sigma=nan, slope=nan, edge=nan, peaked=nan,
                         bias=nan, rim_voxels=n_rim, not_judged=why)

    # The rim: measured, in no hole, left as it was by the fill, 1 … rim
    # voxels (chessboard) from the hole.
    kept = (punched.mask[region] & np.isfinite(p) & filled.mask[region] & (f == p)
            & ~every)
    dist = ndimage.distance_transform_cdt(~hole, metric="chessboard")
    ring = kept & (dist >= 1) & (dist <= rim)
    s = dist[ring].astype(np.float64)
    v = p[ring].astype(np.float64)
    del kept, dist, ring, every
    if v.size < min_rim or np.unique(s).size < 2:
        return not_judged("thin rim", int(v.size))
    # Each hole voxel's depth: its chessboard distance to the nearest voxel
    # outside the hole, within the hole's box grown by one (texture.ts's
    # "outside"), which holds the nearest one.
    inner = tuple(slice(max(0, int(a) - 1 - int(r0)), min(int(b) + 1, int(r1)) - int(r0))
                  for a, b, r0, r1 in zip(found.lo[i], found.hi[i], lo, hi))
    core = hole[inner]
    if core.all():
        return not_judged("no outside", int(v.size))
    depth = ndimage.distance_transform_cdt(core, metric="chessboard")
    s_mean = 1.0 - float(np.mean(depth[core], dtype=np.float64))
    del depth, core
    ms, mv = float(np.mean(s)), float(np.mean(v))
    sxx = float(np.sum((s - ms) ** 2))
    b = float(np.sum((s - ms) * (v - mv))) / sxx if sxx > 0 else 0.0
    a = mv - b * ms
    level = float(np.median(v))
    sigma = 1.4826 * float(np.median(np.abs(v - (a + b * s))))
    if not sigma > 0:
        return not_judged("flat rim", int(v.size))
    edge, peaked = a + b, a + b * s_mean
    low, high = min(edge, peaked), max(edge, peaked)
    bias = fill - high if fill > high else (fill - low if fill < low else 0.0)
    return _Measured(fill=fill, level=level, sigma=sigma, slope=b, edge=edge, peaked=peaked,
                     bias=bias, rim_voxels=int(v.size), not_judged=None)
