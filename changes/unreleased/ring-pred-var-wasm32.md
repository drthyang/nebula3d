- **Fixed: ring removal failed in the browser on large shells** with
  "ValueError: iterator is too large". The ring model's uncertainty, b·C·b
  per voxel, used a three-operand `einsum` that iterates rows × terms² at
  once, past the 32-bit WASM build's 2³¹ limit. It is now computed a chunk of
  rows at a time, with the same numbers and a bounded temporary.
