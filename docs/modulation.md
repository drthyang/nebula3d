# The Sample's Modulation

A modulation of wave vector **k** puts sharp satellites at **G** ± m·**k** about
every node **G** of the parent lattice, up to the order m the sample shows. Off
the lattice and as sharp as Bragg peaks, they are what the Bragg punch's search
pass punches ([pipeline.md](pipeline.md), stage 2). Whether a sample has them,
and where, is a fact about the sample, like the symmetry it was symmetrised
with: the user declares it, per material, and the search leaves the positions
it implies alone. The form, points or planes, is the user's to declare; the
code never infers it. The code is `nebula3d.modulation`.

## Declaring one

A run takes the declaration from `PipelineParams.modulation` (Python), or from
a request's `modulation` (the API and the browser build), read by
`Modulation.parse`:

| Field | Meaning |
| --- | --- |
| `k` | One or more wave vectors in the volume's reciprocal axes (r.l.u.): `"1/3, 0, 0"`, several separated by `;`. Fractions are exact; a decimal is read as the simplest fraction within 0.00005 of it, so 0.3333 is 1/3 and 0.2 is 1/5. |
| `order` | The highest harmonic m, 1 to 6 (default 1). |
| `form` | `"points"` (the default when none is named) or `"planes"`. |
| `half_width` | How far from each position the search leaves alone, r.l.u. (default 0.08; above 0, below 0.5). |
| `normal` | The planes' normal, an integer vector (default: the primitive one along each k). |

`"none"` declares none. `Modulation.describe()` says what a declaration
protects in one line, and `POST /api/modulation/check` (the bridge's
`modulation_check_json`) returns that line and every position, or what is
wrong, before a run. Two generic examples:

- `{"k": "1/3, 0, 0", "form": "planes"}` protects the planes H = n ± 1/3;
- `{"k": "0.2, 0, 1/2", "order": 2}` protects the satellites G ± (1/5, 0, 1/2)
  and G ± (2/5, 0, 0) (2k = (2/5, 0, 1) is on the lattice in L).

## What it protects

**Points.** The satellites G ± m·R·k for every m up to the order and every
operation R of the point group the data were symmetrised with
(`PipelineParams.symmetry`): the star of k. Each is a box of ± `half_width`
r.l.u. on every axis. The punch shares each of its decisions across the
symmetry orbit (`BraggRemover._symmetric_keep`): a satellite left alone at one
position and punched at an equivalent one would be punched at both. So the
protection holds at every equivalent position, and where an operation shears a
box (the hexagonal 6-fold maps a square onto a parallelogram) the sheared box
is protected too: the protected voxels are closed under the group.

**Planes.** The planes through the satellites, `t·x ≡ ±m·(k·t) (mod P)`, each
± `half_width` along `t·x`. Here t is the primitive integer vector along k, or
the declared normal, and P is the period of `t·x` on the parent lattice. With
a symmetry, every image `t·M⁻¹` of the coordinate is protected the same way
(`GridSymmetry.forms`). So k = (1/3, 0, 0) gives t = (1, 0, 0), P = 1 and the
planes H ≡ ±1/3 (mod 1), and k = (1/3, 1/3, 0) the planes H + K ≡ ±2/3 (mod
1).

**The parent lattice.** G runs over the parent lattice of the punch's
indexing cell (`PunchParams.supercell`). On a cell doubled along H the nodes
are at even H, and k = (1/3, 0, 0) as planes protects H ≡ 1/3 and 5/3 (mod 2).
A position on the lattice itself, where m·k is a lattice vector, is left out:
there the punch's node test has the say.

**One predicate.** Positions are quantised to 1e-4 r.l.u., and every rule
here reads one predicate, `_band`: a coordinate within a half-width of a
centre, on a circle of the coordinate's period. That covers the punch's mask,
a slice's labels, a point's nearest position, the legacy H planes and the
bunching test below, so they agree voxel for voxel. It also makes
k = (1/3, 0, 0) as planes ± 0.08 the planes the search protected before
modulations were declared, the H fractions 0.3333 and 0.6667 ± 0.08, bit for
bit (`tests/test_modulation.py`: on a plain grid, a 6/m grid and a grid with
voxels at the band's edge itself).

## The default: nothing protected

The user decided (2026-10-19) that nothing is protected unless declared, and
that when a run's sharp peaks off the lattice bunch at one commensurate
fraction the console asks the user ([below](#the-console-and-nebula-pilot)).
Since plan 4.15's P3 that is the default: a run that declares nothing declares
`nebula3d.pipeline.default_modulation()`, which is None. Its search leaves no
position alone, its record says `declared: null`, and the bunching test reads
every sharp peak the search found off the lattice. A direct `punch_bragg` call
protects only what it is given: its `modulation` and its `PunchParams`'
legacy fields.

The planes the search protected by default before (H = n ± 1/3 ± 0.08
r.l.u., the H fractions 0.3333 and 0.6667) are declared by name now:
`{"k": "1/3, 0, 0", "form": "planes"}`, which protects them bit for bit
(`tests/test_modulation_punch.py`).

What a run that declares nothing punches that it did not before: the sharp
peaks the search finds on those planes, satellites or spurious alike. On the
validation's eight dev cases, at 81 and 161 points, the search finds none
there: the punch's holes, peak records and log are as before, and only the
record's `declared` changes, to null. Arm A on dev is as before.

**The legacy fields.** `PunchParams.search_exclude_h_centers`,
`search_exclude_h_fractions` (None by default) and
`search_exclude_h_half_width` still protect the H planes they name, and their
symmetry images, added to the declaration. A request's
`punch_search_protect_h` and `punch_search_protect_half_width`, from a console
that knows only them, keep their meaning:

- the fractions protect those H planes in place of the default declaration
  (`[]` protects none);
- the half width alone sets the declaration's half width (0 protects none).
  The default declares none, so a half width alone protects nothing.

A request with a `modulation` cannot give them as well.

## The punch's record

The punch's profile beside the punched volume (`*_braggpunched_profile.json`)
keeps `modulation`:

- `declared`, the declaration (`Modulation.to_json`);
- `cell` and `symmetry_ops`, what it was applied on;
- `legacy`, the legacy H planes;
- `bunching`, below.

`GET /api/bragg/{id}/profile` serves it, as does the bridge's
`bragg_profile_json`. `GET /api/modulation/{id}/labels` (the bridge's
`modulation_labels_slice`) gives, for a slice of the punched stage in the
volume viewer's wire format, which protected position each voxel lies in, with
a legend. It reads the run's record, never the settings a form holds now, so
the labels are the punch's own.

## When sharp peaks off the lattice bunch

An undeclared modulation leaves the search's sharp peaks off the lattice
bunched at one commensurate fraction of a coordinate. The punch measures this
(`detect_commensurate`) and records it; whether the sample has a modulation is
the user's to say.

- **Input.** The search's peaks off the lattice, those without a node, whose
  measured widths (`measured_width_hkl`) are at most twice the median of the
  peaks at the nodes on every axis: the console's "as sharp as Bragg" ratio. A
  peak not measured is left out, and with fewer than five measured peaks at the
  nodes there is no Bragg width to compare with and nothing is tested.
- **Left out.** These peaks are dropped, and so are the voxels they could lie
  in from the share that chance gives (p₀):
  - peaks within one grid step of a node on all three axes, a Bragg peak's
    wings;
  - peaks in a declared position or within one grid step of it, the flanks of
    declared satellites that noise makes local maxima (see below);
  - peaks outside the measured voxels the legacy planes leave to the search.
- **Orbits.** On symmetrised data each orbit counts once.
- **The tests.** One per coordinate and denominator q:
  - the coordinates are H, K and L, those equivalent under the symmetry counted
    as one (with 6/m, H with K and H + K);
  - q runs from 2 to the largest whose fractions a band of one grid step w keeps
    apart (`1/q > 2w/P`);
  - the hits are the peaks within w of a fraction p/q of the coordinate's period
    P, p prime to q;
  - under no bunching a peak hits with the probability p₀: the share, on the
    grid, of the voxels it could lie in that lie within w of one.

  A test fires when the binomial tail P(X ≥ hits), X ~ Bin(peaks, p₀), is at
  most α over the number of tests, α = 1.35·10⁻³ (one-sided 3σ, family-wise by
  Bonferroni), and there are at least three hits: a modulation repeats at every
  node, so one ± pair is no evidence. It asks a question and punches nothing.
- **The fraction named.** Of the tests that fire, the one whose hits lie
  nearest their fractions on average is named, then the smaller denominator.
  The others are recorded (`others`). A band of one grid step holds fractions of
  other denominators, so the tail alone would name the wrong one. On a 0.05
  r.l.u. grid, satellites at ±1/5 sit on voxels whose band also holds 1/4, 1/6
  and 2/9, and a fraction on the grid covers three voxels of a band where one
  between voxels covers two.
- **The log.** When a test fires the punch says so in one line, such as

  ```text
  sharp peaks off the lattice bunch at H ≡ ±1/5 (mod 1): 192 of 192 lie within 0.05 r.l.u. of it, where chance puts 91 (binomial tail 9.8e-63, under 0.00135 over 24 tests); the grid also fits H ≡ ±2/9 (mod 1), H ≡ ±1/6 (mod 1), H ≡ ±1/4 (mod 1); no modulation is declared there, so the search punched them
  ```

  The line names none of the words the validation's arm A reads in a run's log.

**Measured.** With peaks placed at random voxels, against α = 1.35·10⁻³:

| Grid | Peaks per run | Fired |
| --- | ---: | ---: |
| 41 points, 0.1 r.l.u. | 40 | 5 in 5000 runs |
| 81 points, 0.1 r.l.u. | 60 | none in 2000 runs |
| 161 points, 0.05 r.l.u. | 60 | 5 in 10,000 runs |

Planted families at ±1/3, ±2/5 and ±1/5 are named; their orbits count once on
6/m data. On the validation's dev cases at 81 and 161 points it fires on none,
and the punch's records, holes and log are as before.

## A protected peak comes through the search whole

A protected position's voxels are never the search's candidates, and no search
peak's punch takes them, whatever its footprint. They still count in the
search's local-maximum test, so the voxel beside a brighter protected peak is
that peak's flank, not a peak of its own. The integer pass is not affected:
the node test, its punches (held off fractional-H planes by
`integer_h_guard_hkl`) and the incident beam's punch at the origin are as
before. The thresholds are unchanged.

Until 2026-10-24 the protected voxels dropped out of the local-maximum test
too, where they scored −∞. The voxel just beyond a protected peak's box or band
could then be a local maximum, and if it stood above the search floors it
became a search peak whose punch took the protected peak with it. The legacy
planes behaved the same way. Measured before the fix and after it:

- On the exactly 6/m-symmetric test data of `tests/test_symmetry.py`, with
  Gaussian satellites of σ about 0.08 r.l.u. on a 0.1 r.l.u. grid at the star
  of k = (1/3, 0, 0), wider than a ± 0.08 protection, the satellites inside the
  grid were punched as follows:

  | Declared | Satellites punched (of 216), before | After |
  | --- | ---: | ---: |
  | nothing | 216 | 216 |
  | points, ± 0.08 | 198 | 0 |
  | planes, ± 0.08 | 0 | 0 |
  | k = (0, 0, 1/2), elsewhere | 216 | 216 |

  With the points declared, the search's punches had taken 1104 protected
  voxels; now none. The protected voxels still punched (12 with the points,
  114 with the planes) are the incident beam's, about the origin. A first
  count, of 238, had taken 22 satellites beyond the grid's edge at their
  nearest voxel, 12 of them nodes the integer pass punches; that count gave
  214 and 12 where these give 198 and 0.
- On the cubic test volume of `tests/test_modulation_punch.py` (a 0.05 r.l.u.
  grid), with satellites of σ 0.04 r.l.u. at G ± (1/5, 0, 0) declared:
  - as planes, the search had found 200 peaks one voxel beyond the band, at
    H ≡ ±0.3, flanks of about 2.8 against a floor of 1.38; now none;
  - as points, it had found 837 one voxel beyond the boxes; now none.

The search is not blinded: undeclared satellites are punched as before. The
change alters two things only: a search peak beside a brighter protected voxel
is no longer one, and a search peak's punch no longer takes the protected
voxels it reached. On the validation's dev cases, with the default of the time
(the thirds as planes), the punch's holes, records and log at 81 and 161 points are
as before, and so is arm A. The bunching test still leaves out peaks within one
grid step of a declared position, for flanks that noise makes local maxima.

## The console and NEBULA Pilot

The console declares the modulation, reads what a run's search left alone
from the run's own record, and puts the bunching to the user. It computes no
position itself: what a declaration protects is the backend's to say.

**The Configure page.** The punch's box holds the declaration in four fields,
kept as typed (`web/src/state/modulation.ts`):

- *Modulation k* (r.l.u.): the k vectors, several separated by `;`. `none`
  declares none, and a blank one leaves the run to the backend's default,
  which declares none too;
- *Form*: points (the default) or planes;
- *Order m* and *± width* (r.l.u.).

Without k the other three are unused. The note under them is the backend's
own description of what the fields declare, on the punch cell and under the
symmetry the volume declares (`POST /api/modulation/check`; in the browser
build, once its engine is up). A run's request carries `modulation`: nothing
for a blank k, `"none"`, or k, order, form and half width as typed, which the
backend reads with `Modulation.parse` and refuses, saying why, when malformed.
The console never sends the legacy `punch_search_protect_h` and
`punch_search_protect_half_width`, which the backend still reads from an older
console.

**The migration.** The browser remembers the form per dataset
(`state/configMemory.ts`). A form it remembered before declarations has its
protected H planes migrated once, when the console starts, and the old keys
go:

- an explicit value becomes k = (f, 0, 0) as planes, which protect H ≡ ±f
  (mod 1): one vector per fraction, a fraction's twin 1 − f folded into it
  ("1/3, 2/3" is k = (1/3, 0, 0)), a fraction on the lattice left out;
- `none`, or a half width of 0, declares none;
- a half width alone keeps the planes the old default protected, at that
  width (k = (1/3, 0, 0) as planes);
- a blank value, or one the old page could not read and never sent, stays
  blank: the backend's default, which declares none since P3.

**The marks follow the run.** NEBULA Pilot's leftover scan marks a leftover
off the lattice `on_protected_plane` when its voxel lies in a position the
run's search left alone. The labels are read from the run's punch record, on
the cut's own grid (`GET /api/modulation/{id}/labels`, the bridge's
`modulation_labels_slice`), never from the form, which may have changed since
the run. They are counted in `n_on_protected`, and by the punch's assessment
in `leftover_on_protected_planes` and `leftover_on_protected_planes_sharp`,
which its verdict leaves out (D5). A record from before the punch kept its
declaration marks none, and the context says so.

**The question.** When the record's `bunching` fired, the punch's assessment
(`assess_stage`) and `run_pipeline` carry `off_lattice_bunching`:

- `facts`, the measurement;
- `ask_user`, the question in definitions only, such as "14 of the 17 sharp
  peaks off the lattice sit at H = n ± 1/3, where about 2 would by chance.
  Does the sample have a modulation with k = (1/3, 0, 0)?".

With the skills on, the facts end with whose the answer is, the user's. The
answer checks hold the model to asking the question, and to not saying the
sample has the modulation ([pilot.md](pilot.md#guardrails)). The report lists
the question among its caveats.

The model declares a modulation through `update_settings` only when the
user's latest message names it. To the model it is one setting, `modulation`
(`{"k": "1/3, 0, 0", "order": 1, "form": "planes", "half_width": 0.08}`,
`"none"` or `"default"`), and `configure_settings` shows it as one line, such
as `k = (1/3, 0, 0), order 1, planes, ± 0.08 r.l.u.` (`"default"`, the
backend's own, declares none). In the validation,
declaring a modulation the task never named is an unsafe action, as any other
sample fact is.

## Known limits (plan 4.15, for P2 and P3)

**`measured_width_hkl` cannot tell broad from sharp.** The width recorded for
each peak takes its background from the median of the detection window, which
a broad maximum fills, and its core above 0.35 of the excess over that. So a
broad maximum measures about as narrow as a Bragg peak.

On the cubic test volume (a 0.05 r.l.u. grid; Bragg peaks of σ 0.04 r.l.u.,
measured 0.10 r.l.u.), maxima off the lattice of three widths gave:

| Maximum's σ (r.l.u.) | `measured_width_hkl` (r.l.u.) | Line-cut FWHM (r.l.u.) |
| --- | ---: | ---: |
| 0.04 | 0.105 | 0.092 |
| 0.06 | 0.106 | 0.145 |
| 0.1 | 0.108 | 0.23 |

Every one passes as "as sharp as Bragg". The line-cut FWHM is the one the
search's width test reads (`search_max_width_ratio`, `BraggRemover._line_fwhm`),
against 0.09 at the nodes. So the bunching test's sharp input passes maxima up
to about 2.5 times the Bragg width. The line-cut FWHM is the better measure;
recording it per peak would add a field to the punch's record.
