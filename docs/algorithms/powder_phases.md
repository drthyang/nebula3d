# Powder Phases: Which Phase Made the Extra Rings

## Purpose

The ring removal ([powder_rings.md](powder_rings.md)) fits the aluminium of
the sample environment and judges every shell it finds. Rings the Al lines
leave unexplained come from some other polycrystalline material in the beam:
inclusions of the flux the crystal grew from, another part of the sample
environment (a copper holder, steel, a vanadium can), ice, graphite, a
silicon or sapphire mount. The phase match names the library phase whose
lines fit them best, *as a possibility with its evidence*: the rings its
lines explain, its lattice scale, the lines hidden under another ring, any
strong line missing, and the rings left unmatched. It removes nothing: the
removal subtracts confirmed rings whatever their phase, and the match
changes neither the cleaned volume nor its mask (a test holds them bit for
bit).

Code: `nebula3d.preprocessing.powder_phases` (the library and the matcher),
run by the pooled ring removal (`pooled_rings._phase_match`).

## The library

`src/nebula3d/preprocessing/powder_phases.json` (`schema_version` 1,
`library_version` 2026.11-1). Each entry has its space group, a room-
temperature cell with its source, and the atoms of its cell: each site with
its coordinates (and occupancy), expanded to the whole cell by the coordinate
triplets in `ops` and the lattice `centering`. The cells and atoms are those
of the Crystallography Open Database entry named, whose original paper is
cited; each entry was expanded and checked against that COD file atom for
atom.

| Group | Phases | Sources (COD entry: paper) |
| --- | --- | --- |
| flux metals | Bi, Sb (R-3m); Sn (I4₁/amd); Ga (Cmce); In (I4/mmm); Pb (Fm-3m); Te (P3₁21); Zn (P6₃/mmc) | Bi 9009658, Sb 9009655: Schiferl & Barrett, J. Appl. Cryst. 2, 30 (1969); Sn 9012005, Pb 9012004: Straumanis, J. Appl. Phys. 20, 726 (1949); Ga 9008085: Sharma & Donohue, Z. Kristallogr. 117, 293 (1962); In 2100456: Moshopoulou et al., Acta Cryst. B 62, 173 (2006); Te 2310839: Cherin & Unger, Acta Cryst. 23, 670 (1967); Zn 9008522: Wyckoff (1963) |
| sample environment | Al, Cu, austenitic steel (Fm-3m); V, Nb, α-Fe, W (Im-3m); Ti (P6₃/mmc) | Al 9012002: Straumanis (1949); Cu 5000216: Swanson & Tatge, NBS Circ. 539 (1953); V 4302557: Evans et al., Inorg. Chem. 48, 5602 (2009); Nb 9008546, Ti 9008517: Wyckoff (1963); α-Fe 9000657: Wilburn & Bassett, Am. Mineral. 63, 591 (1978); W 9006486: Dubrovinsky & Saxena, Phys. Chem. Miner. 24, 547 (1997); steel: a typical AISI 304/316 cell (3.59 Å), a random Fe–Cr–Ni site |
| others | ice Ih (P6₃/mmc), ice Ic (Fd-3m), graphite (P6₃/mmc), Si (Fd-3m), α-quartz (P3₂21), corundum (R-3c) | ice Ih 1538173: Goto, Hondoh & Mae, J. Chem. Phys. 93, 1412 (1990); ice Ic 1541579: Shallcross & Carpenter, J. Chem. Phys. 26, 782 (1957), its H added on the O–O bonds at the Ih entry's O–H distance, half occupied; graphite 9011577: Trucano & Chen, Nature 258, 136 (1975); Si 9011998: Hom, Kiszenick & Post, J. Appl. Cryst. 8, 457 (1975); quartz 9000775: Levien, Prewitt & Weidner, Am. Mineral. 65, 920 (1980); corundum 2300448: Schreyer et al., J. Appl. Cryst. 47, 659 (2014) |

The ices are H₂O, as frost on a sample is: the hydrogen's negative
scattering length nearly cancels the oxygen's at low |Q|, so their first
lines are weak in neutrons, as measured.

**Your own phases.** A file in the same format adds phases, or replaces one
of the same `id`, and adds scattering lengths for new elements:
`load_library(extra=[path])`, or the `NEBULA3D_POWDER_PHASES` environment
variable for the pipeline. **Broad-feature entries** (polymer halos, such as
Kapton windows or GE varnish, for X-rays) go in its `broad` list: each
`{id, name, halos: [{q, fwhm}], source}`, and an entry must cite its source.
None is shipped: no halo centre and width for Kapton or GE varnish could be
taken from a source read for this library (decision for the user).

### The lines and their intensities

`Phase.lines(q_max)` enumerates every reflection up to `q_max`, computes its
structure factor from the cell's atoms, drops those whose |F|² vanishes (the
extinctions follow from the atoms: the tests hold them to each space group's
reflection conditions), and merges the reflections at one d-spacing into a
powder line, labelled by its strongest reflection. Its neutron intensity is

```
I = Σ |F_hkl|² / (V² Q²)
```

summed over the line's reflections (its multiplicity times |F|²), with the
bound coherent scattering lengths of Sears, Neutron News 3(3), 26 (1992), as
the NIST Center for Neutron Research tabulates them. It is the line's
integrated intensity per unit volume of the phase in a *reciprocal-space
volume*: a powder spreads a reflection's weight over a sphere of area 4πQ²,
so its density in the volume falls as 1/Q². That is the powder Lorentz
factor of a volume binned in Q; a constant-wavelength powder pattern has
1/(sin θ sin 2θ) instead. No Debye–Waller factor is applied per phase: the
volume's own fall-off, read off its Al lines (observed over predicted, an
exp(−B Q²/8π²) with B within 0 to 2 Å²), scales every phase alike.
Vanadium's coherent scattering power per volume is about 1/70 of
aluminium's, and its lines' with it.

The tests hold the library to the NBS/ICDD reference patterns' d-spacings
for 19 phases, to the space groups' extinctions, and, for the elements,
graphite and quartz, to the strongest line at low angle (the X-ray patterns'
form factors do not reorder that one much). The compounds' neutron
intensities have no reference pattern in the tests.

For X-rays no intensity is modelled (the form factors are not in the
library): the lines are matched by position alone, and no line is called
missing.

## The matcher

`match_phases` reads the ring stage's across-stack profile (the median over
the planes of each plane's median profile, the profile the shells are
detected in) and its excess over the SNIP baseline.

**The rings.** Every shell found above the keep-out cut (half the
detection's noise cut, 3σ by default) that sits on no fitted Al line, and
that the ring test did not show to be the crystal's own. A shell is the
crystal's own when, judged, it failed on its height or its isotropy while it
stood clear of the noise in the typical direction; a faint ring fails the
isotropy for its noise, and stays a ring here. The shells under the
detection cut, which the ring removal never judged, are judged for this, and
nothing more. Each ring's centre is refined within its bin.

**What hides a line.** The Al lines and the crystal's own shells cover the
|Q| range where no line is judged: as far as the covering shell's own peak
stands above the noise (σ√(2 ln(height/noise)), at least half its FWHM), and
half a line's width beyond.

**One scale per phase.** The phase's lines sit at Q_RT/(1 + s), one
isotropic lattice scale s within ±1.5 %. Where the data's temperature is
known (from the input's name, "22K") the scale stays on its side of room
temperature, below 250 K contracted (s ≤ +0.25 %, the margin for the spread
of library cells and an anisotropic contraction read as one scale), above
350 K expanded. A scale within 0.05 % of the window's edge is "at its
limit": the lattice the fit needs lies beyond, and the candidate is at most
possible.

**The evidence.** At each scale, each line becomes a peak of the rings'
width (a line through the confirmed rings' FWHMs over |Q|) less half of one
twice as wide, so a smooth excess under it reads as nothing; weighted by its
predicted height, the lines make a matched filter, whose correlation with
the excess, over the bins no other ring covers, is the phase's significance
in bin-noise units. The significance is taken *with the line that carries
most of it left out*: one strong ring alone cannot name a phase, since a
scale can put any phase's line on it. It is judged against the same
statistic at scales where the pattern meets the profile by chance only (±5
to ±25 %): their median and spread (1.4826 × MAD) set the null. The rings
the phase does not explain at its best scale are another source's: they are
covered, and the phase fitted again (the null kept from the first fit, where
those rings are what makes a chance match likely).

**The amount, and what else the phase predicts.** The rings a phase explains
are those within their FWHM of one of its lines, and as wide as a powder
line there (within a factor of two of the rings' width, allowing for the
phase's own lines too close to resolve): a narrow ring at high |Q|, where a
dense phase always has some line, is not taken for one. The amount they
imply is the median, over them, of a ring's integrated excess over its
lines' predicted intensity, and a ring the amount makes more than a factor
of four off is not theirs. At that amount the phase predicts every other line: a line in
measured, uncovered |Q| whose core reads lower than predicted costs it
−log₁₀ of how likely that is, the prediction uncertain by a factor of two
(log-normal: texture, absorption, extinction, Debye–Waller), an even chance
costing nothing; a line costing 1 or more is listed as missing. The score is
−log₁₀ of the chance probability (the leave-one-out significance against
the null, times the scales tried and the phases tried), less those costs.

**The status.** *Likely*: a score of 3 or more (1 in 1000), three rings
matched or more, no line missing, the scale not at its limit, and, with
neutrons, no more of the phase than ten times the fitted Al's volume (V
rings as strong as the Al's would need about 70 times). *Possible*: a score
of 1.3 or more (1 in 20) and two rings matched. Otherwise the phase is not
reported. On rings at random places (two to six, in a test), a phase is
named possible about once in 60 sets, never likely.

**The order.** Likely before possible, then by score. A flux phase whose
element is in the sample's composition (the formula the input's name holds,
"Fe3Ge2_90K" giving Fe and Ge) is given odds of ten to one in the order; it
never changes a status. Two candidates of one status within a score of 1 are
named together ("Te or Bi"): the data do not tell them apart. Others are
reported only within a score of 3 of the first.

## The record

The ring stage's diagnostics hold the match as `powder_phases`: the
library's version, the radiation, the scale window and temperature, the
volume's fall-off (`falloff_b`), the rings (|Q|, FWHM, SNR, how the removal
saw each: `ring` confirmed, `left` detected and not confirmed with why,
`weak` under the detection cut), the candidates (each with its status,
scale, rings matched of the rings, significance, score, missing cost, amount
against the Al, its lines matched, hidden and missing, the rings it leaves)
and the rings the first leaves. Each shell a candidate's line explains
carries it as its `match`, with the candidate's status, beside the Al
matches. The ring record (`GET /api/rings/{id}/diagnostics`, the browser
bridge) gives the record as `phases` and its one line as `phase_summary`;
NEBULA Pilot's `assess_stage` gives the line as `stage_phases` in the ring
result, and only where a phase was named; on a synthetic Al + Bi volume
with one ring of no phase at 3.60 Å⁻¹:

```
likely Bi flux: 5 of 6 rings matched, scale -0.3 %; lines 012 1.92,
202 3.37, 024 3.85, 116 4.22, +1 more; hidden 104 under Al111, 110 under
Al111, 122 under Al220; unmatched 3.60
```

Each list names at most four and counts the rest. The Reciprocal cleanup
page says it in one line under the stage views, the evidence behind its "?"
([web.md](../web.md)). From the Python API, `PooledRingConfig.match_phases`
turns the match off and `phase_radiation="xray"` matches positions and
polymer halos.

## Validation

**Synthetic volumes** (`tests/test_powder_phase_match.py`,
`tests/powder_phase_volumes.py`): the Al lines contracted by 0.4 % and the
rings of another library phase at its own scale, at its neutron intensities,
textured (±30 % over the directions), with noise, measured past 5.5 Å⁻¹ in
half the directions only.

| Volume | Named | Scale (planted) | Notes |
| --- | --- | --- | --- |
| Al + Bi, and a ring of no phase at 3.60 Å⁻¹ | Bi, likely | −0.5 % (−0.4 %) | 104 and 110 hidden under Al 111; 3.60 unmatched |
| Al + Sn | Sn, likely | −0.3 % (−0.3 %) | on the 0.09 r.l.u. grid; possible on a coarser one, whose bins merge 200 and 101 |
| Al + Cu | Cu, likely | −0.3 % (−0.3 %) | steel (fcc, 0.7 % smaller) only possible, at its limit: a cold lattice cannot have expanded |
| Al + the crystal's own anisotropic shells | nothing | | |
| Al + as much V as Al | nothing | | V's lines under the noise |

On a profile alone (`tests/test_powder_phases.py`): one ring names no phase;
rings at random places name none likely; a phase whose strongest line is
missing is not likely and lists it missing; V rings as strong as the Al's
are at most possible and say the amount they need.

**The validation's dev cases**: the cleaned volume, the punch, the backfill,
the flatten and the ΔPDF are the same, digest for digest, at every stage,
and the ring diagnostics too but for the new fields. No phase is named on
any dev case, the generic planted rings of the ring cases included.

**A measured volume** (local, unpublished): the match names, as a
possibility, the phase a reading by eye had found, with the lines that
reading found hidden under Al 111, and lists the ring it does not explain.
The faintest rings that reading saw lie under the keep-out cut and are not
listed.

## Limits

- One isotropic scale: a phase whose axes contract differently (Bi, Te, Zn)
  fits some lines a little off.
- The rings are those the ring stage's profile shows above its keep-out cut:
  fainter rings a finer profile shows are not listed, though the matched
  filter reads the excess at every predicted line.
- The composition comes from the input's name only; the structure overlay
  and the NeXus sample record are not read.
- The pipeline runs it with neutron intensities; X-rays (positions and
  polymer halos) only from the Python API.
- Debye–Waller and absorption per phase are not modelled: the factor of two
  per line and the Al's fall-off stand in for them.
