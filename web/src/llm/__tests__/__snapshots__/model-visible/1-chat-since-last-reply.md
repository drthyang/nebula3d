# Opening messages after a decision: the "since the last reply" line

`buildChatMessages(context, history, question, null, { tools: true, since })`: the request after the user applied, edited, dismissed or undid an Apply card ends its context with one line (apply/since.ts), in that reply only. The same in arm C and with tools off (after the cut's metrics). The sample: three decisions (sinceSamples.ts, the token budget's case); then how the line words each kind of decision.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

### 1. user

```text
Context: the dataset as this request found it. Nothing here is measured: the tools measure.
- dataset: synthetic_a
- cell: a = 4, b = 4, c = 4 Å; α = 90, β = 90, γ = 90°
- reciprocal grid: 97 × 97 × 97 voxels, H -3 to 3, K -3 to 3, L -3 to 3 r.l.u.
- raw volume: symmetrised with mmm
- on disk: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf
- since the last reply, you applied punchMinSig 5 → 6; declined modulation default → k = (0, 1/3, 0), order 1, points, ± 0.08 r.l.u. (kept default); ran the pipeline from punch
```

## Each kind of decision

- Apply: `- since the last reply, you applied punchMinSig 5 → 6`
- Edit and apply: `- since the last reply, you applied ringPooledSectors 72 → 48 (edited from the proposed 32)`
- Dismiss: `- since the last reply, you declined ringPooledSectors 72 → 32 (kept 72)`
- Undo: `- since the last reply, you undid punchMinSig 6 → 5`
- Apply on a sample fact (the user's click): `- since the last reply, you applied modulation default → k = (0, 1/3, 0), order 1, points, ± 0.08 r.l.u.`
- Dismiss a sample fact: `- since the last reply, you declined modulation default → k = (0, 1/3, 0), order 1, points, ± 0.08 r.l.u. (kept default)`
- Run: `- since the last reply, you ran the pipeline from punch`
- Dismiss a Run card: `- since the last reply, you declined the run from rings`
- Apply a tuning trial: `- since the last reply, you applied punch trial #3: punchMinSig 5 → 6, punchSupercellH 1 → 2`
- Dismiss a tuning trial: `- since the last reply, you declined punch trial #3 (punchMinSig=6, punchSupercellH=2)`
- A change auto mode made (THY-65 PR 6): `- since the last reply, auto mode applied punchMinSig 5 → 6`
