- **A run's stage files are written without compression.** Each stage output
  and the ΔPDF were gzip-compressed as they were written, which took about a
  third of a full run on a large volume (about 50 million voxels): some 8 s
  per stage, more than the flatten's own work. The native build now stores
  the two large arrays of each file (`signal`, `errors_squared`) as they are.
  - Writing a stage takes about half a second; a full run is about 30 %
    shorter, and a re-run of the last stages gains the most.
  - Opening a stage in the viewers is about ten times faster.
  - The files are larger: 8 bytes per voxel for each of the two arrays. How
    much larger than before depends on how well the data compressed (the
    synthetic demo's are 2.3 times larger).
  - They are the same Mantid MDHistoWorkspace files otherwise: same layout,
    chunks, types, attributes and stage records, and the same values bit for
    bit. The small arrays (`num_events`, `mask`, the punch record) stay
    compressed.
  - Outputs an earlier version wrote with gzip are read and reused as they
    are.
  - Unchanged: the in-browser build (its files live in the tab's memory), the
    ΔPDF the Consistency page saves or downloads, and `nebula3d.save` /
    `save_delta_pdf` in a script, which compress by default and take
    `compression=None` for the faster file.
