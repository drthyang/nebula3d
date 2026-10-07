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
tails leaking past the punch edge do not pull the fill up. The voxels between
the punch and that boundary are filled too: they hold the tail the boundary
skips, and kept they would ring the fill with a rim brighter than the fill
itself. A single masked
region past `laplace_max_unknowns` (default 2 M) is an unmeasured coverage gap
rather than a punch — loaders zero and mask those — and gets the `local` fill.

Pass `punched=` (the voxels the punch removed; the pipeline's punch stage
records them, in memory and as `/MDHistoWorkspace/nebula3d/punched` in the
punch artifact) so a
hole and the unmeasured coverage it touches stay apart. Without it every masked
voxel is a hole: a hole touching coverage merges with it, and the whole region
gets one value set by the coverage's rim — on a 64.5 M-voxel hexagonal TOPAZ
volume that was most of the punched voxels. With it each hole is filled only
from the measured voxels around it (unmeasured neighbours are a free, Neumann
boundary for `laplace`), and enclosed unmeasured pockets (next section) are
filled afterwards with their own shell median.

## What is filled: the measured support (2026-10-07)

The backfill **interpolates; it never extrapolates**. It fills:

- every **punch hole** (and, for `laplace`, its gap band): measured voxels the
  punch removed, so they lie inside the coverage by construction;
- **unmeasured pockets enclosed by measured data**: the direct-beam shadow,
  dead voxels, small gaps. Data surround them on every side.

It leaves **masked**, with their data unchanged (zero, as the loader left
them), the unmeasured regions that reach a face of the box. These are the space
past the coverage, and the gaps where the coverage edge meets a box face.
Nothing measured lies beyond them, so any value there would be invented. The
test is topological and has no parameter. Unmeasured = masked and not punched.
Its 26-connected regions are labelled once, and a region that touches any face
of the box is *open*. A shadow or gap that reaches the box edge through a
channel (a missing wedge) is open too, and stays unfilled. The direct-beam fill
never takes open voxels. Without `punched=` every masked voxel counts as
unmeasured, so a hole that touches an open region stays masked with it. Set
`unmeasured="all"` (`BackfillParams.unmeasured`) to fill everything. That was
the behaviour before this change, and the open regions get their rim's shell
median. Keep it only to compare.

Before the change the pipeline filled every masked voxel. On a hexagonal
(6/m) TOPAZ dataset (6/m-symmetrised, 401³) the data cover a sphere around
the origin that fills only part of the box. The rest, **a large fraction of
the box**, got a constant plateau out to the box corners. It entered the
flatten statistics, the ΔPDF, the back-FFT check and the viewers. Now it stays
masked. The enclosed pockets (among them the beam shadow near the origin) are
still filled. Every voxel the new fill keeps is bit-identical (data and σ) to
the old fill, on every volume below.

**Orthorhombic data whose coverage fills the box are unaffected** (checked at
three temperatures). Only a tiny fraction of the box is open, almost all of it
within 2 voxels of a K or L face, where the coverage edge meets the box. Only
those voxels change, from shell medians to masked. The enclosed beam shadow
and dead voxels are filled as before. The table compares the two settings
downstream: the same punch artifacts (the 2026-10-06 `data/processed` reruns;
the hexagonal data from a fresh default run), backfilled with
`unmeasured="enclosed"` and with `"all"`, then flattened and transformed with
the pipeline defaults in float32 (ΔPDF after the 2026-10-07 DC fix).

| | orthorhombic (three temperatures) | hexagonal |
|---|---|---|
| open voxels left masked | a tiny fraction of the box | a large fraction of the box |
| flatten constant, old → new | negligible change | unchanged |
| ΔPDF change relative to the ΔPDF (\|r\| ≥ 2 Å, max and RMS) | negligible (well below 1 %) | a few % |
| back-FFT check `r` (new) | near-exact | near-exact |

**What the ΔPDF does with the open region.** It reads masked voxels as zero.
It then subtracts the window-weighted mean `c` of the whole box and applies the
window, so an open voxel enters as `−c·w`. The back-FFT check stays exact: the
inverse returns zero there, the value it was given. On the hexagonal data the
change is not negligible. The box window is still far from zero where the
coverage ends, so the coverage edge becomes a sharp spherical step. Its
truncation ripple (period 2π/Q_edge, with Q_edge the `|Q|` where the coverage
ends) sits around the origin: the shell RMS of the change is a large part of
the ΔPDF below 2 Å and falls off with `r`. In the a–b (`z = 0`) and b–c
(`x = 0`) sections, against the strongest correlation past 1.5 Å, its maximum
is a few percent at short `r` and below 1 % at long `r`. Below 2 Å, around the
origin peak, it is as large as that correlation. The old plateau hid this step
by continuing the rim level to the box faces, where the window tapered it, but
the plateau itself was invented.

A sizeable part of the change comes from the mean. Over the whole box, `c`
counts the open region as `I = 0` rather than `ΔI = 0`, so it comes out below
the support-weighted mean. Measured against an ideal input `w·M·(I − c_M)`,
with `M` the support and `c_M = Σ w·M·I / Σ w·M`, the change is a few percent
of the maximum.

The remedy belongs in the transform, not in the fill: a window that reaches
zero at the **edge of the measured support**, not the box, and the mean taken
over the support. With `w = 0` outside, both the step and the mean's
dependence on the open region vanish. A volume whose coverage fills the box
needs neither.

The pipeline also trims the edge of the measured coverage when it loads the raw
input (`PipelineParams.edge_trim`, default 1 voxel layer;
`nebula3d.preprocessing.trim_coverage_edge`). A measured voxel next to
unmeasured space is barely normalised: on the hexagonal TOPAZ volume those
voxels reach a p99 about two orders of magnitude above the interior's, and
maxima far beyond it, while one voxel further in they match the interior.
Left in, they enter the ΔPDF directly and, as
Dirichlet data, light up any `laplace` hole that touches them. Trimmed voxels
become unmeasured coverage: masked and zeroed, as the loader leaves them. The
volume's own faces are not an edge. In a symmetrised volume
(`PipelineParams.symmetry`) a voxel is trimmed when any equivalent voxel is,
see *Symmetrised Volumes* in `bragg_cleanup.md`. `method="q_shell"`
(the robust radial level at the same `|Q|`) is kept only for comparison: it is
biased at the lattice nodes and leaves ΔPDF artefacts at the lattice vectors
(see [bragg_cleanup.md](bragg_cleanup.md)).

Generic image inpainting — total variation (Chambolle–Pock), symmetry copying,
RBF and biharmonic relaxation — was removed, together with the older ring-shell
fill (`backfill_ring_shells`) that used it. TV assumes a piecewise-constant image
and leaves staircase artefacts in structured diffuse scattering, and every
symmetry copy of a punched Bragg node is itself punched, so there is nothing
valid to copy. Coverage gaps are best filled by symmetrising the data (e.g. in
Mantid) before it reaches the pipeline; what symmetry cannot reach stays
unmeasured (see *What is filled* above).

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
