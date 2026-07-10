# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""Data processing pipeline.

Input: symmetrised 3D HKL volume from Mantid.

The Ring Removal 2.0 path (``fit_global_rings``) works directly on sample data:
it identifies narrow persistent spherical shells, fits a full 3D angular field,
and subtracts conservatively with uncertainty. An empty-environment scan is not
required and is not assumed to contain the sample holder.

The earlier empty-subtraction, per-slice patched/parametric, masking, and backfill
components remain public for comparison and specialized workflows.
"""

from nebula3d.preprocessing.backfill import backfill_ring_shells
from nebula3d.preprocessing.empty_subtraction import EmptySubtractor
from nebula3d.preprocessing.global_rings import (
    AluminumLine,
    GlobalRingConfig,
    GlobalRingDiagnostics,
    GlobalRingResult,
    GlobalRingShell,
    aluminum_fcc_lines,
    fit_global_rings,
    write_global_ring_diagnostics,
)
from nebula3d.preprocessing.parametric_ring import (
    FittedParametricRingModel,
    ParametricRing,
    ParametricRingModel,
)
from nebula3d.preprocessing.powder_rings import (
    RingProfile,
    RingShell,
    al_ring_q_positions,
    detect_ring_shells,
    fit_ring_profiles,
    line_profile,
    mask_ring_shells,
    radial_profile,
)
from nebula3d.preprocessing.radial_background import (
    PatchedRadialRingModel,
    RadialRingProfiles,
    confirm_ring_shells_across_h,
)
from nebula3d.preprocessing.radial_flatten import (
    RadialFlattenResult,
    flatten_radial_background,
)
from nebula3d.preprocessing.ring_model import FittedRingModel, PatchedRingModel, RingParams
from nebula3d.preprocessing.sampling import azimuthal_sampling_mask

__all__ = [
    # Primary pipeline
    "EmptySubtractor",
    "GlobalRingConfig",
    "GlobalRingDiagnostics",
    "GlobalRingResult",
    "GlobalRingShell",
    "AluminumLine",
    "fit_global_rings",
    "aluminum_fcc_lines",
    "write_global_ring_diagnostics",
    "PatchedRingModel",
    "RingParams",
    "FittedRingModel",
    "PatchedRadialRingModel",
    "RadialRingProfiles",
    "ParametricRingModel",
    "ParametricRing",
    "FittedParametricRingModel",
    "confirm_ring_shells_across_h",
    "flatten_radial_background",
    "RadialFlattenResult",
    "azimuthal_sampling_mask",
    "backfill_ring_shells",
    # Utilities / diagnostics
    "RingShell",
    "RingProfile",
    "detect_ring_shells",
    "mask_ring_shells",
    "radial_profile",
    "line_profile",
    "fit_ring_profiles",
    "al_ring_q_positions",
]
