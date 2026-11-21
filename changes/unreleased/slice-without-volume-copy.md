- **A slice no longer copies its volume.** `extract_slice` built a NaN-masked
  copy of the whole volume to cut one plane from it, so a check's fifteen
  planes of a large volume (about 50 million voxels) made fifteen such copies
  at once in the server. It now copies and masks the plane alone; the slice is
  the same, bit for bit, nearest or interpolated. The labels of a slice
  (`GET /api/modulation/{id}/labels`) read the punch's record, tens of MB on
  such a volume, once per version of its file instead of once per plane.
