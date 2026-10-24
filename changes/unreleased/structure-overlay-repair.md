- **Fixed: the structure overlay lost or invented atoms for common CIFs.** A
  CIF of an F-, I-, C- or R-centred group that lists only generators (no
  centring translations) gave a quarter of the atoms without a word (Fm-3m rock
  salt: 2 atoms per cell, 48 operations); the centring is now taken from the
  space-group symbol and added, with a note when the listed operations lacked
  it (R only on hexagonal axes). A special position written to 3 decimals
  (hcp Mg at 0.333, 0.667) was tripled, with false vectors 0.003 Å long; images
  of a site closer than 0.05 Å are now one atom. Screw axes written as decimals
  (`z+0.3333`, `z+0.1667`) no longer fail as "more than 192 operations".
  All-capitals type symbols (`NA`, `CL`, `CO`) now give Na, Cl, Co, not N, C;
  CIF coordinates written as fractions (`1/2`) are read, not skipped; the
  panel's own example `−x+1/2` (typeset minus) is accepted, and site cells take
  a value with its uncertainty (`0.5(2)`).
- **Fixed: text being typed in the site table moved to another site.** An
  unreadable entry stayed on its row number, so removing a row above it or
  loading another CIF showed it on a different site, and the next edit went
  there; it now stays with its site and is cleared by a new structure.
- **Fixed: a large or mismatched CIF froze the page.** A 1080-atom supercell
  blocked the page for 3–5 s on loading and on every reopening, though its
  cell did not match the ΔPDF's and nothing was drawn. The pairs are now built
  only when they can be drawn, faster, and only up to 500 atoms per cell (and
  0.3 atoms/Å³, past any crystal); beyond that the overlay says why nothing
  is drawn, and the site table shows the first 100 sites until "Show all".
  The Q–R page now says why nothing is drawn too, as the 3D-ΔPDF page does.
