- **The fills' texture, on every punch hole in 3-D.** Fills systematically
  brighter (or darker) than the diffuse around their holes print a texture
  with the lattice's period, which the 3D-ΔPDF turns into features at the
  lattice vectors. The Pilot's `texture_check` judges each filled hole
  against the range its measured rim allows, on three cuts, where a hole
  crossed at its edge reads differently from one crossed at its centre and
  peaks off those planes are seen at their edges or not at all.
  `nebula3d.analysis.fill_texture` applies the same rule to every hole of
  the volume, the hole and its rim taken in 3-D: the holes from the punch's
  record (`nebula3d.pipeline.read_punch_record`), the rim the voxels 1 to 4
  out that the fill left as they were, the Pilot's trend, range, bias and
  limits (kept as parameters). It returns each hole's facts, the Pilot's
  summary and the shares of holes beyond the floor each way (server:
  `GET /api/volumes/{id}/texture` on a backfilled stage; browser:
  `webbridge.volume_texture_json`, with the same fields). On synthetic
  lattices a fill equal to the truth reads no bias, half the level too high
  in 80 % of the holes a systematic bias with 0.800 of them above, and the
  backfill's Laplace fill none; with satellites beside the nodes, all filled
  12 % high, the volume reads nodes and satellites alike, while the per-cut
  rule reads the satellites it crosses at their poles under the floor. It
  labels the holes a slab at a time: 7.4 MiB at its peak on a 401×401×301
  float32 pair with 6000 holes in the browser's low-memory mode, 23 MiB
  natively, in 1.4 s, the same numbers in both. Measurement only: the
  Pilot's verdict does not read it yet.
