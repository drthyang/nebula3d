# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""3D-ΔPDF computation via Fourier transform of diffuse scattering.

The three-dimensional difference pair distribution function (3D-ΔPDF) is:

    Δρ(r) = FT[ I_diffuse(Q) ]
           = FT[ I_total(Q) − I_Bragg(Q) ]

where I_diffuse is the background-corrected, Bragg-punched, backfilled
volume. The result reveals real-space pair correlations from local disorder.

References
----------
Weber & Simonov, Z. Kristallogr. 227, 238–247 (2012)
Simonov, Weber & Steurer, J. Appl. Cryst. 47, 2011–2018 (2014)
"""

from __future__ import annotations

import dataclasses
import functools
import itertools
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy import ndimage
from scipy.fft import fftfreq, fftn, fftshift, ifftn, ifftshift, next_fast_len
from scipy.ndimage import gaussian_filter

from nebula3d.core import HKLVolume, q_magnitude_from_axes
from nebula3d.utils.reciprocal_space import direct_cell

Window = Literal["hann", "gaussian", "none"]
WindowShape = Literal["auto", "separable", "ellipsoid"]

_AXES = "xyz"  # real-space axes along a, b, c


def _axis_cosines(
    cell_angles: tuple[float, float, float],
) -> tuple[float, float, float]:
    """``(cos α, cos β, cos γ)``, snapping 90° to an exact zero so an orthogonal
    cell reproduces ``sqrt(x² + y² + z²)`` bit-for-bit."""
    return tuple(  # type: ignore[return-value]
        0.0 if abs(float(t) - 90.0) < 1e-9 else float(np.cos(np.radians(t)))
        for t in cell_angles)


def real_space_radius(
    x: NDArray[np.floating] | float,
    y: NDArray[np.floating] | float,
    z: NDArray[np.floating] | float,
    cell_angles: tuple[float, float, float] = (90.0, 90.0, 90.0),
) -> NDArray[np.float64]:
    """True distance ``|r|`` (Å) of oblique ΔPDF coordinates ``(x, y, z)``.

    ``r = x·â + y·b̂ + z·ĉ``, so
    ``|r|² = x² + y² + z² + 2(xy·cos γ + xz·cos β + yz·cos α)``.  The arguments
    broadcast: pass the 1-D axes as ``x[:, None, None]`` etc. for a full grid,
    which then costs one volume-sized array (no meshgrids).
    """
    ca, cb, cg = _axis_cosines(cell_angles)
    x, y, z = (np.asarray(v, dtype=np.float64) for v in (x, y, z))
    r2 = np.asarray(z * (2.0 * (cb * x + ca * y)))  # the only full-size array
    r2 += z * z
    r2 += x * x + y * y + 2.0 * cg * x * y
    return np.sqrt(np.maximum(r2, 0.0, out=r2), out=r2)


def _unit_axes(
    cell_angles: tuple[float, float, float],
) -> dict[str, NDArray[np.float64]]:
    """Unit vectors â, b̂, ĉ in an orthonormal frame (â along x, b̂ in xy)."""
    ca, cb, cg = _axis_cosines(cell_angles)
    sg = float(np.sqrt(1.0 - cg * cg))
    cy = (ca - cb * cg) / sg
    c_hat = np.array([cb, cy, np.sqrt(max(1.0 - cb * cb - cy * cy, 0.0))])
    return {"x": np.array([1.0, 0.0, 0.0]), "y": np.array([cg, sg, 0.0]), "z": c_hat}


def section_geometry(
    cell_angles: tuple[float, float, float],
    horizontal: str,
    vertical: str,
    cut: float,
) -> tuple[float, tuple[float, float], float]:
    """How to draw one ΔPDF section, and where true distances sit in it.

    The section is spanned by two lattice axes (``'x'``, ``'y'``, ``'z'`` =
    along a, b, c) at ``cut`` Å along the third.  Drawn at its real angle θ,
    the point with in-plane coordinates ``(h, v)`` appears at
    ``X = h + v·cos θ``, ``Y = v·sin θ`` (horizontal axis to the right).

    Returns ``(θ in degrees, (cx, cy), d)``: the display position of the
    section point nearest the origin and the plane's distance from it, so a
    point drawn at ``(X, Y)`` has ``|r|² = (X − cx)² + (Y − cy)² + d²``.  For an
    orthogonal cell this is ``(90, (0, 0), |cut|)``.
    """
    units = _unit_axes(cell_angles)
    fixed = next(ax for ax in _AXES if ax not in (horizontal, vertical))
    e_h, e_v = units[horizontal], units[vertical]
    cos_t = float(e_h @ e_v)
    y_hat = e_v - cos_t * e_h
    y_hat /= np.linalg.norm(y_hat)
    p0 = float(cut) * units[fixed]
    x0, y0 = float(p0 @ e_h), float(p0 @ y_hat)
    perp = float(np.linalg.norm(p0 - x0 * e_h - y0 * y_hat))
    angle = 90.0 if cos_t == 0.0 else float(np.degrees(np.arccos(cos_t)))
    return angle, (-x0 + 0.0, -y0 + 0.0), perp

#: Threads for the 3D FFTs.  ``-1`` = all cores (scipy.fft / pocketfft).  The
#: transform is the dominant cost of the Q–R band round trip; multithreading it
#: is bit-for-bit identical to the single-threaded result (same pocketfft plan,
#: just split over independent 1-D transforms).
_FFT_WORKERS = -1


@dataclass(frozen=True)
class EllipsoidWindow:
    """An apodization window that depends on one ellipsoidal radius ρ.

    ``w = f(ρ)`` with ``ρ² = (h, k, l)·form·(h, k, l)ᵀ`` (h, k, l in r.l.u.)
    and ``f`` the profile the separable window uses along one axis: Hann
    ``cos²(πρ/2)``, the Gaussian shifted to zero at ``ρ = 1``, or 1 for
    ``"none"`` — and 0 for ``ρ ≥ 1``.  ``form`` comes from
    :func:`_invariant_ellipsoid`, so the window is invariant under the
    lattice's point symmetry and vanishes on the box faces — or, fitted to a
    measured support (:func:`_fit_to_support`), the same ellipsoid shrunk by
    ``scale``.  It is never materialised in 3-D: :meth:`planes` yields one H
    plane at a time, which the forward transform, the weighted mean and the
    deapodization stream.
    """

    form: NDArray[np.float64]
    kind: Window
    sigma: float
    h_axis: NDArray[np.float64]
    k_axis: NDArray[np.float64]
    l_axis: NDArray[np.float64]
    # ρ = ρ_box / scale: < 1 when the ellipsoid was shrunk to the support.
    scale: float = 1.0

    def rho2_planes(self) -> Iterator[NDArray[np.float64]]:
        """``ρ²`` on each H plane in turn, as ``(nk, nl)`` float64."""
        f = self.form
        k = self.k_axis[:, None]
        l_ = self.l_axis[None, :]
        # ρ² = kl + h·lin + f₀₀h²: the two plane-sized terms are shared.
        kl = f[1, 1] * k * k + 2.0 * f[1, 2] * k * l_ + f[2, 2] * l_ * l_
        lin = 2.0 * (f[0, 1] * k + f[0, 2] * l_)
        for h in self.h_axis:
            rho2 = kl + float(h) * lin
            rho2 += f[0, 0] * float(h) * float(h)
            yield rho2

    def planes(self) -> Iterator[NDArray[np.float64]]:
        """The window on each H plane in turn, as ``(nk, nl)`` float64."""
        for rho2 in self.rho2_planes():
            yield _radial_taper(rho2, self.kind, self.sigma)

    def weighted_mean(
        self, data: NDArray[np.floating],
        support: NDArray[np.bool_] | None = None,
    ) -> float:
        """``Σ w·data / Σ w`` over *support* (all voxels if None), in float64
        one plane at a time.  *data* must be zero outside the support."""
        acc = total = 0.0
        for i, w in enumerate(self.planes()):
            total += float(w.sum() if support is None else w[support[i]].sum())
            acc += float((w * data[i]).sum(dtype=np.float64))
        return acc / total if total else 0.0

    def apply(self, data: NDArray[np.floating]) -> None:
        """Multiply *data* by the window in place, one plane at a time."""
        for i, w in enumerate(self.planes()):
            data[i] *= w


@dataclass
class DeltaPDF:
    """Real-space 3D-ΔPDF result.

    Attributes
    ----------
    data:
        Shape (na, nb, nc) real-valued ΔPDF in Å^-3 (or arbitrary units).
    x_axis, y_axis, z_axis:
        Real-space coordinates along the direct axes a, b, c, in Å (``u·|a|``,
        ``v·|b|``, ``w·|c|`` for fractional ``u, v, w``) — or fractional units
        if ``real_space_angstrom=False`` was passed to :func:`compute_delta_pdf`.
        The grid is the FFT's native one, so for a non-orthogonal cell these
        are *oblique* coordinates: the point ``(x, y, z)`` sits at
        ``r = x·â + y·b̂ + z·ĉ``.  Use :attr:`cell_angles` with
        :func:`real_space_radius` / :func:`section_geometry` for true distances
        and for drawing sections at their real angles.
    q_max:
        |Q|_max used in the transform (Å^-1), for reference.
    apodization:
        Window function applied before FFT.
    """

    data: NDArray[np.floating]
    x_axis: NDArray[np.float64]
    y_axis: NDArray[np.float64]
    z_axis: NDArray[np.float64]
    q_max: float
    apodization: str

    # --- inverse-transform metadata (populated by compute_delta_pdf) ----------
    # Everything needed to map the ΔPDF back to the reciprocal-space volume it
    # came from (see invert_delta_pdf).  Optional / default-None so older callers
    # and serialised results stay valid.
    pad_width: tuple[tuple[int, int], ...] | None = None
    cropped_shape: tuple[int, int, int] | None = None
    # The window: three 1-D factors (separable) or an ellipsoid; one is set.
    window_axes: tuple[NDArray[np.float64], ...] | None = None
    window_ellipsoid: EllipsoidWindow | None = None
    # Window-weighted mean removed BEFORE windowing (input = w·(I − bg − c)).
    subtracted_mean: float = 0.0
    smooth_bg: NDArray[np.floating] | None = None
    h_axis_c: NDArray[np.float64] | None = None
    k_axis_c: NDArray[np.float64] | None = None
    l_axis_c: NDArray[np.float64] | None = None
    ub_matrix: NDArray[np.float64] | None = None
    # Voxels that carried data (cropped grid); outside it the transform input
    # was ΔI = 0.  None when every voxel did (no support given, or all True).
    support: NDArray[np.bool_] | None = None

    @property
    def window_shape(self) -> str:
        """The window geometry used: ``"separable"`` or ``"ellipsoid"``."""
        return "ellipsoid" if self.window_ellipsoid is not None else "separable"

    @property
    def cell_angles(self) -> tuple[float, float, float]:
        """Direct-cell angles ``(α, β, γ)`` in degrees between the b–c, a–c and
        a–b axes; ``(90, 90, 90)`` when the UB matrix is unknown or singular."""
        if self.ub_matrix is None:
            return (90.0, 90.0, 90.0)
        try:
            _, _, _, alpha, beta, gamma = direct_cell(self.ub_matrix)
        except np.linalg.LinAlgError:
            return (90.0, 90.0, 90.0)
        return (alpha, beta, gamma)

    def slice_hk0(self) -> NDArray[np.floating]:
        """Return the l=0 (z=0) slice."""
        mid = self.data.shape[2] // 2
        return self.data[:, :, mid]

    def slice_h0l(self) -> NDArray[np.floating]:
        """Return the k=0 (y=0) slice."""
        mid = self.data.shape[1] // 2
        return self.data[:, mid, :]

    def slice_0kl(self) -> NDArray[np.floating]:
        """Return the h=0 (x=0) slice."""
        mid = self.data.shape[0] // 2
        return self.data[mid, :, :]


@dataclass
class _ForwardPlan:
    """Everything between the pure-Python preparation and the FFT core.

    ``data`` is the compact (cropped, NaN-filled, background/band-processed,
    mean-subtracted, windowed) volume that enters the transform; the padded
    array is materialised only inside the FFT core — a replaceable backend
    (scipy here; WebGPU in the browser) that computes
    ``fftshift(real(fftn(ifftshift(pad(data)))))``.
    """

    data: NDArray[np.floating]
    pad_width: list[tuple[int, int]]
    padded_shape: tuple[int, ...]
    cropped_shape: tuple[int, ...]
    window_axes: tuple[NDArray[np.float64], ...] | None
    window_ellipsoid: EllipsoidWindow | None
    subtracted_mean: float
    smooth_bg: NDArray[np.floating] | None
    h_axis: NDArray[np.float64]
    k_axis: NDArray[np.float64]
    l_axis: NDArray[np.float64]
    q_max: float
    apodization: str
    real_space_angstrom: bool
    ub_matrix: NDArray[np.float64]
    support: NDArray[np.bool_] | None = None


def _fft_core_forward(plan: _ForwardPlan) -> NDArray[np.floating]:
    """The scipy FFT backend: pad → centred transform → real part.

    The input has its Q=0 origin at the array centre, but fftn treats index
    [0,0,0] as the origin.  Without ifftshift the transform picks up a linear
    phase ramp e^{-iπk} → (-1)^k, which flips the sign of real-space features
    by pixel parity and splits each correlation peak into mixed +/- lobes.
    The correct centred transform is fftshift(fftn(ifftshift(·))) — computed
    in explicit steps that free each intermediate before the next allocates
    (the complex spectrum alone is 2 padded volumes), and taking the real
    part BEFORE fftshift (they commute: fftshift only permutes elements) so
    the shift copies a real array, not a complex one.
    """
    data = np.pad(plan.data, plan.pad_width, mode="constant")
    # Release the compact volume as soon as the padded copy exists (the same
    # rebinding discipline the pre-refactor code had — peak stays 2 volumes).
    plan.data = np.empty((0, 0, 0), dtype=data.dtype)
    data = ifftshift(data)
    # pocketfft dispatches on dtype: float64 -> complex128, float32 ->
    # complex64 — the float32 mode halves the transform's peak automatically.
    ft = fftn(data, workers=_FFT_WORKERS)
    del data  # free the padded input before the real-part copy below
    # Materialise the real part (valid for centrosymmetric I(Q)): np.real()
    # returns a VIEW that would otherwise pin the complex buffer (2 padded
    # volumes) for the DeltaPDF's whole lifetime.
    out = np.ascontiguousarray(ft.real)
    del ft
    return fftshift(out)


def _finish_forward(
    plan: _ForwardPlan, delta_pdf: NDArray[np.floating],
) -> DeltaPDF:
    """Real-space axes + the DeltaPDF dataclass (backend-independent)."""
    nh, nk, nl = plan.padded_shape
    h_axis, k_axis, l_axis = plan.h_axis, plan.k_axis, plan.l_axis
    dh = (h_axis[-1] - h_axis[0]) / max(len(h_axis) - 1, 1)
    dk = (k_axis[-1] - k_axis[0]) / max(len(k_axis) - 1, 1)
    dl = (l_axis[-1] - l_axis[0]) / max(len(l_axis) - 1, 1)

    # FFT frequency grid (in reciprocal of HKL step → direct lattice units)
    x_frac = fftshift(fftfreq(nh, d=dh))
    y_frac = fftshift(fftfreq(nk, d=dk))
    z_frac = fftshift(fftfreq(nl, d=dl))

    if plan.real_space_angstrom:
        # Convert fractional direct-lattice coordinates to Å
        # Real-space basis vectors = columns of (UB/2π)^{-T}  times 2π
        # i.e., direct lattice = 2π * inv(UB)^T
        try:
            direct = 2 * np.pi * np.linalg.inv(plan.ub_matrix).T
            a_vec = direct[:, 0]
            b_vec = direct[:, 1]
            c_vec = direct[:, 2]
            x_axis = x_frac * np.linalg.norm(a_vec)
            y_axis = y_frac * np.linalg.norm(b_vec)
            z_axis = z_frac * np.linalg.norm(c_vec)
        except np.linalg.LinAlgError:
            x_axis, y_axis, z_axis = x_frac, y_frac, z_frac
    else:
        x_axis, y_axis, z_axis = x_frac, y_frac, z_frac

    return DeltaPDF(
        data=delta_pdf,
        x_axis=x_axis,
        y_axis=y_axis,
        z_axis=z_axis,
        q_max=plan.q_max,
        apodization=plan.apodization,  # type: ignore[arg-type]
        pad_width=tuple(tuple(pw) for pw in plan.pad_width),  # type: ignore[misc]
        cropped_shape=plan.cropped_shape,  # type: ignore[arg-type]
        window_axes=plan.window_axes,
        window_ellipsoid=plan.window_ellipsoid,
        subtracted_mean=plan.subtracted_mean,
        smooth_bg=plan.smooth_bg,
        h_axis_c=h_axis,
        k_axis_c=k_axis,
        l_axis_c=l_axis,
        ub_matrix=plan.ub_matrix.copy(),
        support=plan.support,
    )


def compute_delta_pdf(
    vol: HKLVolume,
    apodization: Window = "hann",
    gaussian_sigma: float = 0.5,
    zero_pad: bool = True,
    subtract_mean: bool = True,
    real_space_angstrom: bool = True,
    crop_hkl: tuple[float, float, float] | None = None,
    q_band: tuple[float, float] | None = None,
    subtract_smooth_bg: float | tuple[float, float, float] | None = None,
    window_shape: WindowShape = "auto",
    support: NDArray[np.bool_] | None = None,
    support_tol: float = 1e-3,
) -> DeltaPDF:
    """Compute the 3D-ΔPDF from a diffuse scattering volume.

    The input *vol* should be the fully cleaned, Bragg-punched, and
    backfilled diffuse scattering volume.

    Parameters
    ----------
    vol:
        Cleaned HKLVolume (output of backfill_bragg).
    apodization:
        Window function applied in Q-space before FFT to suppress
        termination ripples:
        - ``"hann"``: cosine-squared taper (recommended for most cases)
        - ``"gaussian"``: Gaussian with σ = *gaussian_sigma* × the box
          half-width, shifted to reach zero at the box edge
        - ``"none"``: no window (hard truncation)
    gaussian_sigma:
        Width parameter for Gaussian window (fraction of Q_max).
    zero_pad:
        Pad to the next fast FFT length (5-smooth) for an efficient FFT.
    subtract_mean:
        Subtract the window-weighted mean intensity ``Σ w·I / Σ w`` before
        windowing, so the transformed input sums to zero (no r=0 spike)
        and the removed constant lands only at r≈0 (no box-edge streaks).
    real_space_angstrom:
        If True, compute real-space axes in Å using the UB matrix.
        If False, axes are in fractional units (1/HKL step).
    crop_hkl:
        Optional ``(h_max, k_max, l_max)`` in r.l.u.  When given, the
        volume is symmetrically cropped to ``|H| ≤ h_max``,
        ``|K| ≤ k_max``, ``|L| ≤ l_max`` before the FFT.  Cropping to a
        smaller, more uniform region of Q-space suppresses edge artifacts
        that arise from incomplete coverage or detector gaps at high Q.
    q_band:
        Optional spherical ``(q_min, q_max)`` shell in Å⁻¹.  Voxels outside
        the shell are set to zero before windowing/FFT.  ``None`` keeps the
        full cropped reciprocal-space range.
    subtract_smooth_bg:
        Optional Gaussian-blur sigma in r.l.u.  When set, a smooth
        Gaussian-blurred background is subtracted from the (filled) volume
        *before* windowing so that only the oscillatory diffuse modulation
        transforms.  The broad diffuse envelope that survives ring removal /
        Bragg punch / backfill is approximately separable; its FT would
        otherwise concentrate on the principal axes as a bright cross through
        the origin (see ``docs/algorithms/delta_pdf.md``).  Typical value
        ``~1.5``.  Trade-off: also removes genuine very-long-period / low-``r``
        correlations, which live at the same scale as the background.

        Pass a scalar for an isotropic-in-r.l.u. 3D blur, or a tuple
        ``(sigma_h, sigma_k, sigma_l)`` for per-axis control.  Use
        ``sigma_h = 0`` (e.g. ``(0, 1.5, 1.5)``) to estimate the background
        **slice-wise** — independently on each H plane — which is the right
        choice for H-layered/modulated data (an isotropic H-blur would smear
        the H=0/±1/3/±2/3 layers into each other's background).  This is
        mathematically identical to doing the 2D per-plane background
        subtraction and then a single 3D FFT (subtraction is linear and
        commutes with the transform).
    window_shape:
        Geometry of the window whose profile *apodization* sets:

        - ``"separable"``: a product of 1-D tapers along H, K and L, each
          zero at its own pair of box faces.
        - ``"ellipsoid"``: the taper as a function of ρ, the radius of the
          largest ellipsoid that fits in the box and that every symmetry of
          the lattice (found from the UB) maps onto itself; ``ρ = 1`` on it.
          For a hexagonal cell, ``ρ² = (Q⊥/d_ab)² + (Q∥/d_c)²`` with ``d`` the
          distances of the box faces from ``Q = 0``.
        - ``"auto"``: ``"ellipsoid"`` when a symmetry of the lattice mixes the
          axes in a way no product of 1-D tapers can follow — the 6-fold axis
          of a hexagonal cell, ``(h, k, l) → (−k, h + k, l)`` — otherwise
          ``"separable"``, which the Laue groups of orthogonal, monoclinic
          and triclinic cells already leave unchanged.  ``"none"`` stays
          no window at all.
    support:
        Optional boolean mask on *vol*'s grid: True where the volume holds
        data (measured or filled), False where it does not — e.g. the
        backfilled volume's ``mask``, False on the unmeasured space it leaves
        open.  Outside the support the transform input is ``ΔI = 0`` rather
        than ``I = 0``, and the mean is taken over the support, so a missing
        region adds no step of ``−c``.  Unsupported space that reaches the box
        faces is where the coverage ends: the window is then an ellipsoid
        (``"auto"`` switches to one when the separable window puts more than
        *support_tol* of its weight there) shrunk until at most *support_tol*
        of its weight lies on that space, so it tapers to zero at the
        coverage edge instead of the box faces.  Holes enclosed by data do
        not shrink it.  ``None``, or a mask that is all True, changes nothing.
    support_tol:
        Largest fraction of the window's weight allowed on unsupported space
        that reaches the box faces.  0 shrinks the ellipsoid until none is
        inside it; the default ignores thin channels of a few voxels, which
        would otherwise collapse the window.

    Returns
    -------
    DeltaPDF
    """

    plan = _prepare_forward(
        vol, apodization=apodization, gaussian_sigma=gaussian_sigma,
        zero_pad=zero_pad, subtract_mean=subtract_mean,
        real_space_angstrom=real_space_angstrom, crop_hkl=crop_hkl,
        q_band=q_band, subtract_smooth_bg=subtract_smooth_bg,
        window_shape=window_shape, support=support, support_tol=support_tol)
    delta_pdf = _fft_core_forward(plan)
    return _finish_forward(plan, delta_pdf)


def _prepare_forward(
    vol: HKLVolume,
    *,
    apodization: Window = "hann",
    gaussian_sigma: float = 0.5,
    zero_pad: bool = True,
    subtract_mean: bool = True,
    real_space_angstrom: bool = True,
    crop_hkl: tuple[float, float, float] | None = None,
    q_band: tuple[float, float] | None = None,
    subtract_smooth_bg: float | tuple[float, float, float] | None = None,
    window_shape: WindowShape = "auto",
    support: NDArray[np.bool_] | None = None,
    support_tol: float = 1e-3,
    fast_len: Callable[[int], int] = next_fast_len,
) -> _ForwardPlan:
    """All pure-Python preparation up to (but excluding) the FFT core.

    ``fast_len`` is injectable so a backend with different fast radices can
    choose its own padded lengths (the WebGPU core pads to strict 5-smooth);
    the choice is recorded in the plan/DeltaPDF ``pad_width``, keeping the
    inverse self-consistent whichever backend produced the result.
    """
    data = vol.masked_data()  # NaN at masked voxels
    if support is not None:
        support = np.asarray(support, dtype=bool)
        if support.shape != data.shape:
            raise ValueError(f"support has shape {support.shape}, the volume "
                             f"{data.shape}")

    # Crop Q-space symmetrically to ±(h_max, k_max, l_max) in r.l.u.
    h_axis = vol.h_axis.copy()
    k_axis = vol.k_axis.copy()
    l_axis = vol.l_axis.copy()
    if crop_hkl is not None:
        h_max, k_max, l_max = crop_hkl
        ih = np.where(np.abs(h_axis) <= h_max)[0]
        ik = np.where(np.abs(k_axis) <= k_max)[0]
        il = np.where(np.abs(l_axis) <= l_max)[0]
        data    = data[ih[0]:ih[-1]+1, ik[0]:ik[-1]+1, il[0]:il[-1]+1]
        if support is not None:
            support = support[ih[0]:ih[-1]+1, ik[0]:ik[-1]+1, il[0]:il[-1]+1]
        h_axis  = h_axis[ih[0]:ih[-1]+1]
        k_axis  = k_axis[ik[0]:ik[-1]+1]
        l_axis  = l_axis[il[0]:il[-1]+1]

    # Replace NaN with zero (filled volume should have no NaN).  With a
    # support, a voxel carries data only where it is supported and finite;
    # an all-True support is no support (the transform stays bit-identical).
    supp: NDArray[np.bool_] | None = None
    if support is not None:
        supp = support & np.isfinite(data)
        if supp.all():
            supp = None
    data = np.where(np.isfinite(data) if supp is None else supp, data, 0.0)

    # Subtract a smooth (Gaussian-blurred) background BEFORE windowing so that
    # only the oscillatory diffuse modulation transforms.  Without this, the
    # broad ~separable diffuse envelope that survives ring removal / punch /
    # backfill FTs into a bright cross on the y_K=0 / z_L=0 axes (the scalar
    # subtract_mean below only removes the DC term, not the envelope shape).
    # sigma is in r.l.u.  See docs/algorithms/delta_pdf.md.
    #
    # A scalar sigma blurs all three axes equally.  A per-axis (sigma_h, sigma_k,
    # sigma_l) lets you set sigma_h=0 to estimate the background INDEPENDENTLY on
    # each H plane (slice-wise) — identical to running the 2D per-plane bg, then
    # one 3D FFT.  This is the right model for H-layered/modulated data, where an
    # isotropic H-blur (e.g. 1.5 r.l.u. ≈ 45 px on a 0.033-step H axis) would
    # smear the H=0/±1/3/±2/3 layers into each other's background.
    smooth_bg: NDArray[np.floating] | None = None
    if subtract_smooth_bg:
        if isinstance(subtract_smooth_bg, tuple):
            sig_h, sig_k, sig_l = (float(s) for s in subtract_smooth_bg)
        else:
            sig_h = sig_k = sig_l = float(subtract_smooth_bg)
        dh0 = (h_axis[-1] - h_axis[0]) / max(len(h_axis) - 1, 1)
        dk0 = (k_axis[-1] - k_axis[0]) / max(len(k_axis) - 1, 1)
        dl0 = (l_axis[-1] - l_axis[0]) / max(len(l_axis) - 1, 1)
        sigma_px = (sig_h / dh0, sig_k / dk0, sig_l / dl0)
        smooth_bg = gaussian_filter(data, sigma=sigma_px, mode="nearest")
        data = data - smooth_bg

    q_mag = None
    if q_band is not None:
        qmin, qmax = q_band
        if qmax <= qmin:
            raise ValueError("q_band must satisfy q_max > q_min")
        q_mag = q_magnitude_from_axes(h_axis, k_axis, l_axis, vol.ub_matrix)
        in_band = (q_mag >= qmin) & (q_mag <= qmax)
        if not np.any(in_band):
            raise ValueError(f"q_band {q_band} selects no voxels")
        data = np.where(in_band, data, 0.0)

    # Shape of the (cropped, bg-subtracted) volume that actually enters the
    # transform — recorded so invert_delta_pdf can un-pad back to it.
    cropped_shape = data.shape

    # Remove the DC term, then apodize.  The constant removed is the
    # window-weighted mean c = Σ w·I / Σ w, so the windowed input w·(I − c)
    # sums to exactly zero (no r = 0 spike) and still tapers with the window
    # at the box faces.  The removed term c·w transforms into the window's
    # own resolution peak at r = 0, which is all a constant in I(Q) may
    # change.  The earlier order (window, then subtract the plain mean)
    # left a step of that mean at the box faces against the zero padding;
    # its transform, a 3-D sinc sampled off its zeros, drew a dashed line of
    # alternating sign along every grid axis (a sizeable fraction of the
    # strongest correlation on measured data).  See docs/algorithms/delta_pdf.md.
    #
    # Outside the support the input is ΔI = 0: the mean is weighted over the
    # support only, and those voxels are zeroed after it is subtracted.  Read
    # as I = 0 instead, a missing region pulls c down and leaves a step of −c
    # at its edge (the larger the unmeasured share of the box, the further c
    # falls below the mean over the data).
    window_axes, ellipsoid = _apodization_window(
        window_shape, apodization, gaussian_sigma,
        (h_axis, k_axis, l_axis), vol.ub_matrix, support=supp, tol=support_tol)
    subtracted_mean = 0.0
    if subtract_mean:
        subtracted_mean = (
            ellipsoid.weighted_mean(data, supp) if ellipsoid is not None
            else _window_weighted_mean(data, window_axes, supp))  # type: ignore[arg-type]
        data -= data.dtype.type(subtracted_mean)
        if supp is not None:
            for i in range(data.shape[0]):
                data[i][~supp[i]] = 0.0
    if ellipsoid is not None:
        ellipsoid.apply(data)  # plane by plane; no 3-D window either
    else:
        # Apply the separable window as three broadcast in-place multiplies —
        # never materialising the full 3-D window array (a volume-sized
        # float64).
        assert window_axes is not None
        data *= window_axes[0][:, None, None]
        data *= window_axes[1][None, :, None]
        data *= window_axes[2][None, None, :]

    # Zero-pad to the next fast FFT length (11-smooth; scipy.fft.next_fast_len
    # — pocketfft has fast radices up to 11).  pocketfft transforms these just
    # as fast as powers of two, but the pad is far smaller (e.g. 360→375
    # instead of 360→512 — ~2.6× less memory for the padded and complex
    # arrays), which is what keeps full-resolution volumes inside the
    # browser's WASM heap.  Pad SYMMETRICALLY so the Q=0 origin (at index s//2
    # of each axis) stays at the centre of the padded array — one-sided
    # padding would shift the origin and reintroduce the phase ramp that the
    # FFT core's ifftshift removes.  The padded length is an implementation
    # detail recorded per-result in ``pad_width``: invert_delta_pdf reads the
    # stored values, so a backend with a different fast-length rule (the
    # WebGPU path pads to 5-smooth) stays self-consistent on inversion.
    if zero_pad:
        padded_shape = tuple(fast_len(s) for s in data.shape)
    else:
        padded_shape = data.shape
    pad_width = []
    for s, ps in zip(data.shape, padded_shape):
        lo = ps // 2 - s // 2          # land the origin on the new centre ps//2
        pad_width.append((lo, ps - s - lo))

    # Everything below is backend-replaceable: prepare-plan → FFT core →
    # finish (the browser's WebGPU path swaps only the core).
    if q_mag is None:
        # max|Q| over the (cropped) grid.  |Q| = ‖UB·hkl‖ is convex, so its
        # maximum over the axis-aligned hkl box is attained at a corner — and the
        # grid endpoints ARE those corners.  Evaluating 8 corners is exact and
        # avoids materialising a full (nh,nk,nl,3) meshgrid just for one scalar.
        q_max = _q_max_from_axes(h_axis, k_axis, l_axis, vol.ub_matrix)
    else:
        if q_band is not None:
            qmin, qmax_in = q_band
            retained = q_mag[(q_mag >= qmin) & (q_mag <= qmax_in)]
            q_max = float(np.max(retained))
        else:
            q_max = float(np.max(q_mag))
    del q_mag

    plan = _ForwardPlan(
        data=data,
        pad_width=pad_width,
        padded_shape=padded_shape,
        cropped_shape=cropped_shape,
        window_axes=window_axes,
        window_ellipsoid=ellipsoid,
        subtracted_mean=subtracted_mean,
        smooth_bg=smooth_bg,
        h_axis=h_axis,
        k_axis=k_axis,
        l_axis=l_axis,
        q_max=q_max,
        apodization=apodization,
        real_space_angstrom=real_space_angstrom,
        ub_matrix=vol.ub_matrix,
        support=supp,
    )
    del data  # the plan owns the compact volume now
    return plan





def invert_delta_pdf(
    dpdf: DeltaPDF,
    *,
    deapodize: bool = True,
    add_back_smooth_bg: bool = True,
    window_floor: float = 1e-3,
    consume: bool = False,
) -> HKLVolume:
    """Inverse-transform a 3D-ΔPDF back to its reciprocal-space diffuse volume.

    This is the exact mathematical inverse of :func:`compute_delta_pdf`: undo the
    centred FFT, strip the symmetric zero-padding, then (optionally) divide out
    the apodization window and restore the subtracted mean / smooth background —
    recovering the cleaned diffuse intensity ``I(Q)`` that produced the ΔPDF.

    Round-tripping ``compute_delta_pdf → invert_delta_pdf`` is the consistency
    check: the reconstruction should reproduce the transformed volume to
    numerical precision (the input is centrosymmetric — ``mmm`` Laue — so the
    real-part projection in the forward transform loses nothing).  Where it
    *doesn't* match, the discrepancy localises what the transform settings
    discard: high-|Q| detail removed by ``crop_hkl`` and, for ``hann``, the
    edge planes where the window vanishes.

    Parameters
    ----------
    deapodize:
        Divide out the apodization window to recover the un-tapered intensity.
        Stable for ``gaussian`` (never zero); for ``hann`` the division is
        clamped by *window_floor* and the edge planes are unreliable.  ``False``
        returns the windowed reconstruction — what a naive inverse FFT yields.
    add_back_smooth_bg:
        Re-add the smooth background removed by ``subtract_smooth_bg`` (only if
        it was used).  ``False`` keeps only the oscillatory modulation.
    window_floor:
        Smallest window value (relative to its peak) the deapodization divides
        by; also defines the reliable-region ``mask``.
    consume:
        Release ``dpdf.data`` (replaced by an empty array) as soon as it has
        been copied for the transform.  Opt-in for memory-critical callers
        (the in-browser pipeline's consistency check) that never slice the
        ΔPDF afterwards: the padded volume is 1 volume-equivalent that would
        otherwise sit under the inverse FFT's complex transient.

    Returns
    -------
    HKLVolume
        Reciprocal-space reconstruction on the (possibly cropped) HKL grid of
        the transform input.  ``mask`` marks where the window exceeds
        *window_floor* (the reliably recoverable region).
    """
    if (dpdf.pad_width is None or dpdf.cropped_shape is None
            or (dpdf.window_axes is None and dpdf.window_ellipsoid is None)
            or dpdf.h_axis_c is None
            or dpdf.k_axis_c is None or dpdf.l_axis_c is None):
        raise ValueError(
            "DeltaPDF is missing the inverse metadata (pad_width / cropped_shape "
            "/ window / cropped axes); recompute it with compute_delta_pdf "
            "from this build before inverting.")

    prep_pad = _fft_core_inverse(dpdf, consume=consume)

    # Strip the symmetric zero-padding → the windowed input win·(I − bg − c).
    sl = tuple(slice(lo, lo + n)
               for (lo, _hi), n in zip(dpdf.pad_width, dpdf.cropped_shape))
    prep = np.array(prep_pad[sl])
    del prep_pad  # the padded inverse is no longer needed
    return _finish_inverse(dpdf, prep, deapodize=deapodize,
                           add_back_smooth_bg=add_back_smooth_bg,
                           window_floor=window_floor)


def _fft_core_inverse(dpdf: DeltaPDF, *, consume: bool) -> NDArray[np.floating]:
    """The scipy inverse-FFT backend: centred inverse transform, real part.

    Exact inverse of fftshift(fftn(ifftshift(·))).  The stored ΔPDF is real
    (FT of centrosymmetric I(Q)); ifftn of it is real up to round-off.
    Stepwise with prompt frees, real part before fftshift (they commute) —
    same memory discipline as the forward transform.  Backend-replaceable
    (the browser's WebGPU path swaps this core, returning the same padded
    real volume).
    """
    work = ifftshift(dpdf.data)
    if consume:
        dpdf.data = np.empty((0, 0, 0), dtype=work.dtype)
    ft = ifftn(work, workers=_FFT_WORKERS)
    del work
    prep_pad = np.ascontiguousarray(ft.real)
    del ft
    return fftshift(prep_pad)


def _finish_inverse(
    dpdf: DeltaPDF,
    prep: NDArray[np.floating],
    *,
    deapodize: bool,
    add_back_smooth_bg: bool,
    window_floor: float,
) -> HKLVolume:
    """Deapodize + rebuild the reciprocal-space HKLVolume (backend-agnostic).

    ``prep`` is the un-padded windowed input ``win·(I − bg − c)``, with ``c``
    the window-weighted mean :func:`compute_delta_pdf` removed — the common
    meeting point of the scipy and WebGPU cores.  ``c`` goes back after the
    window is divided out (or as ``c·win`` when it is not).  Outside
    ``dpdf.support`` the input was ``ΔI = 0``, not data: those voxels are
    left out of the reliable ``mask``.
    """
    # invert_delta_pdf validated these; repeat for direct callers + narrowing.
    assert (dpdf.h_axis_c is not None
            and dpdf.k_axis_c is not None and dpdf.l_axis_c is not None)

    # The window one H plane at a time, never the full 3-D array.  Separable:
    # each element is (wh[i]*wk[j])*wl[k], and the maximum of a non-negative
    # separable product is exactly (wh.max()*wk.max())*wl.max().  Ellipsoid:
    # the profile peaks at 1 (ρ = 0).
    planes: Iterator[NDArray[np.float64]]
    if dpdf.window_ellipsoid is not None:
        planes = dpdf.window_ellipsoid.planes()
        peak = 1.0
    else:
        assert dpdf.window_axes is not None
        wh, wk, wl = dpdf.window_axes
        planes = ((wh[i] * wk)[:, None] * wl[None, :] for i in range(len(wh)))
        peak = float((wh.max() * wk.max()) * wl.max())
    mean = prep.dtype.type(dpdf.subtracted_mean)
    if deapodize:
        # Deapodize one H-plane at a time instead of materialising the full
        # 3-D window (+ a fresh zero-filled output): peak drops by ~2 volumes.
        # The where-divide + zero-fill reproduces
        # ``np.divide(..., out=np.zeros_like(prep), where=reliable)``.
        thr = window_floor * peak
        reliable = np.empty(prep.shape, dtype=bool)
        for i, win_i in enumerate(planes):
            rel_i = win_i >= thr
            if dpdf.support is not None:
                rel_i &= dpdf.support[i]  # no data there: ΔI = 0 went in
            np.divide(prep[i], win_i, out=prep[i], where=rel_i)
            prep[i] += mean
            prep[i][~rel_i] = 0.0
            reliable[i] = rel_i
        recon = prep
    else:
        if mean:
            for i, win_i in enumerate(planes):
                prep[i] += mean * win_i.astype(prep.dtype)
        recon = prep
        reliable = (np.ones(recon.shape, dtype=bool) if dpdf.support is None
                    else dpdf.support.copy())

    if add_back_smooth_bg and dpdf.smooth_bg is not None:
        recon = recon + dpdf.smooth_bg

    ub = (np.asarray(dpdf.ub_matrix, dtype=np.float64)
          if dpdf.ub_matrix is not None else np.eye(3, dtype=np.float64))
    # Zero-stride broadcast view instead of a materialised zeros volume: the
    # reconstruction has no error estimate and nothing writes to it.
    zero_sigma = np.broadcast_to(recon.dtype.type(0.0), recon.shape)
    return HKLVolume(
        data=recon,
        sigma=zero_sigma,
        mask=reliable,
        h_axis=dpdf.h_axis_c.copy(),
        k_axis=dpdf.k_axis_c.copy(),
        l_axis=dpdf.l_axis_c.copy(),
        ub_matrix=ub.copy(),
    )


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _window_axes(
    shape: tuple[int, ...], kind: Window, sigma: float
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    """The three separable 1-D apodization factors (kept for exact inversion).

    Every window but ``"none"`` reaches zero at the box edge: the data stop
    there, and a window that does not vanish where the data are cut leaves a
    step whose transform is a streak along the axis normal to that face.  The
    Gaussian is therefore shifted down by its edge value and rescaled to peak
    at 1, ``(g − g_edge) / (1 − g_edge)``; for σ = 0.4 that moves it by at
    most 4.4 % and narrows its FWHM by 3 %.  A single-plane axis keeps 1.
    """
    def _1d(n: int) -> NDArray[np.float64]:
        if n == 1:
            return np.ones(1, dtype=np.float64)
        if kind == "hann":
            return np.hanning(n).astype(np.float64)
        if kind == "gaussian":
            x = np.linspace(-1, 1, n)
            g = np.exp(-0.5 * (x / sigma) ** 2)
            edge = np.exp(-0.5 / sigma**2)
            return np.clip((g - edge) / (1.0 - edge), 0.0, None).astype(np.float64)
        return np.ones(n, dtype=np.float64)

    return _1d(shape[0]), _1d(shape[1]), _1d(shape[2])


def _window_weighted_mean(
    data: NDArray[np.floating],
    window_axes: tuple[NDArray[np.float64], ...],
    support: NDArray[np.bool_] | None = None,
) -> float:
    """``Σ w·data / Σ w`` for the separable window, accumulated in float64.

    Over *support* when given (*data* must be zero outside it).  One plane at
    a time, so neither the 3-D window nor a float64 copy of a float32 volume
    is ever materialised.
    """
    wh, wk, wl = window_axes
    if support is None:
        total = float((wh.sum() * wk.sum()) * wl.sum())
    else:
        total = sum(float(wh[i]) * float(wk @ (support[i] @ wl))
                    for i in range(len(wh)) if wh[i] != 0.0)
    if total == 0.0:
        return 0.0
    acc = 0.0
    for i in range(data.shape[0]):
        if wh[i] != 0.0:
            acc += float(wh[i]) * float(wk @ (data[i].astype(np.float64) @ wl))
    return acc / total


#: ρ² at or above this is on or outside the ellipsoid, where the window is 0.
#: The ellipsoid touches the box faces at ρ = 1, which the quadratic form may
#: land a few ulp below; the taper there is ~1e-20, so this changes nothing
#: but makes the face voxels exactly zero.
_RHO2_EDGE = 1.0 - 1e-12


def _radial_taper(
    rho2: NDArray[np.float64], kind: Window, sigma: float,
) -> NDArray[np.float64]:
    """The window profile at ρ² (overwrites *rho2*), zero for ``ρ ≥ 1``.

    The same profiles as :func:`_window_axes` along one axis: Hann
    ``cos²(πρ/2)`` (``np.hanning`` is ``cos²(πx/2)`` on ``x ∈ [−1, 1]``), the
    Gaussian shifted to zero at ``ρ = 1``, and 1 for ``"none"``.
    """
    outside = rho2 >= _RHO2_EDGE
    if kind == "hann":
        w = np.sqrt(np.clip(rho2, 0.0, 1.0, out=rho2), out=rho2)
        w *= 0.5 * np.pi
        np.cos(w, out=w)
        w *= w
    elif kind == "gaussian":
        edge = np.exp(-0.5 / sigma**2)
        w = np.exp(rho2 * (-0.5 / sigma**2), out=rho2)
        w -= edge
        w /= 1.0 - edge
    else:
        w = np.ones_like(rho2)
    w[outside] = 0.0
    return w


#: Relative tolerance on the reciprocal metric when looking for the lattice's
#: point symmetry.  Refined UBs are not exactly symmetric: on a hexagonal cell
#: with a and b 1 % apart and the angles up to 0.4° from 90/90/120 (the
#: perturbed cell in tests/test_delta_pdf_window.py) the 24 operations of
#: 6/mmm are off by ≤ 2.2 %, the nearest other candidate by 67 %.
_LATTICE_TOL = 0.05


@functools.lru_cache(maxsize=1)
def _unimodular_candidates() -> NDArray[np.int64]:
    """Every 3×3 matrix with entries in {−1, 0, 1} and determinant ±1."""
    m = np.array(list(itertools.product((-1, 0, 1), repeat=9)),
                 dtype=np.int64).reshape(-1, 3, 3)
    det = np.rint(np.linalg.det(m.astype(np.float64))).astype(np.int64)
    return m[np.abs(det) == 1]


def _lattice_point_group(
    ub: NDArray[np.float64], tol: float = _LATTICE_TOL,
) -> NDArray[np.int64]:
    """The lattice's point symmetry as integer matrices acting on ``(h, k, l)``.

    ``R`` is kept when ``(h, k, l) → R·(h, k, l)`` maps every Q onto a Q of
    the same length — ``Rᵀ·G*·R = G*`` with ``G* = UBᵀ·UB`` — to within *tol*
    relative to ``√(G*_ii·G*_jj)``.  Candidates have entries in {−1, 0, 1},
    which covers conventional and reduced cells (the hexagonal 6-fold is
    ``(h, k, l) → (−k, h + k, l)``).  Returns an ``(n, 3, 3)`` array; just
    ±identity for a singular UB.
    """
    g = np.asarray(ub, dtype=np.float64).T @ np.asarray(ub, dtype=np.float64)
    diag = np.diag(g)
    if not np.all(diag > 0.0):
        return np.array([np.eye(3, dtype=np.int64), -np.eye(3, dtype=np.int64)])
    cand = _unimodular_candidates()
    r = cand.astype(np.float64)
    moved = np.einsum("nji,jk,nkl->nil", r, g, r)
    err = (np.abs(moved - g) / np.sqrt(np.outer(diag, diag))).max(axis=(1, 2))
    return cand[err <= tol]


def _invariant_ellipsoid(
    ops: NDArray[np.int64], half: NDArray[np.float64],
) -> NDArray[np.float64]:
    """The largest ellipsoid ``xᵀ·M·x ≤ 1`` inside the box ``|x_i| ≤ half[i]``
    that every operation ``x → R·x`` of the group *ops* maps onto itself.

    Its shape matrix ``A = M⁻¹`` fits the box iff ``A_ii ≤ half_i²`` and is
    invariant iff ``R·A·Rᵀ = A``.  The largest such ellipsoid (maximum
    ``det A``) is unique, and its optimality condition makes ``M`` a
    positive combination of the face terms averaged over the group:
    ``M = Σ_i λ_i·F_i`` with ``F_i = ⟨r_i r_iᵀ⟩_R / half_i²`` (``r_i`` the
    i-th row of R), i.e. ``ρ² = Σ_i λ_i·⟨(R·x)_i²⟩_R / half_i²``.  The weights
    are D-optimal-design weights, found by the monotone multiplicative
    update ``λ_i ← λ_i·tr(F_i·M⁻¹)``.  A last rescale makes the ellipsoid
    touch the nearest face exactly, so it fits the box whatever the
    iteration's residual.  Without symmetry beyond sign flips this is the
    index-space sphere ``Σ (x_i/half_i)²``; for a hexagonal box (half-widths
    X, X, X_L) it is ``(4/3)(h² + hk + k²)/X² + l²/X_L²``.
    """
    dim = len(half)
    if dim == 0:
        return np.zeros((0, 0))
    r = ops.astype(np.float64)
    faces = np.einsum("nij,nik->ijk", r, r) / len(r)
    faces /= (np.asarray(half, dtype=np.float64) ** 2)[:, None, None]
    lam = np.ones(dim)
    for _ in range(1000):
        shape = np.linalg.inv(np.tensordot(lam, faces, axes=1))
        new = lam * np.einsum("ijk,jk->i", faces, shape)
        done = float(np.abs(new - lam).max()) < 1e-13
        lam = new
        if done:
            break
    form = np.tensordot(lam, faces, axes=1)
    form *= float(np.max(np.diag(np.linalg.inv(form)) / np.asarray(half) ** 2))
    return 0.5 * (form + form.T)


def _apodization_window(
    window_shape: WindowShape,
    kind: Window,
    sigma: float,
    axes: tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]],
    ub: NDArray[np.float64],
    support: NDArray[np.bool_] | None = None,
    tol: float = 1e-3,
) -> tuple[tuple[NDArray[np.float64], ...] | None, EllipsoidWindow | None]:
    """The window for this box: ``(window_axes, None)`` or ``(None, ellipsoid)``.

    Single-plane axes take no part: the symmetry is restricted to the
    operations that leave them alone, and ρ ignores them.  The ellipsoid is
    centred on ``Q = 0``, with half-widths ``min(−axis[0], axis[-1])``.  With
    a *support*, unsupported space that reaches the box faces
    (:func:`_open_space`) is where the coverage ends: ``"auto"`` takes the
    ellipsoid when the separable window puts more than *tol* of its weight
    there, and the ellipsoid is shrunk to it (:func:`_fit_to_support`).
    """
    if window_shape not in ("auto", "separable", "ellipsoid"):
        raise ValueError(f"unknown window_shape {window_shape!r}")
    shape = tuple(len(ax) for ax in axes)
    if window_shape == "separable" or (window_shape == "auto" and kind == "none"):
        return _window_axes(shape, kind, sigma), None

    active = [i for i, n in enumerate(shape) if n > 1]
    ops = _lattice_point_group(ub)
    for j in (i for i in range(3) if i not in active):
        unit = np.zeros(3, dtype=np.int64)
        unit[j] = 1
        ops = ops[(np.abs(ops[:, j, :]) == unit).all(axis=1)
                  & (np.abs(ops[:, :, j]) == unit).all(axis=1)]
    ops = ops[:, active][:, :, active]
    half = np.array([min(-float(axes[i][0]), float(axes[i][-1])) for i in active])

    open_: NDArray[np.bool_] | None = None
    if window_shape == "auto":
        # A product of 1-D tapers is invariant under signed permutations of
        # equal axes, never under an operation that mixes two axes; and it
        # cannot follow a coverage edge inside the box.
        use = bool(np.any(np.count_nonzero(ops, axis=2) != 1))
        if not use and support is not None:
            open_ = _open_space(support)
            separable = _window_axes(shape, kind, sigma)
            use = _separable_weight_on(separable, open_) > tol
        if not use or np.any(half <= 0.0):
            return _window_axes(shape, kind, sigma), None
    elif np.any(half <= 0.0):
        raise ValueError("an ellipsoid window needs Q = 0 inside the box")

    form = np.zeros((3, 3))
    form[np.ix_(active, active)] = _invariant_ellipsoid(ops, half)
    ell = EllipsoidWindow(
        form=form, kind=kind, sigma=float(sigma),
        h_axis=np.asarray(axes[0], dtype=np.float64).copy(),
        k_axis=np.asarray(axes[1], dtype=np.float64).copy(),
        l_axis=np.asarray(axes[2], dtype=np.float64).copy())
    if support is not None:
        if open_ is None:
            open_ = _open_space(support)
        if open_.any():
            ell = _fit_to_support(ell, open_, tol)
    return None, ell


def _open_space(support: NDArray[np.bool_]) -> NDArray[np.bool_]:
    """Unsupported voxels connected to a box face (26-neighbour): where the
    coverage ends.  Unsupported holes enclosed by supported voxels are not.

    Single-plane axes are dropped first, so a 2-D section's holes are holes.
    Bool arrays only: ``binary_fill_holes`` needs a few 1-byte volumes.
    """
    flat = support.reshape([n for n in support.shape if n > 1])
    if flat.ndim == 0:
        return np.zeros(support.shape, dtype=bool)
    filled = ndimage.binary_fill_holes(
        flat, structure=np.ones((3,) * flat.ndim, dtype=bool))
    return np.logical_not(filled, out=filled).reshape(support.shape)


def _separable_weight_on(
    window_axes: tuple[NDArray[np.float64], ...], region: NDArray[np.bool_],
) -> float:
    """Fraction of the separable window's weight that lies in *region*."""
    wh, wk, wl = window_axes
    total = float((wh.sum() * wk.sum()) * wl.sum())
    on = sum(float(wh[i]) * float(wk @ (region[i] @ wl))
             for i in range(len(wh)) if wh[i] != 0.0 and region[i].any())
    return on / total if total else 0.0


#: ρ-histogram bins and scale steps for :func:`_fit_to_support`.
_FIT_BINS = 4096
_FIT_SCALES = np.arange(1000, 0, -1) / 1000.0


def _fit_to_support(
    ell: EllipsoidWindow, open_: NDArray[np.bool_], tol: float,
) -> EllipsoidWindow:
    """Shrink *ell* until at most *tol* of its weight lies on *open_*.

    One pass over the planes histograms ``ρ`` over all voxels and over the
    open ones; the open fraction of the weight ``Σ_open f(ρ/s) / Σ f(ρ/s)``
    is then cheap for any scale ``s``, and the largest ``s`` (in steps of
    0.001) that meets *tol* is kept.  ``tol = 0`` uses the exact smallest
    ``ρ`` of an open voxel instead, so no open voxel keeps any weight.  The
    shrunk window is the same ellipsoid scaled, so it stays invariant.
    """
    h, k, l_ = ell.h_axis, ell.k_axis, ell.l_axis
    corners = np.array([(a, b, c) for a in (h[0], h[-1]) for b in (k[0], k[-1])
                        for c in (l_[0], l_[-1])])
    rho_max = float(np.sqrt(np.einsum("ni,ij,nj->n", corners, ell.form, corners).max()))
    rho_max = max(rho_max, 1.0) * (1.0 + 1e-9)
    hist_all = np.zeros(_FIT_BINS)
    hist_open = np.zeros(_FIT_BINS)
    rho_open_min = np.inf
    for i, rho2 in enumerate(ell.rho2_planes()):
        rho = np.sqrt(np.maximum(rho2, 0.0, out=rho2), out=rho2)
        b = np.minimum((rho * (_FIT_BINS / rho_max)).astype(np.intp), _FIT_BINS - 1)
        hist_all += np.bincount(b.ravel(), minlength=_FIT_BINS)
        if open_[i].any():
            hist_open += np.bincount(b[open_[i]], minlength=_FIT_BINS)
            rho_open_min = min(rho_open_min, float(rho[open_[i]].min()))
    if tol <= 0.0:
        scale = min(1.0, rho_open_min)
    else:
        centres = (np.arange(_FIT_BINS) + 0.5) * (rho_max / _FIT_BINS)
        scale = 0.0
        for s in _FIT_SCALES:
            w = _radial_taper((centres / s) ** 2, ell.kind, ell.sigma)
            total = float(w @ hist_all)
            if total > 0.0 and float(w @ hist_open) <= tol * total:
                scale = float(s)
                break
    if scale <= 0.0:
        raise ValueError("the support leaves no region around Q = 0 for the window")
    if scale >= 1.0:
        return ell
    return dataclasses.replace(ell, form=ell.form / scale**2, scale=scale)


def _build_window(shape: tuple[int, ...], kind: Window, sigma: float) -> NDArray:
    """Build a 3D separable apodization window."""
    wh, wk, wl = _window_axes(shape, kind, sigma)
    return wh[:, None, None] * wk[None, :, None] * wl[None, None, :]


def _q_max_from_axes(
    h_axis: NDArray[np.float64],
    k_axis: NDArray[np.float64],
    l_axis: NDArray[np.float64],
    ub_matrix: NDArray[np.float64],
) -> float:
    """Exact max |Q| (Å⁻¹) over the hkl box spanned by the axes, from 8 corners.

    ``|Q| = ‖UB·hkl‖`` is convex in ``hkl``; its maximum over the axis-aligned
    box ``[h_axis bounds]×[k]×[l]`` is therefore at a vertex, and the axis
    endpoints supply those vertices.  Bit-identical to ``q_magnitude().max()``
    over the regular grid, without the full meshgrid + matmul.
    """
    corners = np.array(
        [(hh, kk, ll)
         for hh in (h_axis[0], h_axis[-1])
         for kk in (k_axis[0], k_axis[-1])
         for ll in (l_axis[0], l_axis[-1])],
        dtype=np.float64,
    )
    return float(np.linalg.norm(corners @ np.asarray(ub_matrix).T, axis=1).max())
