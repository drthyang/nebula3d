- **Fixed: the structure overlay's site table took no fractions.** Typing a
  coordinate as `1/3`, `2/3` or `-1/4` (the notation the symmetry operations
  take) was discarded without a word: the cell went back to its old value. A
  site's x, y, z now take a decimal or a signed fraction, and text that cannot
  be read (`0,5`) stays in the cell, outlined, saying how to write it, until it
  is corrected or Esc brings back the value.
