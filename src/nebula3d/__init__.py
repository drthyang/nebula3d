# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""nebula3d — 3D diffuse-scattering processing toolkit.

Input: symmetrized 3D HKL volume (e.g. from Mantid).

Pipeline
--------
Current diffuse workflow:
    (1) powder-ring subtraction
    (2) Bragg/satellite punch
    (3) Bragg-hole backfill
    (4) radial-background flatten
    (5) 3D-ΔPDF transform
    (6) back-FFT consistency check
"""

from typing import TYPE_CHECKING

from nebula3d import analysis, inpainting, preprocessing, utils
from nebula3d._version import __version__
from nebula3d.core import HKLVolume
from nebula3d.io.hkl_reader import load, save
from nebula3d.io.mantid_nxs import is_mantid_nxs, load_mantid_nxs

if TYPE_CHECKING:
    from nebula3d import visualization

__all__ = [
    "__version__",
    "HKLVolume",
    "load",
    "save",
    "load_mantid_nxs",
    "is_mantid_nxs",
    "preprocessing",
    "analysis",
    "inpainting",
    "utils",
    "visualization",
]


def __getattr__(name: str):  # noqa: ANN202 - PEP 562 lazy submodule import
    """Lazy ``nebula3d.visualization`` (PEP 562): it imports matplotlib, which
    the browser ring workers (``nebula3d.ringworker``) neither need nor load —
    keeping their Pyodide boot to the numeric stack.  Everything else about
    ``import nebula3d; nebula3d.visualization`` is unchanged."""
    if name == "visualization":
        import importlib

        module = importlib.import_module("nebula3d.visualization")
        globals()[name] = module
        return module
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
