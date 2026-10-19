- **The flatten's shell floors, over the whole volume.** The flatten fits its
  pedestal to the floor of each |Q| shell (the 25th percentile of the shell's
  measured voxels, 0.05 Å⁻¹ shells), and the floors after it say whether a
  pedestal was left: a rising one is most often the inelastic background,
  which the Q² term takes. The Pilot reads them on three planes through the
  origin. `nebula3d.preprocessing.shell_floors` measures them over every voxel
  of each shell, on the flatten's own shells (on its input they are its own
  levels, value for value), with each shell's measured and total voxels, its
  median, and for the flattened stage the input's floors on the same shells
  and the diffuse level the pedestal's span is a share of (server:
  `GET /api/volumes/{id}/shell-floors`; browser:
  `webbridge.volume_shell_floors_json`, with the same fields). The flatten
  now records its settings in its output (`read_flatten_settings`), and the
  measurement takes them unless asked otherwise, so a run is measured on its
  own shells and percentile; they come back with its fit range. It reads the
  volumes a slab at a time and selects each percentile from histograms
  narrowed pass by pass: 29 MiB at its peak on a 401×401×301 float32 volume
  and its input in the browser's low-memory mode, 74 MiB natively, in 3 s,
  the same numbers in both. On a synthetic isotropic Q² pedestal the planes and the
  volume read the same pedestal; with the pedestal kept off those planes,
  only the volume sees it. Measurement only: the Pilot's verdict does not
  read it yet.
