# Inpainting Methods

## Overview

After masking contaminated voxels (Bragg punches, or ring shells when radial
interpolation cannot fill them) we need to reconstruct physically reasonable
intensities. Several complementary strategies are implemented, combined in a pipeline.

> **Scope.** This pipeline is the **general-purpose** inpainter. The current
> real-data Bragg workflow uses `backfill_bragg(method="local")` (default) or
> `method="laplace"` before falling back to TV/symmetry methods. Powder-ring shells
> are filled first by `backfill_ring_shells`, which interpolates radially across
> the thin shell from uncontaminated neighbours (see
> [powder_rings.md](powder_rings.md)). Symmetry averaging is **not** used for ring
> removal, because the Laue equivalents of a ring voxel lie on the same ring and
> are equally contaminated.

---

## 1. Symmetry-based averaging

**Principle:** In a single crystal the diffuse scattering respects the Laue symmetry of
the crystal. Symmetry-related voxels at **g** and **Rg** (R ∈ Laue group) should have
equal intensity. If a masked voxel has one or more unmasked symmetry equivalents, we
fill it by weighted averaging.

**Weight:** inverse-variance weighting (w = 1/σ²), so high-count equivalents dominate.

**Strengths:** exact, no smoothing, preserves all features present in the data.

**Limitations:** fails for high-multiplicity mask positions where all equivalents are also
masked (e.g., along a symmetry axis coinciding with a powder ring).

---

## 2. Total-Variation (TV) inpainting (secondary)

**Formulation:**

```
min_{u}  (1/2) ||W(u − f)||²  +  λ ||∇u||₁
```

- **f** = observed data (zero / arbitrary in masked region)
- **W** = diagonal mask (1 for valid, 0 for masked)
- **∇u** = 3D forward finite difference gradient
- **λ** = regularisation parameter (default 0.1)

**Algorithm:** Chambolle–Pock primal-dual (τσ = 1/6, projection onto ℓ∞ ball).

**Why TV?** TV allows the reconstruction to be piecewise smooth — it preserves sharp
features (streaks, sheets of diffuse intensity) while suppressing noise. This is
physically appropriate because diffuse scattering can be anisotropic and structured.

**Parameter tuning:**
- λ ≪ 1 → closer to data fidelity (noisy interpolation)
- λ ≫ 1 → over-smoothed
- Start with λ = 0.1; increase if filled region looks speckled.

---

## 3. RBF interpolation (fallback)

**Method:** `scipy.interpolate.RBFInterpolator` with thin-plate-spline kernel and
k-nearest-neighbour support.

**Use case:** small isolated masks in low-symmetry regions where TV may be slow.

---

## 4. Biharmonic relaxation

Iterative solution of ∇⁴u = 0 inside the mask. Produces very smooth fills, appropriate
for broad, diffuse backgrounds. Slower than TV for large masks.

---

## General fallback pipeline: `"symmetry+tv"`

1. Symmetry equivalents fill as many masked voxels as possible.
2. Remaining unfilled voxels are passed to TV inpainting.
3. Output includes a `filled_flag` channel marking reconstructed voxels.

## Real-data Bragg backfill

For Bragg-punched volumes, prefer the dedicated wrapper:

```python
from nebula3d.analysis import backfill_bragg

filled = backfill_bragg(punched)                    # method="local"
filled = backfill_bragg(punched, method="laplace")  # smooth harmonic fill
```

Both fill each hole from the diffuse around it, while the direct beam keeps its
special just-outside-`|Q|` fill. `method="local"` uses the median of the hole's
own dilated shell. `method="laplace"` solves the discrete Laplace equation in
every hole (a sparse block-diagonal system, one block per hole, solved in
batches of whole blocks by Jacobi-preconditioned CG so memory stays bounded),
with its Dirichlet boundary `laplace_gap` voxels outside the punch so Bragg
tails leaking past the punch edge do not pull the fill up. A single masked
region past `laplace_max_unknowns` (default 2 M) is an unmeasured coverage gap
rather than a punch — loaders zero and mask those — and gets the `local` fill.

Pass `punched=` (the voxels the punch removed; the pipeline's punch stage
records them, in memory and as `/entry/punched` in the punch artifact) so a
hole and the unmeasured coverage it touches stay apart. Without it every masked
voxel is a hole: a hole touching coverage merges with it, and the whole region
gets one value set by the coverage's rim — on the 64.5 M-voxel Fe3Ge2 TOPAZ
volume that was 82 % of the punched voxels. With it each hole is filled only
from the measured voxels around it (unmeasured neighbours are a free, Neumann
boundary for `laplace`), and the coverage is filled afterwards with its own
shell median.

The pipeline also trims the edge of the measured coverage when it loads the raw
input (`PipelineParams.edge_trim`, default 1 voxel layer;
`nebula3d.preprocessing.trim_coverage_edge`). A measured voxel next to
unmeasured space is barely normalised: on the Fe3Ge2 volume those voxels reach
p99 ≈ 4,000 and a maximum of 5.5·10⁷, while one voxel further in they match the
interior (p99 ≈ 38 against 34). Left in, they enter the ΔPDF directly and, as
Dirichlet data, light up any `laplace` hole that touches them. Trimmed voxels
become unmeasured coverage: masked and zeroed, as the loader leaves them. The
volume's own faces are not an edge. `method="q_shell"`
(the robust radial level at the same `|Q|`) is kept only for comparison: it is
biased at the lattice nodes and leaves ΔPDF artefacts at the lattice vectors
(see [bragg_cleanup.md](bragg_cleanup.md)).

---

## Uncertainty propagation

| Method | σ_filled |
|--------|----------|
| Symmetry | √(1/Σwᵢ) where wᵢ = 1/σᵢ² |
| TV | Not propagated (mark as "reconstructed") |
| RBF | Not propagated (mark as "reconstructed") |

For downstream RMC refinement, reconstructed voxels should be assigned lower weight
(e.g., σ_filled = 2× the local unmasked σ).

---

## References

- Chambolle & Pock, *J. Math. Imaging Vision* 2011 — primal-dual TV algorithm
- Bertalmio et al., SIGGRAPH 2000 — PDE inpainting (origin of diffusion-based approach)
- Bertero & Boccacci, *Introduction to Inverse Problems in Imaging* (1998) — general theory
