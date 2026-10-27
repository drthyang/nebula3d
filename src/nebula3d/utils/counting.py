# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-han Yang

"""``np.bincount`` that runs in the browser's 32-bit WASM build too.

There ``intp`` is int32 and ``np.bincount`` casts its indices to ``intp`` by
the "safe" rule, so int64 indices raise ``TypeError: Cannot cast array data
from dtype('int64') to dtype('int32')``.  Every count in the package goes
through :func:`bincount`, which casts the indices to ``intp`` first (a no-op on
64-bit builds).
"""

from __future__ import annotations

from typing import Any

import numpy as np
from numpy.typing import ArrayLike, NDArray


def bincount(x: ArrayLike, weights: ArrayLike | None = None, minlength: int = 0) -> NDArray[Any]:
    """``np.bincount(x, weights, minlength)`` with ``x`` cast to ``intp``."""
    index = np.asarray(x)
    if index.dtype != np.intp:
        index = index.astype(np.intp, copy=False)
    if weights is None:
        return np.bincount(index, minlength=minlength)
    return np.bincount(index, weights=np.asarray(weights, dtype=np.float64), minlength=minlength)
