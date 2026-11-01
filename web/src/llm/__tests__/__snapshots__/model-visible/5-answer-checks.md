# Answer checks

`answerIssues` and `issuesPrompt` (answerChecks.ts) on canned replies: what the agent loop sends back, once, before a failing answer reaches the user. Each reply's number sources here are its tools' results, and an earlier turn's while what each measured stands (`earlierSources`).

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## an answer that stands on its evidence

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_left}} of the diffuse there.
```

Sent back to the model:

Nothing: the answer goes to the user, its references filled in.

## a number from nowhere

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.4 Å⁻¹, 0.27 of the diffuse there.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- These numbers appear in no tool result or the context: 3.4, 0.27. Quote the tools' numbers, or leave them out.
Then write the whole answer again.
```

## a reference that names nothing

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_residual}} of the diffuse there.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- These references name no value in this reply's tool results: {{assess_stage.rings.max_ring_residual}}. Write a reference as {{tool.field}}, the path of a field in a result above as the tool returned it (e.g. {{assess_stage.flatten.verdict}}), or quote the number itself.
Then write the whole answer again.
```

## a verdict without its tool

Tools run in the reply: qmax_coverage {}.

The answer:

```text
The flatten left no pedestal, and the window stays inside the coverage.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- It gives a verdict on the flatten without its evidence in this reply: call assess_stage with stage flatten, and answer from its result.
Then write the whole answer again.
```

## a verdict from before the last run

Tools run in the reply: assess_stage {"stage":"rings"}, run_pipeline {"from_stage":"rings"}.

The answer:

```text
The ring removal needs attention: a ring is left at 3.2 Å⁻¹.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- It gives a verdict on the ring removal from a measurement taken before the last run recomputed it: call assess_stage with stage rings again on the new outputs, and answer from that.
Then write the whole answer again.
```

## a verdict the tool contradicts, and a success the checks do not give

Tools run in the reply: assess_stage {"stage":"rings"}.

The answer:

```text
The ring removal is clean, so the 3D-ΔPDF is ready for analysis.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- It gives a verdict on the 3D-ΔPDF without its evidence in this reply: call assess_stage with stage pdf, and answer from its result.
- It calls the run a success, but the verdict computed from the checks is "not met: needs attention: the ring removal". That verdict is the checks', not yours: quote it as {{achieved}} and explain what it rests on.
- What it says about the ring removal contradicts the verdict the tool computed: quote that verdict and its numbers.
Then write the whole answer again.
```

## numbers from an earlier turn's result, measured before a later run

Tools run in an earlier turn: assess_stage {"stage":"rings"}.

Tools run in the reply: run_pipeline {"from_stage":"rings"}.

The answer:

```text
The worst ring sat at 3.2 Å⁻¹, at 0.12 of the diffuse.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- These numbers were measured before the last run recomputed the outputs they describe: 3.2, 0.12. Quote numbers measured since, or leave them out.
Then write the whole answer again.
```

## a mark no call made

Tools run in the reply: mark_region {"where":"flatten","shape":"ellipsoid","label":"diffuse maximum","evidence":["measure_reciprocal_cut"]}.

The answer:

```text
The diffuse maximum is marked as M1, and its partners as M2.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- This mark id names no mark that mark_region made in this conversation: M2. Cite a mark only by the id its call returned ("marked" in the result); to show a region not yet marked, call mark_region first.
Then write the whole answer again.
```

## a mark an earlier turn made, and one this reply made

Tools run in an earlier turn: mark_region {"where":"flatten","shape":"ellipsoid","label":"diffuse maximum","evidence":["measure_reciprocal_cut"]}.

Tools run in the reply: mark_region {"where":"flatten","shape":"ellipsoid","label":"its partners","evidence":["measure_reciprocal_cut"]}.

The answer:

```text
M2 marks the partners of the diffuse maximum, which M1 marks.
```

Sent back to the model:

Nothing: the answer goes to the user, its references filled in.

## a list of results credited to a tool that did not run, called illustrative

Tools run in the reply: assess_stage {"stage":"pdf"}, assess_stage {"stage":"rings"}.

The answer:

```text
The strongest features: Feature 1: Δr ≈ 2.6 Å, SNR ≈ 1380 (from dpdf_peaks via assess_stage pdf). The values are illustrative of the reported SNR.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- It gives a verdict on the 3D-ΔPDF's pair correlations without its evidence in this reply: call dpdf_peaks, and answer from its result.
- “The strongest features: Feature 1: Δr ≈ 2.6 Å, SNR ≈ 1380 (from dpdf_peaks via assess_stage pdf).”: this credits numbers to dpdf_peaks, which did not run in this reply, so it returned none of them. Call it and answer from the result, or leave those numbers out.
- These numbers appear in no tool result or the context: 2.6. Quote the tools' numbers, or leave them out.
Then write the whole answer again.
```

## a question a result puts to the user, not asked, and its answer said as fact

Tools run in the reply: assess_stage {"stage":"punch"}.

The answer:

```text
The punch meets its goal. The 14 sharp peaks at H = n ± 1/3 are satellites of a modulation with k = (1/3, 0, 0).
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- A result in this reply has a question for the user (ask_user) that the answer does not ask: "14 of the 17 sharp peaks off the lattice sit at H = n ± 1/3, where about 2 would by chance. Does the sample have a modulation with k = (1/3, 0, 0)?" Ask it, naming the fraction or the modulation, and leave the answer to the user.
- “The 14 sharp peaks at H = n ± 1/3 are satellites of a modulation with k = (1/3, 0, 0).”: this says the sample has the modulation a result in this reply asks the user about (ask_user). Only the user can say so: ask instead, and declare nothing.
Then write the whole answer again.
```
