import { describe, expect, it } from "vitest";

import { applyOp, closeGroup, parseSymop, splitSymops, symmetryGroup } from "../symops";

describe("parseSymop", () => {
  it("reads rotations and fractional translations", () => {
    const op = parseSymop("-x+1/2, y, z+1/2");
    expect(op.rot).toEqual([-1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(op.trans).toEqual([0.5, 0, 0.5]);
  });

  it("reads mixed terms, leading constants and decimals", () => {
    const op = parseSymop("x-y, 1/2+x, -z+0.25");
    expect(op.rot).toEqual([1, -1, 0, 1, 0, 0, 0, 0, -1]);
    expect(op.trans).toEqual([0, 0.5, 0.25]);
  });

  it("wraps negative translations into [0, 1)", () => {
    expect(parseSymop("x-1/4, y, z").trans[0]).toBeCloseTo(0.75, 12);
  });

  it("rejects malformed and non-lattice operations", () => {
    expect(() => parseSymop("x, y")).toThrow(/three components/);
    expect(() => parseSymop("x, y, q")).toThrow(/cannot read/);
    expect(() => parseSymop("x, x, z")).toThrow(/not a lattice symmetry/);
  });
});

describe("splitSymops", () => {
  it("splits lines and semicolons and strips indices and quotes", () => {
    expect(splitSymops("1 x,y,z\n(2) -x,-y,z; 'x,-y,-z'\n3: -x,y,-z\n\n")).toEqual([
      "x,y,z",
      "-x,-y,z",
      "x,-y,-z",
      "-x,y,-z",
    ]);
  });

  it("keeps a leading fraction", () => {
    expect(splitSymops("1/2+x, y, z")).toEqual(["1/2+x, y, z"]);
  });
});

describe("closeGroup", () => {
  it("generates point group 222 from two of its 2-folds", () => {
    expect(symmetryGroup("-x,-y,z\nx,-y,-z")).toHaveLength(4);
  });

  it("adds the centring translations", () => {
    expect(symmetryGroup("-x,-y,z\nx,-y,-z", "C")).toHaveLength(8);
    expect(symmetryGroup("", "F")).toHaveLength(4);
  });

  it("generates Fm-3m (order 192) from its generators", () => {
    const g = symmetryGroup("-x,-y,z; -x,y,-z; z,x,y; y,x,-z; -x,-y,-z", "F");
    expect(g).toHaveLength(192);
  });

  it("is idempotent on a full list", () => {
    const g = symmetryGroup("-x,-y,z\nx,-y,-z\n-x,y,-z\nx,y,z");
    expect(g).toHaveLength(4);
  });

  it("keeps screw-axis translations", () => {
    const g = symmetryGroup("-x,-y,z+1/2");
    expect(g).toHaveLength(2);
    expect(applyOp(g[1], [0.1, 0.2, 0.3])).toEqual([-0.1, -0.2, 0.8]);
  });

  it("refuses operations that generate no finite group", () => {
    expect(() => closeGroup([parseSymop("x+y, y, z")])).toThrow(/more than 192/);
  });
});
