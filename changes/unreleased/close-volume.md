- **New: Close volume.** A button beside Save session and Restore session
  unloads the volume and returns the console to the state it starts in, ready
  to load another: the run and its log, the slice views and their caches, the
  marked regions, the structure overlay and the NEBULA Pilot conversation all
  go. It asks first when a run is going (cancelled cleanly before the reset)
  or the session has not been saved. The memory goes back too: the
  in-browser engine starts a fresh worker (its heap never shrinks otherwise),
  and the native server lets go of the volumes it caches for the views
  (`POST /api/release`). No file is deleted. Every store says, beside its own
  definition, how Close treats it, and a test fails on one that does not.
