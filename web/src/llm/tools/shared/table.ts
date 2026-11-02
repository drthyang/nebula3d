// A column table: a bulk list in a tool's result as its column names once and
// a row of values per entry, `{"cols": [...], "rows": [[...], ...]}`
// (docs/pilot-context-design.md §5.5, THY-63 R1). The same numbers as a list
// of objects, without each entry's keys: radial_profile's shells, bragg_peaks'
// peaks, run_log's lines. A list an answer cites entry by entry (dpdf_peaks'
// features, the rings' residuals) stays a list of objects.
//
// References reach a row's value by its column's name or its index
// (references.ts, valueAt: {{radial_profile.shells.3.flattened}}), and the
// context guard counts a table's rows at their own, denser rate
// (provider/tokens.ts, TABLE_CHARS_PER_TOKEN).

export interface Table {
  cols: string[];
  rows: unknown[][];
}

/** `entries` as a table: the columns given, in order, else every key the entries hold, in the order first met; a missing value is null. */
export function columnTable(entries: readonly Record<string, unknown>[], cols?: readonly string[]): Table {
  const names = cols ? [...cols] : [...new Set(entries.flatMap((e) => Object.keys(e)))];
  return { cols: names, rows: entries.map((e) => names.map((c) => (e[c] === undefined ? null : e[c]))) };
}

/** Whether a value is a column table. */
export const isTable = (v: unknown): v is Table =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Array.isArray((v as Table).cols) &&
  Array.isArray((v as Table).rows) &&
  (v as Table).cols.every((c) => typeof c === "string") &&
  (v as Table).rows.every((r) => Array.isArray(r));

/** A table's rows as objects, keyed by its columns: the list it was made from (tests, and readers of a result). */
export const tableRows = (t: Table): Record<string, unknown>[] => t.rows.map((r) => Object.fromEntries(t.cols.map((c, i) => [c, r[i]])));
