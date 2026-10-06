# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Magnetic form factors of common ions, in the dipole approximation.

The radial-background flatten fits ``const + c·F(Q)²`` to the isotropic
pedestal: ``F(Q)²`` is the shape of the single-ion (self) paramagnetic
scattering, which in the ΔPDF sits at r ≈ 0 only (see
:mod:`nebula3d.preprocessing.radial_flatten`).

``⟨j_l⟩`` use the analytic approximation of P. J. Brown, *International Tables
for Crystallography* Vol. C, §4.4.5, with ``s = Q / 4π`` (Å⁻¹)::

    ⟨j0⟩ = A e^(−a s²) + B e^(−b s²) + C e^(−c s²) + D
    ⟨j2⟩ = (A e^(−a s²) + B e^(−b s²) + C e^(−c s²) + D) · s²

and the dipole form factor is ``F = ⟨j0⟩ + (2/g − 1)⟨j2⟩`` with the Landé
``g`` (Lovesey eq. 11.110 with the free-ion Landé g; for spin-only 3d ions
``g = 2`` and the ⟨j2⟩ term drops).  The coefficients were cross-checked
against Mantid's ``MagneticIon`` table; ``F(0) = ⟨j0⟩(0) = 1`` to the table's
rounding (tested).
"""

from __future__ import annotations

from typing import NamedTuple

import numpy as np
from numpy.typing import ArrayLike, NDArray


class _Ion(NamedTuple):
    g: float                                                  # Landé g
    j0: tuple[float, float, float, float, float, float, float]  # A a B b C c D
    j2: tuple[float, float, float, float, float, float, float]


#: Ions with tabulated ⟨j0⟩, ⟨j2⟩ (International Tables C §4.4.5).
IONS: dict[str, _Ion] = {
    # 3d transition-metal ions (spin-only, g = 2)
    "Ti3+": _Ion(2.0, (0.3571, 22.841, 0.6688, 8.931, -0.0354, 0.483, 0.0099),
                 (3.3717, 14.444, 1.8258, 5.713, 0.247, 2.265, 0.0005)),
    "V3+": _Ion(2.0, (0.3598, 19.336, 0.6632, 7.617, -0.3064, 0.03, 0.2835),
                (2.3005, 14.682, 2.0364, 6.13, 0.4099, 2.382, 0.0014)),
    "V4+": _Ion(2.0, (0.3106, 16.816, 0.7198, 7.049, -0.0521, 0.302, 0.0221),
                (1.8377, 12.267, 1.8247, 5.458, 0.3979, 2.248, 0.0012)),
    "Cr3+": _Ion(2.0, (-0.3094, 0.027, 0.368, 17.035, 0.6559, 6.524, 0.2856),
                 (1.6262, 15.066, 2.0618, 6.284, 0.5281, 2.368, 0.0023)),
    "Mn2+": _Ion(2.0, (0.422, 17.684, 0.5948, 6.005, 0.0043, -0.609, -0.0219),
                 (2.0515, 15.556, 1.8841, 6.063, 0.4787, 2.232, 0.0027)),
    "Mn3+": _Ion(2.0, (0.4198, 14.283, 0.6054, 5.469, 0.9241, -0.009, -0.9498),
                 (1.2427, 14.997, 1.9567, 6.118, 0.5732, 2.258, 0.0031)),
    "Mn4+": _Ion(2.0, (0.376, 12.566, 0.6602, 5.133, -0.0372, 0.563, 0.0011),
                 (0.7879, 13.886, 1.8717, 5.743, 0.5981, 2.182, 0.0034)),
    "Fe2+": _Ion(2.0, (0.0263, 34.96, 0.3668, 15.943, 0.6188, 5.594, -0.0119),
                 (1.649, 16.559, 1.9064, 6.133, 0.5206, 2.137, 0.0035)),
    "Fe3+": _Ion(2.0, (0.3972, 13.244, 0.6295, 4.903, -0.0314, 0.35, 0.0044),
                 (1.3602, 11.998, 1.5188, 5.003, 0.4705, 1.991, 0.0038)),
    "Co2+": _Ion(2.0, (0.4332, 14.355, 0.5857, 4.608, -0.0382, 0.134, 0.0179),
                 (1.9049, 11.644, 1.3159, 4.357, 0.3146, 1.645, 0.0017)),
    "Co3+": _Ion(2.0, (0.3902, 12.508, 0.6324, 4.457, -0.15, 0.034, 0.1272),
                 (1.7058, 8.859, 1.1409, 3.309, 0.1474, 1.09, -0.0025)),
    "Ni2+": _Ion(2.0, (0.0163, 35.883, 0.3916, 13.223, 0.6052, 4.339, -0.0133),
                 (1.708, 11.016, 1.2147, 4.103, 0.315, 1.533, 0.0018)),
    "Ni3+": _Ion(2.0, (0.0012, 35.0, 0.3468, 11.987, 0.6667, 4.252, -0.0148),
                 (1.4683, 8.671, 0.1794, 1.106, 1.1068, 3.257, -0.0023)),
    "Cu2+": _Ion(2.0, (0.0232, 34.969, 0.4023, 11.564, 0.5882, 3.843, -0.0137),
                 (1.5189, 10.478, 1.1512, 3.813, 0.2918, 1.398, 0.0017)),
    # rare-earth ions (free-ion Landé g_J)
    "Pr3+": _Ion(4 / 5, (0.0504, 24.9989, 0.2572, 12.0377, 0.7142, 5.0039, -0.0219),
                 (0.8734, 18.9876, 1.5594, 6.0872, 0.8142, 2.415, 0.0111)),
    "Nd3+": _Ion(8 / 11, (0.054, 25.029, 0.3101, 12.102, 0.6575, 4.722, -0.0216),
                 (0.6751, 18.342, 1.6272, 7.26, 0.9644, 2.602, 0.015)),
    "Gd3+": _Ion(2.0, (0.0186, 25.387, 0.2895, 11.142, 0.7135, 3.752, -0.0217),
                 (0.3347, 18.476, 1.2465, 6.877, 0.9537, 2.318, 0.0217)),
    "Tb3+": _Ion(3 / 2, (0.0177, 25.51, 0.2921, 10.577, 0.7133, 3.512, -0.0231),
                 (0.2892, 18.497, 1.1678, 6.797, 0.9437, 2.257, 0.0232)),
    "Dy3+": _Ion(4 / 3, (0.1157, 15.073, 0.327, 6.799, 0.5821, 3.02, -0.0249),
                 (0.2523, 18.517, 1.0914, 6.736, 0.9345, 2.208, 0.025)),
    "Ho3+": _Ion(5 / 4, (0.0566, 18.318, 0.3365, 7.688, 0.6317, 2.943, -0.0248),
                 (0.2188, 18.516, 1.024, 6.707, 0.9251, 2.161, 0.0268)),
    "Er3+": _Ion(6 / 5, (0.0586, 17.98, 0.354, 7.096, 0.6126, 2.748, -0.0251),
                 (0.171, 18.534, 0.9879, 6.625, 0.9044, 2.1, 0.0278)),
    "Tm3+": _Ion(7 / 6, (0.0581, 15.092, 0.2787, 7.801, 0.6854, 2.793, -0.0224),
                 (0.176, 18.542, 0.9105, 6.579, 0.897, 2.062, 0.0294)),
    "Yb3+": _Ion(8 / 7, (0.0416, 16.095, 0.2849, 7.834, 0.6961, 2.672, -0.0229),
                 (0.157, 18.555, 0.8484, 6.54, 0.888, 2.037, 0.0318)),
}


def ion_key(ion: str | None) -> str | None:
    """Canonical table key for *ion* (``'Tb3+'``, ``'tb3'``, ``'Tb^3+'`` → ``'Tb3+'``).

    ``None``, ``''`` and ``'none'`` mean no magnetic ion (→ ``None``).
    Raises ``ValueError`` for an ion not in :data:`IONS`.
    """
    if ion is None:
        return None
    name = ion.strip().replace("^", "").rstrip("+")
    if name.lower() in ("", "none"):
        return None
    key = name[:1].upper() + name[1:].lower() + "+"
    if key not in IONS:
        raise ValueError(f"No form factor for ion {ion!r}; choose one of "
                         f"{sorted(IONS)} or 'none'.")
    return key


def _jl(coef: tuple[float, ...], s2: NDArray[np.float64]) -> NDArray[np.float64]:
    a_, a, b_, b, c_, c, d = coef
    return a_ * np.exp(-a * s2) + b_ * np.exp(-b * s2) + c_ * np.exp(-c * s2) + d


def magnetic_form_factor(q: ArrayLike, ion: str) -> NDArray[np.float64]:
    """Dipole-approximation magnetic form factor ``F(|Q|)`` of *ion* (``F(0) = 1``).

    *q* is |Q| in Å⁻¹.
    """
    key = ion_key(ion)
    if key is None:
        raise ValueError("magnetic_form_factor needs an ion, not 'none'.")
    p = IONS[key]
    s2 = (np.asarray(q, dtype=np.float64) / (4.0 * np.pi)) ** 2
    return _jl(p.j0, s2) + (2.0 / p.g - 1.0) * _jl(p.j2, s2) * s2
