# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Bragg peak removal (punch step) for 3D-ΔPDF preparation.

Bragg peaks sit at (near-)integer (h, k, l) positions and are orders of magnitude
stronger than the diffuse signal. They must be excised ("punched") before
Fourier transforming to the 3D-ΔPDF.

Strategy
--------
1. Enumerate the integer (h,k,l) nodes within the HKL grid extent.
2. **Data-driven detection** (``min_intensity`` set): keep only nodes that carry
   a real peak (local max above ``min_intensity`` and above the local background
   by ``min_prominence``).  This crystal has many systematic absences — punching
   every node would gouge diffuse signal at the ~3/4 of nodes that are extinct.
   Each surviving peak is re-centred on its local argmax (peaks drift off the
   exact integer by thermal contraction etc.).
3. Punch a 3D ellipsoidal hole at each detected peak.  Its size is set in Q
   (Å⁻¹), where the instrument resolution lives — per peak in the local
   spherical frame (radial, polar, azimuthal) by default, or along a*, b*, c* —
   and optionally **scales with intensity** (bright peaks have longer tails).
   Radii in fractional HKL were removed: they depend on the cell, not on the
   resolution, and are wrong along non-orthogonal axes.
4. The mask is built on **local windows** around each peak, never a full-volume
   array per peak, so it scales to thousands of peaks on a 50M-voxel volume.

Punch → backfill (``nebula3d.analysis.backfill_bragg``) → ΔPDF.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume, q_bin_indices, q_magnitude_from_axes


@dataclass(frozen=True)
class _PeakPunch:
    """Internal Bragg peak description used to build the punch mask.

    ``detect_peaks()`` keeps returning the historical ``(ih, ik, il, intensity)``
    tuples for callers/tests.  Internally we keep the richer fitted HKL centre
    and optional per-peak shape so integer-node detection can decide at the
    lattice node, recenter on the nearby maximum, and punch the fitted peak
    footprint rather than a one-size-fits-all voxel-centred ellipsoid.
    """

    ih: int
    ik: int
    il: int
    intensity: float
    center_hkl: tuple[float, float, float]
    # Per-peak 3×3 HKL shape matrix A (punch where δᵀAδ ≤ 1), set by the
    # covariance fit; ``None`` punches the punch-frame ellipsoid.
    shape_hkl: NDArray[np.float64] | None = None
    source_node_hkl: tuple[int, int, int] | None = None
    local_background: float = float("nan")

    def as_tuple(self) -> tuple[int, int, int, float]:
        return self.ih, self.ik, self.il, self.intensity


def _ellipsoid_inside(
    dh: NDArray[np.float64],
    dk: NDArray[np.float64],
    dl: NDArray[np.float64],
    *,
    radii: tuple[float, float, float] | None = None,
    shape_matrix: NDArray[np.float64] | None = None,
) -> NDArray[np.bool_]:
    """Boolean mask of voxels inside the punch quadratic form ``δᵀ A δ ≤ 1``.

    ``δ = (dh, dk, dl)`` are HKL offsets from the peak centre.  This is the
    single punch-shape kernel; the shape ``A`` is given one of two equivalent
    ways:

    - ``radii=(rh, rk, rl)`` — an axis-aligned ellipsoid, ``A = diag(1/r²)``.
      Evaluated with the historical ``(d/r)²`` arithmetic so the punch is
      *bit-identical* to the pre-Q-space kernel (the diagonal fast path).
    - ``shape_matrix`` — a general 3×3 symmetric (SPD) ``A`` in HKL coordinates,
      e.g. ``UBᵀ M UB`` for a Q-space resolution ellipsoid ``M`` (the
      forward-looking general path; see ``ROADMAP.md`` → Phase 6).

    Exactly one of ``radii`` / ``shape_matrix`` must be supplied.  The two
    descriptions agree to floating-point tolerance when ``A = diag(1/r²)``; the
    diagonal fast path is kept because it reproduces the old result exactly,
    while general ``A`` may flip a voxel sitting exactly on the ``quad == 1``
    boundary (different arithmetic path).
    """
    if (radii is None) == (shape_matrix is None):
        raise ValueError("supply exactly one of radii / shape_matrix")
    if radii is not None:
        rh, rk, rl = radii
        quad = (dh / rh) ** 2 + (dk / rk) ** 2 + (dl / rl) ** 2
    else:
        a = shape_matrix
        assert a is not None  # narrowed by the xor check above
        quad = (
            a[0, 0] * dh * dh + a[1, 1] * dk * dk + a[2, 2] * dl * dl
            + 2.0 * a[0, 1] * dh * dk
            + 2.0 * a[0, 2] * dh * dl
            + 2.0 * a[1, 2] * dk * dl
        )
    return quad <= 1.0


def _core_variance_fraction(frac: float) -> float:
    """Second moment of a 3-D Gaussian's core, as a fraction of its variance.

    The shape fit weights only the voxels whose excess is at least ``frac`` of
    the peak's.  For a Gaussian that core is the ellipsoid ``δᵀΣ⁻¹δ ≤ c`` with
    ``c = 2 ln(1/frac)``, and its excess-weighted second moment is ``κ·Σ`` with
    ``κ = P(χ²₅ ≤ c) / P(χ²₃ ≤ c)``.  κ is the same along every principal axis,
    so the cut shrinks the widths but not the tilt.  ``κ(0.35) = 0.368`` (widths
    ×0.607); dividing the core's covariance by κ recovers Σ.
    """
    if not 0.0 < frac < 1.0:
        return 1.0
    from scipy.special import gammainc

    x = -float(np.log(frac))  # c / 2
    return float(gammainc(2.5, x) / gammainc(1.5, x))


def _clip_ellipsoid(
    m: NDArray[np.float64],
    ref: NDArray[np.float64],
    *,
    upper: bool,
) -> NDArray[np.float64]:
    """Clip ellipsoid ``m`` to contain ``ref`` (floor) or lie inside it (``upper``).

    Both are radius matrices: the ellipsoid is ``xᵀm⁻¹x ≤ 1``, so ``m = A⁻¹ =
    R diag(r²) Rᵀ``.  In the frame where ``ref`` is the unit sphere, ``m``'s
    principal radii below 1 are raised to 1 (floor) or those above 1 lowered to
    1 (ceiling).  ``m`` is unchanged wherever it already complies, and the
    result is the same in any linear frame (HKL or Q).
    """
    w, v = np.linalg.eigh(ref)
    w = np.clip(w, np.finfo(np.float64).tiny, None)
    half = (v * np.sqrt(w)) @ v.T
    ihalf = (v / np.sqrt(w)) @ v.T
    lam, u = np.linalg.eigh(ihalf @ m @ ihalf)
    lam = np.minimum(lam, 1.0) if upper else np.maximum(lam, 1.0)
    out = half @ ((u * lam) @ u.T) @ half
    return np.asarray(0.5 * (out + out.T), dtype=np.float64)


@dataclass
class BraggRemover:
    """Detect and punch Bragg reflections in an HKLVolume.

    Parameters
    ----------
    mode:
        ``"integer"`` (default) punches at integer (h,k,l) nodes (symmetry-based).
        ``"auto"`` / ``"search"`` finds *any* sharp peak as a high-tail outlier above the
        robust per-|Q|-shell diffuse level — catches off-integer satellites
        (small-domain / superlattice reflections) the integer mode misses, at the
        cost of also removing any sharp *structural* diffuse (acceptable when only
        magnetic diffuse is wanted).  ``"both"`` takes the union.
    punch_frame:
        Frame the punch ellipsoid is sized in, both in Å⁻¹.  ``"spherical"``
        (default): ``punch_spherical_radii`` (rρ, rθ, rφ) along each peak's own
        radial (Q̂), polar and azimuthal (a*–b* ring tangent, about c*) axes.
        ``"q"``: ``punch_q_radius`` (a Q-sphere) or ``punch_q_radii`` along a*,
        b*, c*.  This ellipsoid is the punch for peaks without a shape fit, and
        the floor of the covariance fit, which grows it along the peak's own
        principal axes where the peak is wider.
    punch_spherical_radii:
        (rρ, rθ, rφ) half-radii in Å⁻¹ for the spherical frame.
    punch_q_radius, punch_q_radii:
        Isotropic, or per-a*/b*/c*, half-radii in Å⁻¹ for the ``"q"`` frame.
    min_intensity:
        Detection threshold.  ``None`` (default) punches **every** integer node
        (legacy behaviour).  When set, only nodes whose local peak intensity
        exceeds this value (and the local background by ``min_prominence``) are
        punched — the data-driven path that skips systematic absences.
    min_prominence:
        A detected peak must exceed its local-window median by at least this.
    integer_n_mad:
        Optional per-|Q|-shell threshold for integer-node detection.  When set,
        each integer node's local peak must also exceed the robust diffuse level
        in its |Q| shell (``median + integer_n_mad * MAD``).  This keeps the
        lattice-aware search sensitive to weak high-|Q| Bragg peaks without
        punching extinct nodes from a flat global floor alone.
    integer_q_step:
        |Q| shell width for ``integer_n_mad``.  ``None`` reuses
        ``search_q_step``.
    integer_optimize_position:
        If True, move accepted integer-node peaks to the excess-weighted
        centroid of their core (see ``integer_optimize_shape``) — a continuous
        HKL punch centre instead of the hottest voxel centre.
    integer_optimize_shape:
        If True, fit each integer-node peak's punch ellipsoid, tilt included,
        from the covariance of its core, in Q.  The core is the voxels connected
        to the peak above the ``integer_fit_threshold_frac`` cut, in a window
        sized in Å⁻¹; its covariance is corrected for the cut.  Principal radii
        are ``integer_fit_radius_n_sigma``·σ plus half a voxel along each Q
        axis.  The ellipsoid always contains the resolution ellipsoid of the
        active ``punch_frame`` and lies inside ``max_radius_scale``× it (or
        inside ``integer_fit_max_radius_hkl``).
    integer_fit_unconstrained:
        If True, covariance-fit radii are not clipped to the floor/ceiling.
        Useful for diagnosing the measured Bragg profile, but it can create
        very small or very large punch ellipsoids on noisy fits.
    integer_fit_threshold_frac:
        Fraction of peak excess above local background used to select voxels for
        the centroid/shape fit.
    integer_fit_noise_n_mad:
        The covariance fit measures a peak only when its core cut
        (``integer_fit_threshold_frac`` × the excess) clears this many robust
        noise sigmas of the fit window (peak ≳ 8.6× noise at the defaults).
        Weaker peaks get the resolution ellipsoid: their core would follow the
        surrounding signal, not the peak.
    integer_fit_radius_n_sigma:
        Convert fitted second-moment widths to punch half-radii by this factor.
        A small half-voxel padding is added before clipping.
    integer_fit_max_radius_hkl:
        Optional upper clamp for fitted integer-node radii.  ``None`` uses
        ``max_radius_scale`` × the resolution ellipsoid.
    integer_h_guard_hkl:
        Optional half-width around the source integer-H plane for integer-node
        punches.  When set, fitted/scaled integer punches are clipped to
        ``|H - H_integer| <= integer_h_guard_hkl`` so strong Bragg peaks on
        integer-H planes cannot bleed into fractional-H diffuse planes.
    detect_window_hkl:
        Half-width (HKL) of the window used to locate/centre a peak and estimate
        its local background.
    intensity_scale:
        If True, multiply the punch radii by ``clip((I/intensity_ref)**(1/3), 1,
        max_radius_scale)`` so bright peaks (longer tails) get larger holes.
    intensity_ref:
        Reference intensity for the scaling.  ``None`` → the median detected-peak
        intensity (computed once).
    max_radius_scale:
        Upper clamp on the intensity radius multiplier.
    margin:
        Extra half-width (Å⁻¹) added to every punch radius — a guard band so the
        peak's faint wings are removed too.
    punch_incident_beam:
        Punch the nearest voxel to (0,0,0) as a separate incident-beam remnant,
        not as a Bragg reflection.  It is much brighter and broader than Bragg
        peaks, so it has independent radii / margin / tail settings.
    incident_beam_radii:
        Independent HKL half-radii for the incident-beam punch.  Defaults to
        twice the HKL bounding box of the Bragg punch when unset.
    incident_beam_margin:
        Extra margin for the incident-beam punch.
    incident_beam_phi_tail_hkl:
        Extra K-L tangential half-width for the incident-beam remnant.
    incident_beam_q_radii:
        Q-space incident/direct-beam half-radii along a*, b*, c* in Å⁻¹.
        When set, this is converted through the UB matrix into the same general
        HKL shape-matrix punch used by the Q-space Bragg footprint.
    incident_beam_q_margin:
        Q-space margin in Å⁻¹ added to each ``incident_beam_q_radii`` component.
    incident_beam_ellipsoid_radii_hkl:
        If set, punch the incident beam as an origin-centred **anisotropic
        ellipsoid** ``(rh, rk, rl)`` in fractional HKL units.  Takes precedence
        over ``incident_beam_sphere_radius_hkl``.  Use this when the direct-beam
        footprint differs substantially along H, K, and L (size from linecuts
        through the origin).
    incident_beam_sphere_radius_hkl:
        If set (and ``incident_beam_ellipsoid_radii_hkl`` is *not* set), punch
        the incident beam as an isotropic HKL sphere around the origin.
    force_origin:
        Deprecated alias for ``punch_incident_beam``.
    phi_tail_hkl:
        Extra tangential half-width in the K-L plane, along the local powder-ring
        φ direction.  Use this when Bragg tails smear along rings rather than
        along the H/K/L grid axes.
    search_exclude_h_centers:
        Optional H-plane centres excluded from the hkl-agnostic search stage.
        Use this to protect known fractional-H diffuse planes while still using
        ``mode="both"`` for integer Bragg plus off-integer satellites elsewhere.
    search_exclude_h_half_width:
        Half-width in H around each protected search-exclusion centre.
    subtract_profile:
        Reserved (profile-subtraction path not implemented in this pass).
    """

    mode: str = "integer"
    min_intensity: float | None = None
    min_prominence: float = 1.0
    integer_n_mad: float | None = None
    integer_q_step: float | None = None
    integer_min_shell_size: int = 20
    # Local relative-prominence catch for *small but sharp* Bragg at integer
    # nodes: keep a node when (peak - local_bg) >= integer_local_prominence_n_mad
    # * (1.4826 * local MAD), measured in the detection window — even if it is
    # below the absolute min_intensity / min_prominence floors and the per-|Q|
    # shell threshold.  Position-locked to integer nodes (never a thirds plane),
    # so it is inherently safe for the fractional-H diffuse.  ``None`` disables.
    integer_local_prominence_n_mad: float | None = None
    integer_local_min_prominence: float = 0.0
    integer_optimize_position: bool = False
    # The covariance fit in Q (a tilted ellipsoid following the peak's real
    # orientation), floored at the resolution ellipsoid; the φ-tail folds in as
    # a tangential inflation.
    integer_optimize_shape: bool = False
    integer_fit_unconstrained: bool = False
    integer_fit_threshold_frac: float = 0.35
    # The covariance fit's core cut must clear this many robust noise sigmas
    # (1.4826·MAD of the fit window); weaker peaks get the resolution ellipsoid.
    integer_fit_noise_n_mad: float = 3.0
    integer_fit_radius_n_sigma: float = 2.5
    integer_fit_max_radius_hkl: tuple[float, float, float] | None = None
    integer_h_guard_hkl: float | None = None
    detect_window_hkl: float = 0.2
    intensity_scale: bool = False
    intensity_ref: float | None = None
    max_radius_scale: float = 3.0
    margin: float = 0.0
    punch_incident_beam: bool = True
    incident_beam_radii: tuple[float, float, float] | None = None
    incident_beam_margin: float = 0.08
    incident_beam_phi_tail_hkl: float = 0.0
    incident_beam_q_radii: tuple[float, float, float] | None = None
    incident_beam_q_margin: float = 0.0
    incident_beam_ellipsoid_radii_hkl: tuple[float, float, float] | None = None
    incident_beam_sphere_radius_hkl: float | None = None
    # Fit a tilted covariance ellipsoid in Q to the direct-beam remnant at the
    # origin (analogue of ``integer_optimize_shape`` for Bragg peaks).  The fit
    # always contains the fixed direct-beam punch, so it only follows/expands
    # the real beam shape, never punches smaller; falls back to the fixed punch
    # when the origin is masked or no excess is found.
    incident_beam_fit_covariance: bool = False
    force_origin: bool | None = None
    phi_tail_hkl: float = 0.0
    # --- punch size, in Q (Å⁻¹) ---
    # Both frames feed the quadratic-form kernel ``δhklᵀ A δhkl ≤ 1`` with ``A``
    # built from the UB metric.  ``"spherical"`` (default) sizes the punch in the
    # *local* spherical frame at each peak — (rρ, rθ, rφ) with rρ along Q̂, rφ
    # along the azimuthal (a*–b* plane) tangent ẑ×Q̂ (ẑ = c*) and rθ along the
    # polar tangent Q̂×φ̂ — rebuilt per peak (see ``_spherical_frame``).  ``"q"``
    # uses one Q-sphere or fixed a*/b*/c* radii (see ``_q_shape_matrix``).  The
    # covariance fit floors at this ellipsoid and tilts with the measured peak.
    punch_frame: str = "spherical"
    punch_q_radius: float | None = None  # isotropic, Å^-1  (A = g / ρ²)
    punch_q_radii: tuple[float, float, float] | None = None  # per a*,b*,c*, Å^-1
    punch_spherical_radii: tuple[float, float, float] | None = (0.097, 0.072, 0.115)
    # --- search mode (|Q|-shell outlier detection) ---
    search_q_step: float = 0.05
    search_n_mad: float = 8.0
    search_min_intensity: float = 2.0
    search_min_prominence: float = 0.0
    search_exclude_h_centers: tuple[float, ...] | None = None
    search_exclude_h_half_width: float = 0.0
    # Periodic H protection: fractional parts (mod 1, in [0,1)) of H to protect
    # across the WHOLE range, e.g. (1/3, 2/3) shields every integer±1/3 plane
    # (the q=1/3 satellite family) — not just a fixed centre list.  Uses the same
    # search_exclude_h_half_width.  ``None`` disables.
    search_exclude_h_fractions: tuple[float, ...] | None = None
    subtract_profile: bool = False

    def __post_init__(self) -> None:
        frame = str(self.punch_frame).lower()
        if frame not in {"spherical", "q"}:
            raise ValueError(
                f"punch_frame={self.punch_frame!r}: choose 'spherical' or 'q' (radii "
                f"in Å⁻¹).  The fractional-HKL frame was removed — HKL radii depend "
                f"on the cell, not on the resolution.")

    @staticmethod
    def _shape_matrix_from_q_radii(
        vol: HKLVolume,
        radii_q: tuple[float, float, float],
    ) -> NDArray[np.float64]:
        """HKL shape matrix for Q half-radii along a*, b*, c*.

        The punch is ``δhklᵀ A δhkl ≤ 1`` (see :func:`_ellipsoid_inside`).  With
        ``punch_q_radii`` (ra, rb, rc) (Å^-1, along the reciprocal axes
        a*, b*, c*), ``A = Pᵀ diag(1/r²) P`` with ``P = ê·UB``
        (``ê`` = unit reciprocal-axis directions).
        """
        ra, rb, rc = (float(r) for r in radii_q)
        if min(ra, rb, rc) <= 0:
            raise ValueError("Q-space radii must be positive")
        ub = vol.ub_matrix
        unit = ub / np.linalg.norm(ub, axis=0)  # columns = unit recip-axis dirs
        p = unit.T @ ub
        d = np.diag([1.0 / ra**2, 1.0 / rb**2, 1.0 / rc**2])
        return p.T @ d @ p

    def _q_shape_matrix(
        self,
        vol: HKLVolume,
        *,
        scale: float = 1.0,
        margin_q: float = 0.0,
    ) -> NDArray[np.float64] | None:
        """HKL shape matrix ``A`` for the ``"q"`` frame, or ``None`` in the spherical one.

        The punch is ``δhklᵀ A δhkl ≤ 1`` (see :func:`_ellipsoid_inside`).  With
        the metric ``g = UBᵀUB``:

        - ``punch_q_radius`` ρ (Å^-1, isotropic) → ``A = g / ρ²`` — a true Q-sphere
          ``|δQ| ≤ ρ`` for any crystal system.
        - ``punch_q_radii`` (ra, rb, rc) (Å^-1, along the reciprocal axes
          a*, b*, c*) → ``A = Pᵀ diag(1/r²) P`` with ``P = ê·UB`` (``ê`` = unit
          reciprocal-axis directions), the anisotropic generalisation.

        ``scale`` applies intensity scaling; ``margin_q`` is an additive Q-space
        guard band (Å^-1) applied after scaling, matching the web Bragg controls.
        """
        if str(self.punch_frame).lower() != "q":
            return None
        ub = vol.ub_matrix
        scale = max(0.0, float(scale))
        margin_q = max(0.0, float(margin_q))
        if self.punch_q_radii is not None:
            radii = tuple(
                float(r) * scale + margin_q for r in self.punch_q_radii
            )
            return self._shape_matrix_from_q_radii(vol, radii)  # type: ignore[arg-type]
        if self.punch_q_radius is not None:
            rho = float(self.punch_q_radius) * scale + margin_q
            if rho <= 0:
                raise ValueError("punch_q_radius must be positive")
            return (ub.T @ ub) / rho**2
        raise ValueError('punch_frame="q" requires punch_q_radius or punch_q_radii')

    @staticmethod
    def _spherical_frame(
        vol: HKLVolume,
        center_hkl: tuple[float, float, float],
    ) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]] | None:
        """Orthonormal Cartesian-Q spherical frame ``(ρ̂, θ̂, φ̂)`` at a peak.

        With ``UB`` mapping hkl→Q (Å⁻¹) and the **polar axis = c\\*** (Qz):

        - ``ρ̂ = Q/|Q|`` — radial (longitudinal, the |Q| / Δd-d direction).
        - ``φ̂ = (ẑ × ρ̂)/|ẑ × ρ̂|`` — azimuthal tangent in the a\\*–b\\* plane
          (the powder-ring tangent; ``ẑ`` = unit c\\*).
        - ``θ̂ = φ̂ × ρ̂`` — polar tangent (completes a right-handed frame,
          ``ρ̂ × θ̂ = φ̂``; the ellipsoid is invariant to the axis sign anyway).

        Returns ``None`` if the peak is at the origin (no radial direction).  When
        ``Q̂ ∥ ẑ`` the azimuth is degenerate, so ``φ̂`` is built from a\\* instead;
        the two transverse axes are then an arbitrary (but orthonormal) basis of
        the plane ⊥ Q̂, which is the physically correct behaviour (a peak on the
        pole has no distinguished azimuth).
        """
        ub = vol.ub_matrix
        q = ub @ np.asarray(center_hkl, dtype=float)
        nq = float(np.linalg.norm(q))
        if nq <= 0 or not np.isfinite(nq):
            return None
        rho_hat = q / nq
        z = ub[:, 2] / max(float(np.linalg.norm(ub[:, 2])), 1e-300)  # unit c*
        phi = np.cross(z, rho_hat)
        if float(np.linalg.norm(phi)) < 1e-8:  # Q̂ ∥ c* → azimuth degenerate
            a = ub[:, 0] / max(float(np.linalg.norm(ub[:, 0])), 1e-300)  # unit a*
            phi = np.cross(a, rho_hat)
        npn = float(np.linalg.norm(phi))
        if npn < 1e-12:  # pathological: pick any perpendicular
            phi = np.cross(np.array([1.0, 0.0, 0.0]), rho_hat)
            npn = float(np.linalg.norm(phi))
            if npn < 1e-12:
                phi = np.cross(np.array([0.0, 1.0, 0.0]), rho_hat)
                npn = float(np.linalg.norm(phi))
        phi_hat = phi / npn
        theta_hat = np.cross(phi_hat, rho_hat)
        return rho_hat, theta_hat, phi_hat

    def _spherical_shape_matrix(
        self,
        vol: HKLVolume,
        center_hkl: tuple[float, float, float],
        *,
        scale: float = 1.0,
        margin_q: float = 0.0,
    ) -> NDArray[np.float64] | None:
        """HKL shape matrix ``A`` (``δhklᵀAδhkl ≤ 1``) for the spherical punch.

        Builds ``A_Q = R diag(1/rρ², 1/rθ², 1/rφ²) Rᵀ`` with ``R = [ρ̂ θ̂ φ̂]`` at
        this peak, then ``A = UBᵀ A_Q UB``.  ``scale`` multiplies the radii;
        ``margin_q`` (Å⁻¹) is added to each radius after scaling — same contract as
        :meth:`_q_shape_matrix`.  Returns ``None`` at the origin (frame undefined).

        Isotropic ``rρ=rθ=rφ=ρ`` reduces to ``A = (UBᵀUB)/ρ²`` (a true Q-sphere),
        identical to the q-frame isotropic punch.
        """
        if self.punch_spherical_radii is None:
            raise ValueError(
                'punch_frame="spherical" requires punch_spherical_radii'
            )
        scale = max(0.0, float(scale))
        margin_q = max(0.0, float(margin_q))
        radii = tuple(float(r) * scale + margin_q for r in self.punch_spherical_radii)
        if min(radii) <= 0:
            raise ValueError("spherical radii must be positive")
        frame = self._spherical_frame(vol, center_hkl)
        if frame is None:
            return None
        r_mat = np.column_stack(frame)  # columns ρ̂, θ̂, φ̂
        d = np.diag([1.0 / r**2 for r in radii])
        a_q = r_mat @ d @ r_mat.T
        ub = vol.ub_matrix
        return np.asarray(ub.T @ a_q @ ub, dtype=np.float64)

    def _active_shape_matrix(
        self,
        vol: HKLVolume,
        center_hkl: tuple[float, float, float],
        *,
        scale: float = 1.0,
        margin_q: float = 0.0,
    ) -> NDArray[np.float64] | None:
        """Per-peak punch shape matrix for the active frame, or ``None``.

        Dispatches on ``punch_frame``: ``"q"`` → the global a\\*/b\\*/c\\* ellipsoid
        (``center_hkl`` ignored); ``"spherical"`` → the per-peak spherical frame,
        ``None`` at the origin (frame undefined).
        """
        frame = str(self.punch_frame).lower()
        if frame == "spherical":
            return self._spherical_shape_matrix(
                vol, center_hkl, scale=scale, margin_q=margin_q)
        if frame == "q":
            return self._q_shape_matrix(vol, scale=scale, margin_q=margin_q)
        return None

    @staticmethod
    def _ellipsoid_bounding_radii(
        shape_matrix: NDArray[np.float64],
    ) -> tuple[float, float, float]:
        """HKL half-extents of ``δᵀAδ ≤ 1`` (for local-window sizing).

        The extent along HKL axis ``i`` is ``sqrt((A⁻¹)_ii)``.
        """
        inv = np.linalg.inv(shape_matrix)
        return (
            float(np.sqrt(max(inv[0, 0], 0.0))),
            float(np.sqrt(max(inv[1, 1], 0.0))),
            float(np.sqrt(max(inv[2, 2], 0.0))),
        )

    def _h_guard_for(self, peak: _PeakPunch) -> tuple[float, float] | None:
        """Integer-H guard slab for a peak, or ``None`` if disabled."""
        if peak.source_node_hkl is None or self.integer_h_guard_hkl is None:
            return None
        return (float(peak.source_node_hkl[0]), float(self.integer_h_guard_hkl))

    def _fit_base_radii(self, vol: HKLVolume) -> tuple[float, float, float]:
        """The HKL bounding box of the base Q ellipsoid.

        The axis-aligned fallback (a peak where the frame is undefined)
        punches it, and the default direct-beam punch is twice it.  In the
        spherical frame it is taken at a representative off-pole point along
        a* — the bounding-box scale depends on the radii and orientation, not
        on |Q|.
        """
        if str(self.punch_frame).lower() == "spherical":
            a = self._spherical_shape_matrix(vol, (1.0, 0.0, 0.0))
        else:
            a = self._q_shape_matrix(vol)
        if a is None:
            raise ValueError("the punch ellipsoid is undefined for this UB matrix")
        return self._ellipsoid_bounding_radii(a)

    def _shape_from_q_covariance(
        self,
        vol: HKLVolume,
        cov_hkl: NDArray[np.float64],
        floor_hkl: NDArray[np.float64],
        ceiling_hkl: NDArray[np.float64],
        *,
        constrain: bool = True,
    ) -> NDArray[np.float64]:
        """HKL punch shape ``A`` from a peak's HKL covariance, sized in Q.

        The principal axes come from ``Σ_Q = UB·C·UBᵀ`` (Å⁻²), where the metric
        is physical; an eigen-decomposition in HKL would skew them by the
        |a*|:|b*|:|c*| ratios.  Each principal radius is
        ``integer_fit_radius_n_sigma``·σ plus half a voxel along that Q axis.
        With ``constrain`` the ellipsoid is clipped to lie inside
        ``ceiling_hkl`` and then to contain ``floor_hkl`` (radius matrices,
        ``A⁻¹``; see :func:`_clip_ellipsoid`), so it is never smaller than the
        resolution.  Returns ``A = UBᵀ·M_Q⁻¹·UB``.
        """
        ub = vol.ub_matrix
        n_sigma = max(float(self.integer_fit_radius_n_sigma), 0.0)
        lam, u = np.linalg.eigh(ub @ cov_hkl @ ub.T)
        # Half the voxel along each principal axis (columns = one grid step
        # along H, K, L in Q) — the same pad the profile's resolution flag uses.
        voxel_q = ub * np.abs(np.asarray(self._steps(vol)))
        pad = 0.5 * np.sqrt(((u.T @ voxel_q) ** 2).sum(axis=1))
        r = n_sigma * np.sqrt(np.clip(lam, 0.0, None)) + pad
        r = np.maximum(r, np.finfo(np.float64).eps)
        m_q = (u * r**2) @ u.T
        if constrain:
            m_q = _clip_ellipsoid(m_q, ub @ ceiling_hkl @ ub.T, upper=True)
            m_q = _clip_ellipsoid(m_q, ub @ floor_hkl @ ub.T, upper=False)
        a = ub.T @ np.linalg.inv(m_q) @ ub
        return np.asarray(0.5 * (a + a.T), dtype=np.float64)

    def _fit_ceiling(self, floor_hkl: NDArray[np.float64]) -> NDArray[np.float64]:
        """Radius matrix the covariance fit may not exceed (HKL)."""
        if self.integer_fit_max_radius_hkl is not None:
            return np.diag([float(r) ** 2 for r in self.integer_fit_max_radius_hkl])
        return floor_hkl * float(self.max_radius_scale) ** 2

    def _window_around(
        self,
        vol: HKLVolume,
        idx: tuple[int, int, int],
        radius_hkl: NDArray[np.float64],
    ) -> tuple[slice, slice, slice]:
        """Grid window around voxel ``idx`` covering ellipsoid ``radius_hkl``.

        The ellipsoid's HKL bounding box plus one voxel, so the window has the
        same extent in Å⁻¹ along every axis.  A fixed r.l.u. window spans
        |a*|/|c*| times more Q along a* than along c*, and truncates peaks along
        the short reciprocal axis.
        """
        steps = np.abs(np.asarray(self._steps(vol)))
        half = np.sqrt(np.clip(np.diag(radius_hkl), 0.0, None))
        out = []
        for i, n, h, s in zip(idx, vol.shape, half, steps):
            w = int(np.ceil(h / s)) + 1
            out.append(slice(max(0, i - w), min(n, i + w + 1)))
        return out[0], out[1], out[2]

    def _core_moments(
        self,
        vol: HKLVolume,
        idx: tuple[int, int, int],
        local_bg: float,
        window: tuple[slice, slice, slice],
        *,
        about: tuple[float, float, float] | None = None,
    ) -> tuple[NDArray[np.float64], NDArray[np.float64]] | None:
        """Excess-weighted centroid and covariance (HKL) of the peak core at ``idx``.

        The core is the region connected to voxel ``idx`` whose excess over
        ``local_bg`` is at least ``integer_fit_threshold_frac`` of the excess at
        ``idx``.  Only connected voxels count, so a neighbouring satellite in the
        window is not averaged in.  The covariance is divided by
        :func:`_core_variance_fraction`, so for a Gaussian peak it is the peak's
        own Σ, not the smaller Σ of the cut core.  ``about`` takes second moments
        about a fixed point (the direct beam's origin) instead of the centroid.
        ``None`` when there is no measurable peak: the core has fewer than 3
        voxels, or the cut is within ``integer_fit_noise_n_mad`` robust noise
        sigmas (1.4826·MAD of the window) of the background.
        """
        from scipy import ndimage

        sh, sk, sl = window
        win = np.asarray(vol.data[sh, sk, sl], dtype=np.float64)
        valid = vol.mask[sh, sk, sl] & np.isfinite(win)
        loc = (idx[0] - sh.start, idx[1] - sk.start, idx[2] - sl.start)
        if not valid[loc] or int(valid.sum()) < 3:
            return None
        excess = np.where(valid, win - float(local_bg), 0.0)
        peak_excess = float(excess[loc])
        if not np.isfinite(peak_excess) or peak_excess <= 0:
            return None
        # The cut must clear the noise: on a weak peak it sits in the scatter,
        # and the core spreads along whatever it touches (on real data, ring
        # residue on the |Q| sphere), not the peak.
        vals = win[valid]
        noise = 1.4826 * float(np.median(np.abs(vals - np.median(vals))))
        frac = max(0.0, float(self.integer_fit_threshold_frac))
        cut = frac * peak_excess
        if cut < max(0.0, float(self.integer_fit_noise_n_mad)) * noise:
            return None
        labels, _ = ndimage.label(valid & (excess >= cut),
                                  structure=np.ones((3, 3, 3), dtype=bool))
        core = labels == labels[loc]
        if int(core.sum()) < 3:
            return None
        weights = np.where(core, excess, 0.0)
        wsum = float(weights.sum())
        if wsum <= 0:
            return None
        coords = np.meshgrid(vol.h_axis[sh], vol.k_axis[sk], vol.l_axis[sl],
                             indexing="ij")
        mean = np.array([float((weights * c).sum() / wsum) for c in coords])
        origin = mean if about is None else np.asarray(about, dtype=float)
        d = [c - o for c, o in zip(coords, origin)]
        cov = np.empty((3, 3))
        for i in range(3):
            for j in range(i, 3):
                cov[i, j] = cov[j, i] = float((weights * d[i] * d[j]).sum() / wsum)
        return mean, cov / _core_variance_fraction(frac)

    def _fold_phi_tail(
        self,
        vol: HKLVolume,
        shape_matrix: NDArray[np.float64],
        center_hkl: tuple[float, float, float],
        phi_tail: float,
    ) -> NDArray[np.float64]:
        """Inflate ``A`` along the local K-L ring tangent by ``phi_tail`` (a rank-1
        modification of the covariance), replacing the legacy union-of-ellipsoids.

        The half-extent of ``δᵀAδ ≤ 1`` along unit ``u`` is ``sqrt(uᵀ A⁻¹ u)``;
        adding ``(2·h_t·φ + φ²)·t̂t̂ᵀ`` to ``A⁻¹`` grows the tangential half-extent
        from ``h_t`` to ``h_t + φ`` and leaves orthogonal extents unchanged.
        """
        if phi_tail <= 0:
            return shape_matrix
        rt = self._kl_ring_directions(vol, center_hkl)
        if rt is None:
            return shape_matrix
        _, _, ktan, ltan = rt
        t = np.array([0.0, ktan, ltan])  # unit K-L tangent (H component 0)
        cov = np.linalg.inv(shape_matrix)
        h_t = float(np.sqrt(max(float(t @ cov @ t), 0.0)))
        tau = 2.0 * h_t * phi_tail + phi_tail * phi_tail
        return np.asarray(np.linalg.inv(cov + tau * np.outer(t, t)), dtype=np.float64)

    @staticmethod
    def _axis_hkl_margins_from_q_margin(
        vol: HKLVolume,
        margin_q: float,
    ) -> tuple[float, float, float]:
        """Axis-aligned HKL margins equivalent to a Q-space guard band."""
        margin_q = max(0.0, float(margin_q))
        if margin_q <= 0:
            return 0.0, 0.0, 0.0
        q_per_hkl = np.linalg.norm(vol.ub_matrix, axis=0)
        return tuple(
            float(margin_q / q) if q > 0 and np.isfinite(q) else 0.0
            for q in q_per_hkl
        )  # type: ignore[return-value]

    @staticmethod
    def _inflate_q_isotropic(
        vol: HKLVolume,
        shape_matrix: NDArray[np.float64],
        margin_q: float,
    ) -> NDArray[np.float64]:
        """Grow each principal radius (taken in Q) by a Q-space margin."""
        margin_q = max(0.0, float(margin_q))
        if margin_q <= 0:
            return shape_matrix
        ub = vol.ub_matrix
        ub_inv = np.linalg.inv(ub)
        lam, vecs = np.linalg.eigh(ub_inv.T @ shape_matrix @ ub_inv)  # A in Q
        radii = 1.0 / np.sqrt(np.clip(lam, 1e-300, None)) + margin_q
        a = ub.T @ ((vecs / radii**2) @ vecs.T) @ ub
        return np.asarray(0.5 * (a + a.T), dtype=np.float64)

    def _inflate_for_frame(
        self,
        vol: HKLVolume,
        shape_matrix: NDArray[np.float64],
        margin: float,
    ) -> NDArray[np.float64]:
        """Inflate a punch shape by the Å⁻¹ margin (both frames size in Q)."""
        return self._inflate_q_isotropic(vol, shape_matrix, margin)

    @staticmethod
    def _steps(vol: HKLVolume) -> tuple[float, float, float]:
        def step(axis: NDArray) -> float:
            if axis.size < 2:
                return 1.0
            return float(axis[1] - axis[0])

        return (
            step(vol.h_axis),
            step(vol.k_axis),
            step(vol.l_axis),
        )

    def enumerate_bragg(self, vol: HKLVolume) -> list[tuple[int, int, int]]:
        """Integer (h,k,l) nodes within the grid extent."""
        hs = range(int(np.ceil(vol.h_axis.min())), int(np.floor(vol.h_axis.max())) + 1)
        ks = range(int(np.ceil(vol.k_axis.min())), int(np.floor(vol.k_axis.max())) + 1)
        ls = range(int(np.ceil(vol.l_axis.min())), int(np.floor(vol.l_axis.max())) + 1)
        return [(h, k, l) for h in hs for k in ks for l in ls
                if (h, k, l) != (0, 0, 0)]

    def detect_peaks(self, vol: HKLVolume) -> list[tuple[int, int, int, float]]:
        """Return ``(ih, ik, il, intensity)`` peak-centre voxels to punch.

        Dispatches on ``mode``:

        - ``"integer"`` — peaks at integer (h,k,l) nodes (symmetry-based; skips
          systematic absences when ``min_intensity`` is set).
        - ``"auto"`` / ``"search"`` — any sharp peak, found as a high-tail outlier above the
          robust per-|Q|-shell diffuse level.  Catches off-integer satellites
          (e.g. small-domain / superlattice reflections) the integer mode misses.
        - ``"both"`` — the union of the two (integer centres take precedence).
        """
        return [p.as_tuple() for p in self._detect_peak_records(vol)]

    def _detect_peak_records(self, vol: HKLVolume) -> list[_PeakPunch]:
        """Internal detector dispatch returning rich punch records."""
        if self.mode == "integer":
            return self._detect_integer(vol)
        if self.mode in {"auto", "search"}:
            return self._detect_search(vol)
        if self.mode == "both":
            # Sequential: punch the integer Bragg first, then search on the
            # residual.  With the strong integer peaks already masked out, the
            # per-|Q|-shell statistics are no longer inflated by them, so the
            # off-integer satellites stand out as clean outliers.
            integer = self._detect_integer(vol)
            keep = self._punch_centers(vol, np.ones(vol.shape, dtype=bool), integer)
            residual = dataclasses.replace(vol, mask=vol.mask & keep)
            return integer + self._detect_search(residual)
        raise ValueError(f"Unknown mode: {self.mode!r}")

    def _punches_incident_beam(self) -> bool:
        return self.punch_incident_beam if self.force_origin is None else bool(self.force_origin)

    def _incident_beam_center(self, vol: HKLVolume) -> tuple[int, int, int] | None:
        """Nearest valid voxel to the incident beam at (0,0,0)."""
        if not self._punches_incident_beam():
            return None
        ih = int(np.argmin(np.abs(vol.h_axis)))
        ik = int(np.argmin(np.abs(vol.k_axis)))
        il = int(np.argmin(np.abs(vol.l_axis)))
        if not (vol.mask[ih, ik, il] and np.isfinite(vol.data[ih, ik, il])):
            return None
        return ih, ik, il

    def _detect_integer(self, vol: HKLVolume) -> list[_PeakPunch]:
        """Peaks at integer (h,k,l) nodes.

        With ``min_intensity`` and ``integer_n_mad`` unset every node is returned
        at its nearest voxel (legacy punch-all).  When either is set, each node is
        examined in a local window: the peak is re-centred on the window argmax
        and kept only if it clears the requested absolute, local-prominence, and
        per-|Q|-shell thresholds — extinct nodes are dropped.
        """
        dh, dk, dl = self._steps(vol)
        nh, nk, nl = vol.shape
        data, valid = vol.data, (vol.mask & np.isfinite(vol.data))

        def nearest(axis: NDArray, val: int) -> int:
            return int(np.argmin(np.abs(axis - val)))

        out: list[_PeakPunch] = []
        if self.min_intensity is None and self.integer_n_mad is None:
            for h, k, l in self.enumerate_bragg(vol):
                ih = nearest(vol.h_axis, h)
                ik = nearest(vol.k_axis, k)
                il = nearest(vol.l_axis, l)
                out.append(
                    _PeakPunch(
                        ih=ih,
                        ik=ik,
                        il=il,
                        intensity=float("nan"),
                        center_hkl=(
                            float(vol.h_axis[ih]),
                            float(vol.k_axis[ik]),
                            float(vol.l_axis[il]),
                        ),
                        source_node_hkl=(h, k, l),
                    )
                )
            return out

        shell_thr = None
        shell_bins = None
        if self.integer_n_mad is not None:
            shell_bins, shell_thr = self._q_shell_thresholds(
                vol,
                q_step=self.integer_q_step or self.search_q_step,
                n_mad=float(self.integer_n_mad),
                min_intensity=(
                    -np.inf if self.min_intensity is None else float(self.min_intensity)
                ),
                min_shell_size=int(self.integer_min_shell_size),
            )

        wph = max(1, int(round(self.detect_window_hkl / abs(dh))))
        wpk = max(1, int(round(self.detect_window_hkl / abs(dk))))
        wpl = max(1, int(round(self.detect_window_hkl / abs(dl))))
        for h, k, l in self.enumerate_bragg(vol):
            ih, ik, il = (nearest(vol.h_axis, h), nearest(vol.k_axis, k),
                          nearest(vol.l_axis, l))
            hs, he = max(0, ih - wph), min(nh, ih + wph + 1)
            ks, ke = max(0, ik - wpk), min(nk, ik + wpk + 1)
            ls, le = max(0, il - wpl), min(nl, il + wpl + 1)
            win = data[hs:he, ks:ke, ls:le]
            wval = valid[hs:he, ks:ke, ls:le]
            if wval.sum() < 3:
                continue
            wv = np.where(wval, win, np.nan)
            peak = float(np.nanmax(wv))
            if not np.isfinite(peak):
                continue
            local_bg = float(np.nanmedian(wv))
            prom = peak - local_bg
            # re-centre on the true peak (thermal/lattice drift off the integer)
            off = np.unravel_index(int(np.nanargmax(wv)), wv.shape)
            ph = int(hs + int(off[0]))
            pk = int(ks + int(off[1]))
            pl = int(ls + int(off[2]))

            # Relative path: small-but-sharp peak, prominent in LOCAL-MAD units.
            # Catches weak Bragg at nodes that the absolute floors miss.
            ok_rel = False
            if self.integer_local_prominence_n_mad is not None and prom > 0:
                local_mad = float(np.nanmedian(np.abs(wv - local_bg))) * 1.4826
                ok_rel = (
                    local_mad > 0
                    and prom >= self.integer_local_prominence_n_mad * local_mad
                    and prom >= self.integer_local_min_prominence
                )

            # Absolute path: clears the configured floors and per-|Q| shell threshold.
            ok_abs = True
            if self.min_intensity is not None and peak < self.min_intensity:
                ok_abs = False
            if prom < self.min_prominence:
                ok_abs = False
            if ok_abs and shell_thr is not None and shell_bins is not None:
                if peak < float(shell_thr[shell_bins[ph, pk, pl]]):
                    ok_abs = False

            if not (ok_abs or ok_rel):
                continue
            center_hkl = (
                float(vol.h_axis[ph]),
                float(vol.k_axis[pk]),
                float(vol.l_axis[pl]),
            )
            shape_hkl = None
            if self.integer_optimize_position or self.integer_optimize_shape:
                center_hkl, shape_hkl = self._fit_integer_peak(
                    vol, (ph, pk, pl), local_bg)
                ph = int(np.argmin(np.abs(vol.h_axis - center_hkl[0])))
                pk = int(np.argmin(np.abs(vol.k_axis - center_hkl[1])))
                pl = int(np.argmin(np.abs(vol.l_axis - center_hkl[2])))
            out.append(_PeakPunch(
                ih=ph, ik=pk, il=pl, intensity=peak,
                center_hkl=center_hkl, shape_hkl=shape_hkl,
                source_node_hkl=(h, k, l), local_background=local_bg,
            ))
        return out

    def _fit_integer_peak(
        self,
        vol: HKLVolume,
        idx: tuple[int, int, int],
        local_bg: float,
    ) -> tuple[tuple[float, float, float], NDArray[np.float64] | None]:
        """Fit an integer-node peak's centre and tilted punch ellipsoid in Q.

        ``idx`` is the peak's brightest voxel.  The core moments are taken in a
        window ``max_radius_scale``× the resolution ellipsoid (see
        :meth:`_core_moments`), and the shape is built in Q, floored at the
        resolution ellipsoid at the fitted centre (see
        :meth:`_shape_from_q_covariance`).  Returns ``(center, shape)``;
        ``shape`` is ``None`` unless ``integer_optimize_shape``, and the centre
        is the voxel's when the peak cannot be measured.
        """
        voxel_hkl = (float(vol.h_axis[idx[0]]), float(vol.k_axis[idx[1]]),
                     float(vol.l_axis[idx[2]]))
        a_voxel = self._active_shape_matrix(vol, voxel_hkl)
        if a_voxel is None:
            return voxel_hkl, None
        window = self._window_around(
            vol, idx, self._fit_ceiling(np.linalg.inv(a_voxel)))
        moments = self._core_moments(vol, idx, local_bg, window)
        if moments is None:
            return voxel_hkl, None
        mean, cov = moments
        center = (float(mean[0]), float(mean[1]), float(mean[2]))
        if not self.integer_optimize_shape:
            return center, None
        a_floor = self._active_shape_matrix(vol, center)
        if a_floor is None:
            return center, None
        floor = np.linalg.inv(a_floor)
        shape = self._shape_from_q_covariance(
            vol, cov, floor, self._fit_ceiling(floor),
            constrain=not self.integer_fit_unconstrained)
        return center, shape

    @staticmethod
    def _q_shell_thresholds(
        vol: HKLVolume,
        q_step: float,
        n_mad: float,
        min_intensity: float,
        min_shell_size: int = 20,
    ) -> tuple[NDArray[np.int32], NDArray[np.float64]]:
        """Robust per-|Q|-shell high-tail threshold arrays ``(bin_idx, thr)``."""
        valid = vol.mask & np.isfinite(vol.data)
        if not valid.any():
            return np.zeros(vol.shape, dtype=np.int32), np.full(1, np.inf)
        qs = float(q_step)
        # |Q| one H-slab at a time, for the valid range and then the bins: the
        # full float64 |Q| grid and its digitize/clip temporaries (~5 volumes
        # in all, the punch's peak in the browser's WASM heap) are never
        # resident.  Elementwise arithmetic and exact min/max, so the edges
        # and bins are identical to the whole-volume form.
        q_lo, q_hi = np.inf, -np.inf
        for lo in range(0, vol.shape[0], 16):
            v = valid[lo:lo + 16]
            if v.any():
                qv = q_magnitude_from_axes(vol.h_axis[lo:lo + 16], vol.k_axis,
                                           vol.l_axis, vol.ub_matrix)[v]
                q_lo, q_hi = min(q_lo, float(qv.min())), max(q_hi, float(qv.max()))
        edges = np.arange(q_lo, q_hi + qs, qs)
        nb = max(len(edges) - 1, 1)
        # int32 indices: the shell count is tiny, and the full-volume index
        # array is half the size of numpy's default int64.
        bin_idx = q_bin_indices(vol.h_axis, vol.k_axis, vol.l_axis,
                                vol.ub_matrix, edges)
        bin_idx -= 1
        np.clip(bin_idx, 0, nb - 1, out=bin_idx)

        # Per-shell robust threshold (median + n·MAD), computed once over the
        # sorted valid voxels so it is O(N log N), not O(N · n_bins).  Prompt
        # frees: each flattened array covers most of the volume, so dropping
        # each as soon as it is consumed keeps the peak low.
        flat_b = bin_idx[valid]
        order = np.argsort(flat_b, kind="stable")
        sb = flat_b[order]
        del flat_b
        sI = vol.data[valid][order]
        del order
        bounds = np.searchsorted(sb, np.arange(nb + 1))
        del sb
        thr = np.full(nb, np.inf)
        for b in range(nb):
            # Threshold arithmetic in float64 regardless of storage precision
            # (astype is a no-op on float64 input): a float32 median/MAD would
            # shift the discrete peak-candidate set.
            seg = sI[bounds[b]:bounds[b + 1]].astype(np.float64, copy=False)
            if seg.size < min_shell_size:
                continue
            med = float(np.median(seg))
            mad = float(np.median(np.abs(seg - med)))
            scale = 1.4826 * mad if mad > 0 else (float(np.std(seg)) or 1.0)
            thr[b] = med + n_mad * scale
        thr = np.maximum(thr, min_intensity)
        return bin_idx, thr

    def _detect_search(self, vol: HKLVolume) -> list[_PeakPunch]:
        """Peaks found as sharp |Q|-shell outliers (mode-agnostic to hkl).

        Reuses the ring-removal insight: at a given |Q| the diffuse is the bulk
        and any Bragg / satellite reflection is a sharp high-tail outlier.  For
        each |Q| shell (width ``search_q_step``) the robust level (median) and
        scale (MAD) are measured over the valid voxels; a voxel is a peak
        candidate when it exceeds ``median + search_n_mad · 1.4826·MAD`` (and an
        absolute floor).  Candidates are grouped into connected components and
        each component's brightest voxel is returned as a peak centre — so the
        shared ellipsoid punch removes the whole peak, not just its hottest voxel.
        """
        from scipy import ndimage

        valid = (vol.mask & np.isfinite(vol.data)) & ~self._search_excluded_h_mask(vol)
        if not valid.any():
            return []
        bin_idx, thr = self._q_shell_thresholds(
            vol,
            q_step=self.search_q_step,
            n_mad=self.search_n_mad,
            min_intensity=self.search_min_intensity,
        )

        # Slab-wise compare: elementwise (bit-identical to the whole-volume
        # form) and never materialises the full-volume thr[bin_idx] lookup.
        cand = np.empty(vol.shape, dtype=bool)
        for lo in range(0, vol.shape[0], 16):
            hi = min(vol.shape[0], lo + 16)
            cand[lo:hi] = valid[lo:hi] & (vol.data[lo:hi] > thr[bin_idx[lo:hi]])
        del bin_idx  # full-volume index array no longer needed
        if not cand.any():
            return []
        # One centre per peak *summit*: a candidate voxel that is a local maximum
        # (≥ its 3×3×3 neighbours).  This catches every peak even when several are
        # joined into one above-threshold blob (taking a single max per connected
        # component would miss all but the brightest — e.g. satellites at the
        # measured-volume edge that touch a residual arc).
        scored = np.where(valid, vol.data, -np.inf)
        local_max = ndimage.maximum_filter(scored, size=3, mode="nearest")
        peaks = np.argwhere(cand & (scored >= local_max))
        del scored, local_max, cand  # free the full-volume temporaries
        if self.search_min_prominence > 0 and peaks.size:
            keep_peak = []
            nh, nk, nl = vol.shape
            for ih, ik, il in peaks:
                hs, he = max(0, ih - 1), min(nh, ih + 2)
                ks, ke = max(0, ik - 1), min(nk, ik + 2)
                ls, le = max(0, il - 1), min(nl, il + 2)
                w = vol.data[hs:he, ks:ke, ls:le]
                m = valid[hs:he, ks:ke, ls:le]
                if int(m.sum()) < 3:
                    keep_peak.append(False)
                    continue
                local_bg = float(np.median(w[m]))
                keep_peak.append(
                    float(vol.data[ih, ik, il]) - local_bg >= self.search_min_prominence
                )
            peaks = peaks[np.asarray(keep_peak, dtype=bool)]
        return [
            _PeakPunch(
                ih=int(ih),
                ik=int(ik),
                il=int(il),
                intensity=float(vol.data[ih, ik, il]),
                center_hkl=(
                    float(vol.h_axis[ih]),
                    float(vol.k_axis[ik]),
                    float(vol.l_axis[il]),
                ),
            )
            for ih, ik, il in peaks
        ]

    def _search_excluded_h_mask(self, vol: HKLVolume) -> NDArray[np.bool_]:
        """Return True for voxels protected from hkl-agnostic search punching.

        Two complementary mechanisms (combined), both using
        ``search_exclude_h_half_width``:
        - ``search_exclude_h_centers``: explicit H-plane centres.
        - ``search_exclude_h_fractions``: fractional parts mod 1 protected
          periodically across the whole range — e.g. ``(1/3, 2/3)`` shields
          every integer±1/3 plane (the q=1/3 satellite family).
        """
        half_width = max(float(self.search_exclude_h_half_width), 0.0)
        centers = self.search_exclude_h_centers
        fractions = self.search_exclude_h_fractions
        if half_width <= 0 or (not centers and not fractions):
            return np.zeros(vol.shape, dtype=bool)
        h_excluded = np.zeros(vol.h_axis.shape, dtype=bool)
        for h0 in centers or ():
            h_excluded |= np.abs(vol.h_axis - float(h0)) <= half_width
        if fractions:
            frac = np.mod(vol.h_axis, 1.0)  # [0,1); handles negative H naturally
            for f in fractions:
                f0 = float(f) % 1.0
                # circular distance on the unit interval
                d = np.abs(frac - f0)
                d = np.minimum(d, 1.0 - d)
                h_excluded |= d <= half_width
        return h_excluded[:, None, None]

    def _scale_factor(self, peak: float, ref: float) -> float:
        if not self.intensity_scale or not np.isfinite(peak) or ref <= 0:
            return 1.0
        return float(np.clip((peak / ref) ** (1.0 / 3.0), 1.0, self.max_radius_scale))

    def build_mask(self, vol: HKLVolume) -> NDArray[np.bool_]:
        """Return a keep-mask (True = valid, False = punched Bragg voxel).

        Built on local windows around each detected peak, so the cost is
        ``n_peaks × small_window`` rather than ``n_peaks × whole_volume``.
        """
        keep = self._punch_centers(
            vol, np.ones(vol.shape, dtype=bool), self._detect_peak_records(vol))
        return self._punch_incident_beam(vol, keep)

    def _punch_centers(
        self,
        vol: HKLVolume,
        keep: NDArray[np.bool_],
        peaks: list[_PeakPunch],
    ) -> NDArray[np.bool_]:
        """Punch an anisotropic, intensity-scaled ellipsoid at each peak centre,
        in place on *keep* (local windows only)."""
        # The Q ellipsoid's HKL bounding box: the fallback where the punch
        # frame is undefined (a peak at the origin).
        r_base = self._fit_base_radii(vol)

        ref = self.intensity_ref
        if self.intensity_scale and ref is None:
            ints = np.array([p.intensity for p in peaks if np.isfinite(p.intensity)])
            ref = float(np.median(ints)) if ints.size else 1.0

        for peak_rec in peaks:
            s = self._scale_factor(peak_rec.intensity, ref if ref is not None else 1.0)
            center = (peak_rec.ih, peak_rec.ik, peak_rec.il)

            # (1) Covariance fit (either frame): tilted ellipsoid with the
            #     φ-tail and margin folded into the matrix.
            if peak_rec.shape_hkl is not None:
                a = self._inflate_for_frame(
                    vol,
                    self._fold_phi_tail(
                        vol, peak_rec.shape_hkl / (s * s), peak_rec.center_hkl,
                        max(0.0, float(self.phi_tail_hkl)) * s),
                    self.margin)
                self._punch_one(
                    vol, keep, center, self._ellipsoid_bounding_radii(a), 0.0,
                    center_hkl=peak_rec.center_hkl,
                    h_guard=self._h_guard_for(peak_rec), shape_matrix=a)
                continue

            # (2) No per-peak fit (search peaks, shape fit off, peaks too weak
            #     to measure): the base ellipsoid + Q-space margin + folded
            #     φ-tail.  ``_active_shape_matrix`` is per-peak in the spherical
            #     frame.
            _a = self._active_shape_matrix(
                vol, peak_rec.center_hkl, scale=s, margin_q=self.margin)
            if _a is not None:  # None only when the frame is undefined (origin)
                a = self._fold_phi_tail(
                    vol, _a, peak_rec.center_hkl,
                    max(0.0, float(self.phi_tail_hkl)) * s)
                self._punch_one(
                    vol, keep, center, self._ellipsoid_bounding_radii(a), 0.0,
                    center_hkl=peak_rec.center_hkl,
                    h_guard=self._h_guard_for(peak_rec), shape_matrix=a)
                continue

            # (3) Frame undefined (origin): the base's HKL bounding box,
            #     axis-aligned, with the union φ-tail.
            rh_base, rk_base, rl_base = r_base
            mh, mk, ml = self._axis_hkl_margins_from_q_margin(vol, self.margin)
            radii = (
                rh_base * s + mh,
                rk_base * s + mk,
                rl_base * s + ml,
            )
            self._punch_one(
                vol, keep, center, radii,
                max(0.0, float(self.phi_tail_hkl)) * s,
                center_hkl=peak_rec.center_hkl,
                h_guard=self._h_guard_for(peak_rec),
            )
        return keep

    def _incident_beam_base_shape(
        self, vol: HKLVolume
    ) -> NDArray[np.float64] | None:
        """HKL shape matrix of the fixed direct-beam punch (the fit floor)."""
        if self.incident_beam_q_radii is not None:
            radii_q = tuple(
                max(0.0, float(r) + max(0.0, float(self.incident_beam_q_margin)))
                for r in self.incident_beam_q_radii
            )
            if min(radii_q) <= 0:
                return None
            return self._shape_matrix_from_q_radii(vol, radii_q)  # type: ignore[arg-type]
        if self.incident_beam_ellipsoid_radii_hkl is not None:
            radii = tuple(max(0.0, float(r)) for r in self.incident_beam_ellipsoid_radii_hkl)
        elif self.incident_beam_sphere_radius_hkl is not None:
            r = max(0.0, float(self.incident_beam_sphere_radius_hkl))
            radii = (r, r, r)
        elif self.incident_beam_radii is None:
            m = self.incident_beam_margin
            radii = tuple(2.0 * r + m for r in self._fit_base_radii(vol))
        else:
            radii = tuple(float(r) + self.incident_beam_margin
                          for r in self.incident_beam_radii)
        if min(radii) <= 0:
            return None
        return np.diag([1.0 / (r * r) for r in radii])

    def _fit_incident_beam_shape(
        self, vol: HKLVolume
    ) -> NDArray[np.float64] | None:
        """Fit a tilted covariance ellipsoid to the direct-beam remnant.

        Returns an origin-centred HKL shape matrix ``A`` (``δᵀAδ ≤ 1``) built in
        Q from the core's second moments about the origin (see
        :meth:`_core_moments`, :meth:`_shape_from_q_covariance`).  It contains
        the fixed direct-beam punch and lies inside ``max_radius_scale``× it.
        ``None`` when the origin is unusable, so the caller falls back to the
        fixed punch.
        """
        center = self._incident_beam_center(vol)
        if center is None:
            return None
        base = self._incident_beam_base_shape(vol)
        if base is None:
            return None
        floor = np.linalg.inv(base)
        ceiling = floor * float(self.max_radius_scale) ** 2
        window = self._window_around(vol, center, ceiling)
        sh, sk, sl = window
        win = vol.data[sh, sk, sl]
        valid = vol.mask[sh, sk, sl] & np.isfinite(win)
        if int(valid.sum()) < 6:
            return None
        local_bg = float(np.median(win[valid]))
        # The remnant's brightest voxel near the origin anchors the core.
        loc = np.unravel_index(int(np.argmax(np.where(valid, win, -np.inf))),
                               win.shape)
        idx = (sh.start + int(loc[0]), sk.start + int(loc[1]),
               sl.start + int(loc[2]))
        moments = self._core_moments(vol, idx, local_bg, window,
                                     about=(0.0, 0.0, 0.0))
        if moments is None:
            return None
        shape = self._shape_from_q_covariance(vol, moments[1], floor, ceiling)
        tail = max(0.0, float(self.incident_beam_phi_tail_hkl))
        if tail > 0:
            shape = self._fold_phi_tail(vol, shape, (0.0, 0.0, 0.0), tail)
        return shape

    def _punch_incident_beam(self, vol: HKLVolume, keep: NDArray[np.bool_]) -> NDArray[np.bool_]:
        if not self._punches_incident_beam():
            return keep
        if self.incident_beam_fit_covariance:
            shape = self._fit_incident_beam_shape(vol)
            if shape is not None:
                return self._punch_origin_shape_matrix(vol, keep, shape)
            # fit unavailable (masked origin / no excess) → fixed-radii fallback
        if self.incident_beam_q_radii is not None:
            radii_q = tuple(
                max(0.0, float(r) + max(0.0, float(self.incident_beam_q_margin)))
                for r in self.incident_beam_q_radii
            )
            if min(radii_q) <= 0:
                return keep
            shape = self._shape_matrix_from_q_radii(vol, radii_q)  # type: ignore[arg-type]
            return self._punch_origin_shape_matrix(vol, keep, shape)
        if self.incident_beam_ellipsoid_radii_hkl is not None:
            rh, rk, rl = (max(0.0, float(r))
                          for r in self.incident_beam_ellipsoid_radii_hkl)
            return self._punch_origin_ellipsoid(vol, keep, rh, rk, rl)
        if self.incident_beam_sphere_radius_hkl is not None:
            r = max(0.0, float(self.incident_beam_sphere_radius_hkl))
            return self._punch_origin_ellipsoid(vol, keep, r, r, r)
        center = self._incident_beam_center(vol)
        if center is None:
            return keep
        if self.incident_beam_radii is None:
            rh, rk, rl = self._fit_base_radii(vol)
            radii = (
                2.0 * rh + self.incident_beam_margin,
                2.0 * rk + self.incident_beam_margin,
                2.0 * rl + self.incident_beam_margin,
            )
        else:
            rh, rk, rl = (
                float(r) + self.incident_beam_margin for r in self.incident_beam_radii
            )
            radii = (rh, rk, rl)
        return self._punch_one(
            vol, keep, center, radii,
            max(0.0, float(self.incident_beam_phi_tail_hkl)),
        )

    def _punch_origin_shape_matrix(
        self,
        vol: HKLVolume,
        keep: NDArray[np.bool_],
        shape_matrix: NDArray[np.float64],
    ) -> NDArray[np.bool_]:
        """Punch an origin-centred ellipsoid described by ``δhklᵀAδhkl ≤ 1``."""
        ih = int(np.argmin(np.abs(vol.h_axis)))
        ik = int(np.argmin(np.abs(vol.k_axis)))
        il = int(np.argmin(np.abs(vol.l_axis)))
        radii = self._ellipsoid_bounding_radii(shape_matrix)
        return self._punch_one(
            vol,
            keep,
            (ih, ik, il),
            radii,
            0.0,
            center_hkl=(0.0, 0.0, 0.0),
            shape_matrix=shape_matrix,
        )

    def _punch_origin_ellipsoid(
        self,
        vol: HKLVolume,
        keep: NDArray[np.bool_],
        rh: float,
        rk: float,
        rl: float,
    ) -> NDArray[np.bool_]:
        """Punch an anisotropic HKL ellipsoid centred exactly at the origin."""
        if rh <= 0 or rk <= 0 or rl <= 0:
            return keep
        dh, dk, dl = self._steps(vol)
        nh, nk, nl = vol.shape
        ih = int(np.argmin(np.abs(vol.h_axis)))
        ik = int(np.argmin(np.abs(vol.k_axis)))
        il = int(np.argmin(np.abs(vol.l_axis)))
        wh = int(np.ceil(rh / abs(dh)))
        wk = int(np.ceil(rk / abs(dk)))
        wl = int(np.ceil(rl / abs(dl)))
        hs, he = max(0, ih - wh), min(nh, ih + wh + 1)
        ks, ke = max(0, ik - wk), min(nk, ik + wk + 1)
        ls, le = max(0, il - wl), min(nl, il + wl + 1)
        HH, KK, LL = np.meshgrid(vol.h_axis[hs:he], vol.k_axis[ks:ke],
                                  vol.l_axis[ls:le], indexing="ij")
        ellipsoid = _ellipsoid_inside(HH, KK, LL, radii=(rh, rk, rl))
        keep[hs:he, ks:ke, ls:le] &= ~ellipsoid
        return keep

    def _punch_one(
        self,
        vol: HKLVolume,
        keep: NDArray[np.bool_],
        center: tuple[int, int, int],
        radii: tuple[float, float, float],
        phi_tail: float,
        center_hkl: tuple[float, float, float] | None = None,
        h_guard: tuple[float, float] | None = None,
        shape_matrix: NDArray[np.float64] | None = None,
    ) -> NDArray[np.bool_]:
        """Punch one ellipsoid, optionally stretched along the local K-L tangent.

        ``shape_matrix`` (Q-space mode) overrides the axis-aligned ``radii``
        ellipsoid with the general quadratic form ``δhklᵀ A δhkl ≤ 1``; ``radii``
        is then only the HKL bounding box used to size the local window, and the
        φ-tail is not added.
        """
        dh, dk, dl = self._steps(vol)
        nh, nk, nl = vol.shape
        ih, ik, il = center
        rh, rk, rl = radii
        if center_hkl is None:
            ch, ck, cl = float(vol.h_axis[ih]), float(vol.k_axis[ik]), float(vol.l_axis[il])
        else:
            ch, ck, cl = center_hkl
        radial_tangent = self._kl_ring_directions(vol, (ch, ck, cl))
        if phi_tail > 0 and radial_tangent is not None:
            krad, lrad, ktan, ltan = radial_tangent
            wk_extra = abs(ktan) * phi_tail
            wl_extra = abs(ltan) * phi_tail
        else:
            wk_extra = wl_extra = 0.0
        wh, wk, wl = (
            int(np.ceil(rh / abs(dh))),
            int(np.ceil((rk + wk_extra) / abs(dk))),
            int(np.ceil((rl + wl_extra) / abs(dl))),
        )
        hs, he = max(0, ih - wh), min(nh, ih + wh + 1)
        ks, ke = max(0, ik - wk), min(nk, ik + wk + 1)
        ls, le = max(0, il - wl), min(nl, il + wl + 1)
        HH, KK, LL = np.meshgrid(vol.h_axis[hs:he], vol.k_axis[ks:ke],
                                 vol.l_axis[ls:le], indexing="ij")
        dH, dK, dL = HH - ch, KK - ck, LL - cl
        if shape_matrix is not None:
            punch = _ellipsoid_inside(dH, dK, dL, shape_matrix=shape_matrix)
        else:
            punch = _ellipsoid_inside(dH, dK, dL, radii=(rh, rk, rl))
        if shape_matrix is None and phi_tail > 0 and radial_tangent is not None:
            krad, lrad, ktan, ltan = radial_tangent
            d_rad = dK * krad + dL * lrad
            d_tan = dK * ktan + dL * ltan
            radial_half = max(float(np.hypot(krad * rk, lrad * rl)), 1e-12)
            tangent_half = max(float(np.hypot(ktan * rk, ltan * rl)) + phi_tail, 1e-12)
            phi_ell = (
                (dH / rh) ** 2
                + (d_rad / radial_half) ** 2
                + (d_tan / tangent_half) ** 2
            )
            punch |= phi_ell <= 1.0
        if h_guard is not None:
            h0, half_width = h_guard
            punch &= np.abs(HH - h0) <= max(float(half_width), 0.0)
        keep[hs:he, ks:ke, ls:le] &= ~punch
        return keep

    @staticmethod
    def _kl_ring_directions(
        vol: HKLVolume,
        hkl: tuple[float, float, float],
    ) -> tuple[float, float, float, float] | None:
        """Metric-aware radial and tangent unit vectors in the displayed K-L plane.

        Powder rings are constant-|Q| contours, with
        ``Q = UB @ hkl`` and ``|Q|² = hkl @ (UB.T @ UB) @ hkl``.  On a fixed-H
        ``0kl`` slice, the local radial direction in K-L coordinates is the K/L
        gradient of |Q|²; the ring tangent is perpendicular to that gradient.
        For an orthonormal UB this reduces to the familiar ``radial=(K,L)``,
        ``tangent=(-L,K)``.
        """
        metric = vol.ub_matrix.T @ vol.ub_matrix
        x = np.asarray(hkl, dtype=float)
        grad = 2.0 * (metric @ x)
        krad, lrad = float(grad[1]), float(grad[2])
        radial_norm = float(np.hypot(krad, lrad))
        if radial_norm <= 0:
            return None
        krad /= radial_norm
        lrad /= radial_norm
        ktan, ltan = -lrad, krad
        return krad, lrad, ktan, ltan

    def _measure_core(
        self, vol: HKLVolume, center_hkl: tuple[float, float, float],
    ) -> tuple[NDArray[np.float64], NDArray[np.float64]] | None:
        """Core moments of the peak at ``center_hkl``, as the covariance fit takes them.

        Background (median) and brightest voxel come from the detection window
        (``detect_window_hkl``) about the nearest voxel; the moments come from
        :meth:`_core_moments` in the fit's Å⁻¹-sized window.
        """
        dh, dk, dl = self._steps(vol)
        nh, nk, nl = vol.shape
        ih = int(np.argmin(np.abs(vol.h_axis - center_hkl[0])))
        ik = int(np.argmin(np.abs(vol.k_axis - center_hkl[1])))
        il = int(np.argmin(np.abs(vol.l_axis - center_hkl[2])))
        wph = max(1, int(round(self.detect_window_hkl / abs(dh))))
        wpk = max(1, int(round(self.detect_window_hkl / abs(dk))))
        wpl = max(1, int(round(self.detect_window_hkl / abs(dl))))
        hs, he = max(0, ih - wph), min(nh, ih + wph + 1)
        ks, ke = max(0, ik - wpk), min(nk, ik + wpk + 1)
        ls, le = max(0, il - wpl), min(nl, il + wpl + 1)

        win = vol.data[hs:he, ks:ke, ls:le]
        wval = vol.mask[hs:he, ks:ke, ls:le] & np.isfinite(win)
        if int(wval.sum()) < 3:
            return None
        local_bg = float(np.median(win[wval]))
        loc = np.unravel_index(int(np.argmax(np.where(wval, win, -np.inf))),
                               win.shape)
        idx = (hs + int(loc[0]), ks + int(loc[1]), ls + int(loc[2]))
        a = self._active_shape_matrix(vol, center_hkl)
        if a is None:
            window = (slice(hs, he), slice(ks, ke), slice(ls, le))
        else:
            window = self._window_around(vol, idx, self._fit_ceiling(np.linalg.inv(a)))
        return self._core_moments(vol, idx, local_bg, window)

    def measure_peak_sigmas(
        self, vol: HKLVolume, center_hkl: tuple[float, float, float],
    ) -> tuple[float, float, float] | None:
        """Per-axis measured RMS width (rlu) of the peak around ``center_hkl``.

        A *diagnostic-only* measurement: it never touches the punch geometry.
        These are the square roots of the diagonal of
        :meth:`measure_peak_covariance` — the same core moments the covariance
        fit uses, corrected for the core cut, so for a Gaussian peak they are its
        σ.  Returns ``None`` when there is no measurable peak (too few valid
        voxels, or no positive excess), so callers can mark the peak as
        unmeasured rather than report a spurious width.

        Unlike the punch radii, this carries **no half-voxel pad and no floor** —
        it is the data width, so a histogram of it shows the true spread instead
        of piling resolution-limited peaks onto the pad constant.
        """
        cov = self.measure_peak_covariance(vol, center_hkl)
        if cov is None:
            return None
        return (float(np.sqrt(max(cov[0, 0], 0.0))),
                float(np.sqrt(max(cov[1, 1], 0.0))),
                float(np.sqrt(max(cov[2, 2], 0.0))))

    def measure_peak_covariance(
        self, vol: HKLVolume, center_hkl: tuple[float, float, float],
    ) -> NDArray[np.float64] | None:
        """Full intensity-weighted HKL covariance (rlu²) of the peak.

        The covariance generalises :meth:`measure_peak_sigmas` (which returns only
        the axis-aligned marginals): it keeps the cross terms, so the measured peak
        shape can be **rotated into any frame** — e.g. projected onto the spherical
        (ρ̂, θ̂, φ̂) unit vectors for the spherical-frame width readout.  Same core,
        window and cut correction as the covariance fit; no pad/floor.  Returns
        ``None`` when the peak is unmeasurable.
        """
        moments = self._measure_core(vol, center_hkl)
        return None if moments is None else moments[1]

    def apply(self, vol: HKLVolume) -> HKLVolume:
        """Return a new volume with detected Bragg peaks masked out."""
        keep = self.build_mask(vol)
        return dataclasses.replace(vol, mask=vol.mask & keep)


def bragg_mask(
    vol: HKLVolume,
    punch_frame: str = "spherical",
    punch_spherical_radii: tuple[float, float, float] | None = (0.097, 0.072, 0.115),
    punch_q_radius: float | None = None,
    punch_q_radii: tuple[float, float, float] | None = None,
    min_intensity: float | None = None,
    min_prominence: float = 1.0,
    integer_n_mad: float | None = None,
    integer_q_step: float | None = None,
    integer_optimize_position: bool = False,
    integer_optimize_shape: bool = False,
    integer_fit_threshold_frac: float = 0.35,
    integer_fit_radius_n_sigma: float = 2.5,
    integer_fit_max_radius_hkl: tuple[float, float, float] | None = None,
    integer_h_guard_hkl: float | None = None,
    intensity_scale: bool = False,
    margin: float = 0.0,
    punch_incident_beam: bool = True,
    incident_beam_radii: tuple[float, float, float] | None = None,
    incident_beam_margin: float = 0.08,
    incident_beam_phi_tail_hkl: float = 0.0,
    incident_beam_q_radii: tuple[float, float, float] | None = None,
    incident_beam_q_margin: float = 0.0,
    incident_beam_ellipsoid_radii_hkl: tuple[float, float, float] | None = None,
    incident_beam_sphere_radius_hkl: float | None = None,
    force_origin: bool | None = None,
    phi_tail_hkl: float = 0.0,
    search_exclude_h_centers: tuple[float, ...] | None = None,
    search_exclude_h_half_width: float = 0.0,
) -> NDArray[np.bool_]:
    """Convenience wrapper.  Returns a keep-mask (True = valid)."""
    return BraggRemover(
        punch_frame=punch_frame,
        punch_spherical_radii=punch_spherical_radii,
        punch_q_radius=punch_q_radius,
        punch_q_radii=punch_q_radii,
        min_intensity=min_intensity,
        min_prominence=min_prominence,
        integer_n_mad=integer_n_mad,
        integer_q_step=integer_q_step,
        integer_optimize_position=integer_optimize_position,
        integer_optimize_shape=integer_optimize_shape,
        integer_fit_threshold_frac=integer_fit_threshold_frac,
        integer_fit_radius_n_sigma=integer_fit_radius_n_sigma,
        integer_fit_max_radius_hkl=integer_fit_max_radius_hkl,
        integer_h_guard_hkl=integer_h_guard_hkl,
        intensity_scale=intensity_scale,
        margin=margin,
        punch_incident_beam=punch_incident_beam,
        incident_beam_radii=incident_beam_radii,
        incident_beam_margin=incident_beam_margin,
        incident_beam_phi_tail_hkl=incident_beam_phi_tail_hkl,
        incident_beam_q_radii=incident_beam_q_radii,
        incident_beam_q_margin=incident_beam_q_margin,
        incident_beam_ellipsoid_radii_hkl=incident_beam_ellipsoid_radii_hkl,
        incident_beam_sphere_radius_hkl=incident_beam_sphere_radius_hkl,
        force_origin=force_origin,
        phi_tail_hkl=phi_tail_hkl,
        search_exclude_h_centers=search_exclude_h_centers,
        search_exclude_h_half_width=search_exclude_h_half_width,
    ).build_mask(vol)
