- **NEBULA Pilot: Highlights.** The cleanup page now shows what each check
  measured, where it measured it. The Bragg punch check draws its leftover
  peaks by kind (at a node, sharp off the lattice, broad, protected), the
  punch holes traced from the slice and the tail sweep's voxels; the ring
  check draws each |Q| shell by code (AL, LEFT, GRID, XTAL, NJ); the coverage
  check hatches unmeasured space and marks the counts' edges and the
  transform's reach; the background correction shades its judged |Q| band. A
  "Now examining" bar above the views names the step, links to it in the
  chat and holds the legend: a chip per class with its count on the cut,
  each turning its class on or off. A Highlights switch beside Tools, Follow
  and Vision hides them. They stay until a run recomputes the stage they
  came from, and clear with Close volume. They are drawn from results
  already in memory: no extra requests, no model tokens, the same in both
  engines.
