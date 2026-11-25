- **Fix: the global ring model could run the in-browser engine out of memory.**
  Its radial profile copied every valid voxel twice and was made with the
  model's two volume-sized accumulators already allocated, and each shell's
  harmonic basis was held twice while it was built. In real Pyodide the model
  peaked at 3.6 GiB on a 48.6 M-voxel synthetic volume and ran out of memory
  (`MemoryError` at the 4 GiB heap) at the 64.5 M voxels the size gate
  admits. The copies are gone, the accumulators come after the profile and
  the basis is written in place: the stage's traced peak falls from about 74
  to 49 bytes per voxel, and the 64.5 M-voxel run completes at 3.1 to 3.3 GiB.
  Every output is bit-identical (the default pooled model and the parametric
  and patched ones share the profile and are unchanged too).
- **The 32-bit check (THY-51).** The package now runs in real Pyodide 0.27.7
  under Node (`scripts/wasm32/`, docs/development.md): the test suite, and the
  bridge's stages and analysis calls on the synthetic demo at a measured
  volume's size. On wasm32 the whole suite shows no 32-bit numpy failure, and
  the default chain peaks at 2.8 GiB at 401³. `tests/test_wasm32_patterns.py`
  lists every call that fails only on 32-bit numpy (an int64 or uint32 index
  into `bincount`, `take`, `repeat`, `put`, `choose` or `reduceat`; an einsum
  over three or more operands) with the reason it is safe, so a new one is
  checked before it reaches the browser.
