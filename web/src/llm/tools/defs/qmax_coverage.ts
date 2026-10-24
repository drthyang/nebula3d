// qmax_coverage: whether the forward transform reaches past the measured
// reciprocal space, and where the raw counts begin and end in |Q|.
//
// The coverage is measured once, in Python (nebula3d.analysis.coverage), on the
// raw volume's |Q| shells in 3D, and read through either adapter (the server's
// GET /api/volumes/{id}/coverage, the webbridge's volume_coverage_json), as the
// other Python-served tools are. The principal planes only show where: the
// figure opens on the first of them through the origin.

import { fetchDpdfMeta, fetchVolumeCoverage } from "../../../api/client";
import type { VolumeCoverage } from "../../../api/types";
import { usePipelineStore, type PipelineConfig } from "../../../state/pipelineStore";
import { dpdfVolumeId, hklVolumeId, safe, stageVolumeId } from "../../context/loadContext";
import { qRadius } from "../../context/pipelineContext";
import { roundSig } from "../../metrics/sliceStats";
import { skillsOn } from "../../skills";
import { judge } from "../../verdicts/rules";
import { cleanupView, RECIP_FIXED, RECIP_PLANES, recipMeta, recipRange } from "../shared/cuts";
import type { ChatTool } from "../types";

// How far the forward transform reaches in |Q|, from the Configure page: an
// explicit |Q| band; else the box corners for a flat separable window (no
// apodization), where every voxel counts at full weight; else the box faces
// where the window tapers to zero, or, where the backend fits it to the
// coverage, the edge of its support: the measured voxels. It fits an auto or
// ellipsoid window, never a separable one the page asks for
// (analysis/delta_pdf.py, _apodization_window). A volume that stores zeros it
// marks measured carries that support past its counts.
function windowReach(
  s: PipelineConfig,
  q: { corner: number | null; box: number | null; measured: number | null; zeros: boolean },
): { reach: number | null; how: string } {
  if (s.pdfQMax) return { reach: Number(s.pdfQMax), how: "the |Q| band set on the Configure page" };
  if (s.pdfApod === "none" && s.pdfWindowShape !== "ellipsoid") {
    return { reach: q.corner, how: "apodization off: a flat separable window counts the data out to the box corners" };
  }
  const fits = s.pdfWindowSupport && s.pdfWindowShape !== "separable";
  if (fits && q.measured != null && q.box != null && q.measured < q.box) {
    return {
      reach: q.measured,
      how: q.zeros ? "the window is tapered to the measured voxels, which run past the counts: the volume stores zeros there" : "the window is tapered to the measured coverage",
    };
  }
  return {
    reach: q.box,
    how: fits && q.zeros
      ? "the window tapers to zero at the box faces: past its counts the volume stores zeros it marks measured, which the taper to the coverage takes as data"
      : "the window tapers to zero at the box faces",
  };
}

export const qmax_coverage: ChatTool = {
  name: "qmax_coverage",
  facts: {
    label: "Checked Qmax against coverage",
    acts: null,
    offeredFor: ["pdf", "coverage", "general"],
    settles: ["coverage"],
    reportable: true,
    highlights: ["raw", "pdf"],
  },
  description:
    "Check that the forward transform (data → 3D-ΔPDF) does not reach past the measured reciprocal space. When the ΔPDF on disk records it, the verdict is the share of its window's weight on unmeasured space (≲ 1e-3 is clean), with the window's shape and scale. Otherwise it compares how far the transform's window reaches (the |Q| band if one is set, else the box faces, the coverage edge when the window is tapered to the coverage, or the box corners when apodization is off with a separable window) with full_coverage_q, where the raw volume's |Q| shells, in 3D, stop holding counts (measured and non-zero) in 95 % of their voxels. The reach comes from the Configure page's settings, which may differ from the ones that made the ΔPDF on disk. raw_counts gives where the counts begin and end in |Q| (beyond those edges most voxels hold no counts) and the box's nearest face; suggested_band is the |Q| band they allow, and band_check says whether a band that is set stays inside the counts. When the counts end inside the box and no band is set, the verdict says so, with the edge and the band they allow (counts_end_inside_box).",
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx) => {
    const { dataset } = ctx;
    const meta = await recipMeta(dataset);
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset)!;
    const c = await fetchVolumeCoverage(rawId);
    // The planes only show where: the first principal plane through the origin.
    const shown = RECIP_PLANES.find((p) => {
      const r = recipRange(meta, RECIP_FIXED[p]);
      return r[0] <= 0 && r[1] >= 0;
    });
    const boxQ = c.box_q > 0 ? c.box_q : null; // 0: no face but through the origin
    const fullQ = c.full_q_max;
    // Past its counts the volume marks voxels measured that hold none: zeros
    // stored for unmeasured space, which the window's support takes as data.
    const zeros = fullQ != null && c.measured_q_max != null && c.measured_q_max > fullQ + c.q_step;
    const dId = dpdfVolumeId(dataset);
    const dmeta = dId ? await safe(fetchDpdfMeta(dId)) : null;
    // The ΔPDF records max |Q| over its grid: the box corner.
    const cornerQ = dmeta?.q_max ?? null;
    const s = usePipelineStore.getState();
    const settled = windowReach(s, { corner: cornerQ, box: boxQ, measured: c.measured_q_max, zeros });
    // An ellipsoid window (what a lattice whose symmetry mixes axes gets) is
    // inscribed in the box: its reach varies with direction, and only the
    // recorded weight on unmeasured space says whether it stays measured.
    const { reach, how } =
      dmeta?.window_shape === "ellipsoid" && !s.pdfQMax
        ? { reach: settled.reach, how: "an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)" }
        : settled;
    // The ΔPDF on disk records its window and the share of the window's weight
    // on unmeasured space: the direct measure of a reach past the coverage.
    const openWeight = dmeta?.window_open_weight ?? null;
    const windowNote = dmeta?.window_shape
      ? `the ΔPDF's ${dmeta.window_shape} window${dmeta.window_scale != null && dmeta.window_scale < 1 ? ` (shrunk to ${roundSig(dmeta.window_scale, 3)} × to fit the coverage)` : ""}`
      : "the ΔPDF's window";
    const band = rawBand(c, s.pdfQMin, s.pdfQMax);
    const full = fullQ == null ? null : roundSig(fullQ, 4);
    // The verdict, by the coverage's rule (verdicts/): the recorded weight
    // when there is one, else the reach against full coverage, and where the
    // raw counts end when no band is set.
    const outcome = judge("coverage", {
      window_weight: openWeight,
      window: windowNote,
      unit_cell: Boolean(qRadius("hk0", 0, meta)),
      full_coverage_q: full,
      reach,
      reach_from: how,
      shell: c.q_step, // the coverage edge is known to one shell
      band_set: Boolean(s.pdfQMax),
      zeros_stored: zeros,
      counts: band,
    }, { skills: skillsOn(ctx) });
    const verdict = outcome.words!;
    return {
      result: {
        verdict,
        window_weight_on_unmeasured: openWeight,
        window_shape: dmeta?.window_shape ?? null,
        window_scale: dmeta?.window_scale ?? null,
        transform_reach_q: reach == null ? null : roundSig(reach, 4),
        reach_from: how,
        full_coverage_q: full,
        box_face_q: boxQ == null ? null : roundSig(boxQ, 4),
        box_corner_q: cornerQ == null ? null : roundSig(cornerQ, 4),
        ...band,
        q_unit: "Å⁻¹",
        settings: {
          pdfQMin: s.pdfQMin || "(default)",
          pdfQMax: s.pdfQMax || "(default)",
          pdfApod: s.pdfApod || "(default)",
          pdfWindowShape: s.pdfWindowShape || "(default)",
          pdfWindowSupport: s.pdfWindowSupport,
        },
      },
      summary: verdict,
      view: shown ? cleanupView(shown, 0) : undefined,
      outcomes: [outcome],
    };
  },
};

// Where the raw counts begin and end in |Q| (most voxels past an edge hold no
// counts), the band that keeps inside them, and whether the band that is set
// does.  The box can end first along one axis: past box_face_q the window,
// not the band, limits the reach in that direction.
// The counts end inside the box when their upper edge sits at least one of the
// coverage's shells (q_step, the edge's own resolution) inside its nearest
// face: then part of every direction's reach is empty, not only the corners.
function rawBand(c: VolumeCoverage, qMinSet: string, qMaxSet: string) {
  const lo = c.q_min_edge != null ? Math.ceil(c.q_min_edge * 20) / 20 : 0;
  const hi = c.q_max_edge != null ? Math.floor(c.q_max_edge * 20) / 20 : null;
  const qMin = qMinSet ? Number(qMinSet) : null;
  const qMax = qMaxSet ? Number(qMaxSet) : null;
  const inside = c.q_max_edge != null && c.q_max_edge <= c.box_q - c.q_step;
  const problems: string[] = [];
  if (qMax != null) {
    if (qMin == null || qMin < lo - 0.025) problems.push(`Qmin below the counts' lower edge (${roundSig(c.q_min_edge ?? 0, 3)} Å⁻¹): the beam stop's empty voxels enter the transform`);
    if (hi != null && qMax > hi + 0.025) problems.push(`Qmax past the counts' upper edge (${roundSig(c.q_max_edge!, 4)} Å⁻¹): empty voxels enter the transform`);
  }
  return {
    raw_counts: {
      q_min_edge: c.q_min_edge == null ? null : roundSig(c.q_min_edge, 3),
      q_max_edge: c.q_max_edge == null ? null : roundSig(c.q_max_edge, 4),
      fully_measured: c.full_q_min != null && c.full_q_max != null ? [roundSig(c.full_q_min, 3), roundSig(c.full_q_max, 4)] : null,
      box_face_q: roundSig(c.box_q, 4),
    },
    suggested_band: hi != null ? [lo, hi] : null,
    counts_end_inside_box: inside,
    band_check:
      qMax == null
        ? "no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach" +
          (inside && hi != null
            ? `; the counts end at ${roundSig(c.q_max_edge!, 4)} Å⁻¹, inside the box (face ${roundSig(c.box_q, 4)} Å⁻¹): the band they allow is ${lo}–${hi} Å⁻¹`
            : "")
        : problems.length
          ? problems.join("; ")
          : `the band ${qMin ?? 0}–${qMax} Å⁻¹ stays inside the counts`,
  };
}
