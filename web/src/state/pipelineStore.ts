// Pipeline configuration + execution state (zustand).
//
// This store owns *both* the configuration form values and the running job so
// they survive navigation between the Configure and Execution pages — the pages
// mount/unmount, the store does not.  The SSE EventSource is held at module
// scope (not in a React effect) for the same reason: switching pages must not
// tear down the live progress stream.

import { create } from "zustand";

import { cancelJob, fetchJob, runPipeline } from "../api/client";
import { cancelPipeline, engine, PYODIDE_MODE } from "../api/pyodideEngine";
import { queryClient } from "../api/queryClient";
import type { JobEvent, JobOut, StageParamsIn, TuningTrial } from "../api/types";
import { useDatasetStore } from "./datasetStore";
import { modulationRequest } from "./modulation";

// Mirrors nebula3d.pipeline.STAGES (incl. the 6th back-FFT consistency check) so the
// Execution stepper and log show every stage the backend streams progress for.
// The symmetry average is stage 0: optional, and off by default.
export const STAGES = [
  "symmetry_average", "rings", "punch", "backfill", "flatten", "pdf", "pdf_check",
] as const;

export const STAGE_LABELS: Record<string, string> = {
  symmetry_average: "Symmetry average",
  rings: "Ring removal",
  punch: "Bragg punch",
  backfill: "Backfill",
  flatten: "Background correction",
  pdf: "3D-ΔPDF",
  pdf_check: "Consistency check",
};

// The number of each stage, to tie config groups to the stepper: the symmetry
// average is stage 0, the ring removal stage 1.
export const STAGE_NO: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s, i]),
);

export type PunchPlane = "hk" | "hl" | "kl";

// All editable configuration form values.  Strings mirror the raw <input>
// values (empty = "use the backend default"); the run action converts them.
export interface PipelineConfig {
  // Per-stage "Enable stage" switches (stage 4's is `flatten`). The run sends
  // them as the stages' switches (formToParams, and flatten_enabled): a stage
  // switched off is not run, and the next stage reads what came before it.
  // Stage 0, the symmetry average, is off by default.
  symmetryAverageEnabled: boolean;
  ringsEnabled: boolean;
  punchEnabled: boolean;
  backfillEnabled: boolean;
  flatten: boolean;
  pdfEnabled: boolean;
  force: boolean;
  // The symmetry average's Laue class, the sample's to declare (state/laue.ts):
  // a preset name ("6/mmm") or generators ("h+k,-h,l; -h,-k,-l"); blank = none
  // chosen. Whether an input that declares a symmetry is averaged again; and
  // whether the run proceeds when the operations change the cell's metric by
  // more than 2 % ("Proceed despite the metric change": refused otherwise).
  symmetryLaue: string;
  symmetryReaverage: boolean;
  symmetryAllowMetricChange: boolean;
  // Voxel layers taken off the raw input's coverage edge at load, whether or
  // not the symmetry average is on (the NeXus Viewer's "Edge erosion r",
  // the same rule): "0" to "3"; blank = the backend default, 1.
  edgeTrim: string;
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
  // The off-lattice search's floor (× the diffuse scatter).
  punchSearchFloor: string;
  // The sample's modulation, a fact about the sample, which the search leaves
  // alone (state/modulation.ts): its k vectors ("1/3, 0, 0", several separated
  // by ;, "none" declares none; blank = the backend's default, also none),
  // order (blank = 1), form ("points", the blank default, or "planes") and
  // half width (r.l.u.; blank = 0.08). Without k the other three are unused.
  modulationK: string;
  modulationOrder: string;
  modulationForm: string;
  modulationHalfWidth: string;
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
  // The Configure preview's cut along each axis (r.l.u.): steers the preview
  // only, never the run, and configure_settings leaves it out.
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

// What the last run was asked to do, kept beside its log: which dataset, which
// stages, the settings it ran with (as the pipeline took them) and whether it
// recomputed existing outputs. A saved session carries it (state/session.ts).
export interface RunRecord {
  datasetId: string;
  stages: string[];
  force: boolean;
  flattenEnabled: boolean;
  params: StageParamsIn;
  tuning?: TuningTrial;
}

interface PipelineState extends PipelineConfig {
  // job execution
  jobId: string | null;
  lastRun: RunRecord | null;
  running: boolean;
  events: JobEvent[];
  // Client arrival time of each event, index-aligned with `events`. Lives in the
  // store (not component state) so the elapsed timer and log wall-clock times
  // survive navigating away from the Execution page mid-run.
  times: number[];
  // How the run ended: "done" | "error" | "cancelled", or "lost" (the
  // connection to a native job was lost, its end is not known yet); null while it runs.
  terminal: string | null;
  // A native run's progress stream dropped and the page is reaching the job again.
  reconnecting: boolean;
  // actions
  patch: (p: Partial<PipelineConfig>) => void;
  run: () => Promise<void>;
  // Recompute just `stages` with the current settings and resolve with how the
  // job ended: "done" | "error" | "cancelled".  With `tuning`, the run is one
  // trial of the assistant's tuning run: its outputs go to the trial's own
  // folder and processed/ is only read.  `datasetId` defaults to the
  // sidebar's selection; `force: false` reuses outputs that already exist;
  // `params`/`flattenEnabled` replace the form's settings for this run.
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
  symmetryAverageEnabled: false,
  ringsEnabled: true,
  punchEnabled: true,
  backfillEnabled: true,
  flatten: true,
  pdfEnabled: true,
  force: false,
  symmetryLaue: "",
  symmetryReaverage: false,
  symmetryAllowMetricChange: false,
  edgeTrim: "",
  ringModel: "pooled",
  ringRadialMode: "rolling",
  ringNPatches: "",
  // The patched/parametric models' texture order (the pooled default has
  // none). The package's RingParams.n_fourier, which scripts and the
  // Python API run, is 6; the page keeps 8 on purpose (AGENT_PLAN
  // 4.12), and tests/test_defaults_agreed.py pins both.
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
  modulationK: "",
  modulationOrder: "",
  modulationForm: "",
  modulationHalfWidth: "",
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
  lastRun: null,
  running: false,
  events: [],
  times: [],
  terminal: null,
  reconnecting: false,

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
      // The worker held the outputs (in memory): they went with it.
      void queryClient.invalidateQueries();
      return;
    }
    const { jobId } = get();
    if (jobId) await cancelJob(jobId).catch(() => undefined);
  },
}));

type Setter = (p: Partial<PipelineState>) => void;
type Getter = () => PipelineState;

// Launch `stages` with the current form settings (or opts.params); native
// runs stream their progress (and their end) over SSE after this returns.
export interface RunOptions {
  tuning?: TuningTrial;
  datasetId?: string;
  force?: boolean; // runStages: recompute outputs that exist (default true)
  // Run with these settings instead of the form's: a restored session
  // recomputes its outputs with the settings of the run that made them.
  params?: StageParamsIn;
  flattenEnabled?: boolean;
}

async function start(
  stages: string[],
  force: boolean,
  set: Setter,
  get: Getter,
  opts: RunOptions = {},
): Promise<void> {
  const s = get();
  // The last run lost its connection while its job may still run (and write
  // the same files): no other run starts until it is heard from.
  if (pipelineBusy(s) && !s.running) return;
  const datasetId = opts.datasetId ?? useDatasetStore.getState().datasetId ?? "";
  closeStream();
  const params = opts.params ?? formToParams(s);
  const flattenEnabled = opts.flattenEnabled ?? s.flatten;
  set({
    events: [],
    times: [],
    terminal: null,
    running: true,
    reconnecting: false,
    jobId: null,
    lastRun: { datasetId, stages, force, flattenEnabled, params, ...(opts.tuning ? { tuning: opts.tuning } : {}) },
  });

  if (PYODIDE_MODE) {
    await runInBrowser(datasetId, params, flattenEnabled, force, stages, set, get, opts.tuning);
    return;
  }

  try {
    const job = await runPipeline({
      dataset_id: datasetId,
      flatten_enabled: flattenEnabled,
      force,
      stages,
      params,
      tuning: opts.tuning,
    });
    set({ jobId: job.id });
    follow(job.id, set, get);
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

// A native job's end: its reason in the log (a failure's, where the page's
// banner reads it), the run over, and the outputs it left read afresh.
function finish(set: Setter, get: Getter, terminal: string, message?: string): void {
  closeStream();
  set({ reconnecting: false });
  if (terminal === "error" && message) {
    set({
      events: [...get().events, { type: "progress", status: "error", message, end: true }],
      times: [...get().times, Date.now()],
    });
  }
  set({ terminal, running: false });
  void queryClient.invalidateQueries();
}

// A dropped stream is followed again at once this many times in a row (any
// event the stream brings resets the count); after that, after a pause.
const RECONNECTS = 3;
// While the server cannot be reached the run still counts as running (its job
// may well be): only after this long is it shown as lost, never as failed.
export const LOST_AFTER_MS = 45_000;
// The longest pause between two looks at the job's status.
const POLL_MAX_MS = 15_000;

/** A run that lost its connection to the server while its job may still run: it holds the pipeline until the job is heard from. */
export const pipelineBusy = (s: Pick<PipelineState, "running" | "terminal" | "jobId">): boolean =>
  s.running || (s.terminal === "lost" && s.jobId !== null);

// Follow a native job's progress stream to its end. The server replays a
// job's events from its first on every connection, so a reconnection skips
// those already logged.
function follow(jobId: string, set: Setter, get: Getter, drops = 0): void {
  const logged = get().events.length;
  let replayed = 0;
  let failures = drops;
  const source = new EventSource(`/api/pipeline/jobs/${jobId}/events`);
  es = source;
  source.onmessage = (e) => {
    failures = 0; // the stream works: a later drop starts the count afresh
    if (get().reconnecting) set({ reconnecting: false });
    const ev = JSON.parse(e.data) as JobEvent;
    if (["done", "error", "cancelled"].includes(ev.type)) {
      finish(set, get, ev.type, ev.message);
    } else if (++replayed > logged) {
      set({ events: [...get().events, ev], times: [...get().times, Date.now()] });
    }
  };
  // The stream dropped before the job's end (the network, or the server
  // restarted): the job's own status says what became of it.
  source.onerror = () => {
    if (es !== source) return; // ended, or replaced
    closeStream();
    void afterDrop(jobId, set, get, failures);
  };
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Ask the server what became of the job, until it answers: still running ->
// follow its stream again; ended -> that end; unknown (404: it restarted) ->
// the run stopped. While the server cannot be reached the run stays running
// (and holds the pipeline), and after LOST_AFTER_MS it is shown as lost: its
// end is not known, so no stage is marked failed, and the page keeps asking
// so that it shows the real end once the server answers.
async function afterDrop(jobId: string, set: Setter, get: Getter, drops: number): Promise<void> {
  const since = Date.now();
  set({ reconnecting: true });
  for (let wait = 1000, waited = false; ; wait = Math.min(wait * 2, POLL_MAX_MS), waited = true) {
    let job: JobOut | null | undefined;
    try {
      job = await fetchJob(jobId);
    } catch {
      job = undefined; // the server cannot be reached
    }
    const s = get();
    if (s.jobId !== jobId || !(s.running || s.terminal === "lost")) return; // another run started, or this one was settled
    if (job === null) {
      finish(set, get, "error", "The server no longer knows this run (it restarted), so the run stopped. Stages that completed before it were saved; run again to compute the rest.");
      return;
    }
    if (job && job.status !== "running") {
      finish(set, get, job.status, job.error ?? undefined);
      return;
    }
    if (job && (drops < RECONNECTS || waited)) {
      set({ running: true, terminal: null });
      follow(jobId, set, get, drops + 1);
      return;
    }
    if (!job && s.running && Date.now() - since >= LOST_AFTER_MS) {
      set({ running: false, terminal: "lost", reconnecting: false });
    }
    await pause(wait);
  }
}

// The subset of STAGES to run: the stages switched on.  The consistency check
// rides along with the ΔPDF transform.  Leaving a stage out of `stages` does
// not by itself switch it off: the backend reads a stage left out as a partial
// re-run and hands its output on disk to the next stage.  The switches
// (formToParams, and flatten_enabled) are what make a switched-off stage pass
// its input through, so the next stage reads what came before it.
export function enabledStages(s: PipelineConfig): string[] {
  return [
    s.symmetryAverageEnabled && "symmetry_average",
    s.ringsEnabled && "rings",
    s.punchEnabled && "punch",
    s.backfillEnabled && "backfill",
    s.flatten && "flatten",
    s.pdfEnabled && "pdf",
    s.pdfEnabled && "pdf_check",
  ].filter((x): x is string => Boolean(x));
}

/** The raw coverage-edge trim the backend takes when none is sent: 1 voxel layer (PipelineParams.edge_trim). */
export const DEFAULT_EDGE_TRIM = 1;
/** The layers the page offers (the NeXus Viewer's edge erosion takes the same rule). */
export const EDGE_TRIM_LAYERS = [0, 1, 2, 3] as const;

/** The edge trim the form asks for, in voxel layers: blank (or anything else) is the default. */
export function edgeTrimLayers(s: Pick<PipelineConfig, "edgeTrim">): number {
  const n = Number(s.edgeTrim);
  return s.edgeTrim !== "" && (EDGE_TRIM_LAYERS as readonly number[]).includes(n) ? n : DEFAULT_EDGE_TRIM;
}

// Convert the editable form values into the curated StageParamsIn the pipeline
// accepts (empty fields stay unset → the backend/bridge default is used).  The
// cleanup stages' switches are always sent (the flatten's is the request's
// flatten_enabled).
export function formToParams(s: PipelineConfig): StageParamsIn {
  const params: StageParamsIn = {
    rings_enabled: s.ringsEnabled,
    punch_enabled: s.punchEnabled,
    backfill_enabled: s.backfillEnabled,
  };
  // The symmetry average, off by default, only when switched on.
  if (s.symmetryAverageEnabled) {
    params.symmetry_average_enabled = true;
    if (s.symmetryLaue.trim()) params.symmetry_average_laue = s.symmetryLaue.trim();
    if (s.symmetryReaverage) params.symmetry_average_reaverage = true;
    if (s.symmetryAllowMetricChange) params.symmetry_average_allow_metric_change = true;
  }
  // The raw coverage-edge trim, when it is not the backend's default (1 layer).
  const trim = edgeTrimLayers(s);
  if (trim !== DEFAULT_EDGE_TRIM) params.edge_trim = trim;
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
  // The sample's modulation, as the backend reads a declaration; a blank k
  // leaves the run to the backend's default, which declares none. Never the
  // legacy H fractions.
  const modulation = modulationRequest(s);
  if (modulation !== undefined) params.modulation = modulation;
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
    // Cancel ended it (cancel() already said so): the engine's rejection is
    // that, not a failure.
    if (get().terminal === "cancelled") return;
    log({ type: "progress", status: "error", message: (e as Error).message });
    set({ terminal: "error", running: false });
  }
}
