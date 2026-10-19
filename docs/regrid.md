# Regridding a dataset onto its refined UB

How the UB is refined from where the Bragg peaks sit, and how a volume is
regridded onto it, is in [UB refinement](algorithms/ub_refinement.md). This page
is the action the app and the Pilot run on a dataset: it writes the regridded
volume as a new dataset and never over a file.

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
