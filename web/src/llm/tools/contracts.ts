// The shape of each tool's result, as the model reads it (JSON): a contract per
// tool of the registry whose result is an object (read_skill's is text). Each
// records the result's fields, their types, and which may be left out; a
// union holds the shapes a tool returns on its different paths. The code
// around the model never reads these: the tests hold the tools' results to
// them, the synthetic ones (modelVisible.test.ts's samples) and the live ones
// on the validation's dev control (contracts.replay.test.ts), and a result
// that disagrees fails, naming the field.
//
// A tool whose result changes changes its contract here, in the same commit
// (docs/development.md, "A Pilot tool's result contract"). The contract
// follows the tool, never the other way round.
//
// A leaf module: it imports nothing, so a test can read it beside any tool.

/** A JSON value's shape. */
export type Shape =
  | { readonly kind: "string" | "number" | "boolean" | "null" }
  | { readonly kind: "literal"; readonly value: string | number | boolean }
  | { readonly kind: "array"; readonly of: Shape }
  | { readonly kind: "tuple"; readonly of: readonly Shape[] }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, Field>> }
  | { readonly kind: "record"; readonly of: Shape } // any keys, each value of one shape
  | { readonly kind: "union"; readonly of: readonly Shape[] };

/** An object's field: its shape, and whether the result may leave it out. */
export interface Field {
  readonly shape: Shape;
  readonly optional: boolean;
}

// ---------------------------------------------------------------- building

export const str: Shape = { kind: "string" };
export const num: Shape = { kind: "number" };
export const bool: Shape = { kind: "boolean" };
export const nul: Shape = { kind: "null" };
export const lit = (value: string | number | boolean): Shape => ({ kind: "literal", value });
/** One of these strings. */
export const oneOf = (...values: string[]): Shape => union(...values.map(lit));
export const arr = (of: Shape): Shape => ({ kind: "array", of });
export const tuple = (...of: Shape[]): Shape => ({ kind: "tuple", of });
export const rec = (of: Shape): Shape => ({ kind: "record", of });
export const union = (...of: Shape[]): Shape => ({ kind: "union", of });
export const nullable = (shape: Shape): Shape => union(shape, nul);
/** A field the result may leave out (JSON drops a field that is undefined). */
export const optional = (shape: Shape): Field => ({ shape, optional: true });

const isField = (x: Shape | Field): x is Field => "shape" in x;

/** An object with exactly these fields: a field it holds that is not here disagrees. */
export const obj = (fields: Record<string, Shape | Field>): Shape => ({
  kind: "object",
  fields: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, isField(f) ? f : { shape: f, optional: false }])),
});

/** Two object shapes' fields as one object (the second's win). */
const merged = (a: Shape, b: Shape): Shape => {
  if (a.kind !== "object" || b.kind !== "object") throw new Error("merged takes two object shapes");
  return { kind: "object", fields: { ...a.fields, ...b.fields } };
};

// ---------------------------------------------------------------- checking

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** A shape in a few words, for a disagreement's message. */
export function describe(shape: Shape): string {
  switch (shape.kind) {
    case "literal":
      return JSON.stringify(shape.value);
    case "array":
      return `array of ${describe(shape.of)}`;
    case "tuple":
      return `[${shape.of.map(describe).join(", ")}]`;
    case "object":
      return `{ ${Object.entries(shape.fields).map(([k, f]) => (f.optional ? `${k}?` : k)).join(", ")} }`;
    case "record":
      return `record of ${describe(shape.of)}`;
    case "union":
      return shape.of.map(describe).join(" | ");
    default:
      return shape.kind;
  }
}

/**
 * Where `value` disagrees with `shape`: one line each, naming the path
 * (`result.per_cut[0].n_holes`). Empty when it agrees. A union agrees when
 * one of its shapes does; when none does, the lines are the closest one's.
 */
export function disagreements(shape: Shape, value: unknown, path = "result"): string[] {
  const got = typeOf(value);
  const expected = (): string[] => [`${path}: expected ${describe(shape)}, got ${got === "string" ? JSON.stringify(value) : got}`];
  switch (shape.kind) {
    case "string":
    case "number":
    case "boolean":
      return got === shape.kind ? [] : expected();
    case "null":
      return value === null ? [] : expected();
    case "literal":
      return value === shape.value ? [] : expected();
    case "array":
      return Array.isArray(value) ? value.flatMap((v, i) => disagreements(shape.of, v, `${path}[${i}]`)) : expected();
    case "tuple":
      if (!Array.isArray(value)) return expected();
      if (value.length !== shape.of.length) return [`${path}: expected ${shape.of.length} items (${describe(shape)}), got ${value.length}`];
      return value.flatMap((v, i) => disagreements(shape.of[i], v, `${path}[${i}]`));
    case "record":
      if (got !== "object") return expected();
      return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => disagreements(shape.of, v, `${path}.${k}`));
    case "object": {
      if (got !== "object") return expected();
      const o = value as Record<string, unknown>;
      const out: string[] = [];
      for (const [k, f] of Object.entries(shape.fields)) {
        if (o[k] === undefined) {
          if (!f.optional) out.push(`${path}.${k}: missing (${describe(f.shape)})`);
        } else out.push(...disagreements(f.shape, o[k], `${path}.${k}`));
      }
      for (const k of Object.keys(o)) if (!(k in shape.fields)) out.push(`${path}.${k}: not in the contract (got ${typeOf(o[k])})`);
      return out;
    }
    case "union": {
      const tried = shape.of.map((s) => disagreements(s, value, path));
      if (tried.some((d) => !d.length)) return [];
      // None fits at the value itself (another type, another literal): the union is what was expected.
      if (tried.every((d) => d.length === 1 && d[0].startsWith(`${path}: `))) return expected();
      return tried.reduce((best, d) => (d.length < best.length ? d : best));
    }
  }
}

// ---------------------------------------------------------------- the pieces the tools share

const range = tuple(num, num);
const v3 = tuple(num, num, num);
const maybeNum = nullable(num);
const maybeStr = nullable(str);

/** A value by reciprocal plane: the planes through the origin the data hold (those whose fixed axis reaches 0). */
const byRecipPlane = (shape: Shape): Shape => obj({ hk0: optional(shape), h0l: optional(shape), "0kl": optional(shape) });
/** A value by ΔPDF section through the origin. */
const byDpdfPlane = (shape: Shape): Shape => obj({ xy: optional(shape), xz: optional(shape), yz: optional(shape) });

/** api/types.ts Lattice: the cell, its angles absent from older ΔPDF files. */
const lattice = obj({
  a: maybeNum,
  b: maybeNum,
  c: maybeNum,
  alpha: optional(maybeNum),
  beta: optional(maybeNum),
  gamma: optional(maybeNum),
});

/** metrics/rings.ts RingResidual: one raw ring after the removal. */
const ringResidual = obj({ at: num, fwhm: num, residual_fraction: num, noise_fraction: num, significant: bool });

/** metrics/rings.ts RingMetrics: the ring removal on one cut. */
const ringMetrics = obj({
  before_ring_energy: maybeNum,
  after_ring_energy: maybeNum,
  ring_energy_ratio: maybeNum,
  over_subtraction_fraction: maybeNum,
  after_negative_fraction: maybeNum,
  ring_residuals: nullable(arr(ringResidual)),
  worst_ring_dent: nullable(ringResidual),
  worst_ring_left: nullable(ringResidual),
  suggested_display_vmax: maybeNum,
  n_finite: maybeNum,
});

/** metrics/punch.ts SuspiciousPeak: a sharp peak left on the punched cut. */
const suspiciousPeak = obj({
  xy: range,
  hkl: optional(v3),
  at_node: optional(bool),
  on_protected_plane: optional(bool),
  fwhm_voxels: range,
  broad: bool,
  intensity: num,
  local_background: num,
  contrast: num,
  sigma: num,
});

/** metrics/punch.ts LeftoverScan: the punched cut's leftover peaks; the node counts need the cut known. */
const leftoverScan = obj({
  suspicious_peaks: arr(suspiciousPeak),
  n_suspicious: num,
  n_at_nodes: optional(num),
  n_off_nodes: optional(num),
  n_on_protected: optional(num),
  n_broad_off_nodes: optional(num),
  n_skipped_noisy: num,
  scan_sigma_threshold: num,
});

/** metrics/backfill.ts BackfillMetrics. */
const backfillMetrics = obj({
  n_filled: maybeNum,
  fill_coverage: maybeNum,
  median_seam_sigma: maybeNum,
  p95_seam_sigma: maybeNum,
  bright_fill_fraction: maybeNum,
  checkerboard_fraction: maybeNum,
});

/** metrics/flatten.ts FlattenMetrics. */
const flattenMetrics = obj({
  removed_fraction: maybeNum,
  floor_before: nullable(v3),
  floor_after: nullable(v3),
  after_floor_max_sigma: maybeNum,
  after_negative_fraction: maybeNum,
  floor_trend: maybeNum,
  floor_span_fraction: maybeNum,
  floor_judged_q: nullable(range),
});

/** metrics/dpdf.ts DpdfMetrics on a section, without the volume-wide back-FFT fields (measureDpdf drops them). */
const dpdfSection = obj({
  origin_excluded_radius: num,
  background_sigma: maybeNum,
  feature_snr: maybeNum,
  strong_feature_fraction: maybeNum,
  positive_fraction: maybeNum,
  anisotropy_ratio: maybeNum,
  anisotropy_angle_deg: maybeNum,
  radial_trend: tuple(maybeNum, maybeNum, maybeNum),
});

// ---------------------------------------------------------------- assess_stage's stages

// Every stage's result opens with its verdict, by the stage's rule; one stage
// asked alone adds its goal and per-plane detail (assess_stage leaves both out
// of stage=all). A stage whose output does not exist yet is `missing`.
const judgedStage = obj({ verdict: maybeStr, criterion: optional(str), headline: str, goal: optional(str) });
const stage = (evaluation: Shape): Shape => union(obj({ missing: str }), merged(judgedStage, evaluation));

/** A ring's residual on one plane, without its width, marked ring once the 3D test judged it. */
const planeResidual = obj({ at: num, residual_fraction: num, noise_fraction: num, significant: bool, ring: optional(bool) });
const worstRing = nullable(obj({ plane: str, at: num, residual_fraction: num }));

const ringsEvaluation = obj({
  notice: optional(str),
  mean_ring_energy_ratio: maybeNum,
  max_over_subtraction_fraction: maybeNum,
  max_ring_dent: maybeNum,
  max_ring_left: maybeNum,
  worst_ring_dent: worstRing,
  worst_ring_left: worstRing,
  // The rule the 3D test judged by; "not judged: …" where it could not run (findings: two types on two paths).
  ring_rule: union(obj({ direction_share: maybeNum, height_share: maybeNum }), str),
  shells_judged: optional(arr(obj({ at: num, ring: bool, isotropy: optional(num), not_judged: optional(str) }))),
  per_plane: optional(
    byRecipPlane(
      obj({
        ring_energy_ratio: maybeNum,
        after_ring_energy: maybeNum,
        over_subtraction_fraction: maybeNum,
        after_negative_fraction: maybeNum,
        worst_ring_dent: nullable(planeResidual),
        worst_ring_left: nullable(planeResidual),
        ring_residuals: nullable(arr(planeResidual)),
      }),
    ),
  ),
});

const punchEvaluation = obj({
  sigma_note: optional(str),
  total_leftover_peaks: num,
  leftover_at_nodes: num,
  leftover_off_lattice: num,
  leftover_on_protected_planes: num,
  leftover_on_protected_planes_sharp: num,
  leftover_off_lattice_broad: num,
  leftover_off_lattice_sharp: num,
  strongest_leftover: nullable(merged(obj({ plane: str }), suspiciousPeak)),
  noisy_spikes_skipped: num,
  mean_punched_fraction: maybeNum,
  fitted_peaks: maybeNum,
  per_plane: optional(
    byRecipPlane(
      obj({
        leftover_peaks: maybeNum,
        at_nodes: maybeNum,
        off_lattice: maybeNum,
        on_protected_planes: maybeNum,
        off_lattice_broad: maybeNum,
        strongest_leftover: nullable(suspiciousPeak),
        punched_fraction: maybeNum,
      }),
    ),
  ),
});

const backfillEvaluation = obj({
  mean_median_seam_sigma: maybeNum,
  max_bright_fill_fraction: maybeNum,
  per_plane: optional(byRecipPlane(nullable(backfillMetrics))),
});

const flattenEvaluation = obj({
  max_after_floor_sigma: maybeNum,
  max_floor_trend: maybeNum,
  max_floor_span_fraction: maybeNum,
  pedestal_left: nullable(bool),
  per_plane: optional(byRecipPlane(nullable(flattenMetrics))),
});

const pdfEvaluation = obj({
  back_fft_pearson_r: maybeNum,
  back_fft_normalized_rms: maybeNum,
  back_fft_pearson_r_even: maybeNum,
  back_fft_odd_share: maybeNum,
  back_fft_per_plane_r: nullable(rec(maybeNum)),
  mean_feature_snr: maybeNum,
  window_weight_on_unmeasured: maybeNum,
  window_shape: maybeStr,
  max_symmetry_break: maybeNum,
  worst_symmetry_op: maybeStr,
  symmetry_declared: nullable(bool),
  per_plane: optional(
    byDpdfPlane(nullable(obj({ feature_snr: maybeNum, strong_feature_fraction: maybeNum, positive_fraction: maybeNum, anisotropy_ratio: maybeNum }))),
  ),
});

// ---------------------------------------------------------------- the rest

/** dpdf_contrast's figures for one limit. */
const contrastLimit = { limit: num, limit_sigma: maybeNum, share_of_strongest: num, coloured_fraction: num };

/** A setting's value as the Configure page and the tuning name it. */
const settingValue = union(str, num, bool);

/** texture_check's measures on one cut (metrics/texture.ts TextureMetrics). */
const textureCut = obj({
  cut: str,
  n_holes: num,
  not_judged: optional(str),
  median_fill_bias_sigma: maybeNum,
  median_fill_bias_level: maybeNum,
  above_fraction: maybeNum,
  below_fraction: maybeNum,
  systematic_fill_bias: nullable(bool),
  azimuthal_variation_before: maybeNum,
  azimuthal_variation_after: maybeNum,
  azimuthal_ratio: maybeNum,
});

/** The back-FFT check as the run saved it (consistency_details passes its fields through). */
const consistencyMetrics = obj({
  pearson_r: maybeNum,
  normalized_rms: maybeNum,
  rms: num,
  n_voxels: num,
  per_plane_r: rec(maybeNum),
  q_band: nullable(range),
  crop_hkl: nullable(arr(num)),
  apodization: str,
  pearson_r_even: optional(maybeNum),
  normalized_rms_even: optional(maybeNum),
  odd_share: optional(maybeNum),
  n_voxels_even: optional(num),
});

/** The tools' result contracts, by tool name: every tool of the registry but those in TEXT_RESULTS. */
export const RESULT_CONTRACTS: Readonly<Record<string, Shape>> = {
  describe_dataset: obj({
    dataset: str,
    id: str,
    stages: arr(str),
    reciprocal: nullable(obj({ grid: v3, H: range, K: range, L: range, planes: arr(str) })),
    cell: nullable(lattice),
    sigma: nullable(oneOf("measured", "estimated")),
    sigma_note: optional(str),
    delta_pdf: nullable(obj({ grid: v3, x: range, y: range, z: range, q_max: maybeNum, planes: arr(str) })),
    other_datasets: arr(obj({ id: str, label: str })),
  }),

  current_view: obj({
    page: str,
    dataset: str,
    reciprocal_cut: nullable(obj({ plane: str, value: num, label: str })),
    dpdf_cuts_A: nullable(obj({ x: num, y: num, z: num })),
  }),

  measure_reciprocal_cut: obj({
    cut: str,
    ring_removal: nullable(ringMetrics),
    bragg_punch_leftover: nullable(leftoverScan),
    backfill: nullable(backfillMetrics),
    flatten: nullable(flattenMetrics),
    notes: arr(str),
  }),

  measure_dpdf_cut: obj({ cut: str, delta_pdf: dpdfSection }),

  assess_stage: obj({
    rings: optional(stage(ringsEvaluation)),
    punch: optional(stage(punchEvaluation)),
    backfill: optional(stage(backfillEvaluation)),
    flatten: optional(stage(flattenEvaluation)),
    pdf: optional(stage(pdfEvaluation)),
    measured_on: optional(arr(str)),
  }),

  // A cut whose slices could not be read is its label alone (findings).
  texture_check: obj({ per_cut: arr(union(textureCut, obj({ cut: str }))) }),

  qmax_coverage: obj({
    verdict: str,
    window_weight_on_unmeasured: maybeNum,
    window_shape: maybeStr,
    window_scale: maybeNum,
    transform_reach_q: maybeNum,
    reach_from: str,
    full_coverage_q: maybeNum,
    box_face_q: maybeNum,
    box_corner_q: maybeNum,
    low_q_gap: maybeNum,
    // These three only when the raw volume's coverage was read (findings).
    raw_counts: optional(obj({ q_min_edge: maybeNum, q_max_edge: maybeNum, fully_measured: nullable(range), box_face_q: num })),
    suggested_band: optional(nullable(range)),
    counts_end_inside_box: bool,
    band_check: optional(str),
    q_unit: str,
    settings: obj({ pdfQMin: str, pdfQMax: str, pdfApod: str, pdfWindowShape: str, pdfWindowSupport: bool }),
    per_plane: byRecipPlane(
      nullable(obj({ full_coverage_q: maybeNum, half_coverage_q: maybeNum, box_q: maybeNum, shells: arr(obj({ q: num, measured: num })) })),
    ),
  }),

  // A cell neither hexagonal nor orthogonal, or a section off the origin, is a note alone (findings).
  symmetry_check: union(
    obj({ note: str }),
    obj({
      section: str,
      cell: oneOf("hexagonal", "orthogonal"),
      ops: arr(obj({ op: str, rms_difference: num, pairs: num })),
      holds: arr(str),
      symmetry_declared: nullable(bool),
      verdict: maybeStr,
    }),
  ),

  // reset: what the viewer went back to, as text; else the limit applied, as figures (findings).
  dpdf_contrast: union(
    obj({ applied: str }),
    obj({
      applied: obj({ ...contrastLimit, from: str }),
      note: optional(str),
      robust_sigma: num,
      strongest_feature_sigma: maybeNum,
      not_applied: obj({
        "99.5th percentile": obj({ ...contrastLimit, effect: str }),
        "99.97th percentile": obj({ ...contrastLimit, effect: str }),
      }),
      sections: str,
    }),
  ),

  dpdf_peaks: obj({
    features: arr(
      obj({
        sign: oneOf("+", "−"),
        length_A: num,
        size_sigma: num,
        n_vectors: num,
        vectors_rlu: arr(nullable(v3)),
        vectors_A: arr(nullable(v3)),
      }),
    ),
    robust_sigma: maybeNum,
    threshold_sigma: num,
    origin_disk_A: num,
    extrema_above_threshold: num,
    reading: str,
  }),

  grain_check: obj({
    off_lattice_orbits: num,
    judged: num,
    near_bragg_nodes: num,
    near_offset_angle_deg: nullable(obj({ median: num, quartiles: range })),
    far: arr(obj({ hkl: v3, q: num, offset_q: num })),
    rotated_copy: nullable(obj({ indexed: num, misorientation_deg: maybeNum })),
    random_control: num,
    verdict: str,
    off_lattice_peaks: num,
    declared_symmetry: maybeStr,
    punch_cell: v3,
  }),

  ub_check: obj({
    fit: oneOf("orientation", "lattice", "both", "symmetric"),
    bragg_nodes_every: v3,
    symmetry_from: maybeStr,
    symmetrised: nullable(bool),
    symmetry_break: maybeNum,
    peaks: obj({ searched: num, used: num, rejected: num }),
    rms_start: num,
    rms: num,
    cell_start: str,
    cell: str,
    orientation_change_deg: num,
    axis_uvw: v3,
    transform_diagonal: v3,
    passes: arr(obj({ q_max: num, found: num, used: num, rms: str })),
    radial: arr(obj({ q: str, direction: str, n: num, before: num, after: num })),
    unexplained: bool,
    mean_offset_rlu: nullable(obj({ before: arr(maybeNum), after: arr(maybeNum), standard_error: arr(maybeNum) })),
    origin_shift_rlu: nullable(v3),
    reading: str,
  }),

  radial_profile: obj({
    cut: str,
    q_unit: str,
    stat: str,
    // A shell's median in each stage compared (the stages that exist, or those asked for).
    rows: arr(
      obj({
        q: num,
        raw: optional(maybeNum),
        ringremoved: optional(maybeNum),
        braggpunched: optional(maybeNum),
        backfilled: optional(maybeNum),
        flattened: optional(maybeNum),
      }),
    ),
  }),

  line_profile: obj({
    stage: str,
    along: oneOf("H", "K", "L", "x", "y", "z"),
    // The other two axes' coordinates the line passes through.
    through: obj({ H: optional(num), K: optional(num), L: optional(num), x: optional(num), y: optional(num), z: optional(num) }),
    units: oneOf("Å", "r.l.u."),
    points: arr(tuple(num, maybeNum)),
    max: nullable(obj({ at: num, value: num })),
    min: nullable(obj({ at: num, value: num })),
    median: maybeNum,
    masked_fraction: num,
  }),

  // Without a fitted profile, has_profile false alone (findings).
  bragg_peaks: union(
    obj({ has_profile: lit(false) }),
    obj({
      n_peaks: num,
      punch_frame: maybeStr,
      sorted_by: str,
      peaks: arr(
        obj({
          hkl: v3,
          q: maybeNum,
          intensity: maybeNum,
          local_background: maybeNum,
          significance: maybeNum,
          measured_width_q: nullable(v3),
          resolution_limited: nullable(tuple(bool, bool, bool)),
          anisotropy: maybeNum,
          fit: str,
        }),
      ),
    }),
  ),

  // Without a saved check, has_check false alone (findings).
  consistency_details: union(obj({ has_check: lit(false) }), consistencyMetrics),

  run_log: obj({ ended: str, lines: arr(obj({ stage: maybeStr, status: maybeStr, message: str })) }),

  // A dataset the cut could not be measured on is its label and the error (findings).
  compare_datasets: obj({
    cut: str,
    rows: arr(
      union(
        obj({
          dataset: str,
          ring_energy_ratio: maybeNum,
          over_subtraction_fraction: maybeNum,
          leftover_peaks: maybeNum,
          backfill_median_seam_sigma: maybeNum,
          flatten_floor_after: nullable(v3),
          flatten_floor_max_sigma: maybeNum,
        }),
        obj({
          dataset: str,
          feature_snr: maybeNum,
          strong_feature_fraction: maybeNum,
          positive_fraction: maybeNum,
          anisotropy_ratio: maybeNum,
          anisotropy_angle_deg: maybeNum,
          radial_trend: tuple(maybeNum, maybeNum, maybeNum),
          back_fft_r: maybeNum,
        }),
        obj({ dataset: str, error: str }),
      ),
    ),
  }),

  // The Configure page's settings by name: a blank one reads "(default)".
  configure_settings: obj({ settings: rec(union(str, bool)) }),

  update_settings: obj({
    changed: arr(obj({ setting: str, from: settingValue, to: settingValue, note: optional(str) })),
    already_set: optional(arr(str)),
    // A fact about the sample the user's latest message does not name (findings).
    refused: optional(arr(obj({ setting: str, why: str }))),
    rerun_from: maybeStr,
  }),

  run_pipeline: obj({
    ended: str,
    seconds: num,
    stages: rec(oneOf("computed", "reused")),
    outputs: arr(str),
    log_tail: arr(str),
  }),

  tune_pipeline: obj({
    minutes: num,
    stages: arr(
      obj({
        stage: str,
        status: str,
        tuned: bool,
        // The chosen trial, when there is one.
        chosen_trial: optional(num),
        of: optional(num),
        changes: optional(rec(settingValue)),
        result: optional(str),
        // Every trial, on a tuned stage with more than one: its numbers, or why it has none.
        trials: optional(
          arr(
            union(
              obj({ n: num, changes: rec(settingValue), result: str, no_effect: optional(lit(true)) }),
              obj({ n: num, changes: rec(settingValue), status: str, error: optional(str) }),
            ),
          ),
        ),
        why: optional(str),
        message: optional(str),
      }),
    ),
    note: maybeStr,
    // When a stage's settings changed: the run that writes the dataset's outputs with them.
    write_outputs_with: optional(obj({ tool: lit("run_pipeline"), from_stage: str })),
  }),

  show_in_viewer: obj({ opened: str }),
};

/** The tools whose result is text, not an object: no contract. */
export const TEXT_RESULTS: ReadonlySet<string> = new Set(["read_skill"]);

/**
 * Where a tool's result disagrees with its contract (disagreements), the
 * result as JSON reads it. A tool with no contract, and not a text tool, is
 * one disagreement: give it a contract.
 */
export function contractDisagreements(tool: string, result: unknown): string[] {
  if (TEXT_RESULTS.has(tool)) return typeof result === "string" ? [] : [`${tool}: expected text, got ${typeOf(result)}`];
  const contract = RESULT_CONTRACTS[tool];
  if (!contract) return [`${tool}: no contract (tools/contracts.ts)`];
  return disagreements(contract, result, tool);
}
