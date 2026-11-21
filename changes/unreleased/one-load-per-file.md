- **Fix: simultaneous requests for one volume each read the whole file
  (native build).** A check, or the page after a run, asks for several planes
  of every stage at once. Each request that found the server's cache cold
  started its own read of the file, so one stage check read the same five
  volumes several times over, all held in memory at once, and it happened
  again after every run and trial (a rewritten file is a new cache entry).
  Requests that arrive while a file is being read now wait for that read and
  share its volume (`nebula3d.server.singleflight`). The same holds wherever
  the server keeps an answer per volume: the ΔPDF and its noise level, the
  consistency view's round trip, the coverage, the UB check, the ring
  isotropy, the ring survey, the shell floors, the fill texture, the Bragg
  sensing and the Laue comparison (each waiting request still hears its
  progress). An error reaches every request that waited and is not kept, so
  the next one tries again; a file that changed is read again; the caches
  keep what they kept, for as long. No value changes: on a large volume
  (about 50 million voxels) every check returns what it returned, with one
  read per file and a lower memory peak in the server.
