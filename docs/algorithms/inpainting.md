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
gets one value set by the coverage's rim — on the 64.5 M-voxel Fe3Ge2 TOPAZ
volume that was 82 % of the punched voxels. With it each hole is filled only
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

Before the change the pipeline filled every masked voxel. On Fe3Ge2 90 K
(TOPAZ, 6/m-symmetrised, ±20 r.l.u. box, 401³) the data cover a sphere to
`|Q|` ≈ 17 Å⁻¹, 59 % of the box. The other **27.9 M voxels (43 % of the box)**
got a constant plateau of mean 11.9, out to `|Q|` = 33.8 Å⁻¹. It entered the
flatten statistics, the ΔPDF, the back-FFT check and the viewers. Now they stay
masked. The 79 enclosed pockets (4,933 voxels, among them the beam shadow at
`|Q|` < 0.83 Å⁻¹) are still filled. Every voxel the new fill keeps is
bit-identical (data and σ) to the old fill, on all four volumes below.

**TbTi3Bi4 22/45/100 K are unaffected.** Their coverage fills the box. 0.20–0.22 %
of it is open: 98,800–107,508 voxels, 95 % of them within 2 voxels of a K or L
face, at `|Q|` 7–10.5 Å⁻¹, where the coverage edge meets the box. Only those
voxels change, from shell medians to masked. The enclosed beam shadow
(287–303 voxels) and dead voxels are filled as before. The table compares the
two settings downstream: the same punch artifacts (the 2026-10-06
`data/processed` reruns; Fe3Ge2 from a fresh default run), backfilled with
`unmeasured="enclosed"` and with `"all"`, then flattened and transformed with
the pipeline defaults in float32 (ΔPDF after the 2026-10-07 DC fix).

| | 22 K | 45 K | 100 K | Fe3Ge2 90 K |
|---|---|---|---|---|
| open voxels left masked | 107,508 | 107,444 | 98,800 | 27,893,344 |
| flatten constant, old → new | 0.0705 → 0.07043 | 0.06755 → 0.06748 | 0.05795 → 0.05789 | 2.88 → 2.88 |
| ΔPDF change, max / max\|ΔPDF\| (\|r\| ≥ 2 Å) | 2.2·10⁻⁴ | 3.8·10⁻⁴ | 3.4·10⁻⁵ | 6.2·10⁻² |
| ΔPDF change, RMS / RMS (\|r\| ≥ 2 Å) | 1.1·10⁻³ | 1.8·10⁻³ | 7.9·10⁻⁵ | 3.4·10⁻² |
| back-FFT check `r` (new) | 0.99990 | 0.99990 | 0.99986 | 0.999995 |

**What the ΔPDF does with the open region.** It reads masked voxels as zero.
It then subtracts the window-weighted mean `c` of the whole box and applies the
window, so an open voxel enters as `−c·w`. The back-FFT check stays exact: the
inverse returns zero there, the value it was given. On Fe3Ge2 the change is
not negligible. The box window is still ≈ 0.5 where the coverage ends at
17 Å⁻¹, so the coverage edge becomes a sharp spherical step. Its truncation
ripple (period 2π/17 Å⁻¹ ≈ 0.37 Å) sits around the origin: shell RMS of the
change is 41–48 % of the ΔPDF below 2 Å, 14–18 % at 2–6 Å, 7 % at 10 Å, 3 % at
20 Å. In the a–b (`z = 0`) and b–c (`x = 0`) sections, against the strongest
correlation past 1.5 Å, its maximum is 6 % at 2–3 Å, 3.6 % at 3–5 Å, 1.3 % at
5–8 Å and ≤ 0.7 % beyond. Below 2 Å, around the origin peak, it is as large as
that correlation. The old plateau hid this step by continuing the rim level
to the box faces, where the window tapered it, but the plateau itself was
invented.

About 40 % of the change (shell RMS 18 % below 1 Å, 6–7 % at 2–6 Å, 1 % at
20 Å) comes from the mean. Over the whole box, `c` counts the open region as
`I = 0` (3.25) rather than `ΔI = 0`, the support-weighted mean 3.48. Measured
against an ideal input `w·M·(I − c_M)`, with `M` the support and
`c_M = Σ w·M·I / Σ w·M`, the change is 2.4 % of the maximum.

The remedy belongs in the transform, not in the fill: a window that reaches
zero at the **edge of the measured support**, not the box, and the mean taken
over the support. With `w = 0` outside, both the step and the mean's
dependence on the open region vanish. A volume whose coverage fills the box
needs neither.

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
