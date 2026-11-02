"""Synthetic volumes with the powder rings of library phases, for the phase
match's tests (``nebula3d.preprocessing.powder_phases``).

Each phase's lines come from the library: their positions at its room-
temperature cell divided by 1 + its lattice scale, their heights its neutron
intensities times an amount, each ring textured (± 30 % over the directions)
on a falling background with noise. Part of the sphere can be left unmeasured,
and anisotropic diffuse shells added (features of the crystal's own, which
rise in some directions only).
"""

from __future__ import annotations

import numpy as np

from nebula3d.core import HKLVolume
from nebula3d.preprocessing.powder_phases import load_library

_GAUSS_AREA = 0.5 * np.sqrt(np.pi / np.log(2.0))


def _peak(q, q0, fwhm):
    near = np.abs(q - q0) < 4.0 * fwhm
    out = np.zeros(q.shape, np.float32)
    out[near] = np.exp(-4.0 * np.log(2.0) * ((q[near] - q0) / fwhm) ** 2)
    return out


def ring_width(q):
    """The rings' FWHM at |Q| (Å⁻¹): wider at high |Q|, as on measured data."""
    return 0.07 + 0.004 * q


def phase_lines(phase_id, scale, q_max, amount):
    """(|Q|, height) of each line of a library phase at lattice ``scale``."""
    phase = load_library().get(phase_id)
    out = []
    for ln in phase.lines(q_max * (1.0 + abs(scale)) + 0.2):
        q = ln.q / (1.0 + scale)
        if q <= q_max:
            out.append((q, amount * ln.intensity / (_GAUSS_AREA * ring_width(q))))
    return out


def phase_volume(phases, *, seed=0, extent=7.2, step=0.09, noise=0.1, partial=True,
                 diffuse=(), extra=()):
    """A volume with the rings of ``phases`` ({id: (scale, amount)}), its
    noise, the half-sphere beyond 5.5 Å⁻¹ unmeasured (``partial``), the
    anisotropic diffuse shells ``diffuse`` ((|Q|, height), present where
    cos 2φ > 0), and ``extra`` rings of no library phase ((|Q|, height)).
    Returns the volume and its rings alone."""
    ax = np.arange(-extent, extent + 1e-9, step)
    qx, qy, qz = ax[:, None, None], ax[None, :, None], ax[None, None, :]
    q = np.sqrt(qx ** 2 + qy ** 2 + qz ** 2)
    with np.errstate(invalid="ignore", divide="ignore"):
        nz = np.nan_to_num(np.broadcast_to(qz / q, q.shape))
        phi = np.arctan2(np.broadcast_to(qy, q.shape), np.broadcast_to(qx, q.shape))
    texture = (1.0 + 0.3 * (1.5 * nz ** 2 - 0.5)).astype(np.float32)
    rings = np.zeros(q.shape, np.float32)
    for pid, (scale, amount) in phases.items():
        for q0, height in phase_lines(pid, scale, extent * 1.05, amount):
            if height > 1e-4:
                rings += height * texture * _peak(q, q0, ring_width(q0))
    for q0, height in extra:
        rings += height * texture * _peak(q, q0, ring_width(q0))
    feat = np.zeros(q.shape, np.float32)
    lobe = np.clip(np.cos(2.0 * phi), 0.0, None).astype(np.float32)
    for q0, height in diffuse:
        feat += height * lobe * _peak(q, q0, ring_width(q0))
    rng = np.random.default_rng(seed)
    data = ((1.0 + 2.0 * np.exp(-q / 3.0)).astype(np.float32) + rings + feat
            + rng.normal(0.0, noise, q.shape).astype(np.float32))
    vol = HKLVolume.from_arrays(data, (-extent, extent), (-extent, extent), (-extent, extent),
                                ub_matrix=np.eye(3))
    if partial:
        vol.mask[...] = (q < 5.5) | (np.broadcast_to(qz, q.shape) > -0.3)
    return vol, rings
