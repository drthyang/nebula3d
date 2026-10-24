# Running the Pipeline

The reduction from Python and the command line: the input it takes, the
complete pipeline in one command, each stage on its own, the viewers for
visual QA, and the Python API. The browser console runs the same pipeline
([web.md](web.md)); for short command recipes see [commands.md](commands.md).

## The stages

The workflow removes powder rings, punches sharp Bragg and satellite peaks, fills
the punched holes, flattens the isotropic background, Fourier-transforms the
cleaned volume into a real-space 3D-ΔPDF, and ends with a back-FFT consistency
check.

```text
Symmetrised HKL volume (NeXus Viewer export or Mantid)
        |
        v
  1. powder-ring subtraction        examples/remove_rings_3d.py
  2. Bragg/satellite punch          examples/punch_bragg_3d.py
  3. Bragg-hole backfill            examples/backfill_bragg_3d.py
  4. radial-background flatten      examples/flatten_background_3d.py
  5. 3D-ΔPDF transform              examples/delta_pdf.py
  6. back-FFT consistency check     examples/delta_pdf_consistency.py
  7. cleanup / ΔPDF viewers         examples/explore_slice.py, examples/explore_delta_pdf_ortho.py
  8. AI review and tuning (optional) web NEBULA Pilot — local or cloud LLM
```

For a **3D-PDF** (total scattering with the Bragg peaks *kept* — a Patterson-like
map) instead of the ΔPDF, use `examples/run_pipeline_pdf.py`, which skips the
punch and backfill stages. To characterise magnetic diffuse that sits *at* the
Bragg satellites, use `examples/investigate_bragg_diffuse.py`.

## Input data

Place the volume in `data/raw/`. A NeXus Viewer export (a Mantid
MDHistoWorkspace with NEBULA3D's `nebula3d` group, or in older exports `/entry`
with the data, mask, H/K/L axes and UB matrix), neutron or X-ray, loads
directly. Its declared
`symmetry_ops` are honoured by every stage (`symmetry="auto"`, the default). A
Mantid-exported NeXus file works too, in either variant:

```text
*_cc_sub_bkg.nxs   # correlation chopper, empty-can background subtracted
*_cc_data.nxs      # correlation chopper data
```

Here `cc` means CORELLI correlation chopper, and `sub_bkg` means the empty-can
background has already been subtracted. **Correlation-chopper (`cc`) and
properly symmetrised data is recommended.** You can also load the files the
package writes. Every `.h5` it writes — the stage volumes and the 3D-ΔPDF — is a
Mantid MDHistoWorkspace NeXus file (the `SaveMD` layout), so Mantid Workbench's
`LoadMD` opens it, with the unit cell in the oriented lattice; files from older
versions (`/entry/...`) still load. See [the file format](README.md#file-format).

Bin the volume on the crystal's own H, K, L axes (Mantid projections
`u=[1,0,0]`, `v=[0,1,0]`, `w=[0,0,1]`, in any order). Non-orthogonal cells such
as hexagonal or monoclinic are fine: the UB matrix carries the metric, and every
|Q|-based stage uses it. A projected grid (e.g. `[H,0,0]/[-K,2K,0]/[0,0,L]`) is
rejected on load. The 3D-ΔPDF keeps the cell angles and every viewer draws each
section at its real angle (see [delta_pdf.md](algorithms/delta_pdf.md)).
Known gap: the *reciprocal-space* viewers still draw a*, b*, c* at 90°.

With the symmetry declared in the input file, the stages keep it: the edge trim
and the punch make each decision once per symmetry orbit, the ring removal, the
backfill and the flatten average their output over each orbit, and the 3D-ΔPDF
transforms the symmetric result. On a measured symmetrised volume the 3D-ΔPDF's
equivalent partners then agree to rounding, where they had differed visibly.

## The complete pipeline

To run the app, see [QUICKSTART.md](../QUICKSTART.md). For concise CLI command
recipes for batch workflows and viewers, see [commands.md](commands.md).

Run the complete pipeline:

```bash
DATA_FILE=data/raw/your_volume_cc_sub_bkg.nxs \
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl \
python3 examples/run_pipeline.py
```

`examples/run_pipeline.py` runs all compute stages, skips stages whose outputs
already exist, writes the 3D-ΔPDF, runs the consistency check, then opens the
cleanup and ΔPDF viewers. The stages are: (1) ring removal, (2) Bragg punch,
(3) Bragg backfill, (4) **radial-background flatten** — the explicit
background-removal step (default on; `FLATTEN=0` to skip), (5) 3D-ΔPDF FFT,
(6) back-FFT consistency check. The background is removed at step 4, not by a
hidden blur inside the FFT: the transform's own Gaussian `SUBTRACT_BG` is off by
default because it is the *alternative* remover (see step 5 below). With the
flatten off (`FLATTEN=0`, or the switch on the web page), the ΔPDF transforms
the run's backfilled volume: `nebula3d.pipeline.run_pipeline`, which the
server and the browser run, never reads a flattened volume an earlier run left
on disk, and its log names the volume the ΔPDF transforms.

Each cleanup stage has such a switch: `PipelineParams.rings_enabled`,
`punch_enabled`, `backfill_enabled` and `flatten_enabled`, the web page's
*Enable stage* switches, which the page sends with every run (the server's
`StageParamsIn` and the browser's bridge take them; the flatten's is the
request's `flatten_enabled`). A stage switched off is not run and passes its
input through: the next stage reads the output of the last stage before it
that is switched on, or the raw input (with the ring removal off, the punch
reads the raw volume), never an output an earlier run left on disk, and the
ΔPDF transforms the last one (`PipelinePaths.pdf_input`). The switched-off
stage's own output from an earlier run stays on disk as it was, neither
rewritten nor removed. The log says so: the stage after one switched off names
the volume it reads ("ring removal disabled: the Bragg punch reads …"), and a
stage switched off but listed in `stages` says it is off ("ring removal
disabled (no powder rings removed)"). A stage left out of `run_pipeline`'s
`stages` is another thing: it is not run in this call, and the stages after
it read its output on disk (or from `inputs`, a tuning trial's): a partial
re-run, as the Pilot's runs from a stage and the tuning's trials make. As for
any setting, a run without `force` keeps the outputs that exist: after
switching a stage off, run with `force` (the page's *Force*), or `force_from`
the stage after it, for the stages after it to be recomputed.

Useful overrides:

| Variable | Effect |
| --- | --- |
| `DATA_FILE=/path/to/file.nxs` | Use a specific input file. |
| `NO_VIEWER=1` | Stop after writing outputs and the consistency check; do not open GUI viewers. |
| `FORCE=1` | Recompute every stage. |
| `FORCE_FROM=rings|punch|backfill|flatten|pdf|check` | Recompute from one stage onward. |
| `FLATTEN=0` | Skip the radial-background flatten (step 4). |
| `CONSISTENCY=0` | Skip the final back-FFT consistency check. |

## Run stages manually

Run these from the repository root when you want to inspect or tune individual
stages.

### 1. Remove Powder Rings

```bash
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl RING_PRESET=cc_on \
python3 examples/remove_rings_3d.py
```

Output:

```text
data/processed/*_ringremoved.h5
```

#### Which shells are rings, and the grid that takes

The ring removal subtracts only the shells it confirms as powder rings: a ring
rises at its |Q| in nearly every direction over the sphere, the crystal's own
scattering there in some directions only
(`nebula3d.preprocessing.ring_isotropy`). NEBULA Pilot's ring check
(`assess_stage` with stage rings) asks the same of every bump its three planes
show. A grid too coarse for that test cannot tell a ring from the crystal's own
scattering, so the test says so ("grid too coarse: …") and judges nothing: the
removal subtracts no shell it cannot confirm, and the Pilot's ring check is not
judged, giving the reason in `ring_rule`, never a verdict. The removal says so
out loud. Its log line ends on a notice, marked ⚠, such as

```text
4 ring candidates (shells that may be powder rings or the crystal's own scattering) detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted. Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.
```

with the count, and what the grid needs from the limit it failed (below); of
one candidate it says "1 ring candidate (a shell that may be a powder ring or
the crystal's own scattering)", and the setting subtracts it "even if it is
the crystal's own shell". Its
diagnostics record it (`unconfirmed_at_grid`: the count, the need, the notice
and the shells' |Q|; `GET /api/rings/{id}/diagnostics`), so the console says it
too: the Execution page shows the stage's line as a warning, the Pilot's ring
check gives it first (`notice`, which the validation's arm C reads without the
remedy), and the report puts it on its ring card and among its caveats. The
verdict on the run says why the ring removal is not judged: "not judged: the
ring removal (grid too coarse for the ring check)". `pooled_confirm_rings` is a
`RingParams` setting of the Python API: the console does not offer it. Two
limits, each from the rule's own constants:

- **Across a ring.** The test reads each direction's radial profile in |Q|
  bins of 0.02 Å⁻¹, never finer than half a voxel (finer bins share the
  voxels' spread in |Q| over the directions, and starve). The narrowest FWHM it
  measures is two bins: two samples across a peak, the Nyquist rate, below
  which a ring falls between the samples and is not told from its flanks. The
  widest it takes is 0.16 Å⁻¹ (`fwhm_cap`): a broader core sums the crystal's
  maxima at neighbouring |Q| in different directions into what reads as a
  ring. So a grid lets the rule judge a ring only with one voxel or more
  across 0.16 Å⁻¹. A third sample, the usual count to measure a peak's height,
  is not asked for: the test takes the core's mean excess, an integral over
  ±0.75 FWHM, which the ring's place on the bins moves by about a fifth at two
  samples per FWHM (0.51 to 0.65 of a Gaussian's peak) and a sixth at three,
  far inside the 0.15 of the median height the rule asks of 90 % of the
  directions. Powder rings are narrower than a voxel on such grids anyway
  (aluminium's lines from the sample can, a few hundredths of an Å⁻¹), and are
  measured at the two-bin floor whatever the grid.
- **Over the directions.** A direction cell's profile counts only where each
  of its |Q| bins holds 5 voxels (`min_voxels`, a median's floor). The rule
  speaks for 90 % of the directions (`direction_share`), so the grid must give
  at least that share of the cells a shell reaches 5 voxels in every bin of its
  profile; else the cells it measures are those the lattice happens to fill,
  along its own directions, where the crystal's own scattering gathers too.
  The grid's voxels are counted, the mask aside (unmeasured space is
  coverage, not resolution), and scaled by the share low-memory mode reads,
  for a shell inside the box's inscribed sphere (past it a face cuts cells
  short, while the cells' bins hold more voxels the further out a shell
  lies). A fine grid falls short near |Q| = 0: at 0.081 Å⁻¹ a voxel, shells
  under 1.1 to 1.2 Å⁻¹ are not judged (the wider the shell, the more bins its
  profile must fill).

It is the voxel's size in Å⁻¹ that counts, not the number of points. On the
validation's dev crystal (a = 3.9 Å), 81 points over ±4 r.l.u. (0.161 Å⁻¹ a
voxel) put 0.99 voxels across 0.16 Å⁻¹, under one, so no ring is judged, the
planted ones included; at 1.75 Å⁻¹ that grid fills 16 of the 128 cells, where
the test had judged a bump of the crystal's own a powder ring. 161 points
(0.081 Å⁻¹) put 1.99 voxels across it and fill 90 % of the cells or more from
1.2 Å⁻¹ out, and so would 81 points over ±2 r.l.u.

#### The candidates' noise floor, where the counts end early

The removal finds its candidates in the radial profile pooled over the planes,
in |Q| bins from 1.5 to 10.5 Å⁻¹ whatever the volume holds: a narrow peak over
a SNIP baseline that rises 6 × the profile's noise (`pooled_min_snr`), the MAD
of the residual's bin-to-bin differences, /√2. The noise is taken over pairs of
adjacent bins that are both measured: some plane samples them, and not sparsely
(by a tenth of the median number of planes or more). With no such pair it is
infinite and nothing is a candidate; with every bin measured it is the estimate
over all of them. The bins left out are those the detection fills, flat past
the last measured one, which SNIP leaves as they are, so their differences are
exactly 0. Counted in, as they were before (review finding B3), they pulled the
noise of a volume whose counts end inside the range towards 0: on the
validation's dev crystal at 161 points, to exactly 0 with the counts ending
anywhere from 4 to 5.5 Å⁻¹, 0.04 of the measured noise at 6 to 6.5, 0.28 at 7,
0.60 at 8 and 0.90 at 10. Every local maximum then became a candidate. On
dev-coverage (counts cut at 4.51 Å⁻¹, no ring) there were 24 at 161 points, 18
judged and rejected, and 10 at 81 points, which the coarse-grid notice listed
and `pooled_confirm_rings=False` would have subtracted, 9.4 % of |I|; now there
are none at either grid. Their keep-outs also crowded a real ring's flanks to
two or three bins in all, so the isotropy test drew its line through those (a
signal-to-noise of 1e14 to 1e16) and skipped its curve check, which needs four.
On volumes cut short with rings planted, the candidates fall from 14–37 to 0–6,
a strong ring is judged on two clean bins a side (signal-to-noise 37 to 64,
curve 0.92 to 1.05), and a weak ring under the 6σ floor goes undetected, as
with full coverage.

The shells kept out of a judged shell's flanks are picked at half that cut,
3σ: a keep-out only protects a flank and is never subtracted, so the lower bar
is the cautious side, and a weak ring under 6σ beside a strong one (the Al 420
line at 6.95 Å⁻¹ beside the 331 at 6.76 Å⁻¹ on the 97-point demo of
`tests/test_demo.py`) no longer lifts the strong one's flank until it fails.
The lower bar can keep the crystal's own bumps out of a fully measured ring's
flanks too: on dev-rings at 161 points the 2.2 Å⁻¹ ring is judged without its
curve check, still a ring, the volume unchanged.

- **Not taken: judging a ring only on two flank bins a side or more**, else
  not judged, with a retry that keeps out the confirmed rings alone. With the
  noise from the measured bins it never fired on the volumes tried; it stays
  an option should crowded flanks show again.
- **A known limit, outside this fix.** A weak ring beside a strong one
  (amplitude 0.05 against 0.5) is subtracted at 1.2 to 2.4 times its
  amplitude in every geometry tried, full coverage included.
- **Open, for the user: the face–corner zone.** Between the box's face and its
  corner (6.44 and 11.16 Å⁻¹ on the dev crystal) a shell is measured in some
  directions only, and the isotropy test judges it on what it has: 16 to 32 of
  its 128 direction cells, where it needs 16 (`IsotropyConfig.min_cells`). On
  a synthetic cubic crystal, shells of the crystal's own pass there as rings
  whatever the noise (4.41 Å⁻¹ on a ±3 Å⁻¹ box; 5.01, 5.49, 7.29 and
  9.01 Å⁻¹ on others). With this fix, `min_cells` = 64, half the sphere,
  removes all of them, keeps every planted ring and leaves the dev cases as
  they are. Whether a ring may be confirmed from part of the sphere, and from
  how much of it, is the user's rule: `min_cells` stays 16 until they decide.

### 2. Punch Bragg And Satellite Peaks

```bash
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl PUNCH_PRESET=cc_on MODE=both \
MIN_I=0.8 INTEGER_FIT_POSITION=1 INTEGER_FIT_SHAPE=1 \
INTEGER_H_GUARD=0.12 \
SEARCH_EXCLUDE_H=-0.6667,-0.3333,0.3333,0.6667 SEARCH_EXCLUDE_H_WIDTH=0.08 \
PREVIEW=0 \
python3 examples/punch_bragg_3d.py
```

Output:

```text
data/processed/*_braggpunched.h5
```

#### Which nodes are Bragg peaks, and the grid that takes

The punch's node test (`integer_detect="significance"`, the default) takes
the brightest voxel of each integer node's window and asks whether its
integrated excess stands `min_significance` standard errors (corrected for
the window search) above the node's own background: the median of the
measured voxels in a shell between 1× and 2× the resolution ellipsoid R
(`punch_spherical_radii`, rρ, rθ, rφ = 0.097, 0.072, 0.115 Å⁻¹). The shell
tells a Bragg peak from a broad diffuse maximum at the node, which stands no
higher than its own surroundings. A median needs 8 voxels
(`_SHELL_MIN_VOXELS` in `nebula3d.analysis.bragg`, the floor of every
shell median the punch takes), and that sets the grid:

- **The limit.** The shell's Q-volume is 2³ − 1 = 7 times R's,
  (28π/3)·rρ·rθ·rφ, so 8 voxels need a voxel Q-volume of (7π/6)·rρ·rθ·rφ
  or less: a cubic voxel of 0.143 Å⁻¹ or less at the default R, about
  2·r_min. A voxel's size is the edge of a cube of its Q-volume,
  ∛(|det UB|·ΔH·ΔK·ΔL), the step itself on a cubic grid
  (`BraggRemover.voxel_edge_q`; the limit, from R and the floor,
  `BraggRemover.node_test_limit`).
- **Node by node.** The count is checked at each node, around the voxel
  judged: R turns with Q̂ and the grid does not, so the count varies with the
  direction (at the limit about one direction in twelve falls short, at 0.94
  of it none), and with the mask and the box's faces, which cut the shells of
  nodes at the edge of the measured volume.

A node whose shell holds fewer than 8 measured voxels is not judged. Before
this guard the test fell back on the window's median, which on a coarse grid
passes the diffuse at a node: a saddle's corner stands many σ above its
window's median. With `mode="both"` (the default) such a node is left to the
search pass, which punches a peak only if it stands out of its |Q| shell by
the search floors. A search peak inside the window of a node left to it, the
box the node test searches about the node, is that node's Bragg peak (the
brightest, if there are more): its record takes the node as
`source_node_hkl` and says the search found it (`found_by: "search"`; the
node test's peaks say `"integer"`), and it is punched and learned from like
the node test's peaks, the punch's Bragg profile (and the `integer_h_guard_hkl`
slab) included. A Bragg peak the search cannot see may remain: one below its
floors, the lesser error, or one in a |Q| shell too thin for its statistics
(under 20 voxels, at the box's far corners), which may be strong. With
`mode="integer"` there is no search pass to leave it to: the node is judged
against its window's median as before, provisionally. On a grid coarser than
the limit the punch says so out loud. Its done line ends on a notice, marked
⚠, such as

```text
grid too coarse for the Bragg punch's node test: a voxel is 0.161 Å⁻¹; its background shell needs ≤ 0.143 Å⁻¹. 703 of 728 nodes were not judged and were left to the search pass; Bragg peaks the search cannot see may remain. Use a finer grid.
```

with `mode="integer"`: "… 703 of 728 nodes were judged provisionally,
against their window's median; diffuse maxima at nodes may be punched. Use a
finer grid." Its line on the integer nodes counts them on any grid ("8
peaks; 703 of 728 nodes not judged (fewer than 8 measured voxels in the
background shell), left to the search pass"): on a grid finer than the limit
only the nodes at the edge of the measured volume or on the box's faces can
fall short, and the line counts them without the ⚠ notice. The nodes are the
ones the test examined, those with a measured window. The search's line
counts the Bragg peaks it found at them ("172 peaks, 172 of them the Bragg
peaks of nodes the node test left to it"), and the footprint's line what the
profile was learned from ("… the shared Bragg profile (learned from 180
peaks, 172 of them the search's at nodes the node test left to it)"; the
record's `footprint_profile.from_search`). The punch's record, its
profile beside the punched volume (`*_braggpunched_profile.json`), keeps
them as `node_test`: `examined`, `under_floor`, `min_voxels`, `voxel_q`,
`needs_q` (Å⁻¹), `left_to_search` and the `notice` (none on a grid finer
than the limit); `GET /api/bragg/{id}/profile` and the browser build serve
it. The Execution page shows the done line, and the stage's summary, as a
warning, and NEBULA Pilot's `run_log` gives the lines as written.

On the validation's dev crystal (a = 3.9 Å, ±4 r.l.u.), 81 points (0.161 Å⁻¹
a voxel) leave 2 to 6 voxels in the shell at 96 % of the nodes (703 of 728
on the control). Without the guard the test punched 29 to 106 forbidden
nodes of the crystal's FCC lattice on each case without rings (118 and 125
with them), a quarter to a half of the punched voxels, and the ⟨3/2 0 0⟩
correlation of three cases fell to 0.77–0.79 of its amplitude. With it no
forbidden node is punched (on the ring cases, where the ring removal confirms
no ring at this grid, the four and two the test judges with a full shell on
the 4.05 Å⁻¹ ring aside), the three keep 0.89–0.93, and broad maxima planted
at the (1,1,0) nodes under the search floors go unpunched, where the test
as it was punched all twelve. The search finds the Bragg peaks instead: on
the control 172, each the Bragg peak of a node left to it, and the punch
learns its profile from them and the node test's 8 (180 peaks in three |Q|
ranges; from 8 it could learn none, needing 20), so a peak whose own width it
cannot measure (within 5 voxels of the box's faces) gets the profile's
footprint, not the bare resolution ellipsoid. The ΔPDF then scores as it does
with the forbidden nodes' punches simply taken out (the control's ⟨3/2 0 0⟩
at 0.926, the ΔPDF's rms error 0.266). On five of the eight cases the search
misses all eight Bragg peaks at the box's corners (±4, ±4, ±4), on a sixth
two: their |Q| shell holds 8 voxels, under the 20 its statistics need. 161
points (0.081 Å⁻¹) leave 9 voxels or more in every node's shell, the box's
corners included: every node is judged, nothing is left to the search, and
the punch is as it was.

#### What the search leaves alone: the sample's modulation

The search pass punches sharp peaks off the lattice, satellites included. A
sample's satellites are a fact about it, declared like its symmetry
(`PipelineParams.modulation`): the wave vector k, the order and the form,
either the points G ± m·k or the planes through them. The search then leaves
them alone at every position equivalent under the symmetry.

For now a run that declares none declares the planes H = n ± 1/3 ± 0.08 r.l.u.
(k = (1/3, 0, 0) as planes), which is the protection from before declarations,
bit for bit. The punch records what its search left alone. When its sharp
peaks off the lattice bunch at one commensurate fraction, as an undeclared
modulation would leave them, it says so. The physics, the record and the
known limits are in [modulation.md](modulation.md).

### 3. Backfill Bragg Holes

```bash
PYTHONPATH=src METHOD=local \
python3 examples/backfill_bragg_3d.py
```

Output:

```text
data/processed/*_braggpunched_backfilled.h5
```

#### The fills' texture

Every punch sits on a reciprocal-lattice node, so fills that are
systematically brighter (or darker) than the diffuse around their holes print a
lattice of spots (or dimples) onto the diffuse: a texture with the lattice's
period, which the 3D-ΔPDF turns into features at the lattice vectors, where the
real pair correlations are. NEBULA Pilot asks whether the fills have such a
sign by one rule (`texture_check`, `web/src/llm/metrics/texture.ts`,
provisional):

1. **The holes** are the voxels unmeasured in the punched stage that the fill
   wrote (NaN in the punched cut, finite in the backfilled one), in connected
   components.
2. **The rim** of a hole is the measured voxels 1 to 4 voxels from it
   (chessboard distance) that the fill left as they were. The Laplace fill also
   rewrites a band `laplace_gap` voxels deep outside the punch; that band is
   fill, not rim.
3. **The range the rim allows.** The rim's trend `I = a + b·s` by least
   squares, `s` being a rim voxel's distance from the hole (1 to 4) and a hole
   voxel's 1 − its depth (0 on the hole's outer layer). The range runs from
   `a + b`, the diffuse at the hole's edge carried in, to `a + b·s̄`, the rim's
   rise continued linearly to the hole (`s̄` the hole's mean `s`). The diffuse
   peaks at the nodes, so a sound fill can sit anywhere between the two.
4. **The bias** is the signed distance of the hole's mean fill outside that
   range (0 inside it), in the rim's robust σ (1.4826 × the MAD about the
   trend) and in units of the local diffuse level (the rim's median). A rim of
   fewer than 8 voxels, of one ring, or with σ = 0 is not judged.
5. **A systematic fill bias** needs at least 5 judged holes, a median bias of
   0.5σ and a fifth of the level or more, and three quarters of the holes or
   more leaning the median's way.
6. **Room for the rim.** The rim's trend is the diffuse falling away from the
   hole's own node, which holds on that node's side of the midpoint to the
   next node only: past it the diffuse turns toward the next one. A hole that
   reaches r voxels from its centre (chessboard: its box's farthest face), its
   rim 4 more, keeps the rim on its own side when the nodes are 2·(r + 4)
   voxels apart or more. The nodes are the grid's: integer h, k and l, one
   r.l.u. apart along the coarsest axis (a supercell's parent nodes lie
   further apart, so this errs toward not judging). The rule reads the median
   hole, so a cut is judged only where its median hole has that room; else it
   says why (`not_judged`: "grid too coarse: …"), measures no bias and gives no
   verdict (`systematic_fill_bias` null). The check passes only when every cut
   it reads was judged; a judged cut's bias still needs attention. The fill's
   gap band is the rim's first ring or two, inside its four, so it adds
   nothing to the reach; it leaves the trend two rings or more while it is two
   voxels deep or less (step 4's rim of one ring). On the validation's dev
   crystal, 81 points over ±4 r.l.u. put the nodes 10 voxels apart, and the
   punch's holes reach 2 voxels from their centres on the cuts (3 in 3-D):
   their rims need 12 (14), and the cuts are not judged but where the median
   hole reaches one voxel. 161 points put the nodes 20 apart, for holes of the
   same reach.

The Pilot reads holes on cuts, the three principal planes through the origin:
a hole there is a 4-connected component of the cut, and its rim the ring
around it in the plane. A cut through a hole's edge sees a small section of it,
whose rim in the plane lies off the node, where the diffuse is rounded, so the
range the rim allows depends on where the cut crosses the hole; peaks off those
planes (satellites) are crossed at their edges only, or not at all.
`nebula3d.analysis.fill_texture` applies the same rule to every hole of the
volume in 3-D (server: `GET /api/volumes/{id}/texture` on a backfilled stage;
browser: `webbridge.volume_texture_json`, the same fields). A hole is a
6-connected component of the punch's record, which the punch stage writes into
its output (`nebula3d.pipeline.read_punch_record`); a punched file without the
record falls back on the cut's test, unmeasured in the punched stage and
measured in the backfilled one. Its rim is the voxels 1 to 4 from it in 3-D,
about 2400 around a hole three voxels in radius where a cut through its centre
holds about 160. The limits are parameters, at the Pilot's values. On a volume
one plane thick it is the Pilot's rule, hole for hole.

| Field | What it is |
| --- | --- |
| `n_holes`, `n_judged`, `judged` | The holes, those judged, and whether the rule applies: room for the rims (step 6) and enough holes judged (`min_holes`) |
| `node_spacing`, `room_needed`, `not_judged` | The voxels between the grid's nodes, those the median hole's rim needs (2·(reach + rim)), and why the grid is too coarse for the rule, if it is |
| `median_fill_bias_sigma`, `median_fill_bias_level` | The median bias in the rim's σ and in units of the level (the Pilot's fields) |
| `above_fraction`, `below_fraction` | The shares of the judged holes filled above, and below, the range their rim allows (the Pilot's) |
| `above_floor_fraction`, `below_floor_fraction` | The shares filled above, and below, it by `floor` of their level or more |
| `systematic_fill_bias` | The rule's verdict (the Pilot's) |
| `min_sigma`, `one_way`, `min_holes`, `floor` | The rule's limits: those asked for, else 0.5, 0.75, 5 and 0.2 |
| `holes_from`, `rim`, `min_rim` | Where the holes came from (`punch_record`, or `masks` for a punched file without the record), and the rim's depth and fewest voxels |
| `holes` | The `limit` holes (20 by default) farthest outside their range in units of their level, each with its `index`, `centre_hkl`, `voxels`, `rim_voxels`, `fill`, `level`, `sigma`, `slope`, `edge`, `peaked`, `bias`, `bias_sigma`, `bias_level`, and why it was `not_judged` |

Known answers on synthetic lattices, holes three voxels in radius on the nodes
of a smooth diffuse that peaks at them:

- a fill equal to the truth reads no bias at any hole;
- half the local level too high in 80 % of the holes is a systematic bias,
  0.800 of the holes above their range and beyond the floor, the median 0.51
  of the level; in 60 % of the holes it is none (0.600 above), with medians as
  large;
- a tenth of the level in every hole reads 9σ with every hole above, and is
  none: it is under the floor;
- four holes are not judged;
- the backfill's Laplace fill reads no bias, and its `q_shell` fill, on a
  diffuse sharply peaked at the nodes, a systematic bias below (−0.42 of the
  level): the node-periodic bias that makes it a fill for comparison only.

With satellites at (½, ½, 0.15) beside the nodes, all filled 12 % too high on
that sharply peaked diffuse, the volume reads nodes and satellites alike, at
0.29 of the level: a systematic fill bias. (A perfect fill there reads 0.12:
the diffuse rises faster than linearly toward the node, the rule's own caveat,
under the floor.) On the cut l = 0 the Pilot's rule reads the nodes, crossed
at their centres, at 0.28, and the satellites, crossed only at their poles, at
0.10 to 0.12, under the floor. On the cut through the nodes' poles every hole
reads under the floor (median 0.09), and that cut reads no systematic bias.

The measurement labels the holes one slab of H planes at a time, joined across
the slabs' faces, and measures each hole inside its own box. On a 401×401×301
float32 pair with 6000 holes it holds 7.4 MiB at its peak in low-memory mode
(the browser) and 23 MiB natively, and takes 1.4 s; both modes give the same
numbers. It is a measurement only: the Pilot's `texture_check` does not read
it yet.

### 4. Flatten The Radial Background (Background Removal)

```bash
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl \
python3 examples/flatten_background_3d.py
```

Output:

```text
data/processed/*_backfilled_flattened.h5
```

Sweeps spherical `|Q|` shells, fits the isotropic pedestal `const + c·F(Q)²`
to each shell's floor (p25) and subtracts it. The constant is nuclear incoherent
scattering and `F` is the magnetic ion's form factor (`ION`; set it to the
sample's magnetic ion, while the pipeline and web app default to none, a
constant only). Both
terms are self scattering, so the ΔPDF changes only at r ≈ 0, while the
anisotropic diffuse, the Bragg residuals and isotropic pair correlations are
kept. This is the explicit background-removal step. A background that
rises with |Q| (inelastic: thermal diffuse, and Compton with X-rays; leading term ∝ Q²) is not
F²-shaped: `Q2=1` adds a `b·Q²` term, held at its value past the fit range's
end, and `FIT_Q_MAX` carries the fit to the data's coverage (default 10 Å⁻¹).
Use `examples/validate_flatten.py` to check isotropy, feature retention, and
over-subtraction on your own volumes.

#### The floors and the pedestal

The flatten's **floor** of a |Q| shell is the 25th percentile of the shell's
measured voxels (`np.percentile`, linear interpolation), in shells 0.05 Å⁻¹
wide from the smallest measured |Q| to the largest; a shell with fewer than 20
measured voxels has none. The model is fitted to the floors inside the fit
range (0.8–10 Å⁻¹ by default). After a good flatten the floors sit near zero
and level at every |Q|. Floors that still rise with |Q| are a **pedestal** the
model left, most often the inelastic background (thermal diffuse and
multiphonon scattering with neutrons, Compton scattering with X-rays), whose
leading term grows as Q²: that is what `Q2=1` (the Pilot's `flattenQ2`) takes.

NEBULA Pilot judges it by one rule (`web/src/llm/metrics/flatten.ts`,
provisional), with the run's own fit range and floor percentile, as the
flattened file records them (`flatten_settings`, below; the flatten's
defaults for a file that records none, which the Pilot's results say):

1. **The shells judged** are the shells the counts reach, at least 0.95 of
   the shell's voxels measured and the centre at or past the fit range's
   start, from half the outermost such shell's |Q| outward (`judgedShells`).
   Inside, the floors follow the crystal's own diffuse level; the outer half
   is where an inelastic background is largest.
2. **The trend** is the judged floors' rank correlation with |Q| (Spearman,
   at least five shells).
3. **The span** is the judged floors' range over the diffuse level: the
   median of the flatten's input over the voxels measured both before and
   after it.
4. **A pedestal is left** when the trend is 0.8 or more in size and the span
   0.8 or more (`pedestalLeft`).

The Pilot's verdict reads those floors over the whole volume (plan 4.1:
`assess_stage`'s `floor_trend`, `floor_span_fraction` and `floor_judged_q`
for the flatten); it reports each of the three planes through the origin
beside them (hk0, h0l, 0kl; 30 shells out to each plane's farthest |Q|, its
`per_plane` numbers), and the largest floor in σ over the planes, which it
does not judge. The whole volume's are measured by
`nebula3d.preprocessing.shell_floors` (server:
`GET /api/volumes/{id}/shell-floors`; browser:
`webbridge.volume_shell_floors_json`, the same fields), on the flatten's own
shells, so on the flatten's input the floors are the flatten's own levels,
value for value. For the flattened stage it measures the flatten's input
(the backfilled stage) as well, on the same shells, and the level:

| Field | Per shell? | What it is |
| --- | --- | --- |
| `centres`, `q_edges` | yes | The shells' centres and edges (Å⁻¹) |
| `totals` | yes | The grid's voxels in the shell, measured or not |
| `counts` | yes | The volume's measured voxels in it (mask set, value finite) |
| `floors` | yes | Their floor (the `percentile`, 25 by default); `null` under `min_count` |
| `medians` | yes | Their median, the same way |
| `counts_before`, `floors_before`, `medians_before` | yes | The same of the flatten's input (`before_id`); `null` for other stages |
| `level`, `level_count` | no | The flatten input's median over the voxels measured in both, and how many: the span's denominator. Without an input, the volume's own median |
| `q_step`, `percentile`, `min_count` | no | The settings measured with: those asked for, else those the flatten recorded, else its defaults |
| `flatten` | no | The settings the flatten recorded in its output (`FlattenParams`: its `fit_q_range`, `floor_percentile`, `q2_term`, `ion`, …), `null` for a stage it did not write or a file written before it recorded them |

`floors`, `centres`, `counts` and `totals` are what `judgedShells` takes from
a plane, so the same rule reads the whole volume: the trend is `rankTrend` of
the judged `floors` in |Q| order, the span is their range over `level`, and
`pedestalLeft` judges the two. The pipeline's flatten stage records its
settings in its output (a `flatten_settings` attribute of the file's
`nebula3d` group; `examples/run_pipeline.py`, the server and the browser all
run it, the standalone `examples/flatten_background_3d.py` does not), so a
run whose flatten took another percentile is measured with it, and the rule
starts the judged shells at the run's own fit range
(`flatten.fit_q_range`). The volume's meta carries the same record
(`GET /api/volumes/{id}/meta`, `flatten_settings`), and the Pilot reads the
planes' floors with it too: at the run's percentile, over its fit range.
The Configure page's settings are not read for it: they may have changed
since the run. On a synthetic volume with an isotropic Q²
pedestal (a uniform diffuse, measured out to 6 Å⁻¹) the planes and the volume
read the same pedestal: a trend of 1 on all, a span of 0.99 on each plane and
0.94 on the volume, with the planes' floors within 0.03 of the volume's. The
spans differ by the level: a shell's voxels grow as Q² in the volume and as Q
on a plane, so the volume's median sits further out, higher where a pedestal
rises. With the same pedestal kept off the three planes, the planes read a
level floor (span 0.03–0.05) and the volume the pedestal (trend 1, span 0.96).
Where the counts fill the box instead, out to its corners, the volume's outer
half runs further than a plane's (to the cube's corner, √3 times the nearest
face's |Q|, where a plane reaches √2 times it), into shells only the
corners' voxels fill, and it reads a Q² pedestal's span larger than the
planes do, on the same construction: 1.3 times for one the planes read at
0.8 (1.2 to 1.36 times for those they read at 0.5 to 1.3).

The measurement reads the volumes one slab of H planes at a time and finds
each percentile by a radix select on the values' sort keys, narrowing a
histogram pass by pass, three passes in all, where the flatten sorts every
measured voxel at once. On a 401×401×301 float32 volume and its input, a third
of it measured, it holds 29 MiB at its peak in low-memory mode (the browser)
and 74 MiB natively, and takes 3 s (41 and 88 MiB, 6 s, with every voxel
measured); both modes give the same numbers.

### 5. Compute The 3D-ΔPDF

```bash
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl APODIZE=gaussian \
python3 examples/delta_pdf.py
```

Outputs:

```text
examples/_delta_pdf.h5
examples/_delta_pdf_hk0.png
examples/_delta_pdf_h0l.png
examples/_delta_pdf_0kl.png
```

By default the transform uses the **full `|Q|` range** (no crop), which gives the
finest real-space ΔPDF — the real-space pixel size is fixed by the `|Q|` extent
kept, not by zero-padding (see [delta_pdf.md](algorithms/delta_pdf.md)).
This matches the back-FFT consistency view, which always uses the full range.
`CROP_H=4 CROP_K=8 CROP_L=15` is an optional band-limit (smaller transform, trims
the noisier outer `|Q|` shells at the cost of a coarser real-space grid). The
background has already been removed at step 4, so the transform's own
smooth-background subtraction is **off**.
`SUBTRACT_BG=0,sigma,sigma` is the *legacy alternative*: it subtracts a smooth
per-H-plane Gaussian background inside the FFT. Use the flatten **or**
`SUBTRACT_BG`, never both — running both removes the background twice, and the
per-H-plane blur (σ_H=0) destroys the on-axis H-direction signal that the
flatten preserves.

### 6. Check ΔPDF Consistency

```bash
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl \
DATA_FILE=data/processed/your_volume_ringremoved_braggpunched_backfilled_flattened.h5 \
python3 examples/delta_pdf_consistency.py
```

The check computes the ΔPDF with the standard settings, inverse-transforms it
back to reciprocal space, and compares **data | back-FFT | residual**. A faithful
transform gives Pearson `r` close to 1 against the data's even part under
Q → −Q (`pearson_r_even`), the part the real transform keeps; against
unsymmetrised data `r` is lower by their odd part, mostly counting noise
(`odd_share`; see [the ΔPDF algorithm](algorithms/delta_pdf.md)). The
web UI exposes the same check interactively, including adjustable `|Q|` and
real-space `r` bands. It transforms what the run transformed, as the run did:
the volume the ΔPDF was made from, with the window, its σ, shape and support,
the padding and the subtractions, over the full `|Q|` range. The ΔPDF stage
records both in the ΔPDF (`source_file`, and `transform_config`, read back by
`nebula3d.pipeline.delta_pdf_settings_from_config`). Without that record it
takes the package defaults, and the flattened volume, else the backfilled one,
and says so (the response's `settings`). After a run with no crop and no `|Q|`
band (the defaults), the view with no band applied reproduces the run's own
saved check.

## Visual QA

Inspect cleanup across H:

```bash
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl USE_BACKGROUND=0 \
PUNCH_PRESET=cc_on MODE=both MIN_I=0.8 \
INTEGER_FIT_POSITION=1 INTEGER_FIT_SHAPE=1 INTEGER_H_GUARD=0.12 \
SEARCH_EXCLUDE_H=-0.6667,-0.3333,0.3333,0.6667 SEARCH_EXCLUDE_H_WIDTH=0.08 \
BACKFILL_METHOD=local H_VALUE=0.3333 \
python3 examples/explore_slice.py
```

The viewer shows raw data, removed ring intensity, punched data, and backfilled
data, with an H slider for scrubbing through the volume.

Inspect the real-space 3D-ΔPDF:

```bash
PYTHONPATH=src MPLCONFIGDIR=/tmp/mpl RMAX=50 \
python3 examples/explore_delta_pdf_ortho.py
```

This opens three linked orthogonal real-space cuts with movable cut sliders,
contrast control, and unit-cell gridlines.

## Python API

```python
import nebula3d
from nebula3d.analysis import BraggRemover, backfill_bragg, compute_delta_pdf

vol = nebula3d.load("data/processed/sample_ringremoved.h5")

remover = BraggRemover(
    mode="both",
    punch_spherical_radii=(0.097, 0.072, 0.115),  # Å⁻¹: radial, polar, azimuthal
    integer_detect="significance",  # nodes by significance, no intensity floor
    min_significance=5.0,
    integer_max_shell_fraction=0.15,  # and no broader than a Bragg peak
    integer_optimize_position=True,
    integer_optimize_shape=True,
    integer_h_guard_hkl=0.12,
    search_n_mad=4.0,
    search_floor_unit="scatter",  # search floors × the diffuse scatter
    search_min_intensity=27.0,
    search_min_prominence=27.0,
    search_exclude_h_centers=(-2 / 3, -1 / 3, 1 / 3, 2 / 3),
    search_exclude_h_half_width=0.08,
    incident_beam_ellipsoid_radii_hkl=(0.15, 0.50, 1.00),
)

punched = remover.apply(vol)
filled = backfill_bragg(punched)  # fills each hole from its surroundings
dpdf = compute_delta_pdf(filled, apodization="hann")
```
