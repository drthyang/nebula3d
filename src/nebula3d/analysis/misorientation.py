# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""A UB slightly turned in the reduction, read off the punch's own peaks (THY-60).

A reduction that indexed the data with a UB off by a small rotation ω puts
each Bragg peak at R(ω)·q instead of its node's q: displaced by δq = ω × q,
across Q (transverse), by |ω|·|Q| sin∠(ω, q), so the displacement grows with
|Q| and points one way at each node.  Runs reduced with slightly different
errors smear the peak along the same direction.  Far out in |Q| a punch sized
for the peak's width then leaves a tail on one side, and a backfill that takes
its boundary there turns it into a bright spot.

:func:`fit_rotation` fits the single rotation (three parameters, weighted
least squares, small-angle) to the offsets of the strong peaks' fitted
centres from their nodes, in Cartesian Q through the UB, and says how well it
explains them against random scatter.  A rotation moves a peak only across Q,
so only the offsets' transverse parts are fitted and judged: a cell error
moves the peaks along Q, which no rotation can explain and which the
rotation does not try to.

The rule (:func:`judge`) — a rotation is acted on only when all hold:

- **significant**: it lowers the weighted transverse scatter beyond chance,
  an F-test of the rotation against no rotation at ``p < P_SIGNIFICANT``
  (0.001: one dataset in a thousand without a misorientation passes);
- **explains**: it accounts for at least ``R2_EXPLAINS`` (half) of the
  weighted transverse offset variance, so its direction ω × q̂ is right for
  most peaks and not one pattern among several (strain, an origin shift,
  random centroid errors);
- **resolved**: the shift it predicts at the farthest punched node reaches
  ``RESOLVED_VOXELS`` (half) of a voxel: below that it moves no voxel into
  or out of a hole.

Symmetrised data cannot show it: each node's orbit partners are turned by the
rotation's conjugates, so a node holds a ring centred on itself, not a shift
(:mod:`nebula3d.analysis.ub_refine`).  There the diagnosis says so and stays
inactive.

The remedy is upstream: refine the UB in the data reduction.  The volume
itself may not be reliably fixable downstream, so nothing here regrids it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.typing import NDArray

#: Fewest peaks the rotation is fitted from.
MIN_PEAKS = 8
#: The peaks fitted: the punch's integer-node peaks whose centre was fitted
#: and whose significance (``BraggRemover._peak_significance``) reaches this.
FIT_MIN_SIGNIFICANCE = 10.0
#: The F-test level the rotation must beat (see the module docstring).
P_SIGNIFICANT = 1e-3
#: The share of the transverse offset variance it must explain.
R2_EXPLAINS = 0.5
#: The shift at the farthest punched node, in voxels, it must reach.
RESOLVED_VOXELS = 0.5
#: Per-peak centre error floor, in voxels (the grid's pull on a thresholded
#: centroid), and the counting term's scale (voxels × 1/significance): the
#: weights' relative sizes only, the overall scale is the residuals'.
CENTRE_FLOOR_VOXELS = 0.1
CENTRE_NOISE_VOXELS = 2.0
#: Outliers: a peak whose residual exceeds this × the median residual and
#: half a voxel is left out and the fit repeated (up to five times).
REJECT = 3.0

#: Round 1 made rotation-aware stretches each node's punch by |ω × q| along
#: ω × q̂: its footprint swept ±ROUND1_STRETCH·(ω × q) about its centre.  The
#: fitted centre already follows the shift; the stretch covers the smear of
#: runs reduced with errors spread about ω, of order |ω × q| end to end.
ROUND1_STRETCH = 0.5

#: How the diagnosis ended.
STATUSES = ("active", "not_significant", "not_explained", "unresolved",
            "too_few_peaks", "symmetrised", "no_peaks")


@dataclass(frozen=True)
class RotationFit:
    """:func:`fit_rotation`'s result over the peaks it kept."""

    omega: NDArray[np.float64]  # (3,) rotation vector, radians, Cartesian Q frame
    covariance: NDArray[np.float64]  # (3, 3) rad², scaled by the residual scatter
    used: NDArray[np.bool_]  # (n,) the peaks kept
    rss0: float  # weighted transverse Σ w|δq⊥|², no rotation
    rss1: float  # ... after the rotation
    dof: int  # 2·n_used − 3
    rms_before: float  # unweighted RMS |δq⊥| over the kept peaks (Å⁻¹)
    rms_after: float  # ... of the residual
    degenerate: bool  # the peaks' directions do not fix all three components

    @property
    def n_used(self) -> int:
        return int(self.used.sum())

    @property
    def angle(self) -> float:
        return float(np.linalg.norm(self.omega))

    @property
    def r2(self) -> float:
        return float(1.0 - self.rss1 / self.rss0) if self.rss0 > 0 else 0.0

    @property
    def f_stat(self) -> float:
        if self.dof <= 0 or self.rss1 <= 0:
            return float("inf") if self.rss0 > self.rss1 else 0.0
        return float(((self.rss0 - self.rss1) / 3.0) / (self.rss1 / self.dof))

    @property
    def p_value(self) -> float:
        from scipy.stats import f as f_dist

        if self.dof <= 0:
            return 1.0
        return float(f_dist.sf(self.f_stat, 3, self.dof))

    @property
    def sigma_angle(self) -> float:
        """Standard error of |ω| (radians), by the delta method."""
        a = self.angle
        if a <= 0:
            return float(np.sqrt(max(np.trace(self.covariance), 0.0) / 3.0))
        u = self.omega / a
        return float(np.sqrt(max(float(u @ self.covariance @ u), 0.0)))

    @property
    def sigma_axis(self) -> float:
        """RMS angular error of the axis (radians), per direction across it."""
        a = self.angle
        if a <= 0:
            return float(np.pi)
        u = self.omega / a
        across = max(float(np.trace(self.covariance) - u @ self.covariance @ u), 0.0)
        return float(np.sqrt(across / 2.0) / a)


def _transverse(q: NDArray[np.float64], dq: NDArray[np.float64]) -> NDArray[np.float64]:
    """*dq* with its component along each *q* removed."""
    qn = np.linalg.norm(q, axis=1, keepdims=True)
    qhat = np.divide(q, qn, out=np.zeros_like(q), where=qn > 0)
    return dq - np.sum(dq * qhat, axis=1, keepdims=True) * qhat


def fit_rotation(
    q: NDArray[np.floating],
    dq: NDArray[np.floating],
    weights: NDArray[np.floating] | None = None,
    *,
    keep_within: float = 0.0,
    reject: float = REJECT,
) -> RotationFit:
    """The small rotation ω that best explains the offsets *dq* at nodes *q*.

    Minimises Σ wᵢ |δqᵢ⊥ − ω × qᵢ|² over ω, with δq⊥ the offsets' parts
    across Q (a rotation moves nothing along Q): ω = N⁻¹ Σ wᵢ qᵢ × δqᵢ with
    N = Σ wᵢ (|qᵢ|² I − qᵢqᵢᵀ).  Its covariance is s²·N⁻¹ with s² the
    weighted residual over its 2n − 3 degrees of freedom, so the weights set
    only the peaks' relative trust.  A peak whose residual exceeds *reject*
    × the median and *keep_within* (Å⁻¹) is left out and the fit repeated, up
    to five times.  *q* and *dq* are (n, 3) in Å⁻¹; n ≥ 2 is needed, and the
    directions must not all be parallel (``degenerate`` otherwise: the
    rotation about their common direction moves nothing).
    """
    qv: NDArray[np.float64] = np.asarray(q, dtype=np.float64).reshape(-1, 3)
    dqv: NDArray[np.float64] = np.asarray(dq, dtype=np.float64).reshape(-1, 3)
    q = qv
    n = len(qv)
    w = np.ones(n) if weights is None else np.asarray(weights, dtype=np.float64).reshape(-1)
    dperp = _transverse(qv, dqv)
    qq = np.sum(qv * qv, axis=1)

    def solve(sel: NDArray[np.bool_]) -> tuple[NDArray[np.float64], NDArray[np.float64], bool]:
        ws, qs = w[sel], q[sel]
        nmat = (np.sum(ws * qq[sel]) * np.eye(3)
                - np.einsum("i,ij,ik->jk", ws, qs, qs))
        b = np.sum(ws[:, None] * np.cross(qs, dperp[sel]), axis=0)
        lam = np.linalg.eigvalsh(nmat)
        degenerate = not (lam[0] > 1e-8 * max(lam[-1], 1e-300))
        ninv = np.linalg.pinv(nmat) if degenerate else np.linalg.inv(nmat)
        return ninv @ b, ninv, degenerate

    used = np.ones(n, dtype=bool)
    omega, ninv, degenerate = solve(used)
    for _round in range(5):
        resid = np.linalg.norm(dperp - np.cross(omega, q), axis=1)
        limit = max(reject * float(np.median(resid[used])), float(keep_within))
        kept = resid <= limit
        if int(kept.sum()) < max(2, MIN_PEAKS // 2) or np.array_equal(kept, used):
            break
        used = kept
        omega, ninv, degenerate = solve(used)
    r = dperp - np.cross(omega, q)
    rss0 = float(np.sum(w[used] * np.sum(dperp[used] ** 2, axis=1)))
    rss1 = float(np.sum(w[used] * np.sum(r[used] ** 2, axis=1)))
    dof = 2 * int(used.sum()) - 3
    s2 = rss1 / dof if dof > 0 else float("inf")
    return RotationFit(
        omega=omega, covariance=s2 * ninv, used=used, rss0=rss0, rss1=rss1, dof=dof,
        rms_before=float(np.sqrt(np.mean(np.sum(dperp[used] ** 2, axis=1)))),
        rms_after=float(np.sqrt(np.mean(np.sum(r[used] ** 2, axis=1)))),
        degenerate=degenerate)


@dataclass(frozen=True)
class Misorientation:
    """The punch's diagnosis of a turned UB (see the module docstring).

    ``status`` is one of :data:`STATUSES`; the rest is the fit's, NaN or empty
    where there was none.  ``max_shift`` is |ω × q| at the punched node where
    it is largest (Å⁻¹), ``voxel_q`` the voxel it is judged against.
    """

    status: str
    n_peaks: int = 0
    n_rejected: int = 0
    omega: tuple[float, float, float] = (0.0, 0.0, 0.0)
    covariance: tuple[tuple[float, ...], ...] = ()
    angle_deg: float = float("nan")
    sigma_deg: float = float("nan")
    axis: tuple[float, float, float] | None = None
    axis_uvw: tuple[float, float, float] | None = None
    axis_sigma_deg: float = float("nan")
    r2: float = float("nan")
    f_stat: float = float("nan")
    p_value: float = float("nan")
    rms_before: float = float("nan")
    rms_after: float = float("nan")
    max_shift: float = float("nan")
    voxel_q: float = float("nan")
    significant: bool = False
    explains: bool = False
    resolved: bool = False
    rules: dict[str, float] = field(default_factory=lambda: {
        "p_significant": P_SIGNIFICANT, "r2_explains": R2_EXPLAINS,
        "resolved_voxels": RESOLVED_VOXELS, "min_peaks": MIN_PEAKS,
        "fit_min_significance": FIT_MIN_SIGNIFICANCE})

    @property
    def active(self) -> bool:
        return self.status == "active"

    @property
    def fitted(self) -> bool:
        """Whether a rotation was fitted (any status but the last three)."""
        return self.status not in {"too_few_peaks", "symmetrised", "no_peaks"}

    def vector(self) -> NDArray[np.float64]:
        return np.asarray(self.omega, dtype=np.float64)

    def shift(self, q: NDArray[np.floating]) -> NDArray[np.float64]:
        """ω × q: where the rotation moves the peak at Cartesian *q* (Å⁻¹)."""
        return np.cross(self.vector(), np.asarray(q, dtype=np.float64))

    def describe(self) -> str:
        """One line for the run log."""
        if self.status == "symmetrised":
            return ("UB check from the peaks: not on symmetrised data (a turned UB shows "
                    "there as rings around the nodes, not shifts)")
        if self.status in {"too_few_peaks", "no_peaks"}:
            return (f"UB check from the peaks: {self.n_peaks} strong peaks with fitted "
                    f"centres, too few to fit a rotation (need {MIN_PEAKS})")
        head = (f"UB turned {self.angle_deg:.3f}° ± {self.sigma_deg:.3f}° about "
                f"{_axis_text(self.axis_uvw)} (real space) from {self.n_peaks} peaks: "
                f"explains {self.r2:.0%} of their transverse offsets, p = {self.p_value:.2g}, "
                f"largest shift {self.max_shift:.3g} Å⁻¹ "
                f"({self.max_shift / self.voxel_q:.2g} voxels)")
        verdict = {
            "active": "; refine the UB in the data reduction",
            "not_significant": "; no rotation beyond chance",
            "not_explained": "; a rotation does not explain the offsets",
            "unresolved": "; under half a voxel, nothing to act on",
        }[self.status]
        return head + verdict

    def to_json(self) -> dict[str, Any]:
        def num(x: float, nd: int = 6) -> float | None:
            return None if not np.isfinite(x) else round(float(x), nd)

        def vec(v: tuple[float, ...] | None, nd: int = 6) -> list[float] | None:
            return None if v is None else [round(float(x), nd) for x in v]

        return {
            "status": self.status, "active": self.active,
            "n_peaks": self.n_peaks, "n_rejected": self.n_rejected,
            "omega_rad": vec(self.omega, 9),
            "angle_deg": num(self.angle_deg), "sigma_deg": num(self.sigma_deg),
            "axis": vec(self.axis), "axis_uvw": vec(self.axis_uvw, 4),
            "axis_sigma_deg": num(self.axis_sigma_deg, 3),
            "r2": num(self.r2, 4), "f_stat": num(self.f_stat, 3),
            "p_value": None if not np.isfinite(self.p_value) else float(f"{self.p_value:.3g}"),
            "rms_before": num(self.rms_before), "rms_after": num(self.rms_after),
            "max_shift": num(self.max_shift), "voxel_q": num(self.voxel_q),
            "significant": self.significant, "explains": self.explains,
            "resolved": self.resolved, "rules": dict(self.rules),
        }


def _axis_text(uvw: tuple[float, float, float] | None) -> str:
    if uvw is None:
        return "?"
    return "[" + " ".join(f"{v:.2f}".rstrip("0").rstrip(".") if v else "0" for v in uvw) + "]"


def judge(fit: RotationFit, ub: NDArray[np.floating], node_q: NDArray[np.floating],
          voxel_q: float, n_rejected: int) -> Misorientation:
    """:class:`Misorientation` of *fit* by the rule (module docstring).

    *node_q* are the punched nodes' Cartesian Q (Å⁻¹), for the largest shift
    the rotation predicts; *ub* gives the axis as a real-space direction.
    """
    omega = fit.omega
    angle = fit.angle
    axis = omega / angle if angle > 0 else None
    uvw = None
    if axis is not None:
        u = np.asarray(ub, dtype=np.float64).T @ axis / (2.0 * np.pi)
        uvw = u / u[np.argmax(np.abs(u))]
    nq = np.asarray(node_q, dtype=np.float64).reshape(-1, 3)
    max_shift = float(np.max(np.linalg.norm(np.cross(omega, nq), axis=1))) if len(nq) else 0.0
    significant = (not fit.degenerate) and fit.p_value < P_SIGNIFICANT
    explains = fit.r2 >= R2_EXPLAINS
    resolved = max_shift >= RESOLVED_VOXELS * float(voxel_q)
    status = ("not_significant" if not significant else "not_explained" if not explains
              else "unresolved" if not resolved else "active")
    return Misorientation(
        status=status, n_peaks=fit.n_used, n_rejected=n_rejected,
        omega=(float(omega[0]), float(omega[1]), float(omega[2])),
        covariance=tuple(tuple(float(x) for x in row) for row in fit.covariance),
        angle_deg=float(np.degrees(angle)), sigma_deg=float(np.degrees(fit.sigma_angle)),
        axis=None if axis is None else (float(axis[0]), float(axis[1]), float(axis[2])),
        axis_uvw=None if uvw is None else (float(uvw[0]), float(uvw[1]), float(uvw[2])),
        axis_sigma_deg=float(np.degrees(fit.sigma_axis)),
        r2=fit.r2, f_stat=fit.f_stat, p_value=fit.p_value,
        rms_before=fit.rms_before, rms_after=fit.rms_after,
        max_shift=max_shift, voxel_q=float(voxel_q),
        significant=significant, explains=explains, resolved=resolved)


def centre_weights(significance: NDArray[np.floating], voxel_q: float) -> NDArray[np.float64]:
    """Relative weights 1/σᵢ² of fitted centres: σᵢ = voxel·√(0.1² + (2/zᵢ)²)
    (:data:`CENTRE_FLOOR_VOXELS`, :data:`CENTRE_NOISE_VOXELS`)."""
    z = np.asarray(significance, dtype=np.float64)
    s = float(voxel_q) * np.sqrt(CENTRE_FLOOR_VOXELS ** 2 + (CENTRE_NOISE_VOXELS / z) ** 2)
    return 1.0 / (s * s)


def diagnose(
    ub: NDArray[np.floating],
    nodes: NDArray[np.floating],
    centres: NDArray[np.floating],
    significance: NDArray[np.floating],
    all_nodes: NDArray[np.floating],
    voxel_q: float,
    *,
    symmetrised: bool = False,
) -> Misorientation:
    """The diagnosis from the strong peaks' *nodes* and fitted *centres* (HKL).

    *significance* weighs them (:func:`centre_weights`); *all_nodes* are every
    punched node (HKL), for the largest predicted shift; *voxel_q* the voxel
    size (Å⁻¹, ``BraggRemover.voxel_edge_q``).
    """
    if symmetrised:
        return Misorientation(status="symmetrised")
    ub = np.asarray(ub, dtype=np.float64)
    h = np.asarray(nodes, dtype=np.float64).reshape(-1, 3)
    c = np.asarray(centres, dtype=np.float64).reshape(-1, 3)
    if len(h) == 0:
        return Misorientation(status="no_peaks")
    if len(h) < MIN_PEAKS:
        return Misorientation(status="too_few_peaks", n_peaks=len(h))
    q = h @ ub.T
    dq = (c - h) @ ub.T
    fit = fit_rotation(q, dq, centre_weights(significance, voxel_q),
                       keep_within=0.5 * float(voxel_q))
    if fit.n_used < MIN_PEAKS:
        return Misorientation(status="too_few_peaks", n_peaks=fit.n_used,
                              n_rejected=len(h) - fit.n_used)
    node_q = np.asarray(all_nodes, dtype=np.float64).reshape(-1, 3) @ ub.T
    return judge(fit, ub, node_q, voxel_q, len(h) - fit.n_used)


def capsule_inside(
    dh: NDArray[np.float64],
    dk: NDArray[np.float64],
    dl: NDArray[np.float64],
    shape_matrix: NDArray[np.float64],
    segment: NDArray[np.float64],
) -> NDArray[np.bool_]:
    """Voxels within the ellipsoid ``δᵀAδ ≤ 1`` swept along ±*segment* (HKL).

    The punch stretched along a direction: δ is inside when
    ``min over t ∈ [−1, 1] of (δ − t·s)ᵀ A (δ − t·s) ≤ 1``, the minimum at
    ``t* = clip(sᵀAδ / sᵀAs, −1, 1)``.  The union of the ellipsoid moved
    from −s to +s, exactly, with no widening across s.
    """
    a = np.asarray(shape_matrix, dtype=np.float64)
    s = np.asarray(segment, dtype=np.float64)
    a_s = a @ s
    sas = float(s @ a_s)
    quad = (a[0, 0] * dh * dh + a[1, 1] * dk * dk + a[2, 2] * dl * dl
            + 2.0 * a[0, 1] * dh * dk + 2.0 * a[0, 2] * dh * dl + 2.0 * a[1, 2] * dk * dl)
    if not sas > 0:
        return quad <= 1.0
    proj = a_s[0] * dh + a_s[1] * dk + a_s[2] * dl
    t = np.clip(proj / sas, -1.0, 1.0)
    return quad - 2.0 * t * proj + t * t * sas <= 1.0
