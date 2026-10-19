// qmax_coverage: whether the forward transform reaches past the measured
// reciprocal space, and where the raw counts begin and end in |Q|.

import { fetchDpdfMeta, fetchSlice, fetchVolumeCoverage } from "../../../api/client";
import type { VolumeCoverage } from "../../../api/types";
import { usePipelineStore, type PipelineConfig } from "../../../state/pipelineStore";
import { dpdfVolumeId, hklVolumeId, safe, stageVolumeId } from "../../context/loadContext";
import { qRadius } from "../../context/pipelineContext";
import { COVERAGE_SHELLS, coverageMetrics } from "../../metrics/coverage";
import { roundSig } from "../../metrics/sliceStats";
import { skillsOn } from "../../skills";
import { judge } from "../../verdicts/rules";
import { cleanupView, RECIP_FIXED, RECIP_PLANES, recipMeta, recipRange } from "../shared/cuts";
import type { ChatTool } from "../types";

// How far the forward transform reaches in |Q|, from the Configure page: an
// explicit |Q| band; else the box corners for a flat separable window (no
// apodization), where every voxel counts at full weight; else the box faces
// where the window tapers to zero, or the coverage edge when it is tapered to
// the measured coverage.
function windowReach(
  s: PipelineConfig,
  q: { corner: number | null; box: number | null; full: number | null },
): { reach: number | null; how: string } {
  if (s.pdfQMax) return { reach: Number(s.pdfQMax), how: "the |Q| band set on the Configure page" };
  if (s.pdfApod === "none" && s.pdfWindowShape !== "ellipsoid") {
    return { reach: q.corner, how: "apodization off: a flat separable window counts the data out to the box corners" };
  }
  if (s.pdfWindowSupport && q.full != null && q.box != null && q.full < q.box) {
    return { reach: q.full, how: "the window is tapered to the measured coverage" };
  }
  return { reach: q.box, how: "the window tapers to zero at the box faces" };
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
    "Check that the forward transform (data → 3D-ΔPDF) does not reach past the measured reciprocal space. When the ΔPDF on disk records it, the verdict is the share of its window's weight on unmeasured space (≲ 1e-3 is clean), with the window's shape and scale. On the three principal planes through the origin it measures the share of each |Q| shell that was measured (finite in raw), the |Q| where shells stop being fully (95 %) measured, and where the data box ends, and compares them with how far the transform's window reaches: the |Q| band if one is set, else the box faces, the coverage edge when the window is tapered to the coverage, or the box corners when apodization is off with a separable window. The reach comes from the Configure page's settings, which may differ from the ones that made the ΔPDF on disk. From the raw volume, raw_counts gives where its counts begin and end in |Q| (beyond those edges most voxels hold no counts) and the box's nearest face; suggested_band is the |Q| band they allow, and band_check says whether a band that is set stays inside the counts. When the counts end inside the box and no band is set, the verdict says so, with the edge and the band they allow (counts_end_inside_box).",
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx) => {
    const { dataset } = ctx;
    const meta = await recipMeta(dataset);
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset)!;
    const rawCounts = safe(fetchVolumeCoverage(rawId));
    const planes = RECIP_PLANES.filter((p) => {
      const r = recipRange(meta, RECIP_FIXED[p]);
      return r[0] <= 0 && r[1] >= 0;
    });
    const per = await Promise.all(
      planes.map(async (plane) => {
        const slice = await safe(fetchSlice(rawId, plane, 0));
        return [plane, coverageMetrics(slice, qRadius(plane, 0, meta))] as const;
      }),
    );
    const pick = (k: "full_coverage_q" | "box_q" | "low_q_gap") =>
      per.map(([, m]) => m?.[k]).filter((x): x is number => typeof x === "number");
    const fullQ = pick("full_coverage_q").length ? Math.min(...pick("full_coverage_q")) : null;
    const boxQ = pick("box_q").length ? Math.min(...pick("box_q")) : null;
    // The plane where full coverage ends first, to show it there.
    let shortest = planes[0] as string | undefined;
    let shortestQ = Infinity;
    for (const [plane, m] of per) {
      if (m?.full_coverage_q != null && m.full_coverage_q < shortestQ) [shortest, shortestQ] = [plane, m.full_coverage_q];
    }
    const dId = dpdfVolumeId(dataset);
    const dmeta = dId ? await safe(fetchDpdfMeta(dId)) : null;
    // The ΔPDF records max |Q| over its grid: the box corner.
    const cornerQ = dmeta?.q_max ?? null;
    const s = usePipelineStore.getState();
    const settled = windowReach(s, { corner: cornerQ, box: boxQ, full: fullQ });
    // An ellipsoid window (what a lattice whose symmetry mixes axes gets) is
    // inscribed in the box: its reach varies with direction, and only the
    // recorded weight on unmeasured space says whether it stays measured.
    const { reach, how } =
      dmeta?.window_shape === "ellipsoid" && !s.pdfQMax
        ? { reach: settled.reach, how: "an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)" }
        : settled;
    const shell = boxQ != null ? boxQ / COVERAGE_SHELLS : 0; // the coverage edge is known to one shell
    // The ΔPDF on disk records its window and the share of the window's weight
    // on unmeasured space: the direct measure of a reach past the coverage.
    const openWeight = dmeta?.window_open_weight ?? null;
    const windowNote = dmeta?.window_shape
      ? `the ΔPDF's ${dmeta.window_shape} window${dmeta.window_scale != null && dmeta.window_scale < 1 ? ` (shrunk to ${roundSig(dmeta.window_scale, 3)} × to fit the coverage)` : ""}`
      : "the ΔPDF's window";
    const counts = await rawCounts;
    const band = rawBand(counts, s.pdfQMin, s.pdfQMax);
    // The verdict, by the coverage's rule (verdicts/): the recorded weight
    // when there is one, else the reach against full coverage, and where the
    // raw counts end when no band is set.
    const outcome = judge("coverage", {
      window_weight: openWeight,
      window: windowNote,
      unit_cell: Boolean(qRadius("hk0", 0, meta)),
      full_coverage_q: fullQ,
      reach,
      reach_from: how,
      shell,
      band_set: Boolean(s.pdfQMax),
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
        full_coverage_q: fullQ,
        box_face_q: boxQ,
        box_corner_q: cornerQ == null ? null : roundSig(cornerQ, 4),
        low_q_gap: pick("low_q_gap").length ? Math.max(...pick("low_q_gap")) : null,
        ...band,
        q_unit: "Å⁻¹",
        settings: {
          pdfQMin: s.pdfQMin || "(default)",
          pdfQMax: s.pdfQMax || "(default)",
          pdfApod: s.pdfApod || "(default)",
          pdfWindowShape: s.pdfWindowShape || "(default)",
          pdfWindowSupport: s.pdfWindowSupport,
        },
        per_plane: Object.fromEntries(
          per.map(([plane, m]) => [
            plane,
            m && {
              full_coverage_q: m.full_coverage_q,
              half_coverage_q: m.half_coverage_q,
              box_q: m.box_q,
              shells: m.shells.filter((_x, i) => i % 4 === 3), // every fourth shell
            },
          ]),
        ),
      },
      summary: verdict,
      view: shortest ? cleanupView(shortest, 0) : undefined,
      outcomes: [outcome],
    };
  },
};

// Where the raw counts begin and end in |Q| (most voxels past an edge hold no
// counts), the band that keeps inside them, and whether the band that is set
// does.  The box can end first along one axis: past box_face_q the window,
// not the band, limits the reach in that direction.
// The counts end inside the box when their upper edge sits at least one of
// q_coverage's shells (0.1 Å⁻¹, the edge's own resolution) inside its nearest
// face: then part of every direction's reach is empty, not only the corners.
const COUNTS_EDGE_SHELL = 0.1;

function rawBand(c: VolumeCoverage | null, qMinSet: string, qMaxSet: string) {
  if (!c) return { counts_end_inside_box: false as const };
  const lo = c.q_min_edge != null ? Math.ceil(c.q_min_edge * 20) / 20 : 0;
  const hi = c.q_max_edge != null ? Math.floor(c.q_max_edge * 20) / 20 : null;
  const qMin = qMinSet ? Number(qMinSet) : null;
  const qMax = qMaxSet ? Number(qMaxSet) : null;
  const inside = c.q_max_edge != null && c.q_max_edge <= c.box_q - COUNTS_EDGE_SHELL;
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
