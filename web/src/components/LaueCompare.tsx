// "Compare Laue classes": the symmetry average's evidence on the Configure
// page. Runs the backend's comparison (api/client.ts compareLaueClasses: every
// candidate class by R_int, on every measured voxel and on the diffuse) with
// the run's settings, shows its progress, then the table: the classes indented
// by the chain of subgroups below them, χ²/dof beside R_int, the suggested
// row and why, the rows the diffuse reading flags, the classes refused and
// why; under it a line each for χ²/dof and the block bootstrap behind the
// standard errors, and the common-subset diagnostic (its flag, and the classes
// on it in a disclosure). A click on a row sets the Laue class; the user runs
// it. state/laueCompare.ts words the rows.

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";

import { compareLaueClasses } from "../api/client";
import type { LaueComparison, LaueProgress, StageParamsIn } from "../api/types";
import {
  bootstrapLine,
  CHI2_LINE,
  commonLine,
  commonRows,
  diffuseLine,
  formatChi2,
  formatRint,
  laueCompareParams,
  laueRows,
  LAUE_RULE_DELTA,
  LAUE_RULE_Z,
  refusalText,
  RINT_LINE,
  verdictLine,
  type CellView,
} from "../state/laueCompare";
import { HelpTip } from "./ui";

/** The settings the comparison reads (laueCompareParams), and the volume: what makes an earlier result another's. */
function settingsKey(volumeId: string, params: StageParamsIn, extra: readonly string[]): string {
  const read = laueCompareParams(params) as Record<string, unknown>;
  return JSON.stringify([volumeId, Object.keys(read).sort().map((k) => [k, read[k]]), extra]);
}

// The last comparison of each volume in this session, so leaving the page and
// coming back keeps the table (the backend keeps the numbers too).
const lastByVolume = new Map<string, { key: string; result: LaueComparison }>();

function Cell({ c }: { c: CellView }) {
  return (
    <td className={`laue-cell laue-cell--${c.state}`} title={c.title}>
      <span className="laue-rint">{c.value}</span>
      {c.detail && (
        <span className="laue-detail">
          {c.lead}
          {c.tail && <span className="laue-tail">{c.tail}</span>}
        </span>
      )}
    </td>
  );
}

const RINT_HELP = (
  <>
    R_int = Σ|I − ⟨I⟩| / Σ|I| over the measured voxels of the orbits measured at least twice, with the symmetry average&apos;s
    own orbits: 0 when equivalent voxels agree exactly. Only measured voxels count, in orbits with two or more of them: an
    empty voxel is never a zero. <b>Noise floor</b>: the R_int counting noise alone would give on the same orbits, from σ.
    R_int grows with the orbits&apos; size even then, so classes are compared in units of it (&quot;1.00× noise&quot; is
    agreement to the counting noise). <b>All</b> reads every measured voxel, where the Bragg peaks weigh most;{" "}
    <b>Diffuse</b> masks a sphere around each Bragg node of the punch cell. <b>The rule</b>: a class rises against a subgroup
    when its ratio exceeds the subgroup&apos;s by more than {Math.round(100 * LAUE_RULE_DELTA)}% and {LAUE_RULE_Z} standard
    errors of the difference (a block bootstrap, below); it is supported when it rises against none of its subgroups and all
    of them are supported. The suggestion is the
    supported class with the most operations in every reading that can tell the classes apart (pooling whole |Q| shells,
    the last row, must rise too; else no class can be preferred). ⚠ marks the diffuse supporting less than all voxels: the
    Bragg peaks would impose their symmetry on it. <b>Limits</b>: twinning, or domains related by an operation the sample
    lacks, make a lower symmetry look higher, and R_int alone cannot tell. Only the presets&apos; settings are compared. It is a
    suggestion: the class is yours to set. Click a row to set it, then run.
  </>
);

const CHI2_HELP = (
  <>
    χ²/dof = Σ(I − ⟨I⟩)²/σ² over the measured members of the orbits measured twice or more, ⟨I⟩ each orbit&apos;s
    σ-weighted mean, divided by Σ(n − 1). Under counting noise alone it is 1 whatever the orbits&apos; size: the rigorous
    cross-check of the ratio to the noise floor. Above 1 the equivalents disagree beyond their σ: an operation the sample
    lacks, or systematic errors. Where σ is unknown it is taken as √|I|, and the level is only as right as that. The last row
    pools whole |Q| shells.
  </>
);

const BOOTSTRAP_HELP = (
  <>
    Neighbouring voxels share noise and errors through the resolution, so orbits are not independent samples, and treating
    them as such makes the standard errors too small. These come from a spatial block bootstrap: the grid is cut into cubes,
    each orbit belongs to the cube of its representative under the largest class compared (a class&apos;s orbit and its
    subgroups&apos; orbits inside it stay together), and the cubes are resampled with replacement from a fixed seed. The
    cube&apos;s edge follows how far the residuals stay correlated (4 voxels at least). The rule weighs each class against its
    subgroup on the same resamples, so what they share cancels. Effective: the cubes weighed by the data they hold.
  </>
);

const COMMON_HELP = (
  <>
    Each class read again on only the voxels the lowest class can judge (those whose equivalent under it was measured too). A
    class sees voxels its subgroups cannot compare: those cross-orbit comparisons are often its strongest evidence where the
    coverage is sparse, which is why the table reads every measured voxel. When the suggestion changes here, the voxels only a
    higher class compares disagree differently from the rest: errors that depend on the region (absorption, detector or
    coverage edges) can reject a class falsely there, and more rarely a breaking shows only there. Look at the flagged class
    before choosing.
  </>
);

export function LaueCompare({
  volumeId,
  params,
  extra,
  currentSpec,
  onPick,
  disabled,
}: {
  volumeId: string | null; // the dataset's raw volume
  params: StageParamsIn; // the run's settings (edge trim, punch cell and footprint)
  extra: readonly string[]; // custom generators to compare beside the presets
  currentSpec: string; // the Laue class field's text
  onPick: (spec: string) => void;
  disabled?: boolean;
}) {
  const key = volumeId ? settingsKey(volumeId, params, extra) : "";
  const [last, setLast] = useState<{ key: string; result: LaueComparison } | null>(() => (volumeId ? (lastByVolume.get(volumeId) ?? null) : null));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<LaueProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Another dataset: its own last comparison, if any.
  useEffect(() => {
    setLast(volumeId ? (lastByVolume.get(volumeId) ?? null) : null);
    setError(null);
  }, [volumeId]);

  const run = async () => {
    if (!volumeId || running) return;
    const asked = volumeId;
    setRunning(true);
    setError(null);
    setProgress({ fraction: 0, message: "starting" });
    try {
      const result = await compareLaueClasses(asked, laueCompareParams(params), [...extra], (p) => setProgress(p));
      const entry = { key: settingsKey(asked, params, extra), result };
      lastByVolume.set(asked, entry);
      if (asked === volumeId) setLast(entry);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const result = last?.result ?? null;
  const rows = useMemo(() => (result ? laueRows(result, currentSpec) : []), [result, currentSpec]);
  const common = useMemo(() => (result ? commonRows(result) : []), [result]);
  const commonText = result ? commonLine(result) : null;
  const commonWhole = result?.common?.share != null && result.common.share >= 0.9995;
  const bootText = result ? bootstrapLine(result) : null;
  const stale = result != null && last?.key !== key;
  const pct = Math.round(100 * (progress?.fraction ?? 0));

  const pick = (spec: string) => onPick(spec);
  const onKey = (e: KeyboardEvent, spec: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(spec);
    }
  };

  return (
    <div className="laue-compare">
      <div className="laue-compare-head">
        <button type="button" className="btn btn-sm" onClick={() => void run()} disabled={disabled || !volumeId || running}>
          {running && <span className="spin" />}
          {running ? "Comparing…" : result ? "Compare again" : "Compare Laue classes"}
        </button>
        <span className="laue-compare-line">{RINT_LINE}</span>
        <HelpTip className="helptip--wide">{RINT_HELP}</HelpTip>
      </div>
      {running && (
        <div className="laue-compare-progress">
          <div className="boot-panel-bar" role="progressbar" aria-label="Comparing Laue classes" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="boot-panel-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="laue-compare-message">{progress?.message ?? ""}</span>
        </div>
      )}
      {error && (
        <p className="config-note config-note--error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          {stale && <p className="config-note">These numbers were read with other settings (the edge trim, the punch cell or its footprint): compare again.</p>}
          {result.disagreement && (
            <p className="config-note config-note--warn" role="status">
              ⚠ {result.disagreement}
            </p>
          )}
          <p className={`laue-verdict${result.suggestion ? "" : " laue-verdict--none"}`} role="status">
            {verdictLine(result)}
          </p>
          <div className="laue-table-wrap">
            <table className="laue-table">
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col" className="num" title="Operations in the class">
                    Ops
                  </th>
                  <th scope="col" title="R_int on every measured voxel">
                    R_int all
                  </th>
                  <th scope="col" title="R_int with the Bragg nodes masked">
                    R_int diffuse
                  </th>
                  <th scope="col" className="num" title="χ² per degree of freedom: every measured voxel over the diffuse. 1 is agreement within the counting noise">
                    χ²/dof
                  </th>
                  <th scope="col" className="num" title="Orbits with two measured members or more">
                    Orbits
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.laue}
                    className={`laue-row${row.suggested ? " laue-row--suggested" : ""}${row.current ? " laue-row--current" : ""}`}
                    onClick={() => pick(row.spec)}
                    title={`Set the Laue class to ${row.laue}${row.contains.length ? ` (contains ${row.contains.join(", ")})` : ""}`}
                  >
                    <td className="laue-class">
                      <span className="laue-indent" style={{ "--depth": row.depth } as CSSProperties}>
                        {row.depth > 0 && <span className="laue-chain" aria-hidden="true">└</span>}
                        <button
                          type="button"
                          className="laue-pick"
                          aria-pressed={row.current}
                          onClick={(e) => {
                            e.stopPropagation();
                            pick(row.spec);
                          }}
                          onKeyDown={(e) => onKey(e, row.spec)}
                        >
                          {row.laue}
                        </button>
                      </span>
                      {row.suggested && <span className="laue-badge">Suggested</span>}
                    </td>
                    <td className="num">{row.order}</td>
                    <Cell c={row.all} />
                    <Cell c={row.diffuse} />
                    <td className="num laue-chi2" title={row.chi2.title}>
                      <span className="laue-rint">{row.chi2.all}</span>
                      <span className="laue-detail">{row.chi2.diffuse}</span>
                    </td>
                    <td className="num" title={row.orbitsTitle}>
                      <span className="laue-orbits-full">{row.orbits}</span>
                      <span className="laue-orbits-short">{row.orbitsShort}</span>
                    </td>
                  </tr>
                ))}
                <tr className="laue-ref" title="Every voxel pooled with the measured voxels at its |Q|: no symmetry, the most a class could pool. A class's R_int sits between its subgroups' and this.">
                  <td colSpan={2}>No symmetry (|Q| shells)</td>
                  <td className="laue-cell">
                    <span className="laue-rint">{formatRint(result.isotropic.all.r_int)}</span>
                  </td>
                  <td className="laue-cell">
                    <span className="laue-rint">{formatRint(result.isotropic.diffuse.r_int)}</span>
                  </td>
                  <td className="num laue-chi2">
                    <span className="laue-rint">{formatChi2(result.isotropic.all.chi2)}</span>
                    <span className="laue-detail">{formatChi2(result.isotropic.diffuse.chi2)}</span>
                  </td>
                  <td />
                </tr>
                {result.refused.map((r) => (
                  <tr key={`refused-${r.laue}`} className="laue-refused" title={r.detail}>
                    <td>{r.laue}</td>
                    <td className="num">{r.order}</td>
                    <td colSpan={4}>Refused: {refusalText(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="laue-caption laue-caption--help">
            <span>{CHI2_LINE}</span>
            <HelpTip className="helptip--wide">{CHI2_HELP}</HelpTip>
          </p>
          {bootText && (
            <p className="laue-caption laue-caption--help">
              <span>{bootText}</span>
              <HelpTip className="helptip--wide">{BOOTSTRAP_HELP}</HelpTip>
            </p>
          )}
          {result.common?.flag && (
            <p className="config-note config-note--warn" role="status">
              ⚠ {result.common.flag}
            </p>
          )}
          {commonText && (
            <div className="laue-common">
              <p className="laue-caption laue-caption--help">
                <span>{commonText}</span>
                <HelpTip className="helptip--wide">{COMMON_HELP}</HelpTip>
              </p>
              {!commonWhole && (
                <details className="laue-common-details">
                  <summary>Each class on it</summary>
                  <table className="laue-table laue-table--common">
                    <thead>
                      <tr>
                        <th scope="col">Class</th>
                        <th scope="col" title="R_int over its noise floor on the common subset, every measured voxel">
                          × noise all
                        </th>
                        <th scope="col" title="R_int over its noise floor on the common subset, the diffuse">
                          × noise diffuse
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {common.map((row) => (
                        <tr key={row.laue} className={row.suggested ? "laue-row--suggested" : undefined}>
                          <td className="laue-class">
                            <span className="laue-indent" style={{ "--depth": row.depth } as CSSProperties}>
                              {row.depth > 0 && (
                                <span className="laue-chain" aria-hidden="true">
                                  └
                                </span>
                              )}
                              <span className="laue-name">{row.laue}</span>
                            </span>
                          </td>
                          <td className={`laue-cell laue-cell--${row.all.state}`} title={row.all.title}>
                            <span className="laue-detail">{row.all.value}</span>
                          </td>
                          <td className={`laue-cell laue-cell--${row.diffuse.state}`} title={row.diffuse.title}>
                            <span className="laue-detail">{row.diffuse.value}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}
          <p className="laue-caption">{diffuseLine(result)}</p>
          {result.notes.map((note) => (
            <p key={note} className="laue-caption">
              {note}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
