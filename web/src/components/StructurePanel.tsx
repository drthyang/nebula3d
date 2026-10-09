// The structure behind the 3D-ΔPDF pair-vector overlay: load a CIF or type the
// sites in, give the symmetry operations, check the cell against the ΔPDF's,
// and choose what to draw.  Also the legend row (one chip per element pair,
// click to hide) that sits in the workspace header while the overlay is on.

import { useEffect, useRef, useState } from "react";

import type { Lattice } from "../api/types";
import { useStructureStore, type StructureDef } from "../state/structureStore";
import { parseCif, type Site } from "../structure/cif";
import { bestPermutation, CELL_TOLERANCE, cellMatches, permLabel, PERMUTATIONS } from "../structure/pairs";
import { CENTERINGS, type Centering } from "../structure/symops";
import { activeOrigin, latticeCell, type StructureModel } from "../structure/useStructure";
import { Slider } from "./ui";
import { GlyphIcon } from "./StructureOverlay";

const fmt = (v: number) => Number(v.toFixed(5)).toString();

/** A table cell that edits as text and commits on Enter / blur. */
function CellInput({
  value,
  onCommit,
  numeric = false,
  width,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  numeric?: boolean;
  width: string;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    if (!numeric || (draft.trim() !== "" && Number.isFinite(Number(draft)))) onCommit(draft.trim());
    setDraft(null);
  };
  return (
    <input
      type="text"
      aria-label={label}
      className={`struct-cell${numeric ? " num" : ""}`}
      style={{ width }}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
      onBlur={commit}
    />
  );
}

const EMPTY: StructureDef = { name: "manual", cell: null, sites: [], ops: "x, y, z", centering: "P", notes: [] };

export function StructurePanel({
  model,
  lattice,
  halfVoxel,
  onClose,
}: {
  model: StructureModel | null;
  lattice: Lattice | undefined;
  halfVoxel: number;
  onClose: () => void;
}) {
  const def = useStructureStore((s) => s.def);
  const perm = useStructureStore((s) => s.perm);
  const origin = activeOrigin(model, useStructureStore((s) => s.origin));
  const depth = useStructureStore((s) => s.depth);
  const setDef = useStructureStore((s) => s.setDef);
  const setPerm = useStructureStore((s) => s.setPerm);
  const setOrigin = useStructureStore((s) => s.setOrigin);
  const setDepth = useStructureStore((s) => s.setDepth);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [opsDraft, setOpsDraft] = useState<string | null>(null);
  useEffect(() => setOpsDraft(null), [def?.ops]);

  const data = latticeCell(lattice);
  // Every edit applies to the store's current structure, so two edits in one
  // event (an ops blur, then a centring change) do not undo each other.
  const editDef = useStructureStore((s) => s.editDef);
  const update = (patch: Partial<StructureDef>) => editDef(() => patch);
  const setSite = (i: number, patch: Partial<Site>) =>
    editDef((d) => ({ sites: d.sites.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));

  const loadFile = async (f: File) => {
    try {
      const cif = parseCif(await f.text());
      setDef({
        name: cif.name || f.name.replace(/\.cif$/i, ""),
        cell: cif.cell,
        sites: cif.sites,
        ops: cif.ops.length ? cif.ops.join("\n") : "x, y, z",
        centering: "P",
        notes: cif.warnings,
      });
      const best = cif.cell && data ? bestPermutation(cif.cell, data) : null;
      setPerm(best ?? 0);
      setLoadError(null);
    } catch (e) {
      setLoadError(`${f.name}: ${(e as Error).message}`);
    }
  };

  const commitOps = () => {
    if (opsDraft !== null && opsDraft !== def?.ops) update({ ops: opsDraft });
  };

  return (
    <section className="struct-panel" aria-label="Structure overlay">
      <div className="struct-head">
        <span className="struct-title">Structure</span>
        {def ? (
          <span className="struct-sub">
            <b>{def.name}</b> · {def.sites.length} site{def.sites.length === 1 ? "" : "s"} →{" "}
            {model?.atoms.length ?? 0} atoms per cell · {model?.nOps ?? 0} operations
          </span>
        ) : (
          <span className="struct-sub">
            Load a CIF, or enter sites by hand, to mark interatomic vectors r<sub>j</sub> − r<sub>i</sub> on the ΔPDF.
          </span>
        )}
        <span className="ws-spacer" />
        <input
          ref={fileRef}
          type="file"
          accept=".cif,.mcif,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = "";
          }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
          Load CIF…
        </button>
        {!def && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDef(EMPTY)}>
            Enter sites
          </button>
        )}
        {def && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDef(null)}>
            Remove
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close structure panel">
          Close
        </button>
      </div>

      {loadError && <div className="struct-note err">{loadError}</div>}
      {def?.notes.map((n) => (
        <div key={n} className="struct-note warn">{n}</div>
      ))}
      {model?.error && <div className="struct-note err">Symmetry: {model.error}</div>}

      {def && (
        <>
          <CellCheck model={model} perm={perm} setPerm={setPerm} hasData={data !== null} />

          <div className="struct-body">
            <div className="struct-sites">
              <span className="field-label">Sites (fractional)</span>
              <table className="struct-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>El.</th>
                    <th>x</th>
                    <th>y</th>
                    <th>z</th>
                    <th aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {def.sites.map((s, i) => (
                    <tr key={i}>
                      <td><CellInput label="Label" width="7ch" value={s.label} onCommit={(v) => v && setSite(i, { label: v })} /></td>
                      <td><CellInput label="Element" width="4ch" value={s.element} onCommit={(v) => v && setSite(i, { element: v })} /></td>
                      {(["x", "y", "z"] as const).map((k) => (
                        <td key={k}>
                          <CellInput label={k} numeric width="8ch" value={fmt(s[k])} onCommit={(v) => setSite(i, { [k]: Number(v) })} />
                        </td>
                      ))}
                      <td>
                        <button
                          type="button"
                          className="struct-x"
                          aria-label={`Remove ${s.label}`}
                          onClick={() => editDef((d) => ({ sites: d.sites.filter((_, k) => k !== i) }))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  editDef((d) => ({
                    sites: [...d.sites, { label: `X${d.sites.length + 1}`, element: "X", x: 0, y: 0, z: 0, occ: 1 }],
                  }))
                }
              >
                + Site
              </button>
            </div>

            <div className="struct-ops">
              <div className="field-row">
                <span className="field-label">Symmetry operations</span>
                <label className="struct-inline">
                  Centring
                  <select
                    aria-label="Lattice centring"
                    value={def.centering}
                    onChange={(e) => update({ centering: e.target.value as Centering })}
                  >
                    {CENTERINGS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                className="struct-textarea"
                aria-label="Symmetry operations"
                spellCheck={false}
                rows={7}
                value={opsDraft ?? def.ops}
                onChange={(e) => setOpsDraft(e.target.value)}
                onBlur={commitOps}
              />
              <span className="struct-hint">
                One x,y,z triplet per line (e.g. −x+1/2, y, z+1/2). Generators are enough: the list is closed into
                the full group, with the centring translations added.
              </span>
            </div>

            <div className="struct-show">
              <label className="field">
                <span className="field-label">Vectors from</span>
                <select aria-label="Vectors from" value={origin ?? ""} onChange={(e) => setOrigin(e.target.value || null)}>
                  <option value="">every site (all pairs)</option>
                  {def.sites.map((s) => (
                    <option key={s.label} value={s.label}>{s.label}</option>
                  ))}
                </select>
              </label>
              <Slider
                label="Depth ±"
                readout={depth === null ? "½ voxel" : `${depth.toFixed(2)} Å`}
                min={0}
                max={2}
                step={0.05}
                value={depth ?? halfVoxel}
                onChange={(v) => setDepth(v)}
              />
              {depth !== null && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDepth(null)}>
                  ½ voxel
                </button>
              )}
              <span className="struct-hint">
                A vector is marked on a slice when it lies within ± depth of the cut along the cut axis; it fades
                with its distance from the plane.
              </span>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CellCheck({
  model,
  perm,
  setPerm,
  hasData,
}: {
  model: StructureModel | null;
  perm: number;
  setPerm: (i: number) => void;
  hasData: boolean;
}) {
  if (!model?.def.cell) {
    return <div className="struct-note">No CIF cell: vectors are placed on the ΔPDF's own cell.</div>;
  }
  if (!hasData || !model.fit) {
    return <div className="struct-note warn">This ΔPDF records no cell, so the overlay cannot be placed.</div>;
  }
  const c = model.def.cell;
  const ok = cellMatches(model.fit);
  return (
    <div className={`struct-note ${ok ? "ok" : "warn"}`}>
      <span>
        CIF cell {c.a.toFixed(3)}, {c.b.toFixed(3)}, {c.c.toFixed(3)} Å · {c.alpha.toFixed(1)}, {c.beta.toFixed(1)},{" "}
        {c.gamma.toFixed(1)}° —{" "}
        {ok
          ? `matches the ΔPDF's (lengths within ${(model.fit.length * 100).toFixed(1)} %)`
          : `differs from the ΔPDF's by ${(model.fit.length * 100).toFixed(1)} % in length, ${model.fit.angle.toFixed(1)}° in angle (tolerance ${CELL_TOLERANCE.length * 100} %, ${CELL_TOLERANCE.angle}°)`}
        . Vectors are placed on the ΔPDF's cell.
      </span>
      <label className="struct-inline">
        ΔPDF a, b, c = CIF
        <select aria-label="CIF axes for the ΔPDF's a, b, c" value={perm} onChange={(e) => setPerm(Number(e.target.value))}>
          {PERMUTATIONS.map((p, i) => (
            <option key={i} value={i}>{permLabel(p)}</option>
          ))}
        </select>
      </label>
      {model.suggested !== null && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPerm(model.suggested!)}>
          Use {permLabel(PERMUTATIONS[model.suggested])} (matches)
        </button>
      )}
    </div>
  );
}

/** One chip per element pair: the glyph, the pair and a click to hide it. */
export function StructureLegend({ model }: { model: StructureModel }) {
  const hidden = useStructureStore((s) => s.hidden);
  const toggle = useStructureStore((s) => s.toggleHidden);
  const stored = useStructureStore((s) => s.origin);
  const origin = activeOrigin(model, stored);
  const keys = origin ? model.keys.filter((k) => model.diffs.some((d) => d.from === origin && d.key === k)) : model.keys;
  if (model.mismatch) {
    return (
      <span className="struct-sub">
        <b>{model.def.name}</b>: its cell does not match this ΔPDF's, so no vectors are drawn — check the axes in Edit
        structure.
      </span>
    );
  }
  if (!keys.length) return <span className="struct-sub">No sites yet.</span>;
  return (
    <div className="struct-legend" role="group" aria-label="Element pairs">
      <span className="field-label">{origin ? `Vectors from ${origin}` : "Pair vectors"}</span>
      {keys.map((k) => {
        const off = hidden.includes(k);
        return (
          <button
            key={k}
            type="button"
            className={`struct-chip${off ? " off" : ""}`}
            aria-pressed={!off}
            title={off ? `Show ${k} vectors` : `Hide ${k} vectors`}
            onClick={() => toggle(k)}
          >
            <GlyphIcon pair={k} elements={model.elements} />
            {k}
          </button>
        );
      })}
    </div>
  );
}
