# Backfill (filling punched holes)

After the Bragg punch, every hole is filled from the measured diffuse **around
it** before the Fourier transform — the 3D-ΔPDF punch-and-fill convention
(NXRefine's Laplace fill, Mantid `DeltaPDF3D`'s convolution fill, KAREN). The
fill must follow the diffuse at the hole: every punch sits on a reciprocal-lattice
node, so a fill that is biased at the nodes repeats that bias on the lattice and
Fourier-transforms into spurious ΔPDF features at the lattice vectors.

## Methods


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
records them, in memory and as `/MDHistoWorkspace/nebula3d/punched` in the
punch artifact) so a
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

Generic image inpainting — total variation (Chambolle–Pock), symmetry copying,
RBF and biharmonic relaxation — was removed, together with the older ring-shell
fill (`backfill_ring_shells`) that used it. TV assumes a piecewise-constant image
and leaves staircase artefacts in structured diffuse scattering, and every
symmetry copy of a punched Bragg node is itself punched, so there is nothing
valid to copy. Coverage gaps are best filled by symmetrising the data (e.g. in
Mantid) before it reaches the pipeline.

---

## Uncertainty of filled voxels

| Method | σ_filled |
|--------|----------|
| `local` | max(standard deviation of the hole's shell, global median σ) |
| `laplace` | max(spread of the hole's boundary values, global median σ) |
| `q_shell` | max(standard deviation of the \|Q\| shell, global median σ) |

Filled voxels are reconstructions: for downstream RMC refinement give them lower
weight (e.g. σ_filled = 2× the local unmasked σ).

---

## References

- Weng et al., *J. Appl. Cryst.* **53**, 159 (2020) — KAREN: local outlier
  detection and fill for 3D-ΔPDF.
- Bertalmio et al., SIGGRAPH 2000 — PDE (diffusion) inpainting, the basis of the
  Laplace fill.
