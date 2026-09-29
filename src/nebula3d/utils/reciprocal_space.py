# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Reciprocal-space utility functions."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray


def ub_from_lattice(
    a: float, b: float, c: float,
    alpha: float = 90.0, beta: float = 90.0, gamma: float = 90.0,
) -> NDArray[np.float64]:
    """Construct a UB matrix (in Å^-1) for any lattice, triclinic included.

    The B matrix is the Busing–Levy (1967) matrix; U is the identity (a* along
    x, b* in the xy plane).  Inverse of :func:`direct_cell`.

    Parameters
    ----------
    a, b, c:
        Direct-lattice parameters in Å.
    alpha, beta, gamma:
        Direct-lattice angles in degrees.

    Returns
    -------
    UB:
        (3, 3) matrix in Å^-1. Column j is the j-th reciprocal basis vector.
    """
    alpha_r, beta_r, gamma_r = np.radians([alpha, beta, gamma])
    ca, cb, cg = np.cos([alpha_r, beta_r, gamma_r])
    sa, sb, sg = np.sin([alpha_r, beta_r, gamma_r])
    V = a * b * c * np.sqrt(1 - ca**2 - cb**2 - cg**2 + 2 * ca * cb * cg)
    # reciprocal lattice parameters (crystallographic, 1/d)
    b_star = a * c * sb / V
    c_star = a * b * sg / V
    a_star = b * c * sa / V
    cos_beta_star = (ca * cg - cb) / (sa * sg)
    cos_gamma_star = (ca * cb - cg) / (sa * sb)
    sin_beta_star = np.sqrt(1 - cos_beta_star**2)
    sin_gamma_star = np.sqrt(1 - cos_gamma_star**2)
    B = np.array([
        [a_star, b_star * cos_gamma_star, c_star * cos_beta_star],
        [0.0,    b_star * sin_gamma_star, -c_star * sin_beta_star * ca],
        [0.0,    0.0,                     1.0 / c],
    ], dtype=np.float64)
    # Multiply by 2π (physics convention Q = 2π/d)
    return 2 * np.pi * B


def direct_cell(
    ub_matrix: NDArray[np.float64],
) -> tuple[float, float, float, float, float, float]:
    """Direct-lattice ``(a, b, c, α, β, γ)`` in Å and degrees from a UB matrix.

    ``ub_matrix`` is physics-convention (columns = a*, b*, c* in Å⁻¹, Q = 2π/d);
    the direct basis is ``2π·inv(UB)ᵀ``.  The orientation U drops out: only
    lengths and angles are returned.  Raises ``LinAlgError`` for a singular UB.
    """
    direct = 2 * np.pi * np.linalg.inv(np.asarray(ub_matrix, dtype=np.float64)).T
    vecs = direct.T  # rows a, b, c
    lengths = np.linalg.norm(vecs, axis=1)

    def angle(i: int, j: int) -> float:
        cos = float(vecs[i] @ vecs[j]) / float(lengths[i] * lengths[j])
        return float(np.degrees(np.arccos(np.clip(cos, -1.0, 1.0))))

    a, b, c = (float(v) for v in lengths)
    return a, b, c, angle(1, 2), angle(0, 2), angle(0, 1)


def d_spacing(h: int, k: int, l: int, a: float, b: float, c: float) -> float:
    """Return d-spacing (Å) for (hkl) in an orthorhombic lattice."""
    return 1.0 / np.sqrt((h / a) ** 2 + (k / b) ** 2 + (l / c) ** 2)


def q_to_hkl(
    q_cart: NDArray[np.float64],
    ub_matrix: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Convert Cartesian Q-vector(s) in Å^-1 to fractional HKL.

    Parameters
    ----------
    q_cart:
        Array of shape (..., 3) in Å^-1.
    ub_matrix:
        (3, 3) UB matrix (columns = reciprocal basis vectors × 2π).

    Returns
    -------
    hkl:
        Array of shape (..., 3).
    """
    return q_cart @ np.linalg.inv(ub_matrix).T
