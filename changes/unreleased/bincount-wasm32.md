- **Fixed: `qmax_coverage` and other counts failed in the browser.** In the
  browser's 32-bit Python, `np.bincount` refuses int64 indices ("Cannot cast
  array data from dtype('int64') to dtype('int32')"). Every count in the
  package now goes through `nebula3d.utils.counting.bincount`, which casts the
  indices first; a test keeps raw `np.bincount` calls out.
