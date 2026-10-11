// Committed eval records name no sample: a sample written as a formula becomes
// a neutral label wherever it appears.  (The formulas here are made up.)

import { describe, expect, it } from "vitest";

import { sampleScrubber } from "./scrub";

const datasets = [
  { id: "EfGh4-45K-0-k-l-401x401x301-mmm" },
  { id: "Ab2Cd3-90K-all-hex-401x401x401-sub-bkg" },
  { id: "Ab2Cd3-90K-all-hex-401x401x401-sub-bkg-sym6mmm" },
  { id: "hexdemo-90K-sym6mmm" },
  { id: "demo" },
];

describe("sampleScrubber", () => {
  const scrub = sampleScrubber(datasets);

  it("replaces each formula by a label, in ids, file names and prose, in any case", () => {
    expect(scrub("Ab2Cd3-90K-all-hex-401x401x401-sub-bkg")).toBe("sampleA-90K-all-hex-401x401x401-sub-bkg");
    expect(scrub('{"symmetry_from":"Ab2Cd3_90K_all_hex.nxs"}')).toBe('{"symmetry_from":"sampleA_90K_all_hex.nxs"}');
    expect(scrub("the ab2cd3 volume and the EFGH4 one")).toBe("the sampleA volume and the sampleB one");
  });

  it("leaves names that are not formulas, and text without samples, as they are", () => {
    expect(scrub("hexdemo-90K-sym6mmm on the demo data")).toBe("hexdemo-90K-sym6mmm on the demo data");
    expect(sampleScrubber([{ id: "demo" }])("Ab2Cd3")).toBe("Ab2Cd3");
    expect(scrub("xAb2Cd3 and Ab2Cd3y")).toBe("xAb2Cd3 and Ab2Cd3y");
  });
});
