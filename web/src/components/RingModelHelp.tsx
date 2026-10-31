// The ring-removal stage's "?": what the models do, then the selected model's
// formula and what each term is, with the form's values in it. It replaces
// the schematic the stage used to draw (THY-47). UI text only: nothing here
// is read by the agent.
//
// The formulas mirror the computation:
//   pooled     → nebula3d.preprocessing.pooled_rings
//   global_v2  → nebula3d.preprocessing.global_rings
//   parametric → nebula3d.preprocessing.parametric_ring
//   patched    → nebula3d.preprocessing.radial_background (PatchedRadialRingModel)

import type { ReactNode } from "react";

/** A value from the form, or the default it stands for when blank. */
const val = (raw: string, dflt: string) => (raw.trim() === "" ? dflt : raw.trim());

function Formula({ children }: { children: ReactNode }) {
  return <span className="ring-help-eq">{children}</span>;
}

/** One "term: what it is" line. */
function Term({ t, children }: { t: ReactNode; children: ReactNode }) {
  return (
    <span className="ring-help-term">
      <span className="ring-help-sym">{t}</span> {children}
    </span>
  );
}

const I = () => (
  <>
    <i>I</i>
    <sub>ring</sub>
  </>
);

export function RingModelHelp({
  model,
  sectors,
  window,
  fourier,
  patches,
  lmax,
}: {
  model: string;
  sectors: string;
  window: string;
  fourier: string;
  patches: string;
  lmax: string;
}) {
  let name: string;
  let body: ReactNode;
  if (model === "global_v2") {
    name = "Global 3D";
    body = (
      <>
        <Formula>
          <I />(<b>Q</b>) = Σ<sub>j</sub> PV<sub>j</sub>(|<i>Q</i>|) · <i>A</i>
          <sub>j</sub>(<b>Q̂</b>)
        </Formula>
        <Formula>
          <i>A</i>
          <sub>j</sub> = max(0, Σ<sub>ℓm</sub> β<sub>jℓm</sub> <i>Y</i>
          <sub>ℓm</sub>(<b>Q̂</b>)), ℓ ≤ {val(lmax, "4")}
        </Formula>
        <Term t="j">a powder shell; PV its pseudo-Voigt line in |Q|</Term>
        <Term t={<>Y<sub>ℓm</sub></>}>real spherical harmonics: the shell&apos;s texture over directions</Term>
        <Term t="μ, σ">the fitted ring and its uncertainty: Conservative subtracts max(0, μ − zσ), Fitted mean μ</Term>
      </>
    );
  } else if (model === "parametric") {
    name = "Parametric";
    body = (
      <>
        <Formula>
          <I />(|<i>Q</i>|, φ) = Σ<sub>i</sub> PV<sub>i</sub>(|<i>Q</i>|) · <i>T</i>
          <sub>i</sub>(φ)
        </Formula>
        <Formula>
          PV<sub>i</sub> = η<i>L</i> + (1 − η)<i>G</i>, peak 1
        </Formula>
        <Formula>
          <i>T</i>
          <sub>i</sub>(φ) = <i>a</i>
          <sub>0</sub> + Σ<sub>n≤{val(fourier, "8")}</sub> (<i>a</i>
          <sub>n</sub> cos nφ + <i>b</i>
          <sub>n</sub> sin nφ) ≥ 0
        </Formula>
        <Term t="i">a ring; L and G its Lorentzian and Gaussian line shapes</Term>
        <Term t={<>T<sub>i</sub></>}>its amplitude round the ring (φ, in the fitted plane)</Term>
      </>
    );
  } else if (model === "patched") {
    name = "Patched";
    body = (
      <>
        <Formula>
          ring<sub>k</sub>(|<i>Q</i>|) = max(0, prof<sub>k</sub>(|<i>Q</i>|) − base<sub>k</sub>(|<i>Q</i>|))
        </Formula>
        <Formula>
          <I />(|<i>Q</i>|, φ) = the order-{val(fourier, "8")} Fourier series in φ fitted to ring<sub>k</sub> at each |Q|
        </Formula>
        <Term t="k">an azimuthal patch, 1…{val(patches, "36")}</Term>
        <Term t={<>prof<sub>k</sub></>}>the patch&apos;s radial profile, a trimmed mean (Bragg peaks left out)</Term>
        <Term t={<>base<sub>k</sub></>}>the baseline under the rings (SNIP, wider than a ring)</Term>
      </>
    );
  } else {
    name = "Pooled";
    body = (
      <>
        <Formula>
          <I />(|<i>Q</i>|, φ) = max(0, <i>P</i>
          <sub>s</sub>(|<i>Q</i>|) − base<sub>s</sub>(|<i>Q</i>|)) · env(|<i>Q</i>|)
        </Formula>
        <Term t="s">the azimuthal sector holding φ, 1…{val(sectors, "72")}</Term>
        <Term t={<>P<sub>s</sub></>}>
          weighted median of the sector profiles over s ± 1 and the planes within ±{val(window, "5")}° on the ring
          sphere (Bragg peaks are outvoted)
        </Term>
        <Term t={<>base<sub>s</sub></>}>the baseline under the rings (SNIP, one window per ring cluster)</Term>
        <Term t="env">a flat-topped window, ±1.5 FWHM, round each ring confirmed in nearly every direction</Term>
      </>
    );
  }
  return (
    <span className="ring-help">
      <span className="ring-help-lead">
        Pooled (default) reads each ring in small cells pooled across neighbouring planes, so it follows rings whose
        |Q| and width wander with direction; Global 3D infers whole powder shells; patched and parametric fit plane by
        plane, for comparison.
      </span>
      <span className="ring-help-model">{name}</span>
      {body}
    </span>
  );
}
