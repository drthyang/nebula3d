// Whether a run's failure is a "data error": a known Python exception that
// says, in its own words, what about the data or the settings stopped the run
// and what to change. The console shows that message as plain text, with the
// traceback behind "Details" (the Execution page's failure banner), and no
// run-it-locally card: the local version would stop the same way.
//
// The other classes of failure: the in-browser engine's limit
// (browserLimit.ts, which leaves these alone), and anything else, shown as
// it always was. A run's error text reaches NEBULA Pilot unchanged; only the
// page reads it differently.
//
// A new data error is one more entry in DATA_ERRORS, with its message in the
// tests (api/__tests__/browserLimit.test.ts, "data errors").

export interface DataErrorKind {
  name: string; // the exception's class name
  where: string; // the module that raises it
}

export const DATA_ERRORS: readonly DataErrorKind[] = [
  // The coverage gaps reach Q = 0: no room for the 3D-ΔPDF's window
  // (WINDOW_SUPPORT_MESSAGE; the page offers "Symmetrize here").
  { name: "WindowSupportError", where: "nebula3d.analysis.delta_pdf" },
  // The grid's Q = 0 is not on the transform's origin voxel (check_fft_origin).
  { name: "FFTOriginError", where: "nebula3d.analysis.delta_pdf" },
  // The symmetry average cannot run as asked (no Laue class, operations that
  // do not map the grid onto itself, …).
  { name: "SymmetryAverageError", where: "nebula3d.pipeline" },
];

export interface DataError {
  name: string; // the exception's class name
  message: string; // its own words, without the class name or the traceback
  detail: string; // the whole error as it came (a traceback in the browser)
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// An exception line, unindented: the class name, bare (the local version's
// "Name: message") or module-qualified (a traceback's last line).
const LINE = new RegExp(`^(?:[A-Za-z_][\\w]*\\.)*(${DATA_ERRORS.map((e) => escape(e.name)).join("|")}): ?(.*)$`);

/**
 * The data error *text* ends on (an Error's message, a logged line), or null.
 * Only the last exception counts: a data error that caused another failure is
 * that failure's.
 */
export function parseDataError(text: string | null | undefined): DataError | null {
  if (!text || !text.trim()) return null;
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = LINE.exec(lines[i]);
    if (!m) continue;
    const rest = lines.slice(i + 1);
    // Another traceback after it: the run ended on a later exception.
    if (rest.some((line) => /Traceback \(most recent call last\):/.test(line))) return null;
    const message = [m[2], ...rest].join("\n").trim();
    return message ? { name: m[1], message, detail: text } : null;
  }
  return null;
}
