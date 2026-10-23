- **Slice views zoom and pan like a map.** The scroll wheel and a two-finger
  scroll now zoom about the pointer in every view and click mode (before, only
  a pinch or Ctrl+wheel did, and a plain wheel did nothing); a middle-button
  drag or Shift+drag pans in any mode; double-click and *Reset zoom* return to
  the full view as before. Wheel steps are read in pixels whatever the browser
  reports, so one notch zooms by 2 in Chrome and in Firefox alike (Ctrl+wheel
  zoomed 2.7× per notch in one and 3 % in the other), and a pinch zooms as
  smoothly as it did. **Fixed:** on the 3D-ΔPDF page the first zoom step jumped
  (±40 to ±26 Å on a small ΔPDF): the page opens wider than its zoom limit
  allowed; the limit now includes the opening view, as on the Q–R page.
