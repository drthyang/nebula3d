// Pipeline configuration + execution state (zustand).
//
// This store owns *both* the configuration form values and the running job so
// they survive navigation between the Configure and Execution pages — the pages
// mount/unmount, the store does not.  The SSE EventSource is held at module
// scope (not in a React effect) for the same reason: switching pages must not
// tear down the live progress stream.

import { create } from "zustand";

import { cancelJob, runPipeline } from "../api/client";
import { cancelPipeline, engine, PYODIDE_MODE } from "../api/pyodideEngine";
import { queryClient } from "../api/queryClient";
import type { JobEvent, StageParamsIn, TuningTrial } from "../api/types";
import { useDatasetStore } from "./datasetStore";

// Mirrors nebula3d.pipeline.STAGES (incl. the 6th back-FFT consistency check) so the
// Execution stepper and log show every stage the backend streams progress for.
export const STAGES = [
  "rings", "punch", "backfill", "flatten", "pdf", "pdf_check",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  rings: "Ring removal",
  punch: "Bragg punch",
  backfill: "Backfill",
  flatten: "Flatten",
  pdf: "3D-ΔPDF",
  pdf_check: "Consistency check",
};

// step number (1-based) of each stage, to tie config groups to the stepper
export const STAGE_NO: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s, i + 1]),
);

export type PunchPlane = "hk" | "hl" | "kl";

// All editable configuration form values.  Strings mirror the raw <input>
// values (empty = "use the backend default"); the run action converts them.
export interface PipelineConfig {
  // per-stage enable toggles; a disabled stage is skipped and its input passes
  // straight through to the next enabled stage (stage 4 = `flatten`).
  ringsEnabled: boolean;
  punchEnabled: boolean;
  backfillEnabled: boolean;
  flatten: boolean;
  pdfEnabled: boolean;
  force: boolean;
  ringModel: string; // "pooled" | "global_v2" | "patched" | "parametric"
  ringRadialMode: string; // parametric: "rolling" | "peaks"
  ringNPatches: string;
  ringNFourier: string;
  ringSliceAxis: string;
  ringWidth: string; // parametric: ring width / rolling window (Å⁻¹)
  ringGlobalMaterial: string; // "auto" | "aluminum" | "generic"
  ringGlobalSubtraction: string; // "conservative" | "mean" | "diagnose_only"
  ringGlobalConfidence: string;
  ringGlobalLmax: string;
  ringGlobalMinSnr: string;
  ringPooledSectors: string; // pooled: azimuthal sectors
  ringPooledWindow: string; // pooled: stack-pooling half-width (deg)
  // Significance (standard errors) a peak must reach; blank = backend default (5).
  punchMinSig: string;
  punchFootprint: string; // "" = own width (the backend default) | "profile" | "ellipsoid"
  punchProfileNSigma: string; // profile footprint: punch out to where the profile falls to this × the noise
  punchMode: string;
  // Supercell the volume is indexed on (per axis); blank = 1.  Integer-mode
  // Bragg nodes are the parent lattice's only.
  punchSupercellH: string;
  punchSupercellK: string;
  punchSupercellL: string;
  // Integer-punch H guard (r.l.u.); blank = backend default (0.12), 0 = off.
  punchHGuard: string;
  // The off-lattice search: its floor (× the diffuse scatter), and the H planes
  // it leaves alone ("1/3, 2/3", "none"; blank = the backend default).
  punchSearchFloor: string;
  punchProtectH: string;
  punchProtectHalfWidth: string;
  punchSearchMaxWidth: string; // search: leave candidates broader than this × the Bragg width
  // Punch ellipsoid frame: "spherical" (rρ,rθ,rφ, default) | "q" (a*,b*,c*)
  punchFrame: string;
  // Spherical-frame radii (Å⁻¹): rρ radial, rθ polar, rφ azimuth; blank = default
  punchRho: string;
  punchTheta: string;
  punchPhi: string;
  // Q-space resolution floor along a*, b*, c* (Å⁻¹); blank = backend default
  punchQA: string;
  punchQB: string;
  punchQC: string;
  punchFitUnconstrained: boolean; // do not floor/cap Bragg covariance-fit radii
  punchMargin: string;
  incidentBeamQA: string;
  incidentBeamQB: string;
  incidentBeamQC: string;
  incidentBeamMargin: string;
  incidentBeamFitCovariance: boolean; // fit a tilted ellipsoid to the direct beam
  punchSliceZoom: number;
  punchSliceContrast: number;
  punchCutH: number;
  punchCutK: number;
  punchCutL: number;
  backfillMethod: string;
  flattenEstimator: string;
  flattenIon: string;
  flattenQ2: boolean; // model: also fit b·Q² (an inelastic background rising with |Q|)
  flattenFitQMax: string; // model: end of the fit's |Q| range (Å⁻¹; blank = 10)
  pdfApod: string;
  pdfWindowShape: string;
  pdfWindowSupport: boolean; // taper the ΔPDF window to the measured coverage
  pdfQMin: string;
  pdfQMax: string;
}

interface PipelineState extends PipelineConfig {
  // job execution
  jobId: string | null;
  running: boolean;
  events: JobEvent[];
  // Client arrival time of each event, index-aligned with `events`. Lives in the
  // store (not component state) so the elapsed timer and log wall-clock times
  // survive navigating away from the Execution page mid-run.
  times: number[];
  terminal: string | null;
  // actions
  patch: (p: Partial<PipelineConfig>) => void;
  run: () => Promise<void>;
  // Recompute just `stages` with the current settings and resolve with how the
  // job ended: "done" | "error" | "cancelled".  With `tuning`, the run is one
  // trial of the assistant's tuning run: its outputs go to the trial's own
  // folder and processed/ is only read.  `datasetId` defaults to the
  // sidebar's selection; `force: false` reuses outputs that already exist.
  runStages: (stages: string[], opts?: RunOptions) => Promise<string>;
  cancel: () => Promise<void>;
}

// Live progress stream — module scope so it is independent of any component's
// lifecycle.  Closed on terminal events / errors and replaced on each run.
let es: EventSource | null = null;

function closeStream() {
  es?.close();
  es = null;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  ringsEnabled: true,
  punchEnabled: true,
  backfillEnabled: true,
  flatten: true,
  pdfEnabled: true,
  force: false,
  ringModel: "pooled",
  ringRadialMode: "rolling",
  ringNPatches: "",
  ringNFourier: "8",
  ringSliceAxis: "H",
  ringWidth: "",
  ringGlobalMaterial: "auto",
  ringGlobalSubtraction: "conservative",
  ringGlobalConfidence: "1",
  ringGlobalLmax: "4",
  ringGlobalMinSnr: "5",
  ringPooledSectors: "",
  ringPooledWindow: "",
  punchMinSig: "",
  punchFootprint: "",
  punchProfileNSigma: "",
  punchMode: "",
  punchSupercellH: "",
  punchSupercellK: "",
  punchSupercellL: "",
  punchHGuard: "",
  punchSearchFloor: "",
  punchProtectH: "",
  punchProtectHalfWidth: "",
  punchSearchMaxWidth: "",
  punchFrame: "spherical",
  punchRho: "",
  punchTheta: "",
  punchPhi: "",
  punchQA: "",
  punchQB: "",
  punchQC: "",
  punchFitUnconstrained: false,
  punchMargin: "",
  incidentBeamQA: "",
  incidentBeamQB: "",
  incidentBeamQC: "",
  incidentBeamMargin: "",
  incidentBeamFitCovariance: false,
  punchSliceZoom: 1,
  punchSliceContrast: 1.35,
  punchCutH: 0,
  punchCutK: 0,
  punchCutL: 0,
  backfillMethod: "",
  flattenEstimator: "",
  flattenIon: "",
  flattenQ2: false,
  flattenFitQMax: "",
  pdfApod: "",
  pdfWindowShape: "",
  pdfWindowSupport: true,
  pdfQMin: "",
  pdfQMax: "",

  jobId: null,
  running: false,
  events: [],
  times: [],
  terminal: null,

  patch: (p) => set(p),

  run: () => {
    const s = get();
    return start(enabledStages(s), s.force, set, get);
  },

  runStages: async (stages, opts) => {
    await start(stages, opts?.force ?? true, set, get, opts);
    // The native job reports its end over SSE, after start() returns.
    if (get().running) {
      await new Promise<void>((resolve) => {
        const unsub = usePipelineStore.subscribe((st) => {
          if (!st.running) {
            unsub();
            resolve();
          }
        });
      });
    }
    await queryClient.invalidateQueries();
    return get().terminal ?? "error";
  },

  cancel: async () => {
    if (PYODIDE_MODE) {
      cancelPipeline();
      set({ terminal: "cancelled", running: false });
      return;
    }
    const { jobId } = get();
    if (jobId) await cancelJob(jobId).catch(() => undefined);
  },
}));

type Setter = (p: Partial<PipelineState>) => void;
type Getter = () => PipelineState;

// Launch `stages` with the current form settings; native runs stream their
// progress (and their end) over SSE after this returns.
export interface RunOptions {
  tuning?: TuningTrial;
  datasetId?: string;
  force?: boolean; // runStages: recompute outputs that exist (default true)
}

async function start(
  stages: string[],
  force: boolean,
  set: Setter,
  get: Getter,
  opts: RunOptions = {},
): Promise<void> {
  const s = get();
  const datasetId = opts.datasetId ?? useDatasetStore.getState().datasetId ?? "";
  closeStream();
  set({ events: [], times: [], terminal: null, running: true, jobId: null });

  const params = formToParams(s);

  if (PYODIDE_MODE) {
    await runInBrowser(datasetId, params, s.flatten, force, stages, set, get, opts.tuning);
    return;
  }

  try {
    const job = await runPipeline({
      dataset_id: datasetId,
      flatten_enabled: s.flatten,
      force,
      stages,
      params,
      tuning: opts.tuning,
    });
    set({ jobId: job.id });

    es = new EventSource(`/api/pipeline/jobs/${job.id}/events`);
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as JobEvent;
      if (["done", "error", "cancelled"].includes(ev.type)) {
        set({ terminal: ev.type, running: false });
        closeStream();
      } else {
        set({ events: [...get().events, ev], times: [...get().times, Date.now()] });
      }
    };
    es.onerror = () => {
      closeStream();
      set({ running: false });
    };
  } catch (e) {
    set({
      terminal: "error",
      running: false,
      events: [
        { type: "progress", status: "error", message: (e as Error).message },
      ],
      times: [Date.now()],
    });
  }
}

// The subset of STAGES to run, from the per-stage enable toggles.  A disabled
// stage is omitted; the backend passes its input straight through to the next
// enabled stage.  The consistency check rides along with the ΔPDF transform.
export function enabledStages(s: PipelineConfig): string[] {
  return [
    s.ringsEnabled && "rings",
    s.punchEnabled && "punch",
    s.backfillEnabled && "backfill",
    s.flatten && "flatten",
    s.pdfEnabled && "pdf",
    s.pdfEnabled && "pdf_check",
  ].filter((x): x is string => Boolean(x));
}

// Convert the editable form values into the curated StageParamsIn the pipeline
// accepts (empty fields stay unset → the backend/bridge default is used).
function formToParams(s: PipelineConfig): StageParamsIn {
  const params: StageParamsIn = {};
  if (s.ringModel) params.rings_model = s.ringModel;
  if (s.ringNPatches) params.rings_n_patches = Number(s.ringNPatches);
  if (s.ringNFourier) params.rings_n_fourier = Number(s.ringNFourier);
  if (s.ringSliceAxis) params.rings_slice_axis = s.ringSliceAxis;
  if (s.ringModel === "parametric") {
    params.rings_radial_mode = s.ringRadialMode;
    if (s.ringWidth) params.rings_ring_width = Number(s.ringWidth);
  }
  if (s.ringModel === "global_v2") {
    if (s.ringWidth) params.rings_ring_width = Number(s.ringWidth);
    params.rings_global_material = s.ringGlobalMaterial;
    params.rings_global_subtraction = s.ringGlobalSubtraction;
    if (s.ringGlobalConfidence) {
      params.rings_global_confidence_z = Number(s.ringGlobalConfidence);
    }
    if (s.ringGlobalLmax) params.rings_global_angular_lmax = Number(s.ringGlobalLmax);
    if (s.ringGlobalMinSnr) params.rings_global_min_snr = Number(s.ringGlobalMinSnr);
  }
  if (s.ringModel === "pooled") {
    if (s.ringPooledSectors) params.rings_pooled_sectors = Number(s.ringPooledSectors);
    if (s.ringPooledWindow) params.rings_pooled_window_deg = Number(s.ringPooledWindow);
  }
  if (s.punchMinSig) params.punch_min_significance = Number(s.punchMinSig);
  if (s.punchMode) params.punch_mode = s.punchMode;
  if (s.punchSupercellH) params.punch_supercell_h = Number(s.punchSupercellH);
  if (s.punchSupercellK) params.punch_supercell_k = Number(s.punchSupercellK);
  if (s.punchSupercellL) params.punch_supercell_l = Number(s.punchSupercellL);
  if (s.punchHGuard) params.punch_h_guard = Number(s.punchHGuard);
  if (s.punchSearchFloor) params.punch_search_floor = Number(s.punchSearchFloor);
  const protect = parseFractions(s.punchProtectH);
  if (protect) params.punch_search_protect_h = protect;
  if (s.punchProtectHalfWidth) params.punch_search_protect_half_width = Number(s.punchProtectHalfWidth);
  if (s.punchSearchMaxWidth) params.punch_search_max_width_ratio = Number(s.punchSearchMaxWidth);
  if (s.punchFootprint) params.punch_footprint = s.punchFootprint;
  if (s.punchProfileNSigma) params.punch_profile_n_sigma = Number(s.punchProfileNSigma);
  if (s.punchMargin) params.punch_margin = Number(s.punchMargin);
  // Punch frame: spherical (rρ,rθ,rφ) by default, or the legacy a*/b*/c* q-frame.
  const frame = s.punchFrame === "q" ? "q" : "spherical";
  params.punch_frame = frame;
  if (frame === "spherical") {
    if (s.punchRho) params.punch_spherical_radius_rho = Number(s.punchRho);
    if (s.punchTheta) params.punch_spherical_radius_theta = Number(s.punchTheta);
    if (s.punchPhi) params.punch_spherical_radius_phi = Number(s.punchPhi);
  } else {
    if (s.punchQA) params.punch_q_radius_a = Number(s.punchQA);
    if (s.punchQB) params.punch_q_radius_b = Number(s.punchQB);
    if (s.punchQC) params.punch_q_radius_c = Number(s.punchQC);
  }
  if (s.incidentBeamQA) params.incident_beam_q_radius_a = Number(s.incidentBeamQA);
  if (s.incidentBeamQB) params.incident_beam_q_radius_b = Number(s.incidentBeamQB);
  if (s.incidentBeamQC) params.incident_beam_q_radius_c = Number(s.incidentBeamQC);
  if (s.incidentBeamMargin) params.incident_beam_q_margin = Number(s.incidentBeamMargin);
  if (s.punchFitUnconstrained) params.punch_fit_unconstrained = true;
  if (s.incidentBeamFitCovariance) params.incident_beam_fit_covariance = true;
  if (s.backfillMethod) params.backfill_method = s.backfillMethod;
  if (s.flattenEstimator) params.flatten_estimator = s.flattenEstimator;
  if (s.flattenIon) params.flatten_ion = s.flattenIon;
  if (s.flattenQ2) params.flatten_q2 = true;
  if (s.flattenFitQMax) params.flatten_fit_q_max = Number(s.flattenFitQMax);
  if (s.pdfApod) params.pdf_apodization = s.pdfApod;
  if (s.pdfWindowShape) params.pdf_window_shape = s.pdfWindowShape;
  if (s.pdfWindowSupport === false) params.pdf_window_support = false;
  if (s.pdfQMin || s.pdfQMax) {
    params.pdf_q_min = s.pdfQMin ? Number(s.pdfQMin) : 0;
    if (s.pdfQMax) params.pdf_q_max = Number(s.pdfQMax);
  }
  return params;
}

// H fractions as typed: "1/3, 2/3" → [0.3333, 0.6667], "none" → [] (protect
// nothing), blank → undefined (the backend default).  Each is taken mod 1.
export function parseFractions(text: string): number[] | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (t === "none" || t === "off") return [];
  const values = t
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((part) => {
      const [a, b] = part.split("/");
      return b === undefined ? Number(a) : Number(a) / Number(b);
    });
  if (!values.every(Number.isFinite)) return undefined;
  return values.map((v) => Math.round((((v % 1) + 1) % 1) * 1e4) / 1e4);
}

// Drive the pipeline locally via Pyodide (Worker).  Boot progress appears in
// the Configure page's dedicated boot panel; stage progress streams into the
// Execution log.  The Worker is never blocked from the main thread's view, so
// the UI repaints freely throughout.
async function runInBrowser(
  datasetId: string,
  params: StageParamsIn,
  flatten: boolean,
  force: boolean,
  stages: string[],
  set: Setter,
  get: Getter,
  tuning?: TuningTrial,
): Promise<void> {
  const log = (ev: JobEvent) =>
    set({ events: [...get().events, ev], times: [...get().times, Date.now()] });
  try {
    await engine.runPipeline({
      datasetId,
      paramsJson: JSON.stringify(params),
      flattenEnabled: flatten,
      force,
      stages,
      tuning,
      onProgress: (ev) =>
        log({
          type: "progress",
          stage: ev.stage,
          status: ev.status,
          fraction: ev.fraction ?? null,
          message: ev.message,
        }),
    });
    await queryClient.invalidateQueries();
    set({ terminal: "done", running: false });
  } catch (e) {
    log({ type: "progress", status: "error", message: (e as Error).message });
    set({ terminal: "error", running: false });
  }
}
