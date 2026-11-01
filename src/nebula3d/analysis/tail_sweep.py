# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Round 2 of the Bragg punch: the tails a turned UB leaves beside the holes (THY-60).

A UB turned by ω in the reduction displaces and smears each Bragg peak along
ω × q̂ (:mod:`nebula3d.analysis.misorientation`).  Where the smear reaches past
the round-1 punch, the tail stays in the data and the backfill, which takes
its boundary there, turns it into a bright spot.  The sweep looks for that
tail on the punched volume, before any backfill, and adds it to the holes, so
the backfill runs once, on the union, from the punched data.

At each Bragg node whose predicted shift |ω × q| reaches half a voxel:

1. **Where:** the node's round-1 hole swept along ±ω × q̂ by |ω × q| and one
   voxel more (``R``, :func:`~nebula3d.analysis.misorientation.capsule_inside`
   on the node's own punch ellipsoid).  Nothing else is searched: not the
   other directions, not between nodes.
2. **The level:** the diffuse at each distance from the hole, the median of
   the measured, unpunched voxels at that distance (rings one voxel wide)
   outside the search region and its band, so in the directions across the
   tail; the window's median where a ring holds too few.  A level taken at
   the same distance follows the diffuse that is centred on the node and
   falls off from it (thermal diffuse scattering, the peak's own symmetric
   halo), which is the crystal's and not a tail.
3. **The gate:** a voxel is a tail candidate when it stands above that level
   by the punch's significance gate (``min_significance``, 5σ by default),
   in the volume's own σ, and is measured, unpunched, outside the declared
   modulation and inside the node's integer-H guard.
4. **Connected:** only candidates connected (26-neighbour) to the node's own
   round-1 hole count; from them the sweep grows into the connected voxels
   down to ``GROW_SIGMA`` (3σ), the tail's faint end (hysteresis: a voxel
   between 3σ and the gate is taken only where it continues a tail that
   passed the gate, never on its own).
5. **Confined:** a tail ends inside the search region.  When the connected
   candidates reach the band of ``CONFINE_VOXELS`` around it, the excess
   continues past where a tail can reach — a rod, a broad maximum, a halo
   that is the crystal's — and the node is left alone (``extended``).
6. **Caps:** a node adding more than ``GROWTH_CAP`` × its round-1 hole is left
   alone (``capped``); so is every node in a |Q| shell (``SHELL_STEP`` wide)
   where round 2 would take more than ``SHELL_CAP`` of the measured voxels
   (``shell_capped``).

Every voxel round 2 adds is recorded (:class:`TailSweep`).  The before/after
numbers are local to the searched nodes: the voxels at the gate or above
the level beside the holes along ±ω × q̂ (within the search regions: count,
and their excess over it; those at nodes left alone counted apart), and the
share of
bright fills — punched voxels a Laplace fill (the backfill's default, run
locally on the node's window) leaves 3σ or more above the level — with the
round-1 holes and with the union.

Nothing here is diffuse signal: round 2 removes Bragg tails, and reports them
as such.  Windows are local and bounded (a few thousand voxels each); the
only volume-wide passes are the per-shell voxel count and the update of the
keep mask, both slab by slab, so it runs in the browser's 32-bit heap.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage

from nebula3d.analysis.misorientation import capsule_inside
from nebula3d.core import HKLVolume, q_magnitude_from_axes
from nebula3d.utils.counting import bincount

#: The search reaches this many voxels past the predicted shift.
EXTRA_VOXELS = 1.0
#: The band around the search region a tail must not reach (voxels).
CONFINE_VOXELS = 2
#: A node may add at most this × its round-1 hole.
GROWTH_CAP = 1.0
#: Per |Q| shell this wide (Å⁻¹), round 2 may take at most this share of the
#: measured voxels.
SHELL_STEP = 0.25
SHELL_CAP = 0.02
#: Fewest voxels a ring's level is the median of.
RING_MIN = 8
#: A punched voxel's fill is bright at this many σ above the level.
BRIGHT_SIGMA = 3.0
#: The tail's faint end: from the voxels that pass the gate, the sweep grows
#: into connected voxels down to this many σ (hysteresis).
GROW_SIGMA = 3.0
#: The predicted shift below which a node is not searched (voxels).
MIN_SHIFT_VOXELS = 0.5
#: A tail is no wider across ω × q̂ than this × the peak's core, plus this
#: share of a voxel (excess-weighted RMS distances from the line).
NARROW_RATIO = 1.4
NARROW_FLOOR_VOXELS = 0.25

SETTINGS = ("off", "auto", "on")
_CUBE = np.ones((3, 3, 3), dtype=bool)


@dataclass(frozen=True)
class NodeHole:
    """A Bragg node's round-1 punch, as the sweep needs it."""

    node: tuple[int, int, int]
    centre_hkl: tuple[float, float, float]
    index: tuple[int, int, int]  # the voxel nearest the centre
    shape: NDArray[np.float64]  # the final punch ellipsoid (HKL, δᵀAδ ≤ 1)
    stretch: NDArray[np.float64] | None  # round 1's half-segment (HKL), if stretched
    h_guard: tuple[tuple[float, float, float], float] | None = None


@dataclass
class _NodeResult:
    node: tuple[int, int, int]
    q: float
    shift: float
    status: str
    hole: int
    added: NDArray[np.intp] = field(default_factory=lambda: np.zeros(0, dtype=np.intp))
    tail_before: int = 0  # voxels ≥ the gate in the search region, outside the holes
    tail_removed: int = 0  # ... of them round 2 added
    excess_before: float = 0.0  # their summed excess over the level
    excess_removed: float = 0.0
    filled_before: int = 0
    bright_before: int = 0
    filled_after: int = 0
    bright_after: int = 0
    width_core: float = float("nan")
    width_tail: float = float("nan")


@dataclass
class TailSweep:
    """Round 2's record: what it searched, what it added, and the numbers."""

    setting: str
    ran: bool
    reason: str = ""
    z_gate: float = float("nan")
    added: NDArray[np.intp] = field(default_factory=lambda: np.zeros(0, dtype=np.intp))
    nodes: list[_NodeResult] = field(default_factory=list)
    shells_capped: list[float] = field(default_factory=list)

    def count(self, status: str) -> int:
        return sum(1 for n in self.nodes if n.status == status)

    def _sum(self, attr: str, statuses: Sequence[str] | None = None) -> float:
        return float(sum(getattr(n, attr) for n in self.nodes
                         if statuses is None or n.status in statuses))

    @property
    def tail_voxels(self) -> tuple[int, int]:
        """Voxels at the gate or above the level along ±ω × q̂ beside the holes
        (within the search regions), before and after round 2."""
        before = int(self._sum("tail_before"))
        return before, before - int(self._sum("tail_removed", ("swept",)))

    @property
    def tail_excess(self) -> tuple[float, float]:
        """Their summed excess over the level (data units), before and after."""
        before = self._sum("excess_before")
        return before, before - self._sum("excess_removed", ("swept",))

    @property
    def left_alone(self) -> int:
        """Of those voxels, the ones at nodes left alone as diffuse-like
        (``extended``, ``broad``): what stays by design, not a missed tail."""
        return int(self._sum("tail_before", ("extended", "broad")))

    @property
    def bright_fill(self) -> tuple[float | None, float | None]:
        """Share of bright fills at the swept nodes, with the round-1 holes and the union."""
        fb, fa = self._sum("filled_before", ("swept",)), self._sum("filled_after", ("swept",))
        bb, ba = self._sum("bright_before", ("swept",)), self._sum("bright_after", ("swept",))
        return (bb / fb if fb else None), (ba / fa if fa else None)

    def describe(self) -> str:
        """One line for the run log."""
        if not self.ran:
            return f"tail sweep ({self.setting}): not run, {self.reason.replace('_', ' ')}"
        tb, ta = self.tail_voxels
        eb, ea = self.tail_excess
        bf = self.bright_fill
        kept = self.count("extended") + self.count("broad")
        left = (f"; {kept} nodes left alone as diffuse-like (extended past the search, "
                f"or wider than the peak), {self.left_alone:,} of those voxels"
                if kept else "")
        capped = self.count("capped") + self.count("shell_capped")
        caps = f"; {capped} capped" if capped else ""
        fill = ("" if bf[0] is None or bf[1] is None else
                f"; bright fills at those nodes {bf[0]:.1%} → {bf[1]:.1%}")
        share = f" ({ea / eb:.0%} of their excess left)" if eb > 0 else ""
        return (f"tail sweep ({self.setting}, ≥ {self.z_gate:g}σ): {self.added.size:,} voxels "
                f"added at {self.count('swept')} of {len(self.nodes)} nodes searched; voxels "
                f"≥ {self.z_gate:g}σ beside the holes along ±ω × q̂ {tb:,} → {ta:,}{share}"
                f"{fill}{left}{caps}")

    def to_json(self, vol: HKLVolume) -> dict[str, Any]:
        """The record: summary, the nodes not left clean, and every voxel added (HKL)."""
        tb, ta = self.tail_voxels
        eb, ea = self.tail_excess
        bb, ba = self.bright_fill
        idx = np.unravel_index(self.added, vol.shape)
        voxels = np.stack([vol.h_axis[idx[0]], vol.k_axis[idx[1]], vol.l_axis[idx[2]]], axis=1)
        statuses = ("swept", "clean", "extended", "broad", "capped", "shell_capped", "no_hole")
        return {
            "setting": self.setting, "ran": self.ran, "reason": self.reason or None,
            "z_gate": None if not np.isfinite(self.z_gate) else float(self.z_gate),
            "n_voxels": int(self.added.size),
            "nodes_searched": len(self.nodes),
            "counts": {s: self.count(s) for s in statuses},
            "tail_voxels": {"before": tb, "after": ta, "left_alone": self.left_alone},
            "tail_excess": {"before": round(eb, 6), "after": round(ea, 6)},
            "bright_fill": {"before": None if bb is None else round(bb, 4),
                            "after": None if ba is None else round(ba, 4)},
            "grow_sigma": GROW_SIGMA,
            "limits": {"extra_voxels": EXTRA_VOXELS, "confine_voxels": CONFINE_VOXELS,
                       "growth_cap": GROWTH_CAP, "shell_step": SHELL_STEP,
                       "shell_cap": SHELL_CAP, "min_shift_voxels": MIN_SHIFT_VOXELS},
            "shells_capped": [round(s, 3) for s in self.shells_capped],
            "nodes": [{"node": list(n.node), "q": round(n.q, 4), "shift": round(n.shift, 5),
                       "status": n.status, "hole": n.hole, "added": int(n.added.size)}
                      for n in self.nodes if n.status != "clean"],
            "voxels_hkl": np.round(voxels, 5).tolist(),
        }


def voxel_q(vol: HKLVolume) -> tuple[float, NDArray[np.float64]]:
    """The voxel's size in Å⁻¹ (cube root of its Q-volume) and its edge along each axis."""
    steps = np.array([abs(float(a[1] - a[0])) if a.size > 1 else 1.0
                      for a in (vol.h_axis, vol.k_axis, vol.l_axis)])
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    edge = float((abs(float(np.linalg.det(ub))) * float(np.prod(steps))) ** (1.0 / 3.0))
    return edge, np.linalg.norm(ub, axis=0) * steps


def _weighted_rms(d2: NDArray[np.float64], w: NDArray[np.float64]) -> float:
    """√(Σ w·d² / Σ w) over the positive weights; NaN without any."""
    pos = w > 0
    total = float(w[pos].sum())
    return float(np.sqrt(float((w[pos] * d2[pos]).sum()) / total)) if total > 0 else float("nan")


def _guard(grids: Sequence[NDArray[np.float64]],
           h_guard: tuple[tuple[float, float, float], float] | None,
           h_forms: Sequence[NDArray[np.int64]]) -> NDArray[np.bool_] | None:
    """The integer-H guard's slab on the window (as ``BraggRemover._punch_one`` clips)."""
    if h_guard is None:
        return None
    node, half = h_guard
    out: NDArray[np.bool_] | None = None
    for form in h_forms:
        offset: NDArray[np.float64] | float = 0.0
        for c, grid, n0 in zip(form, grids, node):
            if c:
                d = grid - n0
                offset = offset + (d if c == 1 else float(c) * d)
        ok = np.abs(offset) <= max(float(half), 0.0)
        out = ok if out is None else out & ok
    return out


def _local_fill(vol: HKLVolume, box: tuple[slice, slice, slice], measured: NDArray[np.bool_],
                holes: NDArray[np.bool_], gap: int) -> NDArray[np.float64]:
    """A Laplace fill of *holes* on the window *box* (the backfill's default)."""
    from nebula3d.analysis.bragg_fill import backfill_bragg

    sub = HKLVolume(
        data=np.asarray(vol.data[box], dtype=np.float64),
        sigma=np.asarray(vol.sigma[box], dtype=np.float64),
        mask=measured & ~holes,
        h_axis=vol.h_axis[box[0]], k_axis=vol.k_axis[box[1]], l_axis=vol.l_axis[box[2]],
        ub_matrix=vol.ub_matrix,
    )
    filled = backfill_bragg(sub, method="laplace", laplace_gap=gap, punched=holes & measured,
                            direct_beam_fill=False, report=lambda _msg: None)
    return np.asarray(filled.data, dtype=np.float64)


def sweep_tails(
    vol: HKLVolume,
    keep: NDArray[np.bool_],
    holes: Sequence[NodeHole],
    omega: NDArray[np.floating],
    *,
    z_gate: float,
    setting: str = "auto",
    protect: NDArray[np.bool_] | None = None,
    h_forms: Sequence[NDArray[np.int64]] = (np.array([1, 0, 0]),),
    fill_gap: int = 1,
    grow_sigma: float = GROW_SIGMA,
) -> TailSweep:
    """Round 2 on the punched volume (module docstring); *keep* is not changed.

    *vol* is the punch's input (its mask the measured voxels), *keep* the
    round-1 keep-mask (False = punched), *holes* the Bragg nodes' punches,
    *omega* the rotation (radians, Cartesian Q).  *protect* (the volume's
    shape) holds the declared modulation's voxels; *h_forms* the forms the
    integer-H guard applies to.  The result's ``added`` are the flat indices
    of the voxels round 2 punches.
    """
    out = TailSweep(setting=setting, ran=True, z_gate=float(z_gate))
    omega = np.asarray(omega, dtype=np.float64)
    ub = np.asarray(vol.ub_matrix, dtype=np.float64)
    ub_inv = np.linalg.inv(ub)
    v, qvox = voxel_q(vol)
    steps = np.array([abs(float(a[1] - a[0])) if a.size > 1 else 1.0
                      for a in (vol.h_axis, vol.k_axis, vol.l_axis)])
    axes = (vol.h_axis, vol.k_axis, vol.l_axis)
    shape = vol.shape
    for hole in holes:
        q = ub @ np.asarray(hole.node, dtype=np.float64)
        shift = np.cross(omega, q)
        d = float(np.linalg.norm(shift))
        res = _NodeResult(node=hole.node, q=float(np.linalg.norm(q)), shift=d,
                          status="unresolved", hole=0)
        if d < MIN_SHIFT_VOXELS * v:
            continue  # unresolved nodes are not listed
        out.nodes.append(res)
        u = shift / d
        s1 = (np.zeros(3) if hole.stretch is None
              else np.asarray(hole.stretch, dtype=np.float64))
        d1 = float(np.linalg.norm(ub @ s1))
        s_tot = ub_inv @ ((d1 + d + EXTRA_VOXELS * v) * u)
        a = np.asarray(hole.shape, dtype=np.float64)
        reach = np.sqrt(np.clip(np.diag(np.linalg.inv(a)), 0.0, None)) + np.abs(s_tot)
        half = np.ceil(reach / steps).astype(int) + CONFINE_VOXELS + 2
        b0, b1, b2 = (slice(max(0, i - w), min(n, i + w + 1))
                      for i, w, n in zip(hole.index, half, shape))
        box = (b0, b1, b2)
        grids = np.meshgrid(*(ax[b] for ax, b in zip(axes, box)), indexing="ij")
        dh, dk, dl = (g - c for g, c in zip(grids, hole.centre_hkl))
        own_shape = (capsule_inside(dh, dk, dl, a, s1) if hole.stretch is not None
                     else capsule_inside(dh, dk, dl, a, np.zeros(3)))
        data_w = np.asarray(vol.data[box], dtype=np.float64)
        measured = np.asarray(vol.mask[box], dtype=bool) & np.isfinite(data_w)
        keep_w = np.asarray(keep[box], dtype=bool)
        holes_w = measured & ~keep_w
        own = own_shape & holes_w
        res.hole = int(own.sum())
        if not res.hole:
            res.status = "no_hole"
            continue
        region = capsule_inside(dh, dk, dl, a, s_tot)
        dilated = ndimage.binary_dilation(region, structure=_CUBE, iterations=CONFINE_VOXELS)
        band = dilated & ~region
        allowed = measured & keep_w
        if protect is not None:
            allowed &= ~np.asarray(protect[box], dtype=bool)
        guard = _guard(grids, hole.h_guard, h_forms)
        if guard is not None:
            allowed &= guard
        dist = ndimage.distance_transform_edt(~own, sampling=qvox)
        ring = np.floor(dist / v).astype(np.int64)
        ref = allowed & ~dilated
        n_ring = int(ring.max()) + 1
        if int(ref.sum()) < RING_MIN:
            res.status = "no_hole"  # nothing measured around it to judge against
            continue
        pooled = data_w[ref]
        lvl0 = float(np.median(pooled))
        sc0 = 1.4826 * float(np.median(np.abs(pooled - lvl0)))
        cnt = bincount(ring[ref], minlength=n_ring)
        level = np.full(n_ring, lvl0)
        scatter = np.full(n_ring, sc0)
        order = np.argsort(ring[ref], kind="stable")
        rv, dv = ring[ref][order], data_w[ref][order]
        bounds = np.searchsorted(rv, np.arange(n_ring + 1))
        for r in range(n_ring):
            if cnt[r] >= RING_MIN:
                seg = dv[bounds[r]:bounds[r + 1]]
                level[r] = float(np.median(seg))
                scatter[r] = 1.4826 * float(np.median(np.abs(seg - level[r])))
        lev = level[ring]
        sig = np.asarray(vol.sigma[box], dtype=np.float64)
        sig = np.where(np.isfinite(sig) & (sig > 0), sig, scatter[ring])
        with np.errstate(divide="ignore", invalid="ignore"):
            z = (data_w - lev) / sig
        bright = allowed & (z >= float(z_gate))
        tail = bright & region
        res.tail_before = int(tail.sum())
        res.excess_before = float(np.sum((data_w - lev)[tail]))
        cand = bright & dilated
        seed = cand & ndimage.binary_dilation(own, structure=_CUBE)
        cluster = (ndimage.binary_propagation(seed, structure=_CUBE, mask=cand)
                   if seed.any() else seed)
        if (cluster & band).any():
            res.status = "extended"
            continue
        if cluster.any() and grow_sigma < float(z_gate):
            # The tail's faint end: voxels down to grow_sigma inside the
            # search region, connected to those that passed the gate
            # (hysteresis); a faint end past the region is not followed.
            faint = allowed & region & (z >= float(grow_sigma))
            cluster = ndimage.binary_propagation(cluster, structure=_CUBE, mask=faint | cluster)
        n_add = int(cluster.sum())
        if not n_add:
            res.status = "clean"
            continue
        if n_add > GROWTH_CAP * res.hole:
            res.status = "capped"
            continue
        # Narrow: a tail is the peak moved along ω × q̂, so across that
        # direction it is no wider than the peak's own core (excess-weighted
        # RMS distance from the line through the centre along ω × q̂).
        dq = np.stack([dh, dk, dl], axis=-1) @ ub.T
        along = dq @ u
        perp2 = np.sum(dq * dq, axis=-1) - along * along
        excess = data_w - lev
        core = own & (excess > 0)
        res.width_core = _weighted_rms(perp2[core], excess[core])
        res.width_tail = _weighted_rms(perp2[cluster], excess[cluster])
        if res.width_tail > NARROW_RATIO * res.width_core + NARROW_FLOOR_VOXELS * v:
            res.status = "broad"
            continue
        res.status = "swept"
        res.tail_removed = int((cluster & tail).sum())
        res.excess_removed = float(np.sum((data_w - lev)[cluster & tail]))
        local = np.nonzero(cluster)
        res.added = np.ravel_multi_index(
            tuple(li + b.start for li, b in zip(local, box)), shape).astype(np.intp)
        # Bright fills: a Laplace fill of the window's holes, round 1 and the union.
        ring_edge = level[np.maximum(ring, 1)] if n_ring > 1 else lev
        for when, filled_holes, judged in (("before", holes_w, own),
                                           ("after", holes_w | cluster, own | cluster)):
            fill = _local_fill(vol, box, measured, filled_holes, fill_gap)
            hot = (fill - ring_edge) >= BRIGHT_SIGMA * sig
            n_f, n_b = int(judged.sum()), int((hot & judged).sum())
            if when == "before":
                res.filled_before, res.bright_before = n_f, n_b
            else:
                res.filled_after, res.bright_after = n_f, n_b

    # The per-|Q|-shell cap, over the nodes swept.
    swept = [n for n in out.nodes if n.status == "swept"]
    if swept:
        added = np.concatenate([n.added for n in swept])
        idx = np.unravel_index(added, shape)
        hkl = np.stack([vol.h_axis[idx[0]], vol.k_axis[idx[1]], vol.l_axis[idx[2]]], axis=1)
        q_add = np.linalg.norm(hkl @ ub.T, axis=1)
        shell_add = np.floor(q_add / SHELL_STEP).astype(np.int64)
        n_sh = int(shell_add.max()) + 1
        measured_per_shell = _measured_per_shell(vol, n_sh)
        over = bincount(shell_add, minlength=n_sh) > SHELL_CAP * measured_per_shell
        if over.any():
            out.shells_capped = [float(b * SHELL_STEP) for b in np.flatnonzero(over)]
            for n in swept:
                ni = np.unravel_index(n.added, shape)
                nh = np.stack([vol.h_axis[ni[0]], vol.k_axis[ni[1]], vol.l_axis[ni[2]]], axis=1)
                sh = np.floor(np.linalg.norm(nh @ ub.T, axis=1) / SHELL_STEP).astype(np.int64)
                if over[np.clip(sh, 0, n_sh - 1)].any():
                    n.status = "shell_capped"
                    n.added = np.zeros(0, dtype=np.intp)
        kept = [n.added for n in out.nodes if n.status == "swept"]
        out.added = (np.unique(np.concatenate(kept)) if kept
                     else np.zeros(0, dtype=np.intp))
    return out


def _measured_per_shell(vol: HKLVolume, n_shells: int) -> NDArray[np.float64]:
    """Measured voxels per |Q| shell of :data:`SHELL_STEP`, the first *n_shells*,
    counted slab by slab (no volume-sized |Q| array)."""
    counts = np.zeros(n_shells, dtype=np.float64)
    for lo in range(0, vol.shape[0], 16):
        sl = slice(lo, lo + 16)
        ok = np.asarray(vol.mask[sl], dtype=bool) & np.isfinite(vol.data[sl])
        if not ok.any():
            continue
        q = q_magnitude_from_axes(vol.h_axis[sl], vol.k_axis, vol.l_axis, vol.ub_matrix)[ok]
        b = np.floor(q / SHELL_STEP).astype(np.int64)
        b = b[b < n_shells]
        counts += bincount(b, minlength=n_shells)[:n_shells]
    return counts


def apply_sweep(keep: NDArray[np.bool_], sweep: TailSweep) -> NDArray[np.bool_]:
    """*keep* with round 2's voxels punched (a copy)."""
    out = keep.copy()
    out.reshape(-1)[sweep.added] = False
    return out


def not_run(setting: str, reason: str) -> TailSweep:
    """The record of a sweep that did not run, and why."""
    return dataclasses.replace(TailSweep(setting=setting, ran=False), reason=reason)
