- **NEBULA Pilot: `dpdf_peaks` says how its entries are grouped, and gives an
  orbit its multiplicity and its copies' mean size.** The backend groups the
  3D-ΔPDF's extrema by the point group the dataset's raw file declares, else
  by sign, length and size (`nebula3d.analysis.dpdf_features`, plan 4.4). The
  tool now passes that on: `grouped_by` names the rule (`"declared symmetry
  (m-3m: 48 operations, r ≡ −r)"`, `"sign, length and size (no symmetry
  declared)"`, or why a declared symmetry was not applied), and an entry
  grouped by the declared symmetry gives its copies' mean size
  (`mean_size_sigma`) beside the largest, and the orbit's distinct vectors,
  one per ± pair (`multiplicity`), beside the vectors found (`n_vectors`).
  Grouped by sign, length and size there is no orbit, and every size is
  within 5 % of the largest, so an entry gives neither and reads as it did:
  on the validation's dev cases, which declare no symmetry, the result grows
  only by `grouped_by`. The default limit (12 entries) and the tool's
  description are unchanged.
