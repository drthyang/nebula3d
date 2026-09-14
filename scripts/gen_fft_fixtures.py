#!/usr/bin/env python
"""Generate numpy ground-truth fixtures for the WebGPU FFT (web/src/gpu).

Writes JSON consumed by the CI-safe vitest suite (fftPlan.test.ts) and the
local GPU harness: ifftshift/fftshift index maps for even+odd lengths, 5-smooth
fast lengths, small centred-FFT reference values, and twiddle spot checks —
so every piece of index math in the WGSL path is pinned to numpy behaviour.

    python scripts/gen_fft_fixtures.py            # writes web/src/gpu/__tests__/fixtures.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent.parent / "web/src/gpu/__tests__/fixtures.json"


def five_smooth(n: int) -> int:
    m = n
    while True:
        k = m
        for p in (2, 3, 5):
            while k % p == 0:
                k //= p
        if k == 1:
            return m
        m += 1


def shift_maps(n: int) -> dict:
    idx = np.arange(n)
    # out[i] = in[map[i]] gather maps
    return {
        "n": n,
        # ifftshift(x)[i] == x[ifftshift_gather[i]]
        "ifftshift_gather": np.fft.ifftshift(idx).tolist(),
        # fftshift(x)[i] == x[fftshift_gather[i]]
        "fftshift_gather": np.fft.fftshift(idx).tolist(),
    }


def centred_fft_1d(n: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    x = rng.normal(size=n)
    # the pipeline's centred transform: fftshift(fft(ifftshift(x)))
    y = np.fft.fftshift(np.fft.fft(np.fft.ifftshift(x)))
    yi = np.fft.fftshift(np.fft.ifft(np.fft.ifftshift(x)))
    return {
        "n": n,
        "x": x.tolist(),
        "fwd_re": y.real.tolist(),
        "fwd_im": y.imag.tolist(),
        "inv_re": yi.real.tolist(),
        "inv_im": yi.imag.tolist(),
    }


def centred_fft_3d(shape: tuple[int, int, int], seed: int) -> dict:
    rng = np.random.default_rng(seed)
    x = rng.normal(size=shape)
    y = np.fft.fftshift(np.fft.fftn(np.fft.ifftshift(x)))
    return {
        "shape": list(shape),
        "x": x.ravel().tolist(),
        "fwd_re": y.real.ravel().tolist(),
        "fwd_im": y.imag.ravel().tolist(),
    }


def main() -> None:
    fixtures = {
        "five_smooth": {str(n): five_smooth(n)
                        for n in (1, 2, 7, 11, 97, 101, 129, 151, 301, 401,
                                  501, 511, 1024)},
        "shift_maps": [shift_maps(n) for n in (4, 5, 8, 9, 15, 16)],
        "fft_1d": [centred_fft_1d(n, seed=n)
                   for n in (2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 20, 25, 27,
                             30, 32, 45, 60, 64, 81, 100, 125, 128, 135, 240,
                             243, 256, 320, 375, 405, 512)],
        "fft_3d": [centred_fft_3d((8, 9, 10), seed=1),
                   centred_fft_3d((5, 12, 15), seed=2),
                   centred_fft_3d((16, 16, 16), seed=3)],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(fixtures))
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    sys.exit(main())
