- **The Configure page, reorganized: the preview on top, in tabs, zoomed like
  every other slice view.** The punch preview moves from the bottom of the
  page to a card of its own under *Data*, and its three slices fold into one
  view with tabs for a\*–b\*, a\*–c\* and b\*–c\* (arrow keys move between
  them; the browser remembers the tab). It is now a slice view like those of
  the viewer pages: Ctrl/⌘ + wheel or a pinch zooms, a Shift, middle or
  two-finger drag pans, a double-click (or *Reset zoom*, or 0) returns to the
  full view, *Box zoom* and the gesture card are in its header, *Unit cell*
  draws the lines of integer h, k, l, and hovering reads (H, K, L) and the
  intensity. Each plane keeps its own zoom, and the punch footprints, the
  direct beam and the |Q| band stay on the data at any zoom. The *Preview
  zoom* and *Contrast* sliders give way to the shared display bar (colormap ·
  vmin [bar] vmax · asinh / lin / log · Auto · Brightness); the three planes
  share one scale, with Auto from their cuts through the origin. The
  powder-ring schematic and its equations are gone.
- **One section per stage, with the same head and the advanced settings
  folded away.** The stages run top to bottom in pipeline order (ring
  removal, Bragg punch, backfill, background correction, 3D-ΔPDF), each
  headed by its number, the Execution stepper's name for it, one plain line
  saying what it does, the details behind **?**, and *Enable stage*. Each
  stage's less-used settings sit under *Advanced*, closed at first and
  remembered by the browser; closed, it says how many of them differ from
  their defaults, so a change made there by NEBULA Pilot or a restored
  session is not missed. The punch's settings are four boxes: *Detection*,
  *Sample* (the punch cell and the modulation), *Bragg footprint* and
  *Direct beam*. The |Q| band, a 3D-ΔPDF setting, moves into the 3D-ΔPDF
  section. No setting, default or value changes, and NEBULA Pilot reads and
  changes the same settings as before.
