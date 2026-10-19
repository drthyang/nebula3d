# Answer checks with the skills off (validation arm C)

`issuesPrompt(issues, { skills: false })` (answerChecks.ts) on 5-answer-checks.md's canned replies, and one more: what the agent loop sends back when the skills' switch is off. The checks are arm B's and find the same; the wording names no skill, no stage and no tool to run next. Each finding quotes the answer's own words (“…”) and says what they lack.

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
- These references name no value in this reply's tool results: “{{assess_stage.rings.max_ring_residual}}”. Write a reference as {{tool.field}}, the path of a field in a result above as the tool returned it, or quote the number itself.
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
- “The flatten left no pedestal, and the window stays inside the coverage.”: this verdict needs its evidence from a check run in this reply. Answer from that check's result.
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
- “a ring is left at 3.2 Å⁻¹.”: this verdict rests on a measurement taken before the last run recomputed what it measured. It needs its evidence from a check run in this reply, after that run; answer from that check's result.
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
- “The ring removal is clean, so the 3D-ΔPDF is ready for analysis.”: this verdict needs its evidence from a check run in this reply. Answer from that check's result.
- “The ring removal is clean, so the 3D-ΔPDF is ready for analysis.”: this calls the run a success, but the verdict computed from the checks does not give it: the run did not meet its goal. That verdict is the checks', not yours: quote it as {{achieved}} and explain what it rests on.
- “The ring removal is clean, so the 3D-ΔPDF is ready for analysis.”: this contradicts the verdict a check computed in this reply. Quote that verdict and its numbers.
Then write the whole answer again.
```

## a success the checks did not all measure

Tools run in the reply: qmax_coverage {}.

The answer:

```text
The reduction is ready for analysis.
```

Sent back to the model:

```text
Before this answer goes to the user, fix it:
- “The reduction is ready for analysis.”: this calls the run a success, but the verdict computed from the checks does not give it: the checks it rests on did not all run on the outputs as they now are. That verdict is the checks', not yours: quote it as {{achieved}} and explain what it rests on.
Then write the whole answer again.
```
