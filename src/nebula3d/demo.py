# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Synthetic demo volume: a rock-salt-type crystal with three kinds of diffuse.

:func:`demo_volume` builds the HKL volume behind the web app's **Use demo**
button (via :func:`nebula3d.webbridge.make_demo_input`).  The model gives every
pipeline stage something real to remove or keep, on the intensity scale of a
normalised Mantid volume (diffuse ~0.1–0.5, Bragg peaks up to ~150, noise ~0.02).

Crystal: cubic, ``a = 4.2 Å``, FCC lattice (a rock-salt-type cation + anion
pair, identity UB).  Default grid: 161³ voxels over ±4 r.l.u. (step 0.05 r.l.u.
= 0.075 Å⁻¹), |Q| up to 6 Å⁻¹ along an axis, ~10 Å⁻¹ in the corners.

What each stage should find:

- **Bragg peaks** (``"bragg"``) at the FCC nodes only (h, k, l all even or all
  odd; all-odd ones at 40 % of all-even), with a |Q|-dependent resolution
  ellipsoid (radial Δd/d, tangential mosaic) and a Debye–Waller falloff.  The
  mixed-parity nodes are systematically absent.
- **Chemical short-range order** (``"sro"``) on the FCC cation sublattice, from
  the Krivoglaz–Clapp–Moss expression with first- and second-neighbour pair
  interactions (``V2/V1 = 0.3``): broad diffuse maxima at the (1 ½ 0)
  positions, joined along ⟨100⟩ through (1 0 0) and (1 1 0).  In the 3D-ΔPDF
  the planted Warren–Cowley correlations appear as alternating shells:
  negative at the nearest-neighbour vector ⟨½ ½ 0⟩a (unlike cations), positive
  at ⟨1 ½ ½⟩a and ⟨2 0 0⟩a.
- **Thermal diffuse scattering** (``"tds"``): one-phonon TDS of a nearest-
  neighbour central-force FCC lattice, ``Q·D(Q)⁻¹·Q`` with ``D`` the dynamical
  matrix.  It peaks at every Bragg node, grows as |Q|², and streaks along
  ⟨110⟩ (the soft transverse branch).  Periodic and smooth, so it continues
  under the punched holes the way real TDS does; the backfill has to follow it.
- **Planar (2-D) order** (``"rods"``): order inside each (001) layer on a
  2a × 2a cell, uncorrelated from layer to layer, gives rods along L at
  (h+½, k+½, L).  In the 3D-ΔPDF it is a checkerboard of correlations confined
  to the z = 0 plane: rods in reciprocal space are planes in real space.

Plus what the cleanup stages remove: a smooth radial background (low-|Q| rise
and a broad hump), a compact incident-beam spot at the origin, textured
aluminium powder rings from the sample can (Al d-spacings, texture axially
symmetric about c*), Poisson counting noise and a small background-subtraction
residual that can go negative.  ``sigma`` is the matching per-voxel error.

The volume is ``mmm``-symmetric (4/mmm: the rods break the cubic 3-fold) and
deterministic for a given ``seed``.  It is built in slabs of H planes, so the
temporaries stay a few MB even in the browser's WASM heap.
"""

from __future__ import annotations

import math
from collections.abc import Collection
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from nebula3d.core import HKLVolume

__all__ = ["COMPONENTS", "DemoModel", "demo_volume"]

COMPONENTS: tuple[str, ...] = (
    "background", "sro", "tds", "rods", "bragg", "beam", "rings",
)

# Aluminium sample can: lattice parameter (Å) and the powder lines kept, with
# relative intensities of the Al powder pattern.
_AL_A = 4.0495
_AL_LINES: tuple[tuple[tuple[int, int, int], float], ...] = (
    ((1, 1, 1), 1.00), ((2, 0, 0), 0.47), ((2, 2, 0), 0.28), ((3, 1, 1), 0.30),
    ((2, 2, 2), 0.08), ((4, 0, 0), 0.04), ((3, 3, 1), 0.10), ((4, 2, 0), 0.10),
)


@dataclass(frozen=True)
class DemoModel:
    """Parameters of the synthetic crystal (intensities in data units)."""

    a: float = 4.2                    # cubic lattice parameter (Å)
    b_iso: float = 0.6                # Debye–Waller B (Å²): exp(-B Q² / 8π²)
    anion_ratio: float = 0.225        # f_anion / f_cation → |F_odd/F_even|² = 0.40
    # Smooth radial background: constant + low-|Q| rise + broad hump.
    bg_const: float = 0.035
    bg_lowq: float = 0.22
    bg_lowq_q: float = 0.7            # decay length (Å⁻¹)
    bg_hump: float = 0.04
    bg_hump_q: float = 2.1            # hump centre (Å⁻¹)
    bg_hump_w: float = 0.6            # hump σ (Å⁻¹)
    # Chemical SRO (Krivoglaz–Clapp–Moss): I ∝ 1 / (1 + ε V(k)).
    sro_amp: float = 0.06
    sro_v2: float = 0.30              # V2 / V1 (0 < V2/V1 < ½ puts the maxima at 1 ½ 0)
    sro_spinodal: float = 0.14        # 1 + ε V_min: smaller = stronger, sharper SRO
    # One-phonon TDS, nearest-neighbour central-force FCC.
    tds_amp: float = 0.010
    tds_gap: float = 0.02             # regularises D at the nodes (under the punch)
    # Rods along L at (h+½, k+½): in-plane Gaussian width (r.l.u.).
    rod_amp: float = 0.15
    rod_sigma: float = 0.10
    # Bragg peaks: height of an all-even reflection at |Q| → 0, and the
    # resolution σ (Å⁻¹) = sqrt(s0² + (coef·|Q|)²) radially / tangentially.
    bragg_height: float = 150.0
    bragg_s0: float = 0.028
    bragg_radial: float = 0.004       # Δd/d
    bragg_mosaic: float = 0.005       # rad
    # Incident-beam spot (height, σ in Å⁻¹) — sits inside the default beam punch.
    beam_height: float = 80.0
    beam_sigma: float = 0.045
    # Aluminium powder rings.
    ring_amp: float = 0.9
    ring_sigma: float = 0.022         # Å⁻¹
    ring_p2: float = 0.45             # texture: 1 + p2 P2(cos θ) + p4 P4(cos θ), θ from c*
    ring_p4: float = 0.15
    # Counting statistics: counts per unit intensity, plus a Gaussian residual.
    counts_per_unit: float = 600.0
    residual_noise: float = 0.006


def demo_volume(
    n: int = 161,
    *,
    extent: float = 4.0,
    seed: int = 0,
    components: Collection[str] = COMPONENTS,
    noise: bool = True,
    model: DemoModel | None = None,
    slab: int = 16,
) -> HKLVolume:
    """Build the synthetic demo volume on an ``n³`` grid over ±``extent`` r.l.u.

    Parameters
    ----------
    n:
        Grid points per axis.  With the default ``extent`` an odd ``n`` of the
        form ``8m + 1`` (161, 81, …) keeps every integer node on a voxel.
    extent:
        Half-width of the cube in r.l.u. (the same along H, K and L).
    seed:
        Seed for the counting noise.
    components:
        Any subset of :data:`COMPONENTS` — e.g. ``("sro",)`` with
        ``noise=False`` for the bare short-range-order signal.
    noise:
        Add Poisson counting noise and the Gaussian residual.  ``sigma`` is the
        matching error either way.
    model:
        Crystal / instrument parameters (default :class:`DemoModel`).
    slab:
        H planes computed per batch (bounds the temporaries).
    """
    m = model or DemoModel()
    parts = set(components)
    unknown = parts - set(COMPONENTS)
    if unknown:
        raise ValueError(f"unknown demo components: {sorted(unknown)}")
    if n < 2:
        raise ValueError("n must be at least 2")

    axis = np.linspace(-extent, extent, n)
    step = float(axis[1] - axis[0])
    rs = 2.0 * math.pi / m.a            # Å⁻¹ per r.l.u.
    box2 = (step * rs) ** 2 / 12.0      # voxel-averaging variance (Å⁻²)

    out = np.empty((n, n, n), dtype=np.float64)
    for i0 in range(0, n, slab):
        out[i0:i0 + slab] = _smooth_slab(axis[i0:i0 + slab], axis, parts, m, rs, step, box2)
    if "bragg" in parts:
        _add_bragg(out, axis, step, m, rs, box2)

    lam = np.clip(out, 0.0, None)
    tau = m.counts_per_unit
    sigma = np.sqrt(lam / tau + m.residual_noise ** 2)
    if noise:
        rng = np.random.default_rng(seed)
        data = rng.poisson(lam * tau).astype(np.float64)
        data /= tau
        data += m.residual_noise * rng.standard_normal(data.shape)
    else:
        data = out
    del lam, out

    return HKLVolume.from_arrays(
        data, (-extent, extent), (-extent, extent), (-extent, extent),
        sigma=sigma, ub_matrix=rs * np.eye(3, dtype=np.float64),
    )


def _smooth_slab(
    h: NDArray[np.float64], k: NDArray[np.float64], parts: set[str],
    m: DemoModel, rs: float, step: float, box2: float,
) -> NDArray[np.float64]:
    """Everything except the Bragg peaks, on the (len(h), len(k), len(k)) slab."""
    H = h[:, None, None]
    K = k[None, :, None]
    L = k[None, None, :]
    q2 = (rs * rs) * (H * H + K * K + L * L)
    q = np.sqrt(q2)
    dw = np.exp(-m.b_iso * q2 / (8.0 * math.pi ** 2))
    out = np.zeros(q.shape, dtype=np.float64)

    if "background" in parts:
        out += (m.bg_const + m.bg_lowq * np.exp(-q / m.bg_lowq_q)
                + m.bg_hump * np.exp(-((q - m.bg_hump_q) ** 2) / (2.0 * m.bg_hump_w ** 2)))

    if parts & {"sro", "tds"}:
        ch, ck, cl = np.cos(np.pi * H), np.cos(np.pi * K), np.cos(np.pi * L)
    if "sro" in parts:
        # V(k) = V1 Σ_⟨½½0⟩ cos 2πk·r + V2 Σ_⟨100⟩ cos 2πk·r, with V1 = 1.
        v = 4.0 * (ch * ck + ck * cl + ch * cl) + m.sro_v2 * 2.0 * (
            (2.0 * ch * ch - 1.0) + (2.0 * ck * ck - 1.0) + (2.0 * cl * cl - 1.0))
        v_min = -4.0 + 2.0 * m.sro_v2                    # at (1 ½ 0)
        eps = (1.0 - m.sro_spinodal) / -v_min
        out += m.sro_amp * dw / (1.0 + eps * v)
        del v
    if "tds" in parts:
        out += m.tds_amp * dw * _tds_quadratic_form(H, K, L, ch, ck, cl, m)

    if "rods" in parts:
        s2 = 2.0 * (m.rod_sigma ** 2 + step * step / 12.0)
        cols = np.arange(math.floor(k[0]) - 0.5, math.ceil(k[-1]) + 1.0, 1.0)
        gh = np.exp(-((h[:, None] - cols[None, :]) ** 2) / s2).sum(axis=1)
        gk = np.exp(-((k[:, None] - cols[None, :]) ** 2) / s2).sum(axis=1)
        out += m.rod_amp * gh[:, None, None] * gk[None, :, None] * dw

    if "beam" in parts:
        out += m.beam_height * np.exp(-q2 / (2.0 * (m.beam_sigma ** 2 + box2)))

    if "rings" in parts:
        c2 = np.divide(rs * L, q, out=np.zeros_like(q), where=q > 0) ** 2
        texture = (1.0 + m.ring_p2 * (1.5 * c2 - 0.5)
                   + m.ring_p4 * (35.0 * c2 * c2 - 30.0 * c2 + 3.0) / 8.0)
        s2 = 2.0 * (m.ring_sigma ** 2 + box2)
        rings = np.zeros_like(q)
        for hkl, rel in _AL_LINES:
            q_ring = 2.0 * math.pi * math.sqrt(sum(i * i for i in hkl)) / _AL_A
            rings += rel * np.exp(-((q - q_ring) ** 2) / s2)
        out += m.ring_amp * rings * texture * dw
    return out


def _tds_quadratic_form(
    H: NDArray, K: NDArray, L: NDArray,
    ch: NDArray, ck: NDArray, cl: NDArray, m: DemoModel,
) -> NDArray[np.float64]:
    """``|F|² · Q·D(Q)⁻¹·Q`` for the nearest-neighbour central-force FCC lattice.

    ``D_αβ = Σ_r r̂_α r̂_β (1 − cos 2πQ·r)`` over the 12 ⟨½ ½ 0⟩ neighbours,
    written with the sums of angles expanded (Q in r.l.u., the scale goes into
    ``tds_amp``).  ``D`` vanishes at every FCC node, so the form is the
    ~1/q² acoustic halo there; ``tds_gap`` keeps it finite.
    """
    sh, sk, sl = np.sin(np.pi * H), np.sin(np.pi * K), np.sin(np.pi * L)
    g = m.tds_gap
    dxx = 4.0 - 2.0 * ch * (ck + cl) + g
    dyy = 4.0 - 2.0 * ck * (ch + cl) + g
    dzz = 4.0 - 2.0 * cl * (ch + ck) + g
    dxy = 2.0 * sh * sk
    dxz = 2.0 * sh * sl
    dyz = 2.0 * sk * sl
    # Adjugate of the symmetric 3×3 D (inverse = adj / det).
    axx = dyy * dzz - dyz * dyz
    ayy = dxx * dzz - dxz * dxz
    azz = dxx * dyy - dxy * dxy
    axy = dxz * dyz - dxy * dzz
    axz = dxy * dyz - dyy * dxz
    ayz = dxy * dxz - dxx * dyz
    det = dxx * axx + dxy * axy + dxz * axz
    quad = (axx * H * H + ayy * K * K + azz * L * L
            + 2.0 * (axy * H * K + axz * H * L + ayz * K * L)) / det
    # In-phase acoustic motion scatters with the node's |F|²: interpolate it
    # smoothly (cos πh cos πk cos πl is +1 at all-even, −1 at all-odd nodes).
    r = m.anion_ratio
    return quad * (1.0 + r * r + 2.0 * r * ch * ck * cl) / (1.0 + r) ** 2


def _add_bragg(
    out: NDArray[np.float64], axis: NDArray[np.float64], step: float,
    m: DemoModel, rs: float, box2: float,
) -> None:
    """Add the FCC Bragg peaks in place, each on a small window around its node."""
    n = axis.size
    lo = axis[0]
    s_ref = m.bragg_s0 ** 2 + box2
    r = m.anion_ratio
    odd_fsq = ((1.0 - r) / (1.0 + r)) ** 2
    nodes = range(math.ceil(axis[0]), math.floor(axis[-1]) + 1)
    for ih in nodes:
        for ik in nodes:
            for il in nodes:
                parity = {ih % 2, ik % 2, il % 2}
                if len(parity) != 1 or ih == ik == il == 0:
                    continue  # FCC absence (mixed parity) / the origin (beam)
                g = rs * np.array([ih, ik, il], dtype=np.float64)
                qg = float(np.linalg.norm(g))
                s_rad = m.bragg_s0 ** 2 + (m.bragg_radial * qg) ** 2 + box2
                s_tan = m.bragg_s0 ** 2 + (m.bragg_mosaic * qg) ** 2 + box2
                fsq = odd_fsq if 1 in parity else 1.0
                # Integrated intensity ∝ |F|² e^{-2W}; the height follows the width.
                height = (m.bragg_height * fsq * math.exp(-m.b_iso * qg * qg / (8.0 * math.pi ** 2))
                          * s_ref ** 1.5 / math.sqrt(s_rad * s_tan * s_tan))
                half = math.ceil(4.5 * math.sqrt(max(s_rad, s_tan)) / (step * rs))
                win = []
                for c in (ih, ik, il):
                    i = round((c - lo) / step)
                    win.append(slice(max(i - half, 0), min(i + half + 1, n)))
                dh = rs * (axis[win[0]][:, None, None] - ih)
                dk = rs * (axis[win[1]][None, :, None] - ik)
                dl = rs * (axis[win[2]][None, None, :] - il)
                uh, uk, ul = g / qg
                along = dh * uh + dk * uk + dl * ul
                across2 = dh * dh + dk * dk + dl * dl - along * along
                out[tuple(win)] += height * np.exp(-0.5 * (along * along / s_rad + across2 / s_tan))
