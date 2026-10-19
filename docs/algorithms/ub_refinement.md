# UB Refinement

`nebula3d.analysis.ub_refine` refines a volume's UB matrix from where its Bragg
peaks sit, and regrids the volume onto the refined UB. The command-line entry
point is `examples/refine_ub.py`. The app regrids a dataset into a new one with
`nebula3d.analysis.ub_regrid` (see "Regridding a dataset" below).

A UB that is slightly off puts each Bragg peak beside its node instead of on it:

- **a rotation error** moves a peak across Q by the angle times |Q|: 0.17 Å⁻¹ at
  10 Å⁻¹ for 1°;
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
is left out, and the fit repeated. `refine_ub` always keeps the centres within
half a voxel of their node (`fit_ub` alone keeps only those within 10⁻⁴ Å⁻¹). Without that floor, a model that misses some directions by a
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
  angle, 1.5e-4 of |Q| for 1°.
- **A cell error that keeps the symmetry survives.** It moves the equivalent
  nodes alike, so the symmetrised peaks stay sharp and as far off their nodes as
  before.

`symmetry_break` tells the two kinds of volume apart. It compares random
measured voxels with their images under the operations; a symmetrised volume
gives rounding error, below 1e-4.

`refine_ub` refuses every fit but `symmetric` on a symmetrised volume, and the
orientation then needs the unsymmetrised data. The `symmetric` fit works in the
volume's own HKL, where the symmetrising was done. The other fits work in Q,
through the UB. A free refinement can leave the UB's cell slightly off the
symmetry; through such a UB, the averaging itself would read as a distortion.

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
interior. On a measured volume nearly all of the brightest voxels sat on the
outermost layer, far above the strongest Bragg peak. Interpolating and
symmetrising carry them inward, out of reach of the pipeline's own trim at load
(`edge_trim`). Skipping the trim once left that volume's 3D-ΔPDF dominated by
them. The
script therefore trims first (`EDGE_TRIM`, one layer by default, as the
pipeline does), and the UB check trims a copy.

`examples/refine_ub.py` writes the regridded volume in the NeXus Viewer's
layout, optionally symmetrised (`SYMMETRISE=1`) with the operations declared in
`symmetry_ops`. The pipeline reads that file with `symmetry: auto`.

## Regridding a dataset

`nebula3d.analysis.ub_regrid.regrid_dataset` makes the correction an action the
app can offer. It refines the UB of a dataset's raw volume as the UB check does,
regrids the volume onto it, and writes the result as a **new** file beside the
raw one, in the NeXus Viewer's layout. The server
(`POST /api/datasets/{id}/regrid`) and the browser bridge
(`webbridge.dataset_regrid_json`) call it through one helper, so they return the
same fields.

| Raw volume | New file |
| --- | --- |
| `<stem>.nxs` | `<stem>_regridded.nxs`, or `<stem>_regridded_sym.nxs` when symmetrised |

The new file is a dataset of its own in `raw/`. Its pipeline outputs are named
after its own stem, so they never touch the original dataset's.

**The fit is the UB check's.** `check_ub` is the one refinement both use: the
same operations, the fit `auto_fit` picks, the one-layer edge trim and the
passes. The turn the regrid acts on is therefore the one `ub_check` reports.

### Never overwriting

- **The raw volume is only read.** The tests hash it before and after.
- **The new file stays inside the data root and off the raw file.** Its path is
  normalised first (`..` resolved), and a target outside the data root or equal
  to the raw file raises `ValueError` before anything is read.
- **An existing target is refused.** That holds for a file, and for a link,
  even one pointing nowhere. The file is created exclusively (`O_CREAT | O_EXCL`), so
  one that appears while the regrid runs is refused too, never overwritten. A
  write that fails removes its own partial file.
- **The server refuses a dataset id already in use.** Another file whose name
  differs only in punctuation would share the id. Pipeline outputs left from a
  regridded dataset whose file was removed would be inherited by the new one.

The action refuses rather than picking a fresh name, which keeps it idempotent.
A second request, from a retry, a double click or a model calling its tool
twice, names the dataset the first one made. It does not fill the data root
with copies the size of the raw volume.

### When it refuses

Nothing is written, and the reason comes back as data (`code`, `reason`):

| `code` | When |
| --- | --- |
| `turn_below_noise` | The fit turns the UB by less than 0.05° (`UB_TURN`). That is the rule the UB check's reading applies (the app's `UB_TURN`): within the fit's own noise, a regrid would only resample. On synthetic crystals with the UB right, the fit reads 0.0002° to 0.0007°. |
| `symmetrised_without_source` | The volume is symmetrised under its operations, so only the symmetric fit applies, and it cannot turn the UB (see "Symmetrised volumes"). The unsymmetrised volume it was made from is not beside it, or is symmetrised too. |
| `cannot_symmetrise` | Symmetrising was asked for without operations, or with operations that do not map the grid onto itself. |
| `target_exists` | The new file's name, or its dataset id, is in use. |

Too few peaks to fit is an error (HTTP 422), as it is for the UB check.

### Symmetrised datasets

A symmetrised dataset keeps its operations. The file its `source_file`
attribute names, the unsymmetrised volume the NeXus Viewer made it from, is
refined (the rotation and the cell, the cell constrained by the operations) and
regridded. The result is then symmetrised under the operations, so the copies of
each peak stack on its node instead of forming a ring.

Symmetrising an unsymmetrised dataset is optional and off by default.
Symmetrising changes the data; regridding only resamples them.

### What the new file records

The `/entry` attributes record what was done:

- `source_file`: the file whose data were regridded;
- `regrid_dataset_file`: the dataset that was asked for;
- `regrid_ub_start` and `regrid_ub`: the UB before and after (`ub_matrix` holds
  the latter);
- `regrid_fit`, `regrid_turn_deg` and `regrid_turn_axis_uvw`;
- the cell before and after, the peaks' RMS distance from their nodes before
  and after, the peaks used, the node spacing and the edge trim;
- `regrid_symmetrised`.

Only a symmetrised file declares `symmetry_ops` (and `symmetry`): the pipeline
takes a file that declares them for symmetrised (`symmetry: auto`). The
operations that constrained the cell are in `regrid_operations`. σ is written
only when it came with the data; otherwise the loader estimates it again (√|I|)
and says so.

### What a regrid costs

After the turn, some voxels' Q falls outside the old grid. Nothing was measured
there, so they become unmeasured (`outside_grid`). The result counts those that
were measured before (after the edge trim) and gives their share. A turn moves
the box's far corners the most, by the angle times their |Q|.

On a fully measured synthetic box of 61³ voxels turned by 0.3°, about half of
the outermost layer goes: 4.9 % of the voxels. Measured data seldom fill the
box's faces, so there the share is usually far smaller. A voxel beside the old
coverage's edge can become unmeasured too, since every voxel it is
interpolated from must be measured. `measured_before` and `measured_after` give
the whole change.

When the pipeline loads the new file it trims the coverage edge again
(`edge_trim`), so the new dataset loses one layer more than the raw one does.

### Known answer

The test crystal is hexagonal (a = 4 Å, c = 5 Å) on 61³ voxels of 0.1 r.l.u.,
with Gaussian peaks of σ = 0.15 Å⁻¹. Its true UB is turned by 0.3° about five
different axes, with a different noise seed each time.

- The regrid recovers the turn to within 0.0015° (0.2987° to 0.3004°).
- The peaks' RMS distance from their nodes falls from 0.014–0.020 Å⁻¹ to
  0.0002 Å⁻¹.
- The median distance, measured again on the regridded volume, falls from
  0.013–0.018 Å⁻¹ to 0.0015–0.0028 Å⁻¹. It stays above the fit's RMS because
  trilinear interpolation reshapes a peak a voxel wide.

`tests/test_ub_regrid.py` holds one of these runs, about the Cartesian axis
(1, 2, 3) in Q, to the turn within 0.005° and the median distance under
0.004 Å⁻¹. It also checks
that the UB check on the new dataset finds the UB right.

## Reading the offsets

The script reports, by |Q| band and direction, each peak's offset along Q from
its node relative to |Q| (median), before and after the fit.

A UB maps HKL to Q linearly, so any UB error gives a relative radial offset that
depends on direction but is the same at every |Q| along it. A relative offset
that changes with |Q| along one direction cannot be a UB error. It comes from
how |Q| itself was assigned, and refining the UB only averages it.
