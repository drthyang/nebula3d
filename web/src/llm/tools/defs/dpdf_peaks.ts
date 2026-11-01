// dpdf_peaks: the 3D-ΔPDF's strongest features over the whole volume, with
// their vectors, signs and sizes, grouped as the backend groups them: by the
// point group the dataset's raw file declares, else by sign, length and size
// (grouped_by says which, and why).

import { fetchDpdfFeatures } from "../../../api/client";
import { dpdfVolumeId } from "../../context/loadContext";
import { evidence, reading } from "../../inference";
import { roundSig } from "../../metrics/sliceStats";
import { num } from "../shared/args";
import { dpdfMeta, dpdfView } from "../shared/cuts";
import { described, description } from "../shared/describe";
import { ToolArgError, type ChatTool } from "../types";

// How many of a group's vectors the model reads (the group's n says how many there are).
const PEAK_VECTORS = 4;

// The skill's order (the trust checks before the features) and its name are
// inference here: with the skills off the description has neither.
export const dpdf_peaks: ChatTool = {
  name: "dpdf_peaks",
  facts: { label: "Listed the ΔPDF's strongest features", acts: null, offeredFor: ["pdf"], settles: ["features"] },
  ...described(
    description("dpdf_peaks")`The 3D-ΔPDF's strongest features in the whole volume: extrema above min_sigma (default 5) robust σ outside the origin's disk, each ± pair once. Returns features: length_A, size_sigma (signed: + more pairs than the average structure, − fewer), n_vectors of one sign, length and size${evidence(" (likely symmetry copies)")}, up to 4 vectors_rlu (x/a, y/b, z/c) and vectors_A (Å along a, b, c). ${reading("Use it after the trust checks (qmax_coverage, symmetry_check, assess_stage pdf). ")} What a feature means is the user's call.`,
  ),
  parameters: {
    type: "object",
    properties: {
      min_sigma: { type: "number", description: "Smallest |ΔPDF| listed, in robust σ (3–1000; default 5)" },
      limit: { type: "integer", minimum: 1, maximum: 30, description: "How many entries, strongest first (default 12)" },
    },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const minSigma = num(args, "min_sigma", 5);
    if (!(minSigma >= 3 && minSigma <= 1000)) throw new ToolArgError("min_sigma must be within [3, 1000]");
    const limit = Math.round(num(args, "limit", 12));
    if (limit < 1 || limit > 30) throw new ToolArgError("limit must be within [1, 30]");
    const meta = await dpdfMeta(dataset);
    const f = await fetchDpdfFeatures(dpdfVolumeId(dataset)!, minSigma, limit);
    const sign = (s: number) => (s > 0 ? "+" : "−");
    const vec = (v: number[] | null, digits: number) => (v ? v.map((x) => roundSig(x, digits) + 0) : null);
    // A size carries its sign (THY-63 R1): −1520, not a sign beside 1520, so
    // an answer's signed number traces to it (answerChecks.ts, untracedNumbers).
    const signed = (s: number, size: number) => (s > 0 ? 1 : -1) * Math.abs(roundSig(size, 3));
    const features = f.groups.map((g) => {
      const size = signed(g.sign, g.size_sigma);
      // An orbit of the declared symmetry (the backend gives its multiplicity):
      // its copies' mean size, and how many distinct vectors it has. Grouped by
      // sign, length and size there is no orbit, and every size is within 5 %
      // of the largest: neither is given. Each is left out where it repeats a
      // number the entry already gives (the largest size, n_vectors).
      const mean = g.multiplicity != null ? signed(g.sign, g.mean_size_sigma) : null;
      return {
        length_A: roundSig(g.length, 4),
        size_sigma: size,
        ...(mean != null && mean !== size ? { mean_size_sigma: mean } : {}),
        n_vectors: g.n,
        ...(g.multiplicity != null && g.multiplicity !== g.n ? { multiplicity: g.multiplicity } : {}),
        vectors_rlu: g.vectors_rlu.slice(0, PEAK_VECTORS).map((v) => vec(v, 3)),
        vectors_A: g.vectors.slice(0, PEAK_VECTORS).map((v) => vec(v, 4)),
      };
    });
    const result = {
      grouped_by: f.grouped_by,
      features,
      robust_sigma: f.sigma == null ? null : roundSig(f.sigma, 3),
      threshold_sigma: f.min_sigma,
      origin_disk_A: roundSig(f.origin_radius, 3),
      extrema_above_threshold: f.n_extrema,
    };
    const top = f.groups[0];
    const where = top ? `(${vec(top.vectors_rlu[0] ?? top.vectors[0], 3)!.join(", ")})${top.vectors_rlu[0] ? " r.l.u." : " Å"}` : "";
    return {
      result,
      summary: top
        ? `${f.n_extrema} extrema above ${f.min_sigma}σ; strongest ${sign(top.sign)} at ${where}, ${roundSig(top.length, 3)} Å, ${roundSig(top.size_sigma, 3)}σ`
        : `no extremum above ${f.min_sigma}σ outside the origin's disk`,
      view: dpdfView(meta, "xy", top ? Math.min(Math.max(top.vectors[0][2], meta.z_range[0]), meta.z_range[1]) : 0),
    };
  },
};
