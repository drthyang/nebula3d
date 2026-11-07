# Opening messages after Summarize and continue

`buildChatMessages(context, history, question, null, { tools: true, earlier })`: once the user pressed Summarize and continue (the context meter, THY-74), every request ends its context with the app's summary of the turns up to then (summarize.ts), and sends only the later turns as their text. No model writes it: the questions, the checks each reply ran, the app's computed verdict then, and the decisions on the Apply cards a reply's context listed. No number a tool measured or the model wrote. The sample: four questions (summarySamples.ts), one reply stopped before it answered, the token budget's three decisions; then two later turns.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

### 1. user

```text
Context: the dataset as this request found it. Nothing here is measured: the tools measure.
- dataset: synthetic_a
- cell: a = 4, b = 4, c = 4 Å; α = 90, β = 90, γ = 90°
- reciprocal grid: 97 × 97 × 97 voxels, H -3 to 3, K -3 to 3, L -3 to 3 r.l.u.
- raw volume: symmetrised with mmm
- on disk: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf
Earlier in this conversation: 8 turns the app summarized in their place (Summarize and continue). For each question, the checks its reply ran and the app's verdict then; their answers are not repeated. It holds no measured number, and the outputs may have changed since: call the tools again before you quote a result.
- asked "How clean is the ring removal?"; checks run: read_skill ring-removal, assess_stage rings, radial_profile rings
- asked "Assess the whole run, and check the Bragg punch at L = 0.5 too."; checks run: assess_stage punch, measure_reciprocal_cut; the app's verdict then: not met, needs attention: the Bragg punch
- asked "Raise the punch threshold and run from the punch."; no checks run; no answer
- asked "Is it met now?"; checks run: assess_stage punch; the app's verdict then: met
- on the Apply cards, you applied punchMinSig 5 → 6; kept modulation default, declined k = (0, 1/3, 0), order 1, points, ± 0.08 r.l.u.; ran the pipeline from punch
```
