// The click grant (llm/consent.ts) and update_settings' grant lift: a grant
// comes from a trusted click alone, holds a copy of the exact changes, is
// used up by the first call that carries it, and lifts each guard for the
// change it approved and no other: a sample fact, the edge trim, the
// symmetry average, the |Q| band, the magnetic ion, a ring change the ring
// gate holds. Every write is the settings' own, checked. Synthetic only.
// What the model may try is in consent.adversarial.test.ts.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { grantCovers, grantForClick, grantIsFor, isTrustedClick, redeemGrant, revokeGrant, type AppCallContext, type Grant } from "../consent";
import { callTool, CHAT_TOOLS, type ToolContext } from "../tools";
import { USER_SETTINGS, userSetting } from "../tune/userSettings";

const DATASET = { id: "demo", stem: "demo", stages: [] } as unknown as Dataset;
const ctx: ToolContext = { dataset: DATASET, datasets: [DATASET] };
const TRUSTED = { isTrusted: true }; // the browser's own click, as a handler's nativeEvent has it

const grant = (changes: Record<string, unknown>, card = "P1", dataset = "demo"): Grant => grantForClick(TRUSTED, { card, dataset, changes })!;
/** update_settings on the app's own context, with `g`, as an Apply card calls it. */
const applied = (changes: Record<string, unknown>, g: Grant | null) => callTool({ ...ctx, ...(g ? { grant: g } : {}) } as AppCallContext, "update_settings", { changes });
const store = () => usePipelineStore.getState();

beforeEach(() => usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false }));

describe("a click grant", () => {
  it("comes from a trusted event alone", () => {
    expect(isTrustedClick(TRUSTED)).toBe(true);
    for (const e of [null, undefined, {}, { isTrusted: false }, { isTrusted: "true" }, { isTrusted: 1 }, new Event("click")]) {
      expect(isTrustedClick(e as never), JSON.stringify(e)).toBe(false);
      expect(grantForClick(e as never, { card: "P1", dataset: "demo", changes: { punchSupercellL: 2 } })).toBeNull();
    }
  });

  it("needs a card, a dataset and a change", () => {
    expect(grantForClick(TRUSTED, { card: "", dataset: "demo", changes: { punchSupercellL: 2 } })).toBeNull();
    expect(grantForClick(TRUSTED, { card: "P1", dataset: "", changes: { punchSupercellL: 2 } })).toBeNull();
    expect(grantForClick(TRUSTED, { card: "P1", dataset: "demo", changes: {} })).toBeNull();
    expect(grantForClick(TRUSTED, { card: "P1", dataset: "demo", changes: [] as never })).toBeNull();
  });

  it("is an opaque token: it says nothing of its terms, and serializes as {}", () => {
    const g = grant({ punchSupercellL: 2 });
    expect(Object.keys(g)).toEqual([]);
    expect(JSON.stringify({ g })).toBe('{"g":{}}');
    expect(Object.isFrozen(g)).toBe(true);
    expect(grantIsFor(g, "P1")).toBe(true);
    expect(grantIsFor(g, "P2")).toBe(false);
  });

  it("holds a frozen copy of the changes: the caller's object changed afterwards changes nothing it allows", () => {
    const changes: Record<string, unknown> = { modulation: { k: "0, 1/3, 0", order: 1 } };
    const g = grant(changes);
    (changes.modulation as Record<string, unknown>).k = "1/2, 0, 0";
    changes.punchSupercellH = 3;
    const terms = redeemGrant({ ...ctx, grant: g } as AppCallContext)!;
    expect(terms.changes).toEqual({ modulation: { k: "0, 1/3, 0", order: 1 } });
    expect(Object.isFrozen(terms.changes.modulation)).toBe(true);
  });

  it("is used up by the first read, and a revoked one is none", () => {
    const g = grant({ punchSupercellL: 2 });
    const call = { ...ctx, grant: g } as AppCallContext;
    expect(redeemGrant(call)).toMatchObject({ card: "P1", dataset: "demo", changes: { punchSupercellL: 2 } });
    expect(redeemGrant(call)).toBeNull();
    const h = grant({ punchSupercellL: 2 });
    revokeGrant(h);
    expect(grantIsFor(h, "P1")).toBe(false);
    expect(redeemGrant({ ...ctx, grant: h } as AppCallContext)).toBeNull();
  });

  it("covers the key it approved at the value it approved, written the same or with the same canonical fields", () => {
    const write = userSetting("pdfQMin")!.write;
    const terms = redeemGrant({ ...ctx, grant: grant({ pdfQMin: 0.5 }) } as AppCallContext);
    expect(grantCovers(terms, "pdfQMin", 0.5)).toBe(true);
    expect(grantCovers(terms, "pdfQMin", "0.50", write)).toBe(true); // the same field, "0.50"
    expect(grantCovers(terms, "pdfQMin", 0.6, write)).toBe(false);
    expect(grantCovers(terms, "pdfQMax", 0.5, write)).toBe(false);
    expect(grantCovers(terms, "pdfQMin", "junk", write)).toBe(false); // a write that throws covers nothing
    expect(grantCovers(null, "pdfQMin", 0.5, write)).toBe(false);
  });
});

describe("update_settings under a click grant, on the app's own call", () => {
  it("sets the sample fact it approved, and reports it as any change", async () => {
    const r = await applied({ punchSupercellL: 2 }, grant({ punchSupercellL: 2 }));
    expect(r.ok, r.text).toBe(true);
    expect(JSON.parse(r.text)).toEqual({ changed: [{ setting: "punchSupercellL", from: 1, to: 2 }], rerun_from: "punch" });
    expect(store().punchSupercellL).toBe("2");
  });

  it("declares the modulation it approved, as one setting of four fields", async () => {
    const m = { k: "0, 1/3, 0", order: 2, form: "planes", half_width: 0.05 };
    const r = await applied({ modulation: m }, grant({ modulation: m }));
    expect(r.ok, r.text).toBe(true);
    expect(store()).toMatchObject({ modulationK: "0, 1/3, 0", modulationOrder: "2", modulationForm: "planes", modulationHalfWidth: "0.05" });
  });

  it("sets the edge trim, and the symmetry average's settings the model can never set", async () => {
    expect((await applied({ edgeTrim: 2 }, grant({ edgeTrim: 2 }))).ok).toBe(true);
    expect(store().edgeTrim).toBe("2");
    const sym = { symmetryAverageEnabled: true, symmetryLaue: "6/mmm" };
    const r = await applied(sym, grant(sym));
    expect(r.ok, r.text).toBe(true);
    expect(store()).toMatchObject({ symmetryAverageEnabled: true, symmetryLaue: "6/mmm" });
    // The symmetry average comes before every stage a run starts from: no stage to rerun from.
    expect(JSON.parse(r.text).rerun_from).toBeNull();
  });

  it("writes the |Q| band and the magnetic ion as the Configure page does, checked", async () => {
    const band = { pdfQMin: 0.5, pdfQMax: 7.2 };
    const r = await applied(band, grant(band));
    expect(r.ok, r.text).toBe(true);
    expect(store()).toMatchObject({ pdfQMin: "0.50", pdfQMax: "7.20" });
    expect(JSON.parse(r.text).rerun_from).toBe("pdf");
    expect((await applied({ flattenIon: "fe2+" }, grant({ flattenIon: "fe2+" }))).ok).toBe(true);
    expect(store().flattenIon).toBe("Fe2+");
    // Checked: a band upside down, an ion off the page's list, a Laue class the run cannot read.
    const upside = { pdfQMin: 8, pdfQMax: 2 };
    expect((await applied(upside, grant(upside))).text).toMatch(/invalid arguments — the \|Q\| band needs pdfQMin below pdfQMax/);
    expect((await applied({ flattenIon: "Xx9+" }, grant({ flattenIon: "Xx9+" }))).text).toMatch(/flattenIon is one of Tb3\+/);
    expect((await applied({ symmetryLaue: "7/mmm" }, grant({ symmetryLaue: "7/mmm" }))).text).toMatch(/is not a Laue class here/);
    expect(store()).toMatchObject({ pdfQMin: "0.50", pdfQMax: "7.20", flattenIon: "Fe2+", symmetryLaue: "" });
  });

  it("checks the value it approved as any value: out of range is refused with the setting's own words", async () => {
    const r = await applied({ punchSupercellL: 9 }, grant({ punchSupercellL: 9 }));
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/^Error: invalid arguments — punchSupercellL/);
    expect(store().punchSupercellL).toBe("");
  });

  it("lets a ring change the ring gate holds go ahead (Apply anyway)", async () => {
    // The app's card context: the conversation's steps, none of them a 3D verdict of a ring left.
    const card = { ...ctx, userMessage: "", replySteps: [], earlierSteps: [] };
    const held = await callTool(card, "update_settings", { changes: { ringModel: "parametric" } });
    expect(held.text).toMatch(/waits for a 3D verdict that a powder ring is left/);
    const anyway = await callTool({ ...card, grant: grant({ ringModel: "parametric" }) } as AppCallContext, "update_settings", { changes: { ringModel: "parametric" } });
    expect(anyway.ok, anyway.text).toBe(true);
    expect(store().ringModel).toBe("parametric");
  });

  it("every setting only the user sets has a checked write, and the model is told of none of them", () => {
    const tool = CHAT_TOOLS.find((t) => t.name === "update_settings")!;
    for (const u of USER_SETTINGS) {
      expect(u.fields.length, u.key).toBeGreaterThan(0);
      // update_settings' description names the symmetry average's (to refuse them), never the band's or the ion's.
      if (!u.key.startsWith("symmetry")) expect(tool.description, u.key).not.toContain(u.key);
    }
  });
});
