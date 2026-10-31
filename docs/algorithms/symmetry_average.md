# Symmetry Average (stage 0)

## Purpose

A single-crystal volume measured on a few detector settings has gaps in its
coverage, and an unsymmetrized volume keeps them. Where a gap runs through
Q = 0 and out to the box edge, the 3D-ΔPDF's window, shrunk to the measured
coverage, has no room left, and the transform stops with a
`WindowSupportError`. The crystal's Laue symmetry fills most gaps: every voxel
of an orbit holds the same intensity, so a voxel measured at one equivalent
position is measured at all of them.

The symmetry average is the pipeline's optional first stage
(`symmetry_average`, off by default). Switched on with the sample's Laue
class, it averages the raw volume over the class before the ring removal and
writes `<stem>_symmetrized.h5`. It follows the
[NeXus Viewer](https://drthyang.github.io/neutron-nexus-viewer/), whose export
has symmetrized volumes for NEBULA3D until now: a volume averaged here equals
the one the viewer exports, voxel for voxel.

API: `nebula3d.symmetry` (`laue_group`, `metric_change`, `symmetry_average`)
and the stage `nebula3d.pipeline.symmetrize`; settings
`PipelineParams.symmetry_average_enabled` and
`PipelineParams.symmetry_average` (`SymmetryAverageParams`: `laue`,
`reaverage`).

## The Laue class

`laue` names a preset or gives generators. The presets are the viewer's
(`LAUE_PRESETS`): 1, −1, 2/m (b or c unique), mmm, 4/m, 4/mmm, −3, −3m1, −31m,
6/m, 6/mmm, m−3 and m−3m, the trigonal and hexagonal classes on hexagonal
axes. Generators are written like coordinate triplets acting on reflections,
`h+k,-h,l` (the six-fold about c* in hexagonal axes), separated by `;`;
real-space triplets such as `x-y,x,z` are taken as R = Wᵀ. The parser is the
viewer's (`parseOps`), with its messages. The generators are closed into a
group exactly as the viewer's `closeGroup` closes them: the identity, then
each new generator, then the products of every pair, pass after pass until a
pass adds none, at most 48 operations. A group named by its operations gets
the preset's name when it has the same operations, else "custom".

Which class a sample has is the user's to declare. The Pilot may suggest one
with evidence, but its settings tool does not set it.

## Two checks

**Grid.** Every operation must send voxel centres onto voxel centres: it then
becomes an exact integer map i′ = M·i + t on voxel indices
(`GridSymmetry.for_volume`), with no interpolation. The axes it mixes need
equal steps (H and K for the hexagonal, trigonal and tetragonal classes, all
three for the cubic ones), every axis a bin centred at 0, and the bins must be
uniform. A grid that fails is refused, with the operation and what it needs.

**Metric.** The largest change of the reciprocal metric under the operations,
max |RᵀG\*R − G\*| / max |G\*| with G\* = UBᵀ·UB (`metric_change`, the
viewer's `metricChange`). It is 0 for a true symmetry of the cell and small
but not 0 for a pseudo-symmetric one. Above 2 % the operations are not
symmetries of this lattice: averaging over them would pool voxels at
different |Q|. The viewer warns there; the stage refuses. The log reports the
change ("metric (UB) kept to 0.01%"). A volume without a UB (the identity,
NEBULA3D's "unknown") is not checked.

## The average

`symmetry_average` works in place, by the viewer's export
(`symmetrizeForExport`):

1. **Each orbit once.** An orbit is visited from its representative, the member
   with the smallest flat (C-order) index among those on the grid. Images off
   the grid do not count.
2. **Measured voxels, equal weight.** A member counts when it is measured
   (mask) and finite. Their values are summed in float64 over the images
   g·x in the group's order; a member on a symmetry element appears once per
   operation that maps the representative onto it, so sum and count scale
   alike. The mean is sum / count.
3. **Every member gets the mean.** It is written to every member on the grid,
   measured or not, in the volume's dtype, and the mask is set on every
   member of an orbit with a measured member. An orbit without one stays
   unmeasured as the loader leaves it: 0, σ 0, masked.
4. **σ of the mean.** √(Σσ²)/n over the n measured members whose σ is known,
   the uncertainty of a mean of independent voxels; √|mean| for an orbit with
   none known. When the volume's σ was only estimated (√|I|, no σ came with
   the data), σ stays √|I| of the averaged values and stays flagged as
   estimated. This is NEBULA3D's one convention for a symmetrized volume: the
   regrid's optional symmetrising ([regrid.md](../regrid.md)) and
   `examples/refine_ub.py` call this same function, so they cannot diverge.

The volume is processed a slab of H planes at a time, touching only each
slab's representatives and their images, so the stage holds the volume and a
few slab-sized arrays (about 50 MB for a 1 M-voxel slab), never a second
volume, and its indices are safe for the browser's 32-bit WASM build. For
groups that keep L apart from H and K (all but the cubic ones), whether a
voxel is its orbit's representative follows from its (H, K) image, so that
test costs a few boolean passes per operation.

The stage also reports R_int of the measured equivalents before the average,
Σ|I − ⟨I⟩| / Σ|I| over the measured voxels of the orbits measured at least
twice: crystallography's agreement factor, here over voxels. It is near the
noise level for the sample's own Laue class and larger for a class with
operations the sample lacks.

### Order with the coverage-edge trim

The raw input's coverage edge is trimmed first (`edge_trim`, the
[edge trim](inpainting.md)), then averaged. Measured voxels next to unmeasured
space are barely normalised and can be orders of magnitude above the interior;
trimmed first, they are pooled into no orbit. The viewer's equivalent is its
coverage-edge erosion mask, which is applied before its average and has the
same definition (Chebyshev distance ≤ r from an unmeasured voxel, the box
faces not an edge). The averaged volume is not trimmed again. Trimming also
takes the voxels beside a gap through Q = 0, so the orbits within a voxel of
the origin can stay unmeasured: a hole enclosed by measured voxels, which the
backfill fills and which leaves the ΔPDF's window its room.

### The grid is not padded

The viewer's export pads each axis to be symmetric about 0, so that symmetry
fills the padding. The stage keeps the grid: NEBULA3D's 3D-ΔPDF needs Q = 0 on
each axis's centre index already (`check_fft_origin`), so a grid that reaches
the ΔPDF is centred. On the voxels the two grids share, the values are the
same.

## The output

`<stem>_symmetrized.h5` declares the operations as the viewer's export does,
as attributes of its `nebula3d` group: `symmetry` (the class's name, or
"custom"), `symmetry_ops` (the closed group, `h,k,l; h+k,-h,l; …`) and
`source_file`. A JSON record (`symmetry_average`) holds the Laue class, the
metric change, the voxels measured before and after, the voxels filled, R_int,
the input and the edge trim (`pipeline.read_symmetry_average`).

The stages after it read the symmetry there (`PipelineParams.symmetry =
"auto"`), as they read a viewer export's: the punch decides once per orbit,
the ring removal, the backfill and the flatten average their output over each
orbit, and each of them declares the symmetry in its own output in turn, so a
partial re-run, the viewers and the Pilot read it from the volume they look
at. A stage output written before this declares nothing, and the raw input's
declaration applies to it, as before.

## Inputs symmetrized already

An input that declares a symmetry of more than the identity was averaged
already (a NeXus Viewer export). The stage passes it through and says so ("…
declares 6/mmm (24 operations): it is symmetrized already"), and the declared
symmetry applies to the stages after it. `reaverage` averages it again over
the stage's class; averaging a volume over a different class is not the same
as averaging the raw data over both, so the unsymmetrized volume is the
better input. An unsymmetrized viewer export declares the identity alone
(`h,k,l`), which counts as no symmetry.

## Resume

Like every stage, the symmetry average keeps its output when it exists and the
run does not force it. It is made again when its record does not match the
run: another Laue class, another input or an input newer than it, or another
edge trim ("… stale — recomputing"), never reused for the wrong class.

## Verification

- `tests/test_symmetry_average.py` checks `symmetry_average` bit for bit
  (float32 values and mask) against the NeXus Viewer's own code, run under
  node on the same inputs by `scripts/viewer_symmetry_fixture.py`
  (`tests/fixtures/viewer_symmetry_average.json`: 6/mmm and −3m1 on a hexagonal
  grid, m−3m on a cubic one, with unmeasured orbits, NaN voxels and unknown
  σ), and the viewer's presets, closure order and metric change. Also:
  invariance under every operation, each orbit keeping the mean of its
  measured voxels, slab-size independence, and the refusals.
- On the viewer's synthetic example (`examples/demo_300K.nxs`, 101³, 6/mmm, its
  storage order L, K, H unlike NEBULA3D's) and a cubic synthetic volume from
  `nebula3d.demo` with gaps, under 6/mmm, 6/m, −3m1, −1, mmm, m−3m, m−3 and
  4/mmm, with and without the one-voxel edge mask: the float32 values and the
  masks equal the viewer's export bit for bit, a float64 volume rounds to them,
  σ agrees to float32 precision, and on a grid the viewer pads the shared
  voxels are equal too.
- `tests/test_symmetry_average_stage.py` runs the stage in the pipeline: a
  volume with a gap through Q = 0 that stops the 3D-ΔPDF runs through with the
  stage on.
