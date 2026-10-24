// The ΔPDF window against the coverage: the limit the checks read. The coverage
// itself is measured once, in Python (nebula3d.analysis.coverage), on the raw
// volume's |Q| shells in 3D: qmax_coverage reads it through either adapter.

// The share of the ΔPDF window's weight that may lie on unmeasured reciprocal
// space: the backend's support tolerance, past which its "auto" window gives up
// the separable box for an ellipsoid tapered to the coverage.
export const OPEN_WEIGHT_OK = 1e-3;
