// Typed fetch wrappers for the nebula3d API, including the binary slice envelope.

import { engine, PYODIDE_MODE } from "./pyodideEngine";
import type {
  BraggProfile,
  ConsistencyCheck,
  ConsistencyMeta,
  DataRoot,
  Dataset,
  DeltaPdfMeta,
  DpdfFeatures,
  JobOut,
  ModulationCheck,
  ModulationCheckIn,
  PipelineRunRequest,
  ProtectedLabels,
  RingDiagnostics,
  RingIsotropy,
  ShellFloors,
  Slice,
  SliceHeader,
  TuningPromote,
  TuningRun,
  UbCheck,
  VolumeCoverage,
  VolumeMeta,
  VolumeTexture,
} from "./types";

function bandParams(qMin?: number, qMax?: number, rMin?: number, rMax?: number): string {
  const p = new URLSearchParams();
  if (qMin != null) p.set("q_min", String(qMin));
  if (qMax != null) p.set("q_max", String(qMax));
  if (rMin != null) p.set("r_min", String(rMin));
  if (rMax != null) p.set("r_max", String(rMax));
  return p.toString();
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return (await r.json()) as T;
}

// Decode the binary slice envelope: [uint32 LE header_len][JSON header][float32 data].
async function fetchEnvelope(url: string): Promise<Slice> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const buf = await r.arrayBuffer();
  const headerLen = new DataView(buf).getUint32(0, true);
  const headerBytes = new Uint8Array(buf, 4, headerLen);
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as SliceHeader;
  // Copy to a fresh 0-offset buffer (float32 view needs 4-byte alignment, which
  // an arbitrary header length does not guarantee).
  const data = new Float32Array(buf.slice(4 + headerLen));
  return { header, data };
}

export function fetchHealth(): Promise<{ status: string }> {
  // Backend-less builds report healthy so the shell renders (Pyodide boots
  // lazily on the first compute, not here).
  if (PYODIDE_MODE) return Promise.resolve({ status: "pyodide" });
  return getJSON<{ status: string }>("/api/health");
}

export function fetchDatasets(): Promise<Dataset[]> {
  if (PYODIDE_MODE) return engine.datasets();
  return getJSON<Dataset[]>("/api/datasets");
}

// One dataset by id — including a tuning run's view of it
// ("<id>~tune~<run>" or "<id>~tune~<run>~<stage>-<n>").
export function fetchDataset(datasetId: string): Promise<Dataset> {
  if (PYODIDE_MODE) return engine.dataset(datasetId);
  return getJSON<Dataset>(`/api/datasets/${encodeURIComponent(datasetId)}`);
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().then((d) => d?.detail, () => null);
    throw new Error(detail ? String(detail) : `${r.status} ${r.statusText}: ${url}`);
  }
  return (await r.json()) as T;
}

// A tuning run's folder (tuning/<run>/ beside processed/), starting at a stage.
export function startTuningRun(datasetId: string, firstStage: string): Promise<TuningRun> {
  if (PYODIDE_MODE) return engine.tuningStart(datasetId, firstStage);
  return postJSON<TuningRun>("/api/tuning/runs", { dataset_id: datasetId, first_stage: firstStage });
}

// Keep a trial: copy its output into the run's chain, drop the stage's trials.
export function promoteTrial(runId: string, trial: string): Promise<TuningPromote> {
  if (PYODIDE_MODE) return engine.tuningPromote(runId, trial);
  return postJSON<TuningPromote>(`/api/tuning/runs/${encodeURIComponent(runId)}/promote`, { trial });
}

export async function fetchDataRoot(): Promise<DataRoot> {
  if (PYODIDE_MODE) {
    const n = (await engine.datasets()).length;
    return {
      data_root: "in-browser (Pyodide)",
      raw_exists: true, processed_exists: true, n_datasets: n,
    };
  }
  return getJSON<DataRoot>("/api/data-root");
}

export async function setDataRoot(dataRoot: string): Promise<DataRoot> {
  const r = await fetch("/api/data-root", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_root: dataRoot }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as DataRoot;
}

export async function browseDataRoot(): Promise<DataRoot> {
  const r = await fetch("/api/data-root/browse", {
    method: "POST",
    headers: { "X-Nebula3d-Local": "1" },
  });
  if (!r.ok) {
    const body = await r.text();
    let detail = body;
    try {
      detail = (JSON.parse(body) as { detail?: string }).detail ?? body;
    } catch {
      // Plain text error body.
    }
    throw new Error(`${r.status} ${detail}`);
  }
  return (await r.json()) as DataRoot;
}

export function fetchMeta(volumeId: string): Promise<VolumeMeta> {
  if (PYODIDE_MODE) return engine.volumeMeta(volumeId);
  return getJSON<VolumeMeta>(`/api/volumes/${encodeURIComponent(volumeId)}/meta`);
}

export function fetchVolumeCoverage(volumeId: string): Promise<VolumeCoverage> {
  if (PYODIDE_MODE) return engine.volumeCoverage(volumeId);
  return getJSON<VolumeCoverage>(`/api/volumes/${encodeURIComponent(volumeId)}/coverage`);
}

/** Whether the volume's UB puts its Bragg peaks (nodes every `cell`) on their nodes. */
export async function fetchUbCheck(volumeId: string, cell: [number, number, number], qMax: number | null = null): Promise<UbCheck> {
  if (PYODIDE_MODE) return engine.ubCheck(volumeId, cell.join(","), qMax);
  const q = new URLSearchParams({ cell: cell.join(",") });
  if (qMax != null) q.set("q_max", String(qMax));
  const url = `/api/volumes/${encodeURIComponent(volumeId)}/ub?${q}`;
  const r = await fetch(url);
  if (!r.ok) {
    // A fit with too few peaks says so (422); pass its reason on.
    const detail = await r.json().then((b: { detail?: unknown }) => (typeof b?.detail === "string" ? b.detail : null)).catch(() => null);
    throw new Error(detail ?? `${r.status} ${r.statusText}: ${url}`);
  }
  return (await r.json()) as UbCheck;
}

/** The limits of the fill-bias rule a texture request judges by; one left out is the server's (texture.ts's). */
export interface TextureLimits {
  minSigma?: number; // the median bias in the rim's σ
  oneWay?: number; // the share of the judged holes leaning the median's way
  minHoles?: number; // the fewest judged holes
  floor?: number; // the median bias in units of the local diffuse level
}

/**
 * Whether a backfilled stage's fills sit systematically off the diffuse
 * around their holes: the fill-bias rule on every punch hole, with its 3-D
 * rim, and the `limit` holes farthest outside their range.
 */
export function fetchVolumeTexture(volumeId: string, limit = 20, limits: TextureLimits = {}): Promise<VolumeTexture> {
  const { minSigma = null, oneWay = null, minHoles = null, floor = null } = limits;
  if (PYODIDE_MODE) return engine.volumeTexture(volumeId, limit, minSigma, oneWay, minHoles, floor);
  const q = new URLSearchParams({ limit: String(limit) });
  for (const [key, value] of [["min_sigma", minSigma], ["one_way", oneWay], ["min_holes", minHoles], ["floor", floor]] as const) {
    if (value != null) q.set(key, String(value));
  }
  return getJSON<VolumeTexture>(`/api/volumes/${encodeURIComponent(volumeId)}/texture?${q}`);
}

/**
 * The floor of every |Q| shell over the whole volume, on the shells and at
 * the percentile the flatten recorded in the file (its defaults without a
 * record); for the flattened stage, its input's too, and the diffuse level.
 */
export function fetchShellFloors(volumeId: string): Promise<ShellFloors> {
  if (PYODIDE_MODE) return engine.shellFloors(volumeId);
  return getJSON<ShellFloors>(`/api/volumes/${encodeURIComponent(volumeId)}/shell-floors`);
}

/** Which shells (|Q| centre, FWHM in Å⁻¹) of a volume are powder rings: each rises in nearly every direction. */
export function fetchRingIsotropy(volumeId: string, shells: { q: number; fwhm: number }[]): Promise<RingIsotropy> {
  const q = shells.map((s) => s.q.toFixed(4)).join(",");
  const fwhm = shells.map((s) => s.fwhm.toFixed(4)).join(",");
  if (PYODIDE_MODE) return engine.ringIsotropy(volumeId, q, fwhm);
  return getJSON<RingIsotropy>(`/api/volumes/${encodeURIComponent(volumeId)}/rings?${new URLSearchParams({ q, fwhm })}`);
}

export function fetchSlice(
  volumeId: string,
  plane: string,
  value: number,
  interp = false,
): Promise<Slice> {
  if (PYODIDE_MODE) return engine.volumeSlice(volumeId, plane, value, interp);
  const params = new URLSearchParams({
    plane,
    value: String(value),
    interp: String(interp),
  });
  return fetchEnvelope(
    `/api/volumes/${encodeURIComponent(volumeId)}/slice?${params.toString()}`,
  );
}

export function fetchDpdfMeta(volumeId: string): Promise<DeltaPdfMeta> {
  if (PYODIDE_MODE) return engine.dpdfMeta(volumeId);
  return getJSON<DeltaPdfMeta>(`/api/deltapdf/${encodeURIComponent(volumeId)}/meta`);
}

/** The ΔPDF's strongest extrema above `minSigma` robust σ, grouped by the declared point group, else by sign, length and size. */
export function fetchDpdfFeatures(volumeId: string, minSigma = 5, limit = 12): Promise<DpdfFeatures> {
  if (PYODIDE_MODE) return engine.dpdfFeatures(volumeId, minSigma, limit);
  const params = new URLSearchParams({ min_sigma: String(minSigma), limit: String(limit) });
  return getJSON<DpdfFeatures>(`/api/deltapdf/${encodeURIComponent(volumeId)}/features?${params}`);
}

export function fetchDpdfSlice(
  volumeId: string,
  plane: string,
  value: number,
): Promise<Slice> {
  if (PYODIDE_MODE) return engine.dpdfSlice(volumeId, plane, value);
  const params = new URLSearchParams({ plane, value: String(value) });
  return fetchEnvelope(
    `/api/deltapdf/${encodeURIComponent(volumeId)}/slice?${params.toString()}`,
  );
}

export function fetchConsistencyMeta(
  datasetId: string,
  qMin?: number,
  qMax?: number,
  rMin?: number,
  rMax?: number,
): Promise<ConsistencyMeta> {
  if (PYODIDE_MODE) return engine.consistencyMeta(datasetId, qMin, qMax, rMin, rMax);
  const qs = bandParams(qMin, qMax, rMin, rMax);
  const url = `/api/consistency/${encodeURIComponent(datasetId)}/meta${qs ? `?${qs}` : ""}`;
  return getJSON<ConsistencyMeta>(url);
}

// The pipeline's saved back-FFT check metrics — a small file read, unlike
// fetchConsistencyMeta, which re-runs the round trip.
export function fetchConsistencyCheck(datasetId: string): Promise<ConsistencyCheck> {
  if (PYODIDE_MODE) return engine.consistencyCheck(datasetId);
  return getJSON<ConsistencyCheck>(`/api/consistency/${encodeURIComponent(datasetId)}/check`);
}

export function fetchBraggProfile(datasetId: string): Promise<BraggProfile> {
  if (PYODIDE_MODE) return engine.braggProfile(datasetId);
  return getJSON<BraggProfile>(`/api/bragg/${encodeURIComponent(datasetId)}/profile`);
}

/**
 * What a declared modulation means before a run (POST /api/modulation/check):
 * its description and the positions it protects on the cell and under the
 * symmetry given, or what is wrong with it (ok false). Without a
 * `modulation`, the backend's default declaration.
 */
export function checkModulation(body: ModulationCheckIn): Promise<ModulationCheck> {
  if (PYODIDE_MODE) return engine.modulationCheck(JSON.stringify(body));
  return postJSON<ModulationCheck>("/api/modulation/check", body);
}

/**
 * Which protected position each voxel of a slice of the dataset's punched
 * stage lies in (GET /api/modulation/{id}/labels), on that stage's grid: what
 * the run's search left alone, from its punch record, never from the form.
 * The header's `recorded` is false for a record from before the punch kept it.
 */
export async function fetchProtectedLabels(datasetId: string, plane: string, value: number, interp = false): Promise<ProtectedLabels> {
  if (PYODIDE_MODE) return (await engine.protectedLabels(datasetId, plane, value, interp)) as ProtectedLabels;
  const params = new URLSearchParams({ plane, value: String(value), interp: String(interp) });
  return (await fetchEnvelope(`/api/modulation/${encodeURIComponent(datasetId)}/labels?${params.toString()}`)) as ProtectedLabels;
}

export function fetchRingDiagnostics(datasetId: string): Promise<RingDiagnostics> {
  if (PYODIDE_MODE) return engine.ringDiagnostics(datasetId);
  return getJSON<RingDiagnostics>(`/api/rings/${encodeURIComponent(datasetId)}/diagnostics`);
}

export async function saveConsistencyDpdf(
  datasetId: string,
  qMin?: number,
  qMax?: number,
  rMin?: number,
  rMax?: number,
): Promise<{ saved: boolean; path: string; filename: string }> {
  if (PYODIDE_MODE) {
    // No server disk in the browser build: compute the .h5 in the Worker and
    // hand it to the user as a download.
    const { filename, bytes } = await engine.saveDpdf(datasetId, qMin, qMax, rMin, rMax);
    const blob = new Blob([bytes as BlobPart], { type: "application/x-hdf5" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { saved: true, path: filename, filename };
  }
  const qs = bandParams(qMin, qMax, rMin, rMax);
  const url = `/api/consistency/${encodeURIComponent(datasetId)}/save${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, { method: "POST" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${url}`);
  return (await r.json()) as { saved: boolean; path: string; filename: string };
}

export function fetchConsistencySlice(
  datasetId: string,
  panel: string,
  plane: string,
  value: number,
  qMin?: number,
  qMax?: number,
  rMin?: number,
  rMax?: number,
): Promise<Slice> {
  if (PYODIDE_MODE) {
    return engine.consistencySlice(datasetId, panel, plane, value, qMin, qMax, rMin, rMax);
  }
  const params = new URLSearchParams({ panel, plane, value: String(value) });
  if (qMin != null) params.set("q_min", String(qMin));
  if (qMax != null) params.set("q_max", String(qMax));
  if (rMin != null) params.set("r_min", String(rMin));
  if (rMax != null) params.set("r_max", String(rMax));
  return fetchEnvelope(
    `/api/consistency/${encodeURIComponent(datasetId)}/slice?${params.toString()}`,
  );
}

export async function runPipeline(req: PipelineRunRequest): Promise<JobOut> {
  const r = await fetch("/api/pipeline/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as JobOut;
}

export async function cancelJob(jobId: string): Promise<JobOut> {
  const r = await fetch(`/api/pipeline/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as JobOut;
}
