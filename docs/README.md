# Documentation Guide

This directory contains the deeper notes for `nebula3d`. The README at
the repository root is the quick entry point; these pages explain the algorithms,
viewers, and reproducible command recipes in more detail.

## Recommended Reading Order

1. [Repository README](../README.md) - installation and package overview.
2. [Quickstart](../QUICKSTART.md) - get the browser app running (native or
   in-browser) in a few commands.
3. [Web UI](web.md) - the browser console that runs the pipeline and unifies the
   cleanup, ΔPDF, multi-volume, and consistency views; both run modes,
   architecture, and the development workflow.
4. [Command recipes](commands.md) - concise CLI commands for batch workflows and
   viewers.
6. [Powder ring removal](algorithms/powder_rings.md) - how smooth powder-ring
   intensity is estimated and subtracted.
7. [Bragg cleanup](algorithms/bragg_cleanup.md) - integer-node Bragg punching,
   search-mode satellite punching, direct-beam handling, and backfill.
8. [3D-ΔPDF transform](algorithms/delta_pdf.md) - centred FFT recipe, the
   radial-background flatten (the default step-4 background removal), the
   alternative smooth-background subtraction, real-space viewer assumptions, and
   the back-FFT consistency check.
9. [Interactive exploration](interactive.md) - the standalone matplotlib cleanup
   QA viewers, ΔPDF viewers, and plotting primitives.

## Pages

| Page | Use it when you need to... |
| --- | --- |
| [../QUICKSTART.md](../QUICKSTART.md) | Get the app running (native or in-browser). |
| [commands.md](commands.md) | Run batch workflows and viewers from the CLI. |
| [web.md](web.md) | Launch, use, or develop the browser console (both run modes + consistency check). |
| [algorithms/powder_rings.md](algorithms/powder_rings.md) | Understand or tune powder-ring subtraction. |
| [algorithms/bragg_cleanup.md](algorithms/bragg_cleanup.md) | Tune Bragg punching, satellite search, or q-shell backfill. |
| [algorithms/delta_pdf.md](algorithms/delta_pdf.md) | Understand the FFT, centring, apodization, background subtraction, and round-trip consistency check. |
| [algorithms/inpainting.md](algorithms/inpainting.md) | Compare general inpainting fallbacks such as symmetry and TV. |
| [interactive.md](interactive.md) | Use the cleanup and ΔPDF viewers or the plotting API. |
| [../CHANGELOG.md](../CHANGELOG.md) | Review release notes and version history. |

## Output Locations

Common generated files:

| Path | Contents |
| --- | --- |
| `data/processed/*_ringremoved.h5` | Powder-ring-subtracted reciprocal-space volume. |
| `data/processed/*_braggpunched.h5` | Ring-removed volume with Bragg/satellite holes punched. |
| `data/processed/*_braggpunched_backfilled.h5` | Cleaned diffuse volume after Bragg-hole backfill. |
| `data/processed/*_backfilled_flattened.h5` | Background-removed diffuse volume (step-4 radial flatten; feeds the ΔPDF). |
| `data/processed/*_delta_pdf.h5` | Per-volume 3D-ΔPDF output. |
| `data/processed/*_delta_pdf_consistency.json` | Back-FFT consistency metrics from the library/web pipeline. |
| `data/processed/*_delta_pdf_consistency.png` | `data | back-FFT | residual` consistency figure. |
| `data/processed/*_3dpdf.h5` | Total-scattering 3D-PDF output (Bragg kept; `run_pipeline_pdf.py`). |
| `examples/_delta_pdf.h5` | Default cached 3D-ΔPDF output when `OUT_FILE` is not set. |
| `examples/_*.png` | Generated preview figures. |

Generated data and figures are intentionally ignored by Git.

### File format

Every `.h5` volume and ΔPDF above is a Mantid MDHistoWorkspace NeXus file, in
the layout Mantid Workbench's `SaveMD` writes (version 2), so `LoadMD` (the
extension does not matter) and other NeXus tools open it, and the unit cell
sits in the standard place:

```text
/MDHistoWorkspace                     NXentry, SaveMDVersion = 2
  coordinate_system                   3 = HKL (volumes), 0 = none (ΔPDF)
  data/                               NXdata
    signal          float64 (n_D2, n_D1, n_D0)   the array as stored, not transposed
    errors_squared  float64           σ² (zero for a ΔPDF)
    num_events      float64           1 = valid, 0 = masked
    mask            int8              1 = masked
    D0, D1, D2      float64 bin edges (n+1), with long_name / units / frame
  experiment0/
    logs/W_MATRIX                     column j = direction of Dj
    logs/<name>                       ΔPDF provenance as run logs (Sample Logs):
                                      q_max, apodization, source_file, transform_config, …
    sample/oriented_lattice           UB/2π (crystallographic) and the unit cell
  nebula3d/                           what Mantid does not know: exact bin centres
                                      and UB, in-memory dtype, instrument text,
                                      the punch record (punched, int8, 1 = punched)
```

A volume `(nh, nk, nl)` has D2 = `[H,0,0]`, D1 = `[0,K,0]`, D0 = `[0,0,L]`
(r.l.u., frame HKL); a ΔPDF `(na, nb, nc)` has D2 = x along a, D1 = y along b,
D0 = z along c (Å, frame General Frame). An identity UB (unknown) writes no
oriented lattice. The arrays are float64 on disk, as `LoadMD` requires; a
float32 run converts them slab by slab and records its precision, so
`nebula3d.load(path, dtype=None)` and `nebula3d.io.load_delta_pdf` give it back,
and a file NEBULA3D wrote loads back losslessly (values under the mask
included). Files written before this layout (`/entry/{data, sigma, mask, h_axis,
k_axis, l_axis, ub_matrix}` volumes, root `data`/`x_axis`/… ΔPDFs with `lat_*`
attributes) still load.

## Terminology

| Term | Meaning |
| --- | --- |
| HKL volume | A regular 3D grid in reciprocal-lattice coordinates H, K, and L. |
| UB matrix | Matrix converting HKL coordinates to Cartesian reciprocal-space Q. |
| Powder ring | Smooth azimuthal ring intensity from polycrystalline material in the beam path. |
| Bragg punch | Masking sharp Bragg or satellite peaks so they do not dominate the ΔPDF. |
| Backfill | Replacing punched voxels with a local or radial diffuse-background estimate. |
| 3D-ΔPDF | Fourier transform of cleaned diffuse scattering into real-space pair correlations. |
| Consistency check | Inverse-transforming the ΔPDF back to reciprocal space and comparing it with the diffuse input. |
