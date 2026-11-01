// What the run-it-locally card says (LocalHandoff.tsx draws it), and which one
// a page shows. Pure, so the wording and the choice are tested on their own.
//
// The card appears where the in-browser engine's limit shows itself
// (api/browserLimit.ts): a load the size gate refused, a run that failed of
// it, a dataset whose estimate is over the budget before a run, and, on
// request, a memory bar in the red during one. It says why in one line, with
// the numbers, then gives QUICKSTART's native route.

import type { BrowserLimit } from "../api/browserLimit";
import type { FailedRun, RefusedLoad } from "../api/limitSignals";
import type { JobEvent } from "../api/types";
import { classifyBrowserLimit } from "../api/browserLimit";
import { formatBytes, type MemoryView } from "./memoryView";

export const QUICKSTART_URL = "https://github.com/drthyang/nebula3d/blob/main/QUICKSTART.md#native--no-size-limit";
export const REPO_URL = "https://github.com/drthyang/nebula3d";
/** Where the commands put the data: nebula3d-web reads raw/ and writes processed/ under it. */
export const DATA_FOLDER = "~/nebula3d-data";

/** QUICKSTART's native route from a clone (nebula3d is not on PyPI), with the data folder. */
export function localCommands(folder: string = DATA_FOLDER): string[] {
  return [
    `git clone ${REPO_URL}`,
    "cd nebula3d",
    'pip install -e ".[web]"',
    "make web-install && make ui",
    `mkdir -p ${folder}/raw`,
    `nebula3d-web --data-root ${folder}`,
  ];
}

export const ROUTE_LINE =
  "Run it on your computer instead: the same console, limited only by your computer's memory. It needs Python 3.10+, Node.js and git.";
export const PHONE_LINE = "A desktop browser also takes larger volumes than a phone or tablet.";
export const PRIVACY_LINE = "Your data stays on your computer either way.";

/**
 * Where the volume goes before the launch. The local console lists raw/*.nxs
 * (an .h5 is read the same once named .nxs); a regridded volume lives only in
 * the browser, so its source goes there, to be regridded again.
 */
export function dataFolderLine(fileName: string | null | undefined, folder: string = DATA_FOLDER): string {
  const raw = `${folder}/raw/`;
  if (!fileName) return `Put the volume in ${raw} before you launch (as a .nxs file).`;
  const regridded = /^(.+?)_regridded(?:_sym)?\.nxs$/i.exec(fileName);
  if (regridded) {
    return `Put ${regridded[1]}.nxs, the volume this one was regridded from, in ${raw} and regrid it there: the regridded copy lives only in this browser.`;
  }
  const nxs = fileName.replace(/\.(?:h5|hdf5)$/i, ".nxs");
  if (nxs !== fileName) return `Save ${fileName} in ${raw} as ${nxs} before you launch: the local console lists .nxs files.`;
  return `Put ${fileName} in ${raw} before you launch.`;
}

/** What the card plans with: the device class and the engine's ceilings. */
export interface HandoffEnv {
  device: "desktop" | "mobile";
  heapCeiling: number; // Pyodide's 4 GiB
  heapBudget: number | null; // what the size gate budgets a run's peak at
  tabBudget: number | null; // a phone's tab-wide budget
}

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

/** An estimate, rounded for a sentence: "4.7 GiB", "3 GiB", "850 MiB". */
export function aboutBytes(bytes: number): string {
  if (bytes >= GiB) return `${Number((bytes / GiB).toFixed(1))} GiB`;
  return `${Math.max(10, Math.round(bytes / (10 * MiB)) * 10)} MiB`;
}

/** Why, in one plain line with the numbers: the card's first line. *name*: the volume's file, when known. */
export function leadLine(limit: BrowserLimit, env: HandoffEnv, name?: string | null): string {
  const device = limit.device ?? env.device;
  const ceiling = formatBytes(env.heapCeiling);
  const phone =
    device === "mobile"
      ? env.tabBudget
        ? `on a phone or tablet the in-browser engine keeps to about ${aboutBytes(env.tabBudget)}, or the browser reloads the page`
        : "on a phone or tablet the browser reloads the page well before a computer's limit"
      : null;

  if (limit.needBytes) {
    const volume = `${name || "This volume"}${limit.shape ? ` (${limit.shape.join("×")})` : ""} needs about ${aboutBytes(limit.needBytes)}`;
    if (phone) return `${volume}; ${phone}.`;
    if (limit.needBytes < env.heapCeiling && env.heapBudget) {
      return `${volume}; the in-browser engine stops at ${ceiling}, about ${aboutBytes(env.heapBudget)} of it for a run.`;
    }
    return `${volume}; the in-browser engine stops at ${ceiling}.`;
  }
  switch (limit.kind) {
    case "gate":
      return phone
        ? `${name || "This volume"} is too large: ${phone}.`
        : `${name || "This volume"} is too large for the in-browser engine, which stops at ${ceiling}.`;
    case "int32":
      return "The run hit the in-browser engine's 32-bit limit (an array too large to index); the local version runs 64-bit Python.";
    case "worker":
      return `The in-browser engine stopped mid-run, most likely out of memory: ${phone ?? `it stops at ${ceiling}`}.`;
    case "memory":
      if (phone) return `The run ran out of memory: ${phone}.`;
      if (limit.requestBytes) {
        return `The run ran out of memory: one more array of ${aboutBytes(limit.requestBytes)} did not fit in the in-browser engine's ${ceiling}.`;
      }
      return `The run ran out of memory: the in-browser engine stops at ${ceiling}.`;
  }
}

/** The memory bar in the red during a run: the soft hint's card. */
export function nearLimitLine(view: MemoryView): string {
  return `Memory is at ${view.amount} (${view.percentText}): if this run fails, the local version has no such limit.`;
}

// ---------------------------------------------------------------------------
// Which card a page shows
// ---------------------------------------------------------------------------

export type HandoffContext = "load" | "run" | "before-run";

export interface HandoffChoice {
  context: HandoffContext;
  limit: BrowserLimit;
  key: string; // what a dismissal is remembered under (per dataset, or per refused file)
  fileName: string | null;
}

export const datasetKey = (datasetId: string): string => `ds:${datasetId}`;
export const fileKey = (fileName: string): string => `file:${fileName}`;

/** The last run's failure, when it is the engine's limit: the engine's word for it, else its log's. */
export function runLimitOf(
  engineFailure: FailedRun | null,
  run: { terminal: string | null; events: readonly JobEvent[]; times: readonly number[]; datasetId: string | null },
): FailedRun | null {
  if (run.terminal !== "error") return null; // it did not fail, or a newer run is going
  if (engineFailure) return engineFailure;
  // A restored session's log: only its words are left.
  for (let i = run.events.length - 1; i >= 0; i--) {
    if (run.events[i].status !== "error") continue;
    const limit = classifyBrowserLimit(run.events[i].message ?? "");
    return limit ? { datasetId: run.datasetId ?? "", limit, at: run.times[i] ?? 0 } : null;
  }
  return null;
}

/**
 * The card the Configure page shows, at most one: the newer of a refused load
 * and the selected dataset's failed run, else the selected dataset's estimate
 * before a run.
 */
export function pickConfigureHandoff(input: {
  refusedLoad: RefusedLoad | null;
  failedRun: FailedRun | null;
  beforeRun: BrowserLimit | null;
  datasetId: string | null;
  datasetFile: string | null;
}): HandoffChoice | null {
  const { refusedLoad, beforeRun, datasetId, datasetFile } = input;
  const failedRun = input.failedRun && datasetId && input.failedRun.datasetId === datasetId ? input.failedRun : null;
  const load: HandoffChoice | null = refusedLoad
    ? { context: "load", limit: refusedLoad.limit, key: fileKey(refusedLoad.fileName), fileName: refusedLoad.fileName }
    : null;
  const run: HandoffChoice | null = failedRun
    ? { context: "run", limit: failedRun.limit, key: datasetKey(failedRun.datasetId), fileName: datasetFile }
    : null;
  if (load && run) return refusedLoad!.at >= failedRun!.at ? load : run;
  if (load || run) return load ?? run;
  if (beforeRun && datasetId) return { context: "before-run", limit: beforeRun, key: datasetKey(datasetId), fileName: datasetFile };
  return null;
}
