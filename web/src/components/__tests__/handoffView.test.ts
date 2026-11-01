// What the run-it-locally card says and which one the Configure page shows
// (handoffView.ts): its why-line with the numbers, QUICKSTART's route with
// the data folder, and the choice between a refused load, a failed run and the
// estimate before a run.

import { describe, expect, it } from "vitest";

import type { BrowserLimit } from "../../api/browserLimit";
import type { FailedRun, RefusedLoad } from "../../api/limitSignals";
import {
  aboutBytes,
  dataFolderLine,
  datasetKey,
  fileKey,
  leadLine,
  localCommands,
  nearLimitLine,
  pickConfigureHandoff,
  QUICKSTART_URL,
  runLimitOf,
  type HandoffEnv,
} from "../handoffView";
import type { MemoryView } from "../memoryView";

const GiB = 1024 ** 3;
const DESKTOP: HandoffEnv = { device: "desktop", heapCeiling: 4 * GiB, heapBudget: 3_200_000_000, tabBudget: null };
const PHONE: HandoffEnv = { device: "mobile", heapCeiling: 4 * GiB, heapBudget: 3_200_000_000, tabBudget: 1_300_000_000 };

const limit = (over: Partial<BrowserLimit>): BrowserLimit => ({
  kind: "memory",
  detail: "MemoryError",
  needBytes: null,
  requestBytes: null,
  shape: null,
  device: null,
  ...over,
});

describe("leadLine", () => {
  it("gives the volume's need against the 4 GiB ceiling", () => {
    expect(leadLine(limit({ kind: "gate", needBytes: 5.03e9, shape: [501, 501, 501], device: "desktop" }), DESKTOP)).toBe(
      "This volume (501×501×501) needs about 4.7 GiB; the in-browser engine stops at 4 GiB.",
    );
  });

  it("names the volume when it is known", () => {
    expect(leadLine(limit({ kind: "gate", needBytes: 5.03e9, shape: [501, 501, 501] }), DESKTOP, "huge.h5")).toBe(
      "huge.h5 (501×501×501) needs about 4.7 GiB; the in-browser engine stops at 4 GiB.",
    );
    expect(leadLine(limit({ kind: "gate" }), DESKTOP, "huge.h5")).toBe("huge.h5 is too large for the in-browser engine, which stops at 4 GiB.");
  });

  it("says how much of the 4 GiB a run gets when the need is under it", () => {
    expect(leadLine(limit({ kind: "gate", needBytes: 3.6e9 }), DESKTOP)).toBe(
      "This volume needs about 3.4 GiB; the in-browser engine stops at 4 GiB, about 3 GiB of it for a run.",
    );
  });

  it("gives a phone's tab budget on a phone", () => {
    expect(leadLine(limit({ kind: "gate", needBytes: 1.5e9, shape: [201, 201, 151], device: "mobile" }), PHONE)).toBe(
      "This volume (201×201×151) needs about 1.4 GiB; on a phone or tablet the in-browser engine keeps to about 1.2 GiB, or the browser reloads the page.",
    );
    // The report's device wins over the page's guess.
    expect(leadLine(limit({ kind: "gate", needBytes: 1.5e9, device: "mobile" }), { ...DESKTOP, tabBudget: 1_300_000_000 })).toContain(
      "phone or tablet",
    );
  });

  it("says what a run ran into, by kind", () => {
    expect(leadLine(limit({ kind: "memory" }), DESKTOP)).toBe("The run ran out of memory: the in-browser engine stops at 4 GiB.");
    expect(leadLine(limit({ kind: "memory", requestBytes: 1.18 * GiB }), DESKTOP)).toBe(
      "The run ran out of memory: one more array of 1.2 GiB did not fit in the in-browser engine's 4 GiB.",
    );
    expect(leadLine(limit({ kind: "memory" }), PHONE)).toBe(
      "The run ran out of memory: on a phone or tablet the in-browser engine keeps to about 1.2 GiB, or the browser reloads the page.",
    );
    expect(leadLine(limit({ kind: "int32" }), DESKTOP)).toMatch(/^The run hit the in-browser engine's 32-bit limit .*64-bit Python\.$/);
    expect(leadLine(limit({ kind: "worker" }), DESKTOP)).toBe(
      "The in-browser engine stopped mid-run, most likely out of memory: it stops at 4 GiB.",
    );
    expect(leadLine(limit({ kind: "gate" }), DESKTOP)).toBe("This volume is too large for the in-browser engine, which stops at 4 GiB.");
  });

  it("does without a phone budget it was not told", () => {
    expect(leadLine(limit({ kind: "memory" }), { ...PHONE, tabBudget: null })).toBe(
      "The run ran out of memory: on a phone or tablet the browser reloads the page well before a computer's limit.",
    );
  });
});

describe("aboutBytes", () => {
  it("rounds an estimate for a sentence", () => {
    expect(aboutBytes(5.03e9)).toBe("4.7 GiB");
    expect(aboutBytes(3.2e9)).toBe("3 GiB");
    expect(aboutBytes(1.3e9)).toBe("1.2 GiB");
    expect(aboutBytes(850 * 1024 ** 2)).toBe("850 MiB");
    expect(aboutBytes(1)).toBe("10 MiB");
  });
});

describe("the local route", () => {
  it("is QUICKSTART's, from a clone, with the data folder", () => {
    expect(localCommands()).toEqual([
      "git clone https://github.com/drthyang/nebula3d",
      "cd nebula3d",
      'pip install -e ".[web]"',
      "make web-install && make ui",
      "mkdir -p ~/nebula3d-data/raw",
      "nebula3d-web --data-root ~/nebula3d-data",
    ]);
    expect(localCommands("/data/scans")[5]).toBe("nebula3d-web --data-root /data/scans");
    expect(QUICKSTART_URL).toBe("https://github.com/drthyang/nebula3d/blob/main/QUICKSTART.md#native--no-size-limit");
  });

  it("says where the volume goes, as the .nxs the local console lists", () => {
    expect(dataFolderLine("big.nxs")).toBe("Put big.nxs in ~/nebula3d-data/raw/ before you launch.");
    expect(dataFolderLine("big.h5")).toBe(
      "Save big.h5 in ~/nebula3d-data/raw/ as big.nxs before you launch: the local console lists .nxs files.",
    );
    expect(dataFolderLine("Scan.HDF5")).toContain("as Scan.nxs");
    expect(dataFolderLine(null)).toBe("Put the volume in ~/nebula3d-data/raw/ before you launch (as a .nxs file).");
  });

  it("sends a regridded volume's source, since the regridded copy lives only in the browser", () => {
    expect(dataFolderLine("scan_regridded.nxs")).toBe(
      "Put scan.nxs, the volume this one was regridded from, in ~/nebula3d-data/raw/ and regrid it there: the regridded copy lives only in this browser.",
    );
    expect(dataFolderLine("scan_regridded_sym.nxs")).toContain("Put scan.nxs,");
  });
});

describe("nearLimitLine", () => {
  it("gives the bar's reading", () => {
    const view = { amount: "3.70 / 4 GiB", percentText: "92%" } as MemoryView;
    expect(nearLimitLine(view)).toBe("Memory is at 3.70 / 4 GiB (92%): if this run fails, the local version has no such limit.");
  });
});

describe("pickConfigureHandoff", () => {
  const refused: RefusedLoad = { fileName: "huge.h5", limit: limit({ kind: "gate", needBytes: 5e9 }), at: 100 };
  const failed: FailedRun = { datasetId: "big", limit: limit({ kind: "memory" }), at: 200 };
  const over = limit({ kind: "gate", needBytes: 4.5e9 });
  const none = { refusedLoad: null, failedRun: null, beforeRun: null, datasetId: "big", datasetFile: "big.nxs" };

  it("shows nothing when nothing is over the limit", () => {
    expect(pickConfigureHandoff(none)).toBeNull();
  });

  it("shows a refused load, remembered by its file", () => {
    expect(pickConfigureHandoff({ ...none, refusedLoad: refused })).toEqual({
      context: "load",
      limit: refused.limit,
      key: "file:huge.h5",
      fileName: "huge.h5",
    });
  });

  it("shows the selected dataset's failed run, remembered by the dataset", () => {
    expect(pickConfigureHandoff({ ...none, failedRun: failed })).toMatchObject({ context: "run", key: "ds:big", fileName: "big.nxs" });
    expect(pickConfigureHandoff({ ...none, failedRun: failed, datasetId: "other" })).toBeNull(); // another dataset's
  });

  it("shows the newer of a refused load and a failed run", () => {
    expect(pickConfigureHandoff({ ...none, refusedLoad: refused, failedRun: failed })?.context).toBe("run");
    expect(pickConfigureHandoff({ ...none, refusedLoad: { ...refused, at: 300 }, failedRun: failed })?.context).toBe("load");
  });

  it("shows the estimate before a run when nothing happened yet, under the same key as the dataset's run", () => {
    expect(pickConfigureHandoff({ ...none, beforeRun: over })).toEqual({
      context: "before-run",
      limit: over,
      key: datasetKey("big"),
      fileName: "big.nxs",
    });
    expect(pickConfigureHandoff({ ...none, beforeRun: over, datasetId: null })).toBeNull();
    expect(pickConfigureHandoff({ ...none, beforeRun: over, failedRun: failed })?.context).toBe("run");
  });

  it("keys a dismissal per dataset and per refused file", () => {
    expect(datasetKey("big")).toBe("ds:big");
    expect(fileKey("huge.h5")).toBe("file:huge.h5");
  });
});

describe("runLimitOf", () => {
  const engineFailure: FailedRun = { datasetId: "big", limit: limit({ kind: "worker" }), at: 5 };
  const run = (over: Partial<Parameters<typeof runLimitOf>[1]> = {}) => ({
    terminal: "error",
    events: [],
    times: [],
    datasetId: "big",
    ...over,
  });

  it("takes the engine's word for the last run", () => {
    expect(runLimitOf(engineFailure, run())).toBe(engineFailure);
  });

  it("reads a restored log's last error when the engine has no word", () => {
    const events = [
      { type: "progress", stage: "rings", status: "start", message: "rings" },
      { type: "progress", status: "error", message: "Traceback (most recent call last):\nMemoryError" },
    ];
    expect(runLimitOf(null, run({ events, times: [1, 2] }))).toMatchObject({ datasetId: "big", at: 2, limit: { kind: "memory" } });
    expect(runLimitOf(null, run({ events: [{ type: "progress", status: "error", message: "ValueError: bad" }], times: [1] }))).toBeNull();
  });

  it("is nothing unless the last run failed", () => {
    expect(runLimitOf(engineFailure, run({ terminal: "done" }))).toBeNull();
    expect(runLimitOf(engineFailure, run({ terminal: null }))).toBeNull(); // a run going
    expect(runLimitOf(engineFailure, run({ terminal: "cancelled" }))).toBeNull();
  });
});
