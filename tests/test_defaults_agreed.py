"""The page's, the pipeline's and the package's defaults agree, or differ on
purpose (AGENT_PLAN 4.12, decided 2026-10-19)."""

from __future__ import annotations

import inspect
import re
from pathlib import Path

import numpy as np

from nebula3d._ringplane import RingParams
from nebula3d.analysis.delta_pdf import _prepare_forward, compute_delta_pdf
from nebula3d.core import HKLVolume
from nebula3d.pipeline import DeltaPdfParams

WEB = Path(__file__).resolve().parents[1] / "web" / "src"

# compute_delta_pdf's keywords that DeltaPdfParams carries under the same name.
# The pipeline passes window_support as the volume's mask, which the function
# cannot default to, so it is not here.
SHARED = ("apodization", "gaussian_sigma", "zero_pad", "subtract_mean",
          "crop_hkl", "q_band", "subtract_smooth_bg", "window_shape")


def _defaults(fn) -> dict[str, object]:
    return {k: v.default for k, v in inspect.signature(fn).parameters.items()
            if v.default is not inspect.Parameter.empty}


def test_compute_delta_pdf_defaults_are_the_pipelines():
    params = DeltaPdfParams()
    for fn in (compute_delta_pdf, _prepare_forward):
        got = _defaults(fn)
        for name in SHARED:
            assert got[name] == getattr(params, name), (fn.__name__, name)


def test_a_call_with_no_window_transforms_as_the_pipelines_stage():
    rng = np.random.default_rng(0)
    ax = np.linspace(-2.0, 2.0, 17)
    data = rng.normal(size=(17, 17, 17))
    vol = HKLVolume(data=data, sigma=np.zeros_like(data),
                    mask=np.ones(data.shape, dtype=bool),
                    h_axis=ax, k_axis=ax, l_axis=ax, ub_matrix=np.eye(3))
    p = DeltaPdfParams()
    bare = compute_delta_pdf(vol)
    piped = compute_delta_pdf(vol, apodization=p.apodization,  # type: ignore[arg-type]
                              gaussian_sigma=p.gaussian_sigma)
    hann = compute_delta_pdf(vol, apodization="hann", gaussian_sigma=0.5)
    np.testing.assert_array_equal(bare.data, piped.data)
    assert not np.allclose(bare.data, hann.data)


def _ts_default(path: Path, pattern: str) -> str:
    m = re.search(pattern, path.read_text(), re.S)
    assert m, f"{pattern!r} not found in {path}"
    return m.group(1)


def test_ring_texture_order_is_8_on_the_page_and_6_in_the_package():
    # Kept apart on purpose: each default runs on its own path, and neither
    # reaches the default ring model, which has no texture order.
    assert RingParams().n_fourier == 6
    assert RingParams().ring_model == "pooled"
    store = _ts_default(WEB / "state" / "pipelineStore.ts", r'ringNFourier: "(\d+)"')
    catalog = WEB / "llm" / "tune" / "catalog.ts"
    entry = _ts_default(catalog, r'key: "ringNFourier",(.*?)\n  \}')
    assert store == "8"
    assert re.search(r"defaultValue: 8,", entry)
    assert 'appliesWhen: (s) => s.ringModel === "patched" || s.ringModel === "parametric"' in entry
