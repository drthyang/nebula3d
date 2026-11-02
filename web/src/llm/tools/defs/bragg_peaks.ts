// bragg_peaks: the punch's fitted Bragg peaks, sorted by a property or by
// distance to an HKL point.

import { fetchBraggProfile } from "../../../api/client";
import { safe } from "../../context/loadContext";
import { roundSig } from "../../metrics/sliceStats";
import { num, oneOf } from "../shared/args";
import { r4 } from "../shared/figures";
import { columnTable } from "../shared/table";
import { ToolArgError, type ChatTool } from "../types";

export const bragg_peaks: ChatTool = {
  name: "bragg_peaks",
  facts: { label: "Looked up Bragg peaks", acts: null, offeredFor: ["punch", "lattice", "general"], highlights: ["bragg"] },
  description:
    "Peaks from the punch stage's fitted Bragg profile: position (HKL and |Q|), intensity, local background, significance, measured width per axis (Å⁻¹), whether each axis is resolution-limited, and anisotropy (largest/smallest principal width). Sort by a property or by distance to an HKL point.",
  parameters: {
    type: "object",
    properties: {
      sort_by: { type: "string", enum: ["significance", "intensity", "anisotropy", "width", "q"], description: "Default significance" },
      near_hkl: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Sort by distance to this (H, K, L) instead" },
      limit: { type: "integer", minimum: 1, maximum: 25, description: "Default 10" },
    },
  },
  run: async (args, { dataset }) => {
    const sortBy = oneOf(args, "sort_by", ["significance", "intensity", "anisotropy", "width", "q"] as const, "significance");
    const limit = Math.round(Math.min(25, Math.max(1, num(args, "limit", 10))));
    const near = Array.isArray(args.near_hkl) && args.near_hkl.length === 3 ? args.near_hkl.map(Number) : null;
    if (near && near.some((v) => !Number.isFinite(v))) throw new ToolArgError("near_hkl must be three numbers");
    const profile = await safe(fetchBraggProfile(dataset.id));
    if (!profile?.has_profile) {
      return { result: { has_profile: false }, summary: "no fitted Bragg profile (run the punch stage)" };
    }
    const peaks = profile.peaks.map((p) => {
      const w = p.principal_width_q ?? p.measured_width_q ?? p.width_q;
      const ws = (w ?? []).filter((v): v is number => Number.isFinite(v) && v > 0);
      return {
        hkl: p.center_hkl.map((v) => roundSig(v, 4)),
        q: r4(p.q_abs),
        intensity: r4(p.intensity),
        local_background: r4(p.local_background),
        significance: r4(p.significance ?? null),
        measured_width_q: p.measured_width_q?.map((v) => roundSig(v, 3)) ?? null,
        resolution_limited: p.resolution_limited ?? null,
        anisotropy: ws.length >= 2 ? roundSig(Math.max(...ws) / Math.min(...ws), 3) : null,
        fit: p.fit_kind,
      };
    });
    // Larger key first; a missing value sorts last.
    const LAST = -Number.MAX_VALUE;
    const key = (p: (typeof peaks)[number]): number => {
      if (near) return -Math.hypot(...p.hkl.map((v, i) => v - near[i]));
      if (sortBy === "width") return p.measured_width_q?.length ? Math.max(...p.measured_width_q) : LAST;
      if (sortBy === "q") return p.q != null ? -p.q : LAST;
      return p[sortBy] ?? LAST;
    };
    peaks.sort((x, y) => key(y) - key(x));
    const listed = peaks.slice(0, limit);
    const sortedBy = near ? `distance to ${near.join(", ")}` : sortBy;
    const result = {
      n_peaks: profile.n_peaks,
      punch_frame: profile.punch_frame,
      sorted_by: sortedBy,
      // A row per peak (a column table, tools/shared/table.ts).
      peaks: columnTable(listed, ["hkl", "q", "intensity", "local_background", "significance", "measured_width_q", "resolution_limited", "anisotropy", "fit"]),
    };
    const top = listed[0];
    return {
      result,
      summary: `${profile.n_peaks} fitted peaks; top ${listed.length} by ${sortedBy}`,
      view: top && {
        view: "bragg",
        hkl: top.hkl as [number, number, number],
        label: `the peak at (${top.hkl.join(", ")})`,
      },
    };
  },
};
