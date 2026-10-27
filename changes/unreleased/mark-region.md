- **NEBULA Pilot marks what it found in the slice views (`mark_region`).**
  When the Pilot finds something you should look at, such as satellites at
  h ± q, a ring left over or a ΔPDF feature, it marks the region: a box, an
  ellipsoid or a few points, on the stage it was found in (raw or a cleanup
  stage, in r.l.u., or the 3D-ΔPDF, in Å), with a short label. A mark must
  cite the measurements that show it (calls of measuring tools in the
  conversation, not stale after a rerun), and a region outside the volume or
  empty is refused with why. The console moves to it and draws it on every
  view it crosses, in a colour the colormap lacks, with a label chip; it
  follows zoom and pan, oblique sections included. The tool's result says
  which views and cuts it was drawn on, so the answer names only a mark it
  made (M1, …). The Pilot panel lists the marks: click one to go back to it,
  hide or remove one, or hide or clear them all. Marks survive a reload and
  are saved in session files.
