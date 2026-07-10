# Physics review, improvement plan & public-release validation roadmap — 2026-07-09

Scope: (1) confirm the NEBULA3D reduction workflow is *physically reasonable*
stage by stage; (2) propose a prioritized improvement plan with the governing
equations and literature references; (3) lay out a comprehensive validation
roadmap to take the app to a public 1.0 release.

Reviewed: `analysis/delta_pdf.py`, `core.py`, `io/mantid_nxs.py`,
`preprocessing/radial_flatten.py`, `preprocessing/backfill.py`,
`preprocessing/radial_background.py`, `analysis/bragg.py`,
`analysis/bragg_fill.py`, `pipeline.py` (stage order + consistency metrics),
`server/consistency.py`, the algorithm docs, the 216-function test suite, and
the `TbTi3Bi4` 22/45/100 K reduction artifacts in `data/processed/`.

---

## 0. TL;DR verdict

**The transform chain is physically sound and internally consistent.** The parts
that are easy to get wrong — the reciprocal↔real convention (the factor of 2π),
the centred-FFT recipe, the DC/window ordering, the real-part projection, and the
stage order — are all correct and, in most cases, guarded by a regression test.
I found **no physics bug** in the core pipeline.

What stands between the current beta and a defensible public release is **not**
correctness of the code but **validation of the result** and **disclosure of the
model's assumptions**:

| # | Finding | Class | Priority |
|---|---------|-------|----------|
| F1 | The back-FFT "consistency check" is a *self* round-trip; because the Gaussian-window transform is analytically invertible, `r≈1` is guaranteed for correct code **regardless of whether the cleaning was physically right**. There is no validation against a known ground truth. | Validation gap | **P0** |
| F2 | The centrosymmetry (real-part) assumption is **never checked at runtime**. The docs advertise the imaginary part as a diagnostic, but `‖Im‖/‖Re‖` is not computed or surfaced anywhere in the source. Un-symmetrized input silently loses its antisymmetric part. | Correctness robustness | **P0** |
| F3 | The ΔPDF is a **relative** map, not absolute. The radial flatten removes the isotropic component (Laue-monotonic + isotropic SRO + incoherent) and the FFT is not normalized to absolute units — so amplitudes are not calibrated occupancies/displacements. | Interpretation (must document) | **P1** |
| F4 | **Thermal diffuse scattering (TDS) is not separated** from static short-range order. Its anisotropic part passes straight into the ΔPDF. The 22/45/100 K series makes the standard temperature-difference remedy available but it is not offered. | Interpretation (must document) | **P1** |
| F5 | Real-space display **assumes orthogonal axes**. For monoclinic/triclinic UB the per-axis Å labels are right but the orthoslice geometry ignores inter-axial angles. Fine for the current `mmm` data; a public tool will meet oblique cells. | Correctness (oblique cells) | **P2** |
| F6 | **Punch-and-fill bias** under the peaks is un-quantified. Standard in the field and generally small, but it feeds the documented near-origin spike and should be bounded on synthetic data. | Validation gap | **P2** |
| F7 | Release hygiene: dependencies are lower-bound only; no `CITATION.cff`/DOI; browser-vs-native parity is claimed byte-identical but **not asserted in CI**. | Release engineering | **P2** |

The rest of this document backs each of these up and turns them into a concrete,
gated roadmap.

---

## 1. Physical-reasonableness review

### 1.1 What the workflow computes

The 3D-ΔPDF is the Fourier transform of the *diffuse* single-crystal scattering
(Weber & Simonov 2012; Simonov, Weber & Steurer 2014):

```text
Δρ(r) = FT[ I_diffuse(Q) ] = FT[ I_total(Q) − I_Bragg(Q) ]
```

`Δρ(r) > 0` ⇒ more interatomic pairs at separation **r** than in the average
structure; `< 0` ⇒ fewer. The reduction produces `I_diffuse` by, in order:

```text
rings → punch → backfill → flatten → FFT → (back-FFT check)
  1       2         3          4        5         6
```

This ordering is physically correct: remove polycrystalline contamination (1),
remove the average-structure Bragg content (2–3), remove the isotropic radial
pedestal (4), then transform (5). Each governing equation below was checked
against the implementation.

### 1.2 Convention & calibration — verified correct

This is the highest-risk item in any PDF code and it is right here.

**Momentum-transfer convention.** Mantid stores a *crystallographic* orientation
matrix with `|UB_c·hkl| = 1/d`. On read, `io/mantid_nxs.py:178` scales it by 2π:

```text
UB = 2π · UB_c        ⇒   Q = UB · [h k l]ᵀ ,   |Q| = 2π/d      (physics convention)
```

**Reciprocal metric** (used for the Q-space punch and |Q| shells):

```text
g = UBᵀ UB ,        |Q|² = [h k l] g [h k l]ᵀ
```

**Real-space calibration.** The direct-lattice vectors are the columns of

```text
A = 2π (UBᵀ)⁻¹ = 2π (UB⁻¹)ᵀ            (delta_pdf.py:296, direct = 2π·inv(UB).T)
```

which satisfies the defining duality `aᵢ · bⱼ* = 2π δᵢⱼ` with `bⱼ* = UB[:,j]`. The
FFT axis `x_frac = fftshift(fftfreq(N, Δh))` is the fractional cell coordinate
conjugate to `h`; converting to Å by `x = x_frac · ‖a‖` is **exact for orthogonal
cells**. The `|Q|` used for `q_max` (`norm(UB·hkl)`, physics 2π) and the real-space
`‖a‖ = 2π‖(UB⁻¹)ᵀ[:,0]‖` therefore use the *same* convention — internally
consistent. Reference: Busing & Levy (1967) for the UB/orientation matrix.

> Caveat F5: for non-orthogonal `A` the true separation is
> `r = x·a + y·b + z·c`, which mixes axes; the viewer plots on a rectangular
> `(x,y,z)` grid. Correct labels, approximate geometry, for oblique cells only.

### 1.3 The centred transform — verified correct

The input stores `Q=0` at the array centre (`s//2`), but `fftn` treats index
`[0,0,0]` as the origin. The implemented recipe (`delta_pdf.py:231–278`) is:

```text
Δρ = fftshift( fftn( ifftshift( w ⊙ (I − ⟨wI⟩) ) ) ).real
```

with, in exactly this order:

1. **Window then DC-subtract.** The separable window `w` (Hann default) is applied
   first, then the mean of the *windowed* data is removed so `Σ = 0` exactly. This
   is the correct order — subtracting before windowing leaves `∫(I−μ)w dQ ≠ 0`, a
   spurious `r=0` spike. ✓
2. **Symmetric zero-pad** to `next_fast_len` keeps `Q=0` on the new centre.
   One-sided padding would reintroduce a linear phase ramp. ✓
3. **`ifftshift → fftn → fftshift`** is the textbook centred-FFT identity for a
   centre-origin array. The missing `ifftshift` was the 2026-06-05 sign-parity bug;
   it is now guarded by `test_delta_pdf_centring_positive_peak`. ✓
4. **Real part** is valid because `mmm`-symmetrized `I(Q)=I(−Q)` ⇒ the transform is
   real; the imaginary part is numerical noise **for properly symmetrized input**
   (see F2). ✓
5. **Zero-padding is sinc interpolation**, not added resolution — resolution is set
   by the `|Q|` extent and the apodization. Correctly documented. ✓

The inverse `invert_delta_pdf` inverts each step; for the Gaussian window (never
zero) the deapodization is well-posed, for Hann the vanishing edge planes are
clamped and flagged unreliable. ✓

### 1.4 Cleaning stages — physically motivated

**Powder rings (subtractive only).** Model
`I_ring(Q,φ) = T(φ)·Σᵢ Aᵢ G(|Q|−qᵢ, σᵢ)` with azimuthal texture `T(φ)`; only the
azimuthally-smooth ring intensity is subtracted, never masked on radial excess
(which can be genuine diffuse). Physically sound. Known limitation, already
documented: the fitted `T(φ)` contrast is compressed toward its φ-mean (≈½ the
true swing at bright shells), causing differential over/under-subtraction that the
mean removal-% metric is blind to.

**Bragg punch (quadratic-form kernel).** A peak at `(h₀,k₀,l₀)` is removed where

```text
δᵀ A δ ≤ 1 ,   δ = (h−h₀, k−k₀, l−l₀)
```

with `A = g/ρ²` for an isotropic Q radius, `A = Pᵀ diag(1/r²) P` for per-axis Q
radii, or a fitted tilted 3×3 covariance. Physically this is the right object: the
peak profile is a function of **Q** (instrument resolution + size/strain/mosaic),
not of the lattice constants, so an Å⁻¹ resolution floor transfers across lattice
constant and temperature. This is a genuine strength of the design. Default
`punch_frame="q"`, `punch_q_radii=(0.097,0.072,0.115)` Å⁻¹.

**Backfill.** `q_shell` fills each Bragg hole from the robust radial background at
the same `|Q|`; the ring-shell fill interpolates radially across the thin shell
from uncontaminated neighbours (no assumption on diffuse shape, C¹ at the shell
edge). Physically motivated because the diffuse varies smoothly in `|Q|` over a
thin shell. See F6 for the residual bias.

**Radial flatten.** Subtracts a smooth per-shell floor `bg(|Q|)` (p25 default):

```text
I'(Q) = I(Q) − bg(|Q|) ,   bg(|Q|) = P₂₅{ I : |Q| in shell }
```

Because `bg` is a function of `|Q|` **alone**, it cannot create or distort any
anisotropic real-space structure — it only shifts the radial mean. This is the key
guarantee and it holds (regression: `test_radial_flatten.py`). The physical
trade-off is F3: the isotropic diffuse (Laue-monotonic, isotropic SRO) is removed
along with the pedestal.

### 1.5 The consistency check — necessary but not sufficient (F1)

`pdf_consistency_check` inverts the ΔPDF and reports Pearson `r` and normalized
RMS over the reliably-recovered region:

```text
r = corr(I_recon, I_data) ,   nRMS = ‖I_recon − I_data‖ / ‖I_data‖   (over the window)
```

This is exactly the right gate for **code correctness** — an axis swap, sign flip,
normalization slip, or over-aggressive crop/apodization would drop `r`. But the
forward+inverse pair is analytically exact for the Gaussian window, so **`r≈1` is
guaranteed by construction whenever the code is correct**, independent of whether
the ring/punch/backfill/flatten stages produced a *physically correct*
`I_diffuse`. The reduction artifacts confirm this: the shipped runs report
`r ≈ 0.9996`. That number validates the transform, not the science. Closing this
is P0 (§3, Tier V1).

---

## 2. Improvement plan (equations + references)

Ordered by priority. Each item states the physics, the change, and the acceptance
signal.

### P0-A — Runtime centrosymmetry / symmetry QC (fixes F2)

**Physics.** The real-part projection is valid iff `I(Q)=I(−Q)`. For imperfectly
symmetrized or non-centrosymmetric input, the dropped antisymmetric part carries
real signal (size-effect diffuse is the classic asymmetric case; Welberry 2004).

**Change.** In `compute_delta_pdf`, before discarding the imaginary part, compute
and record

```text
η_asym = ‖Im{ fftn(...) }‖₂ / ‖Re{ fftn(...) }‖₂
```

Surface `η_asym` in the ΔPDF metadata, the consistency JSON, and the AI-assistant
metric block; **warn** above a threshold (e.g. `η_asym > 0.05`). Also add an input
QC that measures the Friedel/Laue residual of the *loaded* volume,
`‖I(Q)−I(−Q)‖/‖I(Q)‖`, and reports the assumed vs detected Laue class. Cheap (one
norm on an array already in hand), high value.

**Acceptance.** Synthetic centrosymmetric input ⇒ `η_asym < 1e-6`; a deliberately
antisymmetric perturbation is flagged.

### P0-B — Ground-truth end-to-end validation harness (fixes F1)

**Physics.** For occupational short-range order (binary A/B, concentration `c`,
scattering-length contrast `Δb`), the Warren–Cowley diffuse intensity is

```text
I_SRO(Q) = N c(1−c) (Δb)² Σ_{lmn} α_{lmn} cos(Q · r_{lmn})
```

whose transform is, by construction, a set of δ-like ΔPDF peaks at `r_{lmn}` with
amplitudes ∝ the Warren–Cowley parameters `α_{lmn}` (Warren 1990; Welberry 2004).
This gives an **analytic ground truth** for the entire transform + calibration.

**Change.** Add `tests/test_endtoend_groundtruth.py`:

1. Synthesize `I_SRO(Q)` on a representative UB grid from a chosen `{α_{lmn}}`;
   assert `compute_delta_pdf` recovers peaks at the correct `r_{lmn}` (in Å),
   with the correct **sign** and relative amplitude.
2. Superimpose Bragg δ-peaks at integer nodes + a synthetic powder ring + an
   isotropic `bg(|Q|)` pedestal; run the **full pipeline** and assert the
   recovered `α_{lmn}` are unchanged within tolerance (proves punch/backfill/
   flatten preserve known correlations and don't manufacture new ones).
3. Add a **supercell** ground truth: build an N×N×N supercell with explicit random
   disorder, compute `I(Q)=|F(Q)|²`, bin to the grid, run the pipeline, and
   compare the ΔPDF to the supercell's real-space pair-difference (the
   DISCUS/Scatty-style check; Proffen & Neder 1997; Paddison 2019).

**Acceptance.** Peak positions within one real-space pixel; recovered `α`
correlation to truth `≥ 0.98`; near-origin spike (F6) bounded and reported.

### P1-A — Document (and optionally provide) absolute normalization (fixes F3)

**Physics.** Quantitative PDF work needs the *properly normalized* total
scattering structure function. In the Faber–Ziman / Warren formulation,

```text
S(Q) = [ I_coh(Q) − (⟨b²⟩ − ⟨b⟩²) ] / ⟨b⟩²
```

with the Laue-monotonic term `⟨b²⟩−⟨b⟩²` and self/incoherent scattering removed,
placed on an absolute scale (Krogh-Moe 1956; Norman 1957). The current radial
flatten *approximates* removal of the isotropic terms with a p25 floor but is not
tied to `⟨b²⟩−⟨b⟩²` and keeps no absolute scale, so the ΔPDF is qualitative.

**Change.** (a) Add a "What this ΔPDF is and isn't" limitations page stating
explicitly that amplitudes are relative and the isotropic SRO component is removed.
(b) Optional quantitative path: an absolute-scale/self-scattering step
(composition-aware `⟨b²⟩`, `⟨b⟩`) behind a flag, for users who want to compare to
a model on an absolute scale.

**Acceptance.** On a composition with known `⟨b²⟩,⟨b⟩`, the normalized `S(Q)→1` at
high `Q`; documented limitation reviewed.

### P1-B — Temperature-difference / TDS-aware workflow (fixes F4)

**Physics.** One-phonon TDS scales as

```text
I_1(Q) ∝ Σ_j (Q·e_j)² / ω_j² · [ n(ω_j) + ½ ]      (Willis & Pryor 1975)
```

anisotropic, peaked near Bragg positions, and strongly temperature-dependent
through the Bose factor `n(ω)`. Its anisotropic part survives the radial flatten
and enters the ΔPDF as phonon correlations, confounding static SRO. The standard
separation is a temperature difference `I(T_low) − I(T_high)` (or scaled), which
cancels the T-independent static disorder-free background and isolates the
ordering component — directly enabled by the 22/45/100 K series already on disk.

**Change.** Add a difference-map mode (align two reduced volumes on a common grid,
subtract with an optional scale, then transform) and document that a single-T
ΔPDF mixes static SRO and TDS.

**Acceptance.** `ΔPDF[I(22 K) − I(100 K)]` isolates the low-T (magnetic/order)
correlations; regression on the shipped `TbTi3Bi4` volumes.

### P2-A — Oblique-cell real-space geometry (fixes F5)

**Change.** When `A = 2π(UBᵀ)⁻¹` is non-orthogonal beyond a tolerance, either warn
in the viewer or render orthoslices on the true metric (interpolate the ΔPDF onto
Cartesian `r = x·a+y·b+z·c`). **Acceptance:** a monoclinic synthetic shows peaks at
the crystallographically correct Cartesian separations.

### P2-B — Bound the punch-and-fill bias (fixes F6)

**Physics.** Filling a punched peak with the local diffuse background replaces the
true (unknown) under-peak diffuse `I_d` with an estimate `Î_d`; the error
`(I_d−Î_d)` inside the punch convolves with the ΔPDF, concentrated at low `r`
(Kobas, Weber & Steurer 2005; Simonov et al. 2014). **Change:** on synthetic data
where `I_d` is known, report the fill residual and its ΔPDF footprint vs `r`; expose
a taper-width knob to trade Gibbs ripple against leakage. **Acceptance:** near-origin
artifact quantified and shown to fall below the correlation features beyond a
documented `r_min`.

### P3 — Reproducibility knobs

FFT worker count, percentile/estimator defaults, and float64 are already
deterministic; add a single `provenance` block written into every output (package
version, all stage parameters, UB, git SHA) so a figure can be regenerated exactly.

---

## 3. Public-release validation roadmap

Six tiers. Each has explicit acceptance criteria and a CI hook. The gate for a
1.0 tag is **all of V0–V4 green in CI plus the V5 checklist complete.**

### Tier V0 — Numerical invariants (mostly present; formalize)

Property tests that must hold for *any* input, independent of ground truth:

- **Reality/centrosymmetry:** `η_asym < 1e-6` for symmetrized input (P0-A). 
- **Linearity of the flatten:** flatten commutes with scaling/offset in `|Q|`.
- **Parseval / energy:** `Σ|I−μ|²·(window)² ≈ (1/N)Σ|Δρ|²` within tol.
- **Inversion exactness:** Gaussian-window round trip `r > 1−1e-6` on odd grids;
  the known small even-grid unpaired-centre error is bounded and asserted.
- **Convention round trip:** `UB → A → UB` recovers UB; `|Q|` matches an
  independent `2π/d` computation from lattice constants.

*CI: extend the existing `pytest` job; these are fast and deterministic.*

### Tier V1 — Ground-truth recovery (the P0 gap)

The `test_endtoend_groundtruth.py` harness of P0-B: analytic Warren–Cowley SRO,
then full-pipeline recovery with Bragg+ring+pedestal contamination, then a
supercell cross-check. **Acceptance:** peak positions ≤ 1 px, `α`-recovery
correlation ≥ 0.98, cleaning stages preserve known correlations.

*CI: a "physics" job (small grids, < 1–2 min).*

### Tier V2 — Cross-validation against reference software

Run one shared synthetic input through NEBULA3D and an independent implementation:
**Yell** (Simonov, Weber & Steurer 2014), **meerkat** (Simonov), **DISCUS**
(Proffen & Neder 1997), or **Scatty** (Paddison 2019). Compare the ΔPDF maps
(normalized cross-correlation, peak table). **Acceptance:** documented agreement on
peak positions and signs; discrepancies explained (window, normalization).

*CI: manual/nightly (external tools); archive the comparison as a report.*

### Tier V3 — Real-data physical sanity

On the `TbTi3Bi4` 22/45/100 K series: (a) ΔPDF respects the crystal's Laue
symmetry (`Δρ(r)=Δρ(−r)` and point-group images agree); (b) correlation peaks fall
on real lattice vectors / bond directions; (c) the temperature-difference map
(P1-B) sharpens the ordering signal; (d) parameter-sensitivity sweep (punch radius,
apodization, floor percentile) shows the interpretation is stable, not an artifact
of one setting. **Acceptance:** a short reproducible QA notebook/report.

### Tier V4 — Engine parity & robustness

- **Browser ↔ native parity asserted in CI**, not just claimed: run a small volume
  through both `nebula3d` (native) and the Pyodide bridge and assert bit-identical
  (or within-tol) stage artifacts and consistency metrics.
- **Input robustness/fuzz:** malformed `.nxs`, missing `experiment0`/UB, NaN/Inf,
  non-orthogonal UB, wrong dim ordering, empty masks — each must fail loudly with a
  clear message, never silently mis-calibrate.
- **Low-memory equivalence** (already verified once) becomes a standing test.

*CI: add a Pyodide/headless job for the parity + fuzz cases.*

### Tier V5 — Release engineering checklist (F7)

- [ ] **Limitations & assumptions page** (relative amplitudes, isotropic-SRO
  removal, TDS not separated, orthogonal-cell display, symmetrization assumed
  upstream) linked from the README and the web About panel.
- [ ] **`CITATION.cff` + archived DOI** (Zenodo) so the tool is citable; a
  short methods note or preprint describing the pipeline.
- [ ] **Dependency bounds** — add tested upper caps or a locked environment
  (`numpy`/`scipy` FFT and `percentile` behavior can shift across majors).
- [ ] **Provenance block** in every output (P3).
- [ ] **Versioned, documented file formats**; migration note while pre-1.0.
- [ ] **Reproducible example** end-to-end from a public sample dataset (deposit a
  small real or synthetic `.nxs` so the Quick Start runs with zero private data).
- [ ] **Coverage of the Bragg guard/exclusion behavior in CI** (already flagged
  open in ROADMAP Phase 5).
- [ ] **Web security note** confirming client-side-only processing (only the LLM
  chat call leaves the machine) — already true; state it in a SECURITY.md.

### Gate summary

```text
1.0 release ⇐  V0 ∧ V1 ∧ V3 ∧ V4  green in CI
              ∧ V2 documented (nightly/manual)
              ∧ V5 checklist complete
```

---

## 4. References

- Weber, T. & Simonov, A. (2012). *Z. Kristallogr.* **227**, 238–247 — 3D-ΔPDF concepts.
- Simonov, A., Weber, T. & Steurer, W. (2014). *J. Appl. Cryst.* **47**, 2011–2018 — experimental uncertainties of 3D-ΔPDF; punch-and-fill.
- Simonov, A., Weber, T. & Steurer, W. (2014). *J. Appl. Cryst.* **47**, 1146–1152 — Yell (3D-ΔPDF refinement).
- Kobas, M., Weber, T. & Steurer, W. (2005). *Phys. Rev. B* **71**, 224205/224206 — punch-and-fill origins.
- Egami, T. & Billinge, S. J. L. (2012). *Underneath the Bragg Peaks*, 2nd ed., Pergamon — total scattering / PDF theory.
- Warren, B. E. (1990). *X-ray Diffraction*, Dover — Laue-monotonic & self-scattering; SRO diffuse.
- Welberry, T. R. (2004). *Diffuse X-ray Scattering and Models of Disorder*, IUCr/OUP — size-effect (asymmetric) diffuse, SRO.
- Welberry, T. R. & Weber, T. (2016). *Crystallogr. Rev.* **22**, 2–78 — "One hundred years of diffuse scattering."
- Busing, W. R. & Levy, H. A. (1967). *Acta Cryst.* **22**, 457–464 — UB/orientation matrix convention.
- Krogh-Moe, J. (1956). *Acta Cryst.* **9**, 951–953; Norman, N. (1957). *Acta Cryst.* **10**, 370–373 — absolute-scale normalization.
- Willis, B. T. M. & Pryor, A. W. (1975). *Thermal Vibrations in Crystallography*, CUP — TDS.
- Proffen, T. & Neder, R. B. (1997). *J. Appl. Cryst.* **30**, 171–175 — DISCUS.
- Paddison, J. A. M. (2019). *Acta Cryst.* **A75**, 14–24 — Scatty (fast diffuse from atomistic models).
- Chambolle, A. & Pock, T. (2011). *J. Math. Imaging Vis.* **40**, 120–145 — TV primal-dual (backfill fallback).
```
