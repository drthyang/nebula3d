- **Fixed: the whole app scrolled past its content.** The switches' hidden
  checkboxes (absolutely positioned) had the page body as their containing
  block, so on long pages they hung below the scrolling pane and stretched the
  document: the sidebar, the page and the Pilot panel all scrolled away,
  leaving empty space. The switch, the sidebar and the main pane now contain
  their absolutely placed descendants; the app stays one screen tall and each
  pane scrolls on its own.
