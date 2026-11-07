// The Highlights (THY-66): each measuring step's whole result mapped to
// overlays on the cleanup page's slice views, so the user sees what a check
// measured where it measured it. A mapper per tool, in one registry: it reads
// the step's result as the tool found it (readings/ `found`) and the data its
// result leaves out (examine/data.ts), both already in memory, so an overlay
// costs no request and no token, and the two engines draw the same. A test
// (examine/__tests__/overlays.test.ts) holds every measuring tool (facts'
// `measures`) to a mapper, an explicit "none", or one PR 5 adds.
//
// v1 (design §3.2): the Bragg punch (leftovers by kind, the punch holes, round
// 2), the ring removal (shells by code), the coverage (the counts' edges,
// unmeasured space hatched, the transform's reach, the suggested band) and the
// background correction (the judged |Q| band).
// v2: the fitted Bragg peaks (footprints, on the Bragg page and the raw view),
// the ΔPDF's candidates (on its sections), the UB turn (arrows at the Bragg
// nodes), the fill's holes outside their range, the grains (far orbits, the
// rotated copy's nodes) and a line profile's line.

import type { AgentStep } from "../agent";
import { found, type Found } from "../readings";
import { isTable, tableRows } from "../tools/shared/table";
import { inv3, mm } from "./linalg";
import type { ViewTarget } from "../tools/openView";
import type { LeftoverPeak, OverlayData } from "./data";

// ---------------------------------------------------------------- what a set holds

/** A class of overlay: one legend chip, turned on and off as one. */
export type ClassId =
  | "node" // a leftover at a lattice node: a missed Bragg peak
  | "sharp" // a sharp leftover off the lattice
  | "broad" // a broad one off the lattice: a diffuse maximum, kept
  | "protected" // off the lattice where the run's search left it alone
  | "holes" // the punch's holes, from the slice's own NaN voxels
  | "r2" // round 2 of the punch: the tail sweep's voxels
  | "AL" // ring shells by code (design §3.2)
  | "LEFT"
  | "GRID"
  | "XTAL"
  | "NJ"
  | "judged" // the background correction's judged |Q| band
  | "pedestal" // the same band, where a pedestal is left
  | "unmeasured" // |Q| outside the raw counts' edges, hatched
  | "edges" // the raw counts' edges
  | "reach" // the forward transform's reach
  | "band" // the |Q| band the coverage suggests
  | "RM" // a confirmed ring removed that sat on no Al line
  | "fpRes" // a fitted Bragg peak, resolution-limited on every axis: its footprint solid
  | "fpBroad" // one broadened on some axis: dashed
  | "dpos" // a ΔPDF candidate: more pairs than the average structure (+)
  | "dneg" // fewer (−)
  | "turn" // the UB turn: the shift at each Bragg node, scaled up
  | "fillUp" // a punch hole filled above its rim's range
  | "fillDown" // below it
  | "far" // an off-lattice orbit far from any Bragg node
  | "rotated" // a node of the rotated copy of the Bragg lattice (a second grain, or the UB off)
  | "line"; // a line profile's line

/** A semantic colour (index.css tokens), with shape and dash as the second cue. */
export type Tone = "red" | "amber" | "green" | "cyan" | "grey" | "white" | "r2" | "accent" | "blue" | "teal";

/** How a class draws on a stage's view: in full, or faint (the view it was compared with). */
export type Style = "full" | "faint";

export interface ClassDef {
  id: ClassId;
  label: string; // the chip's words, short
  code?: string; // a ring shell's code (AL, LEFT, …), before the words
  tone: Tone;
  views: Partial<Record<string, Style>>; // stage output → how it draws there
}

type V3 = [number, number, number];
type M3 = number[][]; // rows

export type OverlayItem =
  | { kind: "peak"; cls: ClassId; plane: string; cut: number; x: number; y: number; sigma: number }
  // A point in the volume's own coordinates (H K L, or x y z in Å), drawn on a
  // section within `tolVoxels` of the cut (default ½); `size` orders them
  // (the largest drawn first, and labelled) and sizes the mark.
  | { kind: "spot"; cls: ClassId; at: V3; size: number; label?: string; tolVoxels?: number }
  // A fitted Bragg peak's footprint (as the Bragg page draws its fit): its
  // principal widths and directions (r.l.u.), else its widths along H K L.
  | { kind: "footprint"; cls: ClassId; at: V3; widths: V3; dirs: M3 | null; principal: V3 | null; label?: string }
  // The UB turn ω (rad, Cartesian) at the Bragg nodes (every `cell` r.l.u.):
  // each node's shift ω × Q, in H K L through the volume's UB.
  | { kind: "turn"; cls: ClassId; ub: M3; omega: V3; cell: V3 }
  // A lattice's nodes n (integers), at H K L = map · n.
  | { kind: "lattice"; cls: ClassId; map: M3 }
  // A line along one axis (0–2) through `through` (the other two coordinates).
  | { kind: "line"; cls: ClassId; along: number; through: V3 }
  | { kind: "shell"; cls: ClassId; q: number; tick?: "up" | "down" }
  | { kind: "band"; cls: ClassId; q0: number; q1: number }
  // |Q| below `inside` (a beam stop) and above `outside` (past the counts)
  | { kind: "hatch"; cls: ClassId; inside: number | null; outside: number }
  | { kind: "holes"; cls: ClassId } // traced from the punched view's slice
  | { kind: "voxels"; cls: ClassId; hkl: readonly number[] }; // H K L flat

/** One step's overlays, as the views draw them. */
export interface OverlaySet {
  key: string; // the step's content (stepKey): the same result, the same set
  tool: string;
  stepId: string;
  title: string; // what is examined: "Bragg punch"
  where: string; // the result, in a few words: "3 missed at nodes · 9 sharp off-lattice"
  help: string[]; // behind "?": the codes, and the numbers left out
  measured: string[]; // the stage outputs it measured: a run that rewrites one drops the set
  views: Partial<Record<string, "primary" | "reading">>; // the views it reads, outlined
  classes: ClassDef[]; // those present, in legend order
  items: OverlayItem[];
  notes?: Partial<Record<ClassId, string>>; // a chip's word beside its count ("ub turn ×50")
  view?: ViewTarget; // where Follow (or "Go there") takes the console
}

// ---------------------------------------------------------------- the classes

const PUNCHED = "braggpunched";
const RAW = "raw";
const RINGS = "ringremoved";
const FILLED = "backfilled";
// The Bragg page's tiles and the 3D-ΔPDF page's sections, as views.
export const BRAGG = "bragg";
export const DPDF = "delta_pdf";

const CLASSES: Record<ClassId, ClassDef> = {
  node: { id: "node", label: "left at a node", tone: "red", views: { [PUNCHED]: "full", [RAW]: "faint" } },
  sharp: { id: "sharp", label: "off-lattice", tone: "amber", views: { [PUNCHED]: "full", [RAW]: "faint" } },
  broad: { id: "broad", label: "broad, kept", tone: "cyan", views: { [PUNCHED]: "full", [RAW]: "faint" } },
  protected: { id: "protected", label: "protected, kept", tone: "grey", views: { [PUNCHED]: "full", [RAW]: "faint" } },
  holes: { id: "holes", label: "holes", tone: "white", views: { [PUNCHED]: "full" } },
  r2: { id: "r2", label: "round 2", tone: "r2", views: { [PUNCHED]: "full" } },
  AL: { id: "AL", code: "AL", label: "Al line", tone: "green", views: { [RAW]: "full", [RINGS]: "faint" } },
  LEFT: { id: "LEFT", code: "LEFT", label: "ring left", tone: "red", views: { [RAW]: "full", [RINGS]: "full" } },
  GRID: { id: "GRID", code: "GRID", label: "not confirmable on this grid", tone: "amber", views: { [RAW]: "full", [RINGS]: "full" } },
  XTAL: { id: "XTAL", code: "XTAL", label: "the crystal's own", tone: "grey", views: { [RAW]: "full" } },
  NJ: { id: "NJ", code: "NJ", label: "not judged", tone: "white", views: { [RAW]: "full", [RINGS]: "faint" } },
  judged: { id: "judged", label: "judged |Q|", tone: "accent", views: { flattened: "full", backfilled: "faint" } },
  pedestal: { id: "pedestal", label: "pedestal left", tone: "amber", views: { flattened: "full", backfilled: "faint" } },
  unmeasured: { id: "unmeasured", label: "unmeasured", tone: "grey", views: { [RAW]: "full" } },
  edges: { id: "edges", label: "counts' edges", tone: "white", views: { [RAW]: "full" } },
  reach: { id: "reach", label: "transform's reach", tone: "amber", views: { [RAW]: "full" } },
  band: { id: "band", label: "suggested band", tone: "green", views: { [RAW]: "full" } },
  RM: { id: "RM", code: "RM", label: "removed (not Al)", tone: "accent", views: { [RAW]: "full", [RINGS]: "faint" } },
  fpRes: { id: "fpRes", label: "resolution-limited", tone: "accent", views: { [BRAGG]: "full", [RAW]: "full" } },
  fpBroad: { id: "fpBroad", label: "broadened", tone: "amber", views: { [BRAGG]: "full", [RAW]: "full" } },
  dpos: { id: "dpos", label: "+ more pairs", tone: "red", views: { [DPDF]: "full" } },
  dneg: { id: "dneg", label: "− fewer pairs", tone: "blue", views: { [DPDF]: "full" } },
  turn: { id: "turn", label: "UB turn", tone: "amber", views: { [RAW]: "full", [BRAGG]: "full" } },
  fillUp: { id: "fillUp", label: "filled above", tone: "red", views: { [FILLED]: "full", [PUNCHED]: "faint" } },
  fillDown: { id: "fillDown", label: "filled below", tone: "blue", views: { [FILLED]: "full", [PUNCHED]: "faint" } },
  far: { id: "far", label: "far from nodes", tone: "amber", views: { [RAW]: "full", [PUNCHED]: "faint" } },
  rotated: { id: "rotated", label: "rotated copy", tone: "teal", views: { [RAW]: "full" } },
  line: { id: "line", label: "profile line", tone: "accent", views: {} }, // on the stage the profile read (lineMapped)
};

export const classDef = (id: ClassId): ClassDef => CLASSES[id];

// ---------------------------------------------------------------- small readers

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pair = (v: unknown): [number, number] | null => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [a, b] = [num(v[0]), num(v[1])];
  return a != null && b != null ? [a, b] : null;
};
const round = (x: number, d = 2) => Number(x.toFixed(d));

// ---------------------------------------------------------------- the punch

/** A leftover's class: at a node; else where the search left it alone; else broad; else sharp off the lattice. */
export function leftoverClass(p: Pick<LeftoverPeak, "at_node" | "on_protected_plane" | "broad">): ClassId {
  if (p.at_node) return "node";
  if (p.on_protected_plane) return "protected";
  return p.broad ? "broad" : "sharp";
}

// The plane's name as the result writes it, from a cut's label ("K–L plane at H = 0") or a plane id.
const RECIP_PLANES = ["hk0", "h0l", "0kl"];
const FIXED_AXIS: Record<string, string> = { hk0: "L", h0l: "K", "0kl": "H" };

function punchItems(leftovers: readonly LeftoverPeak[], round2: readonly number[] | undefined): OverlayItem[] {
  const items: OverlayItem[] = leftovers
    .filter((p) => RECIP_PLANES.includes(p.plane) && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ kind: "peak", cls: leftoverClass(p), plane: p.plane, cut: p.cut, x: p.x, y: p.y, sigma: p.sigma }));
  items.push({ kind: "holes", cls: "holes" });
  if (round2?.length) items.push({ kind: "voxels", cls: "r2", hkl: round2 });
  return items;
}

/** The leftovers measure_reciprocal_cut found on its cut (its strongest few, as its result lists them). */
function cutLeftovers(r: Found, plane: string, cut: number): LeftoverPeak[] {
  const lo = r.bragg_punch_leftover;
  const peaks = isObj(lo) && Array.isArray(lo.suspicious_peaks) ? lo.suspicious_peaks : [];
  return peaks.flatMap((p): LeftoverPeak[] => {
    if (!isObj(p)) return [];
    const xy = pair(p.xy);
    if (!xy) return [];
    return [{
      plane,
      cut,
      x: xy[0],
      y: xy[1],
      sigma: num(p.sigma) ?? 0,
      broad: p.broad === true,
      ...(typeof p.at_node === "boolean" ? { at_node: p.at_node } : {}),
      ...(typeof p.on_protected_plane === "boolean" ? { on_protected_plane: p.on_protected_plane } : {}),
    }];
  });
}

// ---------------------------------------------------------------- the rings

/** The ring stage's record of its shells in one line (stage_shells), read back. */
export interface StageShells {
  alA: number | null; // the fitted Al lattice (Å)
  removed: number | null;
  removedOnAl: number | null;
  left: { q: number; al: string | null; code: string | null }[];
  leftCount: number | null;
}

// nebula3d.preprocessing.pooled_rings.shell_summary: "Al a=4.049 Å; removed 5 (Al 4); left 2: 2.68 Al111 grid, 3.10 isotropy, +1 more".
export function parseStageShells(line: unknown): StageShells | null {
  if (typeof line !== "string" || !line.trim()) return null;
  const al = /Al a=([\d.]+)\s*Å/.exec(line);
  const removed = /removed (\d+)(?: \(Al (\d+)\))?/.exec(line);
  const leftAt = /left (\d+): (.*)$/.exec(line);
  const left = (leftAt?.[2] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("+"))
    .flatMap((s) => {
      const [q, ...rest] = s.split(/\s+/);
      const qv = Number(q);
      if (!Number.isFinite(qv)) return [];
      const alLine = rest.find((t) => /^Al\d/.test(t)) ?? null;
      const code = rest.find((t) => !/^Al\d/.test(t)) ?? null;
      return [{ q: qv, al: alLine, code }];
    });
  return {
    alA: al ? Number(al[1]) : null,
    removed: removed ? Number(removed[1]) : null,
    removedOnAl: removed?.[2] ? Number(removed[2]) : removed ? 0 : null,
    left,
    leftCount: leftAt ? Number(leftAt[1]) : 0,
  };
}

// Shells within this |Q| (Å⁻¹) of each other are one, drawn once, by the code first in RANK.
const SAME_SHELL_Q = 0.05;
// The ring stage's codes for a shell it left: why it could not judge it (nodata, …), or the
// criterion it failed (pooled_rings._left_code). "grid" has a code of its own; "isotropy",
// rising in some directions only, is the crystal's own; the others are too weak to call.
const UNJUDGED = new Set(["flank", "cells", "nodata", "unjudged"]);
// A confirmed ring within this |Q| (Å⁻¹) of a shell the stage removed is that shell (as a residual is).
const NEAR_RING_Q = 0.1;

const RANK: ClassId[] = ["LEFT", "GRID", "NJ", "AL", "RM", "XTAL"];

interface Shell {
  cls: ClassId;
  q: number;
  tick?: "up" | "down";
}

/**
 * The shells by code (design §3.2, question 5: derived from today's fields).
 * The removed ones exactly as the ring stage's record lists them (AL on an Al
 * line, RM on none): without that record (an older server's, or a step drawn
 * again from its result) none are drawn as removed.
 */
export function ringShells(rings: Found, data?: OverlayData): Shell[] {
  const shells: Shell[] = [];
  const stage = parseStageShells(rings.stage_shells);
  const removed = (data?.ringsRemoved ?? []).filter((r) => Number.isFinite(r.q));
  // The residuals on the planes, confirmed rings among them, by |Q|.
  const per = isObj(rings.per_plane) ? Object.values(rings.per_plane) : [];
  const residuals = per.flatMap((p) => (isObj(p) && Array.isArray(p.ring_residuals) ? p.ring_residuals.filter(isObj) : []));
  const judged = Array.isArray(rings.shells_judged) ? rings.shells_judged.filter(isObj) : null;
  if (judged) {
    for (const s of judged) {
      const q = num(s.at);
      if (q == null) continue;
      if (typeof s.not_judged === "string" && s.not_judged) {
        shells.push({ cls: "NJ", q });
        continue;
      }
      if (s.ring !== true) {
        shells.push({ cls: "XTAL", q });
        continue;
      }
      // A confirmed ring: left where a plane's residual there is significant
      // (▲ above what the removal should leave, ▼ a dent), else removed.
      const near = residuals.filter((r) => r.significant === true && num(r.at) != null && Math.abs((r.at as number) - q) <= 0.1);
      if (near.length) {
        const worst = near.reduce((a, b) => (Math.abs(num(b.residual_fraction) ?? 0) > Math.abs(num(a.residual_fraction) ?? 0) ? b : a));
        shells.push({ cls: "LEFT", q, tick: (num(worst.residual_fraction) ?? 0) < 0 ? "down" : "up" });
      } else if (data?.ringsRemoved) {
        // Removed cleanly: as the record has it (its |Q| drawn below), else not on an Al line.
        if (!removed.some((r) => Math.abs(r.q - q) <= NEAR_RING_Q)) shells.push({ cls: "RM", q });
      }
    }
  } else if (typeof rings.ring_rule === "string" && rings.ring_rule.startsWith("not judged")) {
    // The 3D test could not run: every significant bump is not judged.
    for (const r of residuals) if (r.significant === true && num(r.at) != null) shells.push({ cls: "NJ", q: r.at as number });
  }
  // The shells the ring stage left, by its code; and the candidates it could not confirm on its grid.
  for (const l of stage?.left ?? []) {
    if (l.code === "grid") shells.push({ cls: "GRID", q: l.q });
    else if (l.code && UNJUDGED.has(l.code)) shells.push({ cls: "NJ", q: l.q });
    else if (l.code === "isotropy") shells.push({ cls: "XTAL", q: l.q });
  }
  for (const q of data?.ringsAtGrid ?? []) if (Number.isFinite(q)) shells.push({ cls: "GRID", q });
  // Every shell the stage removed, at its own |Q|: on an Al line, or not.
  for (const r of removed) shells.push({ cls: r.al ? "AL" : "RM", q: r.q });
  // One shell per |Q|: the highest-ranked code.
  shells.sort((a, b) => a.q - b.q);
  const merged: Shell[] = [];
  for (const s of shells) {
    const same = merged.find((m) => Math.abs(m.q - s.q) <= SAME_SHELL_Q);
    if (!same) merged.push({ ...s });
    else if (RANK.indexOf(s.cls) < RANK.indexOf(same.cls)) Object.assign(same, s);
  }
  return merged;
}

// ---------------------------------------------------------------- the mappers

interface Mapped {
  title: string;
  where: string;
  help: string[];
  measured: string[];
  views: OverlaySet["views"];
  items: OverlayItem[];
  notes?: OverlaySet["notes"];
  classViews?: Partial<Record<ClassId, ClassDef["views"]>>; // a class's views for this set alone (the profile's line)
}

type Mapper = (r: Found, args: Record<string, unknown>, data: OverlayData | undefined) => Mapped | null;

const PUNCH_HELP = [
  "Leftovers: red ring at a lattice node (a missed Bragg peak); amber diamond sharp off the lattice; cyan dashed broad (a diffuse maximum, kept); grey where the run's search left the position alone (protected, kept).",
  "Holes: the punch's NaN voxels on this slice, traced. Round 2: the voxels the tail sweep added (magenta).",
];
const RINGS_HELP = [
  "AL: a shell the ring stage removed on an Al line. RM: one it removed on none. LEFT: a ring the 3D test confirms, left (▲) or dented (▼) by the removal. GRID: not confirmable on this grid. XTAL: the crystal's own scattering, rising in some directions only. NJ: not judged.",
];

function punchMapped(r: Found, data: OverlayData | undefined): Mapped | null {
  const n = (k: string) => num(r[k]);
  const sharp = n("leftover_off_lattice_sharp");
  const kept = n("leftover_on_protected_planes_sharp") ?? 0;
  // The result first: what is left, the zeros left out.
  const parts: [number | null, string][] = [
    [n("leftover_at_nodes"), "missed at nodes"],
    [sharp != null ? sharp - kept : null, "sharp off-lattice"],
    [n("leftover_off_lattice_broad"), "broad kept"],
  ];
  const counted = parts.filter(([v]) => v != null);
  const where = counted.filter(([v]) => v! > 0).map(([v, what]) => `${v} ${what}`).join(" · ");
  return {
    title: "Bragg punch",
    where: where ? `${where}, on the three planes` : counted.length ? "no leftover peaks on the three planes" : "leftover peaks",
    help: PUNCH_HELP,
    measured: [PUNCHED],
    views: { [PUNCHED]: "primary", [RAW]: "reading" },
    items: punchItems(data?.leftovers ?? [], data?.round2),
  };
}

function ringsMapped(r: Found, data: OverlayData | undefined): Mapped | null {
  const shells = ringShells(r, data);
  const judged = Array.isArray(r.shells_judged) ? r.shells_judged.length : null;
  const stage = parseStageShells(r.stage_shells);
  const where = [
    judged != null ? `${judged} shell${judged === 1 ? "" : "s"} judged in 3D` : typeof r.ring_rule === "string" ? "rings not judged" : null,
    stage?.removed != null && `removed ${stage.removed}${stage.removedOnAl ? ` (Al ${stage.removedOnAl})` : ""}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const help = [...RINGS_HELP];
  if (stage?.alA) help.push(`The fitted Al lattice: a = ${stage.alA} Å.`);
  if (!data?.ringsRemoved && stage?.removed) help.push("The removed shells are not drawn: this record does not list them.");
  if (typeof r.stage_phases === "string" && r.stage_phases) help.push(`Other phases: ${r.stage_phases}`);
  return {
    title: "Ring removal",
    where,
    help,
    measured: [RINGS],
    views: { [RAW]: "primary", [RINGS]: "reading" },
    items: shells.map((s) => ({ kind: "shell", cls: s.cls, q: s.q, ...(s.tick ? { tick: s.tick } : {}) })),
  };
}

function flattenMapped(r: Found): Mapped | null {
  const band = pair(r.floor_judged_q);
  if (!band) return null;
  const pedestal = r.pedestal_left === true;
  return {
    title: "Background correction",
    where: `judged |Q| ${round(band[0])}–${round(band[1])} Å⁻¹ · ${pedestal ? "pedestal left" : "no pedestal"}`,
    help: ["The |Q| band the shell floors were judged over; amber where they leave a pedestal (floors rising or spread with |Q|)."],
    measured: ["flattened"],
    views: { flattened: "primary", backfilled: "reading" },
    items: [{ kind: "band", cls: pedestal ? "pedestal" : "judged", q0: band[0], q1: band[1] }],
  };
}

const assessStage: Mapper = (r, args, data) => {
  const stage = typeof args.stage === "string" ? args.stage : "all";
  const parts: Mapped[] = [];
  if ((stage === "punch" || stage === "all") && isObj(r.punch) && !("missing" in r.punch)) {
    const m = punchMapped(r.punch, data);
    if (m) parts.push(m);
  }
  if ((stage === "rings" || stage === "all") && isObj(r.rings) && !("missing" in r.rings)) {
    const m = ringsMapped(r.rings, data);
    if (m) parts.push(m);
  }
  if (stage === "flatten" && isObj(r.flatten)) {
    const m = flattenMapped(r.flatten);
    if (m) parts.push(m);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  // Every stage (stage=all): the punch and the rings together, each on its own views.
  return {
    title: "Every stage",
    where: parts.map((p) => `${p.title}: ${p.where}`).join(" · "),
    help: parts.flatMap((p) => p.help),
    measured: parts.flatMap((p) => p.measured),
    views: Object.assign({}, ...parts.map((p) => p.views)),
    items: parts.flatMap((p) => p.items),
  };
};

const measureCut: Mapper = (r, args) => {
  const plane = typeof args.plane === "string" ? args.plane : null;
  const cut = num(args.value);
  if (!plane || !RECIP_PLANES.includes(plane) || cut == null) return null;
  const lo = r.bragg_punch_leftover;
  const total = isObj(lo) ? num(lo.n_suspicious) : null;
  const leftovers = cutLeftovers(r, plane, cut);
  const shown = leftovers.length;
  return {
    title: "Bragg punch",
    where: `${plane}, ${FIXED_AXIS[plane]} = ${cut}: ${total ?? shown} leftover peak${(total ?? shown) === 1 ? "" : "s"}${total != null && total > shown ? `, the strongest ${shown} drawn` : ""}`,
    help: PUNCH_HELP,
    measured: [PUNCHED],
    views: { [PUNCHED]: "primary", [RAW]: "reading" },
    items: punchItems(leftovers, undefined),
  };
};

const coverage: Mapper = (r) => {
  const counts = isObj(r.raw_counts) ? r.raw_counts : null;
  const lo = num(counts?.q_min_edge);
  const hi = num(counts?.q_max_edge);
  const reach = num(r.transform_reach_q);
  const band = pair(r.suggested_band);
  const items: OverlayItem[] = [];
  if (hi != null) items.push({ kind: "hatch", cls: "unmeasured", inside: lo != null && lo > 0 ? lo : null, outside: hi });
  if (lo != null && lo > 0) items.push({ kind: "shell", cls: "edges", q: lo });
  if (hi != null) items.push({ kind: "shell", cls: "edges", q: hi });
  if (reach != null) items.push({ kind: "shell", cls: "reach", q: reach });
  if (band) for (const q of band) if (q > 0) items.push({ kind: "shell", cls: "band", q });
  if (!items.length) return null;
  const where = [
    hi != null && `counts ${lo != null && lo > 0 ? `${round(lo)}–` : "to "}${round(hi)} Å⁻¹`,
    reach != null && `reach ${round(reach)} Å⁻¹`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    title: "Coverage",
    where,
    help: ["Hatched: |Q| outside where the raw counts begin and end. Amber: how far the forward transform reaches. Green: the band the counts allow."],
    measured: [RAW],
    views: { [RAW]: "primary" },
    items,
  };
};

// ---------------------------------------------------------------- v2: small helpers

const v3 = (v: unknown): V3 | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(num);
  return out.every((x) => x != null) ? (out as V3) : null;
};
const isM3 = (m: unknown): m is M3 => Array.isArray(m) && m.length === 3 && m.every((r) => v3(r) != null);
/** An hkl as a label: "2 0 0", or "1.5 0 2". */
export const hklLabel = (h: readonly number[]): string => h.map((x) => String(Number(x.toFixed(2)) + 0)).join(" ");

/**
 * The turn ω (rad, Cartesian) that takes the volume's UB to the fitted one:
 * the antisymmetric part of fitted·UB⁻¹ (a small rotation, to first order;
 * the symmetric part is the cell's change). Each node then sits ω × Q off.
 */
export function ubOmega(ub: M3, fitted: M3): V3 | null {
  const inv = inv3(ub);
  if (!inv) return null;
  const m = mm(fitted, inv);
  const w: V3 = [(m[2][1] - m[1][2]) / 2, (m[0][2] - m[2][0]) / 2, (m[1][0] - m[0][1]) / 2];
  return w.every(Number.isFinite) ? w : null;
}

// ---------------------------------------------------------------- v2: the mappers

const BRAGG_HELP = "Each listed peak's fitted footprint, as the Bragg page draws its fit: solid where resolution-limited on every axis, dashed where broadened; the first 8 named.";

const braggPeaks: Mapper = (r, _args, data) => {
  const rows = isTable(r.peaks) ? tableRows(r.peaks) : Array.isArray(r.peaks) ? r.peaks.filter(isObj) : [];
  if (!rows.length) return null;
  const items: OverlayItem[] = [];
  let res = 0;
  rows.forEach((row, i) => {
    const hkl = v3(row.hkl);
    if (!hkl) return;
    const flags = Array.isArray(row.resolution_limited) ? row.resolution_limited : null;
    const broad = flags ? flags.some((f) => f === false) : false;
    if (!broad) res += 1;
    const cls: ClassId = broad ? "fpBroad" : "fpRes";
    const label = i < 8 ? hklLabel(hkl) : undefined;
    const fp = data?.braggPeaks?.find((p) => p.hkl.every((x, k) => Math.abs(x - hkl[k]) <= 1e-3 * Math.max(1, Math.abs(x))));
    if (fp) items.push({ kind: "footprint", cls, at: fp.hkl, widths: fp.widths, dirs: fp.dirs, principal: fp.principal, ...(label ? { label } : {}) });
    else items.push({ kind: "spot", cls, at: hkl, size: rows.length - i, ...(label ? { label } : {}) });
  });
  const n = num(r.n_peaks);
  const by = typeof r.sorted_by === "string" ? r.sorted_by : null;
  return {
    title: "Bragg peaks",
    where: [`${rows.length}${n != null ? ` of ${n}` : ""} peaks${by ? ` by ${by}` : ""}`, `${res} resolution-limited`, `${rows.length - res} broadened`].join(" · "),
    help: [BRAGG_HELP],
    measured: [PUNCHED],
    views: { [BRAGG]: "primary", [RAW]: "reading" },
    items,
  };
};

const DPDF_HELP = "The listed features at every vector, and the vector opposite (the ΔPDF is centrosymmetric): red + more pairs than the average structure, blue − fewer; the ring grows with |σ|. Drawn on a section within half a voxel of it; the strongest 8 named by length.";

const dpdfPeaks: Mapper = (r, _args, data) => {
  const feats = Array.isArray(r.features) ? r.features.filter(isObj) : [];
  if (!feats.length) return null;
  // Every vector the backend gave (data), else the result's few per feature.
  const vectors = data?.dpdfVectors ?? feats.flatMap((f, rank) => {
    const size = num(f.size_sigma) ?? 0;
    const length = num(f.length_A) ?? 0;
    return (Array.isArray(f.vectors_A) ? f.vectors_A : []).flatMap((v) => {
      const p = v3(v);
      return p ? [{ v: p, size, length, rank }] : [];
    });
  });
  const items: OverlayItem[] = [];
  for (const { v, size, length, rank } of vectors) {
    const cls: ClassId = size >= 0 ? "dpos" : "dneg";
    const label = rank < 8 ? `${Number(length.toPrecision(3))} Å` : undefined;
    for (const at of [v, v.map((x) => -x || 0) as V3]) items.push({ kind: "spot", cls, at, size: Math.abs(size), ...(label ? { label } : {}) });
  }
  const top = feats[0];
  const size = num(top.size_sigma);
  const len = num(top.length_A);
  const extrema = num(r.extrema_above_threshold);
  const thr = num(r.threshold_sigma);
  return {
    title: "ΔPDF features",
    where: [
      `${feats.length} feature${feats.length === 1 ? "" : "s"}${extrema != null && thr != null ? ` of ${extrema} extrema above ${thr}σ` : ""}`,
      size != null && len != null ? `strongest ${size > 0 ? "+" : "−"} at ${Number(len.toPrecision(3))} Å, ${Math.abs(size)}σ` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    help: [DPDF_HELP],
    measured: [DPDF],
    views: { [DPDF]: "primary" },
    items,
  };
};

const ubCheck: Mapper = (r, _args, data) => {
  const turn = data?.ubTurn;
  if (!turn || !isM3(turn.ub) || !isM3(turn.fitted)) return null;
  const omega = ubOmega(turn.ub, turn.fitted);
  if (!omega || Math.hypot(...omega) < 1e-9) return null;
  const deg = num(r.orientation_change_deg);
  const axis = v3(r.axis_uvw);
  const r0 = num(r.rms_start);
  const r1 = num(r.rms);
  return {
    title: "UB turn",
    where: [
      deg != null && `turned ${deg}°${axis ? ` about [${axis.join(" ")}]` : ""}`,
      r0 != null && r1 != null && `RMS ${r0} → ${r1} Å⁻¹`,
    ]
      .filter(Boolean)
      .join(" · "),
    help: [
      "Arrows at the Bragg nodes on the cut: where the fitted UB puts each peak against the volume's (ω × Q, the turn alone, without the cell's change), scaled up by the factor on the chip. The shift is across Q and grows with |Q|.",
    ],
    measured: [RAW],
    views: { [RAW]: "primary", [BRAGG]: "reading" },
    items: [{ kind: "turn", cls: "turn", ub: turn.ub, omega, cell: turn.cell }],
  };
};

const textureCheck: Mapper = (r, _args, data) => {
  const fills = data?.fillHoles;
  if (!fills?.holes.length) return null;
  const items: OverlayItem[] = fills.holes.map((h, i) => ({
    kind: "spot",
    cls: h.bias > 0 ? "fillUp" : "fillDown",
    at: h.hkl,
    size: Math.abs(h.biasSigma ?? 0),
    // Drawn on the cuts through it: within its radius along the cut (a sphere of its voxels).
    tolVoxels: Math.max(0.5, Math.cbrt(h.voxels) / 2),
    ...(i < 8 && h.biasSigma != null ? { label: `${h.biasSigma > 0 ? "+" : "−"}${Number(Math.abs(h.biasSigma).toPrecision(2))}σ` } : {}),
  }));
  const up = fills.holes.filter((h) => h.bias > 0).length;
  const judged = num(r.n_judged);
  const bias = r.systematic_fill_bias;
  return {
    title: "Backfill holes",
    where: [
      bias === true ? "systematic fill bias" : bias === false ? "no systematic fill bias" : "fill bias not judged",
      `${up} filled above their range, ${fills.holes.length - up} below${judged != null ? ` (of ${judged} judged)` : ""}`,
    ].join(" · "),
    help: ["The punch holes whose fill lies outside the range their rim allows: ▲ above, ▼ below, the farthest named in the rim's σ. Drawn on the cuts through each hole."],
    measured: [FILLED, PUNCHED],
    views: { [FILLED]: "primary", [PUNCHED]: "reading" },
    items,
  };
};

const grainCheck: Mapper = (r, _args, data) => {
  const g = data?.grains;
  const far: V3[] = g?.far ?? (Array.isArray(r.far) ? r.far.flatMap((f) => (isObj(f) && v3(f.hkl) ? [v3(f.hkl)!] : [])) : []);
  const items: OverlayItem[] = far.map((at) => ({ kind: "spot", cls: "far", at, size: 1 }));
  if (g?.rotated && isM3(g.rotated)) items.push({ kind: "lattice", cls: "rotated", map: g.rotated });
  if (!items.length) return null;
  const copy = isObj(r.rotated_copy) ? r.rotated_copy : null;
  const judged = num(r.judged);
  const control = num(r.random_control);
  const mis = copy ? num(copy.misorientation_deg) : null;
  return {
    title: "Grains",
    where: [
      copy && judged != null && `a rotated copy indexes ${num(copy.indexed) ?? 0} of ${judged} orbits${control != null ? ` (random ${control})` : ""}${mis != null ? `, ${mis}° off` : ""}`,
      Array.isArray(r.far) && `${r.far.length} far from any node`,
    ]
      .filter(Boolean)
      .join(" · "),
    help: [
      "✕ the strongest off-lattice orbits far from any Bragg node, at every image under the declared symmetry. Teal: the nodes of the rotated copy of the Bragg lattice, where it explains the orbits (a second grain, or the UB off), within a voxel of the cut.",
    ],
    measured: [PUNCHED],
    views: { [RAW]: "primary", [PUNCHED]: "reading" },
    items,
  };
};

const RECIP_AXES = ["H", "K", "L"];
const REAL_AXES = ["x", "y", "z"];

const lineProfile: Mapper = (r) => {
  const stage = typeof r.stage === "string" ? r.stage : null;
  const along = typeof r.along === "string" ? r.along : null;
  const through = isObj(r.through) ? r.through : null;
  if (!stage || !along || !through) return null;
  const axes = stage === DPDF ? REAL_AXES : RECIP_AXES;
  const a = axes.indexOf(along);
  if (a < 0) return null;
  const at = [0, 0, 0] as V3;
  for (let i = 0; i < 3; i++) if (i !== a) at[i] = num(through[axes[i]]) ?? 0;
  const max = isObj(r.max) ? r.max : null;
  return {
    title: "A line profile",
    where: `${stage} along ${along} at ${axes.filter((_x, i) => i !== a).map((x, i2) => `${x} = ${at[[0, 1, 2].filter((i) => i !== a)[i2]]}`).join(", ")}${max && num(max.value) != null ? ` · max ${max.value} at ${max.at}` : ""}`,
    help: ["The line the profile read, in a dashed band, on the view of its stage."],
    measured: [stage],
    views: { [stage]: "primary" },
    items: [{ kind: "line", cls: "line", along: a, through: at }],
    classViews: { line: { [stage]: "full" } },
  };
};

/**
 * Why a measuring tool draws nothing: "none" (with a title, the bar names it
 * while it runs), or what is deferred.
 */
type Entry = Mapper | { none: string; title?: string } | { later: string; title: string };

/** The registry: every measuring tool, by name (the test holds it to facts' `measures`). */
export const OVERLAYS: Record<string, Entry> = {
  assess_stage: assessStage,
  measure_reciprocal_cut: measureCut,
  qmax_coverage: coverage,
  // The views read the marks themselves (RegionMarks), above the overlays.
  mark_region: { none: "marks draw as today, above the overlays" },
  show_in_viewer: { none: "it opens a view, as today" },
  run_pipeline: { none: "a run: the Execution page shows it" },
  tune_pipeline: { none: "a tuning run: its card shows it" },
  symmetry_check: { none: "a verdict on the volume: the bar only", title: "Symmetry" },
  compare_laue_classes: { none: "a verdict on the volume: the bar only", title: "Laue classes" },
  compare_datasets: { none: "two datasets' numbers: the bar only", title: "Two datasets" },
  consistency_details: { none: "the back-FFT check's own page draws it", title: "Back-FFT check" },
  measure_dpdf_cut: { none: "a ΔPDF section: the bar only", title: "A ΔPDF section" },
  dpdf_contrast: { none: "a ΔPDF number: the bar only", title: "ΔPDF contrast" },
  bragg_peaks: braggPeaks,
  dpdf_peaks: dpdfPeaks,
  ub_check: ubCheck,
  texture_check: textureCheck,
  grain_check: grainCheck,
  line_profile: lineProfile,
  radial_profile: { later: "the shell floors as a sparkline in the legend (deferred)", title: "A radial profile" },
};

const isMapper = (e: Entry | undefined): e is Mapper => typeof e === "function";

/** Whether a tool draws overlays. */
export const drawsOverlays = (name: string): boolean => isMapper(OVERLAYS[name]);

/** The step's content, as a key: the same call with the same result maps to the same set. */
export const stepKey = (step: Pick<AgentStep, "name" | "args" | "result">): string =>
  `${step.name}\u0000${JSON.stringify(step.args ?? {})}\u0000${step.result ?? ""}`;

/** The step's overlays, from what it found; null when its tool draws none, or it found nothing to draw. */
export function overlaysOf(step: AgentStep): OverlaySet | null {
  const entry = OVERLAYS[step.name];
  if (!isMapper(entry)) return null;
  const r = found(step);
  if (!r) return null;
  const m = entry(r, step.args ?? {}, step.overlay);
  if (!m || !m.items.length) return null;
  const present = new Set(m.items.map((i) => i.cls));
  const order = Object.keys(CLASSES) as ClassId[];
  const classOf = (c: ClassId): ClassDef => (m.classViews?.[c] ? { ...CLASSES[c], views: m.classViews[c]! } : CLASSES[c]);
  return {
    key: stepKey(step),
    tool: step.name,
    stepId: step.id,
    title: m.title,
    where: m.where,
    help: m.help,
    measured: m.measured,
    views: m.views,
    classes: order.filter((c) => present.has(c)).map(classOf),
    items: m.items,
    ...(m.notes ? { notes: m.notes } : {}),
    ...(step.view ? { view: step.view } : {}),
  };
}

// What the v2 tools examine while they run: their title and views.
const RUNNING: Record<string, (args: Record<string, unknown>) => { title: string; views: OverlaySet["views"] }> = {
  bragg_peaks: () => ({ title: "Bragg peaks", views: { [BRAGG]: "primary", [RAW]: "reading" } }),
  dpdf_peaks: () => ({ title: "ΔPDF features", views: { [DPDF]: "primary" } }),
  ub_check: () => ({ title: "UB turn", views: { [RAW]: "primary", [BRAGG]: "reading" } }),
  texture_check: () => ({ title: "Backfill holes", views: { [FILLED]: "primary", [PUNCHED]: "reading" } }),
  grain_check: () => ({ title: "Grains", views: { [RAW]: "primary", [PUNCHED]: "reading" } }),
  line_profile: (args) => {
    const stage = typeof args.stage === "string" ? args.stage : null;
    return { title: "A line profile", views: stage ? { [stage]: "primary" } : {} };
  },
};

/** What a running step examines: its title and the views it reads, before it has a result; null for a step the bar does not name. */
export function examining(step: Pick<AgentStep, "name" | "args">): { title: string; views: OverlaySet["views"] } | null {
  const entry = OVERLAYS[step.name];
  if (!entry) return null;
  if (!isMapper(entry)) return entry.title ? { title: entry.title, views: {} } : null;
  if (step.name === "qmax_coverage") return { title: "Coverage", views: { [RAW]: "primary" } };
  const running = RUNNING[step.name];
  if (running) return running(step.args ?? {});
  if (step.name === "measure_reciprocal_cut") return { title: "A reciprocal cut", views: { [PUNCHED]: "primary", [RAW]: "reading" } };
  const stage = typeof step.args?.stage === "string" ? step.args.stage : "all";
  switch (stage) {
    case "punch":
      return { title: "Bragg punch", views: { [PUNCHED]: "primary", [RAW]: "reading" } };
    case "rings":
      return { title: "Ring removal", views: { [RAW]: "primary", [RINGS]: "reading" } };
    case "flatten":
      return { title: "Background correction", views: { flattened: "primary", backfilled: "reading" } };
    case "backfill":
      return { title: "Backfill", views: { backfilled: "primary" } };
    case "pdf":
      return { title: "3D-ΔPDF", views: {} };
    default:
      return { title: "Every stage", views: {} };
  }
}
