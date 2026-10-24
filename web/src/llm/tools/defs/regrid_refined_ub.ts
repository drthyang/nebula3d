// regrid_refined_ub: regrids the dataset's raw volume onto its refined UB and
// writes the result as a new dataset beside it (nebula3d.analysis.ub_regrid,
// docs/regrid.md). It acts: it writes a raw volume the size of the dataset's.
// The fit is ub_check's (one shared check_ub, the same punch cell and q_max),
// so the turn it acts on is the one ub_check reports. It never overwrites a
// file, and the backend's refusals come back as data, nothing written: a turn
// within the fit's noise (under the UB check's 0.05°), a symmetrised volume
// without its unsymmetrised source, a target or dataset id in use.
//
// An action for the user to run: it runs only when the user's latest message
// asks for a regrid (tune/catalog.ts: namesRegrid, the rule update_settings
// holds a fact about the sample to), and a local model is offered it only
// then (its facts' `askedFor`). It runs no pipeline and selects nothing: the
// new dataset is reduced only when the user runs the pipeline on it.

import { regridDataset } from "../../../api/client";
import { queryClient } from "../../../api/queryClient";
import { usePipelineStore } from "../../../state/pipelineStore";
import { namesRegrid, regridRefusal } from "../../tune/catalog";
import { num } from "../shared/args";
import { checkIdle } from "../shared/pipeline";
import { ToolArgError, type ChatTool } from "../types";

const fixed = (x: number | null, places: number): number | null => (x == null ? null : Number(x.toFixed(places)));
const cellText = (c: number[] | null): string | null =>
  c == null ? null : `${c.slice(0, 3).map((x) => x.toFixed(4)).join(", ")} Å; ${c.slice(3).map((x) => x.toFixed(3)).join("°, ")}°`;

export const regrid_refined_ub: ChatTool = {
  name: "regrid_refined_ub",
  facts: {
    label: "Regridded onto the refined UB",
    runningLabel: "Regridding onto the refined UB",
    acts: "dataset",
    // It writes a new dataset: the listing changes, the selected dataset's outputs do not.
    invalidates: ["datasets"],
    highlights: ["raw"],
    askedFor: namesRegrid,
  },
  description:
    "Regrid the dataset's raw volume onto its refined UB, as a new dataset: the fit is ub_check's (the punch cell's " +
    "Bragg nodes, q_max), and the volume resampled onto the refined UB is written as <stem>_regridded.nxs beside the " +
    "raw file, never over a file. No pipeline is run. Only when the user's latest message asks for a regrid; " +
    "otherwise refused. Nothing is written, and refusal gives code and reason, when the turn is under " +
    "turn_threshold_deg, a symmetrised volume has no unsymmetrised source beside it, or the new file or dataset id " +
    "exists. Returns the new dataset, the turn, the peaks' RMS before → after, and the measured voxels lost outside the old grid.",
  parameters: {
    type: "object",
    properties: { q_max: { type: "number", description: "The nodes' |Q| limit in Å⁻¹ (default: everything the box holds)" } },
  },
  run: async (args, ctx) => {
    // The user's to run: refused, before anything else, unless their latest message asks for it.
    if (!namesRegrid(ctx.userMessage ?? "")) throw new Error(regridRefusal());
    checkIdle();
    const qMax = args.q_max == null ? null : num(args, "q_max", 0);
    if (qMax != null && !(qMax > 0)) throw new ToolArgError("q_max must be positive");
    // The Bragg nodes as ub_check takes them: the punch cell.
    const s = usePipelineStore.getState();
    const cell = [s.punchSupercellH, s.punchSupercellK, s.punchSupercellL].map((v) => Number(v) || 1) as [number, number, number];
    const r = await regridDataset(ctx.dataset.id, cell, qMax);
    // The console's dataset list shows the new one.
    if (r.written) void queryClient.invalidateQueries({ queryKey: ["datasets"] });
    const result = {
      written: r.written,
      refusal: r.refusal ? { code: r.refusal.code, reason: r.refusal.reason } : null,
      // The new dataset, or the existing one a target_exists refusal names.
      dataset_id: r.dataset_id,
      file: r.file,
      source_file: r.source_file,
      refined_on: r.refined_on,
      fit: r.fit,
      bragg_nodes_every: cell,
      turn_deg: fixed(r.turn_deg, 4),
      turn_threshold_deg: r.turn_threshold_deg,
      axis_uvw: r.axis_uvw ? r.axis_uvw.map((x) => Number(x.toFixed(3))) : null,
      rms_start: fixed(r.rms_start, 4),
      rms: fixed(r.rms, 4),
      cell_start: cellText(r.cell_start),
      cell: cellText(r.cell),
      peaks_used: r.n_used,
      symmetrised: r.symmetrised,
      measured_before: r.measured_before,
      measured_after: r.measured_after,
      voxels_outside: r.voxels_outside,
      voxels_outside_share: r.voxels_outside_share == null ? null : Number(r.voxels_outside_share.toPrecision(2)),
    };
    const turn = r.turn_deg == null ? "" : `; turn ${r.turn_deg.toFixed(4)}°`;
    return {
      result,
      summary: r.written
        ? `wrote ${r.file} (dataset ${r.dataset_id})${turn}, RMS ${r.rms_start!.toFixed(4)} → ${r.rms!.toFixed(4)} Å⁻¹`
        : `nothing written: ${r.refusal?.code ?? "refused"}${turn}`,
    };
  },
};
