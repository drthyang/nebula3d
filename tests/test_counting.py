"""``bincount`` runs where ``intp`` is int32 (the browser's WASM build).

There ``np.bincount`` casts its indices to ``intp`` by the "safe" rule, so int64
indices raised ``TypeError: Cannot cast array data from dtype('int64') to
dtype('int32')`` — in ``q_coverage`` behind the Pilot's ``qmax_coverage``, and
anywhere else an index array was int64.  These tests stand in a 32-bit numpy
for the helper and keep every count in the package going through it.
"""

import re
import types
from pathlib import Path

import numpy as np
import pytest

import nebula3d.utils.counting as counting
from nebula3d.utils.counting import bincount

SRC = Path(__file__).resolve().parents[1] / "src" / "nebula3d"


def _wasm32_numpy() -> types.SimpleNamespace:
    """numpy as the 32-bit build behaves: intp is int32, and bincount refuses
    indices it cannot cast to int32 safely."""

    def strict_bincount(x, weights=None, minlength=0):
        x = np.asarray(x)
        if not np.can_cast(x.dtype, np.int32, casting="safe"):
            raise TypeError(
                f"Cannot cast array data from dtype('{x.dtype}') to dtype('int32')"
                " according to the rule 'safe'"
            )
        return np.bincount(x, weights=weights, minlength=minlength)

    return types.SimpleNamespace(**{**vars(np), "intp": np.int32, "bincount": strict_bincount})


@pytest.fixture
def wasm32(monkeypatch):
    monkeypatch.setattr(counting, "np", _wasm32_numpy())


def test_the_stand_in_refuses_int64_as_the_browser_did(wasm32):
    with pytest.raises(TypeError, match="int64"):
        counting.np.bincount(np.array([0, 1, 1], dtype=np.int64))


@pytest.mark.parametrize("dtype", [np.int64, np.uint32, np.int32, np.uint8, np.bool_])
def test_counts_any_index_dtype_on_32_bit(wasm32, dtype):
    x = np.array([0, 1, 1, 3] if dtype is not np.bool_ else [0, 1, 1, 0], dtype=dtype)
    expected = np.bincount(x.astype(np.int64), minlength=5)
    np.testing.assert_array_equal(bincount(x, minlength=5), expected)


def test_weights_and_minlength_pass_through(wasm32):
    x = np.array([2, 0, 2], dtype=np.int64)
    counts = bincount(x, weights=[1.0, 0.5, 2.0], minlength=4)
    np.testing.assert_allclose(counts, [0.5, 0.0, 3.0, 0.0])


def test_q_coverage_runs_on_32_bit(wasm32):
    from nebula3d.analysis.coverage import q_coverage
    from nebula3d.demo import demo_volume

    cov = q_coverage(demo_volume(41, seed=0))
    assert cov.q.size > 0 and np.all((cov.counted >= 0) & (cov.counted <= 1))


def test_every_count_in_the_package_goes_through_the_helper():
    raw = re.compile(r"(?<![\w`])np\.bincount\(")
    offenders = [
        f"{p.relative_to(SRC)}:{i}"
        for p in SRC.rglob("*.py")
        if p.name != "counting.py"
        for i, line in enumerate(p.read_text().splitlines(), 1)
        if raw.search(line)
    ]
    assert not offenders, f"use nebula3d.utils.counting.bincount, not np.bincount: {offenders}"
