// The in-browser engine runs only the stages its pipeline worker lists
// (pyodideShared.ts RUN_STAGES): a stage missing there is dropped from every
// in-browser run without a word, as the symmetry average once was. They are
// the store's, which mirror nebula3d.pipeline.STAGES.

import { describe, expect, it } from "vitest";

import { ENGINE_STAGES } from "../../api/pyodideEngine";
import { STAGES } from "../../state/pipelineStore";
import { RUN_STAGES } from "../pyodideShared";

describe("the stages the in-browser engine runs", () => {
  it("are the pipeline's, in its order", () => {
    expect([...RUN_STAGES]).toEqual([...STAGES]);
    expect([...ENGINE_STAGES]).toEqual([...STAGES]);
  });
});
