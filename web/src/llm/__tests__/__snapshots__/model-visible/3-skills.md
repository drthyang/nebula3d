# The skills' listing

`skillsPrompt()` (skills.ts): appended to the system prompt with tools on (arm B; arm C goes without it). read_skill's `name` takes the same names.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

```text

Skills are the user's methods, one per topic. Before you act on a topic, read its skill
with read_skill: it gives the steps, the checks and what to report. A stage's settings
change, and the stage is tuned, only after its skill has been read in this conversation.
- bragg-node-audit: Audit the Bragg nodes of a reduced volume: are the allowed peaks punched cleanly, is there intensity at forbidden nodes or satellites, and are the peaks off the lattice a second grain, a UB slightly off, or spurious? Use it when asked whether the punch is clean, whether the volume shows superlattice peaks, satellites, a lower symmetry, λ/2 or multiple scattering, and before changing or tuning the punch or the backfill. NOT for the broad diffuse maxima, which are the signal and stay.
- delta-pdf-interpretation: Read a 3D-ΔPDF: what a positive or negative feature at an interatomic vector means, the symmetry it must keep, and the artifacts that imitate signal (Bragg residue, termination ripple, a window past the data, smooth background near the origin). Use it when asked what the ΔPDF shows, whether a feature is real, or how to describe a ΔPDF figure, and before changing or tuning the ΔPDF's settings.
- reduction-qc: Check that a reduction can be trusted before reading physics from it: the UB, the symmetrisation, the raw counts' |Q| edges and the coverage, edge and unmeasured voxels, the powder rings and the background-correction floor. Use it when asked whether a run is sound or ready for the 3D-ΔPDF, and before changing or tuning the ring removal or the background correction. NOT for reading ΔPDF features (delta-pdf-interpretation) or auditing the Bragg nodes (bragg-node-audit).
```

read_skill's names: bragg-node-audit, delta-pdf-interpretation, reduction-qc.
