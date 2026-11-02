# Mockups: Apply cards, auto mode and highlights

These mockups go with [the design](../../pilot-auto-mode-design.md) (Linear
THY-65 and THY-66). They are static pages for review: nothing is wired, and
every number on them is made up.

The base is a snapshot of the console on the **built-in synthetic demo**
(`synthetic_rocksalt`), taken on 2026-11-02 from the hosted Pyodide build:
*Use demo*, *Run pipeline*, then the Reciprocal cleanup page with NEBULA Pilot
open. Its canvases were saved as `img/slice-*.png` and its scripts removed. The
page loads the console's own `web/src/index.css`, and `mockup.css` and
`mockup.js` draw the proposed UI over it. The demo shows the 0kl plane, so the
sample-fact example is the supercell along L.

Open `desktop.html` or `phone.html` (the phone layout is meant for 390 px) with
one of these scenes after the `#`:

| Scene | Shows |
| --- | --- |
| `#cards` | a reply with Apply cards: two sample facts with their evidence, a setting already applied (Undo), the Run card it led to, and the Changes list |
| `#auto` | auto mode running: the plan, progress, the clock, Stop, seeded steps tagged *auto*, a tuning run, and the views lit by the punch check |
| `#paused` | auto mode paused at a sample fact: the plan row that needs you, the pinned card, and the evidence behind it lit on the views |
| `#bragg` | highlights during the Bragg punch check: nodes, leftovers by kind, punch holes and round-2 voxels, with the legend in the Now examining bar |
| `#rings` | highlights during the ring check: shells by verdict code (AL, LEFT, GRID, XTAL, NJ) on the raw and ring-removed views |

To take the screenshots again (1440×900 and 390×844, at 2×):

```bash
node docs/mockups/pilot-auto-mode/shots.cjs <path to playwright-core> \
  "$PWD/docs/mockups/pilot-auto-mode" <output folder>
```

© 2026 Tsung-Han Yang
