- **A clear message when the coverage gaps reach Q = 0.** The 3D-ΔPDF used to
  stop with "the support leaves no region around Q = 0 for the window". It now
  says what happened (unmeasured voxels open to the box edge reach the origin,
  typically an unsymmetrized volume) and what to do: symmetrize or fill the
  volume, or turn off *Taper to the measured coverage* (3D-ΔPDF stage,
  Advanced). The error is a `WindowSupportError`, still a `ValueError`.
