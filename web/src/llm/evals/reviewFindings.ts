// The review's findings and decisions (docs/evals/validation/review-findings/),
// one JSON file per entry so that pull requests adding entries never collide.
// The entries recorded before the split keep their order through a number
// (001-…json); a later entry is named after its ref (P4.12c.json) and sorts
// after them. Read in the test process only.

import type { Finding } from "./findings";

/** The folder that holds one file per finding. */
export const REVIEW_FINDINGS_DIR = new URL("../../../../docs/evals/validation/review-findings/", import.meta.url);

/** A finding's file name: its number before the split, else its ref. */
export const NUMBERED = /^(\d{3})-[A-Za-z0-9.-]+\.json$/;
export const BY_REF = /^([A-Za-z][A-Za-z0-9.-]*)\.json$/;

/** The JSON files of the folder, in the record's order (numbered first, then by ref). */
export async function reviewFindingFiles(): Promise<string[]> {
  const { listDir } = await import("./backend");
  return (await listDir(REVIEW_FINDINGS_DIR)).filter((n) => n.endsWith(".json")).sort();
}

/** Every finding, in the record's order. */
export async function loadReviewFindings(): Promise<Finding[]> {
  const { readText } = await import("./backend");
  const out: Finding[] = [];
  for (const name of await reviewFindingFiles()) {
    out.push(JSON.parse(await readText(new URL(name, REVIEW_FINDINGS_DIR))) as Finding);
  }
  return out;
}
