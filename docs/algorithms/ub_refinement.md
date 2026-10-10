# UB Refinement

`nebula3d.analysis.ub_refine` refines a volume's UB matrix from where its Bragg
peaks sit, and regrids the volume onto the refined UB. The command-line entry
point is `examples/refine_ub.py`.

A UB that is slightly off puts each Bragg peak beside its node instead of on it:

- **a rotation error** moves a peak across Q by the angle times |Q|: 0.25 Å⁻¹ at
  16 Å⁻¹ for 0.9°;
- **a cell error** moves it along Q by the relative error times |Q|.

Both grow with |Q|. The punch then searches farther from the nodes, and the
ΔPDF's interatomic vectors scale with the cell.

## Measuring the peak centres

`measure_centres` visits the Bragg nodes: the integer HKL that are multiples of
`cell`, so `(2, 2, 2)` for a volume indexed on a doubled cell whose odd nodes
hold no Bragg peaks. For each node it works in three regions around the place
the current UB predicts:

| Region | Radius | Use |
| --- | --- | --- |
| search sphere | `reach` (0.25 Å⁻¹) | The peak is its brightest measured voxel. |
| background shell | `reach` to 2·`reach` | Median and 1.4826·MAD give the local background and noise. |
| box | the shell and the centring window | Must lie inside the volume. |

The peak counts when it stands `min_significance` (10) noise sigmas above the
background.

Its centre is a **windowed centroid**, after SExtractor's windowed positions:
the background-subtracted centroid under a Gaussian window. The window is
isotropic in Q, its σ 1.5 voxels, and it is moved onto the centroid until it
stops moving. A centroid of the voxels above a threshold won't do: it
overstates a peak's offset from the voxel the peak tops out in. The error is
about a third of the offset for a peak a voxel or two wide. When the cell is
off, the offsets grow steadily across the lattice, so the fit inherits that
error.

On a synthetic hexagonal crystal with the cell 1 % off and the nodes on grid
points, the half-height centroid gave a = 4.0537 Å for a true 4.04 Å. The
windowed centroid gives 4.0399 Å, and a 0.5° rotation to within 0.001°.

No centroid can centre a peak narrower than about half a voxel (σ): the grid
aliases it, by up to a tenth of a voxel. On the demo crystal (a = 4.2 Å, peaks
σ ≈ 0.03 Å⁻¹) the cell comes out within 0.02 % on the default 161³ grid and
0.07 % on 101³, but 0.7 % off on 48³.

The background is the shell's median, a level one. A plane fitted through the
shell did worse: a peak's tails reaching into the shell tilt the plane toward
the peak. Peak strength is a check on a sloping background. A slope pulls a
weak peak's centre uphill more than a strong one's, so offsets that are the
same for weak and strong peaks rule it out.

## The fits

`fit_ub` minimises Σ w·|Q − UB′·node|² over the UB′ each fit allows. Q is a
centre's position, UB·centre.

| `fit` | What changes | How |
| --- | --- | --- |
| `orientation` | A rotation of the lattice; the cell is kept. | Kabsch's solution of Wahba's problem. |
| `lattice` | The cell; the orientation is kept. | Least squares over the metrics the symmetry operations leave invariant: two parameters (a, c) for a hexagonal cell. B is the metric's Cholesky factor, Busing and Levy's B. |
| `both` | The rotation and the cell together. | Least squares. |
| `symmetric` | UB·D with D commuting with every operation (M·D = D·M). | Linear least squares. Under 6/mmm, D scales the hk plane and l. With no operations, D is any matrix: the free nine-parameter UB. |

A centre that lies farther from its node than three times the median distance
is left out, and the fit repeated. Centres within half a voxel of their node are
always kept. Without that floor, a model that misses some directions by a
little would drop those directions as outliers.

`refine_ub` measures and fits in passes, working from low |Q| outward. It takes
the nodes out to a third of the |Q| limit, then two thirds, then all of them.
Each pass searches where the previous fit predicts the peaks, because far out a
peak can sit beyond `reach` from where the starting UB puts it.

## Symmetrised volumes

Symmetrising hides what does not commute with the symmetry operations.

- **A rotation is hidden.** Each node holds its orbit partners' peaks, turned by
  the rotation's conjugates. The result is a ring centred on the node, not a
  shifted peak. The ring's centroid sits inward by about half the squared
  angle, 1e-4 of |Q| for 0.9°.
- **A cell error that keeps the symmetry survives.** It moves the equivalent
  nodes alike, so the symmetrised peaks stay sharp and as far off their nodes as
  before.

`symmetry_break` tells the two kinds of volume apart. It compares random
measured voxels with their images under the operations; a symmetrised volume
gives rounding error, below 1e-4.

`refine_ub` refuses every fit but `symmetric` on a symmetrised volume, and the
orientation then needs the unsymmetrised data. The `symmetric` fit works in the
volume's own HKL, where the symmetrising was done. The other fits work in Q,
through the UB. A free refinement usually leaves the UB's cell a few parts in a
thousand short of the symmetry; through such a UB, the averaging itself would
read as a distortion.

## Regridding

`regrid(vol, ub)` resamples the volume onto the HKL grid of a new UB: the voxel
at h takes what the volume measured at the same Q. That puts the peaks on their
nodes; symmetrising afterwards then stacks the equivalent copies instead of
spreading them into rings.

- **Interpolation:** trilinear. It adds no ringing beside sharp peaks and no
  negative lobes. A peak one voxel wide loses height and gains width where its
  centre falls between voxels.
- **Mask:** a voxel counts as measured only when every voxel it is interpolated
  from is measured. The rest is left as the loader leaves unmeasured space:
  masked, with data and σ zero.
- **σ:** interpolated like the data. This overstates it a little, because
  interpolating averages the neighbours' noise.

**Trim the coverage edge first.** Voxels on the edge of the measured coverage
are barely covered by the detectors and can sit orders of magnitude above the
interior. On a measured unsymmetrised hexagonal volume, 90–99 % of the voxels
above 2·10³–10⁵ were on the outermost layer, the largest at 5.5·10⁷, against
1.7·10⁴ for the strongest Bragg peak. Interpolating and symmetrising carry
them inward, out of reach of the pipeline's own trim at load (`edge_trim`).
Skipping the trim once left that volume's 3D-ΔPDF dominated by them. The
script therefore trims first (`EDGE_TRIM`, one layer by default, as the
pipeline does), and the UB check trims a copy.

`examples/refine_ub.py` writes the regridded volume in the NeXus Viewer's
layout, optionally symmetrised (`SYMMETRISE=1`) with the operations declared in
`symmetry_ops`. The pipeline reads that file with `symmetry: auto`.

## Reading the offsets

The script reports, by |Q| band and direction, each peak's offset along Q from
its node relative to |Q| (median), before and after the fit.

A UB maps HKL to Q linearly, so any UB error gives a relative radial offset that
depends on direction but is the same at every |Q| along it. A relative offset
that changes with |Q| along one direction cannot be a UB error. It comes from
how |Q| itself was assigned, and refining the UB only averages it.
