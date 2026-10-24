- **Slice views zoom and pan like an embedded map.** When the page can scroll,
  a plain wheel or two-finger scroll over a view scrolls the page and the view
  briefly says *Use Ctrl + scroll to zoom* (*⌘ + scroll* on macOS);
  Ctrl/⌘ + wheel or a trackpad pinch zooms about the pointer (Safari's pinch
  gestures included). When the views fill the window and the page cannot
  scroll, a plain wheel zooms. A middle-button drag or Shift+drag pans in any
  mode, and the view's centre now stays on the data, so a slice can no longer
  be dragged off screen. A double-click zooms in 2× at the pointer
  (Alt+double-click out); Shift+double-click, the header's *Reset zoom* or the
  0 key returns to the full view. New + / − buttons in each view, and on a
  focused view + / −, the arrow keys and 0. Wheel steps are read in pixels
  whatever the browser reports, so one notch zooms by 2 in Chrome and in
  Firefox alike (Ctrl+wheel zoomed 2.7× per notch in one and 3 % in the
  other), and a pinch zooms as smoothly as it did. **Fixed:** on the 3D-ΔPDF
  page the first zoom step jumped (±40 to ±26 Å on a small ΔPDF): the page
  opens wider than its zoom limit allowed; the limit now includes the opening
  view, as on the Q–R page.
